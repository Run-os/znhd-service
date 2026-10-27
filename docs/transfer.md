# 传输助手 · 技术说明

> 面向 AI / 开发者。使用步骤见 [transfer-guide.md](transfer-guide.md)。
> 最后核对：2026-10-28（v26.10.27-v3 / relay 26.7.28-v5）。

## 1. 职责与边界

手机 ↔ 电脑互传图片 / 文件 / 文本。**三端**：手机浏览器页（`web/` 构建产物，中继同源托管）、中继服务器（`relay-server/`，Node 零依赖）、电脑端脚本窗口（脚本端）。

边界：内容**只在内存/磁盘暂存**——中继只做转发与短暂排队；聊天记录（含图片本体）只存**两端本机**的 IndexedDB（保留 7 天）。设备 ID 不可猜测，A/B 电脑互不串扰（按用户隔离）。

## 2. 模块地图

| 文件 | 关键导出 | 作用 |
|---|---|---|
| [`src/lib/relay.ts`](../src/lib/relay.ts) | `getDeviceId()` / `startPhoneReceive()` / `sendToPhone()` / `sendTestImage()` / `copyImageToClipboard()` / `compressImageForPhone()` / `RELAY_MAX_BODY` | 电脑端网络层：长轮询取件、反向发送、压缩参数（1600px / 0.75 / 100MB） |
| [`src/lib/transfer/store.ts`](../src/lib/transfer/store.ts) | `useTransferStore` 底座：`subscribeTransfer()` / `updateTransferSettings()` / `sendTextToSession()` / `sendImagesToSession()` / `sendFilesToSession()` / `onTransferAutoOpen()` / `healStaleSending()` | 会话状态机（shallowRef 整体换引用）与发送入口 |
| [`src/lib/transfer/persist.ts`](../src/lib/transfer/persist.ts) | — | IndexedDB 持久化（库 `znhd-transfer`，7 天；Blob 落盘 / 载入重建 objectURL） |
| [`src/lib/transfer/settings.ts`](../src/lib/transfer/settings.ts) | `DEFAULT_RELAY_SERVER` | 独立设置存储 `scriptCat_TransferSettings`（relayServer / autoOpenOnReceive / 清空记录） |
| `relay-server/server.js` | — | 中继：长轮询转发、按设备排队、静态托管手机页、表情包磁盘缓存 |
| [`web/src/App.vue`](../web/src/App.vue) | — | 手机/客户端页面骨架（与脚本端 `ChatWindow.vue` **各一份**，共用组件层） |

## 3. 中继接口清单（relay-server/server.js）

| 方法 + 路径 | 方向 | 说明 |
|---|---|---|
| `GET /health` | 探活 | `{ok:true, version}`——验收以 version 与 relay-server/package.json 一致为准 |
| `GET /u/<deviceId>` | 手机 | 手机上传页 HTML（no-cache；引用 `/assets/` 带 hash 静态资源） |
| `POST /u/<deviceId>` | 手机→电脑 | 上传条目，body 带 phoneId ⇒ 写进条目 `from`，电脑端据此归组会话 |
| `GET /recv/<deviceId>` | 电脑长轮询 | **广播**语义：同设备多标签页同时等待时每条都投给所有等待方；条目带 `from` |
| `POST /phone/heartbeat/<deviceId>` | 手机报活 | 旧端点（P4 兼容保留），body 必须带 `{phoneId}`，缺失 400 |
| `GET /phone/status/<deviceId>` | 电脑查询 | `{online, phones:[{id,lastSeen}]}`；现在只在开窗 + 兜底 60s 被调用 |
| `POST /phone/send/<deviceId>` | 电脑→手机 | 镜像 /u 的 POST |
| `GET /phone/recv/<deviceId>` | 手机长轮询 | 镜像 /recv |
| `POST /phone/poll/<deviceId>` | 手机报活+取件 | P4 合一：一次连接同时报活与挂起等件，没消息挂到 maxwait 回 `{empty:true}`；手机端只挂一条连接。**在线判定语义改变**（新模型），老手机页自动退回旧模型 |
| `GET /assets/*` | 静态 | 手机页构建产物，带 hash 长缓存 + gzip |

长轮询失败按**指数退避重连（2s→60s 封顶）**；在线手机名单由正向长轮询 piggyback 捎带 + 上下线事件唤醒（电脑端不再轮询 status）。

## 4. 电脑端会话模型

- 每台电脑首次运行生成稳定 `deviceId`（UUID，持久化）；手机页另有自己的 `phoneId`（手机持久化 UUID）。
- 会话键 = `sessionKeyOf(phoneId)`；历史遗留的「手机」聚合会话（`PHONE_SESSION_KEY = '__phone__'`）仍存在——内容落在它里面说明中继/手机页过旧、识别不到发送者。
- 收到条目：按 `from` 归组 → 未读角标 → `autoOpenOnReceive` 时经 `onTransferAutoOpen` 弹窗；窗口开着只累加、不切会话。
- 发送（文本/图片/文件）带「发送中」状态：进度逐事件写回气泡；`healStaleSending()` 兜底 3 分钟以上的卡死状态。
- 设置与主设置隔离（`scriptCat_TransferSettings`）；「中继地址」草稿失焦/回车提交——逐字提交会每个合法前缀都触发一次重连。

## 5. 持久化（persist.ts，两端各一份）

- IndexedDB：脚本端库 `znhd-transfer`，客户端库 `znhd-phone-chat`；**只保留最近 7 天**自动清理；IndexedDB 不可用退回内存态。
- ⚠️ 写库前必须把 Vue Proxy 转**纯对象**（`structuredClone` 对 Proxy 抛 `DataCloneError`，且是静默失败）。
- 自己发出的图/文件以 `Blob` 落盘，载入重建 objectURL（URL 刷新即失效）。
- 时机：先 `loadChatMessages()` 再 `startRelay()`（`hydrated` 闸门），pagehide / visibilitychange 立即 flush 不等防抖。

## 6. UI 骨架与两端对齐

- 脚本端三栏：窄图标导航（对话/文件、未读角标、底部企业信息）→ 会话列表（搜索 / 「+」配对 / 预览 / 时间 / 未读）→ 聊天区（气泡、5 分钟时间分隔、图片放大预览、复制/下载/删除、输入舱）。
- **页面骨架两端各写一份**（脚本端 `ChatWindow.vue` ↔ 客户端 `web/src/App.vue`），只共用 ChatBubble / ChatComposer / ChatTurn / MessageScroller ⇒ 页面级改动必须回查另一端。
- 已对齐的行为（别回退）：开窗/收新消息自动滚到底（v26.10.27-v1）；自己发的图也能点开预览（客户端 v26.10.27 对齐，`clickable` 不分 side）。
- Vue computed 必须依赖响应式源（`store.value.xxx`），读模块级普通对象只算一次永久缓存——传输相关改动的头号坑。

## 7. 部署与设置隔离

```bash
cd relay-server && node server.js   # 零依赖，默认端口 5689（PORT 环境变量可改）
curl http://127.0.0.1:5689/health    # version 与 relay-server/package.json 一致 = 已生效
```

- 服务器必须**手机公网可达**（仅 localhost 手机连不上）；生产部署在 1panel 容器 `znhd`（挂载仓库目录进 `/app`），更新后 `docker restart znhd`，**不热更**。
- 设置键隔离：传输助手自己的设置（中继地址、自动弹出、清空记录）存 **`scriptCat_TransferSettings`**，与主设置 `scriptCat_Allvalue` 互不干扰；v26.10.25-v2 起这些项的**入口**并入主设置弹窗的「传输助手」页（原传输窗口内的设置弹窗已删），但**存储键没有合并**（别顺手并成一个）。
- 同一设备 ID 多标签页同时开着会各自接收（广播语义）；只想一个页面弹窗就关掉其余跑了脚本的标签页。

## 8. 失败模式与日志

| 情况 | 现象 / 日志 |
|---|---|
| 中继不可达 | 长轮询退避重连日志刷「重试」；企业信息页在线手机 0 |
| 中继更新未重启 | `/health` version 对不上；旧 hash JS 404 / 白屏（`uploadPageHtml` 启动时缓存 index.html ⇒ **build:web 后必须重启中继**） |
| 内容进「手机」聚合会话 | 中继或手机页过旧，识别不到 `from` |
| 多标签页重复弹窗 | 广播语义使然，非 bug |
| 413 | 单条超 100MB（`RELAY_MAX_BODY`），20MB 放行 |

## 9. 冒烟覆盖

- `scripts/smoke/vue-panel.js`：`transferWindowOk`（三栏骨架）、`transferChatOk`（气泡/时间/图片）、`transferSendOk`（发送链路）、`transferFilesNavOk`（文件视图）、`transferAvatarOk` / `transferBtnShapeOk` / `transferDividerOk`（样式定版）、`transferSettingsOk`（设置迁入主设置弹窗）、`attachPickOk`（附件选择）、`bubbleWrapOk` / `bubblesStackOk`（气泡布局）。
- `scripts/smoke/phone-page.js`：客户端骨架、持久化（刷新后 Blob 重建 + out 图可预览）、`/phone/send` 投递、预览层挂 body / 铺满视口、桌面版 420×680 弹窗、P4 降级路径。
- `scripts/smoke/relay.js`：心跳 / status / 广播与定向投递 / 离线补投 / `phoneId` 校验 / P4 挂起语义 / 100MB 上限 / 老端点兼容。
