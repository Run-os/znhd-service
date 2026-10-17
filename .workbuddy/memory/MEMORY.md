# znhd-service 项目长期记忆

> **角色：索引 + 高频硬规矩**。来龙去脉在 `AGENT.md`（模块表/踩坑索引，含轮询 P0-P5、嗅探、腾讯文档解析的全部细节）与 `changelogs/2026-10.md`。此处只放「写错就返工」的条目。

## 硬规矩（门禁 / 版本 / 文档 / 部署）
- 三块：`znhd.user.js`（**脚本端**，React 19 + antd v6）、`relay-server/`（零依赖中继；**客户端**页面 = `web/` 构建产物，`/u/<deviceId>`）、`src/lib/*`。术语：「脚本端 / 客户端」，不用「网页端」。
- **版本 `YY.M.D-vN`**（当天真实日期 + 当天第 N 次，跨午夜跟提交时刻）。油猴**三写**：`config/common.meta.json` / `package.json` / `package-lock.json`；relay 独立版本（改 `web/` 必 `build:web`，版本链 relay package.json → `__APP_VERSION__`）。
- **未经明确许可绝不 `git push`**（push 即部署）。文档三处同步：`ReadMe.md` / `AGENT.md` / `changelogs/2026-10.md`（最新在最上）；改代码后回查 ReadMe。
- 产物头部：`// ==UserScript==` 第一行 + 元数据块后 `// @ts-nocheck`；`getBanner` 与 `uiReset.ts` 注释里**不能出现反引号**。
- **浏览器基线 Chrome/Edge 88+ / Firefox 85+ / Safari 14+** + Win7 实机（无 emoji 字体 ⇒ 禁 U+1F300+；图标走 `src/lib/ui/icons.tsx` 内联 SVG；`color-mix()`/:has()/text-wrap:balance 超基线必须降级）。`@ant-design/icons` props 不接受 `style`。
- 门禁 = `typecheck`+`lint`+`build`+`verify`；**verify 约 2m10s ⇒ 必须后台跑**（前台 120s 截断）。
- **加冒烟断言必须改两处**（`scripts/smoke/znhd-smoke.html` 产出 report 字段 + 接进 title 的 && 链；`scripts/smoke/run.js` 的 `CHECKS`）+ **故意破坏一次反向验证**（别绕过 `npm run build`，要写 dist/.build-stamp）。⚠️ 分层兜底 ⇒ 反向验证要**所有兜底层一起关**。
- `outputs/` 已 gitignore；加文件前 `git status`，别裸 `git add -A`。依赖面极窄（3 个 @require），**新增 npm 依赖默认不批**。
- 部署：极点云-HK `45.207.199.216:65000`，容器 `znhd`（端口 5689），代码 `/opt/znhd-service`；反代 1Panel openresty。`/health` 看线上 relay 版本最快。git push 需 `GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0` + 绕沙箱。

## 轮询 / 在线判定（P0–P5，8h 请求 11664→~1280）
- 长轮询请求数 ≈ 时长/maxwait；**服务器主动推送必须带协商标记**（`?phones=1`+`res.__wakeSub`），否则老客户端 1s 重连打爆请求。
- 稳态 45s：脚本端 `firstPoll?1000:45000`，客户端 `&maxwait=45000`+看门狗 55000。退避单一来源 `shared/kit/backoff.ts`（2s 翻倍 60s 封顶，429 直跳 60s；响应解析失败/单条损坏**故意不退避**）。429/5xx 判据排在 `r.json()` / `markConnected()` 之前。
- 在线名单：piggyback（`/recv` 每响应带 `phones`，**先消化 phones 再判 empty**）+ notify 唤醒 + 60s 兜底。`createChannel(labels, opts)` 两参数；`deliver`/超时响应统一走 `reply()`。
- 手机端一条连接：`POST /phone/poll/<deviceId>?maxwait=`（body `{phoneId}`）= 报活+收件；404 降级 legacy。未确认前用 1s 短 maxwait（`confirmed`）。「挂起中的 poll 算在线 + 断开后 TTL 判离线」。

## 传输助手（微信桌面暗色）
- 三栏 `TransferNavRail`→`TransferSessionList`→`TransferDeviceChat`/`TransferFilesView`；第一栏选中态判据 = `aria-current="page"`（暗色把 #07C160 算成 rgb(9,167,85)，按 hex 猜必假红）。圆角唯一入口 `wechatTheme.ts` RADIUS；配色唯一入口 `WECHAT`；Modal 容器类名 `.ant-modal-container`、`styles` 无 content 键。
- `lib/transfer/store.ts` 模块级单例（窗口不开也收件），IndexedDB 持久化 7 天 TTL；归组 `phoneId→from→sessionKeyForIncoming`；客户端三条发送路径都要带 `phoneId`。
- 文件互传：载荷 `{name,mime,data(base64)}` 格式无关；中继 MAX_BODY 100MB ↔ 脚本 `RELAY_MAX_BODY` 同步；中继 MAX_QUEUE_BYTES 256MB。v26.10.18-v1 起发送**先落全部「发送中」气泡再逐个上传**，进度条画在气泡内（脚本端 `GM_xhr upload.onprogress`、客户端 XHR `upload.onprogress`；`TransferMessage.sendProgress` / `ChatMsg.progress`；**首个进度事件前不画条**——宿主不支持时静默降级「发送中…」）。改 `web/` 必须 `build:web`。
- 表情面板点一张直接发；`sendEmoji` 载荷 `emoji:true` →「全部文件」过滤表情。

## 图片嗅探
- `lib/sniffer.ts` 纯函数；归属在 `sniffConv.ts`（读 `unsafeWindow` 的 `#app.__vue__` Vuex；按文件名主干匹配不按 DOM）。v5 三层 AliasTable + convKey 兜底缺一处就「重扫又分裂」。持久化 `scriptCat_SniffConvIndex`。
- perf：`snifferPerf`（PerformanceObserver buffered，零 HEAD）；`snifferPre` 后台预测量 = **脚本里唯一没开窗也发请求的地方**（开关 `Allvalue.sniffPreMeasure`）。
- 卡片不显示文件名 ⇒ 文件名只在 `<Image alt>`（6 条断言读 alt）。组内按时间倒序、无时间殿后 + 红圈（`boxShadow` 双层铺、冒烟只比 RGB；判据单一来源 `timeOfItem`）。

## 常用语（腾讯文档）+ 表情缓存
- 分流只在 `MainPanel.loadPhrasesData`；解析器 `src/lib/phrasesDoc.ts`。**接口必须带 `Referer`**（不带 401）。一级标题切块、第一个标题前丢弃。快照坑：只有 `bi` 能定位；样式名在 `ms.pr.styles.style[id].name`（**name 是对象**）；bullet `lvlText` 是 Wingdings 私有区字符；序号只在同一 numId 连续段落递增。`/aio/` 智能文档不支持。
- 表情缓存：清单 `relay-server/emoji-sources.json`（两端 import）；`EmojiItem.path`=`/emoji/<合集>/<文件名>`，4 处取图入口都要传 `it.path`。

## 冒烟假红/假绿陷阱（高频）
1. `checkPass` 是 `!!report[key]` ⇒ 带比较符的要让页面产出布尔字段。2. 找标签文本取**最深**节点。3. 爬祖先别 `querySelector('input')` 一把抓。4. `body.innerText` 受遮罩影响 ⇒ 读容器 textContent。5. antd Tooltip 正文不在 DOM ⇒ 点按钮走桩记录。6. **断言读取时机不能晚于元素消失** ⇒ 开着时记快照。
- 多 Modal 同屏 z-index 都 1000000 ⇒ 点击类断言先清场。验「重试间隔」用 setTimeout 包装记精确退避值。`verify:web` 表情面板展开偶发假红，单跑即绿。UI bug 不读代码猜，连真机量。

## Git
- GitHub rebase-and-merge ⇒ 合并后本地「幽灵重复」：同 patch-id + diff 为空别重合代码；清理在 origin/main 上 rebase，`workbuddy/*` 分支不能 `git branch -d`。多检出目录并存：worktree 改完先推，主检出再 pull，别两边同时改。
- **流程：先写记忆（日志+MEMORY.md）再一次性 git add 提交**（用户约定）。
