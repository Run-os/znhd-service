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
/** P4（v26.10.15-v2）专用设备与三台手机（心跳并入长轮询）；与 P3 共用同一个 31s 等待窗口 */
const P4_DEVICE = 'test-device-p4ck';
const PHONE_D = 'phone-dddd-0004'; // 挂起 25s 且不被投递 ⇒ 验「挂起中仍在线」
const PHONE_E = 'phone-eeee-0005'; // 挂起后立刻收到定向条目 ⇒ 验「有消息立即返回」
const PHONE_F = 'phone-ffff-0006'; // 只报活一次、之后不再续 ⇒ 验离线判定没被废掉

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
                headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {},
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
    const r = http.request({ host: HOST, port: PORT, path: `/recv/${device}${qs}`, method: 'GET' }, (res) => {
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

/**
 * 发起一次 `POST /phone/poll/<device>?maxwait=` —— v26.10.15-v2（P4）的新端点：
 * **报活 + 收件合一**（手机端只挂这一条连接，替代「8s 心跳 + /phone/recv」两条）。
 * 返回与 `recvPoll` 同形的句柄。用它才能真验 P4 唯一的风险点 ——「挂起中算在线」。
 */
function phonePoll(device, phoneId, maxwait = 2000) {
    let settled = false;
    let resolveFn;
    const promise = new Promise((res) => (resolveFn = res));
    const body = JSON.stringify({ phoneId: phoneId });
    const r = http.request(
        {
            host: HOST,
            port: PORT,
            path: `/phone/poll/${device}?maxwait=${maxwait}`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        },
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
    r.write(body);
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

    // ===== P4（v26.10.15-v2）：心跳并入长轮询（POST /phone/poll）=====
    // ⚠️ 这组断言与上面的 P3 探测**共用同一个 31s 等待窗口**（两者都必须真等，串起来要 50s+）。
    // 布局：D 挂起 25s 且期间不投递给它（验「挂起中仍在线」）；E 挂起后立刻收到定向条目
    // （验「有消息立即返回」+ 定向语义没变）；F 只报活一次、之后不再续（验「挂起中算在线」
    // 没有把离线判定整个废掉 —— 只做加法不做减法才是对的）。
    const p4D = phonePoll(P4_DEVICE, PHONE_D, 25000);
    const p4E = phonePoll(P4_DEVICE, PHONE_E, 25000);
    const hbF = await req('POST', `/phone/heartbeat/${P4_DEVICE}`, { phoneId: PHONE_F });
    check('P4：老端点 /phone/heartbeat 仍照常工作（老手机页完全不受影响）', hbF.status === 200);
    await sleep(250); // 等两个 poll 注册进等待集合
    await req('POST', `/phone/send/${P4_DEVICE}`, { text: 'p4-only-E', targets: [PHONE_E] });
    const gotE = await p4E.promise;
    check('P4：/phone/poll 有消息时立即返回（定向条目只给目标手机）', !!(gotE && gotE.text === 'p4-only-E'));
    check('P4：非目标手机的 poll 继续挂起（定向投递语义未变）', !p4D.isSettled());
    const p4NoId = await req('POST', `/phone/poll/${P4_DEVICE}`, {});
    check('P4：/phone/poll 缺 phoneId 回 400（与心跳同一套身份校验）', p4NoId.status === 400);
    const p4List = await req('GET', `/phone/status/${P4_DEVICE}`);
    const ids4 = (p4List.json && p4List.json.phones) || [];
    check(
        'P4：/phone/poll 也登记在线（名单含挂起中的 D 与已收件的 E）',
        ids4.some((p) => p.id === PHONE_D) && ids4.some((p) => p.id === PHONE_E)
    );

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
    // 审计合并：online 是 legacy 派生字段（= phones.length > 0），单列一条与「2 台手机」重叠，
    // 合成一条同时守住「派生值正确」与「名单长度正确」
    check(
        'status 返回 2 台手机且 online=true（legacy 字段派生自名单）',
        !!(st.json && st.json.online === true) && phones.length === 2,
        JSON.stringify(phones.map((p) => p.id))
    );
    check('status 手机列表含 A 与 B', phones.some((p) => p.id === PHONE_A) && phones.some((p) => p.id === PHONE_B));

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
    check(
        '不带 phoneId（老手机页）→ from 为空（旧归组规则兜底）',
        !!(gotNone && !gotNone.from && gotNone.text === 'from-none')
    );

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
    const bigRes = await req('POST', `/u/${DEVICE}`, {
        name: 'big.bin',
        mime: 'application/octet-stream',
        data: bigB64,
    });
    check('20MB 载荷放行（旧 12MB 上限已抬到 100MB）', !!(bigRes.json && bigRes.json.ok === true));
    // 消费掉这条大条目，避免它卡在队列里影响后续用例
    await Promise.race([recvPoll().promise, sleep(1500).then(() => undefined)]);

    // 8d) 超过 100MB 仍应回 413（上限不是「取消」而是「抬高」）
    const tooBig = 'A'.repeat(101 * 1024 * 1024);
    const tooBigRes = await req('POST', `/u/${DEVICE}`, { name: 'huge.bin', data: tooBig });
    check('超过 100MB 回 413（上限仍然生效）', tooBigRes.status === 413);

    pa.abort();
    pb.abort();
    pa2.abort();

    // ===== P4 判定（句柄见 main() 开头，与上面所有断言并行跑了 20 多秒）=====
    // 等到 t≈23s：既在 P3 的 31s 窗口内，又刚好越过 PHONE_TTL(20s) —— 这正是要验的边界。
    await sleep(Math.max(0, 23000 - (Date.now() - p3Start)));
    const st4 = await req('GET', `/phone/status/${P4_DEVICE}`);
    const ids4b = (st4.json && st4.json.phones) || [];
    check(
        'P4：挂起中的 poll 超过 PHONE_TTL(20s) 仍算在线（否则正常在线的手机每 20s 就被误判离线）',
        ids4b.some((p) => p.id === PHONE_D)
    );
    check(
        'P4：只报活一次、不再续的手机超过 PHONE_TTL 后照常判离线（「挂起中算在线」没废掉离线判定）',
        !ids4b.some((p) => p.id === PHONE_F)
    );
    const p4Dres = await p4D.promise; // 25s 到点，回 empty
    check('P4：/phone/poll 无消息时挂满 maxwait 回 {empty:true}', !!(p4Dres && p4Dres.empty === true));

    // ===== P3 判定（探测句柄见 main() 开头，与上面所有断言并行跑了 31s）=====
    // 发的是 maxwait=45000：若服务端上限仍是 30000，它早在第 30 秒就回 {empty:true} 了。
    await sleep(Math.max(0, 31000 - (Date.now() - p3Start)));
    check(
        'P3：/recv?maxwait=45000 未被钳到旧的 30000 上限（31s 后仍挂起；旧上限会在 30s 返回 empty）',
        !p3Probe.isSettled()
    );
    p3Probe.abort();

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
