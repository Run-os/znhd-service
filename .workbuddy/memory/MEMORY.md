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
- 常用语 2 小时本地缓存（键 `scriptCat_PhrasesCache`，URL 变或点「重新加载」才重拉）。
- 语音队列：上限 10（MAX_SPEECH_QUEUE）+ TTL 30s + 关语音时 clearSpeechQueue()。
- 日志去重：`RECENT_LOG_COUNT=5` 最近 N 条窗口（原为只比对上一条，间隔性重复会刷屏）。
- 主面板组件 `MainPanel`（原 `DM`，v26.9.6 重命名）；掉线检测双选择器 `:nth-child(2)`/`nth-of-type(2)` 是互补兜底，勿合并。

## 写图片到剪贴板（硬性，唯一可靠路径）
- `GM_setClipboard(data)` 在 ScriptCat **只支持文本**，传 Blob 不报错但**不真正写图**→假成功。图片分支已彻底移除。
- 唯一可靠路径 = 页面主世界 `unsafeWindow.navigator.clipboard.write` + `unsafeWindow.ClipboardItem`（隔离世界里 ClipboardItem 常 undefined）。
- Chromium 对图片**只可靠支持 image/png**；大图先降采样到最大边 1600px 再编码。转换要在**弹窗展示期预做**（`prepareClipboardImage`），点击时只做写入，否则点复制会明显卡顿。

## 中继广播架构与反向通道（relay-server）
- `/recv` 是**广播**：`waiting` 集合登记所有在等长轮询，`deliverToAll` 给每个等待连接各发一份 → 多标签同时开着会**各自都弹窗**（想只弹一个就关掉其它标签）。旧版单槽竞态（"第一次不弹、第二次才弹"）已由此解决。
- 反向通道镜像正向：`/u`↔`/phone/send`、`/recv`↔`/phone/recv`、`deliverToAll`↔`deliverToPhone`；手机每 8s `/phone/heartbeat` 报活，`PHONE_TTL=20s`，5s 扫描判离线（只告警一次）。**改一侧逻辑必须同步评估另一侧**。
- `pending`/`phonePending` 为 FIFO 队列（上限 100），全部内存态、无持久化；重启即清空。
- 脚本端用 `GM_xmlhttpRequest` 长轮询（非 WebSocket）是为了绕过税务页 CSP 对 connect-src 的限制。

## 排查方法论（硬性经验）
- userscript 的 UI bug（弹窗透字/层级/遮挡）**不要靠读代码猜**，要连真机浏览器量运行中元素：`getComputedStyle`（opacity/background）、`getBoundingClientRect`（是否四边贴住视口）、`elementFromPoint`（谁在最顶）。本仓库 v10→v14 连续推断全错，v15 才"量"出真因 `opacity:0.8`。
- 判断脚本是否在页面注入：**查 DOM 里的 Shadow 宿主**（`cat-ui-plan`/`cat-ui-popup`），绝不靠 `window` 全局变量或 `<script>` 标签（ScriptCat 跑隔离世界，都不暴露）。
- 改了文件却"像没生效"：先确认运行版本（必要时让用户删除脚本重装 + Ctrl+Shift+R），运行版副本可能与工作区文件不一致。
- 手机端"连不上"绝大多数是**部署/网络层**（反代没转发 POST、跨网、HTTPS 混合内容），先让用户给服务端 `[连接]` 日志 + 手机页错误文案，别先改代码逻辑。

## 文档体系（agent.md / ReadMe.md 分工，v26.9.6 确立）
- ReadMe = 对外唯一档案：功能/配置/技术栈/FAQ/更新日志（版本号规则写在更新日志开头）。agent.md = AI 内部：代码组织、复用溯源、数据结构、修改约束、踩坑索引（只留一句话规则 + 指向 ReadMe 版本条目）。
- 更新前先做归属判断：对外→ReadMe；ReadMe 写错→直接修 ReadMe（不在 agent 另存正确版）；两边都要→正文进 ReadMe、agent 只留指针。
- 部署流程以 `.github/workflows/deploy.yml` 注释为唯一真源（tar 直写 `/app` + `docker restart`；`appleboy/ssh-action` 不注入 env，远程脚本内变量硬编码），不在文档里维护第二份流程说明。
