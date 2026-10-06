/**
 * 中继客户端：心跳（声明手机在线）+ 长轮询（取电脑发来的内容）+ 上传。
 * 逻辑逐条移植自旧版页面的内联脚本，含两处实测结论，勿随手改：
 *  1) heartbeat 用 Promise.race 做硬性 8s 超时（不依赖 AbortController——部分老旧 WebView 不支持/不触发）；
 *  2) pollRecv 在**读取响应体之前绝不能 abort()**：会让随后的 r.json() 抛 AbortError，
 *     每次投递都被 catch 吞掉并重连，表现为「电脑显示发送成功、手机永远收不到」。
 *     abort 只允许出现在「看门狗超时、原请求还挂着」的 catch 分支。
 */

export interface RecvItem {
    type?: 'image' | 'text';
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

/** POST 一条内容到本设备的中继路径（图片 {name,mime,data} / 文本 {text}） */
export function postItem(payload: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
    return fetch(window.location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then((r) => r.json())
        .catch((e: any) => ({ ok: false, error: (e && e.message) || '网络错误' }));
}

export interface RelayOptions {
    deviceId: string;
    onConn: (s: ConnState) => void;
    onItem: (item: RecvItem) => void;
}

/**
 * 启动心跳与长轮询，返回停止函数（组件卸载时调用）。
 * @param opts 设备 ID 与回调
 */
export function startPhoneRelay(opts: RelayOptions): () => void {
    const { deviceId, onConn, onItem } = opts;
    let stopped = false;
    const timers = new Set<number>();

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
        const opt: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
        if (ctrl) opt.signal = ctrl.signal;
        const timeout = new Promise<Response>((_, rej) => {
            later(() => rej(new Error('timeout')), 8000);
        });
        Promise.race([fetch('/phone/heartbeat/' + deviceId, opt), timeout])
            .then((r: any) => {
                if (ctrl) ctrl.abort();
                if (stopped) return;
                if (r && r.ok) onConn({ state: 'online' });
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

    function pollRecv() {
        if (stopped || !deviceId) return;
        const ctrl = 'AbortController' in window ? new AbortController() : null;
        const opt: RequestInit = { method: 'GET' };
        if (ctrl) opt.signal = ctrl.signal;
        // 看门狗：服务器 maxwait=25s 到期必回 empty；被系统冻结/代理卡住时 35s 强制重连，
        // 避免接收静默停摆（必须大于 maxwait）。
        const watchdog = new Promise<Response>((_, rej) => {
            later(() => rej(new Error('timeout')), 35000);
        });
        Promise.race([fetch('/phone/recv/' + deviceId + '?maxwait=25000', opt), watchdog])
            .then((r: any) => {
                // ⚠️ 不要在这里 abort（见文件头说明 2）
                return r.json();
            })
            .then((j: RecvItem) => {
                if (stopped) return;
                if (j && j.type) onItem(j);
                pollRecv();
            })
            .catch(() => {
                if (stopped) return;
                if (ctrl) ctrl.abort();
                later(pollRecv, 1500);
            });
    }

    heartbeat();
    const hbTimer = window.setInterval(() => {
        if (!stopped) heartbeat();
    }, 8000);

    pollRecv();

    return () => {
        stopped = true;
        window.clearInterval(hbTimer);
        timers.forEach((t) => window.clearTimeout(t));
        timers.clear();
    };
}
