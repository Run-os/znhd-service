/**
 * 中继服务端测试（纯 Node 内置模块，无第三方依赖）：多手机注册 + 按手机定向投递。
 *
 * 为什么单独有这个文件：`createChannel` 的投递逻辑是本仓库的历史踩坑重灾区（超时/断连/队头过期/
 * shift 后无人收丢条），而 `scripts/smoke/run.js` 走的是**浏览器里打桩的 GM_xmlhttpRequest**，
 * 根本碰不到真实服务端。定向投递（v26.10.06-v4 多手机）必须用真实 HTTP 长轮询来验。
 *
 * 覆盖：心跳必须带 phoneId（缺则 400）、/phone/status 返回手机列表、定向条目只投给目标手机、
 *      广播条目所有人都收、recv 缺 phoneId 回 400。
 *
 * 前置：无（自己拉起 server.js）。运行：npm run verify:relay
 */
const http = require('http');
const path = require('path');

const PORT = Number(process.env.RELAY_TEST_PORT || 5698);
process.env.PORT = String(PORT);
// server.js 在 require 时就会 listen（并用 5s 定时器做离线扫描），故测试结束要显式 exit
require(path.join(__dirname, '..', '..', 'relay-server', 'server.js'));

const HOST = '127.0.0.1';
const DEVICE = 'test-device-0001';
const PHONE_A = 'phone-aaaa-0001';
const PHONE_B = 'phone-bbbb-0002';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const results = [];
function check(name, ok) {
    results.push({ name, ok });
    console.log(`  ${ok ? '✅' : '❌'} ${name}`);
}

async function main() {
    await sleep(300); // 等 listen

    console.log('中继服务端测试（多手机 + 定向投递）：');

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

    pa.abort();
    pb.abort();
    pa2.abort();

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
