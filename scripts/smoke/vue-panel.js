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

const PNG_1X1 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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
window.__recvQueue = [];
window.__sent = [];
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
window.unsafeWindow = window;
window.GM_xmlhttpRequest = function (o) {
  const url = o.url || '';
  const respond = function (status, text) {
    setTimeout(function () { o.onload && o.onload({ status: status, responseText: text }); }, 30);
  };
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
    // 首启主题跟随系统偏好；headless Chromium 的默认偏好是 dark，会让「日间基线」断言漂移。
    // 这里显式钉成 light，主题切换用例再手动点按钮验证。
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

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
            sonnerMounted: sr ? !!sr.querySelector('[data-sonner-toaster]') : false,
            rect: host ? host.getBoundingClientRect().toJSON() : null,
        };
    });
    report.checks.panelMounted = panel.host && panel.shadow && panel.styleInjected && panel.sonnerMounted;
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
        // 2026-10-18 组件正规化后：DialogContent 只做定位（背景透明），视觉表面在 Card 上
        const card = el.querySelector('[data-slot="card"]');
        return {
            found: true,
            bodyHasDialog,
            inShadow: sr.contains(el),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 120),
            background: card ? getComputedStyle(card).backgroundColor : cs.backgroundColor,
            hasCard: !!card,
            width: el.getBoundingClientRect().width,
            position: cs.position,
            zIndex: cs.zIndex,
            overlay: !!sr.querySelector('[data-reka-popper-content-wrapper], [role="presentation"]'),
        };
    });
    report.checks.dialogFound = dialog.found;
    report.checks.dialogInShadow = !!dialog.inShadow && !dialog.bodyHasDialog;
    report.checks.dialogStyled =
        !!dialog.hasCard && dialog.background === 'rgb(255, 255, 255)' && Math.round(dialog.width) === 520;
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
            const el = [...sr.querySelectorAll('button, a, [role="button"]')].find(
                (b) => b.textContent.replace(/\s+/g, '').includes(t)
            );
            if (el) el.click();
        }, text);
        await new Promise((r) => setTimeout(r, 500));
    };

    await closeTopLayer(); // 关掉设置弹窗

    // 日志弹窗：标题 + 暗色终端区 + 至少一行日志（启动时写了 3 条）
    await clickPanelText('查看日志');
    const logDialog = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const el = sr.querySelector('[role="dialog"]');
        if (!el) return { found: false };
        const terminal = el.querySelector('.bg-\\[\\#0f141a\\]') || el.querySelector('[class*="0f141a"]');
        return {
            found: true,
            inShadow: sr.contains(el),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 80),
            rows: el.querySelectorAll('[class*="border-l-"]').length,
            terminalBg: terminal ? getComputedStyle(terminal).backgroundColor : '',
            hasSwitch: !!el.querySelector('[role="switch"]'),
        };
    });
    report.checks.logDialogOk =
        !!logDialog.found &&
        !!logDialog.inShadow &&
        logDialog.text.includes('运行日志') &&
        logDialog.rows >= 3 &&
        logDialog.terminalBg === 'rgb(15, 20, 26)' &&
        logDialog.hasSwitch;
    report.logDialog = logDialog;
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-log.png') });

    await closeTopLayer();

    // 常用语侧边抽屉：Sheet 也在 shadowRoot 内、宽度 360、有搜索框，且没有漏到 body
    await clickPanelText('常用语');
    const phrasesSheet = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const el = sr.querySelector('[role="dialog"]');
        if (!el) return { found: false };
        const input = el.querySelector('input');
        const cs = getComputedStyle(el);
        return {
            found: true,
            inShadow: sr.contains(el),
            bodyHasDialog: !!document.querySelector('[role="dialog"]'),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
            width: Math.round(el.getBoundingClientRect().width),
            background: cs.backgroundColor,
            right: Math.round(window.innerWidth - el.getBoundingClientRect().right),
            placeholder: input ? input.placeholder : '',
        };
    });
    report.checks.phrasesSheetOk =
        !!phrasesSheet.found &&
        !!phrasesSheet.inShadow &&
        !phrasesSheet.bodyHasDialog &&
        phrasesSheet.text.includes('常用语') &&
        phrasesSheet.width === 360 &&
        phrasesSheet.placeholder.includes('搜索常用语');
    report.phrasesSheet = phrasesSheet;
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
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
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
    await new Promise((r) => setTimeout(r, 1000));

    // 自动弹窗：收到内容后窗口应已自己打开（不再点「传输助手」按钮）
    const transfer = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        if (!el) return { found: false, count: dialogs.length };
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const navLabels = [...el.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label'));
        const bubbles = [...el.querySelectorAll('[data-slot="bubble"]')];
        const chatImg = el.querySelector('.znhd-transfer-messages img');
        return {
            found: true,
            count: dialogs.length,
            inShadow: sr.contains(el),
            bodyHasDialog: !!document.querySelector('[role="dialog"]'),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 200),
            background: cs.backgroundColor,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            navLabels,
            // 会话列表：注入的发送者应归组成一条会话（短 ID 展示）
            sessionItems: [...el.querySelectorAll('.znhd-transfer-session-item')].map((n) =>
                n.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)
            ),
            // 气泡：文本（对方=muted）+ 图片（ghost）+ Markdown strong
            bubbleVariants: bubbles.map((b) => b.getAttribute('data-variant')),
            boldText: !!el.querySelector('.znhd-transfer-messages strong'),
            chatImgSrc: chatImg ? String(chatImg.src).slice(0, 12) : '',
            hasComposer: !!el.querySelector('.znhd-chat-composer textarea'),
        };
    });
    report.checks.transferWindowOk =
        !!transfer.found &&
        !!transfer.inShadow &&
        !transfer.bodyHasDialog &&
        transfer.background === 'rgb(46, 46, 46)' &&
        transfer.width === 1166 &&
        transfer.height === 704 &&
        ['对话', '文件', '设置', '企业信息'].every((l) => (transfer.navLabels || []).includes(l));
    report.checks.transferChatOk =
        transfer.sessionItems.length === 1 &&
        transfer.bubbleVariants.includes('muted') &&
        transfer.bubbleVariants.includes('ghost') &&
        transfer.boldText &&
        String(transfer.chatImgSrc).startsWith('blob:') &&
        !!transfer.hasComposer;
    report.transfer = transfer;
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-transfer.png') });

    // 发送文本：输入 → 点「发送」→ store 走 POST /phone/send（stub 记录载荷）
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const ta = sr.querySelector('.znhd-chat-composer textarea');
        if (!ta) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, '回给手机的一条消息');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('.znhd-chat-composer button[aria-label="发送"]');
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const sent = await page.evaluate(() => window.__sent);
    report.checks.transferSendOk =
        sent.length === 1 &&
        sent[0].url.includes('/phone/send/') &&
        (() => {
            try {
                const body = JSON.parse(sent[0].body);
                return body.text === '回给手机的一条消息' && Array.isArray(body.targets);
            } catch (e) {
                return false;
            }
        })();
    report.sent = sent;

    // 文件分组：常驻「全部文件」入口
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('button[aria-label="文件"]');
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 350));
    const filesNav = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        return { text: el ? el.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : '', allFiles: !!sr.querySelector('[data-all-files="1"]') };
    });
    // 文件分组：空态显示「暂无文件」（有会话时列表顶部才出现常驻的「全部文件」条目，
    // 与 React 版一致 —— 那条挂在 `filtered.length` 分支里）
    report.checks.transferFilesNavOk = filesNav.allFiles || filesNav.text.includes('暂无文件');
    report.filesNav = filesNav;

    // 传输助手设置：暗色子弹窗（体量/底色/文案）
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('button[aria-label="设置"]');
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const transferSettings = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        if (!el) return { found: false };
        const cs = getComputedStyle(el);
        const card = el.querySelector('[data-slot="card"]');
        return {
            found: true,
            count: dialogs.length,
            inShadow: sr.contains(el),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 80),
            background: card ? getComputedStyle(card).backgroundColor : cs.backgroundColor,
            width: Math.round(el.getBoundingClientRect().width),
        };
    });
    report.checks.transferSettingsOk =
        !!transferSettings.found &&
        !!transferSettings.inShadow &&
        transferSettings.text.includes('传输助手设置') &&
        transferSettings.background === 'rgb(43, 43, 43)' &&
        transferSettings.width === 480;
    report.transferSettings = transferSettings;
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-transfer-settings.png') });

    // ---------- 主题切换：日间（白底蓝）/ 夜间（黑底绿） ----------
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));

    const readTheme = () =>
        page.evaluate(() => {
            const host = document.getElementById('__znhd_panel_host__');
            const sr = host.shadowRoot;
            const shell = sr.querySelector('.rounded-panel') || sr.querySelector('#app > div');
            const pill = [...sr.querySelectorAll('span')].find((n) => /^v26\./.test(n.textContent.trim()));
            const cs = shell ? getComputedStyle(shell) : null;
            return {
                dark: host.classList.contains('dark'),
                shellBg: cs ? cs.backgroundColor : '',
                pillBg: pill ? getComputedStyle(pill).backgroundColor : '',
                pillFg: pill ? getComputedStyle(pill).color : '',
            };
        });

    const lightTheme = await readTheme();
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('button[aria-label="切换到夜间模式"]');
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const darkTheme = await readTheme();
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-dark.png') });

    report.checks.themeLightOk = !lightTheme.dark && lightTheme.shellBg === 'rgb(255, 255, 255)';
    // 夜间：宿主挂 dark / 面板黑底 #000 / 版本胶囊是绿色强调（#07C160 的 accent 混色）
    report.checks.themeDarkOk =
        darkTheme.dark && darkTheme.shellBg === 'rgb(0, 0, 0)' && darkTheme.pillFg === 'rgb(7, 193, 96)';
    report.theme = { lightTheme, darkTheme };

    // 切回日间（截图基线保持浅色）
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('button[aria-label="切换到日间模式"]');
        if (btn) btn.click();
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
