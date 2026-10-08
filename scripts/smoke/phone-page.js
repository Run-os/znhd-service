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
        await page.waitForSelector('[data-znhd-card]', { timeout: 30000 });
        await sleep(500);

        // ① 两张卡片都在；② 已删除的「来自电脑」卡片不得出现
        const titles = await page.evaluate(() =>
            // v26.10.08-v14：卡片钩子换成 data-znhd-card-title（标题直接做成属性，省一层元素查询）
            Array.from(document.querySelectorAll('[data-znhd-card]')).map((el) => el.getAttribute('data-znhd-card-title') || '')
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
                const card = msg ? msg.closest('[data-znhd-card]') : null;
                return {
                    text: msg ? msg.textContent.trim() : '',
                    cardTitle: card ? card.getAttribute('data-znhd-card-title') || '' : '',
                };
            });
            check(
                '图片发完的提示出现在「发送图片到电脑」卡片内（不是文本卡片）',
                info.cardTitle === '发送图片到电脑' && info.text.includes('已全部发送到电脑')
            );
            console.log('     实测：' + JSON.stringify(info));
        }

        // ===== ② 收到的图片：放大预览（v26.10.08-v13 起与脚本端共用 shared/preview/）=====
        // 真往中继发一张图给这台「手机」，等它经长轮询收到 → 打开画廊 → 点开预览。
        const b64 = fs.readFileSync(png).toString('base64');
        const sent = await fetch(`http://127.0.0.1:${port}/phone/send/test-device-0001`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'probe.png', mime: 'image/png', data: b64 }),
        });
        check('电脑端 → 手机端：中继投递接口可用（/phone/send 返回 ok）', sent.ok);

        // 画廊入口出现（= 手机页真的收到了这张图）
        await page.waitForFunction(
            () => Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').includes('查看收到的图片')),
            { timeout: 25000 }
        );
        await page.evaluate(() => {
            const b = Array.from(document.querySelectorAll('button')).find((x) =>
                (x.textContent || '').includes('查看收到的图片')
            );
            if (b) b.click();
        });
        // 点缩略图打开放大预览
        // v26.10.08-v14：收件九宫格改用 Tailwind（不再是独立的 znhd-recv-img 类），
        // 缩略图就是画廊内容区里的裸 <img>（antd 的 Image 组件那层包装没有了）
        await page.waitForSelector('[data-znhd-modal-body] img[src^="data:image"]', { timeout: 15000 });
        await page.evaluate(() => {
            const img = document.querySelector('[data-znhd-modal-body] img[src^="data:image"]');
            if (img) img.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await page.waitForSelector('[data-znhd-preview]', { timeout: 15000 });
        await sleep(500);

        const previewInfo = await page.evaluate(() => {
            const root = document.querySelector('[data-znhd-preview]');
            const host = document.getElementById('__znhd_preview_host__');
            const actions = root ? root.querySelector('.znhd-preview-actions') : null;
            const printBtn = root ? root.querySelector('button[aria-label="print"]') : null;
            const hidden = (sel) =>
                Array.from(document.querySelectorAll(sel)).every((el) => {
                    const cs = getComputedStyle(el);
                    return cs.display === 'none' || cs.visibility === 'hidden';
                });
            return {
                mountedInSharedHost: !!(root && host && host.contains(root)),
                toolbarHasPrint: !!(actions && printBtn && actions.contains(printBtn)),
                // v26.10.08-v14：弹窗与抽屉共用一种遮罩，统一用 data-znhd-mask 标记
                masksHidden: hidden('[data-znhd-mask]'),
            };
        });
        check('预览浮层挂在共享宿主 div #__znhd_preview_host__ 里（不是 body）', previewInfo.mountedInSharedHost);
        check('预览工具栏里有共享方式追加的「打印」按钮', previewInfo.toolbarHasPrint);
        check('预览期间下层遮罩被压掉（与脚本端同一份规则）', previewInfo.masksHidden);

        // 点打印 → react-to-print 建出 id=printWindow 的 iframe，且版式来自共享的 PRINT_PAGE_STYLE
        // ⚠️ 时序：react-to-print 是「先插 iframe、load 时才写入内容」，所以在**插入那一刻**读是空的，
        //    必须监听 iframe 自己的 load 事件（脚本端冒烟踩过同一个坑，这里照同一判据写）。
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
            const b = document.querySelector('[data-znhd-preview] button[aria-label="print"]');
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
