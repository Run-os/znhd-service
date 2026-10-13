# znhd-service 项目长期记忆

> 细节以 `AGENT.md`（内部约束/踩坑索引）与 `ReadMe.md`（对外）为准；此处只留「下次开工必须先知道的硬规矩」。

## 硬规矩
- 三块：`znhd.user.js`（税务页油猴脚本，自建宿主 + React 19 + antd v6；宿主 id 见 `src/lib/ui/panelIds.ts`）、`relay-server/`（零依赖中继；手机页 = `web/` 构建产物，托管 `/u/<deviceId>`）、`src/lib/*` 业务。
- **版本号 `YY.M.D-vN`**（改动当天真实日期 + 当天第 N 次）。油猴**三写**：`config/common.meta.json` / `package.json` / `package-lock.json`；relay 独立版本。
- **未经明确许可绝不 `git push`**（push 即部署）。文档三处同步：`ReadMe.md` / `AGENT.md` / `changelogs/2026-10.md`（最新在最上）；**改代码后必须回查 ReadMe**。
- 产物头部两条不能破：① `// ==UserScript==` 必须第一行；② 元数据块后带 `// @ts-nocheck`。`getBanner` 与 `uiReset.ts` 注释里**绝不能出现反引号**（截断模板 ⇒ TS1005）。
- 门禁 = `typecheck` + `lint` + `build` + `verify`（smoke/relay/web 三段全绿）。⚠️ `verify` 约 **2 分 10 秒**，前台 Bash 会被 120s 超时截断（SIGTERM/空输出）⇒ 一律后台跑。

## Git 合并
- 本仓用 GitHub「Rebase and merge」⇒ 合进 main 后本地分支显示「n 领先 / n 落后」的**幽灵重复**（committer 变成 GitHub 账号）。判据 = 同 patch-id + `git diff <分支tip> <main tip>` 为空，**别急着重合代码**。
- 清理：备份标签 → **在 `origin/main` 上** rebase → 解冲突（changelog 取并集；`relay-server/public/*` 取 origin 侧并 `git rm` 过期 hash）→ `build:web` + `build` → verify。追加修复用 `--fixup` + `rebase -i --autosquash`。
- `workbuddy/*` 分支不能 `git branch -d`（被 WorkBuddy worktree 占用）⇒ 只删远端。

## 传输助手（微信桌面版暗色；现行 v26.10.13-v10）
- 入口 = 主面板一行 4 个（设置/常用语/传输助手/图片嗅探）；三栏 = `TransferNavRail`（对话 key 仍 `devices` / 文件 + 底部设置·企业信息）→ `TransferSessionList` → 第三栏（`TransferDeviceChat` / `TransferFilesView`）。⚠️ **Agent 能力（第一栏 Agents 入口 + 技能/定时任务控件 + Agent 对话第三栏 + `lib/agent/`）已于 v26.10.13-v9 整体删除**，公共件 `MarkdownBody` 已从 `ui/agent/` 移到 `ui/`。
- **圆角 + 层级（v26.10.13-v10，用户 excalidraw 白板稿）**：圆角唯一入口 `wechatTheme.ts` 的 `RADIUS`（window 14 / panel 10 / card 12 / control 8）；外框大圆角 = ConfigProvider `borderRadiusLG`（子弹窗同族）；第二三栏包在 `.znhd-transfer-content` 内嵌圆角卡片里（右缩进 10 / 下缩进 8 露 `WECHAT.frame`），第一栏贴满窗口高度；输入区（`ChatComposer`）是四边留白 12px 的圆角浮起卡片（**全边框不能删**——冒烟 `panelBordered` 判 `borderTopWidth>0`）。冒烟 `transferLayeredOk` 守全部几何量。
- 配色唯一入口 `wechatTheme.ts` 的 `WECHAT`（rail #2E2E2E / list #252525 / chat #1E1E1E / 关闭红 #E81123）；窗口主色微信绿 #07C160 且固定暗色；尺寸改 `TransferAssistantModal` 的 `width` + body `height` 两处；子弹窗一律 `centered`；窗口识别用 `.ant-modal.znhd-transfer-modal`。⚠️ antd v6 Modal 容器类名是 **`.ant-modal-container`** 且 `styles` 无 content 键。
- 第一栏选中态判据 = **`aria-current="page"`**（暗色算法会把 #07C160 算成 rgb(9,167,85)，按 hex 猜必假红）。聊天共用件：`ChatScroll` 的 **`minHeight:0` 硬性**；气泡方向用 `flexDirection` + 根节点 `data-side`；用户气泡实心 ⇒ `MarkdownBody` 传 `inverted`；`autoSize{2..6}` 与 `lineHeight:'20px'` 成对。
- `lib/transfer/store.ts` 模块级单例（窗口不开也收件），消息变更要带 `persistSoon()`（IndexedDB，7 天 TTL）。归组按发送者 `phoneId → item.from → sessionKeyForIncoming`；聚合会话在线态用 `sessionSendable()`；手机页**三条**发送路径都要带 `phoneId`。设置隔离在 `scriptCat_TransferSettings`。
- 表情面板（仅脚本端）：点一张直接发送；悬停 0.5s 放大（用网格 `mousemove` 委托）；两条自动收起都自己实现（点选不触发 `onOpenChange`；点外部靠自挂 `document` 捕获 mousedown 且**排除触发按钮**）；判「已收起」不能只看 `ant-popover-hidden`。
- 手机页 `web/` 与脚本端第三栏同款暗色，**改 `web/` 必须 `build:web`**；版本链 = `relay-server/package.json` → vite `__APP_VERSION__`。

## 图片嗅探按会话分组（v26.10.13-v8）
- 分工：`lib/sniffer.ts` 仍是**不碰页面的纯函数**（只加 `urlFileStem` + 候选的 `stem`）；归属/分桶/持久化全在 `lib/sniffConv.ts`。
- 归属判据：`unsafeWindow.document` 的 `#app.__vue__`（当前会话 + `chat.messageList`；其它会话走 `allChat.historyMsg`，**嵌套结构无实测样本**，靠 `walkAny` 宽容遍历兜）；会话名 DOM 兜底 `.group-item.selected .company-name`。**按文件名主干匹配，不按 DOM 位置**。
- 持久化 `scriptCat_SniffConvIndex`（只记映射不记 URL，按 origin 分桶 / 30 天 / 2000 条）。排序：当前会话置顶 → 其余按消息时间 → 未归属殿后；**没有具名会话就不画组头**（退回平铺）。分组容器挂 `data-sniff-group` / `-name` / `-current` 钩子。

## 中继与部署
- 端口 `PORT||5689`；nginx `proxy_pass http://127.0.0.1:5689`（znhd.122050.xyz）。`deploy.yml` 定式：脚本内硬编码 `DEPLOY_PATH` / `CONTAINER_NAME` + 安全阀（根因：ssh-action 不注入顶层 env）。诊断：`Connection refused (111) upstream 5689` = relay 未监听。反相通道改一侧必须同步评估另一侧。

## UI 与排查
- 图标一律内联 SVG（Win7 无 emoji 字体 ⇒ U+1F300+ 是豆腐块），走 `src/lib/ui/icons.tsx`；⚠️ `@ant-design/icons` 组件 **props 不接受 `style`**（TS2322）⇒ 挂外层 span。面板按钮容器查询阈值 `PANEL_CSS` 65px 与图标字号/标签字数耦合，改任一个都要回算。
- 写图片到剪贴板只能 `unsafeWindow.navigator.clipboard.write` + `unsafeWindow.ClipboardItem`（`GM_setClipboard` 只支持文本，传 Blob 假成功）。图片压缩：SVG / GIF / webp 原样直传，HEIC 走 heic2any 转 JPEG，失败回退原图。
- 排查：UI 层 bug **不要读代码猜**，连真机量 `getComputedStyle` / `getBoundingClientRect` / `elementFromPoint`；测 React 合成事件要**分两拍**（`setState` 异步）；判「选中/状态」用语义属性。浮层一律挂 `documentElement` 下的自建宿主（税务页 body 有 transform）。手机端「连不上」多数是部署/网络层，先要服务端 `[连接]` 日志。
- 冒烟：**坐标 / 真实鼠标类断言点击前必须先清场**（先关掉除被测窗外的 `.ant-modal-close` / `.ant-drawer-close`）——同屏多个 Modal 的 z-index 都是 1000000、DOM 靠后者压顶，`elementFromPoint` 会取到底下的元素 ⇒ 断言恒红（v26.10.13-v9 实测，HEAD 上同样复现）。判「这条红是不是本次引入」用 `git worktree add tmp/head-wt --detach HEAD` + junction 链 `node_modules` 隔离复跑，别 stash 工作区。
