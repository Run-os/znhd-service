# 征纳互动人数和在线监控 v2

一个油猴用户脚本（UserScript），用于实时监控[征纳互动平台](https://znhd.hunan.chinatax.gov.cn:8443/)的等待人数与在线状态：有人等待或掉线时自动语音播报，配套常用语快填、飞书快捷短语、待办提醒、网页图片嗅探、手机 ↔ 电脑互传（传输助手），帮助坐席及时响应。

## 功能一览

七个功能，每个都配一份**使用手册**（面向使用者，带示意图，放 `docs/`，文件名统一为 `<功能>-guide.md`）。

| 功能名称 | 简易说明 | 使用手册 |
|---|---|---|
| **监控与语音播报** | 每 3 秒看一次等待人数和掉线提示，有变化才播报，只在监控时段运行 | [monitor-guide.md](docs/monitor-guide.md) |
| **常用语** | 把右侧栏「常用话术」搬进弹窗，搜一下点一条，直接填进聊天框 | [phrases-guide.md](docs/phrases-guide.md) |
| **飞书快捷短语** | 按当前对话自动匹配你飞书表格里的规则，在输入框上方浮出对应按钮，点一下整段替换 | [quick-reply-guide.md](docs/quick-reply-guide.md) |
| **待办提醒** | 有「待处理留言 / 预约」时对应卡片红色呼吸，数量归零自动撤 | [todo-guide.md](docs/todo-guide.md) |
| **图片嗅探** | 把当前页面的图按会话列出来，可预览、下载、按 A4 打印 | [sniffer-guide.md](docs/sniffer-guide.md) |
| **传输助手** | 手机 ↔ 电脑互传图片 / 文件 / 文字，电脑端一键复制进剪贴板 | [transfer-guide.md](docs/transfer-guide.md) |
| **运行日志** | 弹窗看脚本每一步干了什么（四色分级），排障时截图即定位 | [log-guide.md](docs/log-guide.md) |

所有入口都注入在**站点标题栏**（【工作台】【业务管理】右侧）：`｜语音开关｜设置 常用语 传输助手 图片嗅探｜版本号`，点图标打开对应弹窗；不再有悬浮面板。

![标题栏入口示意](docs/images/navbar-entry.svg)

## 快速开始

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [ScriptCat（脚本猫）](https://scriptcat.org/) 扩展。
2. 安装脚本（二选一）：
   - 在线安装（推荐）：打开[脚本主页](https://scriptcat.org/zh-CN/script-show-page/3650) → 「安装此脚本」；
   - 手动安装：复制 [`dist/znhd.user.js`](dist/znhd.user.js) 全部内容 → 油猴新建脚本 → 粘贴保存。
3. 打开征纳互动平台，标题栏出现上述控件即安装成功。

## 项目结构

```
znhd-service/
├── src/                  # 业务逻辑层：monitor / speech / storage / relay / sniffer / transfer / phrasesZnhd 等
├── src-vue/              # UI 层（Vue 3）：NavBarControls（标题栏注入）+ DialogHost（弹窗群）+ transfer / sniff
├── web/                  # 手机上传页（Vue 3 + Tailwind 4 + daisyUI 5 + Vite，独立子项目）→ 构建产出到 relay-server/public
├── relay-server/         # 中继服务器（纯 Node 内置模块，零依赖）：长轮询转发 / 表情包缓存 / 静态托管手机页
├── shared/               # 脚本端与手机页共用的纯逻辑（图片压缩 / 打印）
├── config/               # 构建配置：common.meta.json 为脚本元信息（含版本号）唯一来源
├── dist/                 # 构建产物 znhd.user.js（提交进仓库，勿手改）
├── scripts/smoke/        # 无头端到端冒烟（puppeteer）：npm run verify
├── docs/                 # 子文档：每个功能的 docs/<功能>-guide.md 使用手册、开发与排障说明、示意图（docs/images）
└── changelogs/           # 更新日志唯一来源（按月分文件；CHANGELOG.md 为 2026-10-10 前的历史档案）
```

## 技术栈

| 技术 | 用途 |
|---|---|
| [Vue 3](https://vuejs.org/) + [Tailwind CSS 4](https://tailwindcss.com/) + [daisyUI 5](https://daisyui.com/components/) | 脚本端面板（shadow DOM 隔离）；经 [vite-plugin-monkey](https://github.com/vite-plugin/vite-plugin-monkey) 打包为单文件用户脚本 |
| TypeScript + Vite 7 | 脚本主体与构建 |
| Web Speech API | 语音合成播报 |
| GM API | `GM_xmlhttpRequest` / `GM_setClipboard` / `GM_setValue` 等油猴能力 |
| [Vue 3](https://vuejs.org/) + [Tailwind CSS 4](https://tailwindcss.com/) + [daisyUI 5](https://daisyui.com/components/)（business 主题） | 手机上传页（`web/`，独立 Vite 子项目，与脚本端共享 `src-vue/components|transfer` 组件层） |
| Node.js（零依赖） | 中继服务器（`relay-server/`） |
| [Puppeteer](https://pptr.dev/) | 端到端冒烟测试（开发依赖） |

## 开发与构建

```bash
npm install        # 安装依赖
npm run build      # 生产构建 → dist/znhd.user.js
npm run dev        # 开发模式（watch + 本地调试页）
npm run verify     # 端到端冒烟（vue 面板 + relay + 手机页）
npm run typecheck  # 类型检查（src 层）
```

版本号规则、调试方式、发布流程见 [docs/development.md](docs/development.md)。

## 常见问题

见 [docs/troubleshooting.md](docs/troubleshooting.md)（语音不播 / 常用语抓不到 / 传输助手连不上 / 中继部署与重启等）。

## 更新日志

完整日志在 [`changelogs/`](./changelogs)（按月分文件）；2026-10-10 之前的历史冻结在 [CHANGELOG.md](./CHANGELOG.md)。（v26.10.25-v1 起脚本内的「更新日志」弹窗已删除。）

## 免责声明

本项目所有代码及脚本仅供学习、研究与个人非商业使用。使用者需自行遵守所在网络环境及相关法律法规，严禁用于非法用途、商业用途或侵犯他人权益的场景。使用本脚本所产生的一切风险与后果由使用者自行承担。

## 许可证

[MIT License](LICENSE)。随项目分发的第三方依赖均为 MIT 或与其兼容的许可。

## 联系方式

- **作者**：runos
- **项目地址**：https://cnb.cool/bbbbaa/znhd-service
- **脚本主页**：https://scriptcat.org/zh-CN/script-show-page/3650
