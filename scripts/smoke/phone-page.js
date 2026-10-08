/**
 * 手机上传页（web/ → relay-server/public）的端到端测试（v26.10.08-v2 新增）。
 *
 * 为什么需要它：手机页此前**零自动化覆盖**（只有 typecheck/build）。而 v26.10.08-v2 修的正是
 * 「图片发完的提示渲染到了另一张卡片下面」这类**只有跑起来才看得见**的排版错误 ——
 * 静态检查（typecheck）永远发现不了，`来自电脑` 卡片被删掉同样需要断言守着。
 *
 * 做法：起一个真实 relay-server（它自己就托管 relay-server/public），用无头 Chromium 打开
 * `/u/<deviceId>`，真上传一张图、真走 `/u/` 接口，然后断言**提示落在哪张卡片里**。
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
const BROWSERS = [process.env.PUPPETEER_EXECUTABLE_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(
    (p) => p && fs.existsSync(p)
);
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
        for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
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
        console.log('手机上传页测试（真起中继 + 真上传一张图）：');
        const page = await browser.newPage();
        await page.setViewport({ width: 1100, height: 900 });
        await page.goto(`http://127.0.0.1:${port}/u/test-device-0001`, { waitUntil: 'load', timeout: 60000 });
        await page.waitForSelector('.ant-card', { timeout: 30000 });
        await sleep(500);

        // ① 两张卡片都在；② 已删除的「来自电脑」卡片不得出现
        const titles = await page.evaluate(() =>
            Array.from(document.querySelectorAll('.ant-card-head-title')).map((el) => el.textContent.trim())
        );
        check('手机页正常加载出「发送图片到电脑」与「发送文本到电脑」两张卡片', titles.includes('发送图片到电脑') && titles.includes('发送文本到电脑'));
        check('「来自电脑」卡片已删除（页面不再出现该卡片）', !titles.some((t) => t.includes('来自电脑')));

        // 真上传一张图 → 点发送
        const input = await page.$('input[type=file]');
        if (!input) {
            check('页面有选图用的 file input', false);
        } else {
            await input.uploadFile(png);
            await page.waitForFunction(
                () =>
                    Array.from(document.querySelectorAll('button')).some(
                        (b) => (b.textContent || '').includes('发送图片到电脑') && !b.disabled
                    ),
                { timeout: 15000 }
            );
            await page.evaluate(() => {
                const b = Array.from(document.querySelectorAll('button')).find((x) =>
                    (x.textContent || '').includes('发送图片到电脑')
                );
                if (b) b.click();
            });
            await page.waitForFunction(() => (document.body.textContent || '').includes('已全部发送到电脑'), {
                timeout: 20000,
            });
            await sleep(300);

            // ③★ 本次修复的核心：完成提示必须落在**发送图片到电脑**卡片里
            const info = await page.evaluate(() => {
                const msg = Array.from(document.querySelectorAll('p,span,div')).find(
                    (el) => (el.textContent || '').includes('已全部发送到电脑') && el.children.length === 0
                );
                const card = msg ? msg.closest('.ant-card') : null;
                const titleEl = card ? card.querySelector('.ant-card-head-title') : null;
                return {
                    text: msg ? msg.textContent.trim() : '',
                    cardTitle: titleEl ? titleEl.textContent.trim() : '',
                };
            });
            check(
                '图片发完的提示出现在「发送图片到电脑」卡片内（不是文本卡片）',
                info.cardTitle === '发送图片到电脑' && info.text.includes('已全部发送到电脑')
            );
            console.log('     实测：' + JSON.stringify(info));
        }
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
        console.error('❌ 手机上传页测试未通过（phone-page:PARTIAL）：' + bad.map((b) => b.name).join('、'));
        process.exit(1);
    }
    console.log('✅ 手机上传页测试通过（phone-page:ALL-OK）');
    process.exit(0);
}

main().catch((e) => {
    console.error('❌ 手机上传页测试异常：' + (e && e.message));
    process.exit(1);
});
