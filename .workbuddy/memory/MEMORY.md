# znhd-service 项目长期记忆

> **角色：索引 + 高频硬规矩**。详细来龙去脉在 `AGENT.md`（内部约束/踩坑索引）与 `changelogs/2026-10.md`（版本条目），此处只保留「每次开工都必须先知道、写错就返工」的条目，避免注入时被截断。

## 硬规矩
- 三块：`znhd.user.js`（税务页油猴 = **脚本端**，自建宿主 + React 19 + antd v6，宿主 id 见 `src/lib/ui/panelIds.ts`）、`relay-server/`（**零依赖**中继；**客户端**页面 = `web/` 构建产物，托管 `/u/<deviceId>`）、`src/lib/*` 业务。
- **版本号 `YY.M.D-vN`**（当天真实日期 + 当天第 N 次；跨午夜跟**提交时刻**）。油猴**三写**：`config/common.meta.json` / `package.json` / `package-lock.json`；relay 独立版本。
- **未经明确许可绝不 `git push`**（push 即部署）。文档三处同步：`ReadMe.md` / `AGENT.md` / `changelogs/2026-10.md`（最新在最上）；改代码后必须回查 ReadMe。
- 产物头部两条不能破：① `// ==UserScript==` 第一行；② 元数据块后 `// @ts-nocheck`。`getBanner` / `uiReset.ts` 注释里**绝不能有反引号**（截断模板 ⇒ TS1005）。
- 门禁 = `typecheck` + `lint` + `build` + `verify`（smoke/relay/web）。⚠️ `verify` ≈ **2 分 10 秒**，前台会被 120s 截断 ⇒ **一律后台跑**。
- **加冒烟断言必须改两处 + 反向验证**：`scripts/smoke/znhd-smoke.html`（产出 report 字段 + 接进 `title` 的 `&&` 链）**和** `run.js` 的 `CHECKS`；最终只认 `CHECKS`。改完**故意破坏一次确认变红**；别绕过 `npm run build`（要写 `dist/.build-stamp`）。
- ⚠️ **分层兜底 ⇒ 单点关闭假绿**（踩过两次：`AliasTable`、`pollAliveSet`）⇒ 反向验证要把所有兜底层一起关。
- **Git**：本仓用「Rebase and merge」⇒ 合 main 后本地分支出现「n 领先/n 落后」**幽灵重复**。判据 = 同 patch-id + `git diff <分支tip> <main tip>` 为空，**别急着重合**。`workbuddy/*` 分支只删远端。push/fetch 私有仓库要 `GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0` 且绕过沙箱。

## 轮询模型（一句话版）
- **请求数 ≈ 时长/maxwait，与消息条数无关** ⇒ 「响应捎带数据」不增请求数。唯一推高请求数的写法 = **对不认识新载荷的老客户端无协商推送** ⇒ 服务器主动推送必须带协商标记（`?phones=1` + `res.__wakeSub`）。
- 稳态两端 **45s**（中继钳制 `[1000,60000]`、默认仍 25000）；**首次必须 1s 短探测**（否则「已连接」要等 45s），看门狗 `maxwait+5000`。
- 退避单一来源 `shared/kit/backoff.ts`：2s 起翻倍、60s 封顶、成功即复位、429 直跳 60s；**只对连接故障生效**（单条 base64 坏不退避）。
- 手机端只挂 **一条** `POST /phone/poll`（报活+收件合一）；在线判定改为「**挂起中的 poll 算在线** + 断开后 TTL(~20s) 判离线」。老端点原样保留，遇 404 自动降级。
- 细节 + 红线顺序（429 判据必须早于 `markConnected()` / `r.json()`）见 AGENT.md「createChannel 两参数」「响应多出口走 `reply()`」「piggyback 消化早于 `{empty:true}`」三条。

## 传输通道实测结论
- **长轮询是为绕税务页 CSP 的 connect-src**。但「隔离世界仍吃 CSP」是**错的**：MV3 `ISOLATED` world 发 ws/EventSource/fetch **豁免页面 CSP**（实证 `outputs/csp-ws-probe/`），隔离世界只绕 CSP、不绕 CORS。
- **即便 ws 可行也不换** —— 要手写 Node WS 帧解析（破零依赖红线），`notify()` 用零依赖拿到同样的亚秒级推送。
- ⚠️ **腾讯文档 `dop-api` 校验 `Referer`**：不带 `401`，带文档页地址 `200`。脚本在税务页里必须显式 `headers: { Referer: sourceUrl }`。**「在文档页控制台调能通」≠ 脚本里能通**（这类「本地能跑、上线 401」只能靠断言守）。

## 传输助手（暗色三栏）
- 入口一行 4 个（设置/常用语/传输助手/图片嗅探）；三栏 = `TransferNavRail` → `TransferSessionList` → 第三栏。**未选会话时第三栏直接显示配对设备信息**（`TransferPairPanel`），用 flex `margin:auto` 双轴居中。Agent 能力已于 v26.10.13-v9 整体删除。
- 配色唯一入口 `WECHAT`（rail #2E2E2E / list #252525 / chat #1E1E1E）；圆角唯一入口 `RADIUS`；卡片露出层必须与第一栏同色（用户不允许色差断层）；`ChatComposer` 全边框**不能删**（冒烟 `panelBordered`）。
- 选中态判据用 **`aria-current="page"`**（暗色算法改写了 #07C160 的 rgb，按 hex 猜必假红）。antd v6 Modal 容器类名是 `.ant-modal-container` 且 `styles` 无 content 键。
- 文件互传载荷 `{name,mime,data}` **格式无关**（按 mime 分流 image/file）⇒ 加文件通道不改协议；中继 `MAX_BODY` 100MB + **`MAX_QUEUE_BYTES` 256MB 字节预算**，**所有出队路径统一走 `removeAt(q,i)`**（漏一处 = 内存不回收）。
- **改 `web/` 必须 `build:web`**；版本链 = `relay-server/package.json` → vite `__APP_VERSION__`。

## 图片嗅探
- `lib/sniffer.ts` 不碰页面；归属/分桶/持久化全在 `lib/sniffConv.ts`（判据 `#app.__vue__`，**按文件名主干匹配**）。排序 = 组间（当前会话置顶→未归属殿后→按最新消息时间）+ 组内（时间从新到旧，**无时间殿后并按体积倒序**）。
- **卡片不显示文件名 ⇒ 文件名只在 `<Image alt>`，那是冒烟唯一观测面**（`names` / `cardNames`，6 条断言读 `alt`）⇒ 改卡片结构别把 `alt` 弄丢。
- **无时间的图加红圈**：`timeOfItem` 与 `byTimeDesc` 用**同一判据**；红圈用 **`box-shadow` 铺两层**（图 + 卡片），读 inline style 且**只比 RGB 三元组**（alpha=1 被规范化成 `rgb()`）。
- **后台预测量是脚本里唯一「没开窗也发请求」的地方** ⇒ 四条安全阀 + `Allvalue.sniffPreMeasure` 开关；缓存唯一读点在 `resolveSizes`。

## 常用语数据源（腾讯文档）
- 入口 `Allvalue.commonPhrasesUrl`；分流**只在** `MainPanel.loadPhrasesData` 的 `requestUrl` + `parseResponse`（其余 onload/缓存/日志共用）。解析器 `src/lib/phrasesDoc.ts`（纯函数零依赖）。
- 接口 `GET /dop-api/opendoc?id=<ID>&normal=1&outformat=1&noEscape=1`，**必须带 Referer**。切分规则（用户指定）：**一级标题 = 标题，其下文本 = 正文，第一个一级标题之前整段丢弃**。
- 快照三坑：① `bl` 恒等于全文长度 ⇒ **只有 `bi` 能定位**（且指向内容首字符）；② 样式名要去 `{ty:'ms'…style:{<id>:{name:{val}}}}` 查（⚠️ `name` 是**对象**），`000002`=`heading 1`；③ 超链接是 Word 字段 `\x13…\x14…\x15`，需去重 + 清控制符（正则走 `String.fromCharCode`，否则 `no-control-regex`）。
- **不支持 `/aio/`**（`errcode 999` / `retcode 12607`）；匿名能看页面 ≠ 匿名能调正文接口，不绕权限、不塞 Cookie。
- 6 条断言：`docPhrasesSwitchOk` / `HitOk` / `RefererOk` / `TitlesOk` / `BodyOk` / `NoPreamble`。

## 表情包中继缓存
- 清单单一来源 `relay-server/emoji-sources.json`（两端 import，web 侧要改 vite `fs.allow`）；`emoji-store.js` 的 env **在 require 时读**（fixture 必须赶在 require 前设）；缓存目录 `relay-server/data/`（.gitignore ⇒ 跨部署保留）。
- 「中继优先、CDN 兜底」：`EmojiItem.path` = `/emoji/<合集>/<名>`，缓存键 = `path || url`；**4 处取图入口都要传 `it.path`**（漏传静默走 CDN）。证据：`cdn===0` + `emojiNotInFilesOk`。

## 中继与部署
- 服务器 = **极点云-HK**（`45.207.199.216:65000`，OneSSH host 名 `极点云-HK`）。容器 `znhd`（`1panel/node:25.9.0`）端口 `5689`；代码根 `/opt/znhd-service`。
- 反代 = **1Panel openresty 容器**（不是宿主机 nginx）；站点块 `/opt/1panel/1panel/www/conf.d/znhd.122050.xyz.conf`；**http 级 `proxy_read_timeout 3600s`** 在 openresty `conf/nginx.conf:49`（放宽 maxwait 前先重查）。
- `deploy.yml` 硬编码 `DEPLOY_PATH` / `CONTAINER_NAME` + 安全阀。`/health` 的 `version` 是「线上跑哪个 relay」最快一招；⚠️ 部署脚本**只校验 relay 版本**，脚本端看 `dist/znhd.user.js` 的 `@version`。

## UI 与排查
- 图标一律内联 SVG（Win7 无 emoji 字体）；`@ant-design/icons` **props 不收 `style`**（TS2322）⇒ 挂外层 span。
- 图片写剪贴板只能 `unsafeWindow.navigator.clipboard.write` + `ClipboardItem`（`GM_setClipboard` 仅文本）。
- UI bug **不要读代码猜**，连真机量 `getComputedStyle` / `getBoundingClientRect` / `elementFromPoint`；测 React 合成事件**分两拍**；浮层一律挂 `documentElement`（税务页 body 有 transform）。
- 冒烟：坐标/真实鼠标类断言**点击前必须先清场**（关掉其它 `.ant-modal-close` / `.ant-drawer-close`，同屏 Modal z-index 都是 1000000）。判「是不是本次引入」用 `git worktree add --detach HEAD` 隔离复跑，别 stash。

## 冒烟六个「假红」陷阱（写断言前先对一遍）
1. `checkPass` 是 `!!report[key]` ⇒ **`CHECKS` 里不能写 `'xxx>0'`**（恒 `undefined`），带比较符一律让页面产出布尔字段。
2. `querySelectorAll('*')` 找文本，第一命中常是 `<body>` ⇒ 取**最深**那个。
3. 向上爬祖先**别用 `querySelector('input')` 一把抓**（会先命中 `<input type="time">`）⇒ 只认**带 placeholder** 的。
4. `document.body.innerText` 受遮罩影响 ⇒ 改读目标容器 `textContent`（如 `.ant-drawer-body`）。
5. **antd Tooltip 的正文不在 DOM 里**（hover 才生成浮层）⇒ 观测点只能是**点一下按钮**走 `GM_setClipboard`（该桩已记录到 `window.__gmClipLog`）。
6. 断言读取时机**不能晚于元素消失** ⇒ 在还开着那一刻记快照（`__xxxSeen`），断言只读快照。
- 另：`verify:web` 的「表情面板展开」是**偶发假红**（异步清单 300ms 内可能没渲染完），单独重跑即绿；先看 `git status` 里 `web/` 有没有改动再定性。
