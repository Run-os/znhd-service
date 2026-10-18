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
            const el = [...sr.querySelectorAll('button, a, [role="button"]')].find((b) =>
                b.textContent.replace(/\s+/g, '').includes(t)
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
    // 等自动弹窗真正挂出来（大 bundle 冷解析会慢过 1s 固定等待，别用 sleep 赌时序）
    try {
        await page.waitForFunction(
            () => {
                const sr = document.getElementById('__znhd_panel_host__');
                if (!sr || !sr.shadowRoot) return false;
                return [...sr.shadowRoot.querySelectorAll('[role="dialog"]')].some((d) =>
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
                dialogs: root ? root.querySelectorAll('[role="dialog"]').length : -1,
                bodyDialogs: document.querySelectorAll('[role="dialog"]').length,
                srHasApp: !!(root && root.querySelector('#app')),
                appChildren: root && root.querySelector('#app') ? root.querySelector('#app').children.length : -1,
                pageErr: report.errors.length,
            };
        });
        await page.screenshot({ path: require('os').tmpdir() + '/znhd-dbg-no-transfer.png' });
        console.log('[dbg-transfer-open] ' + JSON.stringify(dbg));
        throw e;
    }
    await new Promise((r) => setTimeout(r, 300));

    /**
     * 「更多」下拉里点一项：chat 窗口按 shadcn message-scroller 示例收敛为
     * CardHeader 上的一排 icon 按钮（清空 / 更多 / 关闭），文件、配对、设置、
     * 关于都收进了这个 dropdown。菜单本身 Portal 到 shadowRoot（补丁同 Dialog）。
     */
    async function pickMore(label) {
        await page.evaluate(() => {
            const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
            const btn = sr.querySelector('button[aria-label="更多"]');
            if (btn) btn.click();
        });
        await new Promise((r) => setTimeout(r, 300));
        return page.evaluate((text) => {
            const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
            const items = [...sr.querySelectorAll('[data-slot="dropdown-menu-item"]')];
            const it = items.find((n) => n.textContent.includes(text));
            if (!it) return { clicked: false, visible: false, labels: items.map((n) => n.textContent.trim()) };
            // 层级回归（v26.10.18-v8 踩过）：菜单 z-index 一旦低于聊天窗本体就会被盖住，
            // DOM 还在、断言照样绿，但肉眼看到的是「弹窗样式全丢了」。用 elementFromPoint 验真。
            const menu = sr.querySelector('[data-slot="dropdown-menu-content"]');
            // 层级回归（v26.10.18-v8 踩过）：菜单 z-index 一旦低于聊天窗本体（1000011）就会被
            // 整个盖住——DOM 还在、断言照样绿，但肉眼看到的是「弹窗样式全丢了」。直接验 z-index。
            let visible = false;
            if (menu) {
                const r = menu.getBoundingClientRect();
                visible = parseInt(getComputedStyle(menu).zIndex, 10) >= 1000012 && r.width > 100 && r.height > 50;
            }
            it.click();
            return { clicked: true, visible, labels: items.map((n) => n.textContent.trim()) };
        }, label);
    }

    // 自动弹窗：收到内容后窗口应已自己打开（不再点「传输助手」按钮）
    const transfer = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        if (!el) return { found: false, count: dialogs.length };
        const card = el.querySelector('[data-slot="card"]');
        const rect = (card || el).getBoundingClientRect();
        const bubbles = [...el.querySelectorAll('[data-slot="bubble"]')];
        // ⚠️ 排除头像（data-slot="avatar-image"）：它也在 scroller 里，且 DOM 顺序在气泡之前，
        //    不排除会把它当成「收到的图片」，断言 blob: 必然失败。
        const chatImg = el.querySelector('[data-slot="message-scroller"] img:not([data-slot="avatar-image"])');
        const avatarImg = el.querySelector('[data-slot="avatar-image"]');
        const composer = el.querySelector('[data-slot="input-group"]');
        // 我方气泡（data-align=end）的文字色：v9 起要求黑色
        const mineBubble = el.querySelector('[data-slot="bubble"][data-align="end"] [data-slot="bubble-content"]');
        return {
            found: true,
            count: dialogs.length,
            inShadow: sr.contains(el),
            bodyHasDialog: !!document.querySelector('[role="dialog"]'),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 200),
            // Card 外观：与示例同款的三段式卡片（卡片自带底色/圆角/描边）
            hasCard: !!card,
            hasScroller: !!el.querySelector('[data-slot="message-scroller"]'),
            hasComposer: !!(composer && composer.querySelector('textarea')),
            // 头部只剩三个 icon 按钮（清空 / 更多 / 关闭）——不再有图标栏与多栏导航
            headButtons: [...el.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label')),
            background: card ? getComputedStyle(card).backgroundColor : '',
            mineTextColor: mineBubble ? getComputedStyle(mineBubble).color : '',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            // v26.10.19：标题栏与会话区的分界线 —— 1px + 与窗口外框同色 rgb(34,34,34)
            headerBorder: (() => {
                const h = el.querySelector('[data-slot="card-header"]');
                if (!h) return '';
                const s = getComputedStyle(h);
                return s.borderBottomWidth + ' ' + s.borderBottomColor;
            })(),
            // v26.10.19：标题栏按钮 / 输入框按钮 / 滚动到底按钮 —— 统一 28px 圆形
            // ⚠️ 用 offsetWidth（布局尺寸）：滚动到底按钮 inactive 时带 scale-95，rect 会被缩成 26.6px
            // ⚠️ 用 button[aria-label] 而不是 [data-slot="button"]：DropdownMenuTrigger(as-child)
            //    会把 reka 自己的 data-slot="dropdown-menu-trigger" 覆盖上去（「更多」与「+」会漏选）
            headBtnBox: [...el.querySelectorAll('[data-slot="card-header"] button[aria-label]')].map(
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
                ? [...composer.querySelectorAll('button[aria-label]')].map(
                      (b) => b.offsetWidth + 'x' + b.offsetHeight + ' ' + Math.round(parseFloat(getComputedStyle(b).borderRadius))
                  )
                : [],
            scrollerBtnBox: (() => {
                const b = el.querySelector('[data-slot="message-scroller-button"]');
                if (!b) return '';
                return b.offsetWidth + 'x' + b.offsetHeight + ' ' + Math.round(parseFloat(getComputedStyle(b).borderRadius));
            })(),
            // 气泡：文本（对方=muted）+ 图片（ghost）+ Markdown strong
            bubbleVariants: bubbles.map((b) => b.getAttribute('data-variant')),
            boldText: !!el.querySelector('[data-slot="bubble"] strong'),
            chatImgSrc: chatImg ? String(chatImg.src).slice(0, 12) : '',
            // 头像：DiceBear notionists（seed = 设备标识，不是随机数）
            avatarSrc: avatarImg ? String(avatarImg.getAttribute('src') || '') : '',
            chatImgOk: chatImg ? chatImg.naturalWidth > 0 : false,
            chatImgSize: chatImg ? chatImg.naturalWidth + 'x' + chatImg.naturalHeight : '',
            // 卡片下方那行居中提示（示例里 `Demo is read only…` 的位置）
            hint: el.innerText.includes('Enter 发送 · Shift + Enter 换行'),
        };
    });
    report.checks.transferWindowOk =
        !!transfer.found &&
        !!transfer.inShadow &&
        !transfer.bodyHasDialog &&
        transfer.hasCard &&
        transfer.hasScroller &&
        transfer.hasComposer &&
        transfer.background === 'rgb(0, 0, 0)' &&
        // v26.10.19：384 → 768（横向一倍），560 → 672（高度 +20%）
        transfer.width === 768 &&
        transfer.height === 672 &&
        ['清空聊天记录', '更多', '关闭'].every((l) => (transfer.headButtons || []).includes(l));
    // 分界线 = 1px + rgb(34,34,34)（与窗口外框一致）
    report.checks.transferDividerOk = transfer.headerBorder === '1px rgb(34, 34, 34)';
    // 标题栏 3 个 + 输入框 2 个 + 滚动到底 1 个：全是 28px 圆形（rounded-full 计算值 ≈ 3.35e7px）
    const isRound28 = (b) => {
        const m = /(\d+)x(\d+)\s+(\d+)/.exec(String(b));
        return !!m && m[1] === '28' && m[2] === '28' && Number(m[3]) >= 9999;
    };
    report.checks.transferBtnShapeOk =
        transfer.headBtnBox.length === 3 &&
        transfer.headBtnBox.every(isRound28) &&
        transfer.composerBtnBox.length === 2 &&
        transfer.composerBtnBox.every(isRound28) &&
        isRound28(transfer.scrollerBtnBox);
    report.checks.transferChatOk =
        transfer.text.includes('已连接 1 台设备') &&
        transfer.bubbleVariants.includes('muted') &&
        transfer.bubbleVariants.includes('ghost') &&
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
        const ta = sr.querySelector('[data-slot="input-group"] textarea');
        if (!ta) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, '回给手机的一条消息');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 150));
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('[data-slot="input-group"] button[aria-label="发送"]');
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const sent = await page.evaluate(() => window.__sent);
    // 发出后：我方气泡文字应为黑色（v26.10.18-v9）
    const mineColor = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        const b = el && el.querySelector('[data-slot="bubble"][data-align="end"] [data-slot="bubble-content"]');
        return b ? getComputedStyle(b).color : '';
    });
    report.checks.transferSendOk =
        mineColor === 'rgb(0, 0, 0)' &&
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

    // 「全部文件」入口现在在「更多」下拉里
    const filesPick = await pickMore('全部文件');
    await new Promise((r) => setTimeout(r, 400));
    const filesNav = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        return { text: el ? el.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : '' };
    });
    report.checks.transferFilesNavOk =
        !!filesPick.clicked && !!filesPick.visible && filesNav.text.includes('全部文件（图片');
    report.filesNav = filesNav;
    report.filesPick = filesPick;

    // 关掉「全部文件」，再从「更多」进设置（暗色子弹窗：体量/底色/文案）
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 350));
    const settingsPick = await pickMore('设置');
    await new Promise((r) => setTimeout(r, 450));
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
        !!settingsPick.clicked &&
        !!transferSettings.found &&
        !!transferSettings.inShadow &&
        transferSettings.text.includes('传输助手设置') &&
        transferSettings.background === 'rgb(43, 43, 43)' &&
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
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        if (!el) return { found: false };
        const card = el.querySelector('[data-slot="card"]');
        const cards = [...el.querySelectorAll('[data-sniff-card]')];
        const bar = el.querySelector('[data-sniff-excluded]');
        const text = el.innerText.replace(/\s+/g, ' ').trim();
        return {
            found: true,
            inShadow: sr.contains(el),
            width: Math.round(el.getBoundingClientRect().width),
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
    // 冒烟页没有会话上下文 ⇒ 每张图都取不到消息时间 ⇒ 文件名必须全标红、且一个红圈都不许有
    report.checks.sniffNoTimeNameOk =
        sniff.cardCount > 0 &&
        sniff.noTimeFlags.every((f) => f === '1') &&
        sniff.nameColors.length === sniff.cardCount &&
        sniff.nameColors.every((c) => c === 'rgb(255, 77, 79)') &&
        sniff.rings.every((r) => r === '');
    report.sniff = sniff;

    // 展开「大小未知」档：里面应当只剩测不出字节数的那张（夹具里是 .ico / 非图片资源之类），
    // 顺便验证折叠交互与「未知也不丢」这条红线
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        const btn = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('大小未知'));
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 300));
    const sniffUnknown = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        const cards = [...el.querySelectorAll('[data-sniff-card]')];
        return { cardCount: cards.length, alts: cards.map((c) => (c.querySelector('img') || {}).alt || '') };
    });
    report.sniffUnknown = sniffUnknown;
    report.checks.sniffUnknownExpandOk = sniffUnknown.cardCount === 3;
    // 收起，恢复默认折叠态
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
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
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        const btn = el ? [...el.querySelectorAll('button')].find((b) => b.textContent.includes('下载所选')) : null;
        return { label: btn ? btn.textContent.trim() : '', disabled: btn ? btn.disabled : null };
    });
    const pickableTotal = Number((sniff.text.match(/共 (\d+) 张/) || [])[1] || 0);
    report.checks.sniffSelectOk =
        pickableTotal > 0 && sniffSelect.label.includes('（' + pickableTotal + '）') && sniffSelect.disabled === false;
    report.sniffSelect = sniffSelect;

    // 点缩略图 → 全屏预览（Teleport 进 shadowRoot，层级高于弹窗）
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('[role="dialog"]')];
        const el = dialogs[dialogs.length - 1];
        const img = el ? el.querySelector('[data-sniff-card] img') : null;
        if (img) img.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const sniffPreview = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const close = sr.querySelector('[aria-label="关闭预览"]');
        return {
            open: !!close,
            inShadow: close ? sr.contains(close) : false,
            hasPrint: !!sr.querySelector('[aria-label="打印"]'),
            counter: (() => {
                const n = [...sr.querySelectorAll('span')].find((x) => /^\d+ \/ \d+$/.test(x.textContent.trim()));
                return n ? n.textContent.trim() : '';
            })(),
        };
    });
    report.checks.sniffPreviewOk = sniffPreview.open && sniffPreview.inShadow && sniffPreview.hasPrint;
    report.sniffPreview = sniffPreview;
    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-sniff-preview.png') });

    // 关预览 + 关嗅探弹窗
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));

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
