# znhd-service 项目长期记忆

## 概况与硬性规范
- 三块：`znhd.user.js`（税务页油猴脚本，**自建宿主 + React 19 + Ant Design v6**；面板宿主 `__znhd_panel_host__`、浮层宿主 `__znhd_overlay_host__`（`src/lib/ui/panelIds.ts` 叶子模块，防循环 import TDZ）、预览宿主 `__znhd_preview_host__`）；`relay-server/`（手机↔电脑中继，纯 Node 内置 http 零依赖；手机页 = `web/` 的 React 构建产物，同源托管于 `/u/<deviceId>`）。
- **版本号** `YY.M.D-vN`（yy.m.d = 改动当天真实日期，vN = 当天第 N 次，跨天重置 v1）。油猴**三写**：`config/common.meta.json` / `package.json` / `package-lock.json`（relay 有独立版本）。版本文本走 `GM_info.script.version` 动态读，只改 `@version` 头。
- **未经明确许可绝不 `git push`**。
- 文档三处同步：`ReadMe.md`（对外唯一档案：功能/配置/日志/版本号示例）、`AGENT.md`（内部：代码组织/复用/约束/踩坑索引，一句话规则 + 指向 ReadMe）、`changelogs/2026-10.md`（最新条目在最上）。改代码后 ReadMe 必须核对（曾多次滞后）。
- **构建产物头部两条不能破**（`config/webpack.config.base.js` 的 `getBanner`，`scripts/smoke/run.js` 有门禁）：① `// ==UserScript==` 必须是文件第一行；② 元数据块之后带 `// @ts-nocheck`（VS Code 的 TS 服务对 3.7MB 单文件误报 `TS2451 Link` —— 真实 `const Link` 只有 antd `Typography.Link`，另两处报错点落在 JSDoc 注释的单词上；`node --check` 零错）。改 banner 后必须 `npm run build` + `npm run verify`。
- **模板字符串陷阱**：`getBanner` 与 `uiReset.ts` 的注释里**绝不能出现反引号**（会截断模板，tsc 报 TS1005 且报错行指向注释后面那行）——写注释用标识符名或中文引号。

## 传输助手（v26.10.12-v1 由「设备互联」重构；现行 v26.10.13-v5）
- 入口：主面板一行 4 个（设置/常用语/传输助手/图片嗅探；Agent 与「历史记录」入口已删，Agent 从传输助手第一栏进）。三栏（**微信桌面版暗色**）：标题条 `.znhd-transfer-titlebar`（与第一栏同色；自绘关闭按钮 `aria-label="关闭"` 悬浮变红，antd × 已 `closable=false`）→ 第一栏 `TransferNavRail`（58px 窄图标栏：对话[key 仍 `devices`，在 Agents 上]/Agents/文件 + 底部设置/企业信息）→ 第二栏 `TransferSessionList`（搜索 +「＋」+ 微信式条目；文件分组**无「＋」，v26.10.13-v5 起点条目 = 筛选第三栏文件视图（不跳会话），顶部常驻 `data-all-files` 「全部文件」入口还原汇总，筛选状态 `filesFilterKey` 与 `activeSessionKey` 分开、切走文件分组自动还原**；Agents 分组顶部有「技能/定时任务」）→ 第三栏（`TransferDeviceChat`/`TransferFilesView`/`TransferAgentView`，由 `AgentPane = chat|skills|tasks` 驱动，`TransferAssistantModal` 持有）。
- 配色唯一入口 = `wechatTheme.ts` 的 `WECHAT`（rail #2E2E2E / list #252525 / chat #1E1E1E / input #262626 / 气泡 #2F2F2F·#07C160 / 关闭红 #E81123 / navHoverPlate）；窗口 ConfigProvider 主色 = 微信绿 #07C160（主面板仍蓝 #1677FF，嵌套 provider 隔离）；窗口**固定暗色**。窗口尺寸改 `TransferAssistantModal` 的 Modal `width` + body `height` 两处（现行 `min(1166px,96vw)` × `min(756px,calc(100vh-96px))`）；子弹窗一律 `centered`。
- 第一栏图标三态：选中 = `aria-current="page"` + 变绿无底板，hover（未选中）= 深色圆角底板，选中优先。**冒烟判选中必须用 `aria-current`**（antd 暗色算法把 #07C160 算成 rgb(9,167,85)，按 hex 猜 rgb 必假红）。
- 共用聊天件（`ChatPanel.tsx`/`ChatBubble.tsx`/`ChatComposer.tsx`；设备会话与 Agent **必须共用**，各写一份必然漂移）：`ChatScroll` 的 **`minHeight:0` 是硬性**（缺了 flex 子项被撑高、`overflowY:auto` 永不触发）；输入框「吸附底部」是布局算出来的（头部/输入区 `flex:0 0 auto`）；`ChatBubble` 方向用 `flexDirection: row-reverse|row`，根节点 `data-side` 是冒烟钩子；用户气泡主色实心 ⇒ `MarkdownBody` 必须传 `inverted`；`ChatComposer` 铁律：textarea 自禁 outline（`agentInputNoRingOk` 守）、`autoSize{minRows:2,maxRows:6}` 与 `lineHeight:'20px'` 必须成对（`agentInputHeightOk` 守）。
- 业务层 `src/lib/transfer/store.ts` 是**模块级单例**（窗口不开也照常收件，`autoOpenListeners` → 主面板自动弹窗）；`persist.ts` 把 sessions 整体覆盖写 IndexedDB（DB `znhd-transfer`，7 天 TTL + 启动/每小时裁剪，`persistReady` 闸门防载入前覆盖，失败静默退回内存态）——消息变更函数要带 `persistSoon()`。
- 会话归组：正向广播不带手机 ID ⇒ 恰好 1 台在线归该机会话，否则聚合会话 `__phone__`；**聚合会话的在线状态必须用 `sessionSendable()` 判**（用 `!!phone` 会「多台在线却显示离线」，冒烟抓到的真 bug）。发送目标：具体会话 = 定向那台，聚合会话 = `targets:'all'` 广播。
- 设置完全隔离（`scriptCat_TransferSettings` / `DEFAULT_RELAY_SERVER`），主面板 `DEFAULTS` 已无 `relayServer`；旧 `Allvalue.relayServer` 仅一次性迁移种子。
- `destroyOnHidden`：关窗即卸载重挂 ⇒ nav 复位 `devices`、Agent hook 随窗口重生（会话索引靠 localStorage `scriptCat_AgentChats` 回填）。冒烟重开 Agent 必须：关窗 → 点面板「传输助手」→ 点第一栏 `aria-label="Agents"`。窗口识别一律用 className 钩子 `.ant-modal.znhd-transfer-modal`。
- ⚠️ **antd v6**：Modal 容器类名是 **`.ant-modal-container`**（非 v5 的 `.ant-modal-content`），且 `styles` **没有 content 键**（TS2353）⇒ 归零默认 16/24 内边距只能在 `uiReset.ts` 写 CSS 规则（写错类名静默不生效）。
- **表情面板 = 在线图片表情包（v26.10.13-v3；v4 起「点一张直接发送」+ 悬停放大）**：`lib/transfer/emojiPack.ts`（8 个 `cdn.klyang.com` 合集写死在 `EMOJI_PACK_SOURCES`，清单 12h localStorage 缓存键 `scriptCat_EmojiPacks`，图片 blob+objectURL 双缓存与在途去重；**必须走 `GM_xmlhttpRequest`** —— 宿主 CSP 会拦外域 `<img src>`，直接引用是整片裂图；objectURL 不 revoke）+ `ui/transfer/EmojiPackPanel.tsx`（合集 chips/刷新/8 列网格/分批下载 8 张）。**点一张 = 直接发送**（`TransferDeviceChat.sendEmojiNow` → `runSend`，跳过待发列表，与「发送 N 张图片」共用 `sendImagesToSession`）；**悬停 0.5s** 弹 `.znhd-emoji-hover` 放大浮层（portal 到 `getPreviewHost()`、`pointerEvents:none`、带 `data-emoji-url`），**预览已显示时移到别张立即换图**（判据用 ref，读 state 会拿到闭包旧值）。悬停判定用**网格 `mousemove` 委托**，**不用每格 `onMouseEnter`**（React 同一批事件里先 leave 后 enter ⇒ 会重新计时 0.5s，「实时切换」失效）。不传 `onPickEmojiImage` 的宿主（Agent 侧）表情按钮禁用。webp 走 `skipWebp` 原样直传（canvas 压 JPEG 丢透明通道）。旧 `chatEmojis.ts` 已删。
- 冒烟 `scripts/smoke/znhd-smoke.html` 是单页时间线（**报告时刻 v26.10.13-v4 起 38500ms**）；「自动弹窗未点击」证据必须在点击**之前**记快照（报告时刻读全局量会被后续点击污染 → 假红）。⚠️ **浮层内容不在 Modal 子树里**（Popover 等挂 `#__znhd_overlay_host__`）⇒ 一律用 `document.querySelector` 查，`findTransferModal().querySelector(...)` 必为空。
- **手机页（`web/`，`/u/<deviceId>`）**：v26.10.12-v5 起与脚本端第三栏**同款微信暗色聊天窗**（#1E1E1E 底 / 发件右侧绿气泡 / 收件左侧灰气泡 / 间隔 5 分钟插时间分隔条 / 自写 SVG 图标 / 消息上限 100）；`web/index.html` 标题「传输助手」+ 暗色首屏。版本注入链 = `relay-server/package.json` → vite `__APP_VERSION__`。⚠️ 2026-10-13 合并时**放弃了 main 上的并行浅色实现**（旧 `3642123`：浅色 #f5f5f5 + Popover + 待发条方案 A），**以暗色版为准**。改 `web/` 后必须 `npm run build:web` 重建 `relay-server/public`。
- 删除的组件：PhoneModal / RecvHistoryModal / RecvTextModal / agent/AgentModal；`lib/gallery.ts` 只剩 `downloadFileName`。

## 中继与部署
- 端口 `PORT||5689`；nginx `proxy_pass http://127.0.0.1:5689`（域名 znhd.122050.xyz）；容器化时反代须用 relay 服务名（如 `http://znhd:5689`）。
- `deploy.yml` 事故已成定式修法：脚本内**硬编码** `DEPLOY_PATH=/opt/znhd-service`、`CONTAINER_NAME=znhd` + 安全阀（拒绝 /root、/home、/，且要求 `[ -f relay-server/server.js ]`）+ `tar` 直写容器 `/app` + restart + 自证健康检查（比对容器内 version）。根因：`appleboy/ssh-action` 不把 Actions 顶层 env 注入远程 shell。
- 反向通道镜像正向（`/u`↔`/phone/send`、`/recv`↔`/phone/recv`、`deliverToAll`↔`deliverToPhone`）；`/recv` 是**广播**（多标签同时开会各自弹窗）；手机 8s 心跳、`PHONE_TTL=20s`；`pending`/`phonePending` 是内存 FIFO（上限 100，重启即清）。**改一侧必须同步评估另一侧**。
- 脚本端用 `GM_xmlhttpRequest` 长轮询（绕税务页 CSP 对 connect-src 的限制）。
- 诊断：启动日志末行 `http://0.0.0.0:5689`；nginx 报 `Connection refused (111) upstream 5689` = relay 未在该端口监听。

## UI 规范
- **图标一律内联 SVG，禁止补充平面 emoji**：Win7 没有 Segoe UI Emoji 字体 ⇒ U+1F300+ 全渲染成豆腐块（判据是**码位所在平面**，BMP 的 `✓✕→≥×` 可以留）。统一走 `src/lib/ui/icons.tsx`（Lucide 图形 / stroke 2 / ISC）；`@ant-design/icons` 现在只剩 3 处 `PrinterOutlined`（SniffModal / TransferDeviceChat / TransferFilesView）。
- ⚠️ **`@ant-design/icons` 的组件 props 不接受 `style`**（`AntdIconProps` 只认 className 等）⇒ `TS2322`，样式必须挂外层 span（自写 `icons.tsx` 组件则接受 `size`）。
- 面板按钮的容器查询阈值（`PANEL_CSS` 65px）与**图标字号/标签字数**耦合（antd 图标是 1em 正方形），改任一个都要回来重算，否则文字将满时折行。
- 实测夹具 `tmp/check-icons.js`：起 `scripts/smoke/server.js` + 真实 Chromium 加载**构建产物**量 DOM；⚠️ 面板**默认展开**（宿主有 `.ant-card`）、圆球才是收起态；测试页路径是 `/smoke.html`。
- **写图片到剪贴板**：`GM_setClipboard` 在 ScriptCat **只支持文本**（传 Blob 不报错但不写图 → 假成功）；唯一可靠路径 = `unsafeWindow.navigator.clipboard.write` + `unsafeWindow.ClipboardItem`；Chromium 对图片只可靠支持 image/png、大图先降采样到最大边 1600px、转换要在弹窗展示期预做（`prepareClipboardImage`）。

## 其他已落地功能（速查）
- 工作时间可配 `DEFAULTS.workingHours`；`resolveGithubUrl(githubUrl)`（useCdn → jsdelivr，默认 true；支持 blob/raw 多段分支）；常用语 2h 本地缓存（`scriptCat_PhrasesCache`，URL 变或点「重新加载」才重拉）；语音队列上限 10 + TTL 30s + 关语音时 `clearSpeechQueue()`；日志去重窗口 `RECENT_LOG_COUNT=5`。
- 主面板组件 `MainPanel`（原 `DM`）；掉线检测双选择器 `:nth-child(2)` / `:nth-of-type(2)` 是互补兜底，**勿合并**。
- 图片压缩：SVG / GIF / **webp** 一律原样直传（`skipSvg` / `skipGif` / `skipWebp`；理由：canvas 只能导出 JPEG，会丢矢量、动画帧、透明通道）；HEIC 用 heic2any 转 JPEG 再走压缩链（铺白底防黑底），转码器由调用方注入；任何失败回退原图直传，不阻断传输。
- 面板位置持久化：键 `scriptCat_PanelPoint`，夹紧 minY=0 / maxY=vh-40 / 水平 MIN_VISIBLE=48（当前是普通 DOM 宿主，`querySelectorAll` 直接可查）。
- 「判断脚本是否注入」= 查 DOM 里 `#__znhd_panel_host__` / `#__znhd_overlay_host__` 在不在，绝不靠 window 全局或 `<script>` 标签（ScriptCat 跑隔离世界，都不暴露）。

## 排查方法论（硬性）
- UI 层 bug（透字/层级/遮挡）**不要读代码猜**：连真机浏览器量运行中元素 —— `getComputedStyle`（opacity/background）、`getBoundingClientRect`（是否贴边）、`elementFromPoint`（谁在最顶）。v10→v14 连续推断全错，v15 才「量」出 `opacity:0.8`。
- 测 React 的合成事件：**`setState` 是异步的** ⇒ 派发与采样必须**分两拍**（先派发，隔一个 `setTimeout` 再读样式）；判「选中/激活/状态」优先用语义属性（`aria-current`/`data-*`），不要按颜色值猜。
- 改了文件却「像没生效」：先确认运行版本（让用户删脚本重装 + Ctrl+Shift+R），运行副本可能 ≠ 工作区文件。
- 手机端「连不上」绝大多数是**部署/网络层**（反代没转发 POST、跨网、HTTPS 混合内容），先要服务端 `[连接]` 日志与手机页错误文案，别先改代码逻辑。
- 浮层一律挂 `documentElement` 下的自建宿主（`getOverlayContainer()` / `getPreviewHost()`），避开税务页 body 的 `transform`——否则 `position:fixed` 以 body 盒子为包含块，坐标与层级全错。
