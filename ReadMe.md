# 征纳互动人数和在线监控 v2

[![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=flat-square&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/Run-os/znhd-service)

一个油猴用户脚本（UserScript），用于实时监控[征纳互动平台](https://znhd.hunan.chinatax.gov.cn:8443/)的等待人数与在线状态：有人等待或掉线时自动语音播报，配套常用语快填、网页图片嗅探、手机 ↔ 电脑互传（传输助手），帮助坐席及时响应。

## 功能一览

| 功能 | 说明 | 详见 |
|---|---|---|
| **监控与语音播报** | 每 3 秒检测等待人数，有人等待 / 掉线自动语音提醒；仅监控时间段内运行 | [docs/monitor.md](docs/monitor.md) |
| **常用语** | 读取页面右侧栏「常用话术」（双 tab + 搜索），点卡片一键复制并填入聊天编辑器（TinyMCE 走 JS API，详见 [docs/tinymce-send-doc.md](docs/tinymce-send-doc.md)） | [docs/phrases.md](docs/phrases.md) |
| **图片嗅探** | 一键扫描当前网页图片，按会话分组，预览 / 下载 / A4 打印 | [docs/sniffer.md](docs/sniffer.md) |
| **传输助手** | 手机 ↔ 电脑互传图片 / 文件 / 文本，收到自动弹窗，图片一键复制进剪贴板 | [docs/transfer.md](docs/transfer.md) |
| **运行日志 / 更新日志** | 弹窗查看运行日志（四色分级）；设置内查看更新日志 | — |

界面入口全部注入在**站点标题栏**（【工作台】【业务管理】右侧）：`｜语音开关｜设置 常用语 传输助手 图片嗅探｜版本号`，点击图标打开对应弹窗；不再有悬浮面板。

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
├── docs/                 # 子文档（功能详解 / 开发 / 排障）
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

完整日志在 [`changelogs/`](./changelogs)（按月分文件）；2026-10-10 之前的历史冻结在 [CHANGELOG.md](./CHANGELOG.md)。脚本内入口：**设置 → 更新日志**。

## 免责声明

本项目所有代码及脚本仅供学习、研究与个人非商业使用。使用者需自行遵守所在网络环境及相关法律法规，严禁用于非法用途、商业用途或侵犯他人权益的场景。使用本脚本所产生的一切风险与后果由使用者自行承担。

## 许可证

[MIT License](LICENSE)。随项目分发的第三方依赖均为 MIT 或与其兼容的许可。

## 联系方式

- **作者**：runos
- **项目地址**：https://github.com/Run-os/znhd-service
- **脚本主页**：https://scriptcat.org/zh-CN/script-show-page/3650
