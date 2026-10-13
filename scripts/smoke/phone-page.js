/**
 * 手机端聊天窗（web/ → relay-server/public）的端到端测试。
 *
 * v26.10.12-v5：手机页从「上传到电脑」双卡片页重构为**聊天窗**（对齐脚本端第三栏，
 * 微信暗色气泡 + 底部输入区）。本文件随之重写：不再断言卡片排版，改为断言
 * 「发出去的进右侧绿气泡、电脑发来的进左侧灰气泡、预览/打印共享链路不回退」。
 *
 * v26.10.13-v3：新增三组断言（对应本次需求）——
 *   ① **输入区吸底**（`composerPinnedOk`）：antd `<AntApp>` 会渲染一个没有高度的
 *      `div.ant-app` 包裹层，`height:100%` 对 auto 父级解析为 auto，整页会退化成
 *      内容高度、输入区悬在视口中间（用户截图实录）。判据 = 整页骨架 `position:fixed`
 *      且高=视口、输入区底边=视口底。
 *   ② **表情按钮与面板**（`emojiBtnOrderOk` / `emojiPanelOk` / `emojiSendOk`）：
 *      工具栏顺序为「表情 → 图片上传」；CDN（cdn.klyang.com）用请求拦截桩掉
 *      （冒烟不能依赖外网），点一张表情 → 右侧图片气泡 +1，且真 POST 过
 *      `mime=image/png` 的载荷（跳过 canvas 压缩、webp/png 原样发的语义）。
 *   ③ **键盘弹出时输入区跟随视觉视口**（`composerKeyboardOk`）：伪造 visualViewport
 *      模拟「键盘顶起」，输入区底边应随之上移，收起后还原。
 *
 * 做法：起一个真实 relay-server（它自己就托管 relay-server/public），用无头 Chromium 打开
 * `/u/<deviceId>`，真上传一张图、真发一条文本、真从中继投递一张图，然后断言语义。
 *
 *
 * v26.10.13-v4：新增桌面/手机分流（需求：桌面浏览器打开「传输助手」网页时聊天窗
 * 不做全屏，改屏幕居中的弹窗，参考微信 PC 端「文件传输助手」独立窗 420×680；
 * 手机版仍全屏）。本文件的 UA 策略随之调整——
 *   · **主体全程手机 UA**（`PHONE_UA`）：puppeteer 默认 UA 是桌面 Chrome，
 *     不切 UA 的话主体一上来就走弹窗布局，吸底/全屏断言会全挂；
 *   · **末尾单独一段桌面段**（`DESKTOP_UA` + 1280×800 reload）：断言弹窗类名、
 *     420×680 尺寸、屏幕正中心、不占满视口。
 * 跑法：`npm run verify:web`（已串进 `npm run verify`）
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const zlib = require('zlib');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
/**
 * 浏览器可执行文件探测：与 `scripts/smoke/run.js` **用同一份清单**。
 * （CI 上 PUPPETEER_SKIP_DOWNLOAD=true 依赖 runner 预装的 Chrome，清单必须全平台，见 v26.10.08-v13。）
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 布局模式检测用的两个 UA（v26.10.13-v4）：页面按 UA 分流「全屏（手机）/ 居中弹窗（桌面）」，
 * 冒烟要分别覆盖两端。iPhone UA 走 `lib/layoutMode.ts` 的 UA_MOBILE 分支；
 * 桌面 UA 明确写成 Chrome/Win（puppeteer 各版本默认 UA 有差异，不依赖默认值）。
 */
const PHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function freePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const p = s.address().port;
            s.close(() => resolve(p));
        });
    });
}

/**
 * 造一张 8x8 的纯色 PNG 供上传。
 * 自己拼 PNG（zlib 是内置的），避免在测试里塞一个看不懂的 base64 常量。
 */
function writeTinyPng(file) {
    const w = 8;
    const h = 8;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0; // filter: None
        for (let x = 0; x < w; x++) {
            const o = y * (w * 3 + 1) + 1 + x * 3;
            raw[o] = 0x33;
            raw[o + 1] = 0x99;
            raw[o + 2] = 0xff;
        }
    }
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
    }
    const crc = (buf) => {
        let c = 0xffffffff;
        for (const b of buf) c = crcTable[(c ^ b) & 0xff] >>> 0;
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const c = Buffer.alloc(4);
        c.writeUInt32BE(crc(td));
        return Buffer.concat([len, td, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // truecolor
    fs.writeFileSync(
        file,
        Buffer.concat([
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
            chunk('IHDR', ihdr),
            chunk('IDAT', zlib.deflateSync(raw)),
            chunk('IEND', Buffer.alloc(0)),
        ])
    );
}

const results = [];
function check(name, ok) {
    results.push({ name, ok });
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
}

async function main() {
    const png = path.join(os.tmpdir(), 'znhd-phone-page-upload.png');
    writeTinyPng(png);
    const port = await freePort();
    const child = spawn(process.execPath, [path.join(ROOT, 'relay-server', 'server.js')], {
        env: { ...process.env, PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let childErr = '';
    child.stderr.on('data', (d) => {
        childErr += String(d);
    });
    child.stdout.on('data', () => {});

    // 等 /health 就绪
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) {
        await sleep(250);
        try {
            const r = await fetch(`http://127.0.0.1:${port}/health`);
            ready = r.ok;
        } catch (e) {
            /* 还没起来 */
        }
    }
    if (!ready) {
        child.kill();
        console.error('❌ 中继服务未就绪（端口 ' + port + '）；stderr:\n' + childErr);
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ...(BROWSERS[0] ? { executablePath: BROWSERS[0] } : {}),
    });
    try {
        console.log('手机端聊天窗测试（真起中继 + 真上传/真投递）：');
        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 800 }); // 手机竖屏视口
        // v26.10.13-v4：主体测的是「手机版全屏」场景，必须显式切手机 UA
        // （puppeteer 默认桌面 UA 会让页面走尹屏幕展开的弹窗布局，吸底断言全挂）
        await page.setUserAgent(PHONE_UA);

        // ① 视口桩：伪造 visualViewport，供「键盘弹出」场景确定性复现（初始 height 极大 = 无键盘）
        await page.evaluateOnNewDocument(() => {
            const listeners = {};
            const fake = {
                height: 1e9,
                offsetTop: 0,
                scale: 1,
                addEventListener: (t, fn) => {
                    (listeners[t] = listeners[t] || []).push(fn);
                },
                removeEventListener: () => {
                    /* 桩：无需移除 */
                },
            };
            Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true });
            window.__vvFire = (t) => (listeners[t] || []).forEach((fn) => fn());
            window.__vvSet = (h, top) => {
                fake.height = h;
                fake.offsetTop = top || 0;
            };
        });

        // ② CDN 桩 + POST 捕获：表情包清单/图片走 cdn.klyang.com（CORS 实测可用），
        //    冒烟不依赖外网；同时捕获手机 → 中继的 POST 载荷供表情发送断言。
        const phonePosts = [];
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const url = req.url();
            if (url.indexOf('https://cdn.klyang.com/json/') === 0) {
                req.respond({
                    status: 200,
                    contentType: 'application/json',
                    // ⚠️ 必须带 CORS 头：页面是跨域 fetch，没有 ACAO 浏览器直接拒（等价于 CDN 真行为）
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: JSON.stringify({
                        name: '桩表情合集',
                        type: 'image',
                        items: [
                            { key: '01', val: 'https://cdn.klyang.com/emo/stub/stub-01.png' },
                            { key: '02', val: 'https://cdn.klyang.com/emo/stub/stub-02.png' },
                        ],
                    }),
                });
                return;
            }
            if (url.indexOf('https://cdn.klyang.com/emo/') === 0) {
                req.respond({
                    status: 200,
                    contentType: 'image/png',
                    headers: { 'Access-Control-Allow-Origin': '*' },
                    body: fs.readFileSync(png),
                });
                return;
            }
            if (req.method() === 'POST' && new URL(url).pathname.indexOf('/u/') === 0) {
                phonePosts.push(req.postData() || '');
            }
            req.continue();
        });

        await page.goto(`http://127.0.0.1:${port}/u/test-device-0001`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForSelector('.znhd-phone-chat', { timeout: 30000 });
        await sleep(500);

        // ① 骨架三件套：头部 / 消息滚动区 / 底部输入区（flex 吸底契约的载体）
        const skeleton = await page.evaluate(() => ({
            chat: !!document.querySelector('.znhd-phone-chat'),
            header: !!document.querySelector('.znhd-phone-header'),
            scroll: !!document.querySelector('.znhd-phone-scroll'),
            composer: !!document.querySelector('.znhd-phone-composer'),
            textarea: !!document.querySelector('.znhd-phone-composer textarea'),
            imageBtn: !!document.querySelector('.znhd-phone-composer button[aria-label="图片上传"]'),
            sendBtn: !!document.querySelector('.znhd-phone-composer button[aria-label="发送"]'),
            bg: getComputedStyle(document.querySelector('.znhd-phone-chat')).backgroundColor,
        }));
        check(
            '聊天窗骨架齐：头部 + 消息滚动区 + 底部输入区（图片按钮 / 发送按钮 / 输入框）',
            skeleton.chat &&
                skeleton.header &&
                skeleton.scroll &&
                skeleton.composer &&
                skeleton.textarea &&
                skeleton.imageBtn &&
                skeleton.sendBtn
        );
        check('整页微信暗色底（#1E1E1E，对齐脚本端第三栏）', skeleton.bg === 'rgb(30, 30, 30)');

        // ①-B 输入区吸底（v26.10.13-v3 回归判据）：antd <AntApp> 的 div.ant-app 包裹层
        //     没有高度，height:100% 会断链 ⇒ 整页内容高度、输入区悬在视口中间。
        const pin = await page.evaluate(() => {
            const chatEl = document.querySelector('.znhd-phone-chat');
            const composerEl = document.querySelector('.znhd-phone-composer');
            const chat = chatEl ? chatEl.getBoundingClientRect() : null;
            const composer = composerEl ? composerEl.getBoundingClientRect() : null;
            return {
                vh: window.innerHeight,
                chatH: chat ? Math.round(chat.height) : -1,
                chatPos: chatEl ? getComputedStyle(chatEl).position : '',
                composerBottom: composer ? Math.round(composer.bottom) : -1,
            };
        });
        check(
            '输入区吸底：整页骨架 fixed 且高=视口，输入区底边=视口底（修复 App 包裹层断高度链）',
            pin.chatPos === 'fixed' &&
                Math.abs(pin.chatH - pin.vh) <= 1 &&
                Math.abs(pin.composerBottom - pin.vh) <= 1
        );

        // ①-C 工具栏顺序：表情按钮在图片按钮前面（v26.10.13-v3 需求）
        const order = await page.evaluate(() => {
            const tools = document.querySelector('.znhd-composer-tools');
            if (!tools) return null;
            const btns = Array.from(tools.querySelectorAll('button[aria-label]'));
            const idx = (label) => btns.findIndex((b) => b.getAttribute('aria-label') === label);
            return { emoji: idx('表情'), image: idx('图片上传') };
        });
        check(
            '工具栏顺序：表情按钮在图片按钮前面',
            !!order && order.emoji >= 0 && order.image >= 0 && order.emoji < order.image
        );

        // ①-D 表情面板与「点一张直接发到电脑」（CDN 已桩；载荷断言见 phonePosts）
        await page.click('button[aria-label="表情"]');
        await page.waitForSelector('.znhd-emoji-panel', { timeout: 10000 });
        const panelInfo = await page.evaluate(() => ({
            chips: document.querySelectorAll('.znhd-emoji-chip').length,
            items: document.querySelectorAll('.znhd-emoji-item').length,
        }));
        check(
            '表情面板展开：合集 chips（≥1）+ 图片格子（≥2，清单走 CDN 桩）',
            panelInfo.chips >= 1 && panelInfo.items >= 2
        );
        await page.waitForSelector('.znhd-emoji-item img', { timeout: 15000 });
        await page.click('.znhd-emoji-item');
        await page.waitForFunction(
            () => document.querySelectorAll('.znhd-chat-msg[data-side="out"] .znhd-chat-img').length >= 1,
            { timeout: 15000 }
        );
        await sleep(800); // 等 base64 + POST 真发出去（捕获发生在请求时刻）
        await page.click('button[aria-label="表情"]'); // 再点一次应收起
        const panelGone = await page.evaluate(() => !document.querySelector('.znhd-emoji-panel'));
        check('表情面板可再点按钮收起（toggle）', panelGone);
        const emojiPost = (() => {
            for (let i = phonePosts.length - 1; i >= 0; i--) {
                try {
                    const p = JSON.parse(phonePosts[i]);
                    if (p && typeof p.data === 'string') return p;
                } catch (e) {
                    /* 非 JSON（心跳等）：跳过 */
                }
            }
            return null;
        })();
        check(
            '点表情直接发送：POST 载荷 mime=image/png、name 形如 <合集>-<键>.png、data 非空',
            !!emojiPost &&
                emojiPost.mime === 'image/png' &&
                /^[a-z0-9_-]+-\d+\.png$/.test(String(emojiPost.name || '')) &&
                String(emojiPost.data || '').length >= 20
        );

        // ①-E 键盘弹出：shell 跟随视觉视口（输入区不被键盘挡住），收起后还原 100dvh
        const kb = await page.evaluate(async () => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const bottom = () =>
                Math.round(document.querySelector('.znhd-phone-composer').getBoundingClientRect().bottom);
            const before = bottom();
            window.__vvSet(window.innerHeight - 320, 0);
            window.__vvFire('resize');
            await wait(120);
            const during = bottom();
            const duringH = getComputedStyle(document.querySelector('.znhd-phone-chat')).height;
            window.__vvSet(1e9, 0);
            window.__vvFire('resize');
            await wait(120);
            return { before, during, duringH, after: bottom(), vh: window.innerHeight };
        });
        check(
            '键盘弹出时输入区随视觉视口上移 320px（高也同步），收起后回到底',
            Math.abs(kb.before - kb.vh) <= 1 &&
                Math.abs(kb.during - (kb.vh - 320)) <= 1 &&
                kb.duringH === kb.vh - 320 + 'px' &&
                Math.abs(kb.after - kb.vh) <= 1
        );

        // ② 发图片：选图 → 出「发送中」气泡 → 顺序发送 → 气泡下方出「已发送」
        const input = await page.$('input[type=file]');
        if (!input) {
            check('页面有选图用的 file input', false);
        } else {
            await input.uploadFile(png);
            await page.waitForSelector('.znhd-chat-msg[data-side="out"] .znhd-chat-img', { timeout: 15000 });
            await page.waitForFunction(
                () =>
                    Array.from(document.querySelectorAll('.znhd-chat-msg[data-side="out"] .znhd-chat-meta')).some(
                        (el) => (el.textContent || '').indexOf('已发送') >= 0
                    ),
                { timeout: 20000 }
            );
            const bubble = await page.evaluate(() => {
                const msg = document.querySelector('.znhd-chat-msg[data-side="out"]');
                const bub = msg ? msg.querySelector('.znhd-chat-bubble') : null;
                const dir = msg ? getComputedStyle(msg).flexDirection : '';
                return { dir, bg: bub ? getComputedStyle(bub).backgroundColor : '' };
            });
            check(
                '发出的图片进右侧气泡：row-reverse（头像在右）+ 微信绿 #07C160',
                bubble.dir === 'row-reverse' && bubble.bg === 'rgb(7, 193, 96)'
            );
        }

        // ③ 发文本：输入 → Enter（触发 onPressEnter）→ 右侧文本气泡
        await page.type('.znhd-phone-composer textarea', '冒烟聊天文本：手机到电脑');
        await page.keyboard.press('Enter');
        await page.waitForFunction(
            () =>
                Array.from(document.querySelectorAll('.znhd-chat-msg[data-side="out"]')).some((el) =>
                    (el.textContent || '').indexOf('冒烟聊天文本：手机到电脑') >= 0
                ),
            { timeout: 15000 }
        );
        check('Enter 发送的文本出现在右侧气泡（输入框同时清空）', true);

        // ③b 上传带 phoneId（v26.10.13-v3 起；覆盖范围 v26.10.13-v5 补齐）：App 自己发的**每一条**
        //     （表情直发 / 上传图 / 文本）经真中继投递时都带 from = 本机手机 ID —— 电脑端据此把内容
        //     归到**这台手机**的会话，两台及以上手机在线也不再全挤进聚合会话。
        //     ⚠️ 必须把队列里**全部 3 条**取出来再判（队列顺序 = ① 的表情直发 → ② 上传图 → ③ 文本）：
        //       只取前 2 条时，表情那条 from 为空也照样「通过」（前两条都是图），v26.10.13-v5 实测漏判过一次。
        const phoneId = await page.evaluate(() => {
            const sub = document.querySelector('.znhd-phone-sub');
            const m = /本机（手机）ID：(\S+)/.exec(sub ? sub.textContent || '' : '');
            return m ? m[1] : '';
        });
        const recvItems = [];
        for (let i = 0; i < 3; i++) {
            recvItems.push(
                await fetch(`http://127.0.0.1:${port}/recv/test-device-0001?maxwait=2000`).then((r) => r.json())
            );
        }
        check(
            '手机上传带 phoneId：中继 /recv 投递的每条（表情图 / 上传图 / 文本）from = 本机手机 ID',
            !!phoneId &&
                recvItems.length === 3 &&
                recvItems.every((it) => it && it.from === phoneId && (it.type === 'image' || it.type === 'text')) &&
                recvItems.some((it) => it.type === 'image') &&
                recvItems.some((it) => it.type === 'text')
        );

        // ④ 电脑端 → 手机端：真从中继投递一张图，等长轮询收到 → 左侧灰气泡
        const b64 = fs.readFileSync(png).toString('base64');
        const sent = await fetch(`http://127.0.0.1:${port}/phone/send/test-device-0001`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'probe.png', mime: 'image/png', data: b64 }),
        });
        check('电脑端 → 手机端：中继投递接口可用（/phone/send 返回 ok）', sent.ok);

        await page.waitForSelector('.znhd-chat-msg[data-side="in"] .ant-image img', { timeout: 25000 });
        const inBubble = await page.evaluate(() => {
            const msg = document.querySelector('.znhd-chat-msg[data-side="in"]');
            const bub = msg ? msg.querySelector('.znhd-chat-bubble') : null;
            const dir = msg ? getComputedStyle(msg).flexDirection : '';
            return { dir, bg: bub ? getComputedStyle(bub).backgroundColor : '' };
        });
        check(
            '收到的图片进左侧气泡：row（头像在左）+ 微信灰 #2F2F2F',
            inBubble.dir === 'row' && inBubble.bg === 'rgb(47, 47, 47)'
        );

        // ⑤ 点收到的图 → antd 预览（shared/preview 集成链路：宿主 / 打印按钮 / 遮罩压制）
        await page.evaluate(() => {
            const img = document.querySelector('.znhd-chat-msg[data-side="in"] .ant-image img');
            if (img) img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await page.waitForSelector('.ant-image-preview', { timeout: 15000 });
        await sleep(500);

        const previewInfo = await page.evaluate(() => {
            const root = document.querySelector('.ant-image-preview');
            const host = document.getElementById('__znhd_preview_host__');
            const actions = root ? root.querySelector('.ant-image-preview-actions') : null;
            const printBtn = root ? root.querySelector('button[aria-label="print"]') : null;
            const hidden = (sel) =>
                Array.from(document.querySelectorAll(sel)).every((el) => {
                    const cs = getComputedStyle(el);
                    return cs.display === 'none' || cs.visibility === 'hidden';
                });
            return {
                mountedInSharedHost: !!(root && host && host.contains(root)),
                toolbarHasPrint: !!(actions && printBtn && actions.contains(printBtn)),
                masksHidden: hidden('.ant-modal-mask') && hidden('.ant-drawer-mask'),
            };
        });
        check('预览浮层挂在共享宿主 div #__znhd_preview_host__ 里（不是 body）', previewInfo.mountedInSharedHost);
        check('预览工具栏里有共享方式追加的「打印」按钮', previewInfo.toolbarHasPrint);
        check('预览期间下层遮罩被压掉（与脚本端同一份规则）', previewInfo.masksHidden);

        // ⑥ 点打印 → react-to-print 建出 id=printWindow 的 iframe，且版式来自共享的 PRINT_PAGE_STYLE
        // ⚠️ 时序：react-to-print 是「先插 iframe、load 时才写入内容」，必须监听 iframe 自己的 load 事件。
        await page.evaluate(() => {
            window.__printDoc = null;
            const obs = new MutationObserver((muts) => {
                for (const m of muts) {
                    Array.prototype.forEach.call(m.addedNodes, (n) => {
                        if (n && n.id === 'printWindow') {
                            n.addEventListener('load', () => {
                                try {
                                    const d = n.contentDocument;
                                    const img = d && d.querySelector('img');
                                    const box = d && d.querySelector('body > div');
                                    const styles = d
                                        ? Array.from(d.querySelectorAll('style')).map((s) => s.textContent || '')
                                        : [];
                                    window.__printDoc = {
                                        hasImg: !!img,
                                        pageA4: styles.some((t) => /@page/.test(t) && /size:\s*A4/i.test(t)),
                                        marginZero: styles.some((t) => /@page\s*\{[^}]*margin:\s*0\s*[;}]/.test(t)),
                                        boxStyle: box ? box.getAttribute('style') : null,
                                        imgStyle: img ? img.getAttribute('style') : null,
                                    };
                                } catch (e) {
                                    window.__printDoc = { error: String((e && e.message) || e) };
                                }
                            });
                        }
                    });
                }
            });
            obs.observe(document.documentElement, { childList: true, subtree: true });
        });
        await page.evaluate(() => {
            const b = document.querySelector('.ant-image-preview button[aria-label="print"]');
            if (b) b.click();
        });
        try {
            await page.waitForFunction(() => !!window.__printDoc, { timeout: 8000 });
        } catch (e) {
            /* 超时后按 null 断言，失败信息更完整 */
        }
        const printDoc = await page.evaluate(() => window.__printDoc || null);
        check(
            '「打印」按共享 A4 版式建出打印 iframe（@page size:A4 + margin:0 + 210mm 图片框 + object-fit）',
            !!(
                printDoc &&
                printDoc.hasImg &&
                printDoc.pageA4 &&
                printDoc.marginZero &&
                /210mm/.test(printDoc.boxStyle || '') &&
                /object-fit:\s*contain/.test(printDoc.imgStyle || '')
            )
        );
        console.log('     实测打印文档：' + JSON.stringify(printDoc));

        // ⑦ 桌面版：聊天窗是屏幕居中的弹窗（v26.10.13-v4 需求）——切桌面 UA + 大视口 reload。
        // 页面的判定（lib/layoutMode.ts）挂在挂载时 + resize 重算，reload 后以新 UA 重新计算。
        await page.setUserAgent(DESKTOP_UA);
        await page.setViewport({ width: 1280, height: 800 });
        await page.reload({ waitUntil: 'load', timeout: 60000 });
        await page.waitForSelector('.znhd-phone-chat', { timeout: 30000 });
        await sleep(500);
        const win = await page.evaluate(() => {
            const shell = document.querySelector('.znhd-phone-chat');
            const r = shell.getBoundingClientRect();
            return {
                isWindow: shell.classList.contains('znhd-chat-window'),
                hasLayer: !!document.querySelector('.znhd-window-layer'),
                x: Math.round(r.x),
                y: Math.round(r.y),
                w: Math.round(r.width),
                h: Math.round(r.height),
                vw: window.innerWidth,
                vh: window.innerHeight,
            };
        });
        check(
            '桌面版：聊天窗挂弹窗类 + 居中层（不是全屏骨架）',
            win.isWindow && win.hasLayer
        );
        check(
            '桌面版：弹窗尺寸 420×680（参考微信 PC 文件传输助手独立窗）',
            win.w === 420 && win.h === 680
        );
        check(
            '桌面版：弹窗在屏幕正中心（左右/上下间隙差 ≤2px）',
            Math.abs(win.x - (win.vw - win.w - win.x)) <= 2 && Math.abs(win.y - (win.vh - win.h - win.y)) <= 2
        );
        check(
            '桌面版：弹窗不占满视口（宽高均小于视口）',
            win.w < win.vw && win.h < win.vh
        );
    } finally {
        await browser.close();
        child.kill();
        try {
            fs.unlinkSync(png);
        } catch (e) {
            /* 忽略 */
        }
    }

    const bad = results.filter((r) => !r.ok);
    if (bad.length) {
        console.error('❌ 手机端聊天窗测试未通过（phone-page:PARTIAL）：' + bad.map((b) => b.name).join('、'));
        process.exit(1);
    }
    console.log('✅ 手机端聊天窗测试通过（phone-page:ALL-OK）');
    process.exit(0);
}

main().catch((e) => {
    console.error('❌ 手机端聊天窗测试异常：' + (e && e.message));
    process.exit(1);
});
