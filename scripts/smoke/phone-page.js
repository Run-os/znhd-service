/**
 * 手机端聊天窗（web/ → relay-server/public）的端到端测试。
 *
 * v26.10.12-v5：手机页从「上传到电脑」双卡片页重构为**聊天窗**（对齐脚本端第三栏，
 * 气泡 + 底部输入区）。本文件随之重写：不再断言卡片排版，改为断言
 * 「发出去的进右侧绿气泡、电脑发来的进左侧灰气泡、预览/打印共享链路不回退」。
 * v26.10.21-v1：客户端样式同步脚本端（business 暗色 + 微信绿 → cupcake 浅色 + 品牌蓝
 * primary + 我方气泡绿），窗口底色断言从纯黑改为 base-100、气泡绿断言改为 rgb(53,210,141)。
 *
 * v26.10.13-v3：新增三组断言（对应本次需求）——
 *   ① **输入区吸底**（`composerPinnedOk`）：antd `<AntApp>` 会渲染一个没有高度的
 *      `div.ant-app` 包裹层，`height:100%` 对 auto 父级解析为 auto，整页会退化成
 *      内容高度、输入区悬在视口中间（用户截图实录）。判据 = 整页骨架 `position:fixed`
 *      且高=视口、输入区底边=视口底。
 * v26.10.18-v9：两端聊天窗统一照搬 shadcn-vue `message-scroller` 示例（Card 三段 +
 * MessageScroller + InputGroup），表情包功能整体下线，本文件随之再裁 ——
 *   · 组件断言全部改用官方组件的 `data-slot`（card / message-scroller / bubble /
 *     input-group），不再依赖手写类名；
 *   · 表情 fixture（假 CDN + /emoji 预热 + 表情直发）整段删除。
 *
 * 既有（v26.10.13-v3）：
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
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const zlib = require('zlib');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
/**
 * 浏览器可执行文件探测：与 `scripts/smoke/vue-panel.js` **用同一份清单**（旧注释写的 `run.js` 已随 React 版删除）。
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

/** 上传/投递用的 1x1 PNG（与 vue-panel.js 同一份 base64：Chromium 实测可解码，别改回手拼的） */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function writeTinyPng(file) {
    fs.writeFileSync(file, Buffer.from(PNG_1X1, 'base64'));
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
        env: {
            ...process.env,
            PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let childErr = '';
    child.stderr.on('data', (d) => {
        childErr += String(d);
    });
    child.stdout.on('data', () => {
        /* 吞掉 stdout：中继日志走 stderr 汇总 */
    });

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
        // --disable-dev-shm-usage：容器内 /dev/shm 只有 64MB，写满会让渲染进程静默停摆（迁 CNB 后加的）
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
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

        // ② POST 捕获 + P4 记账：手机页应当只走 /phone/poll（报活+收件合一），不再发 /phone/heartbeat
        const phonePosts = [];
        let pollPathHits = 0;
        let hbPathHits = 0;
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const url = req.url();
            let u = null;
            try {
                u = new URL(url);
            } catch (e) {
                u = null; // data: 等怪 scheme：不当外部请求，直接放行
            }
            if (u && u.pathname.indexOf('/phone/poll/') === 0) pollPathHits++;
            if (u && u.pathname.indexOf('/phone/heartbeat/') === 0) hbPathHits++;
            if (req.method() === 'POST' && u && u.pathname.indexOf('/u/') === 0) {
                phonePosts.push(req.postData() || '');
            }
            req.continue();
        });

        await page.goto(`http://127.0.0.1:${port}/u/test-device-0001`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForSelector('.znhd-phone-chat', { timeout: 30000 });
        await sleep(500);

        // P4（v26.10.15-v2）：新模型下手机页只挂一条连接 —— 走 POST /phone/poll（兼报活），
        // 不再发 /phone/heartbeat。⚠️ 两条都要判：「poll>0」防止「压根没连上」也算通过，
        // 「hb===0」才是真正省掉的那 3600 次/8h。
        check(
            'P4：手机页只走 /phone/poll（已发 ' +
                pollPathHits +
                ' 次），不再发 /phone/heartbeat（' +
                hbPathHits +
                ' 次）',
            pollPathHits > 0 && hbPathHits === 0
        );

        // ① 骨架三件套：card 三段（header / 滚动容器 / card-footer 输入区）
        //    v26.10.20-v14 客户端 daisyUI 化：composer 不再是 shadcn InputGroup 复合件
        //    （textarea + 一行按钮），选择器相应改为 .znhd-phone-chat 下的原生元素。
        const skeleton = await page.evaluate(() => ({
            chat: !!document.querySelector('.znhd-phone-chat'),
            card: !!document.querySelector('.znhd-phone-chat [data-slot="card"]'),
            header: !!document.querySelector('.znhd-phone-chat [data-slot="card-header"]'),
            scroll:
                !!document.querySelector('.znhd-phone-chat [data-slot="message-scroller"]') ||
                !!document.querySelector('.znhd-phone-chat [data-slot="empty"]'),
            composer: !!document.querySelector('.znhd-phone-chat [data-slot="card-footer"]'),
            textarea: !!document.querySelector('.znhd-phone-chat textarea'),
            // v21：附件触发器从 div[role=button] 改成 details 的 <summary>（官方 details 式 dropdown）
            attachBtn: !!document.querySelector('.znhd-phone-chat summary[aria-label="添加图片或文件"]'),
            sendBtn: !!document.querySelector('.znhd-phone-chat button[aria-label="发送"]'),
            bg: (function () {
                // v26.10.21-v1 起底色画在 card 根节点（card-content 透明）
                const el = document.querySelector('.znhd-phone-chat [data-slot="card"]');
                // 判据 = 与主题 base-100 同色（对齐脚本端传输助手 modal-box），
                // 不硬编码 rgb：cupcake 的 base-100 是 oklch，浏览器换算值随实现微调
                const probe = document.createElement('div');
                probe.className = 'bg-base-100';
                probe.style.display = 'none';
                document.body.appendChild(probe);
                const expected = getComputedStyle(probe).backgroundColor;
                probe.remove();
                return el ? getComputedStyle(el).backgroundColor + '|' + expected : '';
            })(),
        }));
        check(
            '聊天窗骨架齐：Card 三段 + 消息滚动区 + 底部输入区（附件下拉 / 发送按钮 / 输入框）',
            skeleton.chat &&
                skeleton.card &&
                skeleton.header &&
                skeleton.scroll &&
                skeleton.composer &&
                skeleton.textarea &&
                skeleton.attachBtn &&
                skeleton.sendBtn
        );
        // v26.10.21-v1 样式同步脚本端：窗口底色 = base-100（此前 v26.10.19-v3~v26.10.20-v21 是纯黑窗体）
        check('窗口底色 = 主题 base-100（对齐脚本端传输助手窗口）', (function (v) {
            const parts = v.split('|');
            return parts.length === 2 && parts[0] === parts[1] && parts[0] !== '';
        })(skeleton.bg));

        // ①-B 输入区吸底（v26.10.13-v3 回归判据；v26.10.18-v7 换 Vue 后那层包裹已不存在，判据仍有效）：当年 antd <AntApp> 的 div.ant-app 包裹层
        //     没有高度，height:100% 会断链 ⇒ 整页内容高度、输入区悬在视口中间。
        const pin = await page.evaluate(() => {
            const chatEl = document.querySelector('.znhd-phone-chat');
            const composerEl = document.querySelector('.znhd-phone-chat [data-slot="card-footer"]');
            const hintEl = document.querySelector('.znhd-phone-chat .znhd-phone-hint');
            const chat = chatEl ? chatEl.getBoundingClientRect() : null;
            const composer = composerEl ? composerEl.getBoundingClientRect() : null;
            const hint = hintEl ? hintEl.getBoundingClientRect() : null;
            return {
                vh: window.innerHeight,
                chatH: chat ? Math.round(chat.height) : -1,
                chatPos: chatEl ? getComputedStyle(chatEl).position : '',
                composerBottom: composer ? Math.round(composer.bottom) : -1,
                hintBottom: hint ? Math.round(hint.bottom) : -1,
            };
        });
        check(
            '输入区吸底：整页骨架 fixed 且高=视口，输入区+提示行贴到视口底（修复 App 包裹层断高度链）',
            pin.chatPos === 'fixed' &&
                Math.abs(pin.chatH - pin.vh) <= 1 &&
                pin.composerBottom < pin.vh &&
                Math.abs(pin.hintBottom - pin.vh) <= 2
        );

        // ①-E 键盘弹出：shell 跟随视觉视口（输入区不被键盘挡住），收起后还原 100dvh
        const kb = await page.evaluate(async () => {
            const wait = (ms) => new Promise((r) => setTimeout(r, ms));
            const bottom = () =>
                Math.round(
                    document.querySelector('.znhd-phone-chat [data-slot="card-footer"]').getBoundingClientRect().bottom
                );
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
            '键盘弹出时输入区随视觉视口上移 320px（shell 高也同步），收起后还原',
            Math.abs(kb.during - (kb.before - 320)) <= 2 &&
                kb.duringH === kb.vh - 320 + 'px' &&
                Math.abs(kb.after - kb.before) <= 2
        );

        // ② 发图片：选图 → 出「发送中」气泡 → 顺序发送 → 气泡下方出「已发送」
        //    （v26.10.20-v14 客户端 daisyUI 化：气泡 = chat 组件，我方 = .chat-end，绿 = .chat-bubble-primary）
        const input = await page.$('input[type=file]');
        if (!input) {
            check('页面有选图用的 file input', false);
        } else {
            // v26.10.22-v4：一次选**两张**。连发是「气泡叠在一起只看得到最后一张」的复现条件
            //（daisyUI .chat-bubble 固定 grid-row-end:3，同轮多条会落在同一格）
            await input.uploadFile(png, png);
            await page.waitForFunction(
                () => document.querySelectorAll('.chat-end .chat-bubble img').length >= 2,
                { timeout: 15000 }
            );
            await page.waitForFunction(
                () =>
                    Array.from(document.querySelectorAll('.chat-end .chat-footer')).filter(
                        (el) => (el.textContent || '').indexOf('已发送') >= 0
                    ).length >= 2,
                { timeout: 20000 }
            );
            // 压缩后的 objectURL 换 src 是异步的：等 <img> 真正解码完成再取值
            await page.waitForFunction(
                () =>
                    Array.from(document.querySelectorAll('.chat-end .chat-bubble img')).filter(
                        (img) => img.naturalWidth > 0
                    ).length >= 2,
                { timeout: 15000 }
            );
            const bubble = await page.evaluate(() => {
                const msg = document.querySelector('.chat.chat-end');
                const bubs = msg ? [...msg.querySelectorAll('.chat-bubble')] : [];
                const bub = bubs[0] || null;
                // 图片必须被关在气泡内容盒里（旧写法图写死 max-w-240px、气泡 max-w-62%，
                // 窄屏上 62% − 内边距 < 240 ⇒ 图直接溢出到气泡外）
                let imgFits = bubs.length >= 2;
                for (const b of bubs) {
                    const img = b.querySelector('img');
                    if (!img) {
                        imgFits = false;
                        continue;
                    }
                    const br = b.getBoundingClientRect();
                    const ir = img.getBoundingClientRect();
                    const cs = getComputedStyle(b);
                    const right = br.right - parseFloat(cs.paddingRight);
                    const bottom = br.bottom - parseFloat(cs.paddingBottom);
                    if (ir.right > right + 0.5 || ir.bottom > bottom + 0.5) imgFits = false;
                }
                // 同轮多条气泡必须各占一行（叠在一起 = 用户只能看到最新那张）
                const rs = bubs.map((b) => b.getBoundingClientRect()).sort((a, b2) => a.top - b2.top);
                let stacked = rs.length >= 2;
                for (let i = 1; i < rs.length; i++) {
                    if (rs[i].top < rs[i - 1].bottom - 0.5) stacked = false;
                }
                return {
                    align: msg ? (msg.classList.contains('chat-end') ? 'end' : 'start') : '',
                    bubbleOk: !!bub,
                    count: bubs.length,
                    imgLoaded: bubs.every((b) => {
                        const img = b.querySelector('img');
                        return !!img && img.naturalWidth > 0;
                    }),
                    imgFits,
                    stacked,
                };
            });
            check(
                '发出的图片进右侧气泡（chat-end）且真的加载出来',
                bubble.align === 'end' && bubble.bubbleOk && bubble.imgLoaded
            );
            check(
                '连发两张图：每条气泡各占一行（不重叠）',
                bubble.count >= 2 && bubble.stacked
            );
            check('图片不超出气泡（含窄屏 max-w 链）', bubble.imgFits);
        }

        // ③ 发文本：输入 → Enter → 右侧文本气泡（chat-bubble-primary = 我方气泡绿）
        await page.type('.znhd-phone-chat textarea', '冒烟聊天文本：手机到电脑');
        await page.keyboard.press('Enter');
        await page.waitForFunction(
            () =>
                Array.from(document.querySelectorAll('.chat-end .chat-bubble')).some(
                    (el) => (el.textContent || '').indexOf('冒烟聊天文本：手机到电脑') >= 0
                ),
            { timeout: 15000 }
        );
        const textBubble = await page.evaluate(() => {
            // daisyUI chat：底色直接画在 .chat-bubble-primary 根节点上
            const bubbles = [...document.querySelectorAll('.chat-end .chat-bubble-primary')];
            const c = bubbles.find((el) => (el.textContent || '').indexOf('冒烟聊天文本：手机到电脑') >= 0);
            const ta = document.querySelector('.znhd-phone-chat textarea');
            return { bg: c ? getComputedStyle(c).backgroundColor : '', left: ta ? ta.value : '?' };
        });
        check(
            'Enter 发送的文本进右侧气泡：我方气泡绿 rgb(53,210,141)，且输入框同时清空',
            textBubble.bg === 'rgb(53, 210, 141)' && textBubble.left === ''
        );

        // ③b 上传带 phoneId（v26.10.13-v3 起）：App 自己发的每一条（上传图 / 文本）经真中继
        //     投递时都带 from = 本机手机 ID。队列顺序 = ② 两张上传图 → ③ 文本（表情已下线）。
        //     v26.10.19-v9：标题栏「本机 id · 电脑 id」描述行已删，phoneId 改读 localStorage（同源键）。
        const phoneId = await page.evaluate(() => localStorage.getItem('znhd_phone_id') || '');
        const recvItems = [];
        for (let i = 0; i < 3; i++) {
            recvItems.push(
                await fetch(`http://127.0.0.1:${port}/recv/test-device-0001?maxwait=2000`).then((r) => r.json())
            );
        }
        check(
            '手机上传带 phoneId：中继 /recv 投递的每条（两张上传图 / 文本）from = 本机手机 ID',
            !!phoneId &&
                recvItems.length === 3 &&
                recvItems.every((it) => it && it.from === phoneId && (it.type === 'image' || it.type === 'text')) &&
                recvItems.filter((it) => it.type === 'image').length === 2 &&
                recvItems.some((it) => it.type === 'text')
        );

        // ③c 持久化（v26.10.22-v4）：刷新页面后历史必须还在。
        //     自己发出的图 / 文件显示用 objectURL（刷新即失效），所以必须靠 IndexedDB 里的 Blob 重建；
        //     旧实现把「url 是 blob:」的消息整条丢掉 ⇒ 一刷新自己发的内容全没了。
        await sleep(1200); // 给持久化防抖留出落盘时间（正常路径；pagehide 还有一次 flush 兜底）
        await page.reload({ waitUntil: 'load' });
        let persisted = false;
        try {
            await page.waitForFunction(
                () => {
                    const imgs = [...document.querySelectorAll('.chat-end .chat-bubble img')];
                    const textBack = [...document.querySelectorAll('.chat-end .chat-bubble')].some(
                        (el) => (el.textContent || '').indexOf('冒烟聊天文本：手机到电脑') >= 0
                    );
                    return imgs.length >= 2 && imgs.every((i) => i.naturalWidth > 0) && textBack;
                },
                { timeout: 20000 }
            );
            persisted = true;
        } catch (e) {
            persisted = false;
        }
        check('刷新后聊天记录仍在：自己发的两张图（Blob 重建）与文本都回来了', persisted);

        // ③b 自己发的图也能点开预览（v26.10.27-v1 对齐脚本端；此前 clickable 只给收到的图，
        //     out 图点了没反应 —— 使用者 2026-10-27 报障的根因）
        let outPreviewOk = false;
        try {
            await page.evaluate(() => {
                const img = document.querySelector('.chat-end .chat-bubble img');
                if (img) img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            await page.waitForSelector('[data-znhd="image-preview"]', { timeout: 10000 });
            await sleep(300);
            outPreviewOk = await page.evaluate(() => {
                const d = document.querySelector('[data-znhd="image-preview"]');
                return !!(d && d.open);
            });
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => {
                const d = document.querySelector('[data-znhd="image-preview"]');
                return !d || !d.open;
            }, { timeout: 5000 });
        } catch {
            outPreviewOk = false;
        }
        check('刷新后自己发的图也能点开预览（out 图与脚本端对齐）', outPreviewOk);

        // ④ 电脑端 → 手机端：真从中继投递一张图，等长轮询收到 → 左侧灰气泡
        const b64 = fs.readFileSync(png).toString('base64');
        const sent = await fetch(`http://127.0.0.1:${port}/phone/send/test-device-0001`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'probe.png', mime: 'image/png', data: b64 }),
        });
        check('电脑端 → 手机端：中继投递接口可用（/phone/send 返回 ok）', sent.ok);

        await page.waitForSelector('.chat-start .chat-bubble img', {
            timeout: 25000,
        });
        const inBubble = await page.evaluate(() => {
            const msg = document.querySelector('.chat.chat-start');
            return {
                align: msg ? (msg.classList.contains('chat-start') ? 'start' : 'end') : '',
                bubbleOk: !!msg && !!msg.querySelector('.chat-bubble'),
            };
        });
        check(
            '收到的图片进左侧气泡（chat-start；电脑 → 手机整链真跑通）',
            inBubble.align === 'start' && inBubble.bubbleOk
        );
        // 留档：一条表情 + 一条上传图 + 一条文本 + 一条收到的图都在屏上
        await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-phone-chat.png') });

        // ⑤ 点收到的图 → 共用 ImagePreview（v26.10.18-v7 起取代 antd 预览 + shared/preview 那套注入）
        await page.evaluate(() => {
            const img = document.querySelector('.chat-start .chat-bubble img');
            if (img) img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await page.waitForSelector('[data-znhd="image-preview"]', { timeout: 15000 });
        await sleep(500);

        const previewInfo = await page.evaluate(() => {
            const root = document.querySelector('[data-znhd="image-preview"]');
            const printBtn = root ? root.querySelector('button[aria-label="打印"]') : null;
            const cs = root ? getComputedStyle(root) : null;
            const r = root ? root.getBoundingClientRect() : null;
            return {
                // v26.10.18-v7：不再是 antd 预览（当年必须挂到共享宿主 #__znhd_preview_host__，
                // 否则会被 antd 的 portal 规则挪到 body 丢掉集成），而是共用组件 ImagePreview ——
                // 独立页面没有影子树，直接 Teleport 到 body 就是正确位置。
                inBody: !!(root && root.parentElement === document.body),
                toolbarHasPrint: !!printBtn,
                coversViewport: !!(
                    cs &&
                    cs.position === 'fixed' &&
                    r &&
                    r.width >= window.innerWidth - 1 &&
                    r.height >= window.innerHeight - 1
                ),
            };
        });
        check('预览层直接挂在 body 上（共用 ImagePreview，独立页面无需共享宿主）', previewInfo.inBody);
        check('预览工具栏里有「打印」按钮（A4 自适应）', previewInfo.toolbarHasPrint);
        check('预览层铺满视口（position:fixed 且宽高=视口）', previewInfo.coversViewport);

        // ⑥ 点打印 → 共用的 printA4Image 建出 id=printWindow 的 iframe，版式来自共享的 PRINT_PAGE_STYLE
        // ⚠️ 时序：实现是「先插 iframe、再写文档」，必须监听 iframe 自己的 load 事件。
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
            const b = document.querySelector('[data-znhd="image-preview"] button[aria-label="打印"]');
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
        check('桌面版：聊天窗挂弹窗类 + 居中层（不是全屏骨架）', win.isWindow && win.hasLayer);
        check('桌面版：弹窗尺寸 420×680（参考微信 PC 文件传输助手独立窗）', win.w === 420 && win.h === 680);
        check(
            '桌面版：弹窗在屏幕正中心（左右/上下间隙差 ≤2px）',
            Math.abs(win.x - (win.vw - win.w - win.x)) <= 2 && Math.abs(win.y - (win.vh - win.h - win.y)) <= 2
        );
        // 「不占满视口」整条已删（审计合并）：视口恒定 1280×800，上一行已断 420×680
        // ⇒ 420 < 1280 且 680 < 800 是它的逻辑子集，永远不会独立失败。
        await page.screenshot({ path: path.join(os.tmpdir(), 'znhd-phone-desktop.png') });

        // ===== P4 降级路径（v26.10.15-v2）=====
        // 新手机页先试 POST /phone/poll；**老中继没有该端点 ⇒ 404 ⇒ 必须自动降级**回
        // 「8s 心跳 + /phone/recv」。这是 P4 的兼容性红线（新客户端 + 老服务端不能坏），
        // 只靠 typecheck 兜不住，必须真跑一次。
        // 手法：新开一页装请求拦截，把 /phone/poll 一律改成 404 —— 等于在本地造一个老中继；
        // 然后断言页面**先试过**新端点、并且**随后发出了** /phone/heartbeat。
        const lgPage = await browser.newPage();
        lgPage.setDefaultTimeout(30000);
        let lgSawPoll = false;
        let lgSawHeartbeat = false;
        let lgSawRecv = false;
        await lgPage.setRequestInterception(true);
        lgPage.on('request', (req) => {
            const u = req.url();
            if (u.indexOf('/phone/poll/') >= 0) {
                lgSawPoll = true;
                req.respond({ status: 404, contentType: 'text/plain', body: 'not found' });
                return;
            }
            if (u.indexOf('/phone/heartbeat/') >= 0) lgSawHeartbeat = true;
            if (u.indexOf('/phone/recv/') >= 0) lgSawRecv = true;
            req.continue();
        });
        await lgPage.goto(`http://127.0.0.1:${port}/u/test-device-0001`, { waitUntil: 'load', timeout: 60000 });
        for (let i = 0; i < 25 && !(lgSawHeartbeat && lgSawRecv); i++) await sleep(200);
        check('P4 降级：确实先试过新端点 /phone/poll（否则这条测的不是降级）', lgSawPoll);
        check(
            'P4 降级：老中继（/phone/poll 返回 404）下手机页自动回到 /phone/heartbeat + /phone/recv 老模型',
            lgSawHeartbeat && lgSawRecv
        );
        await lgPage.close();
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
