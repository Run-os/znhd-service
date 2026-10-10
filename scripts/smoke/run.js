/**
 * 无头端到端冒烟测试（npm run verify）。
 *
 * 用真实构建产物 dist/znhd.user.js 在 Chromium 里跑：
 *   - GM API 桩（GM_getValue/GM_setValue/GM_xmlhttpRequest/GM_addStyle/unsafeWindow…）
 *   - 与脚本完全相同的 @require 依赖（脚本猫 UI 库 / js-yaml / qrcodejs / Viewer.js）
 *   - 按真实中继协议投递：/recv 先空响应确认连接 → 1 条文本 → 1 张 PNG → 空转；常用语地址返回小 YAML
 *
 * 通过条件（全部满足，否则退出码 1）：
 *   面板渲染 / 版本号（= 产物 @version） / 文本弹窗 / 九宫格画廊 / 常用语 YAML 解析 /
 *   常用语抽屉可打开 / 更新日志弹窗（最新 10 条 + 获取更多日志） / 缩略图放大显示主图 /
 *   页面无脚本自身报错
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
  ['textPopup', '文本弹窗'],
  ['galleryText', '九宫格画廊'],
  ['phrasesLoaded', '常用语 YAML 解析'],
  ['phrasesClicked', '常用语侧边栏可打开'],
  ['phrasesIsDrawer', '常用语是 antd Drawer 侧边栏（非 Modal）'],
  ['qrNoRadius', '二维码无圆角（定位角标不被裁切）'],
  ['primaryTokenBlue', '主色 token 为 antd 蓝 blue-6 #1677FF'],
  ['panelBtnsUniform', '入口按钮样式一致（无主色实心按钮，v26.10.10-v4 起 5 个）'],
  ['panelBtnsOneRow', '入口按钮排在同一行（v26.10.10-v4 起 5 个）'],
  ['panelIconsAreSvg', '面板图标是真实 SVG 且无补充平面 emoji（Win7 兼容）'],
  ['panelAgentBtnOk', 'Agent 入口另起一行且该行只有它一个（v26.10.10-v10）'],
  ['panelAgentRowsOk', '第一行仍是原 5 个入口、第二行只有 Agent（v26.10.10-v10）'],
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
  ['historyTabsOk', '「历史记录」弹窗有「图片 / 文本」两个页签'],
  ['historyTextOk', '「文本」页签能回看到收到的文本'],
  ['testImageBtnOk', '历史记录标题旁有「发送测试图片」按钮'],
  ['testImageSentOk', '「发送测试图片」把图片投递到 /u/<deviceId>（手机上传同路径）'],
  ['historyEmptyOpenOk', '历史为空时也能打开历史记录窗口'],
  ['phoneCountOk', '【设备互联】显示已连接手机数量'],
  ['phoneListOk', '【设备互联】列出已连接手机的设备 ID'],
  ['phoneMultiPickOk', '≥2 台手机时常驻多选且默认全选'],
  ['phoneIdColorOk', '设备 ID 有边框+彩色底，且不同设备底色不同'],
  ['phoneSendCompressedOk', '发送到手机前压缩'],
  ['modalTextAlignLeft', '弹窗内容左对齐（不被宿主 CSS 污染）'],
  ['timeInputsOk', '时间段为 4 个原生 time 输入（HH:mm，无 antd TimePicker）'],
  ['iconVerticallyCentered', '图标与控件同一水平线（清空×/关闭图标）'],
  ['sniffEntryOk', '主面板有「图片嗅探」入口且能打开嗅探弹窗'],
  ['sniffScanOk', '嗅探覆盖 DOM 与 CSS 背景来源并量出大小（HEAD 与 Range 两条阶梯；SVG 已按后缀排除）'],
  ['sniffUnknownKeptOk', '大小未知的图片不丢弃（折叠保留）'],
  ['sniffSelectScopeOk', '全选/批量下载只覆盖未被阈值过滤的图（小于阈值的不计数、不可选）'],
  ['sniffExcludeOk', '按文件名排除（znhd-sniff / user-woman / user-man）且面板给出排除计数'],
  ['sniffSvgExcludedOk', '按后缀排除 SVG（.svg 与内联 SVG 都不进面板）'],
  // v26.10.10-v8：面板被宿主页重绘删除后必须自愈（watchPanelHost 的回归断言）
  ['selfHeal', '面板被宿主页删除后自动挂回（且不重复挂载）'],
  // v26.10.10-v10：Agent 助手（CAT.agent 桩下跑可用态）
  ['agentEntryOk', 'Agent 入口能打开弹窗（可用态）'],
  ['agentTabsOk', 'Agent 弹窗三个页签可切换且技能/任务面板渲染（桩数据）'],
  ['agentChatOk', 'Agent 对话能发出并落地流式回答（桩分片）'],
  // v26.10.10-v11：历史消息的 thinking 是对象，渲染不当会让整棵面板树被卸载
  ['agentReopenOk', '对话后关弹窗再打开：历史思考正常渲染且主面板仍在（v26.10.10-v11）'],
  // v26.10.10-v12：官方 conversation API 只有 create/get，会话列表是脚本自记的本地索引
  // v26.10.10-v13：会话搬进弹窗左侧栏（消息级断言必须只看 .znhd-agent-messages，否则侧栏的会话标题会假阳性）
  ['agentChatsOk', '多会话：会话在左侧栏列出、索引落盘、新建后点侧栏切回上一个对话仍看到自己的历史'],
  // v26.10.10-v13：borderless 输入框聚焦时 antd 会自己在文本域上画 outline 聚焦框（= 看起来像蓝框）
  ['agentInputNoRingOk', '输入框聚焦时没有 antd borderless 变体自带的 outline 蓝框（v26.10.10-v13）'],
  // v26.10.10-v14：回答里的 Markdown 渲染成 DOM（`**加粗**`→<strong>、列表→<li>、行内代码→<code>）
  ['agentMarkdownOk', 'Agent 消息按 Markdown 渲染：加粗/列表/行内代码出成 DOM 且文本里不再有字面量 **（v26.10.10-v14）'],
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

  // 从构建产物的 ==UserScript== 头读真实 @version，注入页面作 GM_info.script.version。
  // 这样「面板渲染的版本号」是对产物的真实校验，而不是 harness 里的死值。
  const scriptVersion = (fs.readFileSync(BUNDLE, 'utf8').match(/@version\s+(\S+)/) || [])[1] || '';

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
    //   ① 夹具会把「运行日志」弹窗一直开着盖住 Agent 弹窗，antd 的焦点陷阱随即把我们
    //      对 Agent 输入框的 focus() 抢回去（连关闭按钮都 focus 不上），
    //      于是 `document.activeElement !== ta`、`ta.matches(':focus-visible')` 恒为 false，
    //      「没聚焦」被读成「没有 outline」；
    //   ② 冒烟视口是 800x600，而 Agent 弹窗比视口高，输入框通常落在折线以下，
    //      `elementFromPoint` 返回 null、合成点击也打不到它。
    // 所以这里按用户真实路径做：关掉压在上面的弹窗 → 把输入框滚进视口 → **真实鼠标点击**它
    // → 读 `:focus-visible` 生效后的计算样式。断言里同时要求 focused && focusVisible，
    // 任何一个没成立都判红，避免再次出现「什么都没验证到却通过」。
    // ⚠️ 必须排在下面的拖拽用例之前：那段会点掉所有 `.ant-modal-close`。
    await page.evaluate(() => {
      window.__findAgentTextarea = () => {
        const modal = Array.from(document.querySelectorAll('.ant-modal')).find((el) =>
          ((el.querySelector('.ant-modal-title') || {}).textContent || '').includes('Agent 助手')
        );
        return modal ? modal.querySelector('textarea') : null;
      };
    });
    report.agentInputRing = await (async () => {
      // 清掉可能残留的全屏预览浮层（拖拽用例里也做了同样的事）：它盖在弹窗上方会吞掉点击
      await page.evaluate(() => {
        document
          .querySelectorAll('.ant-image-preview-root, .ant-image-preview-wrap')
          .forEach((e) => e.remove());
        const agent = Array.from(document.querySelectorAll('.ant-modal')).find((el) =>
          ((el.querySelector('.ant-modal-title') || {}).textContent || '').includes('Agent 助手')
        );
        document.querySelectorAll('.ant-modal-close').forEach((btn) => {
          if (!agent || !agent.contains(btn)) btn.click();
        });
      });
      await sleep(400);
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
        };
      });
      return { ...ring, hit: box.hit };
    })();
    // 四条一起判：没聚焦 / 没命中 :focus-visible 都算红 —— 否则这条断言可能什么都没验证到
    report.agentInputNoRingOk = !!(
      report.agentInputRing.found &&
      report.agentInputRing.focused &&
      report.agentInputRing.focusVisible &&
      report.agentInputRing.outlineStyle === 'none' &&
      (report.agentInputRing.boxShadow === 'none' || report.agentInputRing.boxShadow === '')
    );

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
      !checkPass('sniffSelectScopeOk')
    ) {
      console.log('      嗅探快照：' + JSON.stringify(report.sniffSnap));
    }
    // Agent 断言失败时打快照：能区分「入口没点到」「弹窗没开」「桩没被调用」「分片没落到 UI」
    // 以及 v26.10.10-v11 的「重开弹窗后面板是否还在」、v26.10.10-v12 的「会话索引/切换」
    if (
      !checkPass('agentEntryOk') ||
      !checkPass('agentTabsOk') ||
      !checkPass('agentChatOk') ||
      !checkPass('agentReopenOk') ||
      !checkPass('agentChatsOk') ||
      !checkPass('agentInputNoRingOk') ||
      !checkPass('agentMarkdownOk')
    ) {
      console.log('      Agent 快照：' + JSON.stringify(report.agentSnap));
    }
    if (!checkPass('agentInputNoRingOk')) {
      console.log('      输入框聚焦快照（真实鼠标点击后）：' + JSON.stringify(report.agentInputRing));
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
