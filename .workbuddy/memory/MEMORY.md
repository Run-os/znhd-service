# znhd-service 项目长期记忆

## 项目概况
- `znhd.user.js`：征纳互动（税务）人数/在线监控油猴脚本，ScriptCat 扩展运行。**UI 栈 = 自建宿主 + React 19 + Ant Design v6**（v26.10.06-v9 起，早已不是 CAT_UI）；面板宿主 id `__znhd_panel_host__`、浮层宿主 `__znhd_overlay_host__`（常量在 `src/lib/ui/panelIds.ts` 叶子模块，防循环 import TDZ）。
- `relay-server/server.js`：手机↔电脑中继（纯 Node 内置 http，零依赖）。手机上传页是 `web/` 的 React 应用构建产物，同源托管于 `/u/<deviceId>`（v26.10.06-v3 起，server.js 里不再有内联 HTML）。
- 传输助手（v26.10.12-v1，原「设备互联」重构）见下方专节。

## 版本号规范（硬性，必遵守）
- 油猴 `@version` 与 relay `package.json` 同格式 `YY.M.D-vN`（yy.m.d=改动当天真实日期，vN=当天累计第 N 次）。任何代码改动必须递增；跨天重置 v1。
- 油猴两处版本文本（启动日志~668、面板~901）走 `GM_info.script.version` 动态读，只改 `@version` 头。
- relay 启动时 require `version` 打日志 + `GET /health` 返回 `{ok,version}` 用于确认线上版本；手机上传页 `VERSION` 变量注入版本号。

## 文档同步约定（硬性）
- `znhd.user.js` 改动后必须同步 `ReadMe.md`（特性/配置/CONFIG/DEFAULTS/日志/版本号示例）。ReadMe 曾多次滞后，改动后务必核对。

## 模板字符串陷阱（硬性；relay 内联页部分已废弃）
- ⚠️ **relay-server 里已无内联手机页 HTML**（v26.10.06-v3 起整页迁到 `web/` React 应用，`upload-page.js` 只读构建产物）——旧「手机页模板字符串吞反斜杠」陷阱不再适用。
- **现行同类陷阱在 `src/lib/ui/uiReset.ts`**：整段 CSS 是模板字符串，**注释里出现反引号会直接截断模板**（tsc 报 TS1005，报错行还指向注释后面那行，v26.10.08-v8/v13 踩过两次）。规则：该文件写注释一律不用反引号，用标识符名或中文引号。

## CAT_UI 库关键事实（⚠️ 已整体废弃，v26.10.06-v9 起）
- 面板早已不是 `CAT_UI.createPanel`：改为自建宿主 + **React 19 + Ant Design v6**（v26.10.5-v1 模块化 → v26.10.06-v9 换 UI 栈），`@require` 里已无脚本猫 UI 库。下面这些旧结论只对 v26.10.06-v9 之前的产物有效，排查老问题时才翻：
- `window.CAT_UI` 名义导出 arco 几十组件，但运行时大量是 undefined（已实测 undefined：`TimePicker`/`Image`/`Switch`）。
- 旧 React 渲染器白名单只含 div/p/span 等基础标签，不含 `img`/`input` → 曾触发 React #137（图片用 `div{backgroundImage}`、开关用 `div{onClick}` 模拟）。
- 旧自绘弹窗内 button 会被 arco focus-lock 抢焦点（`tabIndex=-1` + mousedown `preventDefault` 修）；旧 Viewer.js 容器困在 body transform 层叠上下文（MutationObserver 移入 overlay 修）——这两条机制在新 antd 栈里已不复现，但「浮层挂 `document.documentElement` 避开 body transform」的结论仍有效。

## 传输助手三栏架构（v26.10.12-v1 重构，原「设备互联」）
- 主面板入口从 5+Agent 两行瘦成**一行 4 个**：设置/常用语/传输助手/图片嗅删（Agent 与「历史记录」入口已删）。
- 三栏（企业微信式）：第一栏 `TransferNavRail`（Agents 固定顶部 + 设备/文件 + 底部外观/设置/企业信息，可折叠）→ 第二栏 `TransferSessionList`（搜索 + `aria-label="配对设备"` 的「+」+ 会话列表）→ 第三栏（`TransferDeviceChat` 设备会话 / `TransferFilesView` 全部文件 / `TransferAgentView` Agents）。
- 业务层 `src/lib/transfer/store.ts` 是**模块级单例**（窗口不开也照常收件；`autoOpenListeners` → 主面板 `setTransferOpen(true)` 自动弹窗，`autoOpenOnReceive` 可关）。
- 设置完全隔离：`scriptCat_TransferSettings`（`lib/transfer/settings.ts` 的 `DEFAULT_RELAY_SERVER`），主面板 `DEFAULTS` 里已无 `relayServer`；旧 `Allvalue.relayServer` 仅一次性迁移种子。
- 会话归组：正向广播不带手机 ID ⇒ 恰好 1 台在线归该机会话，否则聚合会话 `__phone__`（标签「手机」）。**聚合会话没有单一 phone 对象，在线状态必须用 `sessionSendable()` 判**（用 `!!phone` 会「多台在线却显示离线」，v26.10.12-v1 冒烟抓到的真 bug）。
- 发送目标由会话决定：具体会话=定向那台，聚合会话=`targets:'all'` 广播（旧版「≥2 台多选勾选」交互已移除）。
- `destroyOnHidden`：关窗即卸载重挂 ⇒ nav 复位 `devices`、Agent hook 随窗口重生（会话索引靠 localStorage `scriptCat_AgentChats` 回填）。冒烟重开 Agent 必须：关窗 → 点面板「传输助手」→ 再点第一栏 `aria-label="Agents"`。
- **窗口无标题栏**（v26.10.12-v2 起去掉了 `title`，因为与第一栏顶部的图标+名称重复）：识别窗口一律用 className 钩子 `.ant-modal.znhd-transfer-modal`（`className` 落在 `.ant-modal` 元素上，见 rc-dialog Panel 的 `clsx(prefixCls, className)`）。⚠️ antd 的 **关闭按钮 `closerNode` 独立于 header 渲染**（`Content/Panel` 里 `headerNode = title ? ... : null`，两者分开）——去掉 title 不会丢 ×；但 × 是绝对定位浮在窗口右上角、不占布局高度，第三栏右上角的控件（会话头「清空消息」、文件头「清空全部」）必须给它留出右侧空档。
- 删除的组件：PhoneModal / RecvHistoryModal / RecvTextModal / agent/AgentModal；`lib/gallery.ts` 只剩 `downloadFileName`。
- 冒烟 `scripts/smoke/znhd-smoke.html` 时间线整体重写（报告时刻 37000ms）；「自动弹窗未点击」证据必须在点击前时刻记快照（报告时刻读全局量会被污染→假红）。

## 面板位置持久化（已验证；Shadow DOM 部分已废弃）
- 键 `scriptCat_PanelPoint`；`point: loadPanelPoint()`。夹紧：minY=0,maxY=vh-40,水平 MIN_VISIBLE=48。
- ⚠️ 旧版面板渲染在 CAT_UI 的 Shadow DOM（`cat-ui-plan` 挂 body，需遍历 `.shadowRoot`）——**v26.10.06-v9 起已是普通 DOM 宿主 + React**，`querySelectorAll` 直接可查；「判断脚本是否注入」现在查 `#__znhd_panel_host__` / `#__znhd_overlay_host__` 在不在文档里。

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
- 主面板组件 `MainPanel`（原 `DM`，v26.9.6 重命名）；**入口一行 4 个**（`PANEL_ACTIONS`：设置/常用语/传输助手/图片嗅探，v26.10.12-v1 起；Agent 与「历史记录」入口已删，Agent 改从传输助手第一栏进）；掉线检测双选择器 `:nth-child(2)`/`nth-of-type(2)` 是互补兜底，勿合并。

## UI 图标一律用 SVG，禁止 emoji（v26.10.09-v5 确立）
- **Win7 没有 Segoe UI Emoji 字体**（Win8.1 才有）→ emoji 字符（`⚙️💬🖼️💻🔊🔇🎯❌📱`）在 Win7 全渲染成豆腐块。
  这类字符在 **U+1F300+ 补充平面**，Win7 无字形；而 `✓✕→≈≥×` 在 **BMP U+2190–U+2BFF**（Segoe UI/Arial 自带）**可以留**。
  判断依据是**码位所在平面**，不是「看起来像不像图标」。
- 统一用 `@ant-design/icons`（已在 devDependencies，产物里本就有 `anticon`/`viewBox` ⇒ 零新增体积），
  外层套 `MainPanel.tsx` 的 `IconBox`（inline-flex + 居中）防宿主税务页的 svg 规则顶偏图标。
- ⚠️ **`@ant-design/icons` 的组件 props 不接受 `style`**（`AntdIconProps` 只认 className 等少数几项），
  直接 `<IconOutlined style={...}/>` 报 **TS2322**。样式必须挂 IconBox 外层 span。
- 面板按钮的容器查询阈值（`PANEL_CSS`，65px）与**图标字号/标签字数**耦合：antd 图标是 `1em` 正方形，
  字号 15px ⇒ 占宽 15px。**改这两者任一个都要回来重算阈值**，否则文字会在将满时折行。
- 实测夹具 `tmp/check-icons.js`：起 `scripts/smoke/server.js` + 真实 Chromium 加载**构建产物**量 DOM。
  ⚠️ 面板**默认展开**（宿主有 `.ant-card`），圆球才是收起态；测试页路径是 **`/smoke.html`**。

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
- 判断脚本是否在页面注入：**查 DOM 里的宿主元素**（`#__znhd_panel_host__` / `#__znhd_overlay_host__`；旧版是 Shadow 宿主 `cat-ui-plan`，已废弃），绝不靠 `window` 全局变量或 `<script>` 标签（ScriptCat 跑隔离世界，都不暴露）。
- 改了文件却"像没生效"：先确认运行版本（必要时让用户删除脚本重装 + Ctrl+Shift+R），运行版副本可能与工作区文件不一致。
- 手机端"连不上"绝大多数是**部署/网络层**（反代没转发 POST、跨网、HTTPS 混合内容），先让用户给服务端 `[连接]` 日志 + 手机页错误文案，别先改代码逻辑。

## 文档体系（agent.md / ReadMe.md 分工，v26.9.6 确立）
- ReadMe = 对外唯一档案：功能/配置/技术栈/FAQ/更新日志（版本号规则写在更新日志开头）。agent.md = AI 内部：代码组织、复用溯源、数据结构、修改约束、踩坑索引（只留一句话规则 + 指向 ReadMe 版本条目）。
- 更新前先做归属判断：对外→ReadMe；ReadMe 写错→直接修 ReadMe（不在 agent 另存正确版）；两边都要→正文进 ReadMe、agent 只留指针。
- 部署流程以 `.github/workflows/deploy.yml` 注释为唯一真源（tar 直写 `/app` + `docker restart`；`appleboy/ssh-action` 不注入 env，远程脚本内变量硬编码），不在文档里维护第二份流程说明。
