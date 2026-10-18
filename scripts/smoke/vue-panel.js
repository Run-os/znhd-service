/**
 * Vue 版面板的端到端冒烟（迁移期专用，产物 = dist/znhd.vue.user.js）。
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
const USERSCRIPT = path.join(ROOT, 'dist/znhd.vue.user.js');
const VUE = path.join(ROOT, 'node_modules/vue/dist/vue.global.prod.js');

const GM_STUB = `
window.GM_info = { script: { version: '26.10.18-v4', updateURL: 'https://example.com/znhd.user.js' } };
window.GM_addStyle = function (css) {
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
  return s;
};
window.GM_getValue = function (_k, d) { return d; };
window.GM_setValue = function () {};
window.GM_setClipboard = function () {};
window.GM_xmlhttpRequest = function (o) { setTimeout(function () { o.onerror && o.onerror(new Error('stub')); }, 10); };
window.unsafeWindow = window;
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
<script src="/vue.js"></script>
</head><body><h1>host page</h1><script src="/znhd.vue.user.js"></script></body></html>`;

function serve() {
    const server = http.createServer((req, res) => {
        if (req.url === '/vue.js') {
            res.writeHead(200, { 'content-type': 'application/javascript' });
            res.end(fs.readFileSync(VUE));
            return;
        }
        if (req.url === '/znhd.vue.user.js') {
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
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const report = { ok: true, checks: {}, errors: [] };
    page.on('pageerror', (e) => report.errors.push(String(e)));

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await new Promise((r) => setTimeout(r, 1200));

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
    report.checks.panelMounted = panel.host && panel.shadow && panel.styleInjected;
    report.checks.panelTextOk = panel.text.includes('征纳互动监控') && panel.text.includes('语音播报');
    report.checks.versionOk = panel.text.includes('v26.10.18-v4');
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
        const el = sr && sr.querySelector('[role="dialog"]');
        const bodyHasDialog = !!document.querySelector('[role="dialog"]');
        if (!el) return { found: false, bodyHasDialog };
        const cs = getComputedStyle(el);
        return {
            found: true,
            bodyHasDialog,
            inShadow: sr.contains(el),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 120),
            background: cs.backgroundColor,
            width: el.getBoundingClientRect().width,
            position: cs.position,
            zIndex: cs.zIndex,
            overlay: !!sr.querySelector('[data-reka-popper-content-wrapper], [role="presentation"]'),
        };
    });
    report.checks.dialogFound = dialog.found;
    report.checks.dialogInShadow = !!dialog.inShadow && !dialog.bodyHasDialog;
    report.checks.dialogStyled = dialog.background === 'rgb(255, 255, 255)' && Math.round(dialog.width) === 520;
    report.dialog = dialog;

    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-dialog.png') });

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
