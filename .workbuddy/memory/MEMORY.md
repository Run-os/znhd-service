# znhd-service 项目长期记忆

> 细节以 `AGENT.md`（内部约束/踩坑索引）与 `ReadMe.md`（对外）为准；此处只留「下次开工必须先知道的硬规矩」。

## ⚠️ 传输通道：WebSocket 与技术选型（2026-10-14 实测更正）

- **脚本端为什么用长轮询**：`server.js:21` / `relay.ts:9` / `ReadMe.md:230` 三处都写「长轮询而非 WebSocket 是为了绕过税务页 CSP 的 connect-src」。**这条仍然成立**（脚本端在税务页里，裸 ws 会吃 CSP）。
- **但「隔离世界仍吃 connect-src」是错的**（我 2026-10-14 一度误判，已实测推翻）：MV3 `content_scripts` 的 **`ISOLATED` world 发起 WebSocket / EventSource / fetch 豁免页面 CSP**；`MAIN` world（`@grant none`）才被拦。实测脚本 + 结论见 `outputs/csp-ws-probe/`（Chrome 154，真 101 握手，服务端独立取证）。
- **测量陷阱**：隔离世界与主世界是**两个 window 对象** → content script 写 `window.__X__` 主世界 `page.evaluate` 读不到；必须用 `document.dispatchEvent(new CustomEvent(...))` 跨世界回传。
- **隔离世界只绕 CSP，不绕 CORS**（跨域 fetch 仍需服务端给 CORS）。**CSP+CORS 双绕的只有 `GM_xmlhttpRequest`（background 上下文发起）**。
- **Tampermonkey 实际注入哪个 world 未实测**（MV3 下走 `userScripts` API 的 `USER_SCRIPT` world）。要确证只能在真机跑一行 `new WebSocket('wss://…')`。
- **落地结论不变**：即便 ws 技术可行，也不换 —— 换 ws 要手写 Node WS 帧解析（**破 relay 零依赖红线**），而 **`notify()`（服务器主动结束长轮询）用零依赖拿到同样的亚秒级推送**。轮询优化走 P2 + P0-a/b → P1 + P0-c + P5（见 `2026-10-14.md`）。

## 硬规矩
- 三块：`znhd.user.js`（税务页油猴脚本，自建宿主 + React 19 + antd v6；宿主 id 见 `src/lib/ui/panelIds.ts`）、`relay-server/`（零依赖中继；手机页 = `web/` 构建产物，托管 `/u/<deviceId>`）、`src/lib/*` 业务。
- **版本号 `YY.M.D-vN`**（改动当天真实日期 + 当天第 N 次）。油猴**三写**：`config/common.meta.json` / `package.json` / `package-lock.json`；relay 独立版本。
- **未经明确许可绝不 `git push`**（push 即部署）。文档三处同步：`ReadMe.md` / `AGENT.md` / `changelogs/2026-10.md`（最新在最上）；**改代码后必须回查 ReadMe**。
- 产物头部两条不能破：① `// ==UserScript==` 必须第一行；② 元数据块后带 `// @ts-nocheck`。`getBanner` 与 `uiReset.ts` 注释里**绝不能出现反引号**（截断模板 ⇒ TS1005）。
- 门禁 = `typecheck` + `lint` + `build` + `verify`（smoke/relay/web 三段全绿）。⚠️ `verify` 约 **2 分 10 秒**，前台 Bash 会被 120s 超时截断（SIGTERM/空输出）⇒ 一律后台跑。
- **加冒烟断言必须改两处 + 做反向验证**：`scripts/smoke/znhd-smoke.html`（产出 report 字段，并接进页面 `title` 的 `&&` 链）**和** `scripts/smoke/run.js` 的 **`CHECKS` 数组**。最终判定只认 `CHECKS`；页面 title 是另一条链路且只在报错信息里被引用 —— 只改页面 = 断言形同虚设（v26.10.14-v7 实测踩到：反向验证仍假绿）。**改完必须故意破坏一次确认变红**。反向验证时别绕过 `npm run build`（要写构建戳 `dist/.build-stamp`，否则 verify 以「产物与源码不一致」拒跑）。
- **长轮询的数学前提（讨论任何轮询优化前先记住）**：闭环 ⇒ 一次请求要么「等到消息早返回」要么「等满 maxwait」，返回即重连 ⇒ **请求数 ≈ 时长/maxwait，与消息条数无关**。所以「在长轮询响应里捎带数据」不增加请求数；`notify()`（服务器主动结束挂起请求）也不是新机制（`deliver()` 早就在做）。**唯一会推高请求数的写法是：对不认识新载荷的老客户端做无协商推送**（老客户端遇未知响应会 1s 后重连）⇒ 任何服务器主动推送都必须带协商标记（本项目用 `?phones=1` + `res.__wakeSub`）。

## Git 合并
- 本仓用 GitHub「Rebase and merge」⇒ 合进 main 后本地分支显示「n 领先 / n 落后」的**幽灵重复**（committer 变成 GitHub 账号）。判据 = 同 patch-id + `git diff <分支tip> <main tip>` 为空，**别急着重合代码**。
- 清理：备份标签 → **在 `origin/main` 上** rebase → 解冲突（changelog 取并集；`relay-server/public/*` 取 origin 侧并 `git rm` 过期 hash）→ `build:web` + `build` → verify。追加修复用 `--fixup` + `rebase -i --autosquash`。
- `workbuddy/*` 分支不能 `git branch -d`（被 WorkBuddy worktree 占用）⇒ 只删远端。

## 传输助手（微信桌面版暗色；现行 v26.10.14-v7）
- **在线手机名单的送达（v26.10.14-v7 轮询优化，改传输链路前必读）**：**已删掉 5s `/phone/status` 轮询**（那是 8h 里 5760 次 = 49.4% 的请求）。三条路：① **piggyback** —— `forwardChannel` 的 `opts.decorate(uuid)` 让 `/recv` 的**每个**响应（含 `{empty:true}` 超时）都带 `phones`，脚本端 `onload` 里**必须先消化 `data.phones`、再判 `data.empty`**（否则常态超时响应会把名单丢掉）；② **`notify()` 主动唤醒** —— `createChannel` 新能力，手机上线（heartbeat 的 `if(!wasOnline)`）与下线（5s 清扫判定）各唤醒一次 `{type:'phones'}`，亚秒级；③ **按需查询**（窗口打开）+ **60s 兜底 tick**（`Date.now() - phonesSeenAt < 55000` 就跳过 ⇒ 正常状态零请求；兜底只为**未升级的老中继**）。⚠️ **`phones=1` 协商红线**：中继只唤醒 `res.__wakeSub === true` 的连接，老脚本不带该参数就绝不被唤醒。⚠️ `createChannel(labels, opts)` 是**两参数**，`decorate`/`perRecipient` 都在 `opts` 里（v7 踩过：写进 labels 静默失效）；`deliver` 的 3 处 + `handlePoll` 超时的 1 处响应**统一走 `reply()`**，漏一处就是「有时不捎带」的缝隙。改动后 relay 端 5 条 + 浏览器端 4 条断言守。
- 入口 = 主面板一行 4 个（设置/常用语/传输助手/图片嗅探）；三栏 = `TransferNavRail`（对话 key 仍 `devices` / 文件 + 底部设置·企业信息）→ `TransferSessionList` → 第三栏（`TransferDeviceChat` / `TransferFilesView`）。⚠️ **Agent 能力（第一栏 Agents 入口 + 技能/定时任务控件 + Agent 对话第三栏 + `lib/agent/`）已于 v26.10.13-v9 整体删除**，公共件 `MarkdownBody` 已从 `ui/agent/` 移到 `ui/`。
- **圆角 + 层级（v26.10.13-v10 用户 excalidraw 白板稿；v26.10.14-v1 露出层与第一栏同色）**：圆角唯一入口 `wechatTheme.ts` 的 `RADIUS`（window 14 / panel 10 / card 12 / control 8）；外框大圆角 = ConfigProvider `borderRadiusLG`（子弹窗同族）；第二三栏包在 `.znhd-transfer-content` 内嵌圆角卡片里（右缩进 10 / 下缩进 8），第一栏贴满窗口高度；⚠️ **v26.10.14-v1 起卡片露出层 = Modal body 底色 = `WECHAT.rail`（#2E2E2E，与第一栏/标题条同色）**——用户明确要求最下面不与第一栏有色差断层（v10 曾露 `WECHAT.frame` #383838，已改）；输入区（`ChatComposer`）是四边留白 12px 的圆角浮起卡片（**全边框不能删**——冒烟 `panelBordered` 判 `borderTopWidth>0`）。冒烟 `transferLayeredOk` 守全部几何量 + `frameMatchesRail`（容器底色 === 第一栏底色，同色比较不写死 hex）。
- 配色唯一入口 `wechatTheme.ts` 的 `WECHAT`（rail #2E2E2E / list #252525 / chat #1E1E1E / 关闭红 #E81123）；窗口主色微信绿 #07C160 且固定暗色；尺寸改 `TransferAssistantModal` 的 `width` + body `height` 两处；子弹窗一律 `centered`；窗口识别用 `.ant-modal.znhd-transfer-modal`。⚠️ antd v6 Modal 容器类名是 **`.ant-modal-container`** 且 `styles` 无 content 键。
- 第一栏选中态判据 = **`aria-current="page"`**（暗色算法会把 #07C160 算成 rgb(9,167,85)，按 hex 猜必假红）。聊天共用件：`ChatScroll` 的 **`minHeight:0` 硬性**；气泡方向用 `flexDirection` + 根节点 `data-side`；用户气泡实心 ⇒ `MarkdownBody` 传 `inverted`；`autoSize{2..6}` 与 `lineHeight:'20px'` 成对。
- `lib/transfer/store.ts` 模块级单例（窗口不开也收件），消息变更要带 `persistSoon()`（IndexedDB，7 天 TTL）。归组按发送者 `phoneId → item.from → sessionKeyForIncoming`；聚合会话在线态用 `sessionSendable()`；手机页**三条**发送路径都要带 `phoneId`。设置隔离在 `scriptCat_TransferSettings`。
- 表情面板（仅脚本端）：点一张直接发送；悬停 0.5s 放大（用网格 `mousemove` 委托）；两条自动收起都自己实现（点选不触发 `onOpenChange`；点外部靠自挂 `document` 捕获 mousedown 且**排除触发按钮**）；判「已收起」不能只看 `ant-popover-hidden`。
- 手机页 `web/` 与脚本端第三栏同款暗色，**改 `web/` 必须 `build:web`**；版本链 = `relay-server/package.json` → vite `__APP_VERSION__`。
- **任意文件互传（v26.10.14-v6 / relay v2）**：载荷 `{name,mime,data(base64)}` **格式无关 ⇒ 加文件通道不改协议**，只按 mime 分流：`image/*` → `type:'image'`，其它 → `type:'file'`（缺 mime 兜底图片，兼容老手机页）。中继 `MAX_BODY` 12MB → **100MB**，脚本端 `RELAY_MAX_BODY` 必须与中继同步。⚠️ **100MB 带来内存风险** ⇒ 中继新增 **`MAX_QUEUE_BYTES = 256MB`** 字节预算：`createChannel` 的 `queueBytes` 累计 + `itemBytes(it)`，**所有出队路径统一走 `removeAt(q,i)`**（sweepExpired / dropExpired / deliver 的 shift 与 splice / enqueue 丢最旧）——漏一处减账 = 预算虚高、内存不回收。三端渲染：脚本端 `sendFilesToSession`（**不压缩**，只 `readAsDataURL`）/ 文件气泡 `data-transfer-file-bubble` / 全部文件文件卡片 `data-transfer-file-card`；手机页 `onPickFiles` + `.znhd-chat-file` 卡片。工具栏「附件」占位已改成可用「文件」按钮（`chatComposerOk` 断言 `['表情','图片上传','文件']`）。
- **嗅探缩略图 5 列（v26.10.14-v6）**：`SniffModal` 网格 `repeat(5,minmax(0,1fr))` + `width 828`（720 的 +15%）。5 列后单元格图 138×138、按钮条 50×26（下载/打印**两个**图标，非 74px）；`sniffImgActionsOk` 的 `inside`/`bottomRight` 仍满足，改任一项要回算这两条几何断言。

## 图片嗅探按会话分组（v26.10.13-v8）
- 分工：`lib/sniffer.ts` 仍是**不碰页面的纯函数**（只加 `urlFileStem` + 候选的 `stem`）；归属/分桶/持久化全在 `lib/sniffConv.ts`。
- 归属判据：`unsafeWindow.document` 的 `#app.__vue__`（当前会话 + `chat.messageList`；其它会话走 `allChat.historyMsg`，**嵌套结构无实测样本**，靠 `walkAny` 宽容遍历兜）；会话名 DOM 兜底 `.group-item.selected .company-name`。**按文件名主干匹配，不按 DOM 位置**。
- 持久化 `scriptCat_SniffConvIndex`（只记映射不记 URL，按 origin 分桶 / 30 天 / 2000 条）。排序：当前会话置顶 → 其余按消息时间 → 未归属殿后；**没有具名会话就不画组头**（退回平铺）。分组容器挂 `data-sniff-group` / `-name` / `-current` 钩子。
- **v26.10.14-v5 修「同一会话拆成同名两组」**：会话 ID 逐张解析 ⇒ 一半图给真实 `GROUP…`、一半退化成 `name:<名>` 回退键。三层：`AliasTable`（显示名→真实 ID，精确→归一化去括号尾注→**唯一**包含，指向不唯一一律放弃）+ `buildConvContext` **两遍走**（先学别名 + 纠正当前会话 ID，再收集）+ 回退键后置合并（`saveStoredConv` 写时迁移 / `loadStoredConv` 读时纠正 / `groupByConversation` 的 `convKey` 兜底，**三处缺一处就会「重扫又分裂」**）。持久层同桶新增 `aliases`（同 TTL、`MAX_SNIFF_CONV_ALIASES=200`）。⚠️ 反向验证必须让 `AliasTable.add()` 整体空转 —— 只关一层（如 `toConv`）冒烟**仍全绿**（其它层各自也能合并）。

## 嗅探提速：perf 预收 + 下载队列（v26.10.14-v2）
- `lib/snifferPerf.ts`（新）：`app()` 第一行 `startPerfCollect()`——`setResourceTimingBufferSize(20000)` + `PerformanceObserver(buffered:true)` 把资源条目抄进模块级 Map（只收图片 URL、上限 20000）；取值 `decodedBodySize→encodedBodySize→transferSize`。**纯读 performance，零请求零 DOM**。
- `lib/sniffer.ts`：`add()` 收集时即 `perfBytesOf(url)` 挂字节数 ⇒ `probeOne` 第一档命中，**零 HEAD**；perf 路 = 预收 Map（主力）+ 实时读表（兜底）并集。`downloadBatch` 两段式下载（预取并发 4/背压 8/连败 3 次降并发/退避重试/401·403·404·410 不重试；触发段串行 + 间隔），`SniffModal`「下载所选」走它。
- 冒烟 `sniffPerfFirstOk`：同源真加载的 `/sniff-perf.png`（server.js 路由，精确 22528 B）必须走「资源表读数」且 `__gmXhrLog` 零请求；⚠️ **跨域假域名（sniff-smoke.test）的图 DNS 就失败、根本不进资源表**——验 perf 必须用同源真图。
- **v26.10.14-v4 起「测量」也提前到后台**（用户指定，明知代价）：`lib/snifferPre.ts` 启动 5s 首轮 + 每 60s 一轮，结果进 `lib/snifferCache.ts`（进程内、不落盘、**失败也记**）；`resolveSizes` 命中即免请求（**唯一读点**，UI 零配合）。⚠️ **这是脚本里唯一会在「没开嗅探窗」时发请求的地方** ⇒ 四条安全阀（零成本项先测 / 单轮网络 60 张 / 并发 2 / 后台 CSS 遍历上限 1200）+ 开关 `Allvalue.sniffPreMeasure`（默认开，设置里可即时关）。`SNIFF_EXCLUDE_SELECTOR` 已下沉到叶子 `ui/sniffSelector.ts`。冒烟 `sniffPreMeasureOk` = 开窗前已测量 + 开窗后不重发（两条缺一不可）。

## 表情包中继磁盘缓存 + 不进全部文件（v26.10.14-v3 / relay 26.10.14-v1）
- 清单单一来源 `relay-server/emoji-sources.json`（脚本端/手机页都 import；web 侧 `vite.config.ts` 的 `server.fs.allow` 要加 `../relay-server`，引用路径是三级 `../../../`）。
- 服务端 `relay-server/emoji-store.js`：env **require 时**读（`ZNHD_EMOJI_SOURCES`/`ZNHD_EMOJI_DIR`，fixture 必须赶在 require server.js 前设）；listen 回调触发 `ensureAll()` 后台预热（不阻塞，冷启动 packs.json 同步等预热）；清单 24h TTL、按需补图 single-flight、refresh 限流 60s；`urlAllowed` 仅 https + 回环 http（防 SSRF）。缓存目录 `relay-server/data/`（.gitignore ⇒ `git clean -fd` 不清 ⇒ 跨部署保留）。
- 两端「中继优先、CDN 兜底」：`EmojiItem.path` = `/emoji/<合集>/<文件名>`，blob 缓存键 = `path || url`；对中继清单 path 做严格正则校验（中继地址用户可配，不校验等于替中继打探任意 URL）。`EmojiPackPanel` 4 处取图入口（缓存命中/分批/pick/hover）都要传 `it.path`——漏传静默走 CDN 且缓存键不同（重复下载）。
- 需求①五处链路：手机页 `sendEmoji` 载荷 `emoji:true` → relay `parseItemBody` → 脚本端 `relay.ts onImage` → `store.addMessage` → `TransferFilesView` 只过滤文件视图（`messages.filter(m=>!m.emoji)`，聊天照常显示）。
- 冒烟证据：中继优先 ⇒ 兜底零触发（`cdn===0` / 零外部请求）；`emojiNotInFilesOk` 钉死过滤。

## 中继与部署
- 端口 `PORT||5689`；nginx `proxy_pass http://127.0.0.1:5689`（znhd.122050.xyz）。`deploy.yml` 定式：脚本内硬编码 `DEPLOY_PATH` / `CONTAINER_NAME` + 安全阀（根因：ssh-action 不注入顶层 env）。诊断：`Connection refused (111) upstream 5689` = relay 未监听。反相通道改一侧必须同步评估另一侧。

## UI 与排查
- 图标一律内联 SVG（Win7 无 emoji 字体 ⇒ U+1F300+ 是豆腐块），走 `src/lib/ui/icons.tsx`；⚠️ `@ant-design/icons` 组件 **props 不接受 `style`**（TS2322）⇒ 挂外层 span。面板按钮容器查询阈值 `PANEL_CSS` 65px 与图标字号/标签字数耦合，改任一个都要回算。
- 写图片到剪贴板只能 `unsafeWindow.navigator.clipboard.write` + `unsafeWindow.ClipboardItem`（`GM_setClipboard` 只支持文本，传 Blob 假成功）。图片压缩：SVG / GIF / webp 原样直传，HEIC 走 heic2any 转 JPEG，失败回退原图。
- 排查：UI 层 bug **不要读代码猜**，连真机量 `getComputedStyle` / `getBoundingClientRect` / `elementFromPoint`；测 React 合成事件要**分两拍**（`setState` 异步）；判「选中/状态」用语义属性。浮层一律挂 `documentElement` 下的自建宿主（税务页 body 有 transform）。手机端「连不上」多数是部署/网络层，先要服务端 `[连接]` 日志。
- 冒烟：**坐标 / 真实鼠标类断言点击前必须先清场**（先关掉除被测窗外的 `.ant-modal-close` / `.ant-drawer-close`）——同屏多个 Modal 的 z-index 都是 1000000、DOM 靠后者压顶，`elementFromPoint` 会取到底下的元素 ⇒ 断言恒红（v26.10.13-v9 实测，HEAD 上同样复现）。判「这条红是不是本次引入」用 `git worktree add tmp/head-wt --detach HEAD` + junction 链 `node_modules` 隔离复跑，别 stash 工作区。
