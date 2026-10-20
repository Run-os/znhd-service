/**
 * 脚本端（Vue 版）的端到端冒烟，产物 = dist/znhd.user.js（v26.10.18-v7 起这是唯一产物，React 版已删）。
 *
 * 与 React 版冒烟（scripts/smoke/run.js）分开的原因：这一套只验证迁移期的三件事——
 *  ① 影子树挂载成功、面板文本可读；
 *  ② DialogPortal 确实把弹窗留在 shadowRoot 里（没漏到 document.body）；
 *  ③ Tailwind 样式在影子树内生效（弹窗有白底/宽度/层级，不是无样式裸 DOM）。
 *
 * 用法：node scripts/smoke/vue-panel.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const puppeteer = require('puppeteer');

const ROOT = path.resolve(__dirname, '../..');
const USERSCRIPT = path.join(ROOT, 'dist/znhd.user.js');
const VUE = path.join(ROOT, 'node_modules/vue/dist/vue.global.prod.js');

/**
 * 浏览器可执行文件探测：与 `scripts/smoke/phone-page.js` **同一份清单**。
 * （CI 上 PUPPETEER_SKIP_DOWNLOAD=true 依赖 runner 预装的 Chrome；裸 puppeteer.launch()
 * 只找 puppeteer 自己的缓存目录 —— ubuntu-latest 迁到 Ubuntu 26.04 新镜像后缓存里
 * 没有浏览器，端到端冒烟即红（v26.10.19 实测，vue-panel 迁移时漏抄了这段）。）
 */
const BROWSERS = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((p) => p && fs.existsSync(p));

/**
 * 产物头里的 `@version`：冒烟用它当 GM_info 桩，并断言面板上显示的版本号。
 * 直接读产物而不是写死 —— 否则「改了代码忘了 bump 版本号」时冒烟依旧全绿，等于没守门。
 */
const SCRIPT_VERSION = (() => {
    const m = /^\/\/ @version\s+(\S+)/m.exec(fs.readFileSync(USERSCRIPT, 'utf8'));
    if (!m) throw new Error('读不到产物 @version：' + USERSCRIPT);
    return m[1];
})();

/** 图片嗅探夹具的响应体大小（与 GM 桩的 __imgBytes 保持一致） */
const IMG_SIZES = {
    '/img/photo-a.jpg': 61440,
    '/img/photo-b.jpg': 40960,
    '/img/tiny.jpg': 2048,
    '/img/icon-set.svg': 1024,
};

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * GM_xmlhttpRequest 桩：按真实中继协议路由（React 版 znhd-smoke.html 的精简版）。
 *
 * /recv/<uuid>（接收长轮询）：默认回 `{empty:true}`（不带 phones 名单的话会话列表是空的）；
 * 冒烟在「传输助手」一步往 `window.__recvQueue` 里塞两条载荷（文本 + 图片），
 * 下一轮轮询就会取走 —— 以此验证自动弹窗、按发送者归组、气泡渲染（文本走 Markdown、图片走 objectURL）。
 * /phone/send/<uuid>（发送）：记录载荷到 `window.__sent` 并回 `{ok:true}`。
 */
const GM_STUB = `
window.PHONE_ID = 'smoke-phone-8f3a21';
// 图片嗅探夹具：三张大图（> 默认 20KB 阈值）+ 一张小图 + 一张 .svg（应被后缀规则排除）
window.__imgBytes = {
  '/img/photo-a.jpg': 61440,
  '/img/photo-b.jpg': 40960,
  '/img/tiny.jpg': 2048,
  '/img/icon-set.svg': 1024,
};
window.__recvQueue = [];
window.__sent = [];
window.GM_info = { script: { version: '${SCRIPT_VERSION}', updateURL: 'https://example.com/znhd.user.js' } };
window.GM_addStyle = function (css) {
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
  return s;
};
window.GM_getValue = function (_k, d) { return d; };
window.GM_setValue = function () {};
window.GM_setClipboard = function () {};
window.unsafeWindow = window;
window.GM_xmlhttpRequest = function (o) {
  const url = o.url || '';
  const respond = function (status, text) {
    setTimeout(function () { o.onload && o.onload({ status: status, responseText: text }); }, 30);
  };
  // 图片嗅探用：HEAD 要给 content-length（perf 档没命中时的第二阶梯），GET 给 Range 响应
  if (url.indexOf('/img/') >= 0) {
    const bytes = window.__imgBytes[url] || 2048;
    const mime = url.slice(-4) === '.svg' ? 'image/svg+xml' : 'image/jpeg';
    const headers = 'content-type: ' + mime + String.fromCharCode(10) + 'content-length: ' + bytes;
    if ((o.method || 'GET').toUpperCase() === 'HEAD') {
      return setTimeout(function () { o.onload && o.onload({ status: 200, responseHeaders: headers, responseText: '' }); }, 15);
    }
    return setTimeout(function () {
      o.onload && o.onload({
        status: 200,
        responseHeaders: headers,
        response: new Blob([new Uint8Array(1)], { type: mime }),
      });
    }, 15);
  }
  const phones = [{ id: window.PHONE_ID, lastSeen: Date.now() }];
  if (url.indexOf('/recv/') >= 0) {
    if (window.__recvQueue.length) {
      const item = window.__recvQueue.shift();
      item.phones = phones;
      return respond(200, JSON.stringify(item));
    }
    return respond(200, JSON.stringify({ empty: true, phones: phones }));
  }
  if (url.indexOf('/phone/send/') >= 0) {
    window.__sent.push({ url: url, body: o.data });
    return respond(200, JSON.stringify({ ok: true }));
  }
  if (url.indexOf('/phone/status') >= 0) {
    return respond(200, JSON.stringify({ online: true, phones: phones }));
  }
  // 表情包清单 / 更新日志等：冒烟环境一律失败（面板自己有降级文案）
  setTimeout(function () { o.onerror && o.onerror(new Error('stub: ' + url)); }, 20);
};
`;

const HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
  /* 模拟税务页的敌意全局样式：居中 + 非 border-box + 大行高 + body 独立层叠上下文 */
  html, body { margin: 0; height: 100%; }
  body { transform: translateZ(0); text-align: center; font-family: serif; }
  * { line-height: 3; box-sizing: content-box; }
  svg { margin: -2.75em auto 0; }
</style>
<script>${GM_STUB}</script>
<script>
// 常用语缓存夹具：有缓存 ⇒ 打开侧边栏不触发抓取（不会 toast），列表直接渲染两行。
// 第一条是超长话术，用来验「只显示前两行」与「悬浮提示不被弹层裁掉」（v26.10.20-v18）。
localStorage.setItem('scriptCat_PhrasesCache', JSON.stringify({
  time: Date.now(),
  data: {
    all: [
      '您好，这里是征纳互动服务，请问有什么可以帮您？为便于快速定位您的问题，请提供纳税人识别号或企业名称，并简要描述您遇到的业务场景与报错提示，我们会尽快为您核实处理。',
      '请稍等，我核实一下。'
    ],
    mine: ['我的话术一']
  }
}));
</script>
<script src="/vue.js"></script>
</head><body><h1>host page</h1>
<!-- 图片嗅探夹具：两张 > 20KB（应出现在结果里）、一张 2KB（应被阈值过滤）、一张 .svg（应被后缀规则排除） -->
<div id="host-images">
  <img src="/img/photo-a.jpg" alt="photo-a.jpg" width="240" height="160">
  <img src="/img/photo-b.jpg" alt="photo-b.jpg" width="240" height="160">
  <img src="/img/tiny.jpg" alt="tiny.jpg" width="60" height="60">
  <img src="/img/icon-set.svg" alt="icon-set.svg" width="24" height="24">
</div><script src="/znhd.user.js"></script></body></html>`;

function serve() {
    const server = http.createServer((req, res) => {
        if (req.url === '/vue.js') {
            res.writeHead(200, { 'content-type': 'application/javascript' });
            res.end(fs.readFileSync(VUE));
            return;
        }
        if (req.url.startsWith('/img/')) {
            // 返回指定长度的随机字节：浏览器会解码失败（页面上是破图，无所谓），
            // 但响应体长度真实存在 ⇒ 资源表里 encodedBodySize 可读，嗅探的 perf 档能命中。
            const size = IMG_SIZES[req.url] || 2048;
            const buf = Buffer.alloc(size);
            let seed = 1234567;
            for (let i = 0; i < size; i++) {
                seed = (seed * 1664525 + 1013904223) >>> 0;
                buf[i] = seed & 0xff;
            }
            res.writeHead(200, {
                'content-type': req.url.endsWith('.svg') ? 'image/svg+xml' : 'image/jpeg',
                'content-length': String(size),
                'cache-control': 'no-store',
            });
            res.end(buf);
            return;
        }
        if (req.url === '/znhd.user.js') {
            res.writeHead(200, { 'content-type': 'application/javascript' });
            res.end(fs.readFileSync(USERSCRIPT));
            return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(HTML);
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
    const server = await serve();
    const port = server.address().port;
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox'],
        ...(BROWSERS[0] ? { executablePath: BROWSERS[0] } : {}),
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    // 首启主题跟随系统偏好；headless Chromium 的默认偏好是 dark，会让「日间基线」断言漂移。
    // 这里显式钉成 light，主题切换用例再手动点按钮验证。
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    const report = { ok: true, checks: {}, errors: [] };
    page.on('pageerror', (e) => report.errors.push(String(e)));

    /**
     * 影子树内 CSS 变量探针：把 daisyUI 语义变量（--color-base-100 等）解析成
     * 计算后的颜色字符串，与 getComputedStyle().backgroundColor 输出同构。
     * daisyUI 迁移后颜色全部是 oklch()（随主题），断言不再写死 rgb()，
     * 而是「元素实色 === 对应语义变量」——主题换色断言自动跟随。
     * 探针必须挂在 #app（data-theme 载体）里，挂在 shadowRoot 上只会拿到日间默认值。
     */
    const probeOf = (v) =>
        page.evaluate((name) => {
            const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
            const app = sr.querySelector('#app');
            const p = document.createElement('span');
            p.style.color = 'var(' + name + ')';
            app.appendChild(p);
            const c = getComputedStyle(p).color;
            p.remove();
            return c;
        }, v);

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1200));

    const base100Light = await probeOf('--color-base-100');
    const accentLight = await probeOf('--color-accent');
    // 守门：Tailwind v4 的 @property 在 shadowRoot 内不生效（Chromium 只处理文档级），
    // main.ts 用 CSS.registerProperty 重新注册 —— 这里验证 --tw-border-style 真有初值，
    // 否则 shadow DOM 里所有 border-* 工具类会静默退化成 0px（v26.10.19 实测踩过）。
    report.checks.twPropsRegistered = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const shell = sr.querySelector('.rounded-2xl.border-base-300');
        return !!shell && getComputedStyle(shell).getPropertyValue('--tw-border-style') === 'solid';
    });

    const panel = await page.evaluate(() => {
        const host = document.getElementById('__znhd_panel_host__');
        const sr = host && host.shadowRoot;
        return {
            host: !!host,
            shadow: !!sr,
            text: sr ? sr.querySelector('#app').innerText.replace(/\s+/g, ' ').trim() : '',
            styleInjected: sr ? !!sr.querySelector('style') : false,
            rect: host ? host.getBoundingClientRect().toJSON() : null,
        };
    });
    // toast 容器（[data-znhd="toast"]）由 lib/toast.ts 首次弹出时才挂载，不属于挂载判定
    report.checks.panelMounted = panel.host && panel.shadow && panel.styleInjected;
    report.checks.panelTextOk = panel.text.includes('征纳互动监控') && panel.text.includes('语音播报');
    report.checks.versionOk = panel.text.includes('v' + SCRIPT_VERSION);
    report.panel = panel;

    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-panel.png') });

    // 点「设置」→ 验证 Dialog 是否留在 shadowRoot 内、样式是否生效
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = [...sr.querySelectorAll('button')].find((b) => b.textContent.includes('设置'));
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));

    const dialog = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const el = sr && sr.querySelector('dialog[open]');
        const bodyHasDialog = !!document.querySelector('dialog[open]');
        if (!el) return { found: false, bodyHasDialog };
        const cs = getComputedStyle(el);
        // daisyUI modal：视觉表面在 .modal-box（bg-base-100），dialog 本体透明
        const card = el.querySelector('.modal-box');
        return {
            found: true,
            bodyHasDialog,
            inShadow: sr.contains(el),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 120),
            background: card ? getComputedStyle(card).backgroundColor : cs.backgroundColor,
            hasCard: !!card,
            boxWidth: card ? Math.round(card.getBoundingClientRect().width) : 0,
            position: cs.position,
            zIndex: cs.zIndex,
            overlay: !!sr.querySelector('.dropdown-content'),
        };
    });
    report.checks.dialogFound = dialog.found;
    report.checks.dialogInShadow = !!dialog.inShadow && !dialog.bodyHasDialog;
    report.checks.dialogStyled =
        !!dialog.hasCard && dialog.background === base100Light && dialog.boxWidth === 520;
    report.dialog = dialog;

    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-dialog.png') });

    // ---------- 阶段 2：日志 / 常用语 / 更新日志 ----------
    const closeTopLayer = async () => {
        await page.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 250));
    };

    const clickPanelText = async (text) => {
        await page.evaluate((t) => {
            const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
            const el = [...sr.querySelectorAll('button, a, [role="button"]')].find((b) =>
                b.textContent.replace(/\s+/g, '').includes(t)
            );
            if (el) el.click();
        }, text);
        await new Promise((r) => setTimeout(r, 500));
    };

    await closeTopLayer(); // 关掉设置弹窗

    // 日志弹窗：标题 + 中性色终端区 + 至少一行日志（启动时写了 3 条）
    await clickPanelText('查看日志');
    const logDialog = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const el = sr.querySelector('dialog[open]');
        if (!el) return { found: false };
        const terminal = el.querySelector('.bg-neutral');
        return {
            found: true,
            inShadow: sr.contains(el),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 80),
            rows: el.querySelectorAll('[class*="border-l-"]').length,
            terminalBg: terminal ? getComputedStyle(terminal).backgroundColor : '',
            hasSwitch: !!el.querySelector('input.toggle'),
            // 类型筛选（v21 起不再冒用 daisyUI `filter` 组件）：自带 data-log-filter 容器
            // + 4 个类型 checkbox + 普通 button「全部」（多选语义，非官方 radio 组）
            filterForm: !!el.querySelector('[data-log-filter]'),
            filterBoxes: el.querySelectorAll('[data-log-filter] input[type="checkbox"]').length,
            allBtnVisible: (() => {
                const b = el.querySelector('[data-log-filter] button[type="button"]');
                return !!b && b.textContent.includes('全部') && b.offsetParent !== null;
            })(),
            // v6：底部 footer 关闭按钮已删（modal-action 不再渲染）
            footerGone: el.querySelectorAll('.modal-action').length === 0,
        };
    });
    const neutralLight = await probeOf('--color-neutral');
    report.checks.logDialogOk =
        !!logDialog.found &&
        !!logDialog.inShadow &&
        logDialog.text.includes('运行日志') &&
        logDialog.rows >= 3 &&
        logDialog.terminalBg === neutralLight &&
        logDialog.hasSwitch &&
        logDialog.filterForm &&
        logDialog.filterBoxes === 4 &&
        logDialog.allBtnVisible &&
        logDialog.footerGone;
    report.logDialog = logDialog;
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-log.png') });

    await closeTopLayer();

    // 常用语右侧弹层（modal modal-end）：modal-box 360 宽贴右边、有搜索框，且没有漏到 body
    await clickPanelText('常用语');
    const phrasesSheet = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const el = sr.querySelector('dialog[open]');
        if (!el) return { found: false };
        const input = el.querySelector('input');
        const box = el.querySelector('.modal-box');
        const rect = box ? box.getBoundingClientRect() : el.getBoundingClientRect();
        return {
            found: true,
            inShadow: sr.contains(el),
            bodyHasDialog: !!document.querySelector('dialog[open]'),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
            width: Math.round(rect.width),
            background: box ? getComputedStyle(box).backgroundColor : '',
            right: Math.round(window.innerWidth - rect.right),
            placeholder: input ? input.placeholder : '',
        };
    });
    report.checks.phrasesSheetOk =
        !!phrasesSheet.found &&
        !!phrasesSheet.inShadow &&
        !phrasesSheet.bodyHasDialog &&
        phrasesSheet.text.includes('常用语') &&
        phrasesSheet.width === 360 &&
        phrasesSheet.background === base100Light &&
        phrasesSheet.placeholder.includes('搜索常用语');
    report.phrasesSheet = phrasesSheet;

    // 每条话术只显示前两行 + 悬浮提示不被弹层裁掉（v26.10.20-v18）
    //  · 截断：button 固定 h-10（leading-5 × 2 = 40px），内层 span line-clamp-2
    //  · 提示：浮层必须是 dialog 直接子节点（在 .modal-box 外面）。曾经用 daisyUI 的
    //    tooltip+data-tip，伪元素落在 modal-box 里被 overflow-y:auto 裁掉大半。
    const rowPoint = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('dialog[open] .modal-box .list button');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (rowPoint) {
        await page.mouse.move(rowPoint.x, rowPoint.y);
        await new Promise((r) => setTimeout(r, 150));
    }
    const phraseLayout = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const el = sr.querySelector('dialog[open]');
        const box = el && el.querySelector('.modal-box');
        if (!box) return { found: false };
        const btns = [...box.querySelectorAll('.list button')];
        const tip = el.querySelector('[data-znhd="phrase-tip"]');
        const boxRect = box.getBoundingClientRect();
        const tr = tip ? tip.getBoundingClientRect() : null;
        return {
            found: true,
            rows: btns.length,
            heights: btns.map((b) => Math.round(b.getBoundingClientRect().height)),
            clamps: btns.map((b) => {
                const s = b.querySelector('span');
                return s ? getComputedStyle(s).webkitLineClamp : '';
            }),
            tipInBox: tip ? box.contains(tip) : null,
            tipVisibility: tip ? getComputedStyle(tip).visibility : null,
            tipText: tip ? (tip.textContent || '').trim() : null,
            tipRect: tr
                ? {
                      left: Math.round(tr.left),
                      right: Math.round(tr.right),
                      top: Math.round(tr.top),
                      bottom: Math.round(tr.bottom),
                      width: Math.round(tr.width),
                      height: Math.round(tr.height),
                  }
                : null,
            tipLeftOfBox: tr ? tr.right <= boxRect.left : false,
            vw: window.innerWidth,
            vh: window.innerHeight,
        };
    });
    report.checks.phrasesClampOk =
        !!phraseLayout.found &&
        phraseLayout.rows >= 2 &&
        phraseLayout.heights.every((h) => h === 40) &&
        phraseLayout.clamps.every((c) => c === '2');
    report.checks.phrasesTipOk =
        !!phraseLayout.tipRect &&
        phraseLayout.tipInBox === false &&
        phraseLayout.tipVisibility === 'visible' &&
        phraseLayout.tipLeftOfBox &&
        !!phraseLayout.tipText &&
        phraseLayout.tipText.startsWith('您好，这里是征纳互动服务') &&
        phraseLayout.tipRect.width >= 100 &&
        phraseLayout.tipRect.height >= 20 &&
        phraseLayout.tipRect.left >= 0 &&
        phraseLayout.tipRect.top >= 0 &&
        phraseLayout.tipRect.right <= phraseLayout.vw &&
        phraseLayout.tipRect.bottom <= phraseLayout.vh;
    report.phraseLayout = phraseLayout;
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-phrase-tip.png') });
    // 移开鼠标：提示必须消失（否则悬停后一直挂着）
    await page.mouse.move(4, 400);
    await new Promise((r) => setTimeout(r, 120));
    report.checks.phrasesTipHideOk = await page.evaluate(
        () =>
            !document
                .getElementById('__znhd_panel_host__')
                .shadowRoot.querySelector('[data-znhd="phrase-tip"]')
    );
    // toast（抓取失败的提示）恰好盖在 sheet 顶栏上，等它 3 秒自动消失后再截图
    await new Promise((r) => setTimeout(r, 3400));
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-phrases.png') });

    await closeTopLayer();

    // 更新日志：断言弹窗能打开且内容在影子树内（网络在冒烟环境必然失败，只验降级文案）。
    // 点「更新日志」不关闭设置弹窗（与 React 版一致，两个 Modal 叠加），故取最后一个 dialog。
    await clickPanelText('设置');
    await clickPanelText('更新日志');
    const changelog = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        if (!el) return { found: false, count: 0 };
        return {
            found: true,
            count: dialogs.length,
            inShadow: sr.contains(el),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 100),
        };
    });
    report.checks.changelogDialogOk =
        !!changelog.found &&
        !!changelog.inShadow &&
        (changelog.text.includes('更新日志') ||
            changelog.text.includes('读取失败') ||
            changelog.text.includes('暂无更新日志'));
    report.changelog = changelog;
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-changelog.png') });

    await closeTopLayer();
    await closeTopLayer();

    // ---------- 阶段 3：传输助手 ----------
    // 注入「手机发来」的一条文本 + 一张图（走真实接收长轮询的协议载荷）：
    // 验证自动弹窗、按发送者归组、气泡渲染（文本走 Markdown、图片走 objectURL）
    await page.evaluate((png) => {
        window.__recvQueue.push(
            {
                type: 'text',
                text: '冒烟注入的**加粗**文本',
                from: window.PHONE_ID,
                ts: Date.now(),
            },
            {
                type: 'image',
                data: png,
                mime: 'image/png',
                name: 'smoke.png',
                from: window.PHONE_ID,
            }
        );
    }, PNG_1X1);
    // 等自动弹窗真正挂出来（大 bundle 冷解析会慢过 1s 固定等待，别用 sleep 赌时序）
    try {
        await page.waitForFunction(
            () => {
                const sr = document.getElementById('__znhd_panel_host__');
                if (!sr || !sr.shadowRoot) return false;
                return [...sr.shadowRoot.querySelectorAll('dialog[open]')].some((d) =>
                    d.textContent.includes('传输助手')
                );
            },
            { timeout: 20000 }
        );
    } catch (e) {
        const dbg = await page.evaluate(() => {
            const sr = document.getElementById('__znhd_panel_host__');
            const root = sr && sr.shadowRoot;
            return {
                host: !!sr,
                recvQueued: (window.__recvQueue || []).length,
                dialogs: root ? root.querySelectorAll('dialog[open]').length : -1,
                bodyDialogs: document.querySelectorAll('dialog[open]').length,
                srHasApp: !!(root && root.querySelector('#app')),
                appChildren: root && root.querySelector('#app') ? root.querySelector('#app').children.length : -1,
                pageErr: -1,
            };
        });
        await page.screenshot({ path: require('os').tmpdir() + '/znhd-dbg-no-transfer.png' });
        console.log('[dbg-transfer-open] ' + JSON.stringify(dbg));
        throw e;
    }
    await new Promise((r) => setTimeout(r, 300));

    /**
     * 「更多」下拉里点一项：chat 窗口标题栏 icon 按钮（清空 / 全部文件 / 扫码 / 更多 / 关闭），
     * 设置、关于收在「更多」dropdown —— v21 起改官方 details 式（summary 开合），
     * 所以触发器是 `summary[aria-label="更多"]`（老版是 div[role=button]）。
     * 层级由 daisyUI dropdown 自身（z-1 + 弹窗内层叠上下文）保证；这里验菜单真的展开了。
     */
    async function pickMore(label) {
        await page.evaluate(() => {
            const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
            const btn = sr.querySelector('summary[aria-label="更多"], [role="button"][aria-label="更多"]');
            if (btn) btn.click();
        });
        await new Promise((r) => setTimeout(r, 300));
        return page.evaluate((text) => {
            const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
            const items = [...sr.querySelectorAll('.dropdown-content li button')];
            const it = items.find((n) => n.textContent.includes(text));
            if (!it) return { clicked: false, visible: false, labels: items.map((n) => n.textContent.trim()) };
            // focus 式下拉展开后菜单必须真的可见（宽高在、无 visibility 裁剪）
            const menu = sr.querySelector('.dropdown-content');
            let visible = false;
            if (menu) {
                const r = menu.getBoundingClientRect();
                visible = r.width > 100 && r.height > 50 && getComputedStyle(menu).visibility === 'visible';
            }
            it.click();
            return { clicked: true, visible, labels: items.map((n) => n.textContent.trim()) };
        }, label);
    }

    // 自动弹窗：收到内容后窗口应已自己打开（不再点「传输助手」按钮）
    const transfer = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        if (!el) return { found: false, count: dialogs.length };
        const card = el.querySelector('.modal-box');
        const rect = (card || el).getBoundingClientRect();
        // ⚠️ 排除头像（.chat-image img）：它也在 scroller 里，且 DOM 顺序在气泡之前，
        //    不排除会把它当成「收到的图片」，断言 blob: 必然失败。
        const chatImg = el.querySelector('[data-znhd="chat-scroller"] img:not(.chat-image img)');
        const avatarImg = el.querySelector('.chat-image img');
        const composer = el.querySelector('textarea.textarea');
        // 我方气泡（chat-end）的文字色：来自官方 chat-bubble-primary（primary-content）
        const mineBubble = el.querySelector('.chat-end .chat-bubble');
        return {
            found: true,
            count: dialogs.length,
            inShadow: sr.contains(el),
            bodyHasDialog: !!document.querySelector('dialog[open]'),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 200),
            // modal-box 外观：官方默认底色 base-100 + 自带圆角
            hasCard: !!card,
            hasScroller: !!el.querySelector('[data-znhd="chat-scroller"]'),
            hasComposer: !!composer,
            // 头部动作按钮 + 「更多」（details 式 dropdown 的 summary，v21 起；老版是 div[role=button]）
            headButtons: [
                ...el.querySelectorAll('button[aria-label], summary[aria-label], [role="button"][aria-label]'),
            ].map((b) => b.getAttribute('aria-label')),
            background: card ? getComputedStyle(card).backgroundColor : '',
            mineTextColor: mineBubble ? getComputedStyle(mineBubble).color : '',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            // v26.10.19-v12：分界线 —— 1px + 与窗口外框同色（走 var(--tw-hairline)，随主题）
            headerBorder: (() => {
                const h = el.querySelector('.modal-box > div:first-child');
                if (!h) return '';
                const s = getComputedStyle(h);
                return s.borderBottomWidth + ' ' + s.borderBottomColor;
            })(),
            // v26.10.20-v2：标题栏按钮 / 输入框按钮 —— 圆形（btn-circle）+ 响应式尺寸链
            // ⚠️ 用 offsetWidth（布局尺寸）而不是 rect：避免 transition 中的 scale 干扰
            // ⚠️ 「更多」是 <summary>（details 式 dropdown）、「+」是 button，都要抓
            headBtnBox: [...el.querySelectorAll('.modal-box > div:first-child button[aria-label], .modal-box > div:first-child summary[aria-label]')].map(
                (b) =>
                    b.getAttribute('aria-label') +
                    '=' +
                    b.offsetWidth +
                    'x' +
                    b.offsetHeight +
                    ' ' +
                    Math.round(parseFloat(getComputedStyle(b).borderRadius))
            ),
            composerBtnBox: composer
                ? [...composer.parentElement.querySelectorAll('button[aria-label], summary[aria-label]')].map(
                      (b) => b.offsetWidth + 'x' + b.offsetHeight + ' ' + Math.round(parseFloat(getComputedStyle(b).borderRadius))
                  )
                : [],
            // 气泡：对方文本（chat-start）+ Markdown strong；图片走 blob:
            theirBubbles: el.querySelectorAll('.chat-start .chat-bubble').length,
            // 官方 chat-header（发送者 + <time>）：每条消息一条
            headerCount: el.querySelectorAll('.chat-header').length,
            headerHasTime: !!el.querySelector('.chat-header time'),
            theirTextColor: (() => {
                const b = el.querySelector('.chat-start .chat-bubble');
                return b ? getComputedStyle(b).color : '';
            })(),
            boldText: !!el.querySelector('.chat-bubble strong'),
            chatImgSrc: chatImg ? String(chatImg.src).slice(0, 12) : '',
            // 头像：DiceBear notionists（seed = 设备标识，不是随机数）
            avatarSrc: avatarImg ? String(avatarImg.getAttribute('src') || '') : '',
            chatImgOk: chatImg ? chatImg.naturalWidth > 0 : false,
            chatImgSize: chatImg ? chatImg.naturalWidth + 'x' + chatImg.naturalHeight : '',
            // 卡片下方那行居中提示（v26.10.19-v4：在线=不渲染；夹具无手机在线 ⇒ 应显示离线警示）
            offlineHint: el.innerText.includes('当前没有在线手机，连上后才能发送'),
        };
    });
    report.checks.transferWindowOk =
        !!transfer.found &&
        !!transfer.inShadow &&
        !transfer.bodyHasDialog &&
        transfer.hasCard &&
        transfer.hasScroller &&
        transfer.hasComposer &&
        // v26.10.19（daisyUI）：窗口底色随主题 —— modal-box 官方默认 base-100；
        // 冒烟钉的是日间（prefers-color-scheme=light），夜间由末尾 transferThemeFollowOk 反向守
        transfer.background === base100Light &&
        // v26.10.19：384 → 768（横向一倍），560 → 672（高度 +20%）
        transfer.width === 768 &&
        transfer.height === 672 &&
        ['清空聊天记录', '全部文件', '扫码连接手机', '更多', '关闭'].every((l) =>
            (transfer.headButtons || []).includes(l)
        );
    // 分界线 = 1px + 主题 base-300
    const base300Light = await probeOf('--color-base-300');
    report.checks.transferDividerOk = transfer.headerBorder === '1px ' + base300Light;
    // 标题栏 5 个（清空 / 全部文件 / 扫码连接手机 / 更多 / 关闭）+ 输入框 2 个（附件 / 发送）：全是圆形
    // 滚动到底浮钮已随 message-scroller 一起移除（用户决策 #2）
    const isRoundBtn = (b) => {
        const m = /(\d+)x(\d+)\s+(\d+)/.exec(String(b));
        return !!m && m[1] === m[2] && Number(m[3]) >= 9999;
    };
    report.checks.transferBtnShapeOk =
        transfer.headBtnBox.length === 5 &&
        transfer.headBtnBox.every(isRoundBtn) &&
        // 输入舱两个圆形按钮：「+」附件触发器（v21 起是 details 的 <summary>）+「发送」
        transfer.composerBtnBox.length === 2 &&
        transfer.composerBtnBox.every(isRoundBtn);
    report.checks.transferChatOk =
        transfer.text.includes('已连接 1 台设备') &&
        transfer.theirBubbles >= 2 &&
        transfer.headerCount >= 2 &&
        transfer.headerHasTime &&
        transfer.boldText &&
        String(transfer.chatImgSrc).startsWith('blob:');
    report.checks.transferAvatarOk = String(transfer.avatarSrc).startsWith(
        'https://api.dicebear.com/10.x/notionists/svg?seed='
    );
    report.transfer = transfer;
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-transfer.png') });

    // 发送文本：输入 → 点「发送」→ store 走 POST /phone/send（stub 记录载荷）
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const ta = sr.querySelector('textarea.textarea');
        if (!ta) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, '回给手机的一条消息');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('button[aria-label="发送"]');
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const sent = await page.evaluate(() => window.__sent);
    // 发出后：我方气泡（chat-bubble-primary）文字 = 主题 primary-content
    const mineColor = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        const b = el && el.querySelector('.chat-end .chat-bubble');
        return b ? getComputedStyle(b).color : '';
    });
    const primaryContentLight = await probeOf('--color-primary-content');
    report.checks.transferSendOk =
        mineColor === primaryContentLight &&
        sent.length === 1 &&
        sent[0].url.includes('/phone/send/') &&
        (() => {
            try {
                const body = JSON.parse(sent[0].body);
                // 聚合会话的发送目标就是「广播给所有在线手机」= targets:'all'
                return body.text === '回给手机的一条消息' && (body.targets === 'all' || Array.isArray(body.targets));
            } catch (e) {
                return false;
            }
        })();
    report.sent = sent;

    // v26.10.20-v4 回归守门：长文本气泡必须换行（不横向溢出、宽度受 74% 约束）
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const ta = sr.querySelector('textarea.textarea');
        if (!ta) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, 'X'.repeat(220));
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('button[aria-label="发送"]');
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const wrapProbe = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        const scroller = el && el.querySelector('[data-znhd="chat-scroller"]');
        const bubbles = el ? [...el.querySelectorAll('.chat-end .chat-bubble')] : [];
        const last = bubbles[bubbles.length - 1];
        return {
            bubbleW: last ? last.offsetWidth : 0,
            bubbleH: last ? last.offsetHeight : 0,
            scrollerW: scroller ? scroller.clientWidth : 0,
            hOverflow: scroller ? scroller.scrollWidth > scroller.clientWidth : null,
        };
    });
    report.wrapProbe = wrapProbe;
    // 纯长 token（不可断词最坏场景）也必须被关进气泡里
    report.checks.bubbleWrapOk = wrapProbe.bubbleW > 100 && wrapProbe.hOverflow === false;

    // 「全部文件」入口 v26.10.19-v9 起在标题栏（独立圆形按钮），不再收进「更多」下拉
    const filesPick = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('button[aria-label="全部文件"]');
        if (!btn) return { clicked: false, visible: false, labels: [] };
        btn.click();
        return { clicked: true, visible: true, labels: ['全部文件'] };
    });
    await new Promise((r) => setTimeout(r, 400));
    const filesNav = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        return { text: el ? el.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : '' };
    });
    report.checks.transferFilesNavOk =
        !!filesPick.clicked && !!filesPick.visible && filesNav.text.includes('全部文件（图片');
    report.filesNav = filesNav;
    report.filesPick = filesPick;

    // 关掉「全部文件」，再从「更多」进设置（子弹窗：体量/底色/文案）
    // v26.10.19（daisyUI）：弹窗底色 = modal-box 官方 base-100，随主题
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 350));
    const settingsPick = await pickMore('设置');
    await new Promise((r) => setTimeout(r, 450));
    const transferSettings = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        if (!el) return { found: false };
        const card = el.querySelector('.modal-box');
        return {
            found: true,
            count: dialogs.length,
            inShadow: sr.contains(el),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 80),
            background: card ? getComputedStyle(card).backgroundColor : '',
            width: card ? Math.round(card.getBoundingClientRect().width) : 0,
        };
    });
    report.checks.transferSettingsOk =
        !!settingsPick.clicked &&
        !!transferSettings.found &&
        !!transferSettings.inShadow &&
        transferSettings.text.includes('传输助手设置') &&
        transferSettings.background === base100Light &&
        transferSettings.width === 480;
    report.transferSettings = transferSettings;
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-transfer-settings.png') });

    // ---------- 图片嗅探（阶段 4） ----------
    // 先逐层 Esc 关掉传输助手窗口与它的设置弹窗
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape');
        await new Promise((r) => setTimeout(r, 220));
    }

    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = [...sr.querySelectorAll('button')].find((b) => b.textContent.includes('图片嗅探'));
        if (btn) btn.click();
    });
    // 扫描是同步收集 + 异步测大小（150ms 合批），给足时间让所有测量落地
    await new Promise((r) => setTimeout(r, 2200));

    const sniff = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        if (!el) return { found: false };
        const card = el.querySelector('.modal-box');
        const cards = [...el.querySelectorAll('[data-sniff-card]')];
        const bar = el.querySelector('[data-sniff-excluded]');
        const text = el.innerText.replace(/\s+/g, ' ').trim();
        return {
            found: true,
            inShadow: sr.contains(el),
            width: card ? Math.round(card.getBoundingClientRect().width) : 0,
            background: card ? getComputedStyle(card).backgroundColor : '',
            text: text.slice(0, 200),
            cardCount: cards.length,
            alts: cards.map((c) => (c.querySelector('img') || {}).alt || ''),
            sizes: cards.map((c) => c.innerText.replace(/\s+/g, ' ').trim()),
            // 「没拿到消息时间」的标记：v26.10.19 起不再给卡片加红圈，改由文件名文字标红
            noTimeFlags: cards.map((c) => c.getAttribute('data-sniff-no-time')),
            nameColors: cards.map((c) => {
                const n = c.querySelector('[data-sniff-name]');
                return n ? getComputedStyle(n).color : '';
            }),
            // 旧的红圈是 inline style 的 box-shadow，必须确认它彻底消失
            rings: cards.map((c) => c.style.boxShadow || ''),
            excluded: bar ? bar.getAttribute('data-sniff-excluded') : null,
            hasRescan: !![...el.querySelectorAll('button')].find((b) => b.textContent.includes('重新扫描')),
        };
    });
    // 夹具：photo-a(60KB) / photo-b(40KB) 应出现；tiny(2KB) 被阈值挡下；icon-set.svg 被后缀规则排除
    report.checks.sniffDialogOk =
        !!sniff.found &&
        !!sniff.inShadow &&
        sniff.width === 828 &&
        sniff.hasRescan &&
        sniff.text.includes('显示 2 张') &&
        sniff.cardCount === 2 &&
        sniff.alts.includes('photo-a.jpg') &&
        sniff.alts.includes('photo-b.jpg') &&
        !sniff.alts.includes('tiny.jpg') &&
        sniff.excluded === '1';
    // 冒烟页没有会话上下文 ⇒ 每张图都取不到消息时间 ⇒ 文件名必须全标红（text-error）、且一个红圈都不许有
    const errorLight = await probeOf('--color-error');
    report.checks.sniffNoTimeNameOk =
        sniff.cardCount > 0 &&
        sniff.noTimeFlags.every((f) => f === '1') &&
        sniff.nameColors.length === sniff.cardCount &&
        sniff.nameColors.every((c) => c === errorLight) &&
        sniff.rings.every((r) => r === '');
    report.sniff = sniff;

    // 展开「大小未知」档：里面应当只剩测不出字节数的那张（夹具里是 .ico / 非图片资源之类），
    // 顺便验证折叠交互与「未知也不丢」这条红线
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        const btn = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('大小未知'));
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const sniffUnknown = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        const cards = [...el.querySelectorAll('[data-sniff-card]')];
        return { cardCount: cards.length, alts: cards.map((c) => (c.querySelector('img') || {}).alt || '') };
    });
    report.sniffUnknown = sniffUnknown;
    report.checks.sniffUnknownExpandOk = sniffUnknown.cardCount === 3;
    // 收起，恢复默认折叠态
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        const btn = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('大小未知'));
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 250));

    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-sniff.png') });

    // 全选 → 按钮文案应变成「下载所选（2）」
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const box = sr.querySelector('[aria-label="全选"]');
        if (box) box.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const sniffSelect = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        const btn = el ? [...el.querySelectorAll('button')].find((b) => b.textContent.includes('下载所选')) : null;
        return { label: btn ? btn.textContent.trim() : '', disabled: btn ? btn.disabled : null };
    });
    const pickableTotal = Number((sniff.text.match(/共 (\d+) 张/) || [])[1] || 0);
    report.checks.sniffSelectOk =
        pickableTotal > 0 && sniffSelect.label.includes('（' + pickableTotal + '）') && sniffSelect.disabled === false;
    report.sniffSelect = sniffSelect;

    // 点缩略图 → 全屏预览（v26.10.19 起外壳 = 原生 dialog.modal，showModal 进 top layer，
    // 层级高于已打开的嗅探弹窗；「[open]」是唯一可靠的开合判据——内容常驻 DOM，只是 visibility:hidden）
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        const img = el ? el.querySelector('[data-sniff-card] img') : null;
        if (img) img.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const sniffPreview = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dlg = sr.querySelector('dialog[data-znhd="image-preview"][open]');
        if (!dlg) return { open: false };
        const close = dlg.querySelector('[aria-label="关闭预览"]');
        return {
            open: !!close,
            inShadow: sr.contains(dlg),
            hasPrint: !!dlg.querySelector('[aria-label="打印"]'),
            counter: (() => {
                const n = [...dlg.querySelectorAll('span')].find((x) => /^\d+ \/ \d+$/.test(x.textContent.trim()));
                return n ? n.textContent.trim() : '';
            })(),
        };
    });
    report.checks.sniffPreviewOk = sniffPreview.open && sniffPreview.inShadow && sniffPreview.hasPrint;
    report.sniffPreview = sniffPreview;
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-sniff-preview.png') });

    // v26.10.19-v10 回归守门：预览开着按一次 Esc 必须只关预览、嗅探窗保持打开
    // （v3 修过一次「Esc 连坐关掉嗅探窗」——window 捕获段先于 dialog 层处理，别回退）
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));
    const afterEsc = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        return {
            previewClosed: !sr.querySelector('dialog[data-znhd="image-preview"][open]'),
            sniffStillOpen: !!sr.querySelector('[data-sniff-card]'),
        };
    });
    report.checks.sniffEscOnlyPreviewOk = afterEsc.previewClosed && afterEsc.sniffStillOpen;
    report.sniffAfterEsc = afterEsc;

    // v26.10.19-v10 回归：点预览层空白区也必须只关预览（原生 dialog 不做 outside-click dismiss，
    // pointerdown 拦截保留用于隔离事件，不能连坐关掉底层弹窗）
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const img = sr.querySelector('[data-sniff-card] img');
        if (img) img.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    await page.mouse.click(200, 400); // 图片区空白（1x1 夹具图在正中心，200,400 命中图片区容器自身）
    await new Promise((r) => setTimeout(r, 300));
    const afterBlankClick = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        return {
            previewClosed: !sr.querySelector('dialog[data-znhd="image-preview"][open]'),
            sniffStillOpen: !!sr.querySelector('[data-sniff-card]'),
        };
    });
    report.checks.sniffBlankClickOnlyPreviewOk = afterBlankClick.previewClosed && afterBlankClick.sniffStillOpen;
    report.sniffAfterBlankClick = afterBlankClick;

    // 关预览 + 关嗅探弹窗
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));

    // ---------- 主题切换：日间 wireframe / 夜间 business ----------
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));

    const readTheme = () =>
        page.evaluate(() => {
            const host = document.getElementById('__znhd_panel_host__');
            const sr = host.shadowRoot;
            const app = sr.querySelector('#app');
            const shell = sr.querySelector('.rounded-2xl.border-base-300');
            const pill = [...sr.querySelectorAll('span')].find((n) => /^v26\./.test(n.textContent.trim()));
            const cs = shell ? getComputedStyle(shell) : null;
            return {
                // daisyUI 迁移后 data-theme / .dark 都挂在影子树内的 #app 上
                //（属性选择器穿不透 shadow 边界，不能挂宿主元素）
                appTheme: app ? app.dataset.theme || '' : '',
                dark: app ? app.classList.contains('dark') : false,
                // swap 主题切换的勾选态（checked = 夜间 business）
                swapChecked: (() => {
                    const t = sr.querySelector('input.theme-controller');
                    return t ? t.checked : null;
                })(),
                shellBg: cs ? cs.backgroundColor : '',
                pillBg: pill ? getComputedStyle(pill).backgroundColor : '',
                pillFg: pill ? getComputedStyle(pill).color : '',
            };
        });

    const lightTheme = await readTheme();
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        // 主题切换 = daisyUI swap 官方组件（checkbox 驱动，checked=夜间 business）
        const input = sr.querySelector('input.theme-controller[aria-label="切换到夜间模式"]');
        if (input) input.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const darkTheme = await readTheme();
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-dark.png') });

    // 夜间基线探针必须在切到 business 之后再取（同一变量名，两个主题值不同）
    const base100Dark = await probeOf('--color-base-100');
    report.checks.themeLightOk =
        lightTheme.appTheme === 'wireframe' &&
        !lightTheme.dark &&
        lightTheme.swapChecked === false &&
        lightTheme.shellBg === base100Light &&
        lightTheme.pillBg === accentLight;
    // 夜间：#app 挂 business/.dark、swap 勾选、面板底色 = business 的 base-100（oklch 24.35%）
    report.checks.themeDarkOk =
        darkTheme.appTheme === 'business' &&
        darkTheme.dark &&
        darkTheme.swapChecked === true &&
        darkTheme.shellBg === base100Dark;
    report.theme = { lightTheme, darkTheme };

    // v26.10.19（daisyUI）反向守门：窗口色板必须**跟随主题**。
    // 夜间重新打开传输助手窗口，modal-box 底色/描边/输入舱必须全部等于 business 的语义变量；
    // 若哪天有人把 hex 写死回组件里，这条会红（日间基线断言则永远绿）。
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = [...sr.querySelectorAll('button')].find((b) => b.textContent.includes('传输助手'));
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 450));
    const darkTransfer = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        if (!el) return { found: false };
        const card = el.querySelector('.modal-box');
        const head = el.querySelector('.modal-box > div:first-child');
        const composer = el.querySelector('textarea.textarea');
        const hs = head ? getComputedStyle(head) : null;
        return {
            found: true,
            background: card ? getComputedStyle(card).backgroundColor : '',
            headerBorder: hs ? hs.borderBottomWidth + ' ' + hs.borderBottomColor : '',
            composerBg: composer ? getComputedStyle(composer).backgroundColor : '',
        };
    });
    const base300Dark = await probeOf('--color-base-300');
    report.checks.transferThemeFollowOk =
        darkTransfer.found &&
        darkTransfer.background === base100Dark &&
        darkTransfer.headerBorder === '1px ' + base300Dark &&
        darkTransfer.composerBg === base100Dark;
    report.darkTransfer = darkTransfer;
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));

    // 切回日间（截图基线保持浅色）
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const input = sr.querySelector('input.theme-controller[aria-label="切换到日间模式"]');
        if (input) input.click();
    });
    await new Promise((r) => setTimeout(r, 250));

    report.checks.noPageError = report.errors.length === 0;
    report.ok = Object.values(report.checks).every(Boolean);
    console.log(JSON.stringify(report, null, 2));

    await browser.close();
    server.close();
    process.exit(report.ok ? 0 : 1);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
