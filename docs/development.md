# 开发与构建

## 环境要求

Node.js 20+；包管理 npm。

## 常用命令

```bash
npm install            # 安装依赖
npm run dev            # 开发模式：Vite watch + 本地调试
npm run build          # 生产构建（lint 修复 → dist/znhd.user.js）
npm run typecheck      # 类型检查（src 业务层）
npm run typecheck:vue  # 类型检查（src-vue UI 层）
npm run check          # 产物 + relay-server 语法校验
npm run verify         # 端到端冒烟 = verify:vue + verify:relay + verify:web
npm run build:web      # 构建手机上传页 → relay-server/public
```

冒烟测试基于 Puppeteer 无头 Chromium + GM API 桩测试页（`scripts/smoke/`），覆盖：导航条注入控件、全部弹窗、传输助手三栏、常用语、图片嗅探、中继与手机页。

## 版本号规则

- 编辑 [`config/common.meta.json`](../config/common.meta.json) 的 `version`（同时同步 `package.json` / `package-lock.json`，三处一致）；
- 格式 `YY.MM.DD-vN`，日期**零填充**；`N` 为当天第几次改动 —— **同一天只递增 `-vN`，日期不动**；
- 产物头部由构建自动生成。

## 目录说明

| 目录 | 内容 |
|---|---|
| `src/` | 业务逻辑层（零 UI）：`monitor` 监控 / `speech` 语音队列 / `storage` 配置 / `relay` 通信 / `sniffer*` 图片嗅探 / `transfer` 传输助手业务 / `phrasesZnhd` 常用语抓取 |
| `src-vue/` | UI 层（Vue 3 + Tailwind 4 + daisyUI 5）：`NavBarControls` 标题栏注入控件、`DialogHost` 弹窗群（设置/常用语/传输助手/嗅探/日志）、`transfer/` 聊天窗组件、`lib/` 主题与总线 |
| `web/` | 手机上传页（React 19 + antd v6 独立子项目） |
| `relay-server/` | 中继服务器（纯 Node 内置模块，零运行时依赖） |
| `shared/` | 脚本端与手机页共用纯逻辑（图片压缩 / A4 打印） |

架构要点：

- **UI 与业务分离**：`src-vue` 通过共享模块调用 `src/` 的业务能力；两棵树各自 typecheck。
- **样式隔离**：注入 UI 全部运行在 shadow DOM 内（标题栏控件与弹窗宿主是两个独立挂载），Tailwind 产物以 `?inline` 注入，daisyUI 主题变量挂 `:host` 与 `#app`（`data-theme`），不污染宿主页。
- **主题**：daisyUI `cupcake`，`--color-primary` 覆写为品牌蓝（`style.css` 三路选择器 `:root, :host, [data-theme='cupcake']`，缺一路会导致面板内容拿不到覆写值）。

## 调试

1. `npm run dev` 启动 watch；
2. 按 `config/dev.meta.json` 中 `@require` 指向的 `dist/znhd.dev.user.js` 安装开发脚本（油猴需允许访问本地文件 URL）；
3. 改 `src-vue/` 或 `src/` 触发热重载。

## 发布

push 到 `main` 后，`@updateURL` / `@downloadURL` 指向的 `dist/znhd.user.js`（GitHub raw 直链）即为最新产物，ScriptCat 自动同步；中继服务器由 GitHub Actions 自动部署重启。
