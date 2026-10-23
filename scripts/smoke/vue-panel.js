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
// 常用语快捷按钮（v26.10.23）要把规则缓存在 GM 存储里，所以桩必须真的能存能取
window.__store = {};
window.GM_getValue = function (k, d) { return Object.prototype.hasOwnProperty.call(window.__store, k) ? window.__store[k] : d; };
window.GM_setValue = function (k, v) { window.__store[k] = v; };
// 预置一份**未过期**的规则缓存：lib/feishu/service.ts 的 getRules 见缓存新鲜就直接返回，
// 于是匹配链路可以完全不联网地跑通（冒烟环境既没有授权也没有真实接口）。
// 三条规则的用意：A 命中、B 被排除词拦掉、C 压根没命中 —— 一次点击同时验证「命中」与「排除优先」。
// 值必须是 JSON 字符串（credentials.ts 用 JSON.parse 读），否则测不到真实存储形态。
window.__store['scriptCat_QuickReplyRules'] = JSON.stringify({
  fetchedAt: Date.now(),
  rules: [
    { id: 'rec-qr-A', title: '非正常户解除', keywords: ['解非', '非正常户'], excludes: [], reply: '教程链接：https://example.invalid/tutorial' },
    { id: 'rec-qr-B', title: '申报期提醒', keywords: ['申报'], excludes: ['已申报'], reply: '申报期提醒文案' },
    { id: 'rec-qr-C', title: '注销流程', keywords: ['注销'], excludes: [], reply: '注销流程文案' }
  ]
});
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
<!-- 站点导航条夹具（v26.10.21-v4）：标题栏注入控件的挂载锚点（.nav-bar-main） -->
<div id="host-navbar" style="background:#185FA5;height:56px;display:flex;align-items:center;padding:0 16px;">
  <span style="color:#fff;font-size:16px;">征纳互动</span>
  <div class="nav-bar-main" style="display:flex;align-items:center;margin-left:24px;">
    <a style="color:#fff;padding:0 12px;">工作台</a>
    <a style="color:#fff;padding:0 12px;">业务管理</a>
  </div>
</div>
<!-- 图片嗅探夹具：两张 > 20KB（应出现在结果里）、一张 2KB（应被阈值过滤）、一张 .svg（应被后缀规则排除）
     + 一张跨域图（perf 档拿不到跨域字节数 + GM 桩 HEAD 失败 ⇒ 落「大小未知」档；
     v26.10.21-v5 前这个角色由主面板标题栏的品牌图 favicon.ico 扮演，面板删除后改为夹具直供） -->
<div id="host-images">
  <img src="/img/photo-a.jpg" alt="photo-a.jpg" width="240" height="160">
  <img src="/img/photo-b.jpg" alt="photo-b.jpg" width="240" height="160">
  <img src="/img/tiny.jpg" alt="tiny.jpg" width="60" height="60">
  <img src="/img/icon-set.svg" alt="icon-set.svg" width="24" height="24">
  <img src="https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico" alt="favicon.ico" width="16" height="16">
</div>
<!-- 图片右键菜单夹具（v26.10.22-v6）：模拟站点 ImageItem 的 v-contextmenu
     （直挂 body、4 项、含「转存到内网」识别锚点、首项带 data-v-* 作用域属性）。
     断言看脚本是否在尾部注入了同款样式的「打印」项 —— 识别按文本，不依赖 Vue。 -->
<ul class="content-menu v-contextmenu v-contextmenu--default" id="fake-img-menu" style="display:none">
  <li data-v-smoke0="" class="v-contextmenu-item"><span class="menu-text">复制</span></li>
  <li class="v-contextmenu-item"><span class="menu-text">下载到本地</span></li>
  <li class="v-contextmenu-item"><span class="menu-text">转存到内网</span></li>
  <li class="v-contextmenu-item"><span class="menu-text">多选转存内网</span></li>
</ul>
<!-- ===== 常用语快捷按钮夹具（v26.10.23）=====
     快捷回复按钮条挂在 **Inputbox 组件根元素之前**（v26.10.23-v2：= 输入区含工具栏的
     外面上方）。真实结构是 Inputbox 根元素里包含工具栏 + TinyMCE 挂载点（.input-tinymce），
     这里只放一个空壳 #smoke-composer，具体的输入区 DOM 与 .input-tinymce.__vue__.$parent
     桩由 /qr-fixtures.js 在脚本加载前同步造好（挂载发生在 znhd.user.js 加载后的 1s 轮询里，
     __vue__ 桩必须先就位）。
     ⚠️ 本段在内联 HTML 的模板字符串里：注释与属性值中**一律不许出现反引号**，
        否则会提前结束模板字符串（本次踩过，报 tinymce is not defined）。
     夹具逻辑在 /qr-fixtures.js（独立文件，避免正则被模板字符串二次转义）。 -->
<div id="smoke-composer"></div>
<script src="/qr-fixtures.js"></script>
<script src="/znhd.user.js"></script></body></html>`;

function serve() {
    const server = http.createServer((req, res) => {
        if (req.url === '/qr-fixtures.js') {
            res.writeHead(200, { 'content-type': 'application/javascript' });
            res.end(fs.readFileSync(path.join(__dirname, 'qr-fixtures.js')));
            return;
        }
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
    // v26.10.21-v9 回归守门：主题 primary 必须等于品牌蓝 --znhd-brand。
    // v8 只覆写 :host 时，daisyUI 主题块的 [data-theme=cupcake] 分支直接命中 #app
    // 声明官方薄荷绿（自身声明 > host 继承），探针读到薄荷绿而断言全绿 —— 探针恰好
    // 也挂在 #app 里，两边同源自洽。此断言钉死实色，再覆写失效立刻红。
    const brandPrimary = await probeOf('--color-primary');
    report.checks.primaryIsBrand = brandPrimary === 'rgb(66, 133, 244)';
    // 守门：Tailwind v4 的 @property 在 shadowRoot 内不生效（Chromium 只处理文档级），
    // main.ts 用 CSS.registerProperty 重新注册 —— 这里验证 --tw-border-style 真有初值，
    // 否则 shadow DOM 里所有 border-* 工具类会静默退化成 0px（v26.10.19 实测踩过）。
    // v26.10.21-v5 面板壳已删：临时塞一个带 border 类的探针元素来量。
    report.checks.twPropsRegistered = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const app = sr.querySelector('#app');
        const probe = document.createElement('div');
        probe.className = 'border border-base-300';
        app.appendChild(probe);
        const ok = getComputedStyle(probe).getPropertyValue('--tw-border-style') === 'solid';
        probe.remove();
        return ok;
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
    // v26.10.21-v5：主面板已删 —— 面板宿主常态无可见文本（只剩关闭态弹窗）；
    // 版本徽标迁到导航条（见下方 nav.versionText）。
    report.checks.panelTextOk = panel.text.trim() === '';
    report.panel = panel;

    await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-vue-panel.png') });

    // ---------- 标题栏注入控件（v26.10.21-v4/v5）：挂载 / 按钮清单 / 语音开关接力 / 版本 ----------
    const nav = await page.evaluate(() => {
        const host = document.getElementById('__znhd_nav_host__');
        const sr = host && host.shadowRoot;
        if (!host || !sr) return { mounted: false };
        const r = host.getBoundingClientRect();
        const box = sr.querySelector('input[type="checkbox"]');
        return {
            mounted: host.isConnected,
            // 首选锚点 = 菜单父级（host 与菜单互为兄弟）；回退锚点 = 菜单内部。
            // 两种都算「挂对了位置」：父级里能查到 .nav-bar-main 即可。
            inNavBar:
                !!host.closest('.nav-bar-main') ||
                !!(host.parentElement && host.parentElement.querySelector('.nav-bar-main')),
            visible: r.width > 0 && r.height > 0 && r.right <= window.innerWidth,
            btnTitles: [...sr.querySelectorAll('button[title]')].map((b) => b.title),
            hasVoiceBox: !!box,
            voiceChecked: !!(box && box.checked),
            // v26.10.21-v5：版本徽标迁到导航条（原主面板标题栏已删）
            versionText: (sr.querySelector('#app') || sr).innerText.replace(/\s+/g, ' ').trim(),
            // 分割线：业务管理右侧、语音|按钮、按钮|版本号（共 3 条，w=1px）
            dividers: [...sr.querySelectorAll('#app span')].filter(
                (n) => Math.round(n.getBoundingClientRect().width) === 1
            ).length,
        };
    });
    report.nav = nav;
    report.checks.navMountedOk = nav.mounted && nav.inNavBar && nav.visible;
    report.checks.navButtonsOk =
        JSON.stringify(nav.btnTitles) === JSON.stringify(['设置', '常用语', '传输助手', '图片嗅探']) &&
        nav.hasVoiceBox;
    report.checks.versionOk = nav.versionText.includes('v' + SCRIPT_VERSION);
    report.checks.navDividersOk = nav.dividers === 3;

    // 语音开关接力：标题栏点开关 → 总线回调 toggleVoice → allvalue → 状态回流勾选框。
    // 默认 voiceEnabled=true ⇒ 首次点击 = 关；断言「勾选态翻转后能点回原态」。
    report.checks.navVoiceOk = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_nav_host__').shadowRoot;
        const box = sr && sr.querySelector('input[type="checkbox"]');
        if (!box) return false;
        const before = box.checked;
        box.click();
        return new Promise((resolve) => {
            setTimeout(() => {
                const flipped = box.checked !== before;
                box.click(); // 点回去，结束态与初始一致
                setTimeout(() => resolve(flipped && box.checked === before), 200);
            }, 300);
        });
    });

    // 点导航条上的「设置」→ 弹窗仍应出现在**主面板**的 shadowRoot 里（跨实例总线）
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_nav_host__').shadowRoot;
        const btn = [...sr.querySelectorAll('button[title]')].find((b) => b.title === '设置');
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
            // v26.10.21-v4：功能入口已迁导航条 —— 先按 title 在导航条 host 里找；
            // 找不到再退回面板 shadow 按可见文本找（弹窗内的「运行日志/更新日志」等仍在面板里）
            const navSr = document.getElementById('__znhd_nav_host__')?.shadowRoot;
            let el = navSr
                ? [...navSr.querySelectorAll('button[title]')].find((b) => b.title === t)
                : null;
            if (!el) {
                const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
                el = [...sr.querySelectorAll('button, a, [role="button"]')].find((b) =>
                    b.textContent.replace(/\s+/g, '').includes(t)
                );
            }
            if (el) el.click();
        }, text);
        await new Promise((r) => setTimeout(r, 500));
    };

    await closeTopLayer(); // 关掉设置弹窗

    // 日志弹窗：入口在设置弹窗里（v26.10.21-v5 主面板已删，原「查看日志」面板按钮删除）。
    // 打开设置 → 点「运行日志」→ 日志弹窗叠加在设置之上（取最后一个 dialog）。
    await clickPanelText('设置');
    await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
        const btn = [...(el ? el.querySelectorAll('button') : [])].find((b) => b.textContent.includes('运行日志'));
        if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 400));
    const logDialog = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const dialogs = [...sr.querySelectorAll('dialog[open]')];
        const el = dialogs[dialogs.length - 1];
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

    /**
     * 筛选行为（v26.10.20-v24 修 bug 后补）—— 此前 `allMode = !every(...)` 取反，
     * 勾类型后仍判定「全部」→ 列表不过滤，且「全部」与四类不联动。四步全链验证：
     *  ① 初始四类全选、「全部」选中；
     *  ② 取消「信息」→ 显示条数变少、「全部」自动取消；
     *  ③ 非全选点「全部」→ 四类补齐；
     *  ④ 全选态再点「全部」→ 四类全取消、显示 0 条。
     */
    const filterState = () =>
        page.evaluate(() => {
            const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
            // v26.10.21-v5：日志弹窗叠在设置弹窗之上，不能取第一个 dialog —— 直接按筛选条定位
            const bar = sr.querySelector('dialog[open] [data-log-filter]');
            if (!bar) return null;
            const el = bar.closest('dialog');
            const status = [...el.querySelectorAll('span')]
                .map((s) => s.textContent || '')
                .find((t) => t.includes('共'));
            return {
                all: bar.querySelector('button[aria-pressed]').getAttribute('aria-pressed'),
                boxes: [...bar.querySelectorAll('input[type="checkbox"]')].map((b) => b.checked),
                shown: Number((status || '').match(/显示\s*(\d+)/)?.[1] ?? -1),
            };
        });
    const clickFilter = async (sel) => {
        await page.evaluate((s) => {
            const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
            sr.querySelector('dialog[open] [data-log-filter] ' + s).click();
        }, sel);
        await new Promise((r) => setTimeout(r, 300));
    };
    const f0 = await filterState();
    await clickFilter('input[type="checkbox"]');
    const f1 = await filterState();
    await clickFilter('button[aria-pressed]');
    const f2 = await filterState();
    await clickFilter('button[aria-pressed]');
    const f3 = await filterState();

    report.checks.logFilterOk =
        f0.all === 'true' &&
        f0.boxes.every(Boolean) &&
        f1.all === 'false' &&
        f1.boxes[0] === false &&
        f1.shown < f0.shown &&
        f2.all === 'true' &&
        f2.boxes.every(Boolean) &&
        f2.shown === f0.shown &&
        f3.all === 'false' &&
        f3.boxes.every((b) => !b) &&
        f3.shown === 0;
    report.logFilter = { f0, f1, f2, f3 };

    // 日志与设置两层弹窗都关掉（v26.10.21-v5：日志从设置里打开，多了一层）
    await closeTopLayer();
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
        // 切换栏几何（v26.10.21-v3）：tab 高被压到 32（容器 40），且与下方卡片留 12px
        const tablist = el.querySelector('[role="tablist"]');
        const tabsEls = tablist ? [...tablist.querySelectorAll('input')] : [];
        const card = el.querySelector('[data-znhd="phrase-card"]');
        return {
            found: true,
            inShadow: sr.contains(el),
            bodyHasDialog: !!document.querySelector('dialog[open]'),
            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 60),
            width: Math.round(rect.width),
            background: box ? getComputedStyle(box).backgroundColor : '',
            right: Math.round(window.innerWidth - rect.right),
            placeholder: input ? input.placeholder : '',
            tablistH: tablist ? Math.round(tablist.getBoundingClientRect().height) : -1,
            tabH: tabsEls.length ? Math.round(tabsEls[0].getBoundingClientRect().height) : -1,
            gapTabsToCard:
                tablist && card
                    ? Math.round(
                          card.getBoundingClientRect().top - tablist.getBoundingClientRect().bottom
                      )
                    : -1,
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
    // 切换栏：高度压到 32（整条 ≤ 42，别又回到默认 48）+ 与卡片至少 8px 间隙（原本紧贴 0）
    report.checks.phrasesTabsGeomOk =
        phrasesSheet.tabH >= 30 &&
        phrasesSheet.tabH <= 34 &&
        phrasesSheet.tablistH >= 36 &&
        phrasesSheet.tablistH <= 42 &&
        phrasesSheet.gapTabsToCard >= 8 &&
        phrasesSheet.gapTabsToCard <= 20;
    report.phrasesSheet = phrasesSheet;

    // 话术改成卡片（v26.10.21-v2，方案 C1）：三行截断 + 悬浮提示不被弹层裁掉
    //  · 截断：内层 span line-clamp-3（不再钉死 h-10 —— 卡片高度随行数变化）
    //  · 卡片身份：卡面底色必须 ≠ 弹层底色（base-200 vs base-100，夜间靠这个明度差分层次），
    //    圆角 ≥ 8px，四边内边距对称（竖条方案已否掉，别再出现左内边距偏大的卡片）
    //  · 提示：浮层必须是 dialog 直接子节点（在 .modal-box 外面）。曾经用 daisyUI 的
    //    tooltip+data-tip，伪元素落在 modal-box 里被 overflow-y:auto 裁掉大半。
    const rowPoint = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('dialog[open] .modal-box [data-znhd="phrase-card"]');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (rowPoint) {
        await page.mouse.move(rowPoint.x, rowPoint.y);
        await new Promise((r) => setTimeout(r, 150));
        // ⚠️ 等底色稳定再读（v26.10.22-v2）：卡片带 `transition-colors`（150ms），
        //    慢环境死等固定毫秒会读到过渡中的值。
        //    （v26.10.22-v3 修正注释：v2 曾以为 CI 假红是过渡没走完，实测 CI 里
        //    hoverBg 稳定等于 cardBg —— 是 Linux 无头 Chrome 154 的 `:hover`
        //    伪类不跟随 CDP 鼠标事件（mouseenter 等 JS 层事件正常触发，见
        //    phrasesTipOk: true），与过渡无关。等稳定这段保留，无害。）
        await page.waitForFunction(
            () =>
                new Promise((resolve) => {
                    const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
                    const readBg = () => {
                        const b = sr.querySelector('[data-znhd="phrase-card"]');
                        return b ? getComputedStyle(b).backgroundColor : '';
                    };
                    const v1 = readBg();
                    setTimeout(() => resolve(readBg() === v1), 100);
                }),
            { timeout: 5000 }
        );
    }
    const phraseLayout = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const el = sr.querySelector('dialog[open]');
        const box = el && el.querySelector('.modal-box');
        if (!box) return { found: false };
        const btns = [...box.querySelectorAll('[data-znhd="phrase-card"]')];
        const tip = el.querySelector('[data-znhd="phrase-tip"]');
        const boxRect = box.getBoundingClientRect();
        const tr = tip ? tip.getBoundingClientRect() : null;
        // 诊断（v26.10.22-v3）：CI Linux 无头 Chrome 上 `:hover` 伪类疑似不跟随
        // CDP 鼠标事件，这里记录现场 —— hover/pointer 媒体查询结果 + 指针落点的
        // 命中测试（sr.elementFromPoint）+ 卡片实时矩形，不参与判定。
        const b0 = btns[0];
        const r0 = b0 ? b0.getBoundingClientRect() : null;
        const px = r0 ? Math.round(r0.left + r0.width / 2) : 0;
        const py = r0 ? Math.round(r0.top + r0.height / 2) : 0;
        const hit = sr.elementFromPoint ? sr.elementFromPoint(px, py) : null;
        const hoverDiag = {
            hoverMedia: matchMedia('(hover: hover)').matches,
            pointerFine: matchMedia('(pointer: fine)').matches,
            hitAtCardCenter: hit
                ? (hit.getAttribute && hit.getAttribute('data-znhd')) || hit.tagName
                : null,
            cardRectAtRead: r0
                ? {
                      x: px,
                      y: py,
                      top: Math.round(r0.top),
                      bottom: Math.round(r0.bottom),
                  }
                : null,
        };
        return {
            found: true,
            hoverDiag,
            rows: btns.length,
            heights: btns.map((b) => Math.round(b.getBoundingClientRect().height)),
            clamps: btns.map((b) => {
                const s = b.querySelector('span.line-clamp-3');
                return s ? getComputedStyle(s).webkitLineClamp : '';
            }),
            radii: btns.map((b) => Math.round(parseFloat(getComputedStyle(b).borderRadius) || 0)),
            // 四边内边距：竖条方案会写成 pl-4/pr-3（左右不等）⇒ 这里必须对称
            pads: btns.map((b) => {
                const cs = getComputedStyle(b);
                return [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map((v) =>
                    Math.round(parseFloat(v) || 0)
                );
            }),
            hasBar: btns.some((b) => !!b.querySelector('[data-znhd="phrase-card-bar"]')),
            // ⚠️ 底色必须量**没被悬停**的那张卡：第 1 张此刻正被鼠标压着（为了触发提示），
            //    读到的是 hover:bg-base-300 的颜色 ⇒ 曾让「卡面=弹层底色」的坏样式假绿。
            cardBg: btns.length ? getComputedStyle(btns[btns.length - 1]).backgroundColor : '',
            hoverBg: btns[0] ? getComputedStyle(btns[0]).backgroundColor : '',
            boxBg: getComputedStyle(box).backgroundColor,
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
        phraseLayout.heights.every((h) => h >= 44) &&
        phraseLayout.clamps.every((c) => c === '3');
    // 卡片身份（夜间能不能看出条目边界，全靠这三点）
    //  · 常态卡面底色 ≠ 弹层底色 ⇒ base-200 vs base-100 的明度差真的生效
    //  · 内边距四边相等（竖条方案曾用 pl-4/pr-3）+ 不再有竖条元素
    //  ⚠️ 「悬停底色抬一档」从本断言里拆出去了（v26.10.22-v3）：CI Linux 无头
    //     Chrome 的 `:hover` 伪类不跟随 CDP 鼠标事件（JS 层 mouseenter 正常、
    //     提示浮层能弹出，但 hoverBg 永远停在 base-200），环境差异导致假红。
    report.checks.phrasesCardOk =
        !!phraseLayout.found &&
        phraseLayout.radii.every((r) => r >= 8) &&
        phraseLayout.pads.every(([t, r, b, l]) => t === r && r === b && b === l && t >= 10) &&
        phraseLayout.hasBar === false &&
        !!phraseLayout.cardBg &&
        phraseLayout.cardBg !== phraseLayout.boxBg;
    // 悬停抬色（v26.10.22-v3，环境无关）：真实环境里 hover 后 btns[0] 底色应抬到
    // base-300；CI 无头里 `:hover` 不生效（见 phrasesCardOk 注释），退而验证
    // 「`.hover\:bg-base-300:hover` 规则真的在样式表里 + 卡片类名没丢」——
    // 这两样丢了，任何环境都该红；规则在但伪类不生效只是无头环境限制，不红。
    const hoverApplied = phraseLayout.hoverBg !== phraseLayout.cardBg;
    const hoverRuleOk = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const btn = sr.querySelector('[data-znhd="phrase-card"]');
        if (!btn) return false;
        const hasClass = [...btn.classList].some((c) => c.replace(/[^a-z0-9-]/gi, '') === 'hoverbg-base-300');
        const found = (rules) => {
            for (const r of rules) {
                // CSSOM 对转义符的序列化可能带反斜杠（.hover\:bg-…）也可能换写法，
                // 统一剥掉反斜杠再比，宽松匹配
                const sel = r.selectorText ? r.selectorText.replace(/\\/g, '') : '';
                if (sel.includes('hover:bg-base-300:hover')) return true;
                if (r.cssRules && found(r.cssRules)) return true;
            }
            return false;
        };
        const sheets = [
            ...(sr.adoptedStyleSheets || []),
            ...document.styleSheets,
            // ⚠️ 脚本 CSS 是 GM_addStyle 注进 shadow root 内部的 <style>，
            //    不在 adoptedStyleSheets / document.styleSheets 里，要从元素拿 sheet
            ...[...sr.querySelectorAll('style')].map((s) => s.sheet).filter(Boolean),
        ];
        return hasClass && sheets.some((s) => {
            try {
                return found(s.cssRules);
            } catch {
                return false;
            }
        });
    });
    report.checks.phrasesHoverOk = hoverApplied || hoverRuleOk;
    report.hover = { applied: hoverApplied, ruleOk: hoverRuleOk };
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
        // 冒烟钉的是日间（prefers-color-scheme=light）；v26.10.21-v5 起夜间模式已删，恒为日间
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
        // v26.10.22-v4：同轮多条气泡必须各占一行。daisyUI 的 .chat-bubble 是 grid-row-end:3，
        // 直接并列会全部落在同一格 → 后画的盖住前面的（用户看到「连发两张图只剩最后一张」）。
        const rects = bubbles
            .map((b) => {
                const r = b.getBoundingClientRect();
                return { top: r.top, bottom: r.bottom };
            })
            .sort((a, b) => a.top - b.top);
        let stacked = rects.length >= 2;
        for (let i = 1; i < rects.length; i++) {
            if (rects[i].top < rects[i - 1].bottom - 0.5) stacked = false;
        }
        return {
            bubbleW: last ? last.offsetWidth : 0,
            bubbleH: last ? last.offsetHeight : 0,
            scrollerW: scroller ? scroller.clientWidth : 0,
            hOverflow: scroller ? scroller.scrollWidth > scroller.clientWidth : null,
            bubbleCount: bubbles.length,
            stacked: stacked,
        };
    });
    report.wrapProbe = wrapProbe;
    // 纯长 token（不可断词最坏场景）也必须被关进气泡里
    report.checks.bubbleWrapOk = wrapProbe.bubbleW > 100 && wrapProbe.hOverflow === false;
    // 连发两条 → 两条气泡不重叠
    report.checks.bubblesStackOk = wrapProbe.bubbleCount >= 2 && wrapProbe.stacked;

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
        const sr = document.getElementById('__znhd_nav_host__')?.shadowRoot;
        const btn = [...(sr?.querySelectorAll('button[title]') || [])].find((b) => b.title === '图片嗅探');
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

    // ---------- 主题：v26.10.21-v7 起恒为日间 cupcake ----------
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));

    const themeFixed = await page.evaluate(() => {
        const sr = document.getElementById('__znhd_panel_host__').shadowRoot;
        const app = sr.querySelector('#app');
        return {
            // daisyUI 迁移后 data-theme 挂在影子树内的 #app 上
            //（属性选择器穿不透 shadow 边界，不能挂宿主元素）
            appTheme: app ? app.dataset.theme || '' : '',
            dark: app ? app.classList.contains('dark') : false,
            // 主题切换 swap 已随夜间模式删除，影子树里不允许再出现 theme-controller
            swapGone: !sr.querySelector('input.theme-controller'),
        };
    });
    report.theme = themeFixed;
    report.checks.themeFixedLightOk =
        themeFixed.appTheme === 'cupcake' && !themeFixed.dark && themeFixed.swapGone;

    // ---------- 图片右键菜单注入「打印」（v26.10.22-v6） ----------
    // 夹具 = HTML 里的 #fake-img-menu（模拟站点 ImageItem 的 v-contextmenu）。
    // 脚本启动时扫描 body 下的 ul.v-contextmenu，按文本识别图片菜单后在尾部注入
    // 与原生项同款样式的「打印」项。这里只验「注入 + 结构同构」，不点击
    // （点击会真调 printA4Image 弹打印对话框，冒烟环境不碰）。
    // v26.10.23-v6 加 hover 断言：库的悬浮底色是 JS 切 `v-contextmenu-item--hover`
    // class（不是 CSS :hover），注入项必须自己也切换 —— 站点蓝色底就挂在这个 class。
    const printMenu = await page.evaluate(() => {
        const ul = document.getElementById('fake-img-menu');
        const li = ul ? ul.querySelector('li[data-znhd-print]') : null;
        const first = ul ? ul.querySelector('li') : null;
        const scopes = (el) =>
            el ? [...el.attributes].filter((a) => a.name.indexOf('data-v-') === 0).map((a) => a.name) : [];
        let hoverOn = false;
        let hoverOff = false;
        if (li) {
            li.dispatchEvent(new MouseEvent('mouseenter'));
            hoverOn = li.className.indexOf('v-contextmenu-item--hover') >= 0;
            li.dispatchEvent(new MouseEvent('mouseleave'));
            hoverOff = li.className.indexOf('v-contextmenu-item--hover') < 0;
        }
        return {
            injected: !!li,
            text: li ? (li.textContent || '').trim() : '',
            // 作用域属性必须从原生项继承（样式全靠它命中站点 scoped CSS）
            scopeOk: !!li && scopes(li).length > 0 && scopes(li).every((n) => scopes(first).includes(n)),
            // 必须在尾部（排在原生四项之后，观感即「菜单最后多一项」）
            atTail: !!li && ul.lastElementChild === li,
            clsOk: !!li && li.className.indexOf('v-contextmenu-item') >= 0,
            hoverOk: hoverOn && hoverOff,
        };
    });
    report.printMenu = printMenu;
    report.checks.printMenuOk =
        printMenu.injected &&
        printMenu.text === '打印' &&
        printMenu.scopeOk &&
        printMenu.atTail &&
        printMenu.clsOk &&
        printMenu.hoverOk;

    // ---------- 常用语快捷按钮（v26.10.23） ----------
    // 页面内夹具在 33500ms 装、37500ms 采样（见 HTML 末尾的 __installQuickReplyFixtures）。
    // 这里等到采样完成再读：整个用例跑得快时 __qrSnap 可能还没生成。
    await page.waitForFunction('window.__qrSnap != null', { timeout: 90000 }).catch(() => {});
    const qr = await page.evaluate(() => window.__qrSnap || null);
    report.quickReply = qr;
    // 「只在命中时显示、且排除词优先」+「挂载位置在输入框之前」+「不越出容器」
    report.checks.quickReplyBarOk = !!(
        qr &&
        qr.mounted &&
        qr.inComposer &&
        qr.beforeInput &&
        qr.barPresent &&
        qr.labels.length === 1 &&
        qr.labels[0] === '非正常户解除'
    );
    // 点按钮后：输入框文本被**整体替换**（不是追加），且 setContent 之后同步进了 Inputbox
    report.checks.quickReplyReplaceOk = !!(
        qr && qr.afterClickText === '教程链接：https://example.invalid/tutorial' && qr.synced
    );

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
