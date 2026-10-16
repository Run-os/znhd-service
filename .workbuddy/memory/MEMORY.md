# znhd-service 项目长期记忆

> 细节以 `AGENT.md`（内部约束/踩坑索引）与 `ReadMe.md`（对外）为准；此处只留「下次开工必须先知道的硬规矩」。

## 硬规矩
- 三块：`znhd.user.js`（税务页油猴脚本 = **脚本端**，自建宿主 + React 19 + antd v6；宿主 id 见 `src/lib/ui/panelIds.ts`）、`relay-server/`（**零依赖**中继；**客户端**页面 = `web/` 构建产物，托管 `/u/<deviceId>`）、`src/lib/*` 业务。
- **版本号 `YY.M.D-vN`**（改动当天真实日期 + 当天第 N 次；跨午夜跟**提交时刻**走）。油猴**三写**：`config/common.meta.json` / `package.json` / `package-lock.json`；relay 独立版本。
- **未经明确许可绝不 `git push`**（push 即部署）。文档三处同步：`ReadMe.md` / `AGENT.md` / `changelogs/2026-10.md`（最新在最上）；**改代码后必须回查 ReadMe**。
- 产物头部两条不能破：① `// ==UserScript==` 必须第一行；② 元数据块后带 `// @ts-nocheck`。`getBanner` 与 `uiReset.ts` 注释里**绝不能出现反引号**（截断模板 ⇒ TS1005）。
- 门禁 = `typecheck` + `lint` + `build` + `verify`（smoke/relay/web 三段全绿）。⚠️ `verify` 约 **2 分 10 秒**，前台 Bash 会被 120s 超时截断 ⇒ 一律后台跑。
- **加冒烟断言必须改两处 + 反向验证**：`scripts/smoke/znhd-smoke.html`（产出 report 字段 + 接进页面 `title` 的 `&&` 链）**和** `scripts/smoke/run.js` 的 `CHECKS` 数组；最终判定只认 `CHECKS`（只改页面 = 断言形同虚设）。**改完必须故意破坏一次确认变红**；反向验证别绕过 `npm run build`（要写 `dist/.build-stamp`，否则 verify 以「产物与源码不一致」拒跑）。
- ⚠️ **分层兜底 ⇒ 单点关闭假绿**（已踩两次：sniffConv 的 `AliasTable`、手机在线判定的 `pollAliveSet`）⇒ 反向验证要把所有兜底层一起关。

## 轮询优化（P0–P5 全落地；8h 请求数 11664 → ~1280，-89%）
- **数学前提（讨论任何轮询前先记住）**：长轮询闭环 ⇒ **请求数 ≈ 时长/maxwait，与消息条数无关**；故「响应里捎带数据」不增请求数，`notify()`（服务器主动结束挂起）也不是新机制。**唯一推高请求数的写法 = 对不认识新载荷的老客户端做无协商推送**（老客户端遇未知响应 1s 后重连）⇒ 一切服务器主动推送必须带协商标记（本项目 `?phones=1` + `res.__wakeSub`）。
- **挂起时长（P3/v26.10.15-v1）**：中继 `handlePoll` 钳制 `[1000, 60000]`，**默认仍 25000**（老客户端零变化）；两端稳态 **45s**：脚本端 `const maxwait = firstPoll ? 1000 : 45000`（首次 1000 只为快速确认「已连上」；`timeout: maxwait+5000`）、客户端 `&maxwait=45000` + 看门狗 **55000**（必须 > maxwait）。
- **重试退避（P5/v8）**：单一来源 `shared/kit/backoff.ts` 纯函数 `nextRetryDelay(prevMs, httpStatus?)` —— 首次 2s → 翻倍 → **60s 封顶**、**任一成功响应后复位**、**429 直跳 60s**；两端各持 `retryDelay` 闭包（多中继地址各自独立）。**退避只对连接故障生效**：`src/lib/relay.ts` 两处 `setTimeout(poll, 1000)`（响应解析失败 / 单条 base64 损坏）**故意不退避**（「服务器通了但这条不认」，并进去会让一张坏图停摆 60s）。顺序红线：脚本端 `onload` 的 429/5xx 分支排在 `markConnected()` **之前**；客户端 `pollRecv` 的 429/5xx 判据排在 `r.json()` **之前**。
- **在线手机名单的送达（P1/P2/v7）**：**已删 5s `/phone/status` 轮询**（8h 里 5760 次 = 49.4%）。三条路：① **piggyback** —— `forwardChannel` 的 `opts.decorate(uuid)` 让 `/recv` 的**每个**响应（含 `{empty:true}` 超时）都带 `phones`，脚本端 `onload` **必须先消化 `data.phones`、再判 `data.empty`**；② **`notify()` 主动唤醒** —— 手机上线（heartbeat 的 `if(!wasOnline)`）与下线（5s 清扫判定）各唤醒一次 `{type:'phones'}`，亚秒级；③ 按需查询（开窗）+ **60s 兜底 tick**（`Date.now()-phonesSeenAt < 55000` 就跳过 ⇒ 正常零请求，兜底只为未升级老中继）。⚠️ `createChannel(labels, opts)` 是**两参数**（`decorate` 在 `opts` 里；写进 labels 静默失效）；`deliver` 3 处 + `handlePoll` 超时 1 处响应**统一走 `reply()`**，漏一处就是「有时不捎带」。守：relay 5 条 + 浏览器端 4 条断言。

## 手机端连接模型（P4/v26.10.15-v2）
- 只挂**一条**连接：`POST /phone/poll/<deviceId>?maxwait=`（body `{phoneId}`）= 报活 + 收件合一（~4880 → **~1280**；心跳 3600 归零，任务书「<1500 次」达成）。老端点 `/phone/heartbeat` + `/phone/recv` **原样保留** ⇒ 老客户端零影响；新页面遇 404 自动降级（`mode: 'unknown'|'poll'|'legacy'`，只在 `unknown` 时判 404）。
- ⚠️ **在线判定语义变了**：旧「距上次心跳 < `PHONE_TTL`(20s)」→ 新「**挂起中的 poll 算在线** + 断开后 TTL 判离线」；`pollAliveSet()` 被 `listPhones` 与周期清扫**两处冗余使用**（只认 `res.__pollAlive` ⇒ 老页面语义零变化），`refreshPhone()` 在 close 时静默补时间戳。真离线仍 ~20~25s。
- ⚠️ 未确认连上时**必须用 1s 短 maxwait**（`confirmed` 标志），否则「已连接」要等 45s（旧行为 ≤8s）；看门狗同步缩到 `maxwait+5000`。
- **慢断言共用等待窗口**：P3 的 31s 挂起探测与 P4 的 20s 在线边界并行 ⇒ `verify:relay` 仍 ~38s。⚠️ 那条 P3 断言是本仓**唯一必须真等 31s** 的（钳制值是常量，新旧上限唯一可观测差异就是挂起时长）⇒ 探测在 `main()` 最早期启动、与后面断言并行，末尾补足判定，别串行。

## 传输通道：CSP / WebSocket 实测结论（2026-10-14）
- **「改用长轮询是为绕过税务页 CSP 的 connect-src」成立**（`server.js:21` / `relay.ts:9` / `ReadMe.md:230` 三处同述）。
- **但「隔离世界仍吃 connect-src」是错的**（我一度误判，已实测推翻）：MV3 `content_scripts` 的 **`ISOLATED` world 发起 WebSocket / EventSource / fetch 豁免页面 CSP**；`MAIN` world（`@grant none`）才被拦（实证 `outputs/csp-ws-probe/`，Chrome 154 真 101 握手）。**隔离世界只绕 CSP、不绕 CORS**；CSP+CORS 双绕只有 `GM_xmlhttpRequest`。测量陷阱：隔离世界与主世界是两个 window 对象 ⇒ 跨世界回传必须 `document.dispatchEvent(new CustomEvent(...))`。
- **落地结论不变**：即便 ws 可行也不换 —— 换 ws 要手写 Node WS 帧解析（**破零依赖红线**），而 `notify()` 用零依赖拿到同样的亚秒级推送。

## 传输助手（微信桌面版暗色）
- 入口 = 主面板一行 4 个（设置/常用语/传输助手/图片嗅探）；三栏 = `TransferNavRail`（对话 key 仍 `devices` / 文件 + 底部设置·企业信息）→ `TransferSessionList` → 第三栏（`TransferDeviceChat` / `TransferFilesView`）。⚠️ **Agent 能力（Agents 入口 + 技能/定时任务控件 + Agent 对话 + `lib/agent/`）已于 v26.10.13-v9 整体删除**，`MarkdownBody` 从 `ui/agent/` 移到 `ui/`。
- **圆角 + 层级**：圆角唯一入口 `wechatTheme.ts` 的 `RADIUS`（window 14 / panel 10 / card 12 / control 8）；外框大圆角 = ConfigProvider `borderRadiusLG`；第二三栏包在 `.znhd-transfer-content` 内嵌圆角卡片（右缩进 10 / 下缩进 8），第一栏贴满窗口高度；⚠️ 卡片**露出层 = Modal body 底色 = `WECHAT.rail`（#2E2E2E，与第一栏同色，用户不允许色差断层）**；输入区 `ChatComposer` 四边留白 12px 圆角浮起卡片（**全边框不能删**——冒烟 `panelBordered` 判 `borderTopWidth>0`）。守：`transferLayeredOk` + `frameMatchesRail`（同色比较不写死 hex）。
- 配色唯一入口 `WECHAT`（rail #2E2E2E / list #252525 / chat #1E1E1E / 关闭红 #E81123）；主色微信绿 #07C160 且固定暗色；尺寸改 `TransferAssistantModal` 的 `width` + body `height`；子弹窗一律 `centered`；窗口识别 `.ant-modal.znhd-transfer-modal`。⚠️ antd v6 Modal 容器类名是 **`.ant-modal-container`** 且 `styles` 无 content 键。
- 第一栏选中态判据 = **`aria-current="page"`**（暗色算法把 #07C160 算成 rgb(9,167,85)，按 hex 猜必假红）。聊天共用件：`ChatScroll` 的 **`minHeight:0` 硬性**；气泡方向用 `flexDirection` + 根节点 `data-side`；用户气泡实心 ⇒ `MarkdownBody` 传 `inverted`；`autoSize{2..6}` 与 `lineHeight:'20px'` 成对。
- `lib/transfer/store.ts` 模块级单例（窗口不开也收件），消息变更带 `persistSoon()`（IndexedDB 7 天 TTL）；归组 `phoneId → item.from → sessionKeyForIncoming`；聚合会话在线态用 `sessionSendable()`；客户端**三条**发送路径都要带 `phoneId`；设置隔离在 `scriptCat_TransferSettings`。
- 表情面板（仅脚本端）：点一张直接发送；悬停 0.5s 放大（网格 `mousemove` 委托）；两条自动收起都自己实现（点选不触发 `onOpenChange`；点外部自挂 `document` 捕获 mousedown 且**排除触发按钮**）；判「已收起」不能只看 `ant-popover-hidden`。
- **任意文件互传**：载荷 `{name,mime,data(base64)}` **格式无关 ⇒ 加文件通道不改协议**，只按 mime 分流（`image/*` → `type:'image'`，其它 → `type:'file'`；缺 mime 兜底图片以兼容老客户端）。中继 `MAX_BODY` 12MB → **100MB**，脚本端 `RELAY_MAX_BODY` 必须同步。⚠️ 内存风险 ⇒ 中继 **`MAX_QUEUE_BYTES = 256MB`** 字节预算（`createChannel` 的 `queueBytes` + `itemBytes(it)`），**所有出队路径统一走 `removeAt(q,i)`** —— 漏一处 = 预算虚高、内存不回收。渲染钩子：脚本端 `sendFilesToSession`（**不压缩**，只 `readAsDataURL`）/ `data-transfer-file-bubble` / `data-transfer-file-card`；客户端 `onPickFiles` + `.znhd-chat-file`。工具栏「附件」占位已换成可用「文件」按钮（`chatComposerOk` 断言 `['表情','图片上传','文件']`）。
- 客户端 `web/` 与脚本端第三栏同款暗色，**改 `web/` 必须 `build:web`**；版本链 = `relay-server/package.json` → vite `__APP_VERSION__`。

## 图片嗅探
- **按会话分组（v8）**：`lib/sniffer.ts` 是**不碰页面的纯函数**；归属/分桶/持久化全在 `lib/sniffConv.ts`。归属判据 = `unsafeWindow.document` 的 `#app.__vue__`（当前会话 `chat.messageList`；其它会话 `allChat.historyMsg` —— **嵌套结构无实测样本**，靠 `walkAny` 宽容遍历兜）；会话名 DOM 兜底 `.group-item.selected .company-name`。**按文件名主干匹配，不按 DOM 位置**。持久化 `scriptCat_SniffConvIndex`（按 origin 分桶 / 30 天 / 2000 条）；排序 = 当前会话置顶 → 消息时间 → 未归属殿后；**没有具名会话就不画组头**（退回平铺）；容器钩子 `data-sniff-group` / `-name` / `-current`。
- **v5 修「同一会话拆成同名两组」**：会话 ID 逐张解析 ⇒ 一半真实 `GROUP…`、一半退化 `name:<名>`。三层：`AliasTable`（显示名→真实 ID；精确 → 去括号尾注归一化 → **唯一**包含，不唯一放弃）+ `buildConvContext` **两遍走** + 回退键后置合并（`saveStoredConv` 写时迁移 / `loadStoredConv` 读时纠正 / `groupByConversation` 的 `convKey` 兜底 —— **缺一处就「重扫又分裂」**）。持久层同桶新增 `aliases`（同 TTL、上限 200）。
- **提速（v2/v4）**：`lib/snifferPerf.ts` 在 `app()` 第一行 `startPerfCollect()` —— `setResourceTimingBufferSize(20000)` + `PerformanceObserver(buffered:true)` 抄资源条目进模块级 Map（只收图片、上限 20000），取值 `decodedBodySize→encodedBodySize→transferSize`，**纯读 performance、零请求零 DOM**；`add()` 时即挂 `perfBytesOf(url)` ⇒ `probeOne` 第一档命中、**零 HEAD**。`downloadBatch` 两段式（预取并发 4 / 背压 8 / 连败 3 次降并发 / 退避重试 / 401·403·404·410 不重试）。⚠️ 验 perf 必须用**同源真图**（`/sniff-perf.png` = 22528 B，`__gmXhrLog` 零请求）；跨域假域名 DNS 就失败、根本不进资源表。
- **v4 起「测量」提前到后台**（用户指定，明知代价）：`lib/snifferPre.ts` 启动 5s 首轮 + 每 60s 一轮 → `lib/snifferCache.ts`（进程内、**失败也记**）；`resolveSizes` 命中即免请求（**唯一读点**）。⚠️ **这是脚本里唯一会在「没开嗅探窗」时发请求的地方** ⇒ 四条安全阀（零成本项先测 / 单轮网络 60 张 / 并发 2 / 后台 CSS 遍历上限 1200）+ 开关 `Allvalue.sniffPreMeasure`（默认开，设置里可即时关）。冒烟 `sniffPreMeasureOk` = 开窗前已测量 **且** 开窗后不重发。
- **5 列缩略图（v6）**：`SniffModal` 网格 `repeat(5,minmax(0,1fr))` + `width 828`（720 的 +15%）。5 列后单元格图 138×138、按钮条 50×26（下载/打印**两个**图标）；`sniffImgActionsOk` 的 `inside`/`bottomRight` 仍满足，改任一项要回算这两条几何断言。
- **卡片瘦身（v26.10.16-v1，用户要求）**：卡片**不再显示文件名** ⇒ **文件名只写进 `<Image alt>`，那是冒烟唯一的文件名观测面**（`znhd-smoke.html` 的 `names` / `__sniffGroupFacts().cardNames`，6 条断言已从卡片 `title` 换源到 `alt`：perf/selectScope/exclude/svgExcluded/group/convAlias）⇒ **改卡片结构别把 `alt` 弄丢**。「已按文件名排除 N 张」提示也删了，计数改输出为 `data-sniff-excluded` 钩子（拆掉 ⇒ `excludedCount:-1` ⇒ 断言红）；新增 `sniffNoNameTextOk`（`alt` 有名字 **且** 可见文本无名字）。排除规则本身未动。

## 表情包中继磁盘缓存 + 不进全部文件
- 清单单一来源 `relay-server/emoji-sources.json`（两端都 import；web 侧 `vite.config.ts` 的 `server.fs.allow` 要加 `../relay-server`，引用路径三级 `../../../`）。服务端 `relay-server/emoji-store.js`：env **require 时**读（fixture 必须赶在 require server.js 前设）；listen 回调触发 `ensureAll()` 后台预热；清单 24h TTL、按需补图 single-flight、refresh 限流 60s；`urlAllowed` 仅 https + 回环 http（防 SSRF）；缓存目录 `relay-server/data/`（.gitignore ⇒ `git clean -fd` 不清 ⇒ 跨部署保留）。
- 两端「中继优先、CDN 兜底」：`EmojiItem.path` = `/emoji/<合集>/<文件名>`，blob 缓存键 = `path || url`；对中继清单 path 严格正则校验。`EmojiPackPanel` 4 处取图入口（缓存命中/分批/pick/hover）都要传 `it.path` —— 漏传静默走 CDN 且缓存键不同。链路：客户端 `sendEmoji` 载荷 `emoji:true` → relay `parseItemBody` → 脚本端 `relay.ts onImage` → `store.addMessage` → `TransferFilesView` 只过滤文件视图（`messages.filter(m=>!m.emoji)`）。证据：中继优先 ⇒ `cdn===0` 零外部请求；`emojiNotInFilesOk` 钉死过滤。

## 中继与部署
- 服务器 = **极点云-HK**（`45.207.199.216:65000`，OneSSH host 名 `极点云-HK`）。容器 `znhd`（`1panel/node:25.9.0`）端口 `0.0.0.0:5689`；代码根 `/opt/znhd-service`（`relay-server/` 挂进容器 `/app`）。
- 反代 = **1Panel openresty 容器**（`1Panel-openresty-AP4d`，**不是宿主机 nginx**）。站点块 = `/opt/1panel/1panel/www/conf.d/znhd.122050.xyz.conf`（只有 `proxy_pass http://127.0.0.1:5689`，**无 timeout 覆盖**）；**http 级 `proxy_read_timeout 3600s`** 在 `/opt/1panel/apps/openresty/openresty/conf/nginx.conf:49` ⇒ 60s 挂起余量 59 倍（放宽 maxwait 前先重查这两处）。线上实测：`curl -s --resolve znhd.122050.xyz:443:127.0.0.1 -w 'HTTP=%{http_code} 耗时=%{time_total}s\n' 'https://znhd.122050.xyz/recv/<uuid>?maxwait=30000'` → `200 / 30.13s / {"empty":true}`。
- `deploy.yml` 定式：脚本内硬编码 `DEPLOY_PATH` / `CONTAINER_NAME` + 安全阀（根因：ssh-action 不注入顶层 env）。诊断：`Connection refused (111) upstream 5689` = relay 未监听。`/health` → `{ok:true,version:"<relay 版本>"}` = 判断「线上跑哪个 relay 版本」最快的一招；⚠️ 部署脚本**只校验 relay 版本**，脚本端版本看 `dist/znhd.user.js` 的 `@version`。

## Git 合并
- 本仓用 GitHub「Rebase and merge」⇒ 合进 main 后本地分支显示「n 领先 / n 落后」的**幽灵重复**（committer 变成 GitHub 账号）。判据 = 同 patch-id + `git diff <分支tip> <main tip>` 为空，**别急着重合代码**。
- 清理：备份标签 → **在 `origin/main` 上** rebase → 解冲突（changelog 取并集；`relay-server/public/*` 取 origin 侧并 `git rm` 过期 hash）→ `build:web` + `build` → verify；追加修复用 `--fixup` + `rebase -i --autosquash`。`workbuddy/*` 分支不能 `git branch -d`（被 worktree 占用）⇒ 只删远端。push/fetch 私有仓库要 `GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0`，且写操作需绕过沙箱。

## UI 与排查
- 图标一律内联 SVG（Win7 无 emoji 字体 ⇒ U+1F300+ 是豆腐块），走 `src/lib/ui/icons.tsx`；⚠️ `@ant-design/icons` 组件 **props 不接受 `style`**（TS2322）⇒ 挂外层 span。面板按钮容器查询阈值 `PANEL_CSS` 65px 与图标字号/标签字数耦合，改任一个都要回算。
- 写图片到剪贴板只能 `unsafeWindow.navigator.clipboard.write` + `unsafeWindow.ClipboardItem`（`GM_setClipboard` 只支持文本）。图片压缩：SVG / GIF / webp 原样直传，HEIC 走 heic2any 转 JPEG，失败回退原图。
- 排查：UI 层 bug **不要读代码猜**，连真机量 `getComputedStyle` / `getBoundingClientRect` / `elementFromPoint`；测 React 合成事件要**分两拍**（`setState` 异步）；判「选中/状态」用语义属性。浮层一律挂 `documentElement` 下的自建宿主（税务页 body 有 transform）。客户端「连不上」多数是部署/网络层，先要服务端 `[连接]` 日志。
- 冒烟：**坐标 / 真实鼠标类断言点击前必须先清场**（先关掉除被测窗外的 `.ant-modal-close` / `.ant-drawer-close`）—— 同屏多个 Modal 的 z-index 都是 1000000、DOM 靠后者压顶，`elementFromPoint` 会取到底下的元素 ⇒ 断言恒红。判「这条红是不是本次引入」用 `git worktree add tmp/head-wt --detach HEAD` + junction 链 `node_modules` 隔离复跑，别 stash 工作区。
- **验「定时重试间隔」的巧劲**：真等要 62s ⇒ 在探针窗口内包一层 `window.setTimeout`，把**恰好等于退避值**的延时记下、把真实等待改 0ms。⚠️ 过滤必须**精确值**（按「≥1000ms」放行会把本页 30s/36.5s/38.4s 的定时器一起提前触发）；安全网要用**包装前捕获的真实 setTimeout 底座**。探针排在冒烟 26s（内容流 ≤19.5s 完、`kickSniff` 30s 前）。反向验证要**分轮**（把 `onerror` 改成不写 retryDelay 会掩盖「复位」断言）。
