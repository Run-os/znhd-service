# znhd-service 项目长期记忆

## 项目概况
- `znhd.user.js`：征纳互动（税务）人数/在线监控油猴脚本，ScriptCat 扩展运行，UI 依赖 CAT_UI 库（@require scriptcat.org/lib/1167/1.0.0/脚本猫UI库.js，备份 TMP/cat_ui_lib.tmp.js）。
- `relay-server/server.js`：手机图片→电脑剪贴板 中继（纯 Node 内置 http，零依赖）。手机上传页同源托管于 `/u/<deviceId>`。

## 版本号规范（硬性，必遵守）
- 油猴 `@version` 与 relay `package.json` 同格式 `YY.M.D-vN`（yy.m.d=改动当天真实日期，vN=当天累计第 N 次）。任何代码改动必须递增；跨天重置 v1。
- 油猴两处版本文本（启动日志~668、面板~901）走 `GM_info.script.version` 动态读，只改 `@version` 头。
- relay 启动时 require `version` 打日志 + `GET /health` 返回 `{ok,version}` 用于确认线上版本；手机上传页 `VERSION` 变量注入版本号。

## 文档同步约定（硬性）
- `znhd.user.js` 改动后必须同步 `ReadMe.md`（特性/配置/CONFIG/DEFAULTS/日志/版本号示例）。ReadMe 曾多次滞后，改动后务必核对。

## relay-server 模板字符串陷阱（硬性）
- 手机页 HTML 是**模板字符串**：内嵌正则转义 `\\/` 会被模板吃掉反斜杠→`//`→SyntaxError→整段脚本死亡（曾致手机"正在连接"）。
- 规则：模板内正则反斜杠写 `\\/`；**校验必须针对渲染后输出**（本地起服务 curl 页面→抽 script→`new Function()` 校验）。

## CAT_UI 库关键事实（易踩坑）
- `window.CAT_UI` 名义导出 arco 几十组件，但运行时大量是 undefined。**用任何组件前必须运行时验证**。已实测 undefined：`TimePicker`/`Image`/`Switch`。
- React 渲染器**白名单只含 div/p/span 等基础标签**，不含 `img`/`input` → 触发 React #137。
  - 图片：`createElement('div',{style:{backgroundImage:'url(...)'}})`。
  - 勾选框/开关：`createElement('div',{onClick,style})` 模拟（受控取反），禁用裸 input/Switch。
  - 时间选择：`CAT_UI.Input({type:"time"})`；文本输入：`CAT_UI.Input` 可靠。
- **焦点锁冲突**：自绘裸 DOM 弹窗（图片画廊/文本弹窗挂 documentElement）内 button 会被 arco focus-lock 抢焦点→刷 `FocusLock: focus-fighting`。修复：弹窗内所有 button 设 `tabIndex=-1` + `mousedown` 时 `e.preventDefault()`。
- **灰层覆盖**：宿主/扩展有 z-index 高于弹窗的半透明灰层→缩略图"灰蒙蒙"。修复：overlay `z-index:2147483647`；box 加 `isolation:isolate;filter:none;backdrop-filter:none;z-index:1`；内容区显式 `filter:none;backdrop-filter:none;opacity:1`。
- **Viewer.js 层叠冲突**：Viewer（`viewerjs/dist/viewer.min.js`）`.viewer-container` 默认挂 body，无 `on`/`addListener` 事件 API，显隐靠 `viewer-in` 类+opacity。与 overlay 同 z-index 时真实税务页 body 的 transform/filter 层叠上下文会把 Viewer 困住→"预览跑到弹窗后"+关闭按钮消失。修复：`MutationObserver` 监听 `.viewer-container` 出现即 `overlay.appendChild(vc)`（`vc.style.zIndex='2'`）；并按 `viewer-in` 类增删切 `vc.style.pointerEvents`。关闭按钮显式 `z-index:2!important`。

## 面板位置持久化（已验证）
- 键 `scriptCat_PanelPoint`；`point: loadPanelPoint()`。找标题含「征纳互动监控」且在 shadow 内的面板，getBoundingClientRect 读坐标；监听 style 变化 + mousedown/move/up 双保险保存；加载时恢复。夹紧：minY=0,maxY=vh-40,水平 MIN_VISIBLE=48。
- 面板渲染在 Shadow DOM（<cat-ui-plan> 挂 body），普通 querySelectorAll 穿不透，需遍历 `.shadowRoot`。createPanel options 无 onDrag（内部 react-draggable 改内部层 transform）。

## 中继部署要点
- 端口 `PORT=process.env.PORT||5689`，默认 5689；nginx `proxy_pass http://127.0.0.1:5689`（域名 znhd.122050.xyz）。公网映射应 `5689→5689`。容器化时若 nginx/relay 各自独立容器，`proxy_pass` 须用 relay 服务名（如 `http://znhd:5689`）。
- **DEPLOY_PATH 事故根因**：`appleboy/ssh-action` 不注入 GitHub Actions 顶层 env 到远程 shell，远程 `$DEPLOY_PATH` 空→`cd` 进 `/root`，`git clean -fd` 删光 /root 未跟踪文件（含 .ssh）。修复（已写入 deploy.yml）：脚本内硬编码 `DEPLOY_PATH=/opt/znhd-service`、`CONTAINER_NAME=znhd`；加安全阀拒绝 /root、/home、/ 等目录且要求 `[ -f relay-server/server.js ]` 才继续；用 `tar` 管道直写容器 `/app` 再 restart，配自证式健康检查（grep 容器内 version 比对 EXPECT_VER）。
- 诊断：启动日志末 `http://0.0.0.0:5689`；nginx 报 `Connection refused (111) upstream 5689` = relay 未在该端口监听。

## 已落地功能
- 工作时间可配置 DEFAULTS.workingHours；启动日志走 addLog 进面板日志窗。
- resolveGithubUrl(githubUrl)：useCdn 时 jsdelivr gh，否则 raw.githubusercontent；支持 blob/raw 多段分支。DEFAULTS.useCdn 默认 true。
- 手机上传页 compressFile：SVG 跳过压缩原样直传；HEIC 用 heic2any（CDN bootcdn 0.0.4）转 JPEG 再 canvas 压缩（铺白底防黑底），库缺失/失败原样直传兜底；失败原因在状态区显示。
