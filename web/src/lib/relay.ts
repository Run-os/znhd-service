/**
 * 中继客户端：报活 + 长轮询（取电脑发来的内容）+ 上传。
 *
 * P4（v26.10.15-v2）：**报活与取件已合并**成一条 `POST /phone/poll/<deviceId>`
 * （原来是「8s 心跳 + 45s 长轮询」两条连接并行，8 小时里心跳是 3600 次请求）。
 * 老中继没有该端点时会自动降级回老模型（见 `tick()` 的 404 分支与 `startHeartbeat()`）。
 *
 * 三条实测结论，勿随手改：
 *  1) heartbeat（现仅 legacy 降级路径使用）用 Promise.race 做硬性 8s 超时
 *     （不依赖 AbortController —— 部分老旧 WebView 不支持/不触发）；
 *  2) 长轮询在**读取响应体之前绝不能 abort()**：会让随后的 r.json() 抛 AbortError，
 *     每次投递都被 catch 吞掉并重连，表现为「电脑显示发送成功、手机永远收不到」。
 *     abort 只允许出现在「看门狗超时、原请求还挂着」的 catch 分支。
 *  3) ⚠️ 未被确认连上时要走 1s 短探测（`confirmed`）：P4 之后手机页没有「8s 心跳」
 *     这种快速探针了，若一上来就挂 45s，用户要等 45 秒才能看到「已连接」。
 */

// 重试退避：与脚本端（src/）共用同一份算法（v26.10.14-v8），避免两端各写一份后漂移
import { nextRetryDelay } from '../../../shared/kit/backoff';

export interface RecvItem {
    /** v26.10.14-v6：'file' = 任意非图片文件（中继按 mime 分流） */
    type?: 'image' | 'file' | 'text';
    data?: string;
    mime?: string;
    name?: string;
    text?: string;
    ts?: number;
}

export interface ConnState {
    state: 'online' | 'offline' | 'error';
    msg?: string;
}

/** 从 /u/<deviceId> 路径里取设备 ID（与中继路由的正则保持一致） */
export function parseDeviceId(pathname: string): string {
    const m = /\/u\/([a-z0-9-]{8,64})/i.exec(pathname);
    return m ? m[1] : '';
}

/** 本机（手机）设备 ID 的 localStorage 键 */
const PHONE_ID_KEY = 'znhd_phone_id';

/**
 * 取本机（手机）稳定设备 ID：首次打开生成并持久化在 localStorage，刷新/重开不变。
 *
 * 为什么需要它：一台电脑可能被多台手机同时连上（都由同一个 `/u/<电脑ID>` 链接进入），
 * 服务端要靠它区分「哪台手机在线」，电脑端才能显示手机数量、并把图片只发给选中的手机。
 * ⚠️ 换浏览器 / 清缓存 / 无痕窗口会得到新 ID（等价于「换了一台手机」）。
 */
export function getPhoneId(): string {
    try {
        let id = localStorage.getItem(PHONE_ID_KEY) || '';
        if (!/^[a-zA-Z0-9_-]{8,64}$/.test(id)) {
            id =
                typeof crypto !== 'undefined' && crypto.randomUUID
                    ? crypto.randomUUID()
                    : 'p' + Date.now().toString(16) + Math.random().toString(16).slice(2);
            localStorage.setItem(PHONE_ID_KEY, id);
        }
        return id;
    } catch (e) {
        // localStorage 不可用（隐私模式等）：退回进程内随机 ID，功能可用但刷新后算新设备
        return 'p' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    }
}

/** Blob → base64（不带 dataURL 前缀） */
export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => {
            const s = String(fr.result || '');
            resolve(s.split(',')[1] || '');
        };
        fr.onerror = () => reject(new Error('读取图片失败'));
        fr.readAsDataURL(blob);
    });
}

/**
 * POST 一条内容到本设备的中继路径（图片 {name,mime,data} / 文本 {text}）。
 * phoneId（v26.10.13-v3）：带上本机手机 ID，服务端会把它写进条目的 `from` 随投递回传，
 * 电脑端据此把内容归到**这台手机**的会话 —— 多台手机同时在线也不再全挤进聚合会话。
 *
 * v26.10.18-v1：fetch 改 XMLHttpRequest —— 大文件上传需要 `xhr.upload.onprogress`
 * 逐事件回写气泡进度条，fetch 的请求体进度没有跨浏览器观测面。
 * onProgress 只在上传阶段触发；不传时行为与旧 fetch 版本完全一致。
 * 本页与中继同源（页面就托管在中继上），XHR 没有跨域/CSP 顾虑。
 */
export function postItem(
    payload: Record<string, unknown>,
    phoneId?: string,
    onProgress?: (percent: number) => void
): Promise<{ ok?: boolean; error?: string }> {
    const body = phoneId ? { ...payload, phoneId } : payload;
    return new Promise((resolve) => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', window.location.pathname);
            xhr.setRequestHeader('Content-Type', 'application/json');
            if (onProgress) {
                xhr.upload.onprogress = (ev) => {
                    if (ev.lengthComputable && ev.total > 0) onProgress(Math.round((ev.loaded / ev.total) * 100));
                };
            }
            xhr.onload = () => {
                let j: { ok?: boolean; error?: string } | null = null;
                try {
                    j = JSON.parse(xhr.responseText);
                } catch (e) {
                    j = null;
                }
                if (j) resolve(j);
                else resolve({ ok: false, error: 'HTTP ' + xhr.status });
            };
            xhr.onerror = () => resolve({ ok: false, error: '网络错误' });
            xhr.send(JSON.stringify(body));
        } catch (e: any) {
            resolve({ ok: false, error: (e && e.message) || '网络错误' });
        }
    });
}

export interface RelayOptions {
    deviceId: string;
    /** 本机（手机）设备 ID：心跳与长轮询都要带，服务端据此区分多台手机 */
    phoneId: string;
    onConn: (s: ConnState) => void;
    onItem: (item: RecvItem) => void;
}

/**
 * 启动心跳与长轮询，返回停止函数（组件卸载时调用）。
 * @param opts 设备 ID 与回调
 */
export function startPhoneRelay(opts: RelayOptions): () => void {
    const { deviceId, phoneId, onConn, onItem } = opts;
    let stopped = false;
    const timers = new Set<number>();
    // P5（v26.10.14-v8）：当前退避值。0 = 上一轮成功；失败时由 nextRetryDelay 递增到 60s 封顶。
    let retryDelay = 0;
    /** HTTP 层失败的哨兵：告诉下一个 then「重试已经安排好了，别再往下走一遍」 */
    const HTTP_FAIL: unique symbol = Symbol('znhd-http-fail');
    // P4（v26.10.15-v2）：心跳并入长轮询 —— 手机端只挂**一条**连接。
    //   'unknown'：还没探过新端点，先试 `POST /phone/poll`；
    //   'poll'   ：新模型（报活 + 收件合一）；
    //   'legacy' ：老中继没有 /phone/poll（404）⇒ 降级回「8s 心跳 + /phone/recv」两条连接，
    //              即 P4 之前的行为。降级是**永久**的（同一会话内不再回头试新端点）。
    let mode: 'unknown' | 'poll' | 'legacy' = 'unknown';
    /** 是否已成功连上过。未确认前每轮都用极短 maxwait 探测，好让「已连接」尽快出现 */
    let confirmed = false;
    /** legacy 模式的独立心跳定时器（新模型用不到它） */
    let hbTimer: number | null = null;

    const later = (fn: () => void, ms: number) => {
        const t = window.setTimeout(() => {
            timers.delete(t);
            if (!stopped) fn();
        }, ms);
        timers.add(t);
    };

    function heartbeat() {
        if (stopped) return;
        if (!deviceId) {
            onConn({ state: 'error', msg: '链接无效：未识别到设备ID，请重新生成二维码' });
            return;
        }
        const ctrl = 'AbortController' in window ? new AbortController() : null;
        const opt: RequestInit = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // v26.10.06-v4：心跳必须带上本机手机 ID，服务端才能区分「哪台手机在线」
            body: JSON.stringify({ phoneId: phoneId }),
        };
        if (ctrl) opt.signal = ctrl.signal;
        const timeout = new Promise<Response>((_, rej) => {
            later(() => rej(new Error('timeout')), 8000);
        });
        Promise.race([fetch('/phone/heartbeat/' + deviceId, opt), timeout])
            .then((r: any) => {
                if (ctrl) ctrl.abort();
                if (stopped) return;
                if (r && r.ok) onConn({ state: 'online' });
                else if (r && r.status === 400)
                    onConn({ state: 'error', msg: '手机页面版本过旧或设备ID无效，请刷新页面后重试' });
                else onConn({ state: 'error', msg: '服务器返回 ' + (r && r.status) + '，请检查中继地址/代理' });
            })
            .catch((err: any) => {
                if (ctrl) ctrl.abort();
                if (stopped) return;
                const m =
                    err && err.message === 'timeout'
                        ? '连接超时（8秒无响应，请检查网络/代理/防火墙）'
                        : '连接失败：' + ((err && err.message) || '未知错误');
                onConn({ state: 'error', msg: m });
            });
    }

    /** legacy 模式的独立心跳（只有降级后才启动；新模型用不到） */
    function startHeartbeat() {
        if (hbTimer !== null) return;
        heartbeat();
        hbTimer = window.setInterval(() => {
            if (!stopped) heartbeat();
        }, 8000);
    }

    /**
     * 一轮「报活 + 取件」。
     *
     * P4（v26.10.15-v2）：新模型是一次 `POST /phone/poll/<deviceId>` 同时干两件事
     * （挂起等电脑发来的内容 **+** 声明本机在线），手机上只挂这一条连接 —— 原来并行的
     * 「8s 心跳」整条消失。老中继没有该端点（404）时自动降级为 `GET /phone/recv/<deviceId>`
     * 并由 `startHeartbeat()` 补回那条心跳，即完全退回 P4 之前的行为。
     *
     * ⚠️ 未被确认连上（`confirmed === false`）时用**极短 maxwait（1s）**探测：新模型下手机页
     * 不再有「8s 心跳」这种快速探针，若一上来就挂 45 秒，用户要等 45 秒才看到「已连接」
     * （旧行为是 ≤8s）。用 1s 探测后，~1s 内即可确认（比旧行为还快）。
     */
    function tick() {
        if (stopped || !deviceId) return;
        const legacy = mode === 'legacy';
        const maxwait = confirmed ? 45000 : 1000;
        const ctrl = 'AbortController' in window ? new AbortController() : null;
        const opt: RequestInit = legacy
            ? { method: 'GET' }
            : {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  // v26.10.06-v4：必须带上本机手机 ID，服务端才能区分「哪台手机在线」；
                  // P4 起它同时是长轮询的定向投递身份（服务端从 body 取，而不是 URL）
                  body: JSON.stringify({ phoneId: phoneId }),
              };
        if (ctrl) opt.signal = ctrl.signal;
        const url = legacy
            ? '/phone/recv/' + deviceId + '?phoneId=' + encodeURIComponent(phoneId) + '&maxwait=' + maxwait
            : '/phone/poll/' + deviceId + '?maxwait=' + maxwait;
        // 看门狗：服务器 maxwait=45s 到期必回 empty；被系统冻结/代理卡住时 maxwait+5s 强制重连，
        // 避免接收静默停摆（必须大于 maxwait，保持既有的 maxwait + 5s 节奏）。
        // P3（v26.10.15-v1）：maxwait 25s→45s，看门狗 35s→55s 同步；
        // P4：探测轮（1s）配 6s 看门狗，别让一次探测挂到 55 秒。
        const watchdog = new Promise<Response>((_, rej) => {
            later(() => rej(new Error('timeout')), maxwait + 5000);
        });
        Promise.race([fetch(url, opt), watchdog])
            .then((r: any) => {
                // 降级：老中继没有 /phone/poll ⇒ 404。切回「心跳 + /phone/recv」并立即重开一轮。
                // ⚠️ 只在 'unknown' 时判 —— 已经锁定新模型后即便偶发 404（如反代配错）也不来回横跳。
                if (!legacy && mode === 'unknown' && r && r.status === 404) {
                    mode = 'legacy';
                    startHeartbeat();
                    retryDelay = 0;
                    later(tick, 0);
                    return HTTP_FAIL;
                }
                // P5（v26.10.14-v8）：429（服务端明确要求放缓）/ 5xx（服务端故障或重启）→ 退避后重连，
                // **不**解析响应体。旧实现固定 1.5s 重试，中继重启时所有手机同节奏敲门。
                // ⚠️ 判据放在这里（r.json() 之前）—— 否则会把错误页当 JSON 解析，落到下面的 catch，
                //    那一路同样是重连，但会把 5xx 当成「网络抖动」，退避起步值也拿不到 429 的语义。
                if (r && (r.status === 429 || r.status >= 500)) {
                    retryDelay = nextRetryDelay(retryDelay, r.status);
                    onConn({ state: 'error', msg: '服务器返回 ' + r.status + '，请检查中继地址/代理' });
                    later(tick, retryDelay);
                    return HTTP_FAIL;
                }
                // 400 = phoneId 不合法或页面版本过旧（服务端明确拒收）⇒ 温和重试，别退避到 60s
                if (r && r.status === 400) {
                    onConn({ state: 'error', msg: '手机页面版本过旧或设备ID无效，请刷新页面后重试' });
                    later(tick, 10000);
                    return HTTP_FAIL;
                }
                if (r && !r.ok) {
                    onConn({ state: 'error', msg: '服务器返回 ' + r.status + '，请检查中继地址/代理' });
                    later(tick, 10000);
                    return HTTP_FAIL;
                }
                if (mode === 'unknown') mode = 'poll'; // 首次成功即锁定新模型
                // ⚠️ 不要在这里 abort（见文件头说明 2）
                return r.json();
            })
            .then((j: RecvItem | typeof HTTP_FAIL) => {
                if (stopped) return;
                if (j === HTTP_FAIL) return; // HTTP 层失败：重试已排好，不再往下走
                retryDelay = 0; // 拿到正常响应 ⇒ 退避复位（下次失败重新从 2s 起）
                confirmed = true; // 已确认连上 ⇒ 之后用正常的长 maxwait
                onConn({ state: 'online' }); // P4：连接状态改由长轮询本身驱动（原来靠 8s 心跳）
                if (j && j.type) onItem(j);
                tick();
            })
            .catch((err: any) => {
                if (stopped) return;
                if (ctrl) ctrl.abort();
                // P5：网络层失败（fetch 抛错 / 看门狗超时 / 解析异常）按指数退避重连
                retryDelay = nextRetryDelay(retryDelay);
                onConn({
                    state: 'error',
                    msg:
                        err && err.message === 'timeout'
                            ? '连接超时（请检查网络/代理/防火墙）'
                            : '连接失败，正在重试…',
                });
                later(tick, retryDelay);
            });
    }

    tick();

    return () => {
        stopped = true;
        if (hbTimer !== null) window.clearInterval(hbTimer);
        timers.forEach((t) => window.clearTimeout(t));
        timers.clear();
    };
}
