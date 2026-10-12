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
 *   Agent 对话（第一栏 Agents 入口） / 图片嗅探 / 页面无脚本自身报错
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
  ['filesViewOk', '「文件」视图：图片九宫格 + 文本分区 + 计数（原历史记录弹窗搬迁）'],
  ['filesNoJumpOk', '文件分组下点击第二栏设备条目不跳转会话窗口（条目只作展示）'],
  ['navStatesOk', '第一栏图标三态：选中=绿色填充无底板、未选中 hover=深色圆角底板（选中优先）'],
  ['sessionChatOk', '设备会话聊天区：收到的文本与图片渲染为聊天气泡'],
  ['textSentOk', '会话内发送文本：本机气泡 + POST /phone/send'],
  ['phoneSendCompressedOk', '发送图片前压缩（JPEG、最长边≤1600、小于原图）'],
  ['sessionClearOk', '「清空消息」后会话回到空状态'],
  ['pairModalOk', '「+」配对窗口：二维码/链接/在线状态/手机列表'],
  ['qrNoRadius', '二维码无圆角（定位角标不被裁切）'],
  ['phoneIdColorOk', '设备 ID 有边框+彩色底，且不同设备底色不同'],
  ['pairTestImageBtnOk', '配对窗口有「发送测试图片」按钮'],
  ['testImageSentOk', '「发送测试图片」把图片投递到 /u/<deviceId>（手机上传同路径）'],
  ['transferThemeOk', '窗口固定微信暗色：标题条与第一栏同色 #2E2E2E、三栏深浅分层（聊天区最深）'],
  ['transferSettingsIsolatedOk', '传输助手设置独立存储 scriptCat_TransferSettings（不污染主设置）'],
  ['filesImgActionsOk', '「文件」视图图片格子：复制/下载/删除是右下角图标按钮（未 hover 隐藏，hover 出现）'],
  // v26.10.12-v3：用户要求「设备菜单和 agent 菜单下的对话主区域使用相同的样式」，
  // 于是气泡、滚动区、底部输入框都抽成了共用件 —— 这三条守的就是「共用件真的长出来了」
  ['chatBubbleOk', '聊天气泡左右分栏（他人靠左微信灰 / 我的靠右微信绿）+ 头像在气泡外侧 + 时间分隔条'],
  ['chatComposerOk', '输入区（微信式）：工具栏表情/图片上传/附件 + 多行自增高（超上限后框内滚动）+ 右下角发送按钮 + 实心底面板'],
  ['emojiPackOk', '在线表情包：面板加载合集与图片，点一张进「待发图片」（与图片上传同一条发送链路）'],
  ['chatPanelSharedOk', 'Agent 对话与设备会话共用同一套聊天面板（同一个输入框外壳 + 带 data-side 的气泡 + 头像）'],
  // ===== 主面板既有断言 =====
  ['phrasesLoaded', '常用语 YAML 解析'],
  ['phrasesClicked', '常用语侧边栏可打开'],
  ['phrasesIsDrawer', '常用语是 antd Drawer 侧边栏（非 Modal）'],
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
  ['sniffSelectScopeOk', '全选/批量下载只覆盖未被阈值过滤的图（小于阈值的不计数、不可选）'],
  ['sniffExcludeOk', '按文件名排除（znhd-sniff / user-woman / user-man）且面板给出排除计数'],
  ['sniffSvgExcludedOk', '按后缀排除 SVG（.svg 与内联 SVG 都不进面板）'],
  ['sniffImgActionsOk', '图片嗅探卡片：下载/打印是右下角的图标按钮（未 hover 隐藏，hover 出现）'],
  // v26.10.10-v8：面板被宿主页重绘删除后必须自愈（watchPanelHost 的回归断言）
  ['selfHeal', '面板被宿主页删除后自动挂回（且不重复挂载）'],
  // v26.10.12-v1：Agent 助手不再是独立弹窗，改为传输助手第一栏 Agents → 右侧聊天区
  ['agentEntryOk', '第一栏 Agents 入口打开右侧聊天区（可用态）'],
  ['agentPanesOk', '第二栏「技能 / 定时任务」控件切换第三栏内容，两个面板都渲染（桩数据）'],
  ['agentChatOk', 'Agent 对话能发出并落地流式回答（桩分片）'],
  // v26.10.10-v11：历史消息的 thinking 是对象，渲染不当会让整棵面板树被卸载
  ['agentReopenOk', '对话后关窗再打开：历史思考正常渲染且主面板仍在（v26.10.10-v11）'],
  // v26.10.10-v12：官方 conversation API 只有 create/get，会话列表是脚本自记的本地索引
  // v26.10.10-v13：会话搬进第二栏（消息级断言必须只看 .znhd-agent-messages，否则侧栏的会话标题会假阳性）
  ['agentChatsOk', '多会话：会话在第二栏列出、索引落盘、新建后点侧栏切回上一个对话仍看到自己的历史'],
  // v26.10.10-v13：borderless 输入框聚焦时 antd 会自己在文本域上画 outline 聚焦框（= 看起来像蓝框）
  ['agentInputNoRingOk', '输入框聚焦时没有 antd borderless 变体自带的 outline 蓝框（v26.10.10-v13）'],
  // v26.10.10-v14：回答里的 Markdown 渲染成 DOM（`**加粗**`→<strong>、列表→<li>、行内代码→<code>）
  ['agentMarkdownOk', 'Agent 消息按 Markdown 渲染：加粗/列表/行内代码出成 DOM 且文本里不再有字面量 **（v26.10.10-v14）'],
  // v26.10.10-v15：输入框高度不能「打一个字再删掉就变高」（重开弹窗后的初始高度 = 删空后的高度）
  ['agentInputHeightOk', 'Agent 输入框高度稳定：空着/打过字/删空之后一样高（v26.10.10-v15）'],
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

    // —— 输入框聚焦蓝框（v26.10.10-v13）——
    // 为什么不在页面内用 JS `ta.focus()` 后读计算样式：这条路**注定假绿**。踩过的坑：
    //   ① 夹具会把「运行日志」弹窗一直开着盖住 Agent 视图，antd 的焦点陷阱随即把我们
    //      对 Agent 输入框的 focus() 抢回去（连关闭按钮都 focus 不上），
    //      于是 `document.activeElement !== ta`、`ta.matches(':focus-visible')` 恒为 false，
    //      「没聚焦」被读成「没有 outline」；
    //   ② 冒烟视口是 800x600，而传输助手窗口比视口高，输入框通常落在折线以下，
    //      `elementFromPoint` 返回 null、合成点击也打不到它。
    // 所以这里按用户真实路径做：关掉压在上面的弹窗 → 把输入框滚进视口 → **真实鼠标点击**它
    // → 读 `:focus-visible` 生效后的计算样式。断言里同时要求 focused && focusVisible，
    // 任何一个没成立都判红，避免再次出现「什么都没验证到却通过」。
    // ⚠️ 必须排在下面的拖拽用例之前：那段会点掉所有 `.ant-modal-close`。
    // v26.10.12-v1：Agent 对话搬进传输助手窗口（第一栏 Agents → 右侧聊天区），
    // 输入框定位从「标题含 Agent 助手的独立弹窗」改为「传输助手窗口且正停在 Agents 视图」。
    // v26.10.12-v2：主窗口去掉了标题栏（与第一栏顶部图标 + 名称重复），改用 Modal 的
    // className 钩子定位 —— 不再需要「标题精确相等」那套绕法。
    await page.evaluate(() => {
      window.__findTransferModal = () => document.querySelector('.ant-modal.znhd-transfer-modal');
      window.__findAgentTextarea = () => {
        const modal = window.__findTransferModal();
        // 必须正停在 Agents 视图（有 .znhd-agent-messages），否则可能拿到别处的输入框
        if (!modal || !modal.querySelector('.znhd-agent-messages')) return null;
        return modal.querySelector('textarea');
      };
      // 重开窗口后 nav 会被 effect 复位到「设备」，用这个 helper 点第一栏 Agents 回到对话视图
      window.__clickAgentsNav = () => {
        const modal = window.__findTransferModal();
        if (!modal) return false;
        const btn = Array.from(modal.querySelectorAll('button')).find(
          (b) => (b.getAttribute('aria-label') || '') === 'Agents'
        );
        if (btn) btn.click();
        return !!btn;
      };
    });
    report.agentInputRing = await (async () => {
      // 清掉可能残留的全屏预览浮层（拖拽用例里也做了同样的事）：它盖在弹窗上方会吞掉点击
      await page.evaluate(() => {
        document
          .querySelectorAll('.ant-image-preview-root, .ant-image-preview-wrap')
          .forEach((e) => e.remove());
        const transfer = window.__findTransferModal();
        document.querySelectorAll('.ant-modal-close').forEach((btn) => {
          if (!transfer || !transfer.contains(btn)) btn.click();
        });
      });
      await sleep(400);
      // —— 关掉传输助手窗口再重新点开（v26.10.10-v15）——
      // 复现用户报告的路径：「第一次打开 Agent 窗口」时输入框是矮的，打过字再删掉就变高了。
      // 只有**重新挂载**过的窗口才是真正的初始态（destroyOnHidden），所以在测高度之前先重开一次。
      await page.evaluate(() => {
        const transfer = window.__findTransferModal();
        const close = transfer ? transfer.querySelector('.ant-modal-close') : null;
        if (close) close.click();
      });
      await sleep(500);
      await page.evaluate(() => {
        const host = document.getElementById('__znhd_panel_host__');
        if (!host) return;
        const btn = Array.from(host.querySelectorAll('button')).find(
          (b) => (b.textContent || '').indexOf('传输助手') >= 0
        );
        if (btn) btn.click();
      });
      await sleep(700);
      // 重开后 nav 被 effect 复位到「设备」：再点第一栏 Agents 才回得到对话视图
      await page.evaluate(() => {
        window.__clickAgentsNav();
      });
      await sleep(600);
      const box = await page.evaluate(() => {
        const ta = window.__findAgentTextarea();
        if (!ta) return null;
        ta.scrollIntoView({ block: 'center', inline: 'nearest' });
        const r = ta.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return null;
        const x = Math.round(r.x + r.width / 2);
        const y = Math.round(r.y + r.height / 2);
        const hit = document.elementFromPoint(x, y);
        return {
          x,
          y,
          // 万一将来又被谁盖住，快照里能直接看出点击打在哪个元素上
          hit: hit ? String(hit.className || hit.tagName).slice(0, 60) : 'none',
        };
      });
      if (!box) return { found: false };
      await page.mouse.click(box.x, box.y);
      await sleep(120);
      const ring = await page.evaluate(() => {
        const ta = window.__findAgentTextarea();
        if (!ta) return { found: false };
        const cs = window.getComputedStyle(ta);
        const r = ta.getBoundingClientRect();
        return {
          found: true,
          focused: document.activeElement === ta,
          focusVisible: ta.matches(':focus-visible'),
          outlineStyle: cs.outlineStyle,
          outlineWidth: cs.outlineWidth,
          boxShadow: cs.boxShadow,
          rect: Math.round(r.width) + 'x' + Math.round(r.height),
          valueEmpty: ta.value === '',
          heightEmpty: Math.round(r.height),
        };
      });
      if (!ring.found) return { ...ring, hit: box.hit };
      // —— 输入框高度稳定性（v26.10.10-v15）——
      // 用户路径：空着（初始高度）→ 打一个字符 → 全删掉。三次高度必须一致，
      // 否则就是「打一个字再删掉，输入框莫名变高」。真实键盘事件（page.keyboard）而不是
      // 直接改 value，才能触发 React 的受控更新与 rc-textarea 的 autoSize 重算。
      if (!ring.valueEmpty) return { ...ring, hit: box.hit, heightStable: false, heightNote: '重开后输入框不是空的' };
      await page.keyboard.type('a');
      await sleep(150);
      const heightTyped = await page.evaluate(() => {
        const ta = window.__findAgentTextarea();
        return ta ? Math.round(ta.getBoundingClientRect().height) : -1;
      });
      await page.keyboard.press('Backspace');
      await sleep(150);
      const after = await page.evaluate(() => {
        const ta = window.__findAgentTextarea();
        return ta
          ? { heightCleared: Math.round(ta.getBoundingClientRect().height), valueEmpty: ta.value === '' }
          : { heightCleared: -1, valueEmpty: false };
      });
      return {
        ...ring,
        hit: box.hit,
        heightTyped,
        heightCleared: after.heightCleared,
        clearedEmpty: after.valueEmpty,
        heightStable: ring.heightEmpty === after.heightCleared && after.heightCleared > 0,
      };
    })();
    // 四条一起判：没聚焦 / 没命中 :focus-visible 都算红 —— 否则这条断言可能什么都没验证到
    report.agentInputNoRingOk = !!(
      report.agentInputRing.found &&
      report.agentInputRing.focused &&
      report.agentInputRing.focusVisible &&
      report.agentInputRing.outlineStyle === 'none' &&
      (report.agentInputRing.boxShadow === 'none' || report.agentInputRing.boxShadow === '')
    );
    // 输入框高度：空着 / 打过字 / 删空之后必须一样高（用户报告过「打一个字再删掉就变高」）
    report.agentInputHeightOk = !!(report.agentInputRing.found && report.agentInputRing.heightStable);

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
      !checkPass('sniffExcludeOk') ||
      !checkPass('sniffSvgExcludedOk') ||
      !checkPass('sniffSelectScopeOk') ||
      !checkPass('sniffImgActionsOk')
    ) {
      console.log('      嗅探快照：' + JSON.stringify(report.sniffSnap));
    }
    // v26.10.12-v1：传输助手断言失败时把两个快照原样打出来 ——
    //   transferSnap：自动弹窗/三栏/文件视图/会话/清空/主题 各阶段的事实；
    //   pairSnap：配对窗口的二维码/链接/手机列表/设备色/测试图片。
    // 否则只能看到「❌」，还得改代码才知道是窗口没开、视图没切还是消息没落会话（重构后结构全变了，必须能一眼定位）。
    if (
      !checkPass('transferAutoOpenOk') ||
      !checkPass('transferWindowOk') ||
      !checkPass('transferNoTitleOk') ||
      !checkPass('filesViewOk') ||
      !checkPass('sessionChatOk') ||
      !checkPass('textSentOk') ||
      !checkPass('sessionClearOk') ||
      !checkPass('transferThemeOk') ||
      !checkPass('transferSettingsIsolatedOk') ||
      !checkPass('chatBubbleOk') ||
      !checkPass('chatComposerOk') ||
      !checkPass('emojiPackOk')
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
    // Agent 断言失败时打快照：能区分「入口没点到」「弹窗没开」「桩没被调用」「分片没落到 UI」
    // 以及 v26.10.10-v11 的「重开弹窗后面板是否还在」、v26.10.10-v12 的「会话索引/切换」
    if (
      !checkPass('agentEntryOk') ||
      !checkPass('agentPanesOk') ||
      !checkPass('agentChatOk') ||
      !checkPass('agentReopenOk') ||
      !checkPass('agentChatsOk') ||
      !checkPass('agentInputNoRingOk') ||
      !checkPass('agentMarkdownOk') ||
      !checkPass('agentInputHeightOk') ||
      !checkPass('chatPanelSharedOk')
    ) {
      console.log('      Agent 快照：' + JSON.stringify(report.agentSnap));
    }
    if (!checkPass('agentInputNoRingOk') || !checkPass('agentInputHeightOk')) {
      console.log('      输入框快照（真实鼠标点击后）：' + JSON.stringify(report.agentInputRing));
    }
    // 发送压缩失败时把实际 POST 的载荷事实打出来（区分「没发出去」「没压缩」「解码失败」）
    if (!checkPass('phoneSendCompressedOk')) {
      console.log('      发送载荷快照：' + JSON.stringify(report.phoneSendCheck));
    }
    // v26.10.10-v17：常用语数据源迁移失败时把实际请求地址打出来（区分「没请求」与「请求了旧地址」）
    if (!checkPass('phrasesSourceOk')) {
      console.log('      常用语数据源快照：' + JSON.stringify(report.phrasesSourceUrl));
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
