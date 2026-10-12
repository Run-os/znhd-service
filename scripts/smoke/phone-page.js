/**
 * 手机端聊天窗（web/ → relay-server/public）的端到端测试。
 *
 * v26.10.12-v5：手机页从「上传到电脑」双卡片页重构为**聊天窗**（对齐脚本端第三栏，
 * 微信暗色气泡 + 底部输入区）。本文件随之重写：不再断言卡片排版，改为断言
 * 「发出去的进右侧绿气泡、电脑发来的进左侧灰气泡、预览/打印共享链路不回退」。
 *
 * 做法：起一个真实 relay-server（它自己就托管 relay-server/public），用无头 Chromium 打开
 * `/u/<deviceId>`，真上传一张图、真发一条文本、真从中继投递一张图，然后断言语义。
 *
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
