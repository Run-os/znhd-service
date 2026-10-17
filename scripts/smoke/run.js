/**
 * 无头端到端冒烟测试（npm run verify）。
 *
 * 用真实构建产物 dist/znhd.user.js 在 Chromium 里跑：
 *   - GM API 桩（GM_getValue/GM_setValue/GM_xmlhttpRequest/GM_addStyle/unsafeWindow…）
 *   - 与脚本完全相同的 @require 依赖（脚本猫 UI 库 / js-yaml / qrcodejs / Viewer.js）
 *   - 按真实中继协议投递：/recv 先空响应确认连接 → 1 条文本 → 1 张 PNG → 空转；常用语地址返回小 YAML
 *
 * 通过条件（全部满足，否则退出码 1）：
 *   面板渲染 / 版本号（= 产物 @version） / 收到内容自动打开传输助手 / 传输助手三栏窗口 /
 *   文件视图（九宫格 + 文本分区） / 设备会话收发（文本 + 压缩后图片） / 配对窗口（二维码 + 手机列表） /
 *   常用语 YAML 解析 / 常用语抽屉可打开 / 更新日志弹窗（最新 10 条 + 获取更多日志） /
 *   缩略图放大显示主图 / 图片复制只写 PNG / 打印 A4 自适应 /
 *   Agent 对话（v26.10.13-v9 已随 Agent 能力整体删除） / 图片嗅探 / 页面无脚本自身报错
 *
 * 前置：先 `npm run build` 生成 dist/znhd.user.js。
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const { startServer, BUNDLE } = require('./server');
const { hashInputs, readStamp } = require('./build-stamp');

/**
 * 浏览器可执行文件解析：默认用 puppeteer 自带的 Chromium；
 * 若设了 PUPPETEER_EXECUTABLE_PATH 或本机/CI 有系统 Chrome/Edge，则优先使用（免下载、更快）。
 */
const SYSTEM_BROWSERS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((p) => p && fs.existsSync(p));

async function launchBrowser() {
  const base = { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] };
  if (SYSTEM_BROWSERS.length) {
    try {
      return await puppeteer.launch({ ...base, executablePath: SYSTEM_BROWSERS[0] });
    } catch (e) {
      console.warn('系统浏览器启动失败，回退到 puppeteer 自带 Chromium：' + e.message);
    }
  }
  try {
    return await puppeteer.launch(base);
  } catch (e) {
    // CI 里设了 PUPPETEER_SKIP_DOWNLOAD=true（用系统 Chrome），本机若没装 Chrome/Edge 又跳过下载，
    // 就会走到这里。把「找了哪些路径」打出来，避免只看到 puppeteer 那句笼统的 Could not find Chrome。
    throw new Error(
      '找不到可用浏览器。已探测的系统路径：' +
        (SYSTEM_BROWSERS.join('、') || '（无）') +
        '；puppeteer 自带 Chromium 也不可用（若设了 PUPPETEER_SKIP_DOWNLOAD 则不会下载）。' +
        '请安装 Chrome/Edge，或用环境变量 PUPPETEER_EXECUTABLE_PATH 指定浏览器可执行文件。原始错误：' +
        e.message
    );
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHECKS = [
  ['panel', '浮动面板渲染'],
  ['version', '版本号渲染'],
  // ===== 传输助手（v26.10.12-v1：「设备互联 / 历史记录 / Agent 助手」三入口收敛为一个三栏窗口）=====
  ['transferAutoOpenOk', '收到手机内容时自动打开传输助手窗口（窗口不开也收件）'],
  ['transferWindowOk', '传输助手三栏窗口：导航/会话/主聊天区 + 会话列表 + 收到的消息'],
  ['transferNoTitleOk', '窗口无标题栏；顶部自绘标题条的关闭按钮贴右上角、悬浮变红（微信同款）'],
  ['filesViewOk', '「文件」视图：图片九宫格 + 文件卡片 + 文本分区 + 计数（原历史记录弹窗搬迁）'],
  ['filesNoJumpOk', '文件分组下点击第二栏设备条目不跳转会话窗口（点击=筛选文件视图）'],
  ['filesFilterOk', '文件视图跟随第二栏选择：点会话只显示该会话的文件，点「全部文件」还原汇总'],
  ['navStatesOk', '第一栏图标三态：选中=绿色填充无底板、未选中 hover=深色圆角底板（选中优先）'],
  ['sessionChatOk', '设备会话聊天区：收到的文本与图片渲染为聊天气泡'],
  ['sessionRouteBySenderOk', '按发送者归组：两台在线时各自手机的内容进各自会话（不再全进聚合「手机」）'],
  ['textSentOk', '会话内发送文本：本机气泡 + POST /phone/send'],
  ['phoneSendCompressedOk', '发送图片前压缩（JPEG、最长边≤1600、小于原图）'],
  ['sessionClearOk', '「清空消息」后会话回到空状态'],
  ['pairModalOk', '「+」配对窗口：二维码/链接/在线状态/手机列表'],
  ['qrNoRadius', '二维码无圆角（定位角标不被裁切）'],
  ['phoneIdColorOk', '设备 ID 有边框+彩色底，且不同设备底色不同'],
  ['pairTestImageBtnOk', '配对窗口有「发送测试图片」按钮'],
  ['testImageSentOk', '「发送测试图片」把图片投递到 /u/<deviceId>（手机上传同路径）'],
  ['transferThemeOk', '窗口固定微信暗色：标题条与第一栏同色 #2E2E2E、三栏深浅分层（聊天区最深）'],
  ['transferLayeredOk', '圆角+层级（v26.10.13-v10；v26.10.14-v1 起露出层与第一栏同色）：外框大圆角、第二三栏内嵌圆角卡片、第一栏贴满高度、输入区圆角浮起卡片'],
  ['transferSettingsIsolatedOk', '传输助手设置独立存储 scriptCat_TransferSettings（不污染主设置）'],
  ['fileChannelOk', '任意文件通道（v26.10.14-v6）：中继按 mime 分流 type:file → 「全部文件」有文件卡片 + 文件名'],
  // 轮询优化（v26.10.14-v7）：在线名单改由长轮询捎带 + 上下线唤醒送达，5s 轮询删除。
  // ⚠️ 这三条必须登记在这里才会参与最终判定 —— 页面里的 ALL-OK 标题是另一条链路
  //    （title 只用于报错信息），只往页面加断言而忘了这里 = 断言形同虚设（实测踩到过一次）。
  ['phonesNegotiatedOk', '长轮询声明 `phones=1` 订阅（中继只唤醒带该标记的连接，老脚本不受打扰）'],
  ['phonesViaLongPollOk', '在线名单随长轮询响应 piggyback 送达（不再单独轮询）'],
  ['onDemandStatusQueryOk', '/phone/status 退化为按需查询（启动/开窗时才打）'],
  ['phoneStatusPollRemovedOk', '5s 定时轮询已删除（同样时长内请求数远低于旧的每 5s 一次）'],
  // P5 指数退避（v26.10.14-v8）：官方口径仍是「只往页面加断言不进这里 = 断言形同虚设」
  ['recvBackoffOk', '重试指数退避（v26.10.14-v8）：2s→4s→8s→16s→32s→60s 逐档翻倍并封顶'],
  ['recvBackoffResetOk', '退避复位：成功收到一次响应后，下一次失败的等待回到 2s（不长期迟钝）'],
  ['recvBackoff429Ok', 'HTTP 429 直跳退避上限：首次重试就等 60s，不在 2/4/8 档位上空磨'],
  ['filesImgActionsOk', '「文件」视图图片格子：复制/下载/删除是右下角图标按钮（未 hover 隐藏，hover 出现）'],
  // v26.10.12-v3：气泡、滚动区、底部输入框抽成共用件（当时是为设备会话与 Agent 对话同款；
  // Agent 已于 v26.10.13-v9 删除，这三条继续守共用件本身）
  ['chatBubbleOk', '聊天气泡左右分栏（他人靠左微信灰 / 我的靠右微信绿）+ 头像在气泡外侧 + 时间分隔条'],
  ['chatComposerOk', '输入区（微信式）：工具栏表情/图片上传/文件 + 多行自增高（超上限后框内滚动）+ 右下角发送按钮 + 实心底面板'],
  ['emojiPackOk', '在线表情包：面板加载合集与图片，点一张**直接发送**（不进待发列表，会话里多一条图片气泡）'],
  ['emojiRelayFirstOk', '表情包走中继优先（v26.10.14-v3）：清单与图片都打中继 /emoji/ 路径，CDN 兜底零触发'],
  ['emojiNotInFilesOk', '需求①：表情包图片不进「全部文件」（v26.10.14-v3；会话里清空后只剩表情图时应图片 0）'],
  ['emojiHoverOk', '表情悬停放大预览：停 0.5 秒才弹出，浮层显示中移到另一张立即换图'],
  ['emojiAutoCloseOk', '表情面板自动收起：点一张表情后立即收起 / 点面板之外立即收起 / 点触发按钮收起'],
  // ===== 主面板既有断言 =====
  ['phrasesLoaded', '常用语 YAML 解析'],
  ['phrasesClicked', '常用语侧边栏可打开'],
  ['phrasesIsDrawer', '常用语是 antd Drawer 侧边栏（非 Modal）'],
  // v26.10.17-v3：常用语可以改用腾讯文档普通文档（/doc/）维护 —— 按「一级标题 = 标题、
  // 其下文本 = 正文」解析，第一个一级标题之前的说明文字必须丢弃。
  ['docPhrasesSwitchOk', '腾讯文档数据源：设置里填 docs.qq.com/doc/… 链接后真的切过去了（否则下面三条会假绿）'],
  ['docPhrasesHitOk', '腾讯文档数据源：请求走 dop-api/opendoc（不是 YAML 的 resolveGithubUrl）'],
  ['docPhrasesRefererOk', '腾讯文档数据源：请求带上文档页 Referer（该接口无 Referer 一律 401）'],
  ['docPhrasesTitlesOk', '腾讯文档数据源：两个一级标题都解析成常用语标题'],
  ['docPhrasesBodyOk', '腾讯文档数据源：一级标题下的多行正文拼进同一条常用语'],
  ['docPhrasesNoPreamble', '腾讯文档数据源：第一个一级标题之前的说明文字不进常用语'],
  // v26.10.17-v5：列表解析（用户反馈「无序/有序列表没解析出来」）。三条各钉一个独立事实：
  // 有序要带序号 / 无序要换成通用圆点且不留私有区字符 / 被普通段落隔开的列表要重新从 1 数。
  ['docPhrasesListOrderedOk', '腾讯文档数据源：有序列表解析成「1. 2.」序号'],
  ['docPhrasesListBulletOk', '腾讯文档数据源：无序列表换成「•」且不透传 Wingdings 私有区字符'],
  ['docPhrasesListRestartOk', '腾讯文档数据源：列表被普通段落隔开后序号重新从 1 开始'],
  ['primaryTokenBlue', '主色 token 为 antd 蓝 blue-6 #1677FF'],
  ['panelBtnsUniform', '入口按钮样式一致（无主色实心按钮；v26.10.12-v1 起 4 个）'],
  ['panelBtnsOneRow', '入口按钮排在同一行（v26.10.12-v1 起 4 个）'],
  ['panelIconsAreSvg', '面板图标是真实 SVG 且无补充平面 emoji（Win7 兼容）'],
  ['ballDragOk', '悬浮球可拖动移动（且拖完不误触展开）'],
  ['logListNotReversed', '日志列表仍是 column（非 column-reverse）'],
  ['logNewestOnBottom', '日志最新一条在最下方'],
  ['logAutoRefreshToggle', '日志弹窗有「自动刷新」开关且默认开启'],
  ['logAutoScrollBottom', '日志更新后自动滚到底部'],
  ['logDarkTerminalOk', '日志区为暗色终端风（底色/三栏/状态栏）'],
  ['overlayAbovePanel', 'antd 弹窗/侧边栏盖在面板之上（方案 B）'],
  ['overlayViewportSized', '浮层按视口定尺寸（不被宿主 body 的 transform 囚住）'],
  ['changelogPopup', '更新日志弹窗（最新 10 条）'],
  ['viewerZoomOk', '缩略图放大显示主图（antd 预览）'],
  ['copyOk', '图片复制只尝试写 PNG'],
  ['printBtnOk', '放大预览工具栏有「打印」按钮'],
  ['printIframeOk', '打印链路接通（react-to-print 建出打印 iframe）'],
  ['printA4Ok', '打印按 A4 自适应且无页眉页脚（@page margin:0 + 内容框留白 + object-fit）'],
  ['previewToolbarOk', '放大预览的工具栏未被图片盖住（宿主 body 带 transform 时也在视口内）'],
  ['previewIconCenteredOk', '预览工具栏图标与按钮同一水平线（不被宿主 CSS 顶出胶囊）'],
  ['previewSingleMaskOk', '预览背后只有一层遮罩（下层弹窗/抽屉遮罩全部压掉）'],
  ['modalTextAlignLeft', '弹窗内容左对齐（不被宿主 CSS 污染）'],
  ['timeInputsOk', '时间段为 4 个原生 time 输入（HH:mm，无 antd TimePicker）'],
  ['iconVerticallyCentered', '图标与控件同一水平线（清空×/关闭图标）'],
  ['sniffEntryOk', '主面板有「图片嗅探」入口且能打开嗅探弹窗'],
  ['sniffScanOk', '嗅探覆盖 DOM 与 CSS 背景来源并量出大小（HEAD 与 Range 两条阶梯；SVG 已按后缀排除）'],
  ['sniffUnknownKeptOk', '大小未知的图片不丢弃（折叠保留）'],
  ['sniffPerfFirstOk', '尺寸读取 perf 优先（v26.10.14-v2）：同源真加载的图走资源表读数，零 HEAD/Range 请求'],
  ['sniffPreMeasureOk', '嗅探后台预测量（v26.10.14-v4）：打开窗口前就已量好，开窗后缓存命中不再重发请求'],
  ['sniffSelectScopeOk', '全选/批量下载只覆盖未被阈值过滤的图（小于阈值的不计数、不可选）'],
  ['sniffExcludeOk', '按文件名排除（znhd-sniff / user-woman / user-man）—— 被排除的名字不出现在卡片上（计数走 data-sniff-excluded 钩子）'],
  ['sniffNoNameTextOk', '嗅探卡片不再显示文件名（v26.10.16-v1）：文件名只走 <img alt>，面板可见文本里没有'],
  ['sniffSvgExcludedOk', '按后缀排除 SVG（.svg 与内联 SVG 都不进面板）'],
  // v26.10.13-v8：按会话（纳税人）分组 —— 归属、当前会话置顶、切会话后靠持久层仍归组
  ['sniffGroupOk', '图片嗅探按会话分组：当前会话置顶、会话名与张数正确、未归属单独成组'],
  ['sniffConvAliasOk', '会话归属双路径合并（v26.10.14-v5）：同窗口带/不带 conversationID 的图并成一组，无同名两组'],
  ['sniffConvTimeOrderOk', '组内按消息时间从新到旧（v26.10.16-v2）：最新的图排在组内最前'],
  ['sniffConvNoTimeFallbackOk', '取不到消息时间的图（未归属组）退回「体积倒序」——普通网页观感与旧版一致'],
  ['sniffNoTimeRingOk', '没有消息时间的卡片四周加红圈（v26.10.16-v3）：未归属组都红、有时间的组都不红'],
  ['sniffGroupPersistOk', '切走会话后重扫，图片仍归回原会话（会话归属的持久层生效）'],
  ['sniffImgActionsOk', '图片嗅探卡片：下载/打印是右下角的图标按钮（未 hover 隐藏，hover 出现）'],
  // v26.10.10-v8：面板被宿主页重绘删除后必须自愈（watchPanelHost 的回归断言）
  ['selfHeal', '面板被宿主页删除后自动挂回（且不重复挂载）'],
  // v26.10.10-v17：常用语数据源迁到 cnb.cool，且存量存储里的**旧默认值**要被自动迁移
  // （夹具在脚本加载前预置了旧默认地址，故这里必须看到 cnb.cool，否则就是迁移没生效）
  ['phrasesSourceOk', '常用语数据源用 cnb.cool 新默认（存量存储里的旧默认地址已自动迁移，v26.10.10-v17）'],
];

/**
 * 已知无害的页面错误白名单（用 allowlist，而不是无视所有报错）。
 *
 * `Cannot read properties of null (reading 'append')` 来自脚本猫 UI 库的 createPopup：
 * 它向「脚本管理器提供的挂载点」追加弹层，在普通网页里该挂载点为 null。
 * 已用同一 harness 跑迁移前原版（scripts/baseline/znhd.user.js.orig）复现出完全相同的报错，
 * 确认与本次工程化改造无关，且面板/抽屉均正常渲染。
 */
const KNOWN_BENIGN = [/Cannot read properties of null \(reading 'append'\)/];
const isBenign = (msg) => KNOWN_BENIGN.some((re) => re.test(msg));

async function main() {
  if (!fs.existsSync(BUNDLE)) {
    console.error('❌ 找不到构建产物 dist/znhd.user.js —— 请先执行 `npm run build`');
    process.exit(1);
  }

  // ===== 产物新鲜度门禁（v26.10.08-v9 加）=====
  // 为什么需要它：**webpack 构建失败时不会更新 dist，旧的产物还在**，于是 `npm run verify`
  // 会静默地拿**旧 bundle** 跑测试。v26.10.08-v8 就踩过：tsc 报错（uiReset 模板串被反引号截断）
  // 导致构建失败，紧接着的 verify 却对着旧产物报红，一度被误读成「修复没生效」。
  // CI 里 build 是 verify 的前置步骤、失败即停，所以这道门禁主要拦「本地手动串跑」。
  // ⚠️ 判据是**内容哈希**（dist/.build-stamp，由 npm run build 写入）而不是 mtime ——
  //    webpack 的 compareBeforeEmit 在输出没变时不重写文件，用 mtime 会产生假阳性。
  //    详见 scripts/smoke/build-stamp.js 头部注释。
  if (hashInputs() !== readStamp()) {
    console.error(
      '❌ dist/znhd.user.js 与当前源码不一致 —— 说明上次 `npm run build` 没成功（或没跑）。\n' +
        '   ⚠️ 构建失败时旧产物仍在，直接跑 verify 会**静默地测试旧 bundle**，很容易误判改动是否生效。\n' +
        '   请先执行 `npm run build` 并确认它输出 `compiled successfully` 再重试。'
    );
    process.exit(1);
  }

  const server = await startServer();
  const url = `http://127.0.0.1:${server.address().port}/smoke.html`;
  let browser = null;

  // ===== 产物头部结构门禁（v26.10.13-v2 加）=====
  // 两件事必须在产物里成立：
  //   ① `// ==UserScript==` 是**文件第一行** —— 脚本管理器的元数据块要从文件开头就能解析；
  //   ② 元数据块之后带 `// @ts-nocheck` —— 让编辑器的 TS 服务跳过这个 3.7MB 单文件产物，
  //      否则 VS Code 会对它跑 JS 诊断并误报 TS2451「无法重新声明块范围变量 Link」
  //      （产物里只有一处真实声明 antd Typography.Link，另两处报错点落在 JSDoc 注释里的
  //      单词 Link 上）。注入点在 config/webpack.config.base.js 的 getBanner。
  const bundleText = fs.readFileSync(BUNDLE, 'utf8');
  const metaEnd = bundleText.indexOf('// ==/UserScript==');
  const headerOk = bundleText.startsWith('// ==UserScript==');
  const tsNoCheckOk = metaEnd >= 0 && bundleText.slice(metaEnd, metaEnd + 4096).includes('// @ts-nocheck');
  if (!headerOk || !tsNoCheckOk) {
    console.error(
      '❌ dist/znhd.user.js 头部结构不对 —— ' +
        (headerOk ? '' : '第一行不是 `// ==UserScript==`（脚本管理器解析不了元数据块）；') +
        (tsNoCheckOk ? '' : '元数据块后缺 `// @ts-nocheck`（编辑器会对产物误报 TS2451，见 getBanner 注释）；') +
        '\n   请检查 config/webpack.config.base.js 的 getBanner 并重新 `npm run build`。'
    );
    process.exit(1);
  }

  // 从构建产物的 ==UserScript== 头读真实 @version，注入页面作 GM_info.script.version。
  // 这样「面板渲染的版本号」是对产物的真实校验，而不是 harness 里的死值。
  const scriptVersion = (bundleText.match(/@version\s+(\S+)/) || [])[1] || '';

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();

    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

    await page.evaluateOnNewDocument((v) => {
      window.__scriptVersion = v;
    }, scriptVersion);
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => document.title.indexOf('znhd-smoke:') === 0, { timeout: 60000 });

    const { report, title } = await page.evaluate(() => ({
      report: JSON.parse(document.getElementById('smoke-result').textContent),
      title: document.title,
    }));

    // —— 表情面板自动收起（v26.10.13-v7，用户要求）：**真实鼠标**复验 ——
    // 页面内那条断言走合成事件（覆盖的是我们自己的 document mousedown 判定 + React onClick）；
    // 这里按用户真实路径用真实鼠标再跑一遍：① 点一张表情应立即收起；② 点面板之外应立即收起。
    // 结论并入 report.emojiAutoCloseOk（页面内 && 真实鼠标），避免「合成事件绿、真机红」。
    // ⚠️ 必须排在下面的悬浮球拖拽用例之前：那段会把所有 `.ant-modal-close` 点掉。
    report.emojiRealMouse = await (async () => {
      const panelVisible = () =>
        page.evaluate(() => {
          const panel = document.querySelector('.znhd-emoji-panel');
          if (!panel) return false; // 面板不在 DOM 里 ⇒ 已收起
          const pop = panel.closest('.ant-popover');
          if (pop) {
            const cls = pop.className || '';
            if (cls.indexOf('ant-popover-hidden') >= 0) return false;
            // 退场动画期间仍是 display:block，也要算「已收起」（同 smoke 页 emojiPanelVisible 的判据）
            if (cls.indexOf('-leave') >= 0) return false;
            const cs = getComputedStyle(pop);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
          }
          return panel.getBoundingClientRect().width > 0;
        });
      /** 触发按钮的视口坐标（要求可见且可点；拿不到返回 null） */
      const triggerPoint = () =>
        page.evaluate(() => {
          const m = document.querySelector('.ant-modal.znhd-transfer-modal');
          const btn = m ? m.querySelector('.znhd-chat-composer button[aria-label="表情"]') : null;
          if (!btn || btn.disabled) return null;
          btn.scrollIntoView({ block: 'center', inline: 'nearest' });
          const r = btn.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) return null;
          const x = Math.round(r.x + r.width / 2);
          const y = Math.round(r.y + r.height / 2);
          const hit = document.elementFromPoint(x, y);
          if (!hit || !btn.contains(hit)) return null; // 被别的浮层盖住就别点（宁可红，不要假绿）
          return { x, y };
        });
      // 确保传输助手窗口在，且停在设备会话（第一栏「对话」）——表情按钮只在那条通道可用
      await page.evaluate(() => {
        const m = document.querySelector('.ant-modal.znhd-transfer-modal');
        if (!m) {
          const host = document.getElementById('__znhd_panel_host__');
          const btn = host
            ? Array.from(host.querySelectorAll('button')).find(
                (b) => (b.textContent || '').indexOf('传输助手') >= 0
              )
            : null;
          if (btn) btn.click();
        }
      });
      await sleep(700);
      // ⚠️ 先清出干净的上层再点（v26.10.13-v9 实测踩到）：
      // 跑到这里时本页同时开着 5 个 antd Modal，它们的 z-index 全是 zIndexPopupBase=1000000、
      // **DOM 在后的那个压在上面**；运行日志弹窗恰好盖住表情按钮的位置，于是 `elementFromPoint`
      // 取到底下的日志文本 `SPAN.znhd-log-msg`、`triggerPoint()` 按设计返回 null（宁红不假绿），
      // 整条断言恒红。⚠️ 这不是本仓库某次改动引入的：在 v26.10.13-v8（HEAD）上按同一段夹具复现，
      // `hit` 完全一致 —— 属夹具没清场的历史问题。做法同下面 `ballDragOk` 的既有套路。
      await page.evaluate(() => {
        document.querySelectorAll('.ant-modal-wrap').forEach((w) => {
          if (w.querySelector('.znhd-transfer-modal')) return; // 被测窗口留着
          const close = w.querySelector('.ant-modal-close');
          if (close) close.click();
        });
        document.querySelectorAll('.ant-drawer-close').forEach((b) => b.click());
      });
      await sleep(600);
      await page.evaluate(() => {
        const m = document.querySelector('.ant-modal.znhd-transfer-modal');
        const nav = m
          ? Array.from(m.querySelectorAll('button')).find((b) => (b.getAttribute('aria-label') || '') === '对话')
          : null;
        if (nav) nav.click();
      });
      await sleep(600);
      let trigger = await triggerPoint();
      if (!trigger) {
        // 会话没选中（或无在线设备 ⇒ 表情按钮灰态）：点第一条会话再看一眼
        await page.evaluate(() => {
          const m = document.querySelector('.ant-modal.znhd-transfer-modal');
          const it = m ? m.querySelector('.znhd-transfer-session-item') : null;
          if (it) it.click();
        });
        await sleep(600);
        trigger = await triggerPoint();
      }
      if (!trigger) return { ok: false, reason: 'no enabled emoji trigger' };

      // ① 真实鼠标点触发按钮 → 面板应打开
      await page.mouse.click(trigger.x, trigger.y);
      await sleep(600);
      const opened = await panelVisible();
      // ② 真实鼠标点第一张表情 → 应立即收起
      const item = await page.evaluate(() => {
        const it = document.querySelector('.znhd-emoji-item');
        if (!it) return null;
        const r = it.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
      if (!item) return { ok: false, reason: 'no emoji item rendered', opened };
      await page.mouse.click(item.x, item.y);
      await sleep(600);
      const afterPick = await panelVisible();
      // ③ 再打开 → 真实鼠标点「面板之外」（输入框：面板在触发按钮上方，盖不到它）
      await page.mouse.click(trigger.x, trigger.y);
      await sleep(600);
      const reopened = await panelVisible();
      const outside = await page.evaluate(() => {
        const m = document.querySelector('.ant-modal.znhd-transfer-modal');
        const ta = m ? m.querySelector('.znhd-chat-composer textarea') : null;
        if (!ta) return null;
        const r = ta.getBoundingClientRect();
        const x = Math.round(r.x + r.width / 2);
        const y = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(x, y);
        if (!hit || !ta.contains(hit)) return null; // 落点没打在输入框上 ⇒ 换不了「外部点击」
        return { x, y };
      });
      if (!outside) return { ok: false, reason: 'outside point blocked', opened, afterPick, reopened };
      await page.mouse.click(outside.x, outside.y);
      await sleep(400);
      const afterOutside = await panelVisible();
      return {
        ok: !!opened && afterPick === false && !!reopened && afterOutside === false,
        opened,
        afterPick,
        reopened,
        afterOutside,
      };
    })();
    console.log('  表情面板真实鼠标：' + JSON.stringify(report.emojiRealMouse));
    report.emojiAutoCloseOk = !!report.emojiAutoCloseOk && !!report.emojiRealMouse.ok;

    // 常用语数据源（v26.10.10-v17）：夹具预置了**旧默认**地址，故实际请求必须落在 cnb.cool 新默认上。
    // 只认「迁移后的默认值」——若哪天有人把 DEFAULTS 改回旧地址、或迁移被删掉，这条会变红。
    report.phrasesSourceOk = /cnb\.cool\/[^ ]*commonPhrases\.yaml/.test(report.phrasesSourceUrl || '');

    // —— 悬浮球拖拽（v26.10.07-v3）——
    // 拖拽必须由**真实指针事件**驱动（合成 PointerEvent 会让 setPointerCapture 抛 NotFoundError），
    // 只能在 puppeteer 侧做，故放在页面报告生成之后单独跑，结果并入 report。
    // 断言两件事：① 宿主 left/top 真的被拖动了；② 拖完**没有**被顺带展开成面板。
    report.ballDragOk = await (async () => {
      await page.evaluate(() => {
        document.querySelectorAll('.ant-image-preview-root, .ant-image-preview-wrap').forEach((e) => e.remove());
        document.querySelectorAll('.ant-modal-close, .ant-drawer-close').forEach((b) => b.click());
      });
      await sleep(600);

      const collapsedOk = await page.evaluate(() => {
        const host = document.getElementById('__znhd_panel_host__');
        if (!host) return false;
        const btn = Array.from(host.querySelectorAll('button')).find(
          (b) => (b.getAttribute('title') || '').indexOf('收起') >= 0
        );
        if (!btn) return false;
        btn.click();
        return true;
      });
      if (!collapsedOk) return false;
      await sleep(600);

      const start = await page.evaluate(() => {
        const host = document.getElementById('__znhd_panel_host__');
        if (!host || host.querySelector('.ant-card')) return null; // 必须已经变成悬浮球
        const ball = host.querySelector('button');
        if (!ball) return null;
        const r = ball.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        // 落点必须是悬浮球本身：若被残留浮层盖住，拖拽会打到别人身上（宁可红，不要假绿）
        if (!ball.contains(document.elementFromPoint(cx, cy))) return null;
        return { x: cx, y: cy, left: parseFloat(host.style.left) || 0, top: parseFloat(host.style.top) || 0 };
      });
      if (!start) return false;

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x - 90, start.y + 70, { steps: 10 });
      await page.mouse.up();
      await sleep(500);

      return await page.evaluate((s) => {
        const host = document.getElementById('__znhd_panel_host__');
        const left = parseFloat(host.style.left) || 0;
        const top = parseFloat(host.style.top) || 0;
        const moved = Math.abs(left - s.left) > 10 || Math.abs(top - s.top) > 10;
        const stillCollapsed = !host.querySelector('.ant-card');
        return moved && stillCollapsed;
      }, start);
    })();

    // ——— 面板自愈（v26.10.10-v8）：模拟宿主页重绘把面板容器连同 React 树一起删掉 ———
    // 放在**报告采集之后**：删掉宿主会重建 React 子树（面板内存态重置），
    // 若排在前面会污染后面所有依赖面板状态/弹窗的用例，所以只在最后做一次破坏性实验。
    // ⚠️ 判据是「旧宿主被删 → 仍然只有一个宿主、它在文档里、且有尺寸」：
    //    没有 watchdog 的旧实现会永久缺失宿主，因此同一断言在改动前后是可区分的。
    const selfHeal = await (async () => {
      const before = await page.evaluate(
        () => !!document.getElementById('__znhd_panel_host__')?.isConnected
      );
      if (!before) return { before, ok: false };
      await page.evaluate(() => {
        const host = document.getElementById('__znhd_panel_host__');
        if (host) host.remove();
      });
      await page
        .waitForFunction(
          () => {
            const h = document.getElementById('__znhd_panel_host__');
            return !!h && h.isConnected && h.offsetWidth > 0;
          },
          { timeout: 5000 }
        )
        .catch(() => {});
      // 再多等约 1.2s（≈10 个宏任务）：自愈若写成回环，这里会长出第 3 个宿主
      await sleep(1200);
      return await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('#__znhd_panel_host__'));
        const h = els[0];
        return {
          before: true,
          count: els.length,
          connected: !!(h && h.isConnected),
          sized: !!(h && h.offsetWidth > 0 && h.offsetHeight > 0),
          ok: els.length === 1 && !!h && h.isConnected && h.offsetWidth > 0,
        };
      });
    })();
    console.log('  面板自愈用例：' + JSON.stringify(selfHeal));
    report.selfHeal = selfHeal;

    // version 检查改为「渲染值 === 产物 @version」的精确比对
    const checkPass = (key) => (key === 'version' ? report.version === 'v' + scriptVersion : !!report[key]);

    console.log('冒烟测试报告：');
    for (const [key, label] of CHECKS) {
      const value = checkPass(key);
      console.log(
        `  ${value ? '✅' : '❌'} ${label}${key === 'version' ? '（' + report.version + ' ← 产物 ' + scriptVersion + '）' : ''}`
      );
    }
    // 嗅探三条断言失败时把快照原样打出来：卡片数/来源/尺寸阶梯/分组计数都在里面，
    // 否则只能看到「❌」，还得改代码才知道是没扫到、没量到还是分组没渲染（v26.10.10-v4 调试用）。
    if (
      !checkPass('sniffEntryOk') ||
      !checkPass('sniffScanOk') ||
      !checkPass('sniffUnknownKeptOk') ||
      !checkPass('sniffPerfFirstOk') ||
      !checkPass('sniffPreMeasureOk') ||
      !checkPass('sniffExcludeOk') ||
      !checkPass('sniffNoNameTextOk') ||
            !checkPass('sniffSvgExcludedOk') ||
            !checkPass('sniffSelectScopeOk') ||
            !checkPass('sniffGroupOk') ||
            !checkPass('sniffConvAliasOk') ||
            !checkPass('sniffConvTimeOrderOk') ||
            !checkPass('sniffConvNoTimeFallbackOk') ||
            !checkPass('sniffNoTimeRingOk') ||
            !checkPass('sniffGroupPersistOk') ||
            !checkPass('sniffImgActionsOk')
    ) {
      console.log('      嗅探快照：' + JSON.stringify(report.sniffSnap));
    }
    // v26.10.12-v1：传输助手断言失败时把两个快照原样打出来 ——
    //   transferSnap：自动弹窗/三栏/文件视图/会话/清空/主题 各阶段的事实；
    //   pairSnap：配对窗口的二维码/链接/手机列表/设备色/测试图片。
    // 否则只能看到「❌」，还得改代码才知道是窗口没开、视图没切还是消息没落会话（重构后结构全变了，必须能一眼定位）。
    // v26.10.13-v10：层级/圆角事实（layered）随 transferSnap 一起打（窗口圆角、卡片内缩量等）。
    if (
      !checkPass('transferAutoOpenOk') ||
      !checkPass('transferWindowOk') ||
      !checkPass('transferNoTitleOk') ||
      !checkPass('filesViewOk') ||
      !checkPass('fileChannelOk') ||
      !checkPass('filesNoJumpOk') ||
      !checkPass('filesFilterOk') ||
      !checkPass('sessionChatOk') ||
      !checkPass('sessionRouteBySenderOk') ||
      !checkPass('textSentOk') ||
      !checkPass('sessionClearOk') ||
      !checkPass('transferThemeOk') ||
      !checkPass('transferLayeredOk') ||
      !checkPass('transferSettingsIsolatedOk') ||
      !checkPass('chatBubbleOk') ||
      !checkPass('chatComposerOk') ||
      !checkPass('emojiPackOk') ||
      !checkPass('emojiRelayFirstOk') ||
      !checkPass('emojiNotInFilesOk') ||
      !checkPass('emojiHoverOk') ||
      !checkPass('emojiAutoCloseOk')
    ) {
      console.log('      传输助手快照：' + JSON.stringify(report.transferSnap));
    }
    if (
      !checkPass('pairModalOk') ||
      !checkPass('qrNoRadius') ||
      !checkPass('phoneIdColorOk') ||
      !checkPass('pairTestImageBtnOk') ||
      !checkPass('testImageSentOk')
    ) {
      console.log('      配对窗口快照：' + JSON.stringify(report.pairSnap));
    }
    // v26.10.10-v16：图片格子悬浮按钮的几何/可见性事实（只在失败时打）
    if (!checkPass('filesImgActionsOk')) {
      console.log('      文件视图悬浮按钮快照：' + JSON.stringify(report.filesImgActions));
    }
    // 发送压缩失败时把实际 POST 的载荷事实打出来（区分「没发出去」「没压缩」「解码失败」）
    if (!checkPass('phoneSendCompressedOk')) {
      console.log('      发送载荷快照：' + JSON.stringify(report.phoneSendCheck));
    }
    // v26.10.10-v17：常用语数据源迁移失败时把实际请求地址打出来（区分「没请求」与「请求了旧地址」）
    if (!checkPass('phrasesSourceOk')) {
      console.log('      常用语数据源快照：' + JSON.stringify(report.phrasesSourceUrl));
    }
    // v26.10.17-v3：腾讯文档数据源九条断言里**任意一条**失败，就把定位过程 + 抽屉实况全打出来。
    // 这条链路的失败面很宽（输入框没定位到 / 请求没走 dop-api / 漏带 Referer / 解析没出标题 /
    // 正文没合并 / 列表没带序号），不打这些事实就只能靠改代码猜，故保留。
    const docKeys = [
      'docPhrasesSwitchOk', 'docPhrasesHitOk', 'docPhrasesRefererOk', 'docPhrasesTitlesOk',
      'docPhrasesBodyOk', 'docPhrasesNoPreamble', 'docPhrasesListOrderedOk', 'docPhrasesListBulletOk',
      'docPhrasesListRestartOk',
    ];
    if (docKeys.some((k) => !checkPass(k))) {
      console.log('      腾讯文档快照：' + JSON.stringify(report.docPhrasesDbg));
      console.log('      腾讯文档命中数：' + report.docPhrasesHit + ' Referer=' + JSON.stringify(report.docPhrasesReferer));
      console.log('      腾讯文档抽屉按钮：' + JSON.stringify(report.docPhrasesBtnTitles));
      console.log('      点击命中=' + report.docPhrasesClickedItem + ' 剪贴板正文=' + JSON.stringify(report.docPhrasesClip));
    }

    const allErrors = (report.relevantErrors || []).concat(pageErrors);
    const benign = allErrors.filter(isBenign);
    const scriptErrors = allErrors.filter((e) => !isBenign(e));
    console.log(`  ${scriptErrors.length ? '❌' : '✅'} 页面无脚本自身报错`);
    scriptErrors.forEach((e) => console.log('      · ' + e));
    benign.forEach((e) => console.log('      （已知无害，见 run.js 白名单说明）· ' + e));

    const failed = CHECKS.filter(([key]) => !checkPass(key));
    if (failed.length || scriptErrors.length) {
      console.error(`\n❌ 冒烟测试未通过（${title}）：${failed.map(([, l]) => l).join('、') || ''}`);
      process.exitCode = 1;
    } else {
      console.log('\n✅ 冒烟测试通过（znhd-smoke:ALL-OK）');
    }
  } catch (err) {
    console.error('❌ 冒烟测试执行失败：' + (err && err.message ? err.message : err));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main();
