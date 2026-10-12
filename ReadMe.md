# 征纳互动人数和在线监控 v2

[![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=flat-square&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/Run-os/znhd-service)

## 项目简介

**征纳互动人数和在线监控** 是一个油猴用户脚本（UserScript），用于实时监控 [征纳互动平台](https://znhd.hunan.chinatax.gov.cn:8443/) 的等待人数和在线状态。当有纳税人等待时自动语音播报提醒，支持自定义常用语快速回复，帮助坐席人员及时响应。

### 核心特性

- **实时人数监控**：每 3 秒自动检测等待人数，有人等待时语音播报提醒
- **掉线检测**：自动检测平台掉线弹窗，及时语音告警
- **语音播报**：基于 Web Speech API，支持一键开关，带语音队列管理避免播报冲突
- **常用语管理**：从远程 YAML 配置文件加载常用语，数据源地址可在设置面板自定义，支持关键字搜索过滤，一键复制并填入 TinyMCE 编辑器；内置 2 小时本地缓存，相同数据源在有效期内打开弹窗不再重复请求
- **工作时间限定**：仅在工作时间段（默认上午 9:00-12:00，下午 13:30-18:00，可在设置面板调整）内执行监控，非工作时间自动暂停
- **传输助手（手机 ↔ 电脑互传）**：主面板「传输助手」打开独立三栏窗口（v26.10.12-v4 起对齐**微信桌面版暗色**；v5 起标题条与第一栏同色、窗口整体放大 20%，v26.10.13-v1 起再缩小 10%）：顶部**标题条**右侧是自绘**关闭按钮**（悬浮变红）；**第一栏**窄图标导航（顶部 logo，下面对话 / Agents / 文件，底部设置 / 企业信息，只放图标不显示文字）；**第二栏**搜索框 +「+」按钮 + 会话列表；**第三栏**按选中会话聊天。手机扫码或打开本机专属链接上传（前端自动压缩），内容经中继服务器转发到本机并按设置自动弹出窗口；图片在会话里点「复制到剪贴板」即可在征纳互动 Ctrl+V 粘贴；每台电脑有稳定独立的设备 ID，A、B 各自链接互不影响；**会话记录持久化在本机**（IndexedDB，仅保留最近 7 天，超期自动清理）；手机端页面 v26.10.12-v5 起改为与第三栏同款的**聊天窗**
- **网页图片嗅探**：主面板「图片嗅探」一键扫描当前网页上的图片（普通图片与懒加载属性、CSS 背景图；内联 SVG 也在采集范围内，但默认被后缀规则排除），按体积分组展示，可放大预览、单张下载、批量下载，或按 A4 版式打印（每张缩略图**右下角的图标按钮**「下载 / 打印」鼠标移上去才出现，悬停时用提示文字说明）；最小体积阈值（默认 20 KB）可在面板内调整并记住（小于阈值的图只被过滤，不显示也不参与全选/批量下载），大小未探明的图片折叠保留不丢；名字含 `znhd-sniff` / `user-woman` / `user-man` 或以 `.svg` 结尾（含内联 SVG）的图片在扫描阶段即被排除（面板显示排除计数）
- **内置 AI 助手（Agent）**：在「传输助手」第一栏点 **Agents**，直接在右侧主聊天区打开对话（不再有独立弹窗）：可对话提问、在第二栏会话列表里切换 / 删除多个历史对话（刷新网页后仍能接回）；第二栏顶部还有**技能 / 定时任务**两个控件——点哪个，第三栏就显示哪个（盘点与卸载 ScriptCat 技能、创建 crontab 定时任务，到点在后台执行、关掉网页也照跑），新建对话用搜索框旁的「**＋**」；对话历史存在 ScriptCat 本地存储（OPFS）里，关掉窗口不会丢。**需要 ScriptCat v1.4 及以上**——其它脚本管理器（如 Tampermonkey）里打开后会说明不可用的原因
- **操作日志**：面板内嵌日志查看器，按类型（信息/警告/成功/错误）着色显示
- **提示音反馈**：复制常用语时播放提示音，提供操作确认

## 项目结构

```
znhd-service/
├── config/                       # 构建配置（模板：Eished/douyu-helper）
│   ├── common.meta.json          # 脚本元信息唯一来源（@version/@grant/@require/@updateURL…）
│   ├── dev.meta.json             # 开发态元信息覆盖（-dev 名、localhost 调试）
│   └── webpack.config.base.js / webpack.dev.js / webpack.prod.js
├── public/
│   ├── commonPhrases.yaml        # 常用语配置文件（YAML 格式）
│   ├── dida.mp3                  # 操作提示音文件
│   └── index.html                # 本地调试宿主页（webpack-dev-server）
├── src/                          # 脚本源码（改代码改这里）
│   ├── index.ts                  # 入口：生产直接启动 / 开发态热重载
│   ├── app.ts                    # 装配：创建面板 → 面板位置跟踪 → 卸载清理 → 启动监控
│   └── lib/                      # 业务模块
│       ├── constants / logger / storage / state / utils
│       ├── speech（语音队列）/ monitor（人数·掉线·工作时间）
│       ├── tinymce / clipboard（提示音+安全复制）/ relay（中继+图片剪贴板）
│       ├── gallery（下载命名工具）/ changelog（更新日志拉取解析）/ qrcode（二维码）
│       ├── sniffer（网页图片嗅探：DOM/CSS/资源表三路采集 + 体积测量阶梯）
│       ├── agent（ScriptCat Agent 接入：types 类型契约 / api 是 UI 唯一入口：能力探测、
│       │                        流式消费、技能与定时任务包装 / sessions 会话清单：官方没有
│       │                        list·delete，故本地自记索引）
│       ├── transfer（传输助手业务层，v26.10.12-v1）：store.ts 收发单例（会话/消息/未读/
│       │           在线手机轮询，窗口不开也照常收件）+ settings.ts 自有设置 + types.ts
│       │           + persist.ts（v26.10.12-v5：IndexedDB 持久化 + 7 天 TTL 自动清理）
│       └── ui/                   # MainPanel（主面板：设置/常用语/传输助手/图片嗅探 四个入口）
│                                 #   + SettingsModal / PhrasesDrawer / LogModal / ChangelogModal /
│                                 #   SniffModal（图片嗅探）/ ImageOverlayActions（悬停动作按钮）/ icons
│                                 #   + panelHost（挂载/拖拽）/ uiReset（样式隔离）/ notify
│           ├── agent/           # Agent 面板的内容件（对话由 transfer/ 的 TransferAgentView 组装）：
│           │                   #   MarkdownBody / SkillsPanel / TaskPanel
│           └── transfer/         # 传输助手 UI（v26.10.12-v1 三栏；v26.10.12-v4 微信桌面版暗色）：
│                                 #   TransferAssistantModal（主窗+标题条）/ TransferNavRail（窄图标导航，
│                                 #     v26.10.12-v5 起图标三态：选中绿填充/hover 方形底板）
│                                 #   wechatTheme.ts（微信暗色色板常量 WECHAT，改配色一律改这里）
│                                 #   TransferSessionList（第二栏：搜索+配对/新建+技能/任务+会话）/ AgentConversationList
│                                 #   TransferDeviceChat（第三栏：设备会话聊天）/ TransferFilesView（全部文件）
│                                 #   TransferAgentView + useAgentChat（Agents 视图）
│                                 #   ChatPanel / ChatBubble / ChatComposer / chatEmojis（设备会话与 Agent 对话
│                                 #     共用的聊天面板件：头部 + 滚动消息区 + 左右气泡 + 底部输入框）
│                                 #   wechatTheme.ts（微信暗色分层色板 + 微信绿主色常量）
│                                 #   TransferPairModal（配对）/ TransferSettingsModal / TransferAboutModal
│                                 #   DeviceIdTag / deviceColors
├── shared/                       # 脚本端与手机上传页共用的纯逻辑/纯 DOM 层（零宿主依赖，约束见 AGENT.md）
│   ├── image/                    # 图片压缩：resizeToJpeg / prepareForTransfer
│   └── preview/                  # 预览宿主 / A4 打印 / 遮罩压制 / 预览动作按钮
├── dist/                         # 构建产物
│   ├── znhd.user.js              # ⚠️ 发布产物（由 npm run build 生成，提交进仓库，勿手改）
│   └── znhd.dev.user.js          # 开发产物（不提交）
├── relay-server/                 # 传输助手配套中继服务（Node，需自行部署到公网）
│   ├── server.js                 # 中继服务器：路由 / 长轮询取图 / 静态资源（纯 Node 内置模块，运行时不装依赖）
│   ├── upload-page.js            # 手机上传页出口：读 public/index.html（缺失时给兜底页）
│   ├── public/                   # ⚠️ 手机上传页构建产物（提交进仓库，勿手改）：index.html + assets/*
│   └── package.json              # 运行时不依赖任何包，运行：node server.js
├── web/                          # 手机上传页应用源码（React 19 + Ant Design v6 + Vite + TS，独立子项目）
│   ├── src/App.tsx               # 聊天窗 UI（v26.10.12-v5：与脚本端第三栏同款，微信暗色气泡 + 底部输入区）
│   ├── src/lib/                  # relay（心跳+长轮询）/ image（canvas 压缩）/ heic（HEIC 懒加载）
│   └── package.json              # npm run build:web → 产出到 relay-server/public
├── scripts/smoke/                # 无头端到端冒烟（puppeteer + GM 桩测试页）：npm run verify
├── package.json / tsconfig.json / .eslintrc.js / .prettierrc.js
├── ReadMe.md                     # 项目说明文档（使用/配置/排障）
└── changelogs/                   # 更新日志唯一来源（按月分文件，如 2026-10.md；脚本内「设置 →[更新日志]」读当月文件）
```

> `CHANGELOG.md` 已于 2026-10-10 冻结为历史档案（截至 v26.10.10-v1 的完整历史），新日志只写 `changelogs/YYYY-MM.md`。

## 快速开始

### 1. 安装油猴扩展

在浏览器中安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [ScriptCat（脚本猫）](https://scriptcat.org/) 扩展。

### 2. 安装脚本

**方式一：在线安装（推荐）**

访问脚本主页 [https://scriptcat.org/zh-CN/script-show-page/3650](https://scriptcat.org/zh-CN/script-show-page/3650)，点击"安装此脚本"按钮。

**方式二：手动安装**

1. 打开 [`dist/znhd.user.js`](dist/znhd.user.js:1) 文件，复制全部内容
2. 点击油猴扩展图标 → 创建新脚本
3. 粘贴内容并保存（Ctrl+S）

### 3. 开始使用

1. 访问征纳互动平台：https://znhd.hunan.chinatax.gov.cn:8443/
2. 脚本自动启动，右下角出现"征纳互动监控"浮动面板
3. 面板显示当前版本号、语音播报开关、设置和常用语入口

### 4. 开发与构建（改源码时）

脚本采用 Webpack + TypeScript 工程化开发（脚手架与 [douyu-helper](https://github.com/Eished/douyu-helper) 一致）。**源码在 `src/`，`dist/znhd.user.js` 是构建产物，请勿直接编辑**（下次构建会覆盖）。

```bash
npm install            # 首次：安装开发依赖
npm run build          # 生产构建：lint 修复 → 输出 dist/znhd.user.js
npm run dev            # 开发构建（watch，输出 dist/znhd.dev.user.js）
npm start              # 启动本地调试页 http://localhost:8080 并 watch（VSCode 里 Ctrl+Shift+B → start & dev）
npm run typecheck      # TypeScript 类型检查（strict）
npm run check          # 产物 + 服务端语法校验
npm run verify         # 无头 Chromium 端到端冒烟（面板/弹窗/传输助手三栏/常用语），CI 也跑这个
```

- **改版本号**：编辑 `config/common.meta.json` 的 `version`（格式 `YY.MM.DD-vN`，**零填充**；`N` 为当天第几次改动，**同一天内只递增 `-vN`、日期部分不动**），产物头部由构建自动生成。
- **本地调试**：`npm start` 后，按 `config/dev.meta.json` 中 `@require` 指向的 `dist/znhd.dev.user.js` 安装开发脚本（需在油猴中允许访问本地文件 URL）；改动 `src/` 会触发目标站点热重载。
- **发布**：push 到 `main` 后，`@updateURL`/`@downloadURL` 指向的 `dist/znhd.user.js`（GitHub raw 直链，不走 CDN 加速）即为最新产物，ScriptCat 自动同步。

## 功能详解

### 监控面板

脚本在页面右下角创建一个可拖拽的浮动面板，包含：

| 元素              | 说明                                                               |
|-------------------|--------------------------------------------------------------------|
| 版本号            | 显示当前脚本版本（如 `v26.10.12`）                                  |
| 🔊 语音 / 🔇 静音 | 一键切换语音播报状态，按钮颜色随状态变化（绿色=开启，红色=静音）   |
| 设置              | 打开设置弹窗，可配置工作时间、常用语数据源地址、CDN 开关，查看日志和脚本链接（中继服务器地址已移至「传输助手 → 第一栏底部设置」） |
| 常用语            | 打开常用语弹窗，加载并搜索常用语                                   |
| 传输助手          | 打开传输助手三栏窗口（手机 ↔ 电脑互传 + Agents）                   |
| 图片嗅探          | 扫描当前网页图片，按体积分组预览 / 下载 / 打印                     |

### 人数监控与掉线检测

- **等待人数检测**：通过 DOM 选择器 `.count:nth-child(2)` 获取当前等待人数
  - 人数为 0：记录成功日志
  - 人数 > 0：触发语音播报"征纳互动有人来了"
- **掉线检测**：检测 `.t-dialog__body__icon` 弹窗元素
  - 发现"掉线"文本时：记录错误日志并语音播报"征纳互动已掉线"
- **工作时间限定**：非工作时间自动跳过检测，节省资源

### 语音播报

- 基于浏览器 `SpeechSynthesis` API，语言为 `zh-CN`，语速 `1.0`
- 内置**语音队列**：多条播报按顺序排队播放，避免同时播放导致冲突
- 静音状态下自动跳过播报，不清空队列
- 开启语音时自动初始化语音合成，解决浏览器 `not-allowed` 限制

### 常用语功能

1. 点击"常用语"按钮打开弹窗，自动从**设置面板中配置的常用语数据源**加载（默认 <https://cnb.cool/bbbbaa/work-about/-/git/raw/main/znhd/commonPhrases.yaml>，可在「设置 → 常用语数据源」处修改地址；仓库里的 [`public/commonPhrases.yaml`](public/commonPhrases.yaml:1) 是同步到该地址的源文件）
2. 支持**关键字搜索**：可按按键名称或内容过滤常用语
3. 点击常用语按钮后：
   - 自动复制文本到剪贴板（优先使用 `GM_setClipboard`，降级到 `navigator.clipboard`）
   - 播放提示音（`dida.mp3`）
   - 将文本追加到页面 TinyMCE 编辑器中（自动处理换行和空输入框场景）
4. 支持"重新加载"按钮手动刷新常用语数据（强制跳过缓存）
5. **本地缓存**：加载成功后缓存数据、数据源 URL 与时间戳；2 小时内再次打开弹窗（且数据源 URL 未变）直接复用缓存、不发网络请求，面板日志会提示「使用本地缓存」；修改数据源地址或点击"重新加载"会重新拉取
6. 常用语数据源地址可在「设置 → 常用语数据源」中自定义：粘贴你自己的 YAML 地址即可让团队使用各自的常用语；修改后需点"重新加载常用语"生效。**清空输入框后不会立即回填**——输入框保持为空，点击其他区域（失焦）后才恢复默认地址，避免用户正要粘贴新地址时被自动填上的默认值打断

### 日志系统

- 设置弹窗内嵌日志查看器，最多保留 20 条记录
- 日志按类型着色：
  - 🔵 信息（info）
  - 🟠 警告（warning）
  - 🟢 成功（success）
  - 🔴 错误（error）
- 自动过滤连续重复日志，避免刷屏

### 更新日志查看

- 面板「设置」→ 在 `[更新脚本]` 旁边的 **[更新日志]** 按钮，点击即在网页正中弹窗展示**最新 10 条**更新日志（右上角 × / ESC / 点空白处均可关闭）
- 日志内容来自 [`changelogs/`](./changelogs/) 目录下的**当月**日志文件（如 `changelogs/2026-10.md`）：脚本运行时用 `GM_xmlhttpRequest` 拉取，遵循设置里的「使用 CDN 加速」开关（开 = jsDelivr，关 = raw.githubusercontent）
- 弹窗底部「获取更多日志」跳转到当月日志文件的网页查看（历史月份见 `changelogs/` 目录）；弹窗底部会提示「共 N 条，已显示最新 10 条」
- 拉取失败（断网 / CDN 不可达）时弹窗内提示具体原因，仍可点「获取更多日志」在浏览器打开

### 传输助手（手机 ↔ 电脑互传）

适用场景：坐席在手机上有纳税人发来的图片（如身份证、资料截图），想快速发到电脑剪贴板，直接在征纳互动聊天框 Ctrl+V 粘贴；也可以把电脑上的文本 / 图片发给手机。

**窗口布局（三栏，v26.10.12-v4 起对齐微信桌面版暗色模式；v26.10.13-v1 起窗口整体缩小 10%（约 1166×756，v26.10.12-v5 曾放大 20%））**：

- **标题条**：窗口顶部横条，**与第一栏同色（#2E2E2E，v26.10.12-v5 按用户要求不再用更淡的 #383838）**，右侧是**自绘关闭按钮**——鼠标悬浮整格变红（Windows 同款交互），点击关闭；点遮罩或按 Esc 也能关。antd 自带的 × 已关掉，关窗路径一条不少。设置 / 配对 / 企业信息等**子弹窗垂直居中**（v26.10.12-v5 起，不再顶着传输助手窗口上沿）。
- **第一栏（窄图标栏）**：微信式侧边栏，**只放图标不显示文字**——顶部 logo（头像位），中部入口从上到下是**对话 / Agents / 文件**（原「设备」已改名「**对话**」并置于 Agents 之上；未读消息数在「对话」图标右上角挂红色角标），底部**设置 / 企业信息**（企业信息里能看到中继地址、本机设备、在线手机、脚本版本，排查「连不上」时先看这里）。图标三态按微信规范（v26.10.12-v5）：
  - **默认**：白色描边线条图标、背景透明、无底色；
  - **选中**：图标变微信绿（只改填充色，**不叠加底板**）；
  - **悬浮（仅未选中项）**：外层出现一块**深色圆角方形底板**（带轻微浮起阴影），图标本身不变；选中优先于 hover——已选中的按钮悬浮只保持绿色图标；
  - 「对话」图标右上角保留**红色圆形未读角标**。
- **第二栏（会话列表）**：顶部**搜索框** + 紧邻右侧的「**+**」按钮，下方是列表。**「+」的含义随第一栏分组变**：**对话**分组下是**配对**入口（手机扫码 / 打开链接即完成配对，配对入口统一收在这里）；**Agents** 分组下是**新建对话**（清空当前视图，发出下一条消息时另起一个对话）；**文件分组没有「+」，且该分组下的条目只作展示——点设备 ID 不会跳去会话窗口（v26.10.12-v5）**。列表条目为微信结构：左头像（设备专属底色首字符 / 聚合会话手机图标，带在线小绿点）、中间名称 + 最后一条消息预览（`[图片]` 或文本摘要）、右侧时间（今天 HH:mm / 昨天 / MM-DD）+ 未读红点角标；**有消息的会话按最后消息时间排在前面，纯在线设备随后**；选中条目用比栏底浅一档的底色高亮。选中 Agents 时这里换成「**技能**」「**定时任务**」两个控件 + 对话列表（点控件第三栏就切成对应面板，点对话卡片回到对话）。
- **第三栏（聊天主区，三栏里最深）**：当前会话的聊天区，未选中时显示空状态「暂无消息」。**设备会话与 Agent 对话用的是同一套聊天面板**（气泡左右分栏 + 底部吸附输入框，见下）。
  - **会话头部（微信式）**：左侧**对方头像 + 会话名称 + 在线状态**；右侧是**垃圾桶图标**（点击弹确认后清空这个会话）。
  - **消息气泡**：收到的（手机发来 / AI 回答）靠左、**微信灰（#2F2F2F）底**，本机发出的靠右、**微信绿（#07C160）底 + 白字**，圆角；头像在气泡外侧。**消息按时间分隔条分组**：间隔超过 5 分钟的一组消息共用一条居中的灰色时间（今天 HH:mm / 昨天 / MM-DD HH:mm），不再逐条标时间（发送中 / 发送失败的状态仍标在气泡下）。**两侧消息都按 Markdown 排版**（加粗 / 列表 / 表格 / 引用 / 代码块 / 链接；单换行原样保留），长文本自动换行。**图片气泡只显示图片本身、按图片自身尺寸显示（宽高比永远保持、完整可见不裁切）**，不拼文件名（文件名在「下载 / 打印」时才用到，按原名与 MIME 自动补扩展名）。
  - **设备会话**：图片消息**单击缩略图放大**（缩放 / 旋转 / 多图左右切换，预览底部工具栏末尾有**打印机图标**，点它用 react-to-print 打印**当前这张图的原图**，按 **A4 纸自适应且不带浏览器页眉页脚**——`@page { size: A4 portrait; margin: 0 }`，边距归零后浏览器没地方画标题/URL/日期，图片离纸边的留白由内容框 padding 提供；整张图等比缩放居中铺满 A4，不裁切、不跨页；⚠️ 打印对话框里的「缩放/适应纸张尺寸」仍会覆盖这个设置，如需完全按 CSS 出纸请把缩放选为 100%/无，对话框弹出期间请勿移除该图）；每张图**右下角**有三个**只显示图标**的按钮，**鼠标移到图片上才出现**，悬停时用提示文字说明：**复制**（把图片写入系统剪贴板，此步必须由一次点击触发，满足浏览器安全策略）→ 去征纳互动 Ctrl+V 即可、**下载**（把原图存为文件，自动按原名/MIME 补扩展名）、**垃圾桶**（红色，单独移除这张消息）。会话头部可一键**清空这个会话**（Popconfirm 二次确认）。
  - **文件视图**（第一栏「文件」）：全部传输过的内容跨会话汇总——图片九宫格 + 文本列表，同样支持放大 / 打印 / 复制 / 下载 / 删除。
  - **底部输入区（微信原版结构，两个面板同一个）**：**固定吸附在聊天区底部、不随消息滚动**；整块是一块比聊天区略浅的实心底（顶部有分隔线）。**工具栏图标行在输入框上面**：**表情 / 图片上传 / 附件**；下面是**多行文本框**，随内容自动增高、到 6 行封顶后改为框内滚动；**右下角是「发送」按钮**（发文本：Enter 发送、Shift+Enter 换行）。选图发送会先加入**待发列表**（点「发送 N 张图片」才真正上传，避免误选即发；逐张压缩后按序投递，带进度条，失败会标出第几张与原因）。
  - ℹ️ 两点如实说明：**「附件」按钮目前置灰**（中继服务只转发图片与文本，没有任意文件通道）；**Agent 侧的「图片上传 / 附件」也置灰**（ScriptCat Agent 的对话接口目前只接受文本）。**「表情」面板给的是 BMP 符号**（☺ ★ ♥ ♪ …）而不是彩色 emoji：目标机器是 Win7，系统里没有 Segoe UI Emoji，彩色 emoji 会渲染成豆腐块（与面板图标一律用 SVG 是同一个原因）。

**工作流程**：
1. 每台电脑首次运行脚本时用 `crypto.randomUUID()` 生成并持久化一个**稳定设备 ID**（存在 `GM_setValue`，刷新/重开不变）；
2. 点第二栏「**+**」打开**配对窗口**：展示本机专属上传链接 `https://<中继服务器>/u/<设备ID>` 及对应二维码（**二维码由脚本端 qrcodejs 本地生成，无需服务器参与**），同时列出**已连接手机的数量与每台手机的设备 ID**（手机首次连接 / 断开都会写进运行日志），并提供**「发送测试图片」**按钮：一键从 `https://t.alcy.cc/fj` 取一张随机图，**当作手机上传**投到中继再回到本机，便于验证「收图 → 放大 → 打印」整条链路（需先配好中继地址）；
3. 手机浏览器打开该链接（或直接扫二维码）→ 进入**聊天窗**（v26.10.12-v5：与脚本端第三栏同款——微信暗色、气泡、底部输入区）→ 点输入区**图片按钮**选图/拍照（**支持多选**）→ 每张立即变成右侧绿色「发送中」气泡，手机端用 canvas 逐张自动压缩（最大边 1600px、JPEG 质量 0.75；**SVG 例外：跳过压缩原样直传**，保留矢量与 `image/svg+xml` 类型；**HEIC/HEIF 例外：手机端用 heic2any（公共 CDN）解码转 JPEG 后同样铺白底压缩直传**，确保电脑端含 Windows 无需额外编解码器即可打开，库缺失时回退原样直传）→ 逐张按序上传到中继服务器（服务端按设备维护 FIFO 队列，内存保护上限 100 条）；**发送状态标在气泡下方**（发送中… / 已发送 / 发送失败+原因），文本在输入框输入后 `Enter` 发送。
4. 电脑端脚本在**传输助手设置**（第一栏底部「设置」）填好中继地址后**默认自动**用 `GM_xmlhttpRequest` **长轮询** `/recv/<设备ID>` 取回内容（无需点击按钮；长轮询而非 WebSocket 是为了绕过征纳互动页面的 CSP 对 connect-src 的限制）；
5. 收到的内容进入对应**会话**；窗口关着时按设置**自动打开传输助手**（默认开，可在设置里关掉——关闭后只累计未读角标，不打扰；窗口已开着则只累加，不强行切换会话）。在会话里点图片右下角「复制」写入剪贴板 → 去征纳互动 Ctrl+V 即可。

**发送到手机（反向）**：在设备会话底部输入区发文本或选图发送。发送目标由**选中的会话**决定：选**具体手机**的会话就只发那一台；多台在线时列表里会出现聚合会话「**手机**」，选中它等于**发给所有在线手机**。每台手机的 ID 都带**边框与专属底色**（同一台设备颜色恒定，不同设备颜色不同，最多 8 色循环），多台并排时一眼能区分是哪一台。手机页面会显示**本机（手机）ID** 与**已连接的脚本端设备ID**，便于和电脑端列出的 ID 对应上是哪一台。图片逐张顺序发送（一张成功再发下一张，保证到达顺序），单张压缩后上限约 12MB，超限即停止并提示已发几张。

**会话归组规则**：正向广播（手机 → 电脑）不带手机 ID，脚本按在线数量归组——**恰好 1 台在线手机时，收到的内容归该机的会话**；多台在线（或无法区分）时归入聚合会话「**手机**」（头部会标注「多台在线时收到的内容归在这里」）。选中一台**在线但无历史**的手机也会合成一条空会话，可直接发起发送（发送侧只要求对方在线，不要求有历史）。

**按用户隔离**：设备 ID 是每台电脑随机生成、几乎不可猜测的 UUID，因此 A 的电脑、B 的电脑各自持有不同链接与二维码，图片只进对应那台电脑，互不串。

**前置条件**：须自行部署配套 `relay-server`（见上方项目结构）。在「传输助手 → 第一栏底部**设置**」填写该服务的公网地址（如 `https://你的服务器:端口`，末尾不带 `/`）后，配对窗口里的链接与二维码才会生成。升级用户无需重填：第一次读取传输助手设置时，会把旧版存在主设置里的中继地址自动迁移过来。

**外观与设置隔离**：传输助手窗口 v26.10.12-v4 起**固定为微信桌面版暗色配色**（分层深浅 + 微信绿主色，嵌套 ConfigProvider 保证暗色算法与主色 token 都不外溢，与主面板、征纳互动页面无关）；它的设置项（中继地址、收到内容是否自动打开、清空全部传输记录）都存在独立的 `scriptCat_TransferSettings`，不写主设置的 `scriptCat_Allvalue`；入口也不共用——主面板设置菜单里不再有中继地址。

**会话持久化（v26.10.12-v5）**：对话内容（**含图片**）保存在本机 **IndexedDB**（数据库 `znhd-transfer`），刷新页面 / 重开浏览器 / 重启脚本后历史还在；**只保留最近 7 天**，超期消息自动删除（启动时、每小时各清理一次），图片 Blob 原样入库、载入时重建预览地址。隐私模式等 IndexedDB 不可用时静默退回纯内存态（行为同 v4），不影响收发。「清空全部传输记录」同时清掉持久化数据。

> 同一台电脑的链接可以被多台手机同时打开（例如家人同事一起用），它们是各自独立的「手机设备」；选中的手机若在发送瞬间恰好离线，内容会在中继保留 **60 秒**，它上线后即可取到。

> **手机页行为（v26.10.12-v5 聊天窗）**：电脑端发送的内容作为**左侧灰色气泡**出现在聊天窗里（图片可点开放大 / **打印**，文本气泡下有「复制」按钮）；手机发出去的图片 / 文本是**右侧绿色气泡**，发送状态（发送中 / 已发送 / 发送失败）标在气泡下方。

### 内置 AI 助手（Agent）

在「传输助手」第一栏点 **Agents**，右侧主聊天区直接打开对话（没有独立弹窗了）。第二栏在 Agents 分组下是：**搜索框 + ＋（新建对话）**，下面紧跟**技能 / 定时任务**两个控件，再往下是对话列表——**点哪个控件，第三栏就显示哪一块内容**（默认是对话）。

1. **对话**：第二栏的**会话列表**把聊过的对话一条条列出来（显示标题与最近时间，当前对话高亮），点一下就切过去，鼠标移到某一条上会出现**删除**按钮（点了还要再确认一次）；**新建对话用搜索框旁的「＋」**。第三栏是聊天区，排版与设备会话**完全一致**（左右气泡 + 头像、底部吸附输入框）：直接输入问题，`Enter` 发送、`Shift+Enter` 换行，回答按流式增量显示；**模型在输入框右下角选择**（列出 ScriptCat 里已配置的模型，默认选中 ScriptCat 的默认模型，就在「发送」按钮左边），回答生成中「发送」会变成**中止**按钮，点一下中断本轮（已收到的内容保留）。回答气泡里若有工具调用会显示成小标签，模型的思考过程折叠在「思考过程」里。**回答按 Markdown 排版显示**（标题、加粗、列表、表格、引用、代码块与链接都正常渲染；`Shift+Enter` 换的行原样保留），自己发出去的消息同样按 Markdown 显示。
2. **技能**（第二栏点「技能」）：只读盘点 ScriptCat 里已安装的技能（名称、版本、启用状态、工具与参考资料数量、更新时间），可**卸载**（有二次确认）。本面板**不提供安装入口**——安装走 ScriptCat 自己的技能市场与管理页，避免和官方流程重复；对话时已启用的技能会自动加载，不需要逐个勾选。
3. **定时任务**（第二栏点「定时任务」）：用 crontab（五段：分 时 日 月 周，本机时区）创建任务，例如 `0 9 * * *` 每天 9 点、`30 8 * * 1-5` 每个工作日 8:30；每个任务可以**立即执行**、**停用/启用**、**删除**，列表里能看到上次/下次运行时间与上次的报错。任务由 ScriptCat 的调度器在后台执行，**关掉窗口或关闭网页都不影响**。

> **前提**：Agent 能力由 ScriptCat v1.4+ 提供（`CAT.agent.*`），脚本需要 `CAT.agent.conversation` / `CAT.agent.model` / `CAT.agent.skills` / `CAT.agent.task` 四项授权。**升级脚本后请在 ScriptCat 里重新安装或允许对应授权**，否则会提示权限不可用；在 Tampermonkey 等其它管理器下没有这套 API，打开 Agents 会直接说明「需要 ScriptCat v1.4 及以上」。

> **对话存在哪**：对话与历史由 ScriptCat 存在本地 OPFS 里；本脚本另外用 `localStorage`（`scriptCat_AgentChats`）记一份**会话清单**（只记对话 ID、标题和时间，不存聊天内容），这样刷新网页后还能从第二栏会话列表接回上次的对话。官方 Agent API 目前只开放「新建对话 / 按 ID 取对话」，没有「列出所有对话」和「彻底删除对话」的接口，所以清单由脚本自己维护：**「删除」是清空该对话的消息并把它从清单里移除**（ScriptCat 里那条空记录不显示也不影响使用），标题取该对话第一条消息的前 30 字。清单最多保留 30 个对话。模型与 API Key 都在 ScriptCat 的 Agent 设置里配置，脚本不接触密钥。

## 配置说明

### 脚本内部配置

[`src/lib/constants.ts`](src/lib/constants.ts:1) 中的 `CONFIG` 对象（只读的运行参数）：

```javascript
const CONFIG = {
    CHECK_INTERVAL: 3000,      // 监控检查间隔（毫秒）
    MAX_LOG_ENTRIES: 20,       // 面板最大日志条目数
    didaUrl: 'https://cnb.cool/bbbbaa/work-about/-/git/raw/main/znhd/dida.mp3', // 提示音文件（cnb.cool raw 直链，非 GitHub 链接 ⇒ resolveGithubUrl 原样返回）
    SPEECH_TIMEOUT: 15000,     // 单条语音播报超时保护（毫秒），防止队列卡死
    MAX_SPEECH_QUEUE: 10,      // 语音队列最大长度，超出丢弃最早
    SPEECH_QUEUE_TTL: 30000    // 语音队列消息有效期（毫秒），入队/播放前剔除过期内容
};
```

可用户配置项（语音开关、工作时间、常用语数据源、CDN 开关、日志自动刷新、嗅探阈值）存放在 [`src/lib/constants.ts`](src/lib/constants.ts:1) 的 `DEFAULTS` 中，运行时存于 `localStorage`（键 `scriptCat_Allvalue`），可在设置面板直接修改，无需改代码：

```javascript
const DEFAULTS = {
    voiceEnabled: true,   // 语音播报开关
    workingHours: {       // 监控时间段（单位：十进制小时，13.5 = 13:30）
        morningStart: 9, morningEnd: 12,
        afternoonStart: 13.5, afternoonEnd: 18
    },
    useCdn: true,         // 使用 CDN 加速（jsDelivr）加载项目内 GitHub 资源（目前实际生效的只有「更新日志」文件）
    // 注意：常用语数据源与提示音自 v26.10.10-v17 起都指向 cnb.cool 的 raw 直链（非 GitHub 链接，
    // resolveGithubUrl 原样返回、不受 useCdn 影响）。仍勿填成网页/仓库页面，否则会拉回整页 HTML 导致 YAML 解析失败。
    commonPhrasesUrl: 'https://cnb.cool/bbbbaa/work-about/-/git/raw/main/znhd/commonPhrases.yaml',
    logAutoRefresh: true, // 「运行日志」弹窗的自动刷新开关（开：新日志持续进来并滚到底；关：冻结快照便于翻看）
    sniffMinKB: 20        // 「图片嗅探」面板的最小图片体积阈值（KB），小于阈值的图不显示也不参与批量下载
};
```

> ⚠️ **中继服务器地址不在这里**：v26.10.12-v1 起它搬到传输助手自有设置（[`src/lib/transfer/settings.ts`](src/lib/transfer/settings.ts:1) 的 `DEFAULT_RELAY_SERVER`，默认 `https://znhd.122050.xyz`），存于独立的 `scriptCat_TransferSettings`，入口在「传输助手 → 第一栏底部设置」。旧版存在 `scriptCat_Allvalue.relayServer` 里的地址仅在本地从未存过传输助手设置时作一次性迁移种子读取，不再写回。

### 常用语配置

常用语配置文件为 [`public/commonPhrases.yaml`](public/commonPhrases.yaml:1)（同步到上面那个 cnb.cool 地址，脚本运行时从该地址拉取），采用 YAML 格式。每个键为按钮显示名称，值为点击后填入编辑器的文本内容。

配置示例：

```yaml
未办理税务登记: |
  【未办理税务登记】
  ●打开 https://etax.hunan.chinatax.gov.cn:8443/xxbg/view/ztxxbg/qssbswzxblwkyqs ，自行打印清税证明
  ●如果上述方法无法正常打印，这边可以给您出具一个未涉税事项证明，需要您通过法人身份登录征纳互动，并将营业执照和法人身份证发送过来

已办理税务登记: |
  【已办理税务登记】
  ●请先和您的税管员取得联系，税管员同意之后，进入电子税务局电脑端，搜索清税申报（税务注销办理）即可，详细操作流程：https://mp.weixin.qq.com/s/JqIEoAqo-BqWqSCrQYGuMQ
```


## 技术栈

| 技术                                                                                 | 用途                                                                                                                               |
|--------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| JavaScript (ES6+)                                                                    | 脚本主语言                                                                                                                         |
| [React 19](https://react.dev/) + [Ant Design v6](https://ant.design/)                | 全部 UI（面板与各弹窗）：组件、主题、消息提示；随产物打包，无第三方运行时请求                                                      |
| [@ant-design/icons](https://github.com/ant-design/ant-design-icons)                 | antd 配套图标（v6）：放大预览工具栏末尾的「打印」图标等；从包根按需导入，可 tree-shaking                                          |
| [react-to-print](https://github.com/MatthewHerbst/react-to-print)                    | 放大预览工具栏「打印」：建隐藏 iframe、等图片加载完再调 `print()` 打印原图（随产物打包）                                             |
| [react-markdown](https://github.com/remarkjs/react-markdown) + [remark-gfm](https://github.com/remarkjs/remark-gfm) + [remark-breaks](https://github.com/remarkjs/remark-breaks) | Agent 对话里双方消息按 Markdown 排版（标题/加粗/列表/表格/引用/代码块/链接，GFM 任务列表；单换行原样保留）；**默认不渲染原始 HTML，因此不引入消毒库**，也不做代码高亮（随产物打包） |
| [js-yaml](https://github.com/nodeca/js-yaml)                                         | 解析 YAML 格式的常用语配置文件                                                                                                     |
| [qrcodejs](https://github.com/davidshimjs/qrcodejs)                                  | 「本机上传链接」二维码由脚本端本地生成（无需服务器参与）                                                                           |
| [heic2any](https://github.com/alexcorvi/heic2any)（手机上传页 CDN 加载）             | 手机端把 HEIC/HEIF 解码转 JPEG 后压缩上传；CDN 不可达时回退原样直传                                                                |
| [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)    | 语音合成播报                                                                                                                       |
| [GM API](https://www.tampermonkey.net/documentation.php)                             | `GM_xmlhttpRequest`、`GM_setClipboard`、`GM_notification`、`GM_getValue`/`GM_setValue` 等油猴扩展 API                              |
| [ScriptCat Agent API](https://docs.scriptcat.org/docs/dev/agent/)                    | 内置 AI 助手：`CAT.agent.conversation` / `.model` / `.skills` / `.task` 四项能力由宿主（ScriptCat v1.4+）提供，**不打包进产物**，缺失时 Agents 视图内降级说明 |
| [relay-server](relay-server/server.js:1)                                             | 传输助手配套中继服务：纯 Node 内置 `http`（零依赖），同源托管手机上传页构建产物、电脑端长轮询取图；需部署到公网                                |
| [Webpack 5](https://webpack.js.org/) + [TypeScript](https://www.typescriptlang.org/) | 构建与开发环境（脚手架对齐 [Eished/douyu-helper](https://github.com/Eished/douyu-helper)）：`src/` 打包成单文件产物 `znhd.user.js` |
| [ESLint](https://eslint.org/) + [Prettier](https://prettier.io/)                     | 代码规范与格式化（`npm run lint` / `npm run build` 自动修复）                                                                      |
| [Puppeteer](https://pptr.dev/)                                                       | 无头 Chromium，跑 `npm run verify` 端到端冒烟（开发依赖，CI 也会用）                                                               |

## 浏览器兼容性

- Chrome / Edge 88+
- Firefox 85+
- Safari 14+

> 需要安装 Tampermonkey 或 ScriptCat 扩展以提供 GM API 支持。

## 常见问题

### 语音播报不工作

1. 检查浏览器是否支持 Web Speech API（在控制台输入 `'speechSynthesis' in window` 应返回 `true`）
2. 确认面板上语音按钮显示为"🔊 语音"（绿色），而非"🔇 静音"（红色）
3. 浏览器可能需要用户首次交互后才能播放语音，尝试点击页面任意位置后再试

### 常用语加载失败

1. 检查网络是否能访问 `github.com`（常用语配置文件托管在 github）
2. 打开浏览器开发者工具（F12）→ Console 查看具体错误信息
3. 尝试点击常用语弹窗中的"重新加载常用语"按钮

### 监控不工作

1. 确认当前时间是否在工作时间内（上午 9:00-12:00，下午 13:30-18:00）
2. 确认征纳互动平台页面已完全加载
3. 打开设置弹窗查看日志面板，了解详细状态

### 传输助手用不了（手机连不上 / 收不到）
1. 确认已在「传输助手 → 第一栏底部**设置 → 中继服务器地址**」填写公网可访问的服务器地址（如 `https://你的服务器:端口`，末尾不带 `/`）；「企业信息」里可以一眼核对当前地址、本机设备 ID 与在线手机
2. 中继服务器需自行部署：进入 `relay-server/` 目录执行 `node server.js`（纯 Node 内置模块、零依赖，默认端口 5689，可用 `PORT` 环境变量修改；注：Node 端仍零依赖，仅手机端转换 HEIC 时需从公共 CDN 加载 heic2any，断网时 HEIC 回退原样直传）
3. 该服务器必须能从手机浏览器公网访问；仅本机 `localhost` 时手机无法连上
4. 点第二栏「**+**」打开配对窗口，用手机扫二维码或打开链接上传；中继地址填好后**脚本自动开始接收**（无需点按钮），收到后窗口自动打开，在会话里点图片右下角「复制到剪贴板」
5. **中继服务更新后必须重启**才会生效（常驻进程不热更）。正式部署：push 到 `main` 即由 GitHub Actions 自动同步到服务器并重启容器，无需手动操作；部署后 `curl http://127.0.0.1:5689/health` 返回的 `version` 与 `relay-server/package.json` 一致即生效。容器/手动场景：改过 `server.js` 后用 `docker restart znhd`（或 PM2/`systemd` 对应 restart，直接跑则停旧进程后重新 `node server.js`）。
6. **同一设备 ID 在多个标签页/浏览器同时开着会各自接收**：中继现已「广播」——每张图会同时推给所有在等待的接收端（你正在看的那个标签页一定会弹窗）。若只想在一个页面弹窗，关掉其余跑了脚本的标签页即可（例如调试用的 example.com）。
7. **收不到时先看归组**：多台手机同时在线时，手机发来的内容归入聚合会话「手机」而不是各台的会话；只有 1 台在线时才归那台的会话。

### 常用语点击后未填入编辑器

1. 确认页面中存在 TinyMCE 编辑器（输入区域）
2. 检查浏览器控制台是否有 iframe 跨域相关错误
3. 脚本会自动降级处理：优先使用 TinyMCE API，失败后直接操作 DOM

## 更新日志

完整更新日志（按版本倒序）在 **[`changelogs/`](./changelogs) 目录**（按月分文件，如 `changelogs/2026-10.md`）。
2026-10-10 之前的完整历史冻结在 **[CHANGELOG.md](./CHANGELOG.md)**，只作回溯查阅。

运行时也能直接看：面板「设置」→ 在 `[更新脚本]` 旁边的 **[更新日志]** → 弹窗展示最新 10 条，
点弹窗里的「获取更多日志」跳转到 `changelogs/` 当月文件的网页查看全部历史。


## 免责声明

本项目所有代码及脚本仅供学习、研究与个人非商业使用。

使用者需自行遵守所在网络环境及相关法律法规，严禁用于非法用途、商业用途或侵犯他人权益的场景。

使用本脚本所产生的一切风险、后果及法律责任均由使用者自行承担，项目作者不承担任何直接或间接责任。

如侵犯到您的权益，请联系项目维护者进行处理。

## 许可证

本项目采用 **MIT License** 开源，许可证全文见 [LICENSE](LICENSE)。

即：可自由使用、修改、分发（含商用），只需保留版权声明与许可证声明；软件按「原样」提供，作者不提供任何担保、不承担使用后果。

随本项目分发与加载的第三方依赖均为 **MIT** 许可（React、ReactDOM、Ant Design、@ant-design/icons、react-to-print、react-markdown、remark-gfm、remark-breaks、js-yaml，以及运行时按需加载的 qrcodejs、heic2any），与本许可证相互兼容。

## 联系方式

- **作者**：runos
- **项目地址**：https://github.com/Run-os/znhd-service
- **脚本主页**：https://scriptcat.org/zh-CN/script-show-page/3650

## 贡献

欢迎提交 Issue 和 Pull Request！