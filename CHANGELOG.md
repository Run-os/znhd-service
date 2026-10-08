# 更新日志

本文件是本项目**唯一**的更新日志来源。脚本内「设置菜单 → [更新日志]」会读取它，默认展示最新 10 条，
点弹窗里的「获取更多日志」可跳转到本文件的 GitHub 页面查看全部历史。

> **新增日志的约定**：一律追加到**本文件顶部**（最新在上），标题格式 `### <脚本名或服务名> v<版本号>`，正文用无序列表。
> 脚本版本号以 `config/common.meta.json` 的 `version` 为准，标题里的版本号需与之保持一致。
> 详见 `AGENT.md` 的「更新日志约定」。
>
> **版本号规范**：脚本与服务端均采用 `YY.MM.DD-vN`（**零填充**）。`N` 是**当天第几次改动**，跨天重置为 `v1`；⚠️ **同一天内无论改几次，日期部分保持不变，只递增 `-vN`**（例：2026-10-06 当天第 2 次改动 → `26.10.06-v2`）。`znhd.user.js` 版本见头部 `@version`；`relay-server` 版本存于 `relay-server/package.json` 的 `version`（`/health` 接口返回同一版本）。每次改动需在本文件顶部补一条（形如 `### <脚本名> <版本号>`），写明改动说明。历史条目沿用旧的 `YY.M.D` 非零填充写法（如 `26.10.5-v1`、`26.7.29-v1`），**不改写**。

---

### znhd.user.js v26.10.08-v12
- **设备 ID 加边框 + 彩色底色，不同设备不同色**（按用户要求）：
  - 【设备互联】弹窗「已连接手机」下的每个设备 ID 现在是一个带**实边框**和**专属底色**的标签（原先只是纯文本）。同一台设备**颜色恒定**（跨会话稳定），不同设备取不同颜色；色板 8 色（antd 预设色阶的浅底 / 中边框 / 深字三档），沿用面板整体配色语言。
  - ⚠️ **第一版哈希有真问题，已修**：最初用 `h = h * 31 + c` 再 `>>> 0` 取模，实测**两台只差首字符的模拟手机算出了同一个颜色**（都落下标 4）——「不同设备不同色」当场失效。改为：
    1. **FNV-1a（32 位）** 替换原哈希，对「只差一个字符」的 ID 敏感；
    2. **列表内冲突顺延**（`resolveDeviceColors`）：先按哈希排序、再贪心分配色板下标，**设备数 ≤ 8 时保证互不同色**，且谁拿哪个色只取决于 ID 集合、与 `phones` 数组顺序无关。
  - 两处渲染（≥2 台的常驻多选列表、只有 1 台时的单行）统一改用 `<DeviceIdTag>`，并带 `data-device-id` / `data-color-index` 便于测试定位。
- **冒烟断言（只增不删，40 → 41 项）**：新增 **`phoneIdColorOk`** —— 每个 ID 标签必须有实边框 + 非透明底色，且**两个不同 ID 的底色必须不同**（这条正好能抓住上面那个撞色 bug）。
- ✅ **反向验证**：把标签换回纯文本 `shortPhoneId()` → 重建后**仅 `phoneIdColorOk` 变红**（`phoneListOk` 仍绿，因为它只查文本），恢复后 41 项全绿。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify`（冒烟 41 项 + 服务端 11 项）全绿、`npx @ant-design/cli lint ./src` `issues: []`；产物含 `data-device-id` / 色板 / FNV 常量，元信息（`@version` `@match` `@grant` `@require` `@updateURL`）齐全且 `==UserScript==` 成对。
- 三处版本号一致（脚本 `26.10.08-v12`）；仓库根过渡跳板已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**（等用户明确许可）。


### znhd.user.js v26.10.08-v11
- **修「预览背景仍比官方暗」——v9 只撤了自己那层遮罩，不够**（用户复反馈，实测确认根因）：
  - v9 的做法（`<Modal mask={!previewOpen}>`）**确实生效**，但预览是**全屏**浮层，底下凡是**还开着的其它弹窗 / 抽屉**，它们的遮罩**依然在画**。实测取样点上除了 `ant-image-preview-mask`，还叠着 **设置抽屉的 `.ant-drawer-mask`** ⇒ 合成 `1-(0.55×0.55)=` **0.6975**、白底灰度 **77**，和修之前一模一样。
  - **v11 修法**：预览打开时给 `documentElement` 挂 `znhd-previewing` 类，由 `uiReset.ts` 一段规则把**所有下层遮罩**压掉：
    ```css
    html.znhd-previewing .ant-modal-mask,
    html.znhd-previewing .ant-drawer-mask { display: none !important; }
    ```
    它们这时本来就被全屏预览完全盖住、对视觉毫无贡献，只是白白多加一层暗。
  - **修复后实测（独立探针，两种几何情形都测）**：取样点合成 **0.45**、白底灰度 **140**（= 官方单层值），**有/无 `body{transform}` 都是单层**。
- ⚠️ **我上一轮的测量方法是错的，必须记住**：v9 我用 `elementsFromPoint` 测出「只剩一层」就下了结论，但**冒烟页常驻的 `body{transform}` 会把挂在 body 下的弹窗遮罩困成 186px 高**，我的采样点（y=400）根本不在它覆盖范围内 —— **「没数到」被当成了「不存在」**。改法：① 采样点要选**必定被覆盖**的位置；② 关键判据改为**与几何无关的 DOM 判据**（`display` 是否为 none）。
- **冒烟断言（判据强化，条数不变 40）**：`previewSingleMaskOk` 从「历史记录自己那个 root 里没有 `.ant-modal-mask`」升级为 **① DOM：预览期间所有 `.ant-modal-mask` / `.ant-drawer-mask` 都必须是 `display:none`；② 几何：在预览遮罩上取两点，把该点所有「深色半透明」层的 alpha 合成，必须 ≤ 0.46（单层）**。
- ✅ **反向验证**：只把 CSS 规则里的两个选择器改名（等价于删掉该规则）→ 重建后**仅 `previewSingleMaskOk` 变红**——恰好复现了用户「没修好」的现象，也反证了「只撤自己那层不够」。恢复后 40 项全绿。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify`（冒烟 40 项 + 服务端 11 项）全绿、`npx @ant-design/cli lint ./src` `issues: []`。
- 三处版本号一致（脚本 `26.10.08-v11`）；仓库根过渡跳板已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.08-v10
- **历史记录为空时也能打开窗口**（按用户要求）：`MainPanel` 的入口不再提前拦截（原先「图片、文本都空」时只弹一句「暂无历史记录」、不开窗）。空态本来就由弹窗内的 `Empty`（暂无图片 / 暂无文本）呈现，去掉拦截后语义更顺。
- **标题旁新增「发送测试图片」按钮**（按用户要求）：一键从 `https://t.alcy.cc/fj` 取一张随机图，**当作手机上传**投到中继 `POST /u/<本机 deviceId>`，再经**正常的「手机 → 电脑」通道**回到本脚本、进历史记录。
  - 为什么走中继而不是本地直接塞进数组：这样这条路径与真实收图**完全一致**（中继入队 → 长轮询取走 → `onImage` → 历史），既能验证整条链路，也能同步到同一台电脑的其它标签页。代价是**必须先配置中继地址**（未配置时按钮直接给出提示、不发请求）。
  - ⚠️ 取图用 `GM_xmlhttpRequest`（`responseType: 'blob'`）而不是 `fetch`：税务页 CSP 限制 `connect-src`，跨域取图也需绕过 CORS。
  - 体积预检沿用 `imagePayloadBytes` 与 `RELAY_MAX_BODY`（与手机上传同一套判据），避免 base64 膨胀后撞 12MB 上限；成功/失败都写运行日志。
- **冒烟断言（只增不删，37 → 40 项）**：新增 `testImageBtnOk`（标题栏里真有这个按钮）、`testImageSentOk`（点它之后确实把图片 base64 POST 到了 `/u/<deviceId>`）、`historyEmptyOpenOk`（两个页签都清空后仍能打开窗口）。冒烟桩新增两个分支：`t.alcy.cc` 返回**真 Blob**（我们用的是 `responseType:'blob'`，桩必须回二进制而不是文本）、`POST /u/<deviceId>` 记录载荷。
  - ⚠️ **「清空」用例会摧毁后面断言依赖的状态**：清空图片后弹窗卸载、预览也随之关闭，而 `galleryText` / 三条预览断言原本是在**报告时刻读实时 DOM** 的 → 一度全红。已改为在 **8000ms 先取快照**（`window.__snap`），报告只读快照。**教训：同一个页面里做「先破坏状态」的用例时，其余断言必须先固化取值时刻。**
- **测试基建两处加固**：
  - `scripts/smoke/relay.js` 改为**自动挑空闲端口**（原先写死 5698，遇到上一次测试的进程未退就直接 `EADDRINUSE` 崩掉，本次实测踩到）；需要固定端口仍可用 `RELAY_TEST_PORT` 覆盖。连续两次跑分别用了 8474 / 8482，均通过。
  - **构建戳门禁当场发挥了作用**：我反向验证后恢复源码却忘了重建就跑 `verify`，被它直接拦住（提示 dist 与源码不一致）——正是 v9 加它的目的。
- ✅ **反向验证**：把「历史都空就提前拦截」加回去 → 重建后 `historyEmptyOpenOk` 与 `testImageBtnOk` **变红**（`testImageSentOk` 仍绿，因为点击发生在窗口还开着的时候），恢复后 40 项全绿。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify`（冒烟 40 项 + 服务端 11 项）全绿、`npx @ant-design/cli lint ./src` `issues: []`；产物含 `t.alcy.cc` 与「发送测试图片」。
- 三处版本号一致（脚本 `26.10.08-v10`）；仓库根过渡跳板已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.08-v9
- **修「放大预览没有官方明亮」——底下多叠了一层弹窗遮罩**（用户反馈：怀疑多了一层遮罩，实测确认）：
  - 预览是**全屏**浮层，但它下面还压着「历史记录」弹窗自己的 `.ant-modal-mask`。两层都是 `rgba(0,0,0,0.45)`，合成 `1-(0.55×0.55)=` **0.6975** —— 白底被压到灰度 **77**，而官方只有一层预览遮罩时是 **140**。
  - **修法**：`<Image.PreviewGroup preview={{ onOpenChange }}>` 跟踪预览开关，预览打开时把本弹窗的遮罩撤掉（`<Modal mask={!previewOpen}>`）。预览既然全屏盖住它，这层遮罩对视觉毫无贡献、只会让画面多暗一层。
  - 修复后实测：预览遮罩所在取样点上**只剩一层**（`elementsFromPoint` 逐点计数），合成 **0.45**、白底灰度 **140** —— 与官方一致。
- **新增「产物新鲜度门禁」，堵住「verify 静默测旧产物」这个洞**（回答「构建失败时断言为什么还能跑」）：
  - **问题**：`npm run build` 失败时 **webpack 不会更新 dist，旧产物还在**，于是 `npm run verify` 会**静默地拿旧 bundle 跑测试**。v26.10.08-v8 就踩过：tsc 报错（uiReset 模板串被反引号截断）导致构建失败，紧接着的 verify 对着旧产物报红，一度被误读成「修复没生效」。CI 里 build 是 verify 的前置步骤、失败即停，所以这个洞只在**本地手动串跑**时出现。
  - **判据用内容哈希而不是 mtime**：新增 `scripts/smoke/build-stamp.js`，`npm run build` 成功后把「构建输入（`src/**` + `package.json` + `config/common.meta.json`）的内容哈希」写入 `dist/.build-stamp`（gitignore），`verify` 前比对不一致即失败并提示先 build。
    - ⚠️ 为什么不用 mtime：webpack 的 `compareBeforeEmit`（默认开）在**输出内容没变时不重写文件**，于是「构建成功」也不代表 dist 的 mtime 变新 —— 实测会**假阳性**（只碰源码时间戳、内容未变，重建后 verify 一直报「产物比源码旧」）。
  - 四种情形均实测：① 构建后 verify 通过；② 只碰时间戳不假阳性；③ **源码变更未重建 → 拦住**（exit 1 + 明确提示）；④ 恢复后通过。
- **冒烟断言（只增不删，36 → 37 项）**：新增 **`previewSingleMaskOk`** —— 预览打开时「历史记录」弹窗自己那个 modal-root 里**不能再有 `.ant-modal-mask`**。
- ✅ **反向验证**：去掉 `mask={!previewOpen}` → 重建后**仅 `previewSingleMaskOk` 变红**，恢复后 37 项全绿。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify`（冒烟 37 项 + 服务端 11 项）全绿、`npx @ant-design/cli lint ./src` `issues: []`。
- 三处版本号一致（脚本 `26.10.08-v9`）；仓库根过渡跳板已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.08-v8
- **修「放大预览的工具栏图标看不见 / 与胶囊不在同一水平线」**（用户截图反馈，是 v7 那条的**真正根因**）：
  - **现象**：预览底部只剩一条灰色胶囊，图标浮在胶囊**上方**；因为图标是白色的，落在白底上就「看不见了」。
  - **根因**：宿主页有一条全局 `svg { margin: -2.75em auto 0 }`（约 -44px 的负上边距，本仓库 `uiReset.ts` 里早就记录过这条真实规则）。我们的**样式隔离层 `uiReset` 会把它压回 0**，但只覆盖了面板宿主 / `.ant-modal-root` / Drawer / Picker / message / notification / tooltip / dropdown —— **唯独漏了 `.ant-image-preview`**，而预览恰好**既不在面板宿主里、也不在 `.ant-modal-root` 里**（v7 起它挂在自己建的宿主 div 下），于是图标被整体顶出胶囊。
  - **实测（冒烟页常驻该规则）**：修复前 `按钮中心 − svg 中心 = 25px`（对照：弹窗关闭图标为 **0**，因为它被 uiReset 覆盖）；修复后 7 个按钮**全部为 0**、`svg.marginTop = 0px`。
  - **修复**：`uiReset.ts` 的两条 svg 规则（`vertical-align: inherit` 与 `margin: 0`）加上 `.ant-image-preview svg`。
  - 📌 **教训（已写进 AGENT.md）**：uiReset 的「按容器前缀复位」是一张**白名单**——**每新增一种浮层承载方式（如这次的预览宿主 div），都必须把它的根类名补进白名单**，否则宿主页的敌意样式就会从那道口子漏进来。
  - ⚠️ 顺带踩了 `uiReset.ts` 自己注释里警告过的坑：**CSS 注释里不能出现反引号**，否则会提前截断模板字符串（本次把 `.ant-image-preview` 写成带反引号的形式，tsc 立刻报错）。已修正。
- **冒烟断言（只增不删，35 → 36 项）**：新增 **`previewIconCenteredOk`** —— 预览工具栏里**每个带 svg 的按钮**，其 svg 中心与按钮中心的垂直偏差必须 ≤ 2px（与既有 `iconVerticallyCentered` 同一套判据）。
- ✅ **反向验证**：把 `.ant-image-preview svg` 从 uiReset 的 `margin: 0` 规则里去掉 → 重建后**仅 `previewIconCenteredOk` 变红**（其余 35 项全绿，退出码 1），恢复后 36 项全绿。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify`（冒烟 36 项 + 服务端 11 项）全绿、`npx @ant-design/cli lint ./src` `issues: []`。
- 三处版本号一致（脚本 `26.10.08-v8`）；仓库根过渡跳板已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.08-v7
- **修「点击缩略图放大后，图片盖住下方工具栏」**（用户反馈）。根因**不是**叠加顺序，而是**预览浮层挂错了地方**：
  - **排查过程（先证伪、再定位）**：在真实页面里做命中测试 —— 1~50 倍缩放下，工具栏胶囊中心与「打印」按钮中心的最上层元素**始终是按钮自己**（`topIsInFooter=true`），截图上工具栏也确实压在图片之上。**即在干净环境下复现不出来**。
  - 于是改从「本仓库记录过的宿主页坑」入手：`panelHost.tsx` 早就写过**税务页 `body` 常被加 `transform`/`filter`，会困住 `position: fixed` 的浮层**。注入 `body{transform:translateZ(0)}` 后**立刻复现**（页面滚到 y=600）：

    | | 普通 body | body 带 transform |
    |---|---|---|
    | 预览根盒子 | 视口大小 | `y=-579, h=3000`（= body 的盒子） |
    | 工具栏位置 | `y=709`（视口内） | **`y=2330`（视口外）** |
    | 「打印」按钮中心最上层 | `actions-action`（按钮自己） | **`img`（图片）** |

    即：`position: fixed` 的预览被 transformed body 困住后，以 **body 的盒子**为包含块 ⇒ 工具栏被推到视口外，图片恰好占住它原来的位置，看起来就是「图片盖住了操作栏」。
  - **修复**：给 `Image.PreviewGroup` 显式指定挂载容器 `getContainer: getPreviewHost` —— 自建一个挂在 `documentElement` 下的宿主 div（不在被 transform 的 body 里）。
  - ⚠️ **重要发现：`getContainer: getOverlayContainer`（返回 `document.documentElement`）在本 antd/rc-portal 版本下**不生效**** —— 实测预览仍被挂到 `document.body`（我们的 Modal 也是一样）。**必须传一个真实存在的子元素**（自建宿主 div）才生效。这条已写进代码注释，别改回 `getOverlayContainer`。
- **冒烟断言（只增不删，34 → 35 项）**：
  - 新增 **`previewToolbarOk`**：预览工具栏必须在视口内、且「打印」按钮正中心的最上层仍属于工具栏（= 没被放大后的图片盖住）。
  - **敌意 CSS 常驻 `body { transform: translateZ(0) }`**（`znhd-smoke.html`）：把税务页这个坑固化进测试页。它同时守卫两件事 —— 面板/弹窗挂 `documentElement` 因此不受影响，而预览必须自己躲开。
- ✅ **反向验证**：临时去掉 `getContainer` → 重建后**仅 `previewToolbarOk` 变红**（其余 34 项全绿，退出码 1），恢复后 35 项全绿。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify`（冒烟 35 项 + 服务端 11 项）全绿、`npx @ant-design/cli lint ./src` `issues: []`。
- 三处版本号一致（脚本 `26.10.08-v7`）；仓库根过渡跳板已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.08-v6
- **【设备互联】支持多台手机**（按用户要求，两端同步改造；服务端见下面 relay-server 条目）：
  - **显示已连接手机数量**：在线胶囊由「手机已连接，可发送」改为 **「已连接手机 N 台，可发送」**；下方新增「已连接手机（N）」区块，列出每台手机的**设备 ID**（UUID 取前 8 位 + `…`）。
  - **日志记录手机设备 ID**：手机**首次连接 / 断开**各记一条运行日志（`[设备互联] 手机已连接：<ID>` / `手机已断开：<ID>`），按 ID 去重，不会每 5s 刷屏。
    - ⚠️ 轮询放在 **`MainPanel`**（而不是弹窗内）：日志要**不依赖【设备互联】弹窗是否打开**都能记录。`PhoneModal` 不再自己轮询，改为接收 `phones` 属性。
  - **发送时按数量分流**（按用户要求）：**只有 1 台手机 → 直接发送**，不做任何选择；**≥2 台 → 常驻多选列表（默认全选）**，可只勾选部分手机定向发送（用户明确选择了「常驻列表」而非弹窗选择）。
    - 目标计算：全选 → `targets: 'all'`（服务端广播）；部分选中 → `targets: [手机ID...]`（服务端定向投递）；一台都没勾 → **禁止发送并记一条错误日志**（避免静默发不出去）。
    - 整批图片的目标在开始发送时**一次性算好**，发送过程中改勾选不影响本批。
  - **手机页**（`web/`）：新增**本机（手机）设备 ID** 的生成与持久化（localStorage `znhd_phone_id`），心跳与长轮询都带上它；界面同时显示 **「本机（手机）ID」** 与 **「已连接的脚本端设备ID」**（后者此前已有，本次只是把两行写清楚、不再混称「设备ID」）。
  - ⚠️ **兼容旧中继**：若中继只回 `{online:true}`（老版本），脚本退化为「1 台未知设备」，界面与发送仍可用（走 `'all'` 广播）。**这个兜底路径在验证时暴露了一个真 bug**：我原先用「手机 ID 集合拼接后是否变化」来决定是否更新 state，而兜底项的 id 是空串 ⇒ `[]` 与 `[{id:''}]` 拼接结果都是空串，被判为「没变化」，导致老中继下 `phones` 永远为空、【设备互联】显示「无在线设备」且选图按钮直接拦截。已改为**把数量也纳入比较**。这是本轮最有价值的一次反向验证收获。
- **冒烟断言（只增不删，31 → 34 项）**：新增 `phoneCountOk`（显示「已连接手机 2 台」）、`phoneListOk`（两个手机 ID 的短串都出现）、`phoneMultiPickOk`（两台时出现 **2 个复选框且默认全选**）；冒烟桩的 `/phone/status` 由 `{online:true}` 改为返回**两台手机**（两个 ID 前 8 位不同，才能验证短 ID 展示不会把两台显示成同一个）。
- ✅ **反向验证**：把 `/phone/status` 桩临时改回 `{online:true}`（模拟老中继）→ 重建后三条新断言**全部变红**；同时发现 `phoneSendCompressedOk` 也红了 → 用探针定位到上面那个 state 比较 bug → 修复后该条恢复 ✅（即：老中继兜底链路仍然可用）。随后恢复两手机桩，34 项全绿。
- 验证：`npm run typecheck` 0 错、`npm run typecheck:web` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify`（冒烟 34 项 + 服务端 11 项）全绿、`npx @ant-design/cli lint ./src` `issues: []`。
- 版本：脚本 `26.10.08-v6`；仓库根过渡跳板已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### relay-server v26.10.08-v1
- **支持多台手机 + 按手机定向投递**（与脚本 v26.10.08-v6、手机页「上传到电脑」配套，**必须三端一起升级**）：
  - **数据结构**：`phoneOnline` 由「`deviceId -> lastSeen`（一台电脑一个布尔位，多台手机互相覆盖）」改为 **`deviceId -> Map<phoneId, lastSeen>`**；`phoneWasOnline` 的键改为 `deviceId/phoneId`。
  - **`POST /phone/heartbeat/<deviceId>` 必须带 `{ phoneId }`**：手机页在 `localStorage` 生成并持久化该 UUID。⚠️ **缺失即回 400**（按用户明确选择「不兼容老手机页」，老页面会显示连接失败，刷新即升级）。
  - **`GET /phone/status/<deviceId>` 返回 `{ online, phones:[{id,lastSeen}] }`**：`online` 保留给老脚本（= `phones.length > 0`），顺手清掉已过期项，保证接口返回即时准确。
  - **定向投递**：`POST /phone/send` 的 body 可带 `targets: 'all' | [手机ID...]`（缺省 = `'all'`，兼容老脚本）。条目带 `targets` 与 `deliveredTo`：
    - **`createChannel` 新增 `perRecipient` 开关**——**正向通道（手机→电脑）保持原「广播」语义一字未动**，只有反向通道走定向逻辑，避免动到那条历史踩坑重灾区的热路径；
    - `targets='all'` 的条目**按老语义整条广播**给所有在等连接然后出队；⚠️ 它**不要求位于队头**，否则前面卡着一条「发给某台离线手机」的定向条目时，广播会被一起拖住最长 PENDING_TTL；
    - 定向条目只投给 `targets` 里、且尚未投过的手机；**没它份的连接继续等待**（不结束它的长轮询）；
    - 定向条目在「所有目标手机都收过」时才出队 ⇒ **目标离线时留在队列等它上线**（TTL 内，按用户选择）；内存始终只存一份条目，**不给每台手机复制 base64**（单图上限 12MB，复制会爆内存）。
    - 长轮询 `/phone/recv/<deviceId>` 必须带 `?phoneId=`，缺失回 400。
  - **日志**：连接/断开都带手机 ID（`[连接] 设备 X 的手机 Y 已连接`），发送日志附目标（`（发给全部手机）`/`（发给 N 台手机）`）。
- **新增服务端测试 `scripts/smoke/relay.js`（纯 Node，11 项）并接入 `npm run verify`**：
  - 为什么必须有：`createChannel` 的投递是历史踩坑重灾区，而原有冒烟走的是**浏览器里打桩的 GM_xmlhttpRequest**，根本碰不到真实服务端；定向投递只能用真实 HTTP 长轮询验。
  - 覆盖：心跳缺 phoneId 回 400、两台手机注册、status 返回手机列表、长轮询缺 phoneId 回 400、**定向条目只投给目标手机（另一台收不到）**、广播条目两台都收、**离线期间发的定向条目在目标上线后被取走**。
  - `npm run verify` 现为 `verify:smoke && verify:relay`（`verify:relay` 可单独跑）。
- 版本：`relay-server/package.json` 与 `web/package.json` 均递增为 `26.10.08-v1`（手机页产物已用 `npm run build:web` 重建并提交，CI 漂移检查通过）。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.08-v5
- **打印时不再出现浏览器页眉页脚**（按用户要求）。
  - **问题根源**：浏览器（Chrome）打印对话框里的「页眉和页脚」**默认是勾上的**，它把标题 / URL / 日期 / 页码画在**页边距区域**里。v26.10.08-v4 为了让图片离纸边 10mm，把 `@page` 的 margin 设成了 `10mm` —— 等于**主动给页眉页脚腾出了位置**。这是 v4 引入的回归。
  - **修法**：`@page { size: A4 portrait; margin: 0 }` —— 页边距归零，浏览器就没地方画页眉页脚（这也正是 react-to-print 默认 `pageStyle` 用 `margin: 0` 的原因，它自带注释 "Remove browser default header (title) and footer (url)"）。CSS 没有直接取消那个勾选项的能力，只能这样「不给它留位置」。
  - **图片离纸边的 10mm 改由内容框自己的 `padding` 提供**：内容框 = 整张 A4（210 × 294mm，留 3mm 防空白页）+ `padding: 10mm` ⇒ 图片区域仍是 190 × 274mm，观感与 v4 一致。
  - ⚠️ **`box-sizing: border-box` 这一版绝不能省**：width 已按 A4 取 210mm，若按 content-box 再加 10mm padding，实际宽度会变成 230mm ⇒ 溢出纸张、多吐空白页。
- **冒烟断言（保持 31 项，`printA4Ok` 语义扩展）**：新增两项检查 —— ① `@page` 的 `margin` 必须为 **0**（页眉页脚没地方画）；② 内容框必须有 `box-sizing: border-box` 与**正的内边距**（图片离纸边的留白真的来自 padding）。仍是**只锁语义不锁数字**。
- ✅ **反向验证**：临时把 `@page` 的 margin 改回 `10mm` → 重建后**仅 `printA4Ok` 变红**（另两条打印断言仍 ✅，退出码 1），恢复后 31 项全绿。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **31 项全绿**、`npx @ant-design/cli lint ./src` `issues: []`。
- 三处版本号一致（`26.10.08-v5`）；仓库根过渡跳板 `znhd.user.js` 已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。
- ⚠️ 仍需人工确认的部分见下条 v4：打印对话框里的「缩放/适应纸张尺寸」同样会覆盖 `@page`。


### znhd.user.js v26.10.08-v4
- **打印图片时按 A4 纸自适应**（按用户要求；库仍是 `react-to-print`，不换库）：
  - **`pageStyle` 注入纸型**：`@page { size: A4 portrait; margin: 10mm }` —— 浏览器在用户没改纸张时默认按 A4 纵向出纸。同时 `html, body { margin: 0; padding: 0 }`（**必需**，见下）。
  - **图片框 = A4 可用区**（210−10×2 = **190mm** × 297−10×2−3 = **274mm**），图片 `object-fit: contain` 等比缩放后居中 ⇒ **整张图必定完整落在同一页**，不裁切、不跨页；小图会被放大铺满，大图缩小。
  - ⚠️ **两个必踩的坑**（都写进 `AGENT.md` 历史踩坑索引了）：
    1. **打印 iframe 的 `body` 默认有 8px 外边距**，不写 `html, body { margin: 0 }` 会把 190×274mm 的图片框整体挤出内容盒 → **多吐一张空白页**；
    2. 图片框高度**正好等于**内容盒高度（277mm）时，部分浏览器/打印驱动会因舍入**再吐一张空白页** ⇒ 故意留 3mm 余量取 274mm。
  - 容器另加 `overflow: hidden` 作二道保险：即便某浏览器不认 `object-fit`，也不会把内容顶出纸张触发分页。
  - 参考了用户给的《React函数组件中React-to-print自定义打印页面尺寸问题》一文（`@page` 直接注入比外部 CSS 可靠、容器尺寸必须与纸张对应）。⚠️ **该文的 `content: () => componentRef.current` 是 react-to-print v2 的 API，v3 已改为「可选内容工厂」**，故只借其版式思路，代码仍用 v3 写法（`doPrint(() => node)`），没有照抄。
  - ⚠️ **CSS 管不到的部分**：打印对话框里的「缩放 / 适应纸张尺寸」会**覆盖** `@page size`（选「适应纸张」时浏览器会再缩一次）。已写进 ReadMe 的提示，需用户侧确认该项为 100%/无。
- **冒烟断言（只增不删，30 → 31 项）**：新增 **`printA4Ok`** —— 向打印 iframe 的文档里查三件事：① 注入的 `<style>` 含 `@page` + `size: A4`；② 图片框是毫米尺寸且**不大于 A4 本身**（超了必然溢出纸张触发分页）；③ 图片样式含 `object-fit: contain`。**只锁语义、不锁具体数字**：日后调页边距常量不会把断言打红，但删掉/写错 A4 版式一定会红。
- ✅ **反向验证**：临时把 `pageStyle` 里的 `size: A4 portrait;` 去掉 → 重建后仅 `printA4Ok` **变红**（`printBtnOk` / `printIframeOk` 仍 ✅，退出码 1），恢复后 31 项全绿。证明它锁的确实是 A4 版式，而不是顺带为真。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **31 项全绿**、`npx @ant-design/cli lint ./src` `issues: []`。
- 三处版本号一致（`26.10.08-v4`）；仓库根过渡跳板 `znhd.user.js` 已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.08-v3
- **面板入口「历史文件」改名为「历史记录」，并把「收到的文本」也纳入历史**（按用户要求）：弹窗由「只放图片的画廊」升级为**「图片 / 文本」两个页签**。
  - **图片页签**：原有内容与交互**原样保留**（3 列九宫格、`Image.PreviewGroup` 放大、预览工具栏的「打印」、单张复制/下载/×），上限仍 `MAX_GALLERY=27`。
  - **文本页签**（新增）：回看收到的文本，**最新一条在最上**，每条显示 `MM-DD HH:mm:ss` 收到时间，支持「复制」（`safeCopyText`，会真实回传成功/失败）与单条 × 删除；上限新增常量 **`MAX_TEXT=100`**（文本是小字符串，无需与图片同样紧）。
  - ⚠️ **「收到就自动弹窗」的行为保持不变**（按用户明确选择）：收到图片仍自动弹「历史记录」并停在图片页签，收到文本仍自动弹原来的「最新一条」文本窗。历史记录是**额外**的可回看通道，不是替代。
    - 因此主面板里 `recvText`（自动弹窗用的最新一条）与 `recvTexts`（历史数组）是**两条独立状态**，别误合并成一条。
  - **清空按钮按页签区分**：`清空图片` / `清空文本`，**只清当前页签**。页签化之后沿用「清空全部」会让人误以为连另一页也一起清掉；清空后仍按旧行为关闭弹窗。
  - 弹窗改为每次打开**回到图片页签**（收到新图自动弹窗时不应停在用户上次看的文本页）。
  - 组件随职责改名：`ui/RecvGalleryModal.tsx` → **`ui/RecvHistoryModal.tsx`**；`lib/gallery.ts` 增加 `GalleryText` 类型与 `MAX_TEXT`，文件头注释同步改写。
  - 入口为空时的提示由「暂无待存文件」改为「暂无历史记录」（图片、文本**都空**才提示）。
  - 顺带删掉 `RecvGalleryModal` 里**一直未被使用**的 `notify` 导入（eslint warning 5 → 4）。
- **冒烟断言（只改不删，28 → 30 项）**：
  - `galleryText` 断言对象随题改：标题由「收到的图片」变为「历史记录」，故改为「标题含『历史记录』的弹窗里真的渲染出了 antd 缩略图」——**改到同类对象上，不是删除**。
  - 新增 **`historyTabsOk`**：弹窗里必须有且仅有「图片（N）」「文本（M）」两个页签且顺序一致。
  - 新增 **`historyTextOk`**：切到「文本」页签后能回看到之前收到的那条文本（= 文本真的**进了历史**，而不只是弹窗显示过）。
  - `panelBtnsUniform` / `panelBtnsOneRow` 里写死的 `['设置','常用语','历史文件','设备互联']` 同步改为「历史记录」——这两条断言因此也**顺带守住了本次改名**。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **30 项全绿**、`npx @ant-design/cli lint ./src` `issues: []`。
- 三处版本号一致（`26.10.08-v3`）；仓库根过渡跳板 `znhd.user.js` 已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.08-v2
- **「打印」入口从缩略图行挪到「放大预览的工具栏」**（按用户要求；v26.10.08-v1 是放在缩略图下方按钮行里的）：
  - 缩略图下方按钮行恢复为「复制 / 下载 / ×」三个；点开大图后，在 antd 预览底部那排缩放/旋转图标**末尾**多出打印机图标。
  - 用 antd v6 预览的 **`actionsRender`** 实现（`toolbarRender` 已废弃），挂在 `<Image.PreviewGroup preview={{ actionsRender }}>` 上（同时作用于整组图，`info.current` 给出当前图下标）。
  - ⚠️ **必须用 `cloneElement` 把按钮追加进 antd 自己的 `.ant-image-preview-actions` 容器，不能直接当 `originalNode` 的兄弟节点返回**：工具栏的胶囊背景与圆角长在 actions 容器上，而它的父级 `footer` 是 `flex-direction: column` —— 放外面会渲染成「工具栏下方一个没有背景的裸按钮」。按钮复用 antd 自己的 `ant-image-preview-actions-action` 类，尺寸/悬停与自带图标一致。
  - 目标是**当前正在看的那张图的原图**：优先按 `info.image.url` 反查 `previewUrl`（`items` 与 `images` 同序，但按 url 更稳），退回 `info.current` 下标。
  - 新增直接依赖 **`@ant-design/icons` ^6.3.4**（此前只是 antd 的传递依赖；只用到 `PrinterOutlined` 一个图标，从包根导入，可被 tree-shaking）。
- **冒烟断言（保持 28 项，语义随位置升级）**：`printBtnOk` 由「画廊里有文案为『打印』的按钮」改为「按钮必须长在 `.ant-image-preview-actions` 胶囊容器**里面**且带 svg 图标」——若有人把入口挪回缩略图行，该断言会直接变红。点击时机改为**轮询等待**预览工具栏就绪（预览在 3600ms 由缩略图点开），避免与其它弹窗的时序耦合。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **28 项全绿**、`npx @ant-design/cli lint ./src` `issues: []`。
- 三处版本号一致（`26.10.08-v2`）；仓库根过渡跳板 `znhd.user.js` 已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.08-v1
- **「收到的图片」画廊弹窗新增「打印」按钮**（按用户要求）：每张图下方按钮行由「复制 / 下载 / ×」变为「复制 / 下载 / 打印 / ×」，点「打印」直接拉起浏览器打印对话框打印**该图原图**。
  - **背景**：放大查看用的是 antd `Image.PreviewGroup`（v26.10.06-v13 起，替代 Viewer.js），它自带缩放/旋转/多图切换，但**没有任何打印能力**；主流灯箱（Fancybox / lightGallery / PhotoSwipe / Yet Another React Lightbox）同样都没有内置打印插件。故新增一个打印库：**[react-to-print](https://github.com/MatthewHerbst/react-to-print) 3.3.0**（MIT，随产物打包，非 `@require`）。
  - ⚠️ **打印内容用「临时构造的游离节点」，不能用隐藏容器**：`react-to-print` 是对内容节点做 `cloneNode(true)` 再塞进打印 iframe，而 **`cloneNode` 会连内联样式一起克隆** —— 用 `display:none` 或 `left:-99999px` 隐藏的容器在打印 iframe 里同样不可见，**打印出来是空白**。改为在点击时 `document.createElement` 构造 div + img、通过 hook 的「可选内容工厂」`doPrint(() => node)` 传入：节点只带我们给的打印样式，且不进渲染树（不会「闪一下大图」）。
  - ⚠️ **`ignoreGlobalStyles` 必须显式设 `true`**：它的默认行为是把宿主页面**全部** `<style>`/`<link>` 抄进打印 iframe，税务页那一大坨 CSS 会跟着进去（跨域样式表读 `cssRules` 还会告警）。同时用 `pageStyle: '@page { margin: 10mm }'` 给打印页边距，`documentTitle` 设为文件名（打印对话框标题）。
  - **打印的是原图**（`previewUrl` 原分辨率 objectURL），不是预览里缩放/旋转后的画面 —— 清晰度最好；代价是「所见即所得」不成立（要那个得上 html2canvas 光栅化，体积大且失真）。
  - ⚠️ **打印对话框弹出期间不能移除该图**：`onRemove`/`onClear` 会 `revokeObjectURL`，objectURL 一旦失效打印就是空白。弹窗底部提示已加说明。
- **冒烟断言（只改不删，26 → 28 项）**：
  - 新增 `printBtnOk`：画廊弹窗里必须存在文案为「打印」的按钮。
  - 新增 `printIframeOk`：点「打印」后 react-to-print 必须真的建出 `id=printWindow` 的打印 iframe。⚠️ headless 里没有打印对话框、且桌面 UA 下该 iframe 打印完会被**立刻移除**，所以不能用「iframe 还在不在」判断——改为在测试页 head 里用 `MutationObserver` 在**插入那一刻**记录（`window.__printIframeSeen`）。该 iframe 只在「找到了内容节点」时才会被挂上（react-to-print 拿不到内容会直接 return），因此它出现 = 「按钮 → printImage → doPrint」整条链路真的接通。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **28 项全绿**、`npx @ant-design/cli lint ./src` `issues: []`。
- 三处版本号一致（`26.10.08-v1`）；仓库根过渡跳板 `znhd.user.js` 已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.07-v4
- **「运行日志」弹窗：最新日志改为显示在底部，并新增「自动刷新」开关 + 自动滚到底部**（按用户要求；**反转了 v26.10.06-v23 的「最新在顶部」**）：
  - **排序**：`logger.ts` 的写入顺序仍是「最新在前」（`[logItem, ...prevEntries]`），改为**渲染前把数组反过来**（`shown.slice().reverse()`）⇒ DOM 顺序 = 视觉顺序 = 最旧在上、**最新在下**。容器保持 `column`，**不是 `column-reverse`** —— 后者会把滚动原点翻到底部、阅读方向也跟着反过来。文件头那段「勿改回 column-reverse」的注释已按新需求改写。
  - **自动刷新开关（持久化）**：底部状态栏新增 `Switch`，默认开。开 = 新日志持续进来并自动滚到底部；关 = 列表**冻结**在关闭那一刻的快照，状态栏显示「· 已冻结」。
    - ⚠️ 冻结必须在**关掉之前**先 `setSnapshot(logEntries)`：否则 `source` 立刻切到空快照，列表会瞬间清空。
    - 新增设置项 `DEFAULTS.logAutoRefresh`（`constants.ts`）+ `runtime.logAutoRefresh`（`state.ts`）；`Allvalue = typeof DEFAULTS` 自动带上该字段，`storage.ts` 无需改动。
  - **自动滚到底部**：按用户明确选择「**总是滚到底**」——开着时只要有新日志就拉到底部，不做「仅在已贴底时跟随」的智能判断（往上翻看历史时会被拉回，不想被打断就关掉开关）。
  - ⚠️ **首屏滚动必须用回调 ref，不能只靠 `useEffect`**：本弹窗用了 `destroyOnHidden`，antd Modal 是在 `open` **之后**才把内容挂进 DOM 的，effect 触发时 `scrollerRef.current` 仍是 `null` ⇒「打开就停在最顶部」。实测（17 行日志、`scrollHeight 630 > clientHeight 358`，确实可滚动）：`scrollTop` 恒为 **0**；改用回调 ref 在节点挂载那一刻滚之后，`scrollTop = 272 = scrollHeight - clientHeight`（`distanceToBottom: 0`）。
- **冒烟断言（只改不删，24 → 26 项）**：
  - `logNewestOnTop`（首行时间戳 ≥ 末行）→ 反转为 **`logNewestOnBottom`**（末行 ≥ 首行）：原断言锁「最新在上」，需求反转后按新语义锁「最新在下」。
  - `logListNotReversed` 保留、标签改写为「日志列表仍是 column（非 column-reverse）」：它锁的不变量（DOM 顺序 = 视觉顺序）在新需求下依然成立，且正是防止有人用 `column-reverse` 去「实现」最新在底部。
  - **新增 `logAutoRefreshToggle`**：日志弹窗底部状态栏必须有 `Switch`、文案含「自动刷新」、且默认处于 `ant-switch-checked`。
  - **新增 `logAutoScrollBottom`**：滚动条必须已在底部。⚠️ 先要求「真的可滚动」（`scrollHeight > clientHeight + 2`）——否则内容没超出高度时 `scrollTop` 恒为 0，断言永远为真（假绿）。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **26 项全绿**、`npx @ant-design/cli lint ./src` `issues: []`。
  - `logAutoScrollBottom` 经历过一次**真实的反向验证**：修复前它就是 ❌（探针实测 `scrollTop: 0`），修复后才变 ✅ —— 这条断言确实能抓到「自动滚动没生效」，不是假绿。
- 三处版本号一致（`26.10.07-v4`）；仓库根过渡跳板 `znhd.user.js` 已重新拷贝为与 `dist/znhd.user.js` 逐字节一致。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.07-v3
- **主面板四个入口按钮合并为一行，并去掉「设置」的主色实心样式**（按用户要求）：
  - 版式：原 **2×2 栅格** → **一行四列**（`repeat(4, minmax(0, 1fr))`，间距 8→6）。面板内容区仅 316px，四列平分后每个 74px，纵向因此少占约 40px。
  - 样式：四个按钮**完全一致**（都是 antd 默认按钮），原先「设置」独占的 `color="primary" variant="solid"` 已移除。
  - **宽度自适应**（按用户要求）：宽度不足只留图标、足够时图标+文字同排，两种状态下悬停都有 **Tooltip** 给出完整文案。用 **CSS 容器查询**实现（`.znhd-panel-btn { container-type: inline-size }` + `@container (min-width: 68px)`）。
    - 阈值依据（实测 Chrome 154）：容器查询按**内容盒**算 —— 按钮 74px 减去内边距 4×2 与边框 1×2 只剩 **64px**；横排所需 = emoji 18px + 间距 2px + 「历史文件」4 字 × 11px = **64px**，正好卡边界会折行，故阈值取 68px。**当前 64px < 68px → 按用户选择只显示图标**；面板若加宽到约 78px/按钮，文字会自动出现，无需改代码。
    - ⚠️ 文字用 `display: none` 隐藏而**不是条件渲染**：文字必须留在 DOM 里，否则冒烟按 textContent 找按钮的 `clickByText('设置')` 会直接失败；它同时是纯图标态的可访问名。
    - ⚠️ 用容器查询而非 JS 测量：按钮在 grid 内宽度由栅格决定、与自身内容无关，不存在「隐藏文字→按钮变窄→反过来触发隐藏」的抖动回路。
- **悬浮球（面板收起后）支持拖动移动位置**（按用户要求；此前只有展开态标题栏能拖）：
  - `usePanelDrag` 的处理器改为**标题栏与悬浮球共用**；悬浮球同时保留「点击展开」。
  - ⚠️ **必须区分「拖动」与「点击」**：实测 Chrome 154 下 `pointerdown` 里调用 `preventDefault()` **并不能**阻止 `click` —— 原地点击序列 `pd|pu|click`，拖拽序列 `pd|pm×N|pu|click`，两者最后都会派发 click。若不区分，**拖完一松手面板会被顺带展开**。故引入 `DRAG_THRESHOLD = 4px` 与 `consumeDrag()`：位移超阈值记为拖动，悬浮球的 onClick 先 `consumeDrag()`，是拖动尾巴就吃掉这次点击（取走即复位，避免残留到下一次键盘触发的 click）。
  - ⚠️ 顺带修掉一个被这次改动暴露的裁剪缺陷：`clampPanelPoint` 的保留量原先恒为 `MIN_VISIBLE = 48`，而悬浮球只有 36px 宽 → `minX` 被算成 **+12**，表现为「悬浮球永远拖不到视口最左侧」。改为 `Math.min(48, 元素宽度)`；面板宽 340 > 48，**行为与旧实现完全一致**。
  - 新增 `clampHostIntoView(host)`：悬浮球可以被拖到贴边，但**展开回面板时按面板真实宽度重新裁回视口**，否则「从屏幕右下角展开」会出现面板大半在屏幕外、抓不回来。
- **冒烟断言同步调整（只改不删，22 → 24 项）**：
  - `settingsBtnBlue`（断言「设置」按钮必须是 #1677FF 实心蓝底）→ 改为 **`panelBtnsUniform`**：四个入口按钮底色必须一致、且都不是主色实心蓝（原断言锁「主色用对」，现按新需求锁「四个按钮一致」）。
  - `primaryTokenBlue`：主色 token 改从**语音播报 Switch** 上读（原从「设置」按钮读，该按钮已无主色）。Switch 选中态本身就是主色，仍在同一条 antd css-var 继承链下，验证「宿主页面 CSS 未污染 `--ant-color-primary`」的意图不变。
  - **新增 `panelBtnsOneRow`**：四个入口按钮必须同一 `offsetTop`。
  - **新增 `ballDragOk`**：收起面板 → 用**真实指针事件**（puppeteer 侧，合成 PointerEvent 会让 `setPointerCapture` 抛 NotFoundError）把悬浮球拖走 → 断言宿主 left/top 真的变了**且没有被顺带展开**。落点前先校验 `elementFromPoint` 命中悬浮球本身，避免被残留浮层盖住时假绿。
- **脚本元信息清理：`@connect` 去掉写死的 `znhd-service.zeabur.app`，只保留通配 `*`**（用户明确要求）：
  - 依据与产物头注释一致 —— 中继服务器地址由用户在设置面板自定义、**域名不固定**，无法收窄为固定域名；写死某个域名既无意义，也容易让人误以为只能连它。
  - ⚠️ 旧审查存档 `.workbuddy/reviews/znhd-userjs-review.md` 的 6.1 条曾建议「把 `@connect *` 收窄为 `github.com` + `znhd-service.zeabur.app`」——**该建议不采纳**（历史存档不改写，结论记在此处与 `AGENT.md` 的 bannerNotes）。
  - `config/dev.meta.json` 没有 `connect` 字段（dev 侧 `Object.assign(commonMeta, devMeta)` 继承），故 dev 产物自动同步；已重建 `dist/znhd.dev.user.js` 确认其为 `@connect *`。
- **主面板整体缩窄 30%：`PANEL_WIDTH` 340 → 238px**（按用户要求）：
  - ⚠️ **宽度常量原先有两份**：`MainPanel.tsx` 里的 `PANEL_WIDTH`，以及 `panelHost.tsx` 的 `initialPoint()` 里**硬编码的 `340`**（初始坐标粗裁剪）。只改一处会让存档在右侧的面板**每次加载都往左漂** —— 先按 340 收一次，随后按真实 238 的那次不会再把它推回去。
  - 故把 `PANEL_WIDTH` 移到 `src/lib/ui/panelIds.ts`（该文件的定位本就是「UI 共享常量，单独成文件以避免循环依赖」），`MainPanel` 与 `panelHost` 共用同一份。
  - 缩窄后实测版式（Chrome 154）：四入口每列 **48.5px**（内容盒 38.5px）→ 仍在容器查询阈值 68px 之下，保持纯图标；人数/状态卡、语音开关行、底部「上次播报 + 查看日志」均放得下。
  - ⚠️ **标题栏是唯一被挤到边界的**：内容实测 **191px**、可用仅 **189px**（溢出 2px）。已把标题栏 `gap` 8→6 收回 4px，并给标题加 `minWidth: 0` + `overflow/text-overflow/white-space` 兜底 —— 字体渲染略有差异时让标题自己省略，而不是把右侧的 ✕ 挤出去。复测面板内**零横向溢出元素**，标题仍是完整 90px 单行（未被省略）。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **24 项全绿**、`npx @ant-design/cli lint ./src` `issues: []`；**并对 `ballDragOk` 做了反向验证**（临时摘掉悬浮球的拖拽处理器 → 该断言确实变红，排除假绿）。实测拖拽位移与请求一致（−120/+120），拖后 `isBall: true` 未被展开。
- 三处版本号一致（`26.10.07-v3`）；仓库根过渡跳板 `znhd.user.js` 已重新拷贝为与 `dist/znhd.user.js` **逐字节一致**（`node --check` 通过）。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.07-v2
- **明确项目许可证为 MIT，并补上此前缺失的许可证文件**：
  - 新增仓库根 `LICENSE`（MIT 全文，`Copyright (c) 2026 Run-os`）。此前 ReadMe 只写了「MIT License」四个字、仓库里**没有 LICENSE 文件**，属于声明与事实不符。
  - 脚本元信息新增 **`@license MIT`**（`config/common.meta.json`，紧随 `author`），随构建写入产物头——油猴/ScriptCat 的脚本详情页会显示它，许可证因此随产物一起分发（这是本次唯一影响产物体的改动，故升版本号）。
  - **选型依据（有据可查）**：随产物打包的依赖全部是 MIT —— react / react-dom / antd / @ant-design/icons / @ant-design/cssinjs / js-yaml；运行时经 `@require` 按需加载的 qrcodejs、heic2any 同为 MIT；`relay-server` 零运行时依赖。**MIT 与之天然兼容且不引入额外义务**，也是油猴脚本生态的通行选择（ReadMe 原本已声明 MIT，本次是把声明坐实）。
- **ReadMe 更新**：
  - **删除「使用教程」链接**（原 `## 联系方式` 里指向 flowus.cn 的那条，按用户要求移除）；
  - 「许可证」章节写实：说明 MIT 的含义（可自由使用/修改/分发含商用，需保留版权与许可声明、无担保）、指向 `LICENSE` 文件、并列出第三方依赖的许可与兼容性说明；
  - 顺手修正「项目地址」大小写：`github.com/runos/...` → **`github.com/Run-os/...`**（与 `@homepageURL`、git remote 一致；GitHub 对 owner 大小写不敏感所以原本不算坏链，但属文档与代码不符，按 AGENT.md 规则 11 直接修）。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **22 项全绿**、产物头确认含 `@license MIT`、三处版本号一致（`26.10.07-v2`）。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.07-v1
- **「运行日志」弹窗重构为专业暗色终端风**（依据仓库根《运行日志样式重构-开发文档.md》，**只改 `src/lib/ui/LogModal.tsx` 一个源文件**）：
  - 日志区：底色 `#0f141a`、等宽字体栈（`SF Mono/Consolas/Menlo/Courier New`）、12.5px / 行高 1.9、`border: 1px solid #1f2733`、圆角 4，高度仍 360、自身滚动。
  - 每行改**三栏 flex**：时间戳固定 86px（弱灰 `#52667a`）· 类型标签固定 52px（类型色 + 600 字重）· 消息自适应（`#c3d1df`，保留 `pre-wrap` + `break-word` 防溢出）。
  - 行级提示：错误 `rgba(255,77,79,.08)`、警告 `rgba(250,173,20,.07)`、成功 `rgba(82,196,26,.06)` 整行底色 + 左侧 3px 色条；信息行不设底色。行 hover 高亮 `rgba(127,127,127,.12)`。
  - 筛选 chips 改为**带计数的彩色徽章**（如「成功 3」）：背景取类型色，亮色类型用深色字（`#08130c`/`#332a0a`）、深色类型用白字；关闭态为描边弱化样式。**筛选/全隐全显/清空逻辑一字未改**。
  - 底部新增**状态栏**（`border-top: 1px solid #1f2733`）：`共 N 条 · 显示 M 条（全类型/已选）` 与右侧 `最新 HH:MM:SS`（monospace + 类型色），替代原说明文字。
  - hover 是 `:hover` 伪类、内联 style 表达不了，故**在本文件内注入一小段 scoped CSS**（类名统一 `znhd-log-` 前缀）——纯 CSS、零依赖、不动全局样式。
  - 排序沿用 v26.10.06-v23 的**最新在最上方**（`column` + logger 的「最新在前」数组，无需 JS 锚定）。
- 冒烟断言 21 → **22 项全绿**：新增「日志区为暗色终端风（底色/三栏/状态栏）」；两条排序断言由「整行文本匹配」升级为按 `.znhd-log-row` / `.znhd-log-ts` 定位（**被测对象变了就把断言改到新对象上，而不是删掉**）。
  - 踩坑：新断言初版用 `document.querySelector('.ant-modal-body')` 取弹窗正文，但报告时刻多个弹窗并存 → 取到了别的弹窗而**假失败**；改为从日志行 `closest('.ant-modal-body')` 就近向上找。**属断言写错，非产物问题。**
- ⚠️ **未完全满足文档验收项 5（产物体积不增加）**：`dist/znhd.user.js` 815,932 B（796.8 KB）→ **817,047 B，+1,115 B（+0.14%）**。原因：文档自己要求的行底色/左色条/三栏结构/hover CSS/底部状态栏都会增加字节，且**未引入任何依赖**（`package.json` 除版本号外无改动、`package-lock.json` 无变化）。若要严格净零增长，只能砍掉状态栏或 hover 等规格项——请知悉后决定。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **22 项全绿**；跨天按规则新建日期段 `26.10.07-v1`（三处版本号一致）。
- ⚠️ **只做本地提交，未推送**：本文档 §6.5 要求 `git push`，但用户现行规则是「未经明确许可不得推送」，以用户规则为准。


### znhd.user.js v26.10.06-v23
- **运行日志改为「从上到下生成、最新在最上方」**：`LogModal.tsx` 的列表容器由 `flexDirection: column-reverse` 改回 `column`。
  - 无需新增任何 JS：`logger.ts` 本来就是 `[logItem, ...prevEntries]`（**最新在前**），容器用默认 `column` 后最新一条自然落在顶部，视口也天然停在顶部，不存在"被拽回"的问题。
  - 历史写法 `column-reverse` 是把最新一条**翻到底部**并自动锚底（当年为避免写 JS 滚动而用的小技巧）；本次按用户要求改回直觉顺序。**已把这段取舍写进文件头注释**，并提醒：若日后想改回去，注意那会同时改变阅读方向。
  - 底部提示文案同步改为「**新日志出现在最上方**，向下翻阅历史时不会被拉回」（原文案是"最下方…向上翻阅"，不改就是错的）。
- 冒烟新增两条断言（19 → **21 项全绿**），并为此在时间轴上新增一步（10600ms 打开日志弹窗，报告 11000ms 采集）：
  - `logListNotReversed`：日志行容器的 `flexDirection !== 'column-reverse'`；
  - `logNewestOnTop`：**首行时间戳 ≥ 末行时间戳**（日志行是 `HH:MM:SS - 正文` 纯文本 div，用时间戳比较判定排序方向，与具体内容无关，不会因日志文案变化而失效）。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **21 项全绿**。
- ⚠️ **只做本地提交，未推送**。


### znhd.user.js v26.10.06-v22
- **面板主色改为 antd 官方蓝色系**：`ConfigProvider` 的 `colorPrimary` 由原税务绿 `#007e44` 改为 **blue-6 `#1677FF`**（依据 antd 色彩规范：`docs/spec/colors-cn`）。
  - 只改这一个 token，antd 会自动派生 hover/active/focus 与浅色底 → **「设置」实心按钮**与**语音 Switch 选中态背景**（本次要求的两处）以及链接、焦点环一起同步变蓝。
  - 顺带修掉一处**配色不一致**：面板里「当前等待人数」数值与「工作时段内」状态点此前硬编码 `#1677ff`，而主色是绿——现在统一为同一支蓝。
  - 手机弹窗「发送中」进度条的成功色也由 `#007e44` 改为 `#1677ff`（属主色用法）。
  - ⚠️ **语义色不跟着变**：在线/已连接/日志「成功」仍是 success 绿（`#52c41a`/`#389e0d`），错误红、警告黄同理。规范里**主色与状态色是两套东西**，混用会让人把主色误读成「状态正常」。
- 冒烟新增两条断言（17 → **19 项全绿**）：`primaryTokenBlue`（主色 token 为 `#1677ff`）、`settingsBtnBlue`（「设置」按钮实际渲染色为 `rgb(22,119,255)`）。
  - ⚠️ 踩坑（属**断言写错**、非产物问题）：token 断言初版从**面板宿主元素**读 `--ant-color-primary` 而失败——该变量由 antd 的 css-var 包裹元素定义并**向下继承**，宿主自身没有；必须从作用域内的子元素（那个按钮）读。**判定依据**：同一轮里「按钮渲染色」断言已通过，两条互相印证即可定位是测试侧问题。
- 验证：`npm run typecheck` 0 错、`npm run build` 结论行 `compiled`、`npm run check` 通过、`npm run verify` **19 项全绿**。
- ⚠️ **只做本地提交，未推送**。


### relay-server v26.10.06-v3
- **手机上传页整页重写为 React 19 + Ant Design v6 单页应用**（原为 700 余行内联 HTML + 原生 JS）。源码在新增的 `web/`，由 Vite 构建到 `relay-server/public/`（产物提交进仓库）；中继运行时不装依赖、不构建，只把 `public/index.html` 与 `/assets/*` 同源托管 —— **页面依旧零第三方请求**，上一轮「首屏被 CDN 拖到 10.8s」的问题不会被重新引入。
- 结构变化：
  - `relay-server/upload-page.js` 不再内联整页，只读取/返回构建产物；产物缺失时给可读兜底页而不是 500。
  - `server.js` 新增 `/assets/*` 静态托管（正确 MIME、`immutable` 长缓存、**内置 zlib gzip：746KB → 240KB**，中继仍零依赖）+ 目录穿越防护 + 页面 `no-cache`。
  - 网络与压缩逻辑（心跳、长轮询看门狗、canvas 压缩、HEIC 懒加载）**逐条移植**到 `web/src/lib/{relay,image,heic}.ts`；两处实测结论（heartbeat 不依赖 AbortController、pollRecv 读响应体前禁止 abort）原样保留。
  - 收件图片预览改用 antd `Image.PreviewGroup`（多图切换/放大/旋转），**移除 Viewer.js 依赖**（少一个第三方库及其 CSS）。
- **响应式**：手机单列；`md` 及以上两列（左：图片，右：文本/说明），容器 560px → 1040px；「查看收到的图片」仍在「发送图片到电脑」正下方。
- ⚠️ **代价（方案 B 的已知取舍）**：页面需先下载并挂载 React+antd 才出现内容，产物 **745.95 kB（gzip 242.42 kB）**。已用内联首屏占位缓解白屏观感；静态资源带内容 hash 可长缓存，二次访问命中缓存。
- 构建与门禁：新增 `npm run build:web`（= `npm --prefix web run build`）与 `npm run typecheck:web`；CI 增加「装 web 依赖 → web 类型检查 → 构建 → **产物漂移检查**」，源码改了却忘记重建提交会直接失败。
- 版本：relay `package.json` → `26.10.06-v3`（页面显示版本由构建期从该文件注入）。
- 验证：手机（iPhone 14 视口 390×844）与桌面（1440×900）实拍确认布局；真实浏览器跑通「选 3 张图 → canvas 压缩 124KB→80KB → 进度 0/3→1/3→2/3→✅ 3/3 → 待发列表清空」共 10/10 断言；「电脑 → 手机」收图/收文本弹窗实测正常；静态回归 18 项通过（零第三方外链、gzip、immutable、目录穿越返回 403、缺资源 404、版本自证）。

### znhd.user.js v26.10.06-v20
- **全部 UI 滚动条改为细浮层样式**（原来用 Windows 默认滚动条：约 17px、带上下箭头，嵌在圆角弹窗里很生硬）。
- 先说结论（已用官方 CLI 核实）：**antd 没有滚动条组件，也没有 scrollbar 相关的 design token**：
  - `npx @ant-design/cli info Scrollbar` → `Component 'Scrollbar' not found`；
  - `npx @ant-design/cli token` → `scroll/thumb/track` **零匹配**（同一命令查 `borderRadius`/`fontSize`/`colorBgLayout` 都正常，说明查询方式没问题）；
  - antd 自己只在内部依赖 `@rc-component/virtual-list`（v1.5.2）里给虚拟列表自绘滚动条，**不对外导出**为通用组件。
  - 所以 antd 的通用做法就是**定制浏览器原生滚动条（CSS）**，本项目照此实现。
- 实现位置：`lib/ui/uiReset.ts`（现有的样式隔离层，按本脚本容器加前缀注入，**不碰宿主页面**）：
  - 标准属性 `scrollbar-width: thin` + `scrollbar-color: rgba(0,0,0,.25) transparent`（Firefox + Chrome 121+）；
  - `::-webkit-scrollbar` / `-thumb` / `-track`（旧版 Chromium/Edge）：10px 槽宽 + **3px 透明边框 + `background-clip: padding-box`** → 视觉上是一条细圆角灰条，hover 时加深。
  - 实测（headless Chrome）：`scrollbar-width: thin`、`scrollbar-color: rgba(0, 0, 0, 0.25) rgba(0, 0, 0, 0)`，且 `offsetWidth === clientWidth`（**不再占布局宽度**，即 Chrome 已切换为浮层滚动条、静置时自动隐藏）。
- ⚠️ 踩坑：这段 CSS 写在模板字符串里，我第一版注释中用了反引号（`` `info Scrollbar` ``）→ **模板串被提前截断**，`tsc` 报 TS1128/TS1109，而 `npm run build` 的失败被 `Select-Object -Last 1` 掩盖、产物仍是旧文件（差点误判成"已生效"）。**模板字符串内一律不用反引号**，且构建后必须验证产物里真的有新内容。
- 验证：`npm run typecheck` 0 错；`npm run build` 成功且产物内确认含 `scrollbar-width`/`scrollbar-color`/`::-webkit-scrollbar`/`background-clip`；`npm run verify` **16 项全绿**。
- ⚠️ **只做本地提交，未推送**（等你确认后再推）。

### znhd.user.js v26.10.06-v19
- **开启 Terser 压缩（`optimization.minimize: false` → `true`）**：`dist/znhd.user.js` **2.243 MiB → 0.770 MiB（−1502 KB，−65.4%）**，gzip 后 **257 KB**（原约 800 KB）。
  - 配置本来就把 `TerserPlugin` 写好了（含保住元信息的 comments 白名单），只是 `minimize` 一直为 `false` 没生效；本次只翻这一个开关。
  - **元信息完整性已逐项验证**：`==UserScript==` 成对、`@version/@name/@namespace/@description/@author/@match/@icon/@grant/@connect/@homepageURL/@updateURL/@downloadURL/@require` 全部保留（脚本元信息不是"注释"，被压掉脚本直接装不上）；冒烟里"版本号渲染"断言正是从元信息解析出来的，它通过即证明白名单生效。
  - **dev 侧显式关回 `false`**（`config/webpack.dev.js`）：本地调试产物要可读、构建要快，否则 `npm run dev` 每次都白花时间在压缩上。
- 顺带查明一个**配置陷阱**：`config/webpack.config.base.js` 导出的是**共享可变单例** `baseOptions`。若在同一进程里先后 `require` dev 与 prod 两个配置工厂，后者的改动会覆盖前者（实测两个都显示 `mode=production, minimize=false`）——**验证这类开关必须分进程**，否则会得出错误结论（本次差点被自己的测试骗过）。
- 验证：`npm run verify` **16 项全绿**；`npm run check`（`node --check` 产物）通过；`antd lint` 0 issue；分进程断言 prod `minimize=true` / dev `minimize=false`。
- ⚠️ 与 v9~v18 一样**只做本地提交，未推送**。

### znhd.user.js v26.10.06-v18
- **修复编辑器里的 TypeScript 弃用报错**「选项 `moduleResolution=node10` 已弃用，将在 TypeScript 7.0 停止运行」：
  - 根因：本仓库 TypeScript 仍是 4.9.5（`^4.6.3`），而 VS Code 用的是**自带 6.x**。当初我用 `moduleResolution: "node"` 正是因为 TS 4.6 不认识 `bundler`（TS6046）——是个被旧工具链逼出来的临时选择。
  - 修法三步：① 根依赖 `typescript` 升到 **^6.0.3**；② `moduleResolution` 由 `node`(node10) 改为 **`bundler`**（打包器场景的正式选项，且按 `package.json#exports` 解析子路径，更贴合 antd）；③ `.vscode/settings.json` 加 `typescript.tsdk: node_modules/typescript/lib` + `enablePromptUseWorkspaceTsdk`，**让编辑器与 `npm run typecheck` 用同一份 TS**（否则两边规则不一致，编辑器报的错在 CI 里复现不出来）。
- **`skipLibCheck` 维持 `true`（实测后确认必须保留）**：改 `bundler` 后曾试开 `false`，仍报 `@rc-component/image`、`@rc-component/picker` 两条 **TS2430（接口不兼容）**——那是这两个包**声明文件自身的类型 bug**，与模块解析无关。已把结论写进 tsconfig 注释，避免后人反复试。
- 验证：`npm run typecheck` 0 错；`npm run build` 通过；`antd lint ./src` 0 issue；`npm run verify` **16 项全绿**；`npx tsc` 已无任何弃用告警。
- ⚠️ 与 v9~v17 一样**只做本地提交，未推送**。

### znhd.user.js v26.10.06-v17
- **「设备互联」弹窗按参考稿重排版式**（原为平铺的若干行控件）：
  - 标题改为「📱 手机互传」+ `设备互联` 标签；
  - 分区一「**电脑接收 · 本机专属链接**」（右侧 `手机扫码即上传` 标签）：左二维码 + 「扫一扫上传」说明，右侧「链接（复制到手机浏览器打开）」只读框 + 通栏「复制链接」按钮；**按要求不放「重新生成」按钮**；
  - 中部居中的**在线状态胶囊**（绿/红描边圆角，带状态点：「手机已连接，可发送」/「当前无在线设备，无法发送」）；
  - 分区二「**发送到手机**」：文本输入行（右侧「发送」按钮）、「待发送图片 / 已选 N 张」标题行、**三列缩略图**（右上角深色圆形 × 移除）、底部「＋ 选择 / 添加图片（可多选）」（**虚线边框**）与「发送 N 张图片」（实心，较宽）；进度条仍保留在分区内。
  - 逻辑（二维码生成、在线轮询、逐张压缩发送、失败即停、objectURL 回收）**一字未改**，只换渲染层；顺手删掉了一个未被使用的 `pendingRef`。
  - 按钮文案由「发送 N 张图片到手机」改为参考稿的「**发送 N 张图片**」，冒烟里定位该按钮的选择器同步改为「张图片」。
- ⚠️ 沿用 v15 的方案 B：弹窗盖在面板之上，故本弹窗内看不到面板遮挡问题。
- 验证：`npm run verify` **16 项全绿**（含「发送到手机前压缩」全链路：打开弹窗 → 选图 → 点发送 → 校验实际 POST 的是压缩后的 JPEG）；`antd lint ./src` 0 issue；`typecheck` 通过；并用 puppeteer 截图核对了新（绿色主题下的）版式。
- ⚠️ 与 v9~v16 一样**只做本地提交，未推送**。

### znhd.user.js v26.10.06-v16
- **设置里的「监控时间段」把 antd `TimePicker` 换回原生 `<input type="time">`（仍用 antd `Input` 包壳，外观与其余输入框一致）**，目的是瘦身：
  - **实测产物 2.560 MiB → 2.243 MiB（-325 KB，-12.4%）**。省掉的是 antd TimePicker 的整套底座：`@rc-component/picker`（单包 229KB 未压缩）+ `dayjs` + Picker 相关样式；已核对产物中不再出现 `dayjs` / `rc-picker` / `ant-picker-*`。
  - 这**正是项目原本的写法**（旧代码注释：「CAT_UI 未导出 TimePicker，此处用原生 `<input type="time">`」），v9 重写 UI 时我"顺手升级"成 antd TimePicker 才把它带进来的；现在按实测数据换回。
  - `step={300}`（5 分钟）与原 `minuteStep={5}` 等价；清空输入时 `hhmmToHours` 返回 `null`，`updateWh` 已改为忽略 null，不会把 NaN/undefined 写进配置。
- **关于「用 CDN 加载 antd 让脚本变小」的核查结论（v15 已记，此处仅摘要）**：React 19 已移除 UMD 构建（实测 `react/umd` 不存在），传统 `@require` 全局包路线不成立；改走 React 18 UMD + antd 全量 UMD 则总体积打平且失去 tree-shaking。**故本次采用纯本地的按需瘦身，未引入任何 CDN 依赖。**
- 冒烟断言同步：
  - 新增「时间段为 4 个原生 time 输入（HH:mm）」；
  - 原「时间图标与输入框同一水平线」在 TimePicker 移除后对象消失，**改量为同类对象**（输入框「清空 ×」→ 弹窗关闭图标 → 侧边栏关闭图标），继续守卫「第三方样式给 svg 加负 margin 把图标顶出控件」这一真实踩坑。
- 验证：`npm run verify` **16 项全绿**；`antd lint ./src` 0 issue；`typecheck` 通过。
- ⚠️ 与 v9~v15 一样**只做本地提交，未推送**。

### znhd.user.js v26.10.06-v15
- **层级方案改为 B：antd 浮层（Modal / Drawer / message）盖在面板之上**。
  - 实现方式（比单纯降 z-index 更稳）：面板宿主保持 `z-index:999999`（仍高于宿主页面自身内容，页面弹窗多在 1000~9999），同时把 antd 的浮层基数抬到面板之上——`ConfigProvider` 设 `theme.token.zIndexPopupBase = 1000000`。于是弹窗/侧边栏/消息都在面板之上，遮罩也会遮住面板（符合常规层级直觉）。
  - 新增冒烟断言「antd 弹窗/侧边栏盖在面板之上（方案 B）」：比较 `.ant-modal-wrap`/`.ant-drawer` 与面板宿主的计算 z-index。
- **关于「用 CDN 加载 antd 让脚本变小」的核查结论（未改代码，先说清事实）**：
  - **React 19 已移除 UMD 构建**（实测 `node_modules/react/umd` 不存在）→ 传统的 `@require` CDN 包（依赖 `window.React` 全局）**无法用于本项目**。
  - antd 6.6.5 仍带 UMD（`dist/antd.min.js` 1396KB / `antd-with-locales.min.js` 1764KB），但它假设 `window.React`/`ReactDOM` 存在；要用只能退到 **React 18 UMD**。
  - 即便这么做，**总体积基本打平**：CDN 侧要下载 antd 全量 UMD（1764KB，**无 tree-shaking**，含全部组件与全部语言包），而当前 tree-shaking 后的整包是 2.42MiB；换来的是「脚本文件本身变小」，代价是强依赖 CDN 可用性 + 退回 React 18 + 失去按需裁剪。
  - 真正有效的瘦身方向（本地可验证）：antd `TimePicker` 的底座 `@rc-component/picker` 单包就 **229KB**（未压缩），换成原生 `<input type="time">`（**旧版实现就是这么做的**）是单项收益最大的一刀；此外还有按需懒加载重型弹窗等。
- 验证：`npm run verify` **15 项全绿**；`antd lint ./src` 0 issue；`typecheck` 通过。
- ⚠️ 与 v9~v14 一样**只做本地提交，未推送**。

### znhd.user.js v26.10.06-v14
- **常用语改为网页侧边栏样式（antd `Drawer`）**：`PhrasesModal.tsx` → `PhrasesDrawer.tsx`，从右侧滑出、`size={360}`。理由：常用语是长列表，弹窗要反复滚动且高度受限；侧边抽屉能用满屏高、滑出时不遮挡右侧网页内容。其余弹窗（设置/日志/设备互联/更新日志/收图）仍为 Modal——那是一次性确认型交互。
  - ⚠️ v6 中 Drawer 的 **`width` 已弃用**，改用 `size`（`number | string | 'default' | 'large'`）。
  - ⚠️ v6 的 Drawer DOM 也变了：**不再有 `.ant-drawer-content`，改为 `.ant-drawer-section`**（冒烟断言用旧类名会假失败，已改用 v5/v6 通用的 `.ant-drawer-body`）。
  - `ui/uiReset.ts` 把 `.ant-drawer` 一并纳入样式隔离范围。
- **面板品牌图标改为税务站点 favicon**（`https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico`，与元信息 `@icon` 同源）：新增 `BrandIcon` 组件，优先 `<img>`，**加载失败回退 emoji**，避免离线/被拦时头部留白块。面板头部与收起态圆钮都改用它。
- **修复「面板可能被放到几乎完全出屏、只剩一条边、按钮点不到」**：
  - 根因①：默认初始坐标用了 `window.screen.width/height`（**物理屏幕**）而非 `innerWidth/innerHeight`（**视口**），多屏或窗口变窄时差别很大；
  - 根因②：恢复存档坐标时用的裁函数只保证「留 48px 可抓取」（那是**拖拽**时该有的语义），存档来自更宽窗口/另一显示器时就被算到视口外。
  - 修法：新增 `clampIntoView(pt, w, h)`（放得下的前提下要求**整块可见**），挂载后按真实尺寸裁一次（不落盘）、窗口 resize 时同样处理（落盘）；拖拽过程中的贴边语义保持不变。
- 验证：`npm run verify` **14 项全绿**（新增「常用语是 antd Drawer 侧边栏（非 Modal）」）；`antd lint ./src` 0 issue（抓到并修掉 Drawer `width` 弃用）；`typecheck` 通过；面板位置修复前后截图对照（修前只剩约 50px 露在右边缘，修后完整可见）。
- ⚠️ 本条与 v9~v13 一样**只做本地提交，未推送**（按用户 2026-10-06 的要求）。

### znhd.user.js v26.10.06-v13
- **收图画廊与更新日志弹窗改为 antd，并移除 Viewer.js 依赖**（UI 至此全部是 Ant Design）。
- 收图画廊：原「自拼 DOM 弹窗 + Viewer.js 放大」→ **antd `Modal` + `Image.PreviewGroup`**（多图左右切换 / 缩放 / 旋转 / 翻转 / 1:1 都自带，无需第三方库）：
  - 新增 `ui/RecvGalleryModal.tsx`（九宫格缩略图，每张「复制 / 下载 / ×」，底部「清空全部」）；
  - `lib/gallery.ts` 从 474 行瘦成「数据 + 命名工具」：只留 `GalleryImage` / `MAX_GALLERY` / `downloadFileName`，**不再有任何 DOM 操作**；列表状态改由主面板 React state 持有（含超上限 revoke 最旧 objectURL）；
  - 剪贴板仍走 `relay.copyImageToClipboard`（先转 PNG 再只写一次，仓库实测结论，未改）。
- 收到文本：原 DOM 覆盖层 → `ui/RecvTextModal.tsx`（antd Modal）；同时修掉「多个全屏遮罩叠加、关掉顶层会露出过期文本」的老问题（现在单实例替换内容）。
- 更新日志：原自拼 DOM 弹窗（fixed 全屏 + z-index 拉满 + 自装 ESC）→ `ui/ChangelogModal.tsx`（antd Modal）；`lib/changelog.ts` 只保留纯逻辑（`parseChangelog` / `mdToPlain` / `loadChangelog` + 会话缓存），超时/HTTP/格式校验等判定一字未改。
- **移除 Viewer.js**：`@require viewerjs` 与 `@resource VIEWER_CSS` 从 `common.meta.json`/`dev.meta.json` 删除；`GM_getResourceText` 授权（仅供 Viewer CSS 使用）一并移除；`global.d.ts` 删除 `Viewer` 声明。至此脚本 `@require` 只剩 js-yaml / qrcodejs / heic2any。
- 测试同步：冒烟的放大断言由 `.viewer-canvas img` 改为 **`.ant-image-preview-img`**（判定要点不变：已解码 + 可见尺寸）；「点画廊复制」改为在 antd Modal 内找「复制」按钮；更新日志断言改为查 antd Modal（旧 id `__znhd_changelog_popup__` 已不存在）。
- 文档同步（B）：`AGENT.md` 的文件表/入口装配/全局声明/弹窗浮层规则全部对齐新结构，历史踩坑表给 Viewer.js 与 CAT_UI 条目加上「【已废弃】」标记；`ReadMe.md` 目录树改为新组件清单、技术栈去掉「脚本猫UI库」与「Viewer.js」、补 React 19 + Ant Design v6 一行，全篇「抽屉」→「弹窗」共 12 处。
- 验证：`npm run verify` **13 项全绿**；`antd lint ./src` 0 issue；`typecheck` 通过。
- ⚠️ 本次**只做本地提交，未推送**（按用户 2026-10-06 的要求：确认后再上传）。

### znhd.user.js v26.10.06-v12
- **定位并修复「时间时钟图标 / 输入框清空 × 跑出输入框、与输入框不在同一水平线」的真因**。用户提供了该图标的计算样式，里面有一行 **`margin: -2.75em auto 0`**（按 16px 字号约 **-44px**）外加 `opacity: .55; pointer-events: none;` —— **antd 自身从不给 `svg` 设 margin**（antd 只设 `width/height/fill/display/vertical-align`），这条负外边距来自宿主环境的第三方样式（用户环境里能同时看到 SR 注释类扩展的 `--sr-annote-*` 变量），把 svg 整体顶出输入框。
- 修法：在样式隔离层（`lib/ui/uiReset.ts`）给本脚本容器内的 `svg` 补一条 **`margin: 0`**。第三方这类规则特异性只有 (0,0,1)，用带容器前缀的选择器（`#宿主 svg` / `.ant-modal-root svg` / …）即可稳压，且不影响宿主页面自身。
- **修正回归断言测错了元素**：上一版断言量的是外层 `span.ant-picker-suffix`（它不动，所以**假通过**），必须量 **svg 本身**（`.ant-picker-suffix svg`）——负 margin 作用在 svg 上。
- **断言有效性已用反向对照证明**：在冒烟页常驻「真凶 CSS」（`svg { margin: -2.75em auto 0 }`）后，
  · 关掉复位 → 「时间图标与输入框同一水平线」**❌ 失败**（复现用户现象）；
  · 打开复位 → **✅ 通过**。
- 验证：`npm run verify` 12 项全绿；`antd lint` 0 issue；`typecheck` 通过。

### znhd.user.js v26.10.06-v11
- **修复「设置弹窗排版被宿主页面 CSS 污染」**（用户实测反馈的两条）：
  1. **内容不该居中**：宿主页面（税务页）常有全局 `text-align: center`，弹窗里的标题/说明/地址全部被带成居中。根因是上一版改 antd 时漏掉了旧代码在抽屉内容上显式写的 `textAlign: 'left'` 守卫。现按 antd 语义化写法给四个弹窗加 `styles={{ body: { textAlign: 'left' } }}`，并在隔离层里对弹窗容器再兜一层。
  2. **输入框内图标（时间选择器时钟、清空 ×）垂直偏移**：根因是 **antd v5+ 不再自带全局 reset**（官方迁移文档要求手动引入 `antd/dist/reset.css`），而面板/弹窗是注入到别人页面里的，宿主页面的盒模型（`content-box`）、`line-height`/`font-size`、`svg` 对齐规则会渗进来，把图标顶出输入框。
- 修法（不污染宿主页面）：新增 `lib/ui/uiReset.ts`，把 antd reset 的**关键规则按本脚本容器加前缀**注入（面板宿主 / `.ant-modal-root` / Picker 与 message 浮层）：`box-sizing: border-box`、`text-align: left`（子元素用低优先级 `inherit` 复位，antd 自己需要居中的组件仍可覆盖）、统一的 `font-family/size/line-height`、`svg { vertical-align: inherit }`、输入控件 `margin:0 + 继承字体`。
  - ⚠️ 为什么**不直接** `import 'antd/dist/reset.css'`：那是全局重置，会把税务页自己的样式一起改掉，不可接受。
- **新增两条样式回归断言**（`npm run verify`）：① 「弹窗内容左对齐（不被宿主 CSS 污染）」② 「时间图标与输入框同一水平线（中心误差 ≤2px）」；并给冒烟测试页**常驻注入「敌意 CSS」**（`html/body { text-align: center }` + `* { box-sizing: content-box }`）来模拟真实宿主页面——否则这类污染在干净的测试页里根本复现不出来。
- 验证：`npm run verify` **12 项全绿**（新增两条均通过）；`antd lint ./src` 0 issue；`typecheck` 通过。
- ⚠️ **诚实说明**：第 1 条已用「模拟敌意 CSS」复现并验证修复；第 2 条（图标偏移）**本机没能复现**（在干净页面 + 敌意 CSS 下量到的图标都是居中的），已按 antd 官方基线做了最可能命中的修复并加了断言，**请在实际税务页再确认一次**；若仍偏移，需要提供该页面上 `.ant-picker-suffix` 的计算样式。

### znhd.user.js v26.10.06-v10
- **主面板按参考版式重做**（对齐用户给的视觉稿）：头部「蓝色圆角图标 + 征纳互动监控 + 版本胶囊 + ✕ 收起」；**人数/状态卡**（当前等待人数大字 + 「在线 · 正常监控 / 工作时段内」两行状态点）；**语音播报行**（🔊 + Switch 开关）；**2×2 大按钮**（⚙️ 设置〔主色实心〕/ 💬 常用语 / 🖼️ 历史文件 / 💻 设备互联）；底部一行「上次播报：N 分钟前 · 原因」+「查看日志 →」链接。
- 为此**监控模块新增状态出口**：`lib/monitor.ts` 增加 `MonitorState`（waiting / online / inWorkingHours / lastSpeak）与 `getMonitorState()` / `setMonitorStateSink()`，在 checkCount 里随检测结果发布——面板首次能显示实时等待人数、在线状态与工作时段状态（以前这些只进日志）。
- 「日志」由面板按钮改为底部「查看日志 →」（日志弹窗本身不变）；「收起」= 面板收成一个小圆钮（点击展开），避免关掉后找不回来。
- ⚠️ 冒烟测试的 `clickByText` 由「精确等于」改为「包含」：面板按钮现在带 emoji 前缀（`⚙️ 设置`），精确匹配会全部点不中。
- 验证：`npm run verify` 10 项全绿；`antd lint ./src` 0 issue；`typecheck` 通过；本地 harness 截图与参考稿逐项比对（布局、状态点、按钮主次、底部行均一致）。
- 备注：`Space direction`→`orientation`、`ConfigProvider button={{autoInsertSpace:false}}` 等同 v9 的 v6 适配仍然生效。

### znhd.user.js v26.10.06-v9
- **UI 层从 CAT_UI（脚本猫 UI 库）整体换成 React 19 + Ant Design v6**，`@require` 里的脚本猫 UI 库已移除；**四个侧边抽屉（设置/常用语/日志/设备互联）全部改为 antd Modal 弹窗**。
- 依赖与构建：
  - 新增 `react` / `react-dom` / `antd` / `@ant-design/cssinjs`（devDependencies，随产物打包）。
  - tsconfig 三项改动，都是被 antd 逼出来的，**别改回去**：① `module` 由 `commonjs` 改 `esnext`——commonjs 下 TS 产出 `require('antd')` 会把整个 barrel 拉进来（实测 1.62MiB），webpack 无法 tree-shaking；② `moduleResolution` 用 `node`（本仓库 TypeScript 4.6 不认识 TS5 的 `bundler`，会报 TS6046）；③ `skipLibCheck` 由 `false` 改 `true`——antd 及其 `@rc-component` 的 .d.ts 在本配置下十余条不兼容错误**全部位于 node_modules**，关着它 `npm run typecheck` 永远红，无法当门禁（本仓库自有代码仍按 strict 全量检查）。
- 架构（`lib/ui/panelHost.tsx` 取代 `CAT_UI.createPanel`）：
  - **不再使用 Shadow DOM**：antd 的弹窗默认 portal 到 body、样式走 document.head 的 CSS-in-JS，组件塞进 shadow root 后两者都进不去 → 弹窗会是无样式裸 DOM。改为挂到 `documentElement`（沿用仓库既有结论：税务页 body 常被加 transform 形成层叠上下文，会把 fixed 浮层困住），弹窗 `getContainer` 指向同一容器。
  - **自研拖拽**（指针事件改 `left/top`）：CAT_UI 用 react-draggable，而它依赖 React 19 已删除的 `findDOMNode`；且 transform 会让 `position:fixed` 的弹窗改以面板为包含块而被「困」在面板内。原 `lib/ui/panelPosition.ts`（穿透 shadowRoot 找面板 + 跟踪 transform）随之删除。
- 组件：`MainPanel.tsx`（antd Card + 按钮组 + 拖拽手柄）、`SettingsModal` / `PhrasesModal` / `LogModal` / `PhoneModal`（原 xxxDrawer.ts 删除）；`storage.ts` 的 `CAT_UI.Message` → 新增 `lib/ui/notify.ts`（由根组件注入 antd `App.useApp()` 的 message 实例）；设置里的时间选择改用 antd `TimePicker`、CDN 开关改用 antd `Switch`。
- ⚠️ **antd 会给「两个汉字」的按钮自动插空格**（设置 → `设 置`），会让按钮文案变化、并让「按文字点击」的测试失配；已用 `ConfigProvider button={{ autoInsertSpace: false }}` 关闭（v6 中 `autoInsertSpaceInButton` 已弃用）。
- ⚠️ **产物由 ~177KB 涨到 2.41MiB**。已确认 tree-shaking 生效（未用的 Table/Form/Transfer/DatePicker/Carousel 等都不在产物内），体量来自真正用到的 antd 组件 + cssinjs 引擎 + React。油猴会缓存脚本，主要影响首次安装/升级时的下载量。
- 验证：`npm run verify` 10 项全绿（含常用语弹窗、更新日志弹窗、设备互联「发送到手机前压缩」、收图放大）；`antd lint ./src` **0 issue**（过程中它抓到 `Space direction` 已弃用，已按 v6 改为 `orientation`）；`typecheck` 通过。
- 本次未纳入（下一步）：**收图画廊 / 更新日志弹窗仍是原 DOM 实现**（本身就是弹窗形态、且不含 CAT_UI），尚未改成 antd 组件，Viewer.js 的 `@require` 暂时保留。

### znhd.user.js v26.10.06-v8
- **日志面板独立成「运行日志」抽屉**（原来挤在「设置菜单」最底部）：主面板新增【日志】按钮，就放在【常用语】右边；设置抽屉里的「日志内容」整段移除。
  - 新增 `src/lib/ui/LogDrawer.ts`：**时间正序**展示（旧在上、新在下）+ **自动停在最新一条**、**按类型过滤**（全部 / 信息 / 成功 / 警告 / 错误，每个胶囊带条数，可多选开关）+ **清空**按钮。旧组件 `src/lib/ui/LogPanel.ts` 随之删除。
  - **自动滚底没写一行 JS**：列表容器 `flex-direction: column-reverse`，DOM 仍按 logger 的「最新在前」顺序渲染 —— 浏览器自动把视口锚在底部（＝最新一条），用户向上翻阅历史时也不会被新日志拽回。省掉了对 `CAT_UI.createElement` 是否透传 `ref` 的依赖（无保证）。
  - 新增 `clearLogs()`（`src/lib/logger.ts`）：**连去重窗口一起清**。否则清空后同样的内容会被 5 条去重规则静默丢弃，用户会误以为「清空之后就不再记日志了」。
  - ⚠️ **日志不要再搬回设置抽屉**：日志条目含版本号文本（「脚本已启动，版本 vX」），而冒烟断言取的是 shadow 文本里**第一个** `vX.Y.Z-vN` 匹配（AGENT.md 里记过这个串台坑）。已在该文件头写明。
- 实测（真实构建产物 + 浏览器）：主面板按钮顺序为 `设置 / 常用语 / 日志`；抽屉打开显示 8 条日志、**视觉顺序最旧在上、最新在下**；点「信息」胶囊后只剩 3 条成功且页脚变「按 已选类型过滤」；点「清空」后显示「暂无日志」且按钮置灰；清空后继续操作仍有新日志写入（去重窗口确实重置）。
- `typecheck` / `lint`(0 error) / `verify`（10 项全绿）通过；`@version`→`26.10.06-v8`。

### relay-server v26.10.06-v2
- **手机上传页：连发多图有进度了**。原来只用状态栏一行文字报「发送中…（n/N）」，图一多既看不出总体进度、也没有"在动"的反馈。现改为**进度条 + 发送中动画**：
  - 进度条（0→100%，宽度过渡）+ 每张传输中叠加**条纹滚动**动画 + 文字行带**转圈 spinner**，文案为「发送中… n/N（正在发送第 k 张）」。
  - 全部完成后进度条拉满并显示「✅ 已发送 N/N，全部完成」，2.5 秒后自动收起；失败则**不自动收起**、文案转红并保留「已发 n/N」，便于决定是否重试剩余。
  - 状态栏在发送期间不再重复报 n/N（交给进度条），只在最终成功/失败时给结论。
- **手机上传页：「查看收到的图片」按钮移到「发送图片到电脑」正下方**（原先在最底部「来自电脑」段落里）。
- ⚠️ 纯手机页改动，收发协议未变；relay `package.json` version→`26.10.06-v2`，须重启生效（`curl /health` 见 `26.10.06-v2`），手机端需重新打开上传页。
- 实测（同源代理 + iframe 驱动真实手机页，注入 3 张图并放慢 fetch）：12/12 断言通过 —— 按钮 DOM 相邻、初始进度条隐藏、结构完整、发送中 `display:block` + `busy` 条纹 + spinner、宽度 0→33→67→100 递增、完成态 100% 且提示全部完成。

### znhd.user.js v26.10.06-v7
- **修复：电脑 → 手机发送 HEIC/HEIF 不压缩（v26.10.06-v6 的遗留缺口）**。上一版给「发送到手机」加了 canvas 压缩，但 HEIC/HEIF 会走「解码失败 → 原图直传」：**桌面 Chrome 原生解不开 HEIC/HEIF**，而 heic2any 当时只存在于**手机上传页**，油猴脚本的 `@require` 里没有它 —— 所以那条链路上根本没有解码器（不是「不能压」）。
- 改法：**把 heic2any 加进脚本 `@require`**（`config/common.meta.json` / `config/dev.meta.json`，取 `fastly.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.js`，br 后约 334KB、`immutable` 一年缓存）。
  - `compressImageForPhone()` 拆成三层：`isHeicLike()`（MIME + 扩展名双判——桌面 Chrome 给的 `file.type` 可能是空串）→ `heicToJpeg()`（heic2any 转 JPEG，多图 HEIC 取首帧）→ `toPhoneJpeg()`（原有的 canvas 缩放 + 白底 + JPEG q0.75）。
  - **HEIC 不套用「压不小就不压」**：转码本身既是压体积、也是修掉安卓端不显示 HEIC 的兼容问题，故只要转码成功就发 JPEG；库缺失 / 文件损坏时仍回退原图直传。
  - `src/global.d.ts` 补 `heic2any` 全局声明；冒烟页同步加载该依赖（维持「与 `@require` 完全相同的依赖」）。
- ⚠️ **代价（明知而选的取舍）**：所有用户每次脚本更新都会多下这个库（br 约 334KB / 原始 1.36MB，jsDelivr 缓存一年），换来「HEIC 可压缩 + 安卓端能显示」。
- 验证：
  - 真实 CDN：`typeof heic2any === 'function'`，喂非 HEIC 数据返回 `ERR_LIBHEIF format not supported` —— 证明 libheif 解码器真的在跑（不是空壳 200）。
  - 用**产物中抽出的真实代码 + 打桩 heic2any** 跑 13 项断言：heic2any 调用参数（`toType:'image/jpeg'` / `quality:0.9` / 传入原始 File）、输出 JPEG + `.jpg` + 最长边 1600（4000×3000 → 1600×1067）、库缺失时回退原图且保留 `image/heic`、转码被拒时回退原图、HEIC「压不小也发 JPEG」（64B → 6408B）、非 HEIC 回归（大 JPEG 仍压缩 / GIF 仍直传）。
  - `npm run typecheck`（strict）、`npm run lint`（0 error）、`npm run verify`（10 项全绿，冒烟页已真实加载 heic2any）通过。`@version`→`26.10.06-v7`。
- 说明：本机与 CI 都无法生成真实 HEIC 样张（真 HEIC 需要编码器），上述针对 HEIC 的验证是「打桩 + 真实库可调用性」，**建议真机拿一张 iPhone HEIC 照片复测一次**。

### znhd.user.js v26.10.06-v6
- **修复：电脑 → 手机发图完全没有压缩（原图直传），与「手机 → 电脑」方向不对称**。手机上传页一直有 canvas 压缩（最大边 1600px + JPEG q=0.75），而电脑端「发送到手机」是 `FileReader.readAsDataURL(原文件)` 直接 POST：base64 后体积 = 原文件 × 1.33，全程只有一条「超 12MB 就报错、让用户自己压缩」的兜底。实际影响：3MB 照片要上行 4MB；5MB 截图 PNG 要上行 6.7MB；**原图 ≥9MB 直接撞 12MB 单请求上限被拒**。
- 改法（**默认压缩，不加开关**）：
  - 新增 `compressImageForPhone()`（`src/lib/relay.ts`）：`createImageBitmap` 解码（不可用时回退 `<img>`）→ canvas 等比缩放到最大边 `PHONE_MAX_DIM = 1600` → 铺白底 → 导出 JPEG `PHONE_JPEG_QUALITY = 0.75`，参数与手机上传页的 `compressFile` 完全一致。
  - 四种情况**回退原图直传**、绝不阻断发送：SVG（canvas 无法可靠光栅化且会丢矢量）、GIF（canvas 只取首帧，会把动图压成静态图）、浏览器解不开的格式（桌面 Chrome 的 HEIC/HEIF）、以及**压完反而更大**的小图 / 已高度压缩图。
  - `PhoneImageDrawer` 发送循环改为「**先压缩 → 再体积预检 → 再发送**」；日志分别显示「已压缩 x → y」与「原图发送（y）」，超限文案改为「压缩后仍超限」。压缩后统一 `image/jpeg` + 原主名 `.jpg`（手机端「下载」的扩展名据此生成）。
- **新增回归断言**（`npm run verify`）：「**发送到手机前压缩**」—— 冒烟页打开「设备互联」抽屉 → 注入一张 3000×2000 的 JPEG → 点发送 → 解出**实际 POST 出去的字节**，断言「是 JPEG（magic FFD8）、最长边 ≤1600、且比原图小」。断言有效性已用**反向对照**验证：把产物里的压缩短路后该项变红、套件退出码 1（避免了「空转断言」）。
- 另用真实浏览器对产物里的 `compressImageForPhone` 跑了 15 项断言：4000×3000 JPEG → 1600×1200（106KB → 22KB，宽高比保持）；带透明 PNG → 透明区被铺成白底 `rgb(255,255,255)`、42KB → 19KB；GIF / SVG **对象原样返回**（未被替换）；小图无增益时回退原图。
- `npm run typecheck`（strict）、`npm run lint`（0 error）、`npm run verify`（10 项全绿）均通过；`@version`→`26.10.06-v6`。

### znhd.user.js v26.10.06-v5
- **全部 CDN 地址由 `cdn.jsdelivr.net` 换成 `fastly.jsdelivr.net`（jsDelivr 的 Fastly 镜像）**。根因：jsDelivr 主域在国内**直连不可达**（TCP 能连上、**TLS 阶段即失败**；`testingcf.jsdelivr.net` 同样），而 `fastly.jsdelivr.net` 正常可用。两者路径规则完全一致，仅换主机名，无行为差异。
  - `@require` ×3（js-yaml / qrcodejs / viewerjs）+ `@resource VIEWER_CSS`：改 `config/common.meta.json` 与 `config/dev.meta.json`。
  - **运行时 CDN 解析**：`src/lib/utils.ts` 的 `resolveGithubUrl()` 开启「使用 CDN 加速」时输出 `https://fastly.jsdelivr.net/gh/...`（影响常用语数据源与提示音等 GitHub 资源）。
  - Viewer.js CSS 的 CDN 兜底 `<link>`（`GM_getResourceText` 不可用时走）：`src/lib/gallery.ts`。
  - 冒烟测试页依赖 `scripts/smoke/znhd-smoke.html` 一并同步，保证测试加载的仍是产物真实依赖。
  - ⚠️ **未改**长缓存语义：`@refs/heads/main` 这类分支引用在 jsDelivr 上仍是长缓存（换镜像不改变缓存策略），因此 `@updateURL`/`@downloadURL` 继续指向 `raw.githubusercontent.com`（见 v26.10.06-v2）。
- 实测 `fastly.jsdelivr.net` 上各路径均 200：`/npm/js-yaml@4.1.0`、`/npm/qrcodejs@1.0.0`、`/npm/viewerjs/dist/*`、`/gh/Run-os/znhd-service@refs/heads/main/public/dida.mp3`。
- 已 `npm run build` 重建 `dist/znhd.user.js` 并按约定同步根跳板 `znhd.user.js`（两者字节一致）；`node --check`、`npm run typecheck`、`npm run verify` 均通过。`@version`→`26.10.06-v5`。

### relay-server v26.10.06-v1
- **修复「手机上传页打开要 10 秒以上」——首屏白屏 10.87s 降到 ~0.2s**。根因不在服务端（实测 TTFB 仅 0.15~0.6s），而在手机页 `<head>` 里同步挂着两个第三方 CDN 脚本（无 `defer`/`async`，阻塞整个页面解析）：
  - `heic2any.js` **1.36MB**：`cdn.bootcdn.net` 对该网络**限速约 128KB/s**（同一 CDN 上 echarts、其他文件同样是 127KB/s，而本机从 npmmirror 下 5.8MB 只要 0.92s，排除本地带宽因素），且响应头为 **`Cache-Control: no-store`**（天天首次访问都要重下）——单这一个文件就是 **10.6s**；`heic2any.min.js` 同为 1.35MB，压缩/混淆救不了（内嵌解码器）。
  - `viewer.min.js`/`.css`：`cdn.jsdelivr.net` **国内直连不可达**（TCP 连上但 TLS 阶段即失败，`testingcf.jsdelivr.net` 同样；`fastly.jsdelivr.net` 正常），首次访问（无缓存）还会再挂一次，这就是「或更久」的来源。
  - 实测闭合：`FCP 10868ms ≈ TTFB 151ms + heic2any 10644ms`。
- 改法（手机页 `uploadPageHtml()`，收发协议零变化）：
  - **`<head>` 不再引入任何第三方资源**，首屏只剩同源 HTML。
  - **heic2any 改为按需加载**：只有用户真的选了 HEIC/HEIF 才去下载（`loadHeic2any()` 复用同一 Promise，连选多张不重复下载），加载期间状态栏提示「检测到 HEIC，正在加载解码库…」；失败/超时仍回退原样直传（与旧行为一致）。绝大多数用户永远不再为这 1.36MB 买单。
  - **Viewer.js 改为异步注入**（CSS 与 JS 一起，不再阻塞首屏），就绪后回调 `initRecvViewer()` 接管已渲染缩略图的点击放大；缩略图 `onclick` 改为**点击时再判定** `recvViewer`，避免「库晚于渲染到达」时两套预览同时弹；始终加载不出来则退回自定义单图查看（原兜底路径不变）。
  - **CDN 选源**：Viewer.js 固定 `fastly.jsdelivr.net/npm/viewerjs@1.11.7`（br 压缩 + immutable 一年缓存）；heic2any 首选 `fastly.jsdelivr.net`（br 后约 331KB、immutable），兜底 `cdn.bootcdn.net`。两处均带 **15s 单源超时**，超时自动换下一个源，不再有「某个 CDN 挂住就无限等」。
  - ⚠️ **纯手机页改动**，`/u/<deviceId>` 之外的接口一行未动。relay `package.json` version→`26.10.06-v1`。
- ⚠️ 须重启生效（容器内 `docker restart znhd`，或停旧进程后重新 `node server.js`），`curl /health` 见 `26.10.06-v1` 即生效；**手机端需重新打开/刷新上传页**（修的是页内 HTML/JS，浏览器缓存的是旧页面）。

### znhd.user.js v26.10.06-v4

- **修复：收到图片后点「复制」，图片没有被写进剪贴板**（弹窗里显示「复制失败」）。根因是写入顺序错了：
  - Chromium 的异步剪贴板**只支持写 `image/png`**（实测 `ClipboardItem.supports('image/jpeg') === false`），而手机传来的图多为 jpeg。旧实现「先按**原图类型**写一次 → 失败后再转 PNG 重试」的第一次调用**注定失败**；
  - 更关键的是：按规范 `clipboard.write()` 在通过用户手势校验后即**消耗**该手势（失败也不退还），于是转 PNG 之后的第二次重试必然 `NotAllowedError: Write permission denied` —— 用户看到的就是「复制失败，请长按图片手动保存」。
  - 重写为：**先转好 PNG，再只写一次**；并用 `ClipboardItem` 的 **Promise 形式**让 `write()` 在点击手势内**同步发起**，异步转换耗时不再影响手势有效性。写入走**页面主世界**（`unsafeWindow`）的 `navigator.clipboard` + `ClipboardItem`，并按参考实现用该 realm 的**原生 Blob 构造器**重新包一层，避免跨 realm 被拒。失败原因（权限 / 页面未聚焦 / 内核不支持）写进日志。
  - 参考实现：[qsniyg/maxurl](https://github.com/qsniyg/maxurl)（只调用一次 write + 用页面原生 `native_blob` 构造 ClipboardItem + 显式异常分支）。本脚本**不需要**参考实现里「跨域图片经 `GM_xmlhttpRequest` 取二进制」那一段 —— 图片本来就是中继传进来的 Blob。
- **新增回归断言**：`npm run verify` 新增「**图片复制只尝试写 PNG**」—— 在页面里桩掉 `Clipboard.prototype.write` 记录条目类型，断言「至少发起过一次写入，且**只出现 `image/png`**」。旧实现会产生 `image/jpeg` 条目而被判失败。
  - 说明：headless 环境里图片剪贴板**根本写不进去**（实测即使只写一次 `image/png` 也返回 `NotAllowedError`），所以断言只锁「尝试的类型」这一不变量，不锁「写成功」。
- **`@homepageURL` 改为 `https://github.com/Run-os/znhd-service`**；面板设置里的 `[脚本主页]` 按钮同步指向该仓库（原先指向 ScriptCat 脚本页）。

### znhd.user.js v26.10.06-v3

- **修复：收到图片后单击缩略图放大，有时长时间不出图**（表现为弹出一片纯黑遮罩、图一直不出来，且反复点击无效）。根因是 Viewer.js 集成里的一处竞态：
  - Viewer.js 的 `shown()`（设置 `isShown=true`、创建主图、执行 `render()`/`bind()`）**只由容器的 `transitionend` 事件触发**；而本脚本为让预览盖在画廊白盒之上，用 `MutationObserver` 把 `.viewer-container` 在出现瞬间移入画廊遮罩——**移动 DOM 节点会打断正在进行的 CSS 过渡**，`transitionend` 不再触发 → `shown()` 永不执行 → `isShown` 永远为 `false` → 之后每次 `view()` 都在 `!this.isShown` 处提前返回，**主图从不被创建**；同时 `this.showing` 卡在 `true`（只在 `shown()` 里清除），所以反复点击同样无效。
  - 修复：给 `new Viewer()` 传 **`transition: false`** —— `show()` 改为**同步调用 `shown()`**，彻底不依赖过渡事件；`hide()` 亦因未加 `CLASS_TRANSITION` 而走同步收尾，连带消掉关闭侧的残留容器风险。
  - 实测：默认过渡下 4 秒内 `.viewer-canvas` 始终为空；改后 **22ms** 出图（4000×3000 / 854KB 的图 29ms）。**与图片大小无关**（该图 `decode()` 仅 25ms）。
  - 代价：失去放大/关闭的淡入淡出动画。
  - 该问题自 v26.7.29-v10 引入「把预览容器移入 overlay」的层级修复起就已存在，**非新引入**。
- **补齐关键回归断言**：`npm run verify` 新增「**缩略图放大显示主图**」一项。此前 7 项断言里只有「九宫格画廊」（缩略图出现），**从未点过缩略图** —— 这正是该 bug 能存活两个多月的原因。断言同时覆盖「主图位于 `.viewer-canvas` 内、已解码、且有可见尺寸」（注意不能用 `vc.querySelector('img')`：会命中 `.viewer-magnifier-image` 放大镜占位图，其 `src` 为空、`naturalWidth` 恒为 0）。
- **编号更正（本版发布时同步完成）**：把 2026-10-06 当天的三条条目统一为 `26.10.06-v1`/`v2`/`v3`。原先误把「当天第几次改动」当成日期递增（`26.10.6-v1` → `26.10.7-v1` → `26.10.8-v1`），等于凭空造出 10-07 / 10-08 两个日期，并会让油猴的版本比较把随后几天的新版本判成「更旧」。旧的错误编号可在 git 历史中查到；规范见本文件开头与 `AGENT.md` 约束 1。

### znhd.user.js v26.10.06-v2

- **自动更新地址由 jsDelivr 改为 GitHub raw**：`@updateURL`/`@downloadURL` 从 `https://cdn.jsdelivr.net/gh/Run-os/znhd-service@refs/heads/main/dist/znhd.user.js` 改为 **`https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/dist/znhd.user.js`**。
  - 原因：jsDelivr 对分支引用（`@refs/heads/main`）的文件带较长缓存，曾出现「仓库已推送新版本、jsDelivr 仍返回上一版」，用户因此收不到更新（见 v26.10.06-v1 的排查记录）；raw 走 Fastly 短 TTL，推送后基本秒级可见。
  - ⚠️ **注意**：这两个字段由油猴管理器**直接请求**，不经过 `resolveGithubUrl()` —— 设置里的「使用 CDN 加速」开关对「脚本自动更新」无效，写死什么就用什么。
  - ⚠️ 改动随**脚本头部**生效：已装用户需**先更新到本版**，之后才会走 raw；尚未迁移的老安装仍轮询仓库根路径（jsDelivr）的过渡跳板，跳板每次发版都会同步刷新。

### znhd.user.js v26.10.06-v1

- **新增：更新日志查看器** —— 「设置菜单」在 `[更新脚本]` 旁新增 `[更新日志]` 按钮，点击弹窗展示最新 10 条更新日志；弹窗底部「获取更多日志」跳转到 `CHANGELOG.md` 网页查看全部历史。
- **重构：更新日志独立成文件** —— 原写在 `ReadMe.md` 里的全部更新日志移至仓库根的 `CHANGELOG.md`，ReadMe 只留指引；脚本运行时直接读取该文件（`GM_xmlhttpRequest`，遵循设置里的「使用 CDN 加速」开关走 jsDelivr / raw）。
- 读取失败（断网 / CDN 不可达）时弹窗内提示原因，仍可点「获取更多日志」在浏览器打开。
- 新增模块 `src/lib/changelog.ts`；`src/lib/ui/SettingsDrawer.ts` 增加按钮入口。

### znhd.user.js v26.10.5-v1
- **工程化改造：接入 douyu-helper(monkey-template) 构建体系 + 源码模块化（脚本行为不变）**：
  - **新增 Webpack + TypeScript 构建**：源码迁到 `src/`，`==UserScript==` 头与 `@version` 等元信息改由 `config/common.meta.json` 生成；**生产产物输出到模板默认位置 `dist/znhd.user.js` 并提交进仓库**。开发态另有 `config/dev.meta.json` + `npm start`（devServer :8080、本地调试宿主页、`GM_addValueChangeListener` 热重载）。
  - ⚠️ **发布地址已变更（升级需注意）**：`@updateURL`/`@downloadURL` 由 `main/znhd.user.js` 改为 **`main/dist/znhd.user.js`**，产物输出位置改为 `dist/`。为了让**已安装的旧版本能自动升级**，仓库根**临时保留一份「过渡跳板」`znhd.user.js`**（内容与本版 `dist/znhd.user.js` 完全相同）：旧安装轮询根路径 → 拿到本版脚本 → 其头部已是新的 dist 地址 → 之后自动跟着 dist 走，**无需手动重装**。确认大家升级完成后，下一个版本会删除这个跳板。
    - 同时建议在 ScriptCat 的「源代码同步」里把地址改成 `https://github.com/Run-os/znhd-service/raw/main/dist/znhd.user.js`（或 jsDelivr 同路径）。
  - **抽离模块到 `src/lib/` 与 `src/lib/ui/`（模块化完成）**：`constants`（CONFIG/DEFAULTS/存储键）、`logger`（日志与防抖去重，回调改为 `setLogEntriesSink` 注入）、`storage`（面板位置/常用语缓存/配置读写）、`state`（`runtime` 运行时缓存）、`utils`（GitHub 链接解析/HTML 转义/URL 安全解码/时间换算）、`speech`（语音队列与超时保护）、`monitor`（人数监控/掉线检测/工作时间）、`tinymce`（编辑器追加）、`clipboard`（提示音 + 安全复制）、`relay`（中继客户端 + 图片剪贴板）、`gallery`（九宫格画廊/文本弹窗/Viewer 接管）、`qrcode`；UI 侧为 `ui/LogPanel`、`ui/SettingsDrawer`、`ui/CommonPhrasesDrawer`、`ui/PhoneImageDrawer`、`ui/MainPanel`、`ui/panelPosition`。**`src/app.ts` 从 2727 行降到约 90 行装配代码**，全仓已无 `@ts-nocheck`。
  - **等价性验证**：迁移用 AST 比对确认「原 IIFE 的 89 条顶层语句零丢失」（6 条为运行时缓存对象化 / 卸载清理改模块函数 / 具名 IIFE 改导出函数的有意重组）；`npm run build` / `npm run typecheck` / `npm run lint` / `npm run check` 全部通过。
  - **浏览器实测（example.com 调试宿主 + GM 桩按真实中继协议投递文本/图片）**：浮动面板与版本号、设置抽屉（时间段/地址/日志）、文本弹窗、九宫格画廊、图片与文本两条剪贴板路径、常用语 YAML 成功解析、中继离线优雅降级均通过，脚本自身零报错。
  - 说明：常用语加载/缓存逻辑（`loadPhrasesData`）因与面板 React 状态深度绑定，**保留在 `src/lib/ui/MainPanel.ts`** 内未单独成模块（拆出需为状态加桥接，属无意义重构）。
  - **类型收紧**：`tsconfig.json` 开启 `strict: true`（唯一例外 `useUnknownInCatchVariables: false`，沿用既有的「catch 后直接读 `e.message` 记日志」写法）。修掉实测的 197 个 strict 错误，绝大多数是补参数/变量类型标注——**类型会被编译擦除，产物行为不变**。
  - **新增自动化回归**：`npm run verify` 用 puppeteer 无头 Chromium 加载真实构建产物（GM API 桩 + 真实 `@require` 依赖 + 按真实中继协议投递文本/图片），断言面板、版本号、文本弹窗、九宫格画廊、常用语解析、抽屉可打开且页面无脚本自身报错；已接入 GitHub Actions（push / PR 都会跑）。
  - **迁移等价性验证（工具已删除）**：迁移期做过两层证明——① 对迁移前快照做 AST 级「顶层语句零丢失」比对（89 条，丢失 0）；② 差异对照：同一 harness 分别跑「迁移前原版」与「当前产物」，报告字段 / XHR 路径 / `localStorage` 三个键 / GM 设备 ID / 面板 ShadowDOM 文本 / 两个弹窗文本**逐字节一致**。验证完成后相关脚本与 151KB 快照已删除（它们只服务于「迁移」而非「日常回归」，留着会让正常修改误报）。
  - ⚠️ 仅工程化改动，**功能逻辑未变**；税务页真实环境仍建议按 ReadMe「快速开始 → 开发与构建」再实测一次面板/语音/常用语/设备互联。
- `@version`→`26.10.5-v1`。

### znhd.user.js v26.9.6-v9
- **处理「性能与冗余」审查第一批**（脚本端，交互语义不变）：
  - **主面板配置改惰性初始化**：`useState(loadAllvalue())` 的实参在**每次渲染**都会求值，而本组件因日志状态每 3 秒+ 就重渲染一次 → 每次渲染白读一次 localStorage 并 `JSON.parse`；改用 `useState(() => _initAllvalue)`（顶层启动时已读好的同一份数据，会话内设置改动都会写回它）。
  - **设置项持久化改 300ms 尾防抖 + 关页兜底**：设置输入是逐字提交的，旧实现每按一键就同步 `JSON.stringify + localStorage.setItem`，并顺带记一条「数据已保存到localStorage」；现 `saveAllvalue()` 只把「持久化」推迟到停顿后（状态仍逐字更新，最终写入必是最新值），并在 `beforeunload` 调 `flushSaveAllvalue()` 兜底，不丢最后一笔。
  - **逐字设置的日志防抖**：中继地址 / 常用语地址的「已更新」日志改走新增的 `addLogDebounced()`（同一 key 400ms 内只记最后一条），一次输入/粘贴不再把 20 条上限的日志面板刷满中间态。
  - **画廊 Viewer 观察器加短路**：`.viewer-container` 成功移入弹窗后置 `viewerMoved` 标志，回调先判标志即返回——该观察器监听整个 `documentElement` 的 subtree，税务页每次 DOM 变更都会触发回调，而「移入」动作一辈子只成功一次（观察器不断开，兼容可能重建容器的 Viewer 构建）。
  - **杂项清理**：删掉只被调用一次的 `isElementInDocument()` 单行包装（内联 `isConnected` 判断）；常用语按钮补 React `key`（消除列表告警）。
- `node --check` 通过；`@version`→`26.9.6-v9`。

### relay-server v26.9.6-v5
- **修复「电脑 → 手机」整条通道静默失效（重要）**：手机页 `pollRecv` 在 `fetch` 成功回调里、**读取响应体之前**调用了 `ctrl.abort()`（v26.9.6-v3/v4 加 35s 看门狗时引入），Chromium 实测这会让随后的 `r.json()` 抛 `AbortError` → 每次投递都被 `.catch` 吞掉并重连。表现：电脑端「发送到手机」显示成功、手机端**永远收不到**任何图片/文本（服务端已把条目出队，条目实际丢失）。现只在「看门狗超时、原请求仍挂着」的 catch 分支才 abort；本机浏览器实测：连发两条文本 → 手机页只显示最新一条，图片画廊计数正常。
- **手机页文本弹层改「同屏只留最新一条」**：连收多条文本时旧实现会在 body 上叠加多个全屏遮罩，关掉顶层会露出**过期**文本；现文本层加 `.recv-text` 标记，新文本到达前先移除旧文本层（与脚本端 `showTextPopup` 行为一致）。`openRecvImage` 的单图查看层（同为 `.recv`，仅 Viewer.js CDN 未加载时走）不受影响。
- 纯手机页改动，收发协议不变；relay `package.json` version→`26.9.6-v5`。⚠️ 须重启生效（容器内 `docker restart znhd`，或手动停旧进程后重新 `node server.js`），`curl /health` 见 `26.9.6-v5` 即生效；**手机端需刷新上传页**（修的是页内 JS）。

### znhd.user.js v26.9.6-v8
- **常用语数据地址改为「草稿 + 失焦回填默认」**：旧逻辑在输入框 `onChange` 收到空串时立即提交默认地址，受控 Input 的 value 随之瞬间被拉回默认——用户清空后想输入/粘贴新地址时，输入框马上被自动填上默认值（`v26.9.6-v7` 改自由输入后暴露）。现输入框改显独立的本地草稿 `urlDraft`（清空后保持为空，可继续粘贴/输入），非空时逐字提交保存；仅当**失焦且草稿为空**才回填并提交默认地址。`allowClear` 的清除按钮不触发 blur，故清空后焦点仍在输入框、不会误触回填。`@version`→`26.9.6-v8`。

### znhd.user.js v26.9.6-v7
- **处理代码审查「第二批」**（脚本侧健壮性/体验，无功能变化）：
  - **常用语加载加 status/类型双重校验**：404/错误页纯文本是「合法 YAML」，原先会渲染垃圾按钮并写进 2h 缓存毒化；现要求 HTTP 200 且解析结果是纯键值对象，否则按失败处理（保留旧数据）。顺带用**请求序号**防并发时慢的旧响应覆盖新数据；缓存命中不再每次弹「已加载」toast。
  - **设置区 URL 输入改为可自由输入**：常用语地址与中继地址原先逐键校验「须 http(s):// 开头」，非前缀即拒绝提交+每键弹 warning，受控输入根本没法逐字输入、重渲染还会拉回旧值；现直接提交用户输入，「设备互联」自动接收侧加 http(s) 前缀门控 + **800ms 防抖**避免输入中无效启停（在线轮询/二维码生成同款门控）。地址可用性由使用时校验兜底。
  - **掉线/语音/复制杂项**：`safeCopyText` 支持结果回调，文本弹窗「复制」按钮按真实成败显示（无剪贴板途径时不再假显示"已复制"）；`dida` 提示音 src 每次按当前 CDN 开关重新解析（切换即时生效）；恢复连接后复位连接失败日志标记。
  - **发送到手机细节**：超时随载荷缩放（约 20s + 每 200B 1ms，防慢上行误杀 12MB 大图）；体积预检按 UTF-8 字节算（中文文件名不再低估）；发送中禁止移除待发图、选文件对话框取消后清理隐藏 input。
  - **健康/清理**：`loadPanelPoint` 改用 `Number.isFinite`（排除 NaN/Infinity）；`loadAllvalue` 对 `workingHours` 字段级合并（残缺存量配置不再静默停掉监控）；数据源展示行解码改安全版（含游离 % 不再崩抽屉）；删除死 `@grant GM_notification` 与死 `@require fingerprintjs@5`。
- `node --check` 通过；`@version`→`26.9.6-v7`。

### relay-server v26.9.6-v4
- **处理代码审查「第二批」**（服务端+手机页健壮性，语义不变）：
  - **`deliver()` 先筛可写目标再出队**：等待连接全部已失效的窄窗口不再丢队头（旧实现先 shift 再过滤，目标为空时条目被丢弃）。
  - **手机页复制图片失败转 PNG 重试**：直写原始 mime 失败后 canvas 转 PNG 再写（Chromium 剪贴板对 PNG 支持最可靠——本仓库自有结论；安卓 WebView 收 JPEG 复制成功率提升，**建议真机复测**）。
  - **`sendJson`/回 500 前判 `res.destroyed`** + 请求级 `res.on('error')` 兜底：客户端中途断开时不再写已销毁响应（防版本相关未处理 error）。
  - **路由语义**：已知路径的非法方法统一回 405 并带 `Allow` 头（HEAD /u、POST /recv 等原先 404 或 405 无 Allow）；`cleanLogName()` 清洗日志中的文件名控制字符；手机页删除最后一张图后同步刷新「查看收到的图片」按钮计数；收件项保留 `name` 供下载命名、下载扩展名清洗（`image/svg+xml` 不再生成 `.svg+xml`）。
- 顺带删除无意义的 `relay-server/package-lock.json`（零依赖，版本还陈旧停在 1.0.0）。relay `package.json` version→`26.9.6-v4`。⚠️ 须重启生效，`/health` 见 `26.9.6-v4`。

### znhd.user.js v26.9.6-v6
- **处理代码审查「第一批」三项**（脚本侧健壮性，无功能变化）：
  - **设备互联收包分发加 try/catch**：任一张图的 base64 损坏（`atob` 抛错）或回调抛异常都会让旧实现的 `poll()` 链永久中断——接收循环静默死亡、直到刷新页面才恢复。现把收包分发整体包进 try/catch，异常记日志后 1s 继续下一次轮询。
  - **常用语加载加 `timeout: 15000` + `ontimeout`**：raw.githubusercontent 在部分网络下会被黑洞，无超时会导致 `phrasesLoading` 永久卡 true——抽屉停在「加载中…」、重载按钮转圈锁定、重开无效。超时后复位 loading 并保留旧数据，可再次点重载。
  - **掉线语音只在弹窗新出现时播报一次**：掉线弹窗停留期间原先每 3s 都 `speak("征纳互动已掉线")`（循环报警、占满语音队列）；现按「上升沿」门控只播一次，弹窗消失后复位可再次提醒。
- `node --check` 通过；`@version`→`26.9.6-v6`。

### relay-server v26.9.6-v3
- **处理代码审查「第一批」三项**（服务端+手机页健壮性，语义不变）：
  - **`readBody` 加 60s 超时兜底**：`engines` 声明 Node≥14，而 Node14 默认 `requestTimeout=0`（无超时），慢/卡客户端可无限占住连接与内存。现于读取处自管 `BODY_TIMEOUT` 定时器，超时以 408 拒绝并断开（`parseItemBody` 映射 408 JSON）。
  - **手机页收件画廊加上限**：`recvItems` 无上限时 dataURL 大字符串（单张可达 ~16MB 字符）随页面常驻累积；现新增 `MAX_RECV=27`（与脚本端 `MAX_GALLERY=27` 对齐），超出丢最旧。
  - **`pollRecv` 加 35s 看门狗**：与 `heartbeat` 同款 `Promise.race`——服务器 maxwait=25s 到期必回 `empty`，若请求被系统挂起/代理卡住永不 settle（如手机息屏被 OS 冻结），race 兜底强制重连，避免接收静默停摆到手动刷新。
- relay `package.json` version→`26.9.6-v3`。⚠️ 须重启 `node server.js`（容器内 `docker restart znhd`）生效，`curl /health` 看到 `26.9.6-v3` 即生效。

### znhd.user.js v26.9.6-v5
- **常用语数据源规范值由 github blob 网页链接改为 raw 原始直链**：若用户把「常用语数据源」误填成 GitHub 网页/仓库页面地址，请求会拉回整页 HTML（GitHub CSS，含 `--fontStack-monospace`），`jsyaml` 解析报「end of the stream or a document separator is expected」。现 `DEFAULTS.commonPhrasesUrl` 存 `raw.githubusercontent.com` 直链（`resolveGithubUrl` 形式二，`useCdn=true` 时仍转 jsDelivr 加速、`false` 时直连 raw）；并让 `loadPhrasesData` 在缓存值为空时回退默认直链，避免空地址静默失败。`@version`→`26.9.6-v5`。

### relay-server v26.9.6-v2
- **请求体超限回明确 413**（处理本轮代码审查）：`readBody` 超过 `MAX_BODY` 时原先中途 `req.destroy()` 掐断连接，客户端只见笼统「网络错误」，无从判断是体积问题。现改为超限后仅继续计数、不再缓存，一直读到 `end` 再以 `{statusCode:413}` 拒绝，`parseItemBody` 映射为 413 JSON `{error:'内容过大…请压缩后再发送'}`；这样请求被完整消费、不残留未读体破坏 keep-alive，客户端能稳定收到可理解的提示。relay `package.json` version→`26.9.6-v2`。⚠️ 须重启 `node server.js`（容器内 `docker restart znhd`）生效，`curl /health` 看到 `26.9.6-v2` 即生效。

### znhd.user.js v26.9.6-v4
- **处理本轮代码审查两项**（服务端改动对应 relay v26.9.6-v2，需两端同步）：
  - **「发送到手机」图片加体积预检**：发图前按「base64 膨胀 ≈4/3 + name/mime + JSON 开销」估算 body，超过单请求上限（与 relay `MAX_BODY` 12MB 对齐）即友好报错并停止，不再传一半被服务端掐断后只见笼统网络错误。
  - **常用语加载空数据不再崩抽屉**：`jsyaml.load('')`/空响应体会返回 `undefined`/`null`，原先直接 `setPhrasesData(data)` 会在抽屉渲染 `Object.keys(phrasesData)` 时抛 TypeError（空文件/空 200 即触发）；现统一 `data || {}`（网络与缓存命中两路径）。
- 纯健壮性改进，无功能变化；`node --check` 通过；`@version`→`26.9.6-v4`。

### znhd.user.js v26.9.6-v3
- **处理本轮代码审查「建议修」的脚本侧两项**：
  - **收到图片的 previewUrl 统一为 objectURL**：`startPhoneReceive` 收图时原先用 `data:` URL 字符串做预览，而画廊上限淘汰/单张移除/清空全部时的 `URL.revokeObjectURL` 对 data:URL 是无效空操作，且最多 27 张图的 base64 长字符串常驻 JS 堆（可达几十 MB）。现改为 `URL.createObjectURL(blob)`（与「发送到手机」待发列表一致），revoke 真正生效、内存可回收。
  - **常用语加载失败不再清空旧数据**：`loadPhrasesData` 的网络错误（onerror）与 YAML 解析失败（catch）原先都会 `setPhrasesData({})` 把已加载的常用语清掉，断网/数据源损坏时抽屉直接变空。现保留上次加载的内容，日志与提示补「仍显示上次内容」说明（首次加载失败无旧数据时行为不变）。
- 纯健壮性改进，无功能变化；`node --check` 通过；`@version`→`26.9.6-v3`。

### relay-server v26.9.6-v1
- **通道工厂化重构 + 长轮询去 tick 化**（处理本轮代码审查「建议修」的服务端两项）：
  - **抽取 `createChannel()` 工厂**：正向（手机→电脑，`/u` + `/recv`）与反向（电脑→手机，`/phone/send` + `/phone/recv`）原本是三组近乎逐行相同的镜像代码（入队、投递、长轮询，约 200 行重复），历史上 v26.7.29-v8 的残留行 bug 即发生在这类镜像代码里。现正反向各实例化一次（`forwardChannel`/`reverseChannel`），共用 `enqueue`/`deliver`/`handlePoll`/`sweepExpired`，日志文案按方向参数化，修一处等于修两处；POST 正文解析也抽为共用的 `parseItemBody()`。
  - **去掉每连接 400ms tick 轮询**：投递本就由「POST 入队时同步 deliver」与「连接注册时立即查队」两条同步路径全覆盖，tick 定时器属空转。现改为「注册即查队 + 单次 maxwait 定时器」，过期清理由 5s 周期任务的 `sweepExpired()` 承担（投递前仍会清队头过期项，绝不投递过期内容）。N 个等待连接不再挂 N 个 400ms 定时器；连接清理改用幂等的 `req`/`res` 双 `close` 监听，兼容不同 Node 版本。
  - 顺带移除从未被引用的死代码 `UUID_RE` 常量。
  - 语义严格保持：FIFO、MAX_QUEUE=100 丢最旧、广播（一次投递给所有等待连接）、maxwait 钳制 [1000,30000] 到期回 `{empty:true}`、PENDING_TTL 过期不投递。**已本地端到端冒烟测试 25 项全部通过**（版本/积压即时投递/空响应/事件驱动即时投递/双连接广播/FIFO 顺序/队列上限丢最旧/maxwait 下限钳制/反向通道心跳-状态-发送-收件/图片字段透传/400/404/405）。
- relay `package.json` version→`26.9.6-v1`。⚠️ 须重启 `node server.js`（容器内 `docker restart znhd`）生效，`curl /health` 看到 `26.9.6-v1` 即生效。

### znhd.user.js v26.9.6-v2
- **修复本轮代码审查「必须修」的两项缺陷**：
  - **「发送到手机」成功后释放 objectURL（内存泄漏）**：`confirmSendImage` 全部发送成功后原先只 `setPendingImages([])`，`pickImages` 为每张图创建的 blob objectURL 从未 revoke（对比单张移除路径有 revoke），反复多选发送会持续累积泄漏。现发送成功后对列表逐张 `URL.revokeObjectURL` 再清空。
  - **`appendToTinyMCE` 兜底路径返回值失真**：DOM 兜底插入成功后，`finalText` 用 `document.querySelector('body#tinymce')` 读取最终文本——但 `body#tinymce` 位于 iframe 内部，主 document 查询永远为 null，导致日志「已追加文本并同步:」恒为空、函数返回值失真。现改为先定位 tox iframe、再读其 `contentDocument.body.textContent`（与兜底写入的是同一个 body）。
- 纯 bug 修复，无功能变化；`node --check` 通过；`@version`→`26.9.6-v2`。

### znhd.user.js v26.9.6-v1
- **处理历史代码审查遗留项**（来源：`.workbuddy/reviews/znhd-userjs-review.md`）：
  - **日志去重增强**：由「只比对上一条」改为「最近 5 条窗口」（`RECENT_LOG_COUNT`），修掉每 3 秒一次「找不到人数元素」这类间隔性重复刷屏。
  - **`appendToTinyMCE` 参数与返回值规整**：无意义的默认参数 `'xxxxx'` 改为 `''`；JSDoc 明确返回值语义（成功返回编辑器最终文本，失败返回空字符串）。
  - **面板位置跟踪的监听器清理**：新增 `beforeunload` 清理（断开 `MutationObserver`、移除 `resize` 监听）；拖拽的 `mouseup` 改用 `{ once: true }` 注册，杜绝监听器残留。
  - **`getShadowHosts()` 加缓存**：仅在扫描到非空结果时缓存（空结果不固化，避免面板未插入时永久失效），去掉定时器里的反复全树遍历。
  - **主面板组件重命名**：`DM` → `MainPanel`（语义可读）。
  - **`playDidaSound` 异常留痕**：结构性异常记录 warning 日志；`play()` 被浏览器自动播放策略拒绝仍静默（属预期行为）。
  - **掉线检测双选择器**（`:nth-child(2)` / `:nth-of-type(2)`）补充「互补兜底」注释：页面结构差异时两者命中的元素不同，非冗余，不合并。
  - **`@match https://example.com/*` 与 `@connect *` 均为有意保留**（前者是面板/弹窗调试宿主，后者因中继地址由用户自定义而必须通配），已在元信息块下方加注释说明，勿再当作问题处理。
- 纯代码质量与健壮性改进，无功能变化；`node --check` 两文件通过。`@version`→`26.9.6-v1`。

### znhd.user.js v26.7.29-v11
- **支持 ESC 键关闭图片预览/文本弹窗**：图片放大预览（Viewer.js）弹出后，Viewer.js 自带的键盘监听在本脚本「把 `.viewer-container` 移入 `overlay`」的特殊处理 + 真实税务页面 body 常被加 transform 的环境下常常失效，导致 ESC 关不掉预览。新增一个独立的全局 `keydown` 监听兜底：① 预览（Viewer）可见时按 ESC 先退出预览回到画廊九宫格；② 画廊态按 ESC 直接关闭整个图片弹窗；③ 文本弹窗按 ESC 直接关闭。监听仅安装一次（自保护），按当前弹窗状态分支处理，与 Viewer.js 自带 ESC 互不冲突（幂等）。`@version`→`26.7.29-v11`。

### znhd.user.js v26.7.29-v10
- **修复收到图片弹窗「点缩略图放大后预览跑到弹窗后面 / 右上角关闭按钮消失」**：
  - 预览跑到弹窗后面：画廊 `overlay`（`z-index:2147483647`）与 Viewer 全屏预览容器（同样 `2147483647`）互相压制——Viewer 默认挂在 `body` 下、画廊挂在 `documentElement` 下，谁压谁取决于页面的层叠上下文（真实税务页面 body 常被加 transform/filter 形成独立层叠上下文，把挂 body 的 Viewer 困住，永远被画廊压后面）。修复：用 `MutationObserver` 监听 `.viewer-container` 出现即移入画廊 `overlay` 内部，使其处于本弹窗的层叠上下文之上（`vc.style.zIndex='2'`，高于白盒的 `1`），预览必定盖在白盒之上、且不受外部页面层叠上下文干扰；全屏预览时由 Viewer 自带 × 关闭回到画廊（标准模态交互）。（注：Viewer.js 该构建无 `on`/`addListener` 事件 API，故不依赖事件，改用 DOM 观察。）
  - 关闭按钮"消失/点不到"：① 全屏 Viewer 容器与画廊等 z-index 时会盖住画廊右上角的 ×——随预览移入 overlay 一并解决；并加安全网：监听 Viewer 显隐（`viewer-in` 类增删），隐藏后置 `pointer-events:none`，确保残留容器不遮挡画廊关闭按钮/缩略图。② **预存布局 bug**：box 是 `display:flex` 容器，标题作为 flex item 在层叠里等同 `z-index:0` 层，而关闭按钮是 `position:absolute`（同属 z-index:auto 层），同层按 DOM 顺序——标题在关闭按钮之后 append，会画到关闭按钮之上并吃掉点击（视觉无重叠，但标题隐形盒子铺满整行）。给图片画廊与文本弹窗的关闭按钮都加 `z-index:2!important` 抬到正 z-index 层修复。浏览器实测：预览在顶层、关闭后关闭按钮可点中均通过。`@version`→`26.7.29-v10`。

### znhd.user.js v26.7.29-v9
- **修复收到图片弹窗内缩略图/按钮被灰蒙蒙遮罩覆盖的问题**：通过浏览器实测复现确认，弹窗自身 CSS 干净（白底、图片/按钮 `opacity:1`、`filter:none`、无伪元素遮罩）。灰蒙蒙来自**宿主页面的某个 z-index 高于 `2147483640` 的半透明灰层**（可能是翻译/深色模式/阅读模式类扩展，或税务站自身的高层级遮罩）盖到了弹窗内容上方。修复：将弹窗 `overlay` 的 `z-index` 提升到 CSS 最大值 `2147483647`；给白盒 `box` 增加 `isolation:isolate`、`filter:none`、`backdrop-filter:none`、`z-index:1`；并对 `grid` / `thumbWrap` / `img` / 所有按钮显式声明 `filter:none`、`backdrop-filter:none`、`opacity:1`，最大限度隔绝外部滤镜与高级别遮罩的渗透。`@version`→`26.7.29-v9`。

### znhd.user.js v26.7.29-v8
- **消除图片/文本预览弹窗的 `FocusLock: focus-fighting detected` 告警**：预览弹窗（`renderImageGallery`/`showTextPopup`，裸 DOM 挂 `documentElement`）内的 `<button>`（复制/下载/清空）是焦点可夺取元素。当脚本面板的 arco 抽屉（设置/常用语/手机传图）或税务页面自身的 arco 弹窗同时开着时，arco 的 focus-lock 焦点锁发现焦点跑到弹窗按钮上又拉不回，反复打架刷此告警。修复：弹窗挂载后对其内所有 `button` 设 `tabIndex=-1` 且 `mousedown` 时 `preventDefault()`（阻止抢占焦点，鼠标点击 `onClick` 仍正常）。`@version`→`26.7.29-v8`。

### znhd.user.js v26.7.29-v7
- **二次修复 CDN 开关（裸 `input` 仍触发 React #137）**：上一版改用裸 `createElement('input')` 报错 `React error #137; got input`——证实 CAT_UI 的 React 渲染器白名单**连 `input` 也不支持**（与 `img` 同类）。再次改为白名单内的 `div` 模拟勾选框：受控样式（`useCdn` 为真时蓝底白勾、假时灰框），点击 `onClick` 调 `onChangeUseCdn(!useCdn)` 取反。`@version`→`26.7.29-v7`。

### znhd.user.js v26.7.29-v6
- **修复设置抽屉崩溃（`CAT_UI.Switch is not a function`）**：实测 `CAT_UI.Switch` 运行时为 `undefined`（库清单误列，与 `TimePicker`/`Image` 同类陷阱），导致打开「设置」即报错。改用原生 `<input type="checkbox">`（受控，配合 `onChange` 写回 `useCdn`），视觉与交互不变。默认开启 CDN 的逻辑不受影响（`loadAllvalue` 以 `{...DEFAULTS, ...parsed}` 合并，`useCdn` 缺省由 `DEFAULTS.useCdn:true` 兜底）。`@version`→`26.7.29-v6`。

### znhd.user.js v26.7.29-v5
- **新增「使用 CDN 加速」配置 + `resolveGithubUrl()` 转换函数**：设置抽屉新增开关「使用 CDN 加速（jsDelivr）加载资源」（默认开启，存于 `Allvalue.useCdn`）。新增模块级函数 `resolveGithubUrl(githubUrl)`：输入一个 GitHub 文件链接，开启 CDN 时输出 `https://cdn.jsdelivr.net/gh/用户名/仓库名@分支/文件路径`，关闭时输出原始 `raw.githubusercontent.com` 链接；非 GitHub 链接（如 npm CDN）原样返回。分支含斜杠（如 `refs/heads/main`）用单次捕获正则正确转换。已接入：① `commonPhrasesUrl` 默认值改为 GitHub 网页链接、取用时经该函数解析（常用语抽屉「数据源」也显示解析后实际地址）；② `CONFIG.didaUrl` 改为 GitHub 链接、`playDidaSound` 取用时解析。Viewer.js 的 npm CDN 链接不属 GitHub 资源，维持原样。`@version`→`26.7.29-v5`。

### znhd.user.js v26.7.29-v4
- **「本机上传链接」区二维码与链接左右对调**：用户要求二维码放在左侧。修正了上一版（v3）嵌套错误导致二维码与链接实际未左右并列的问题——现 flex 容器两个子节点严格左「二维码（`140×140px`，带边框圆角）」、右「链接文本 + 复制链接按钮」；二维码未生成时左侧显示占位提示，抽屉窄时自动换行。`@version`→`26.7.29-v4`。

### znhd.user.js v26.7.29-v3
- **「本机上传链接」区改为左历史*：原「链接 + 复制按钮」与二维码纯上下堆叠，现改为 flex 左右历史左侧显示链接文本与「历史」按钮，右侧显示二维码（`140×140px`，带 1px 浅灰历史角）；二维码尚未生成时右侧显示占位提示。抽屉较窄或移动端自动换行（`flexWrap: 'wrap'`）。`@version`→`26.7.29-v3`。

### znhd.user.js v26.7.29-v2
- **面板按钮重排 + 新增「查看待存文件」入口**：面板按钮区改为两行——第一行「设置、常用语」，第二行「查看待存文件、设备互联」（「查看待存文件」在「设置」正下方、「设备互联」在「常用语」正下方）。点击「查看待存文件」随时打开**已收到图片的画廊**（复用 `receivedImages` + `renderImageGallery`，与收到新图时弹出的画廊一致，含复制/下载/清空；列表未清空前可反复查看，空列表时提示「暂无待存文件」）。`@version`→`26.7.29-v2`。

### relay-server v26.7.29-v4
- **手机端收图弹窗视觉与脚本端完全一致**：把 `#recvPopup` 从「深色全屏遮罩+纯图片网格」改为脚本端同款**白底圆角卡片**——标题「收到的图片（N）· 单击放大」+ 红色 × 关闭 + 3 列缩略图（每张带「复制 / 下载」按钮 + 单张移除 ×）+ 底部「清空全部」；点击缩略图仍由 Viewer.js 接管放大/旋转/多图切换（遮罩压黑 `!important`，`zIndex:99999` 盖住卡片）。复制/下载走 `dataURL→Blob`（`ClipboardItem` 复制图片、`<a download>` 保存），CDN 不可达时退回 `openRecvImage` 单图查看。relay `package.json` version→`26.7.29-v4`。

### relay-server v26.7.29-v8
- **修复多选非 HEIC 图片卡死**：先前把 `compressFile` 重构为 `compressBlob` 时漏删一行残留 `reader.readAsDataURL(f)`（`reader` 已移入 `compressBlob` 内部、`compressFile` 作用域不再存在）。非 HEIC 多选时该残留行抛 `ReferenceError` 中断 `files.forEach` 循环，致后续图片不处理、`doneCount` 永远小于总数、状态永久卡在「处理中…」；HEIC 分支因提前 `return` 规避报错故不卡。已删除残留行。relay `package.json` version→`26.7.29-v8`。⚠️ 须重启 `node server.js`（容器内 `docker restart znhd`）生效。

### relay-server v26.7.29-v7
- **HEIC 改用 heic2any（公共 CDN）转 JPEG 后再压缩直传**：手机上传页 `<head>` 引入 `https://cdn.bootcdn.net/ajax/libs/heic2any/0.0.4/heic2any.js`；`compressFile` 对 HEIC/HEIF 走 `heic2any({blob, toType:'image/jpeg'})` 解码转 JPEG，`toBlob` 前先 `fillStyle='#fff';fillRect` 铺白底（防透明区黑底），成功后再 canvas 压成 JPEG 上传；库缺失/转换失败时回退原样直传兜底。确保 HEIC 在电脑端（含 Windows，无需额外编解码器）能直接打开。relay `package.json` version→`26.7.29-v7`。

### relay-server v26.7.29-v6
- **HEIC 支持（原样直传回退）+ 失败原因可见**：`compressFile` 新增 `isHeic` 检测（mime `image/heic`/`image/heif` 或文件名 `.heic`/`.heif`）；浏览器可解码 HEIC（如 iOS Safari）仍压 JPEG，不可解码（`img.onerror`）或 canvas 压缩失败（`toBlob` 返回 null）时改为**原样直传**避免整张被跳过。同步把多选失败提示从笼统「N 张处理失败已跳过」改为显示具体「文件名：原因」（如 `IMG.heic：图片解析失败` / `压缩失败` / `读取文件失败`）。relay `package.json` version→`26.7.29-v6`。

### relay-server v26.7.29-v5
- **压缩图铺白底，透明 PNG 不再黑底**：`compressFile` 在 canvas `drawImage` 前先 `fillStyle='#fff';fillRect(0,0,cw,ch)` 铺白。修复手机选带透明圆角/透明背景的 PNG 被压成 JPEG 后透出黑色背景的问题（透明像素在 JPEG 无透明通道、canvas 默认黑底所致）。relay `package.json` version→`26.7.29-v5`。

### znhd.user.js v26.7.29-v1
- **「发送到手机」选图改为先预览后发送（与手机端一致）**：原选完图片立即上传，现改为选图仅加入「待发送」预览列表（抽屉内 3 列缩略图网格，单张 × 移除、可继续添加），点「发送 N 张到手机」才真正逐张顺序上传；避免误选即发的冲动操作。发送逻辑与之前一致（逐张顺序、失败即停、进度日志）。`@version`→`26.7.29-v1`。

### relay-server v26.7.29-v3
- **手机端收图改用真·Viewer.js（与脚本端一致）**：`<head>` 通过 `https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.js` + 对应 CSS 引入 Viewer.js；画廊渲染后用 `new Viewer(recvGrid, {...})` 绑定，点击缩略图即弹出 Viewer.js 查看（缩放/旋转/翻转/多图左右切换），`zIndex:99999` 确保弹窗盖在画廊遮罩之上；CDN 不可达时 `recvViewer=null`，缩略图点击退回 `openRecvImage` 自定义单图查看兜底。relay `package.json` version→`26.7.29-v3`。

### relay-server v26.7.29-v1
- **手机端收图改为弹窗查看（真用 Viewer.js，与脚本端一致）**：原「电脑发送到手机」的图片收进页面底部内联九宫格，现改为收到即自动弹出**画廊弹窗**（固定全屏遮罩 + 3 列缩略图），点击缩略图用 **Viewer.js**（`https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.js`）弹出放大/旋转/多图左右切换，与脚本端完全一致；CDN 不可达时退回 `openRecvImage` 自定义单图查看。点弹窗空白/× 关闭；关闭后底部保留「🖼 收到的图片（N）」按钮可重新打开。文本仍走独立弹层。
- 纯中继手机页改动；relay `package.json` version→`26.7.29-v1`；渲染后手机页脚本 `new Function` 语法校验通过。⚠️ 须重启 `node server.js`（容器内 `docker restart znhd` 即生效，手机页由中继同源托管）。

### v26.7.28-v3
- **画廊新增「下载」按钮**：每张缩略图下方按钮区改为「复制 + 下载」两键并排，下载把原图 blob 存为文件（优先原始文件名，无扩展名时按 MIME 自动补 `.jpg/.png/.svg` 等）。
- **「发送到手机」支持多选图片**：文件选择器加 `multiple`，逐张顺序发送（一张成功再发下一张，日志显示进度 `n/总数`，失败即停并提示已发张数）。需配合 relay v26.7.28-v5 的手机收件队列，否则连发会互相覆盖。

### relay-server v26.7.28-v6
- **手机端"来自电脑"的图片改为九宫格画廊**（与脚本端 Viewer.js 画廊对齐）：原实现每收到一张图就弹一个独立全屏弹窗，多选连发时多个弹窗叠在一起、看不到九宫格。现改为把电脑发来的图片统一收进 `#recvGrid` 九宫格（3 列缩略图、多张累积、带序号角标），**点击缩略图才放大查看**（全屏遮罩 +「长按保存」）；文本仍弹独立弹层。已验证：渲染页内联脚本 `new Function()` 语法 OK、`/\.svg$/i` 反斜杠未被模板字符串吞掉、`recvGrid`/`renderRecvGrid`/`openRecvImage` 均就位。⚠️ 需重新部署，`curl /health` 看到 `26.7.28-v6` 即生效。

### relay-server v26.7.28-v5
- **修复 SVG 图片兼容问题**：手机上传页原对所有图片走 canvas 压缩，SVG 常光栅化失败（无固有尺寸时画布为 0 / 部分 WebView 直接 onerror），导致无法预览也无法发送。现 SVG（按 MIME 或 `.svg` 扩展名识别）跳过压缩**原样直传**，并强制修正 blob 类型为 `image/svg+xml`——手机预览、电脑端画廊显示、放大查看均正常（注意：SVG「复制到剪贴板」受浏览器限制可能失败，可用「下载」按钮代替）。
- **删除手机端 9 张选图上限**：`MAX_PICK` 移除，选图张数不限；服务端每设备暂存队列上限从 9 提高到 100（纯内存保护，正常收发不会触顶）。
- **电脑 → 手机收件通道队列化**：`phonePending` 从单槽改为 FIFO 队列（同 `pending`，上限 100、超出丢最旧记 `[丢弃]` 日志），支持电脑端多选图片连发不丢图。已端到端验证：连发 3 条按序取回、第 4 次返回 `empty`；SVG mime 全链路透传无损。⚠️ 需重新部署，`curl /health` 看到 `26.7.28-v5` 即生效。

### v26.7.28-v2
- **修复：Viewer.js 放大图片时背景半透明**——Viewer 默认遮罩为 `rgba(0,0,0,0.5)`，放大时会透出后面的画廊弹窗（"收到的图片 · 单击放大"）。现注入覆盖样式把 `.viewer-backdrop` / `.viewer-container` 改为纯黑不透明，放大查看时完全遮住背景。

### v26.7.28-v1
- **接收端图片改为九宫格画廊 + Viewer.js 放大**：原来"每收一张弹一个单图弹窗、新图顶掉旧图"，现在收到的图片累积进画廊弹窗，以 3 列九宫格缩略图展示（最多保留 27 张，超出丢最旧并释放内存）。
  - **单击缩略图即用 Viewer.js 放大查看**：支持滚轮缩放、旋转、翻转、1:1、多图左右切换（`@require` jsdelivr 的 `viewer.min.js`，CSS 经 `@resource` + `GM_getResourceText` 注入，失败自动回退 CDN `<link>`；Viewer 未加载时缩略图和复制功能不受影响）。
  - 每张缩略图下方独立「复制」按钮（保留点击手势写剪贴板），右上角 × 单独移除；底部「清空全部」；关闭弹窗不清空列表，收到新图会带着历史图片再次弹出。
  - 新增授权：`GM_getResourceText`。配合 relay v26.7.28-v4 的手机端 9 张多选上传食用最佳。

### relay-server v26.7.28-v4
- **手机上传页支持多选图片（最多 9 张）**：`<input>` 加 `multiple`，选图后九宫格缩略图预览（可单张 × 删除、可分多次追加，合计上限 9 张）；发送时逐张压缩上传并显示进度（`发送中…（n/总数）`），某张失败即停、剩余保留可点按钮重试。
- **中继服务端暂存改为 FIFO 队列**：原 `pending` 为每设备单槽，连发多张且电脑端未及时取走时会互相覆盖丢图。现改为每设备队列（上限 9 条，超出丢弃最旧并记 `[丢弃]` 日志），`/recv` 长轮询每次投递队头一条，电脑端收到即自动再轮询取下一条——**电脑端油猴脚本无需任何改动**。
- 已本地端到端验证：连发 3 条按序取回、第 4 次取返回 `empty`、连发 10 条时最旧一条被正确丢弃；渲染后内联脚本 `new Function()` 语法校验通过。⚠️ 需重新部署中继服务，`curl /health` 看到 `26.7.28-v4` 即生效。

### v26.7.27-v1
- **版本号日期修正（跨天重置）**：上一轮「双向互传」功能实于 2026-07-27 完成，但 `@version` 误写为 `26.7.26-v25`（沿用了前一天日期）。按版本号约定——跨天须将日期部分改为当天、序号重置为 v1——现更正为 `26.7.27-v1`。功能内容与 `v26.7.26-v25` 完全一致（电脑端↔手机端双向互传），无其它代码改动。⚠️ 仍须**两端同步更新并重启 `node server.js`**。

### v26.7.26-v25
- **新增「电脑端 → 手机端」发送（双向互传）**：脚本端现在也能把文本/图片发回手机。
- **中继服务器 `server.js`**：新增反向通道内存表 `phoneOnline`/`phonePending`/`phoneWaiting` 与 `PHONE_TTL=20s`；新增 4 条路由——
  - `POST /phone/heartbeat/<id>`（手机报活）、`GET /phone/status/<id>`（返回 `{online}`，电脑端据此判断是否可发）、`POST /phone/send/<id>`（电脑发图/文，镜像 `/u`）、`GET /phone/recv/<id>`（手机长轮询收件，镜像 `/recv`）。
- **手机上传页（内联）**：打开即每 8s 心跳报活；长轮询 `/phone/recv`，收到图片**自动弹出与脚本端一致的白底卡片画廊弹窗**（标题「收到的图片（N）· 单击放大」+ 红色 × + 3 列缩略图，每张带「复制 / 下载」按钮 + 单张移除 ×，底部「清空全部」），**点击缩略图用 Viewer.js 放大查看**（缩放/旋转/多图切换，与脚本端一致）、CDN 不可达时退回自定义单图查看+「长按保存」；收到文本展示+「复制文本」；关闭弹窗后底部保留「收到的图片（N）」按钮可重新打开；顶部加在线状态指示。
- **电脑端 `znhd.user.js`**：`PhoneImageDrawer` 扩为「手机互传」抽屉——轮询 `/phone/status` 显示 🟢已连接/⚪无在线设备；文本输入框+发送按钮、**图片选完先在下方的 3 列缩略图网格预览、点「发送 N 张到手机」才真正上传**（与手机端上传页行为一致，单张 × 可移除、可继续添加）；离线时发送按钮置灰并提示「当前无在线设备，无法发送」；发送成功/失败写面板日志。新增 `sendToPhone` 辅助（GM_xmlhttpRequest POST `/phone/send`）。
- 纯前端+中继改动；`@version`→`26.7.26-v25`；两文件 `node -c` 通过。⚠️ 须**两端同步更新并重启 `node server.js`**；手机页由中继同源托管，重启后即含心跳+收件箱。

### v26.7.26-v24
- **文本弹窗固定最小尺寸**：原先 `box`/`textEl` 只设 `max-*` 无下限，文本很短时弹窗会缩得很小、观感差。现给 `box` 加 `min-width:360px;min-height:200px`，给文本区 `textEl` 加 `min-width:320px;min-height:120px`；文字多时仍按 `max-*` 正常放大不截断。
- 纯 UI 调整；`@version`→`26.7.26-v24`；语法 `node -c` 通过。

### v26.7.26-v23
- **移除弹窗右下角的版本号标记**：图片预览窗与文本预览窗原本在右下角显示 `znhd vX.Y.Z`，因版本号已在脚本面板中统一展示，属多余信息，已删除（两处弹窗的 `ver` 元素及其 `appendChild` 一并移除）。
- 纯 UI 清理，无功能变化；`@version`→`26.7.26-v23`；语法 `node -c` 通过。

### v26.7.26-v22
- **新增「手机发送文本到电脑」功能**（与发图并行）：手机上传页新增文本输入框 + 「发送文本到电脑」按钮；中继服务器 `/u/<id>` 的 POST 现同时支持 `{text}`（文本）与 `{data,mime,name}`（图片），并以 `type` 字段区分。
- **中继服务端**：`pending` 条目统一带 `type`（`image`/`text`）；`deliverToAll` 改为回传整条（含 type），由电脑端按类型分流，广播机制对文本同样生效（多标签同时接收互不丢）。
- **电脑端 `znhd.user.js`**：`startPhoneReceive` 的 `/recv` 轮询按 `data.type` 分流——`image` 走 `onImage`（弹图片预览窗），`text` 走新增的 `onText`（弹文本预览窗）。`onText` 在弹窗前写一条 `成功` 日志（含前 40 字），并调用新增 `showTextPopup`：网页正中弹窗展示文本 + 「复制到剪贴板」按钮（复用 `safeCopyText`，含日志与提示音）+ 关闭按钮，点遮罩空白也可关闭。
- 版本标记右下角 → `v22`，`@version`→`26.7.26-v22`；语法 `node -c` 两文件均通过。
- ⚠️ 两端需同步更新并**重启中继服务器**（`node server.js`）才生效；手机页由中继同源托管，重启后即含文本框。

### v26.7.26-v21
- **手机收到图片时写入面板日志**：`onImage` 回调原先只弹出预览窗、不记日志，导致"脚本确实收到了图"在设置面板日志里看不到证据。
- 改动 `znhd.user.js`：`onImage` 在 `showImagePopup` 之前新增 `addLog('[设备互联] 收到图片：' + 文件名 + '（' + MIME + '）', 'success')`，日志进入设置面板「日志」区，`onImage` 信息中明确文件名与类型。
- 版本标记右下角 → `v21`，`@version`→`26.7.26-v21`；语法 `node -c` 通过。

### v26.7.26-v7
- **加快大图复制**：原 `blobToPng` 对整张原图（手机常 4000px+）做全分辨率解码 + canvas + PNG 无损编码，大图点击「复制」后卡顿明显。
- 改为 `prepareClipboardImage`：写入前先降采样到**最大边 1600px** 再编码 PNG，像素数降至约 1/6，解码/内存/PNG 编码同步变快；已在限制内的小图不降采样。仅当「原图直写」失败（内核仅支持 image/png）时才走此预处理。
- 仍零客户端依赖；若追求极致速度，可在中继服务器用 `sharp`(libvips) 在上传时预处理，使电脑端收到即小图、无需任何客户端编码（需给 relay-server 加原生依赖，按需启用）。

### v26.7.26-v6
- **修复「复制成功但剪贴板无图」假成功**：根因是旧实现把 `GM_setClipboard(blob, type)` 作为图片复制首选项——而 ScriptCat 的 `GM_setClipboard(data:string)` 仅支持文本，传 Blob 时**不报错也不真正写图**，导致 `resolve(true)` 误报成功。
- 改为：图片复制**唯一可靠路径 = 页面主世界 `unsafeWindow.navigator.clipboard.write`**（先拿原始 blob 直接写以保留点击手势，失败再统一转 PNG 重试）；隔离世界同名 API 作兜底；**彻底移除不可靠的 `GM_setClipboard` 图片分支**。
- 弹窗「复制到剪贴板」按钮文案随真实结果变化（成功→绿色"已复制，去 Ctrl+V"；失败→"复制失败，请长按图片保存"）。

### v26.7.26-v15
- **真正修复弹窗「透出文字」（浏览器实测坐实）**：在连着的真实 Chrome 里测量运行中的弹窗，发现遮罩 `overlayComputedOpacity = 0.8`（实测 `runningPopupVersionMarker = "znhd v26.7.26-v14"`），即**弹窗遮罩自身带 `opacity:0.8`**——黑底只盖 80%，故透出后面文字。关键 CSS 机制：`opacity<1` 会把元素与其**全部子元素（白框/图片/按钮）整体压成同透明度一起半透明**，所以一透全透。
- 同时实测：遮罩 `overlayRect = {0,0,1774,950}` 已**铺满视口**、`bodyTransform=none`、挂到 `<html>` 也正常——证明「`body` 的 transform 改写 fixed 包含块」**并非本例真因**（旧推断被实测推翻）。
- 修复：给弹窗 `overlay`/`box`/`ver`/`close`/`copyBtn` 全部内联加 `opacity:1!important`（内联 `!important` 优先级最高，能压过任何旧副本或全局 CSS）。**现场验证**：在运行中的旧弹窗上注入 `opacity:1!important`，计算透明度即时由 `0.8 → 1`，证明修复有效。
- 教训：此前多版推断（半透明遮罩背景、`body` transform、CAT_UI 污染、旧脚本未重载）均被实测数据逐一排除；最终靠"测量运行中弹窗的计算样式"而非"读代码猜"才定位。版本标记右下角同步改为 `v15`。

### v26.7.26-v16
- **遮罩改回半透明、但弹窗与图片保持不透明（标准模态效果）**：用户要求背景半透明（能隐约看到页面），但白色弹窗框与图片本身不透明。
- 关键 CSS 机制（v15 已确认）：`opacity<1` 会令元素与**其全部子元素**一起半透明，故**不能**用 `overlay{opacity:0.55}` 实现。正确做法：`overlay` 保持 `opacity:1!important`，只让**背景色**用半透明 `rgba(0,0,0,0.55)!important`——这样只有"背景那层黑"是透的，而 `box`(白底 `#fff`)/`img`(JPEG 不透明) 各有自己的不透明背景，互不影响，弹窗与图片完全不透明。
- 改动 `znhd.user.js`：`overlay` 背景由 v15 的纯黑 `#000!important` 改回 `background:rgba(0,0,0,0.55)!important`；`overlay`/`box`/`ver`/`close`/`copyBtn` 的 `opacity:1!important` 全部保留。版本标记右下角 → `v16`，`@version`→`26.7.26-v16`；语法 `node -c` 通过。

### v26.7.26-v20
- **修复"连上服务器"日志误报「连接服务器超时」**：v19 用 `/health` 即时探测触发 `onConnected`，但用户运行的是**旧版中继**（无 `/health` 路由），该探测请求一直挂起、5 秒后超时报「连接服务器超时」；而真正的 `/recv` 接收始终正常，所以图片照收、`markConnected` 仍通过 `/recv` 的 `onload` 触发了「已自动开始接收」——两条日志同秒出现即此矛盾。
  - 彻底**删除 `checkConnectivity()` 与 `/health` 探测**（本身脆弱，依赖服务器有该端点）。
  - 改用「**首次 `/recv` 长轮询用极短 `maxwait=1000`**」快速确认已连上：服务器很快返回空响应即 `markConnected` → `onConnected` 触发「已自动开始接收」日志（约 1 秒内），后续轮询恢复 `maxwait=25000` 实时等待图片。
  - 真正的「连接服务器失败」仅在 `/recv` 首次 `onerror`（网络真不可达）时一次性提示，不再有矛盾的超时误报。
- 版本标记右下角 → `v20`，`@version`→`26.7.26-v20`；语法 `node -c` 通过。

### v26.7.26-v19
- **「已自动开始接收」日志时机再定为"连上服务器即立即显示"（推翻 v18）**：用户澄清——日志应在**脚本连上服务器时立即**出现，而非手机发送/收到图片之后。v18 的 `onImage` 写法被撤销。
  - `startPhoneReceive` 新增 **`/health` 即时连通性探测**（`checkConnectivity()`，在 `poll()` 前调用）：GM_xhr `GET /health`，**一旦服务器响应就 `markConnected()` 触发 `onConnected` → 日志立即显示**。此方案在 v20 被推翻（见下）。
  - 长轮询 `onload` 内的 `markConnected()` 保留作兜底（`connected` 标记去重，不会重复打日志）。
  - 自动接收 `useEffect` 把该 `addLog` 重新移回 `onConnected` 回调（与 v17 一致），地址末尾 `/` 一并归一 `replace(/\/+$/,'')`。
- **中继服务器地址填写时自动去尾斜杠（请求 #3）**：设置输入框 `onChange` 在校验前加 `url = url.trim().replace(/\/+$/, '')`——用户粘贴 `http://x:5689/` 这类带 `/` 的地址会被即时处理为 `http://x:5689` 再保存/显示。`startPhoneReceive` 与设备互联抽屉拼链接处本就归一，显示链接始终干净。
- 版本标记右下角 → `v19`，`@version`→`26.7.26-v19`；语法 `node -c` 通过。

### v26.7.26-v18
- **「已自动开始接收」日志时机再修正**：v17 改为"连上服务器（首次轮询 `onload`）才显示"，但长轮询即便未收到图片也会在 `maxwait` 后返回空响应，导致该日志仍会在脚本一启动轮询（约 25s 内）就打出，并非手机发送后。
  - 现改为：日志移到 `onImage` **首次真正收到手机图片** 时才 `addLog`，即**手机端点击发送之后**才显示「`[设备互联] 已自动开始接收（…）`」。用 `firstImageLogged` 标记去重，避免后续每张图都刷该日志。
  - 自动接收 `useEffect` 删除 `onConnected` 用法（该回调改为不再用于此日志）。
- 版本标记右下角 → `v18`，`@version`→`26.7.26-v18`；语法 `node -c` 通过。

### v26.7.26-v17
- **设置面板排版调整**：删除「常用语数据源」「中继服务器（设备互联）」两个分隔标题（Divider）；「常用语数据地址」与「中继服务器地址」两项内容直接并入「其他设置」分组之下（去掉各自标题、保留说明文字与输入框）。
- **「已自动开始接收」日志改为"连上服务器后才显示"**：原逻辑在 `relayServer` 一填好就立刻 `addLog('[设备互联] 已自动开始接收…')`，此时其实还没连通服务器，属误报。
  - `startPhoneReceive` 新增 `onConnected` 回调：长轮询首次 `onload`（真正收到服务器响应）时 `markConnected()` 触发一次 → 仅此时才打「已自动开始接收」日志（含服务器地址）。
  - 顺带：连不上时（`onerror`）打**一次性**「[设备互联] 连接服务器失败，请检查中继地址/网络（…）」错误日志（`loggedConnFail` 去重，避免 2s 轮询刷爆），不再静默让用户误以为已连。
  - 自动接收 `useEffect` 把该 `addLog` 从「启动前」移入 `onConnected` 回调内。版本标记右下角 → `v17`，`@version`→`26.7.26-v17`；语法 `node -c` 通过。

### v26.7.26-v14
- 弹窗加固（防御性，但**非本 bug 真因**，实测推翻）：遮罩改挂到 `document.documentElement`（`<html>` 而非 `<body>`），以规避个别 SPA 在 `body` 施加 `transform`/`filter`/`will-change`/`contain` 改写 `position:fixed` 包含块、导致遮罩偏移的可能；并加 `!important` + 铺满 `100vw/vh` 双保险、右下角显版本标记、加自动诊断日志。
- ⚠️ 事后实测（v15）表明：本例真实页面 `bodyTransform=none` 且遮罩已铺满视口，故 transform 偏移理论**不成立**；真因是遮罩自身 `opacity:0.8`（见 v15）。v14 的 `documentElement` 挂载与 `!important` 仍保留作为防御层。

### v26.7.26-v13
- **弹窗透字自动诊断**：用户确认 ScriptCat 实际运行的是 v12（排除"旧版半透明遮罩"假设）。v12 遮罩 `#000`+`!important`+铺满 `100vw/vh` 且 CAT_UI 样式隔离，逻辑上不应透字，故"仍透字"只可能来自外部：①更高/同级半透明元素遮挡；②祖先 `transform` 把 `position:fixed` 限制住、遮罩未真正铺满视口。
- 新增**弹窗出现即自动诊断**：在 Console 打印 `[znhd弹窗诊断]` 一行，含视口/遮罩尺寸、computed 背景色、`document.elementsFromPoint` 中心点元素栈（顶→底），并据此 warn：遮罩非最顶层(有遮挡) / 背景非纯黑(被外部样式覆盖) / 遮罩未铺满视口(疑祖先 transform 限制)。用户重装后看一行日志即可定位。

### v26.7.26-v12
- **排查"弹窗仍半透明"**：经核查 CAT_UI 库源码，其样式**全部带 `.ar.co-` 前缀且面板在 Shadow DOM 内**，页面级无任何无前缀全局规则（`adoptedStyleSheets` 0 次、`document.head` 仅用于加载脚本），故**面板半透明不会影响挂在 `document.body` 的弹窗**。
- 弹窗仍透字的最大可能 = **ScriptCat 实际跑的仍是旧版遮罩 `rgba(0,0,0,0.55)`**（与面板半透明是两回事）。
- 加固：① 弹窗全部样式加 `!important`、遮罩铺满 `100vw/vh`，隔绝任何外部 CSS 覆盖；② 弹窗右下角显示版本号 `znhd v26.7.26-v12`，一眼确认加载版本，终结"改了却没生效"的扯皮。

### v26.7.26-v11
- **加固弹窗遮罩必定铺满全屏**：遮罩定位由 `inset:0` 简写改为显式 `top/left/right/bottom:0`，规避个别内核不识别 `inset` 导致遮罩未铺满、从而露出底层页面文字的可能；背景保持 `#000` 实心不透明。

### v26.7.26-v10
- **图片弹窗遮罩改为完全不透明**：原遮罩背景为 `rgba(0,0,0,0.55)`（半透明，会透出底层页面），现改为纯黑 `#000` 不透明，弹窗显示时不再透出后面页面内容。

### v26.7.26-v8
- **修复「复制到剪贴板」点击后长时间等待**：根因是 PNG 重编码（`createImageBitmap`+`canvas.toBlob`）发生在**点击时**，卡在点击与「已复制」之间。改为**图片到达弹窗显示时即在后台预转换好 PNG**，点击直接写入、零转换、即时响应。同时移除「先尝试原图 jpeg」的浪费分支（ScriptCat 内核仅可靠支持 `image/png`，该尝试必失败再转 PNG）。`prepareClipboardImage` 对已是 PNG 的图直接复用、不再重编码。

### v26.7.26-v7
- **大图复制提速（客户端降采样）**：`blobToPng` 改为 `prepareClipboardImage`，在退回 PNG 时先按最大边 1600px 降采样再编码，解码内存/Canvas 分配/PNG 编码同步变快；小图不降采样。仅在「原图直写」失败（内核仅支持 `image/png`）时触发。

### v26.7.26-v6
- **修复图片复制「假成功」**：旧代码把 `GM_setClipboard(blob, type)` 放最优先，而 ScriptCat 该 API 仅支持文本，传 Blob 会静默无效且 `resolve(true)` 报成功、剪贴板却为空。改为**唯一可靠路径 = 页面主世界 `unsafeWindow.navigator.clipboard.write`**（先试原始 blob 直写以保留点击手势，失败再转 PNG 重试），彻底移除假成功的 `GM_setClipboard` 图片分支。

### v26.7.26-v5
- **图片复制再加固（依据异步 Clipboard API 文档）**：文档指出 Chromium 内核 `navigator.clipboard.write` 对图片**只可靠支持 `image/png`**，而中继转发的是手机原图（多为 `image/jpeg`）。新增 `blobToPng()`（用 `createImageBitmap`+Canvas 转 PNG，best‑effort）在写入前统一转 PNG，规避该限制。各级兜底（GM_setClipboard / unsafeWindow 页面主世界 / 隔离世界）均改为写 PNG。

### v26.7.26-v4
- **修复手机图片复制到剪贴板失败**：原 `copyImageToClipboard` 只走 `navigator.clipboard.write`，而 ScriptCat 隔离世界里 `ClipboardItem` 全局常不存在 → 直接判定失败。改为三级兜底：①`GM_setClipboard(blob,type)`（扩展特权）②**页面主世界 `unsafeWindow.navigator.clipboard.write` + `unsafeWindow.ClipboardItem`**（HTTPS 页面下必定可用，保留点击手势）③原隔离世界写法。
- **图片弹窗关闭按钮美化**：右上角「×」改为红底白字圆形按钮（`#e4393c`，hover 加深为 `#c9302c`）。

### v26.7.26-v3
- 「设备互联」改为**默认自动接收**：「设置 → 中继服务器」填好公网地址（默认 `http://45.207.199.216:5689`）后脚本即自动长轮询取图，**移除「开始/停止接收」按钮**，无需手动点击
- 收到图片时在**网页正中弹出预览弹窗**（直接挂到 `document.body`，不受 CAT_UI 面板 transform 影响）：含底部「复制到剪贴板」按钮与右上角关闭按钮
- `@version` 按 `YY.M.D-vN` 规范递增为 `26.7.26-v3`

### v26.7.26-v2
- 「设备互联」二维码改为**脚本端本地生成**：引入客户端库 qrcodejs（`@require`），抽屉内用 `new QRCode` 渲染后读取 `canvas.toDataURL()` 显示，二维码本地秒出、不再依赖服务器
- 中继服务器 `relay-server` 移除 `/qr` 端点与 `qrcode` 依赖，现为**纯 Node 内置 http、零依赖**，仅保留手机上传页、`/recv` 长轮询取图、`/health`
- `@version` 按 `YY.M.D-vN` 规范递增为 `26.7.26-v2`

### v26.7.26-v1
- 新增「设备互联到电脑」功能：手机图片经中继服务器转发到本机剪贴板（在征纳互动聊天框 Ctrl+V 粘贴）
- 每台电脑生成稳定设备 ID（`GM_setValue` 持久化），拼出独立上传链接 `/u/<ID>` 与二维码，实现 A/B 按用户隔离
- 中继服务器 `relay-server/server.js`（纯 Node 内置模块 + qrcode）：托管手机上传页（前端 canvas 压缩）、`/recv/<ID>` 长轮询取图、`/qr` 服务端生成二维码
- 电脑端用 `GM_xmlhttpRequest` 长轮询取图（绕过税务页面 CSP 对 connect-src 的限制），收到后「复制到剪贴板」按钮触发 `navigator.clipboard.write` 写图片
- 设置面板新增「中继服务器」地址配置项；`@version` 按 `YY.M.D-vN` 规范递增为 `26.7.26-v1`

### v26.7.19-v2
- 语音队列增加长度上限（`CONFIG.MAX_SPEECH_QUEUE=10`）：连续产生大量播报时，超出部分丢弃最早（最旧）的消息，避免内存堆积
- 新增过期清理：队列消息超过 `CONFIG.SPEECH_QUEUE_TTL=30s` 视为过期，`speak()` 入队与 `processSpeechQueue()` 播放前均会剔除，避免播报过时内容
- 新增 `clearSpeechQueue()`：语音开关从开启切换为关闭时立即清空队列（并 `speechSynthesis.cancel()` 中止当前播报），防止旧消息堆积、再次开启时集中涌出
- 队列元素结构调整：由直接存 `SpeechSynthesisUtterance` 改为 `{ utterance, enqueuedAt }`，`enqueuedAt` 用于过期判断；语法校验通过

### v26.7.19-v1
- 为脚本内全部 32 个具名公开函数补全 JSDoc 注释：统一包含 `@description` 用途说明、`@param`（含名称/类型/说明，可选参数用 `[name]` 语法）、`@returns`（类型与说明）
- 覆盖范围：日志/存储管理、工具函数（时间/HTML 转义）、四个 UI 组件（LogPanel/SettingsDrawer/CommonPhrasesDrawer/DM）、面板位置跟踪模块、监控检测（checkCount/isWorkingHours 等）、语音播报（speak/processSpeechQueue）、复制与提示音（safeCopyText/playDidaSound）等
- 纯注释补充，不改变运行时行为；语法校验通过

### v26.7.18-v4
- 常用语新增本地缓存策略：加载成功后缓存数据、数据源 URL 与时间戳
- 打开常用语抽屉时，若 2 小时内已加载且数据源 URL 未变，直接复用本地缓存、跳过网络请求（面板日志提示「使用本地缓存」）
- 「重新加载常用语」按钮改为强制刷新（忽略缓存）；修改数据源地址也会触发重新拉取

### v26.7.18-v3
- 常用语数据源地址现可在设置面板自定义（「设置 → 常用语数据源」），默认仍为 github 上的 commonPhrases.yaml
- 数据源支持留空回退默认地址，并校验必须以 http(s):// 开头
- 同期累积改进（v1→v3）：面板位置拖拽持久化与边界约束、工作时间段可在设置面板配置、工作时间控件改为时间选择器、面板标题改用站点 favicon、确立 `YY.M.D-vN` 版本号规范

### v26.2.26
- 新增操作提示音功能（`dida.mp3`），复制常用语时播放
- 新增安全复制机制：优先 `GM_setClipboard`，降级 `navigator.clipboard`
- 常用语新增关键字搜索过滤功能
- 优化 TinyMCE 文本追加逻辑：自动检测输入框是否为空，智能处理换行
- 语音播报新增队列管理，避免多条播报冲突
- 日志系统新增重复内容过滤

### v26.2.23
- 删除 P2P 传输功能
- 删除图片复制功能
- 常用语数据源从 JSON 格式改为 YAML 格式
