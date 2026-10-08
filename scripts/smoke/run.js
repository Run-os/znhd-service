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
  ['panelBtnsUniform', '四个入口按钮样式一致（无主色实心按钮）'],
  ['panelBtnsOneRow', '四个入口按钮排在同一行'],
  ['ballDragOk', '悬浮球可拖动移动（且拖完不误触展开）'],
  ['logListNotReversed', '日志列表仍是 column（非 column-reverse）'],
  ['logNewestOnBottom', '日志最新一条在最下方'],
  ['logAutoRefreshToggle', '日志弹窗有「自动刷新」开关且默认开启'],
  ['logAutoScrollBottom', '日志更新后自动滚到底部'],
  ['logDarkTerminalOk', '日志区为暗色终端风（底色/三栏/状态栏）'],
  ['overlayAbovePanel', 'antd 弹窗/侧边栏盖在面板之上（方案 B）'],
  ['changelogPopup', '更新日志弹窗（最新 10 条）'],
  ['viewerZoomOk', '缩略图放大显示主图（antd 预览）'],
  ['copyOk', '图片复制只尝试写 PNG'],
  ['printBtnOk', '放大预览工具栏有「打印」按钮'],
  ['printIframeOk', '打印链路接通（react-to-print 建出打印 iframe）'],
  ['printA4Ok', '打印按 A4 自适应且无页眉页脚（@page margin:0 + 内容框留白 + object-fit）'],
  ['previewToolbarOk', '放大预览的工具栏未被图片盖住（宿主 body 带 transform 时也在视口内）'],
  ['previewIconCenteredOk', '预览工具栏图标与按钮同一水平线（不被宿主 CSS 顶出胶囊）'],
  ['historyTabsOk', '「历史记录」弹窗有「图片 / 文本」两个页签'],
  ['historyTextOk', '「文本」页签能回看到收到的文本'],
  ['phoneCountOk', '【设备互联】显示已连接手机数量'],
  ['phoneListOk', '【设备互联】列出已连接手机的设备 ID'],
  ['phoneMultiPickOk', '≥2 台手机时常驻多选且默认全选'],
  ['phoneSendCompressedOk', '发送到手机前压缩'],
  ['modalTextAlignLeft', '弹窗内容左对齐（不被宿主 CSS 污染）'],
  ['timeInputsOk', '时间段为 4 个原生 time 输入（HH:mm，无 antd TimePicker）'],
  ['iconVerticallyCentered', '图标与控件同一水平线（清空×/关闭图标）'],
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

    // version 检查改为「渲染值 === 产物 @version」的精确比对
    const checkPass = (key) => (key === 'version' ? report.version === 'v' + scriptVersion : !!report[key]);

    console.log('冒烟测试报告：');
    for (const [key, label] of CHECKS) {
      const value = checkPass(key);
      console.log(
        `  ${value ? '✅' : '❌'} ${label}${key === 'version' ? '（' + report.version + ' ← 产物 ' + scriptVersion + '）' : ''}`
      );
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
