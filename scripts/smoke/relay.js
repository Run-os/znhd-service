/**
 * 中继服务端测试（纯 Node 内置模块，无第三方依赖）：多手机注册 + 按手机定向投递。
 *
 * 为什么单独有这个文件：`createChannel` 的投递逻辑是本仓库的历史踩坑重灾区（超时/断连/队头过期/
 * shift 后无人收丢条），而 `scripts/smoke/run.js` 走的是**浏览器里打桩的 GM_xmlhttpRequest**，
 * 根本碰不到真实服务端。定向投递（v26.10.06-v4 多手机）必须用真实 HTTP 长轮询来验。
 *
 * 覆盖：心跳必须带 phoneId（缺则 400）、/phone/status 返回手机列表、定向条目只投给目标手机、
 *      广播条目所有人都收、recv 缺 phoneId 回 400、正向 /u 上传带 phoneId → /recv 条目带 from
 *      （v26.10.13-v3：电脑端据此把内容归到对应手机的会话）；
 *      v26.10.14-v7 轮询优化：/recv 响应 piggyback 在线名单（P0-b）、手机上线主动唤醒
 *      挂起的长轮询（P0-a/P0-c）、且**不带 `phones=1` 的老客户端不被唤醒**（兼容红线）。
 *
 * 前置：无（自己拉起 server.js）。运行：npm run verify:relay
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

/**
 * 端口：默认**自动挑一个空闲端口**（而不是写死 5698）。
 * 写死端口会在「上一次测试的进程还没退、再跑一次」时直接 EADDRINUSE 崩掉
 * （v26.10.08-v10 实测踩到），自动取端口则永远不撞；需要固定端口时用 RELAY_TEST_PORT 覆盖。
 */
let PORT = Number(process.env.RELAY_TEST_PORT || 0);
function pickFreePort() {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.on('error', reject);
        s.listen(0, '127.0.0.1', () => {
            const p = s.address().port;
            s.close(() => resolve(p));
        });
    });
}

const HOST = '127.0.0.1';
const DEVICE = 'test-device-0001';
const PHONE_A = 'phone-aaaa-0001';
const PHONE_B = 'phone-bbbb-0002';
/** 专供「上下线主动唤醒」用例：独立设备，避免被 A/B 已注册的历史状态干扰 */
const DEVICE2 = 'test-device-0002';
const PHONE_C = 'phone-cccc-0003';
/** P3（v26.10.15-v1）专用设备：只在「maxwait 上限被放宽」那条慢断言里用，避免干扰其它等待集合 */
const P3_DEVICE = 'test-device-p3ck';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 裸请求（不解析 JSON）：返回 { status, type, body }，表情图片/文本断言用 */
function reqRaw(method, p) {
    return new Promise((resolve, reject) => {
        const r = http.request({ host: HOST, port: PORT, path: p, method }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
                resolve({
                    status: res.statusCode,
                    type: res.headers['content-type'] || '',
                    body: Buffer.concat(chunks).toString('utf8'),
                })
            );
        });
        r.on('error', reject);
        r.end();
    });
}

/** 普通请求：返回 { status, json } */
function req(method, p, body) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? null : JSON.stringify(body);
        const r = http.request(
            {
                host: HOST,
                port: PORT,
                path: p,
                method,
                headers: data
                    ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
                    : {},
            },
            (res) => {
                let b = '';
                res.setEncoding('utf8');
                res.on('data', (c) => (b += c));
                res.on('end', () => {
                    let j = null;
                    try {
                        j = JSON.parse(b);
                    } catch (e) {
                        j = null;
                    }
                    resolve({ status: res.statusCode, json: j });
                });
            }
        );
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}

/** 发起一次长轮询，返回可查询是否已结束/可中止的句柄 */
function poll(phoneId, maxwait = 2000) {
    let settled = false;
    let resolveFn;
    const promise = new Promise((res) => (resolveFn = res));
    const qs = phoneId === null ? `?maxwait=${maxwait}` : `?phoneId=${encodeURIComponent(phoneId)}&maxwait=${maxwait}`;
    const r = http.request({ host: HOST, port: PORT, path: `/phone/recv/${DEVICE}${qs}`, method: 'GET' }, (res) => {
        let b = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (b += c));
        res.on('end', () => {
            if (settled) return;
            settled = true;
            let j = null;
            try {
                j = JSON.parse(b);
            } catch (e) {
                j = null;
            }
            resolveFn(j);
        });
    });
    r.on('error', () => {
        if (settled) return;
        settled = true;
        resolveFn(null);
    });
    r.end();
    return {
        promise,
        isSettled: () => settled,
        abort: () => {
            try {
                r.destroy();
            } catch (e) {
                /* 忽略 */
            }
        },
    };
}

/** 发起一次正向（/recv）长轮询，返回可查询是否已结束/可中止的句柄 */
/**
 * @param {{device?:string, maxwait?:number, phones?:boolean}} [opt]
 *   `phones:true` = 带 `?phones=1` 协商标记（等价于 v26.10.14-v7 起的新客户端）；
 *   不带 = 模拟老客户端（服务端**不得**主动唤醒它）。
 */
function recvPoll(opt) {
    const o = opt || {};
    const device = o.device || DEVICE;
    const maxwait = o.maxwait || 2000;
    const qs = `?maxwait=${maxwait}` + (o.phones ? '&phones=1' : '');
    let settled = false;
    let resolveFn;
    const promise = new Promise((res) => (resolveFn = res));
    const r = http.request(
        { host: HOST, port: PORT, path: `/recv/${device}${qs}`, method: 'GET' },
        (res) => {
            let b = '';
            res.setEncoding('utf8');
            res.on('data', (c) => (b += c));
            res.on('end', () => {
                if (settled) return;
                settled = true;
                let j = null;
                try {
                    j = JSON.parse(b);
                } catch (e) {
                    j = null;
                }
                resolveFn(j);
            });
        }
    );
    r.on('error', () => {
        if (settled) return;
        settled = true;
        resolveFn(null);
    });
    r.end();
    return {
        promise,
        isSettled: () => settled,
        abort: () => {
            try {
                r.destroy();
            } catch (e) {
                /* 忽略 */
            }
        },
    };
}

const results = [];
function check(name, ok) {
    results.push({ name, ok });
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
}

async function main() {
    if (!PORT) PORT = await pickFreePort();
    process.env.PORT = String(PORT);

    // ===== 表情包 fixture（v26.10.14-v3）=====
    // emoji-store 在**被 require 时**读 ZNHD_EMOJI_SOURCES / ZNHD_EMOJI_DIR，故必须赶在
    // require(server.js) 之前设好；否则预热会去打真实的 cdn.klyang.com（冒烟不能依赖外网）。
    // 假 CDN 只服务回环 http（emoji-store 的 urlAllowed 放行 127.0.0.1），数据落临时目录。
    const cdnPort = await pickFreePort();
    const emojiDir = fs.mkdtempSync(path.join(os.tmpdir(), 'znhd-emoji-relay-'));
    const sourcesFile = path.join(os.tmpdir(), 'znhd-emoji-relay-sources-' + cdnPort + '.json');
    /** 假 CDN 上的图片内容（按文件名区分，供「内容原样回吐」断言） */
    const fixtureImg = (name) => Buffer.from('FAKE-EMOJI-IMAGE:' + name);
    const FIXTURE_PACKS = [
        {
            id: 'stubemoji',
            items: [
                { key: '01', file: 'stubemoji-01.png' },
                { key: '02', file: 'stubemoji-02.png' },
            ],
        },
        { id: 'stubtwo', items: [{ key: '01', file: 'stubtwo-01.webp' }] },
    ];
    fs.writeFileSync(
        sourcesFile,
        JSON.stringify(
            FIXTURE_PACKS.map((p) => ({ id: p.id, url: `http://127.0.0.1:${cdnPort}/json/${p.id}.json` }))
        )
    );
    const fixtureCdn = http.createServer((req, res) => {
        const pm = /^\/json\/([a-z0-9_-]+)\.json$/.exec(req.url || '');
        if (pm) {
            const p = FIXTURE_PACKS.find((x) => x.id === pm[1]);
            if (p) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(
                    JSON.stringify({
                        name: '桩合集-' + p.id,
                        type: 'image',
                        items: p.items.map((it) => ({
                            key: it.key,
                            val: `http://127.0.0.1:${cdnPort}/emo/${it.file}`,
                        })),
                    })
                );
                return;
            }
        }
        const im = /^\/emo\/([A-Za-z0-9._-]+)$/.exec(req.url || '');
        if (im) {
            res.writeHead(200, {
                'Content-Type': im[1].endsWith('.png') ? 'image/png' : 'image/webp',
            });
            res.end(fixtureImg(im[1]));
            return;
        }
        res.writeHead(404);
        res.end('not found');
    });
    await new Promise((r) => fixtureCdn.listen(cdnPort, '127.0.0.1', r));
    process.env.ZNHD_EMOJI_SOURCES = sourcesFile;
    process.env.ZNHD_EMOJI_DIR = emojiDir;

    // server.js 在 require 时就会 listen（并用 5s 定时器做离线扫描），故测试结束要显式 exit
    require(path.join(__dirname, '..', '..', 'relay-server', 'server.js'));
    await sleep(300); // 等 listen

    console.log(`中继服务端测试（多手机 + 定向投递，端口 ${PORT}）：`);

    // ===== P3（v26.10.15-v1）：长轮询 maxwait 上限 30000 → 60000 =====
    // 钳制值是个常量，「上限 30000」与「上限 60000」唯一的可观测差异就是**挂起时长**：
    // 旧上限下 maxwait=45000 会在第 30 秒被钳成 30000 而回 {empty:true}，新代码才会一直挂到 45s。
    // ⚠️ 故这条断言**必须等 ≥31s**（没有更短的区分手段，除非读源码文本）。
    //    为不额外拖长测试，探测在此**尽早启动**、与后面所有断言并行跑，末尾补足到 31s 再判定。
    const p3Start = Date.now();
    const p3Probe = recvPoll({ device: P3_DEVICE, maxwait: 45000 });

    // 1) 心跳必须带 phoneId
    const hbNoId = await req('POST', `/phone/heartbeat/${DEVICE}`, {});
    check('心跳缺 phoneId 回 400（不兼容老手机页）', hbNoId.status === 400);

    // 2) 两台手机注册
    const hbA = await req('POST', `/phone/heartbeat/${DEVICE}`, { phoneId: PHONE_A });
    const hbB = await req('POST', `/phone/heartbeat/${DEVICE}`, { phoneId: PHONE_B });
    check('手机 A 心跳 200', hbA.status === 200);
    check('手机 B 心跳 200', hbB.status === 200);

    // 3) 状态接口返回手机列表（online 字段保留给老脚本）
    const st = await req('GET', `/phone/status/${DEVICE}`);
    const phones = (st.json && st.json.phones) || [];
    check('status.online = true', !!(st.json && st.json.online === true));
    check('status 返回 2 台手机', phones.length === 2, JSON.stringify(phones.map((p) => p.id)));
    check(
        'status 手机列表含 A 与 B',
        phones.some((p) => p.id === PHONE_A) && phones.some((p) => p.id === PHONE_B)
    );

    // 4) recv 缺 phoneId 回 400
    const badPoll = await req('GET', `/phone/recv/${DEVICE}?maxwait=1000`);
    check('长轮询缺 phoneId 回 400', badPoll.status === 400);

    // ===== 4b) 轮询优化 P0-a / P0-b / P0-c（v26.10.14-v7）=====
    // P0-b：正向长轮询的**每个**响应都捎带在线手机名单。这里走的是 {empty:true} 超时路径
    // （此刻 DEVICE 队列为空，maxwait=1000 后到期返回）—— 超时路径最容易漏挂 decorate。
    const piggy = await recvPoll({ maxwait: 1000 }).promise;
    check(
        '/recv 超时响应捎带 phones 名单（P0-b piggyback，含 A 与 B）',
        !!piggy &&
            piggy.empty === true &&
            Array.isArray(piggy.phones) &&
            piggy.phones.length === 2 &&
            piggy.phones.some((p) => p.id === PHONE_A) &&
            piggy.phones.some((p) => p.id === PHONE_B)
    );

    // P0-c：手机**上线**时服务端主动结束挂起的长轮询（原实现没有任何唤醒能力）。
    // 用全新设备 DEVICE2：A/B 早已注册过，不会再触发 !wasOnline 那个钩子。
    const wakeSub = recvPoll({ device: DEVICE2, maxwait: 5000, phones: true });
    const wakeOld = recvPoll({ device: DEVICE2, maxwait: 1000, phones: false });
    await sleep(150); // 等两条长轮询注册进等待集合
    const t0 = Date.now();
    await req('POST', `/phone/heartbeat/${DEVICE2}`, { phoneId: PHONE_C });
    const woken = await Promise.race([wakeSub.promise, sleep(1500).then(() => undefined)]);
    const wakeMs = Date.now() - t0;
    check(
        '手机上线主动唤醒（P0-c）：带 phones=1 的长轮询被秒级结束，载荷含 type=phones',
        !!woken && woken.type === 'phones' && Array.isArray(woken.phones) && woken.phones.some((p) => p.id === PHONE_C)
    );
    check('唤醒延迟 < 1s（对比原实现的 5s 轮询粒度）', wakeMs < 1000, wakeMs + 'ms');

    // 兼容性红线：**不带** `phones=1` 的老客户端绝不被打扰（它不认识 type:'phones'，
    // 被唤醒只会 1s 后重连，反而放大请求数）。
    await sleep(400);
    check('老客户端（不带 phones=1）不被上下线事件唤醒', !wakeOld.isSettled());
    const oldTimedOut = await Promise.race([wakeOld.promise, sleep(1500).then(() => undefined)]);
    check('老客户端仍走正常超时路径（收到 empty）', !!(oldTimedOut && oldTimedOut.empty === true));
    wakeSub.abort();

    // 5) 定向：只发给 A，B 不能收到
    const pa = poll(PHONE_A);
    const pb = poll(PHONE_B);
    await sleep(150); // 等两个长轮询注册进等待集合
    await req('POST', `/phone/send/${DEVICE}`, { text: 'only-A', targets: [PHONE_A] });
    const gotA = await Promise.race([pa.promise, sleep(1500).then(() => undefined)]);
    await sleep(600);
    check('定向条目：A 收到', !!(gotA && gotA.text === 'only-A'));
    check('定向条目：B 未收到（继续等待）', !pb.isSettled());

    // 6) 广播：A、B 都收到（A 重新起一个长轮询）
    const pa2 = poll(PHONE_A);
    await sleep(150);
    await req('POST', `/phone/send/${DEVICE}`, { text: 'to-all' });
    const gotA2 = await Promise.race([pa2.promise, sleep(1500).then(() => undefined)]);
    const gotB = await Promise.race([pb.promise, sleep(1500).then(() => undefined)]);
    check('广播条目：A 收到', !!(gotA2 && gotA2.text === 'to-all'));
    check('广播条目：B 收到', !!(gotB && gotB.text === 'to-all'));

    // 7) 定向给 B、但 B 此刻没在轮询：条目留队列，等它下次上线轮询时取走（TTL 内）
    await req('POST', `/phone/send/${DEVICE}`, { text: 'for-B-later', targets: [PHONE_B] });
    await sleep(200);
    const pbLater = poll(PHONE_B);
    const gotBLater = await Promise.race([pbLater.promise, sleep(1500).then(() => undefined)]);
    check('离线期间发的定向条目：B 上线后取到', !!(gotBLater && gotBLater.text === 'for-B-later'));

    // 8) 正向通道：/u 上传带 phoneId → /recv 投递的条目带 from（v26.10.13-v3）。
    //    电脑端按 from 把内容归到对应手机的会话 —— 两台及以上在线也不再全进聚合会话。
    await req('POST', `/u/${DEVICE}`, { text: 'from-A', phoneId: PHONE_A });
    const gotFromA = await Promise.race([recvPoll().promise, sleep(1500).then(() => undefined)]);
    check(
        '正向条目带 from：/u 带 phoneId → /recv 收到 from=该手机 ID',
        !!(gotFromA && gotFromA.from === PHONE_A && gotFromA.text === 'from-A')
    );

    await req('POST', `/u/${DEVICE}`, { text: 'from-bad', phoneId: 'x' });
    const gotBad = await Promise.race([recvPoll().promise, sleep(1500).then(() => undefined)]);
    check('非法 phoneId 归一化为空 from（按未知发送者处理）', !!(gotBad && !gotBad.from && gotBad.text === 'from-bad'));

    await req('POST', `/u/${DEVICE}`, { text: 'from-none' });
    const gotNone = await Promise.race([recvPoll().promise, sleep(1500).then(() => undefined)]);
    check('不带 phoneId（老手机页）→ from 为空（旧归组规则兜底）', !!(gotNone && !gotNone.from && gotNone.text === 'from-none'));

    // 8b) 任意文件通道（v26.10.14-v6）：parseItemBody 按 mime 分流 ——
    //     image/* → type 'image'，其余 → type 'file'；缺 mime 兜底按图片处理（兼容老手机页）。
    await req('POST', `/u/${DEVICE}`, {
        name: 'report.pdf',
        mime: 'application/pdf',
        data: 'JVBERi0xLjQK',
        phoneId: PHONE_A,
    });
    const gotFile = await Promise.race([recvPoll().promise, sleep(1500).then(() => undefined)]);
    check(
        '非图片 mime → type=file（含 name/mime/data 原样回传）',
        !!(gotFile && gotFile.type === 'file' && gotFile.name === 'report.pdf' && gotFile.mime === 'application/pdf')
    );

    await req('POST', `/u/${DEVICE}`, { name: 'pic.png', mime: 'image/png', data: 'iVBORw0KGgo=' });
    const gotImg = await Promise.race([recvPoll().promise, sleep(1500).then(() => undefined)]);
    check(
        'image/* mime → type=image（分流未误伤图片）',
        !!(gotImg && gotImg.type === 'image' && gotImg.mime === 'image/png')
    );

    await req('POST', `/u/${DEVICE}`, { name: 'nomime.bin', data: 'AAECAwQ=' });
    const gotNoMime = await Promise.race([recvPoll().promise, sleep(1500).then(() => undefined)]);
    check(
        '缺 mime → 兜底 type=image（兼容老手机页）',
        !!(gotNoMime && gotNoMime.type === 'image' && gotNoMime.mime === 'image/jpeg')
    );

    // 8c) 体积上限提到 100MB（v26.10.14-v6）：约 20MB 的载荷（远超旧 12MB 上限）必须放行。
    //     用 20MB 而非满 100MB —— 冒烟要快，而这条断言的目的是「旧上限确实被抬掉了」。
    const bigB64 = 'A'.repeat(20 * 1024 * 1024);
    const bigRes = await req('POST', `/u/${DEVICE}`, { name: 'big.bin', mime: 'application/octet-stream', data: bigB64 });
    check('20MB 载荷放行（旧 12MB 上限已抬到 100MB）', !!(bigRes.json && bigRes.json.ok === true));
    // 消费掉这条大条目，避免它卡在队列里影响后续用例
    await Promise.race([recvPoll().promise, sleep(1500).then(() => undefined)]);

    // 8d) 超过 100MB 仍应回 413（上限不是「取消」而是「抬高」）
    const tooBig = 'A'.repeat(101 * 1024 * 1024);
    const tooBigRes = await req('POST', `/u/${DEVICE}`, { name: 'huge.bin', data: tooBig });
    check('超过 100MB 回 413（上限仍然生效）', tooBigRes.status === 413);

    // ===== 9) 表情包缓存服务（v26.10.14-v3）=====
    // 需求③的服务端一半：整套表情包拉到中继磁盘，客户端只打中继（防 CDN 限流 + 加速）。
    // fixture 见 main() 开头（假 CDN + 临时数据目录）。覆盖：预热就绪 / 合并清单形态 /
    // 图片服务（MIME + 内容原样）/ 按需补图 / 目录穿越与非法名 / refresh 限流 /
    // emoji 标记随正向条目回传（需求①的服务端一半）。
    let emojiReady = false;
    for (let i = 0; i < 60 && !emojiReady; i++) {
        await sleep(250);
        const s = await req('GET', '/emoji/status');
        emojiReady = !!(s.json && s.json.ready === true);
    }
    check('表情包预热就绪（/emoji/status.ready=true）', emojiReady);

    const stEmoji = await req('GET', '/emoji/status');
    check(
        '表情包状态：2 个合集 3 张全部缓存（packs/items/cached/missing）',
        !!stEmoji.json &&
            stEmoji.json.packs === 2 &&
            stEmoji.json.items === 3 &&
            stEmoji.json.cached === 3 &&
            stEmoji.json.missing === 0
    );

    const packsJson = await req('GET', '/emoji/packs.json');
    check(
        '/emoji/packs.json 合并清单：2 包，条目带 path（/emoji/<包>/<文件>）与 src（CDN 原址）',
        !!packsJson.json &&
            Array.isArray(packsJson.json.packs) &&
            packsJson.json.packs.length === 2 &&
            packsJson.json.packs.every(
                (p) =>
                    Array.isArray(p.items) &&
                    p.items.length > 0 &&
                    p.items.every(
                        (it) =>
                            /^\/emoji\/[a-z0-9_-]+\/[a-z0-9._-]+$/.test(it.path || '') &&
                            /^http:\/\/127\.0\.0\.1:\d+\/emo\//.test(it.src || '')
                    )
            )
    );

    const imgPng = await reqRaw('GET', '/emoji/stubemoji/stubemoji-01.png');
    check(
        '表情图片服务：200 + image/png + 内容与 CDN 原样一致',
        imgPng.status === 200 && imgPng.type === 'image/png' && imgPng.body === fixtureImg('stubemoji-01.png').toString()
    );

    // 按需补图：预热已缓存过，删掉文件再请求 → 服务端自动从 CDN 补回（single-flight 同语义）
    const backfillFile = path.join(emojiDir, 'stubtwo', 'stubtwo-01.webp');
    fs.unlinkSync(backfillFile);
    const backfill = await reqRaw('GET', '/emoji/stubtwo/stubtwo-01.webp');
    check(
        '按需补图：删掉缓存文件后请求自动从 CDN 补回（文件重建 + 200）',
        backfill.status === 200 && fs.existsSync(backfillFile)
    );

    // 目录穿越 / 非法名：URL 形态不进路由正则或不过 validFileName，一律 403/404，绝不吐文件内容
    const trav = await req('GET', '/emoji/stubemoji/..%2f..%2femoji-sources.json');
    check('目录穿越防护：/emoji/<包>/..%2f.. 形态 404（不进路由正则）', trav.status === 404);
    const badExt = await req('GET', '/emoji/stubemoji/stubemoji-01.txt');
    check('非法扩展名 403（.txt 不在图片白名单）', badExt.status === 403);
    const noSuch = await req('GET', '/emoji/stubemoji/stubemoji-99.png');
    check('清单中不存在的图 404（客户端据此回退 CDN src）', noSuch.status === 404);

    const rf1 = await req('POST', '/emoji/refresh');
    const rf2 = await req('POST', '/emoji/refresh');
    check('POST /emoji/refresh：首次 200，60s 内二次 429（限流）', rf1.status === 200 && rf2.status === 429);

    // emoji 标记（需求①）：手机端/脚本端发表情时载荷带 emoji:true，服务端写进条目随投递回传
    await req('POST', `/u/${DEVICE}`, { name: 'e.png', mime: 'image/png', data: 'iVBORw0KGgo=', emoji: true, phoneId: PHONE_A });
    const gotEmoji = await Promise.race([recvPoll().promise, sleep(1500).then(() => undefined)]);
    check('表情标记随正向条目回传：emoji=true', !!(gotEmoji && gotEmoji.emoji === true));
    await req('POST', `/u/${DEVICE}`, { name: 'n.png', mime: 'image/png', data: 'iVBORw0KGgo=', phoneId: PHONE_A });
    const gotPlain = await Promise.race([recvPoll().promise, sleep(1500).then(() => undefined)]);
    check('普通图片不带表情标记：emoji=false', !!(gotPlain && gotPlain.emoji === false));

    pa.abort();
    pb.abort();
    pa2.abort();

    // ===== P3 判定（探测句柄见 main() 开头，与上面所有断言并行跑了 31s）=====
    // 发的是 maxwait=45000：若服务端上限仍是 30000，它早在第 30 秒就回 {empty:true} 了。
    await sleep(Math.max(0, 31000 - (Date.now() - p3Start)));
    check(
        'P3：/recv?maxwait=45000 未被钳到旧的 30000 上限（31s 后仍挂起；旧上限会在 30s 返回 empty）',
        !p3Probe.isSettled()
    );
    p3Probe.abort();

    // 收尾：关假 CDN、清临时目录与清单文件（都是本次测试自建的，不碰真实数据）
    fixtureCdn.close();
    try {
        fs.rmSync(emojiDir, { recursive: true, force: true });
        fs.unlinkSync(sourcesFile);
    } catch (e) {
        /* 临时文件清不掉无害（在 os.tmpdir() 里） */
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length) {
        console.error(`\n❌ 中继服务端测试未通过（${failed.map((f) => f.name).join('、')}）`);
        process.exit(1);
    }
    console.log('\n✅ 中继服务端测试通过（relay:ALL-OK）');
    process.exit(0);
}

main().catch((e) => {
    console.error('❌ 中继服务端测试执行失败：' + (e && e.message ? e.message : e));
    process.exit(1);
});
