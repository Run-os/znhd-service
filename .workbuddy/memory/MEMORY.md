# znhd-service 项目长期记忆

## relay-server 模板字符串陷阱（硬性教训，2026-07-28）
- `server.js` 手机页 HTML 是**模板字符串**：内嵌 JS 里的 `\/`（正则转义）会被模板字符串吃掉反斜杠，
  输出成 `//` → 行注释 → 浏览器端 SyntaxError → 整段内联脚本死亡（曾致手机永远"正在连接"）。
- 规则：模板内正则反斜杠要写 `\\/`；**校验必须针对渲染后的输出**（本地起服务 curl 页面 →
  抽 `<script>` → `new Function()` 校验），校验转义前源码会漏判。

## 项目概况
- `znhd.user.js`：征纳互动（税务）人数/在线监控油猴脚本，运行在 ScriptCat 扩展下，UI 依赖外部库
  CAT_UI（`@require` 自 scriptcat.org/lib/1167/1.0.0/脚本猫UI库.js）。库源码已备份在 `TMP/cat_ui_lib.tmp.js`。

## CAT_UI 库关键事实（极易踩坑，已多次验证）
- `window.CAT_UI = Object.assign(class{...}, { 整个 arco 组件库 })`：名义上导出了 arco 几十个组件
  （Affix/Alert/Image/Input/DatePicker/TimePicker/...），但**运行时其中大量组件是 undefined**，
  只有脚本实际用过的子集可靠（createPanel, createElement, useEffect, useState, useRef, Drawer,
  Icon, Typography, Space, Text, Input, Button, Divider, Select, Message，以及 LogPanel 用的
  裸 createElement('div'/'p'/'input') 等）。
- ⚠️ **用任何 CAT_UI 组件前必须运行时验证**，绝不能只 grep 库文本里出现过的名字！
  已实测 `TypeError: is not a function` 的：`CAT_UI.TimePicker`、`CAT_UI.Image`、`CAT_UI.Switch`
  （arco 里虽有，但挂到 CAT_UI 上时是 undefined）。`grep` 到 `Image: LY` / `TimePicker` / `Switch` 字样
  ≠ 公开可用。
- 开关组件：`CAT_UI.Switch` 不可用 → 用**原生 `<input type="checkbox">`**（受控：设 `checked` + `onChange`
  写回状态），与 `TimePicker`→`CAT_UI.Input({type:"time"})` 同理。注意 `createElement('input',...)` 里
  `onChange` 收到的是事件对象 `e`，取 `e.target.checked`（同时兼容直接传布尔的写法）。
- 时间选择器：`CAT_UI.TimePicker` 不可用 → 用 `CAT_UI.Input({ type:"time" })`（arco Input 透传 type，
  带浏览器时间选择器，且在 Drawer 内稳定，不会被懒挂载崩溃）。
- 自定义图标（如网站 favicon）：`CAT_UI.Image` 不可用；且 CAT_UI 面板用的 React 渲染器**白名单只含
  div/p/span 等基础标签，不含 `img` 也不含 `input`**（两者都会触发 React error #137
  "Element type is invalid: got img/input"）。
  - 显示图片：用 `CAT_UI.createElement('div', { style:{ width/height, backgroundImage:'url(...)"',
    backgroundSize:'contain', backgroundRepeat:'no-repeat', backgroundPosition:'center' } })`。
  - 勾选框/开关：不能用裸 `createElement('input', {type:'checkbox'})`，改用 **`createElement('div', {onClick, style})`**
    模拟勾选框（受控样式随状态变化，点击取反）。`CAT_UI.Switch` 也不可用（运行时 undefined）。
  - 文本输入/时间选择：`CAT_UI.Input` 可靠（透传 type，如 `{type:"time"}`），但仅限 arco Input 支持的输入类，
    不要指望它渲染 checkbox/radio 等控件形态。
- **自定义弹窗 vs arco 焦点锁（focus-lock）冲突**：脚本自绘的裸 DOM 弹窗（图片画廊 `renderImageGallery`、文本弹窗
  `showTextPopup`，挂 `document.documentElement`）内的 `<button>` 是焦点可夺取元素。当脚本面板的 arco 抽屉
  （设置/常用语/手机传图）**或税务页面自身的 arco 弹窗**同时开着时，arco 的 focus-lock 发现焦点跑到弹窗按钮上
  又拉不回，会反复刷 `FocusLock: focus-fighting detected. Only one focus management system could be active.`。
  修复模板：弹窗挂载后对其内所有 `button` 设 `tabIndex=-1` 且 `mousedown` 时 `e.preventDefault()`（阻止抢占焦点，
  鼠标点击 `onClick` 仍正常）。这样焦点锁看不到竞争焦点，告警消失；无论"另一个焦点锁"来自脚本面板还是页面都有效。
- **自定义弹窗被外部高层灰层覆盖（2026-07-29 实测）**：弹窗自身 CSS 干净（白底、opacity:1、无伪元素），但用户
  仍看到缩略图和按钮"灰蒙蒙"，本质是**宿主页或浏览器扩展有一个 z-index 高于弹窗 `2147483640` 的半透明灰层**
  盖在了弹窗内容之上（通过 `document.elementFromPoint` 验证：图片中心的最上层元素变成了外部 div）。
  修复模板：把弹窗 `overlay` 的 `z-index` 提到 CSS 最大值 `2147483647`；给白盒 `box` 加
  `isolation:isolate`、`filter:none`、`backdrop-filter:none`、`z-index:1`；并对内容区 `grid` / 缩略图包装
  `thumbWrap` / `img` / `button` 显式声明 `filter:none; backdrop-filter:none; opacity:1`。若灰层来自
  宿主对 `html` 应用 `filter`，则子元素无法逃脱，只能排查禁用相关扩展或切换站点。
- **Viewer.js 全屏预览与自定义弹窗的层叠冲突（2026-07-29 实测）**：
  - Viewer.js（CDN `viewerjs/dist/viewer.min.js`）全屏预览容器 `.viewer-container` 默认挂在 `body` 下，
    且**不提供 `on`/`addListener` 事件 API**（该构建原型方法是 `shown`/`hidden` 内部 handler，选项回调 `shown` 也不可靠）；
    其显隐靠 CSS 类 `viewer-in` 增删 + opacity/visibility 过渡（不是 `display:none`）。
  - 若自定义弹窗 `overlay` 与 Viewer 同为 `z-index:2147483647` 且弹窗挂在 `documentElement`、Viewer 挂 `body`，
    谁压谁取决于页面层叠上下文——真实税务页 body 常带 transform/filter 形成独立层叠上下文，会把挂 body 的
    Viewer 困住，永远被弹窗压后面（"预览跑到弹窗后"）。同时全屏 Viewer 会盖住弹窗右上角 ×。
  - **已验证修法**：用 `MutationObserver` 监听 `.viewer-container` 出现即 `overlay.appendChild(vc)` 移入弹窗内部
    （`vc.style.zIndex='2'`，高于白盒 `z-index:1`），预览必盖在白盒之上、且不受外部页面层叠上下文干扰；
    并加安全网：再 `observe(vc,{attributes:true,attributeFilter:['class']})`，按 `viewer-in` 类增删切换
    `vc.style.pointerEvents`（有=auto / 无=none），确保关闭预览后残留容器不遮挡弹窗关闭按钮/缩略图。
  - **预存布局坑（与 Viewer 无关，纯 CSS）**：弹窗 `box` 是 `display:flex` 容器时，标题/正文作为 flex item 在层叠里
    等同 `z-index:0` 层；关闭按钮是 `position:absolute`（同属 z-index:auto 层），同层按 DOM 顺序——标题在关闭按钮
    之后 append 会画到关闭按钮之上吃掉点击（视觉无重叠，但标题隐形盒子铺满整行）。修法：给关闭按钮显式
    `z-index:2!important` 抬到正 z-index 层。图片画廊与文本弹窗的关闭按钮都需加。
  - 验证手段：`document.elementFromPoint` 取坐标最上层元素 + `elementsFromPoint` 看完整栈，可精准定位"被谁盖住"。
- `createPanel` 的 options **不提供 onDrag 回调**（只认 point/header/render/onMin/onReady/style 等）。
  面板拖拽由内部 react-draggable 改写**内部层**的 `transform: translate`，根容器 left/top 不变。
- 面板渲染在 **Shadow DOM**（`attachShadow({mode:"open"})`，自定义元素 <cat-ui-plan> 挂 document.body），
  普通 `document.querySelectorAll` 穿不透，需遍历 `.shadowRoot`。
- **arco Drawer 懒挂载 children**（visible=false 时不挂载内容）；若 Drawer 内容在挂载时抛错，会连带
  整棵面板 React 树崩溃（面板消失）。设置类 Drawer 优先用 CAT_UI.* 封装组件；需要原生 input 时用
  `CAT_UI.Input({ type:... })` 形式（已在设置抽屉的时间选择验证稳定）。

## 面板位置持久化方案（已验证可用）
- 存储键 `scriptCat_PanelPoint`（与设置数据分离）；`Point` 选项 `point: loadPanelPoint()`。
- 定位：找标题含「征纳互动监控」且在 shadow 内的面板主体；用 `getBoundingClientRect` 读真实视口坐标；
  监听子树 style 变化 + mousedown/mousemove/mouseup 双保险保存；`point` 加载时恢复。
- 边界约束 `clampPoint`：可抓取区=顶部标题栏，故 minY=0（顶边不超出视口上方），maxY=vh-40；水平 MIN_VISIBLE=48。

## 版本号规范（硬性约定，必须遵守）
- 油猴脚本头 `@version` 格式：`YY.M.D-vN`（如 `26.7.18-v1`）。前半 `YY.M.D` = 修改日期（2位年.月.日），
  后半 `vN` = **当天累计的第 N 次更新**。
- 规则：对 `znhd.user.js` 的**任何代码改动（功能/修复/调整）都必须同步把版本号递增**
  （v1→v2→v3…）；若**跨天**（日期变了）则日期部分更新为当天、版本号**重置为 v1**。
- 此约定优先级高：所有改动都要带版本号递增，不可遗漏。
- ⚠️ **日期部分必须用「改动落地当天的真实日期」**，绝不是沿用上一次改动的旧日期！
  每次 bump 前先用当前系统时间（或问用户确认当天日期）算出 `YY.M.D`，再决定是 `+vN` 还是跨天重置 `v1`。
  - 反面案例：2026-07-27 完成的「双向互传」功能，被误写成 `@version 26.7.26-v25`（沿用了前一天 7/26 的日期），
    且违反跨天规则未重置——正确应为 `26.7.27-v1`。已事后更正。
  - 只改 `@version` 头即可；面板两处（line ~668 启动日志、line ~901 面板版本文本）都用 `GM_info.script.version`
  动态读取，无需同步改。
- **relay-server 同规范**（2026-07-28 起）：版本号唯一来源是 `relay-server/package.json` 的 `version`
  （同格式 `YY.M.D-vN`，是合法 semver——`-vN` 按 prerelease 解析）。`server.js` 启动时 require 读取，
  启动日志打 `[中继服务] vXX 已启动`，`GET /health` 返回 `{ok,version}`（可用于确认线上跑的是哪版）。
  对 `relay-server/` 的任何代码改动同样必须递增该版本号，跨天重置 v1。

## 文档同步约定（硬性约定）
- 对 `znhd.user.js` 做代码改动后，**必须同步更新 `ReadMe.md`**：核心特性、配置说明（`CONFIG`/`DEFAULTS`
  要与实际代码一致，不能描述已删除/迁移的字段）、功能详解、更新日志（在顶部补新版本条目）、版本号示例。
- 维护历史中 ReadMe 曾多次滞后（CONFIG 还写着旧 `WORKING_HOURS`、版本号停在 v26.2.26），改动后务必核对。

## 中继服务器部署要点（2026-07-27~28 排查结论）
- 代码：`relay-server/server.js`，`const PORT = process.env.PORT || 5689;`（**默认 5689**，2026-07-28 由 3000 改）。
  原因：服务器宿主 3000 已被占用，relay 改为监听 5689，与 nginx upstream `127.0.0.1:5689` 对齐。
- **外部映射端口应配为 `5689 → 5689`**（公网 5689 → relay 容器/进程内部 5689）。务必同步把旧的 `5689→3000`
  改掉，否则公网 5689 会转发到内部已无服务的 3000。
- **nginx 反代（域名 znhd.122050.xyz）`proxy_pass` 应为 `http://127.0.0.1:5689`**（现与 relay 监听端口一致，正确）。
  正确链路：浏览器 → 域名 → nginx → `127.0.0.1:5689` → relay。
- ⚠️ **容器化注意**：若 nginx 与 relay 是各自独立容器，`127.0.0.1` 指 nginx 自身 loopback，连不到 relay 容器。
  此时 `proxy_pass` 须用 relay 的 Docker 服务名，如 `http://znhd:5689` 或 `http://znhd-image-relay:5689`。
- ⚠️ **典型事故历史**：曾因 nginx upstream 指向外部映射端口（5689→3000 中的 5689 外部端）且内部无服务监听，
  全部 `/recv`、`/phone/*`、`/u/*` 报 `connect() failed (111: Connection refused) upstream http://127.0.0.1:5689`，
  表现为手机"连接中"、PC"无在线设备"、图片收不到。改 relay 监听 5689 + 映射对齐后解决。
- 诊断：relay 启动日志末尾应为 `http://0.0.0.0:5689`；nginx 报 `Connection refused (111)` + upstream 5689 即说明
  relay 没在该端口监听（未重启/代码未更新/容器未对齐）。手机页 HTML 由 relay 同源托管，  relay 错位时手机会"连不上"。

## 重大事故：DEPLOY_PATH 未注入导致脚本在 /root 执行（2026-07-29，真实根因，压倒性）
- **真实根因**：`appleboy/ssh-action` **不会把 GitHub Actions 的顶层 `env` 注入远程 shell**。workflow 顶层 `env.DEPLOY_PATH=/opt/znhd-service` 只存在于 runner，远程 `$DEPLOY_PATH` 为空。
- 后果：`cd "$DEPLOY_PATH"` 变成 `cd`（无参）→ 进入 SSH 登录默认家目录 `/root`；而 `cd "" 2>/dev/null` 不报错，原 `|| exit 1` 保护**完全失效**。之后 `git init/fetch/checkout -f/reset --hard/clean -fd` 全部在 `/root` 执行：
  - 把 GitHub 项目文件解出到 `/root`（用户发现「/root 下全是项目文件」）；
  - `git clean -fd` 删光 `/root` 下未跟踪文件（含 `.ssh/`、`\.bashrc`、`\.profile`、`\.gitconfig`、`\.cache` 等），造成家目录被破坏。
- 连带真相：之前所有「同步成功」日志其实都在 `/root` 跑；容器挂载源 `/opt/znhd-service/relay-server` **从未被 git 更新**，一直停 1panel 初始 v6。所以容器 /health 永远 v6 **不是「bind 失联」，而是「挂载源压根没动」**。下方『bind 挂载陷阱』段落属**早期误诊**，请以此段为准。
- **止损（已在用户服务器发生，需用户手动恢复）**：① 当前 SSH 连接勿断，另开云控制台备用终端；② 重建 `/root/.ssh` 并恢复 `authorized_keys`（否则断连后无法再登录）；③ 清走 `/root` 误入的项目文件、`rm -rf /root/.git` 让 /root 不再是仓库；④ 从 `/etc/skel` 恢复 `.bashrc/.profile`；⑤ 修复前**禁用该 workflow**，勿再 push 触发。
- **修复（已写入 deploy.yml）**：① 变量在 `script` 内**硬编码** `DEPLOY_PATH="/opt/znhd-service"` `CONTAINER_NAME="znhd"`，不再依赖 env 传递；② 加**安全阀**：cd 后 `case $(pwd)` 拒绝 `/root`、`/home`、`/` 等受保护目录，且要求 `[ -f relay-server/server.js ]` 存在才继续；③ 这样 git 强覆盖只会落在 /opt/znhd-service。

## GitHub Actions 同步 1panel Docker 的 bind 挂载陷阱（2026-07-29 结论，早期误诊，仅供参考）
- 部署架构：relay 跑在 1panel 的 node 容器 `znhd`（镜像 1panel/node:25.9.0），容器工作目录 `/app`，
  bind 挂载 `/opt/znhd-service/relay-server => /app`（读写），`run.sh` 内部 `node server.js`。
  GitHub Actions（appleboy/ssh-action）SSH 登录宿主机 → 在 `/opt/znhd-service`（仓库根 git 克隆）`git fetch/reset --hard`
  → 重启容器使其加载新代码。
- ⚠️ **核心陷阱（耗费 5 轮排查）**：git 的 `reset --hard` + `clean -fd` 更新 `relay-server/` 时会**替换该目录的 inode**。
  Docker 的 bind 挂载 `/app` 指向的是旧目录的 inode（变成「孤儿目录」，里面是旧版本），而
  `docker stop/start/restart` **都不会重新解析 bind 挂载**（容器未被销毁重建，mount namespace 不变），
  于是容器持续读到旧 v6，与磁盘 git 已是 v2 形成「日志同步成功、健康检查发现旧版」的矛盾。
- 已排除的假设（按时间）：① 私有库无读权限（SSH 已通）→ ② 挂载源有嵌套 .git（用户确认无）→
  ③ relay-server 是符号链接/被 gitignore（本地核实正常跟踪）→ ④ volume 而非 bind（用户确认三条均为 bind 挂载）。
- ✅ **最终生效方案（写进 deploy.yml）**：不再依赖 bind 自动反映、也不靠会失败的 `docker cp`（SRC 路径 `/.` 解析坑），
  改用 **`tar` 管道把最新代码直接写进容器当前看到的 `/app`**：
  `rm -rf /tmp/znhd-deploy && mkdir -p /tmp/znhd-deploy && cp -a <仓库>/relay-server/. /tmp/znhd-deploy/ && rm -rf /tmp/znhd-deploy/node_modules /tmp/znhd-deploy/.git`
  `（ cd /tmp/znhd-deploy && tar cf - . ） | docker exec -i <cid> tar xf - -C /app` → `docker restart <cid>`。
  tar 管道写入的正是容器文件系统当前挂载的 /app（无论 bind 是否失联都正确），再 restart 让 node 重新加载。
- 加**自证式健康检查**：重启后 `docker exec <cid> grep -m1 version /app/package.json` 读容器内真实版本，
  与 git 工作树 EXPECT_VER 比对，不一致则 `exit 1` 明确报错（杜绝静默失败）。
- 工作流路径：`.github/workflows/deploy.yml`；env `DEPLOY_PATH=/opt/znhd-service`、`CONTAINER_NAME=znhd`；
  Secrets 需 `SERVER_IP/USERNAME/KEY/PORT`（PASSPHRASE 留空，因为 SSH 私钥无密码）。

## 已落地的功能改进
- 工作时间可配置：DEFAULTS.workingHours（morningStart/End, afternoonStart/End），缓存 cachedWorkingHours，
  isWorkingHours() 读缓存（无配置兜底 true）；SettingsDrawer 用原生 input[type=time] 选取。
- 启动/关键节点日志走 addLog 进设置面板日志窗口（setLogEntriesCallback 在 DM 挂载 effect 注册）。
- parseInt 加基数 `,10`；删除 isChecked 死字段；常用语搜索用 String(key)/String(value) 兜底。
