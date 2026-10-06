import { addLog } from '@/lib/logger';

/**
 * 设备互联中继客户端（手机 → 电脑）与图片剪贴板工具。
 * 模块化 P4：逐字迁移，仅加 export（内部使用的不导出）。
 * 说明：长轮询而非 WebSocket 是为了绕过税务页 CSP 对 connect-src 的限制。
 */

// ========== 手机图片 → 电脑剪贴板 ==========
// 每台电脑/每个脚本安装实例一个稳定 deviceId（持久化，刷新不变），
// 拼出上传链接 <relayServer>/u/<deviceId>；手机打开该链接上传，电脑端长轮询取走。
const DEVICE_ID_KEY = 'znhd_device_id';
// 单请求体上限，须与 relay-server 的 MAX_BODY 保持一致（服务端按「整段 JSON 体积」掐断）。
// 发图前据此预检体积，避免 base64 膨胀后超过上限，被服务端拒绝时只见笼统的网络/服务器错误。
export const RELAY_MAX_BODY = 12 * 1024 * 1024;
/**
 * 估算把该文件作为一条 POST body（含 name+mime+base64(data) 与 JSON 结构开销）的体积。
 * 仅用于「发送到手机」发前预检，与服务端 MAX_BODY 对齐（约 12MB）。
 * @param {File} file - 待发图片文件
 * @param {string} [name] - 文件名
 * @param {string} [mime] - MIME 类型
 * @returns {number} 估算的 body 字节数
 */
export function imagePayloadBytes(file: any, name: any, mime: any) {
    const b64Len = Math.ceil(((file && file.size) || 0) / 3) * 4; // base64 膨胀 ≈ 4/3
    // name/mime 按 UTF-8 字节数计（服务端 readBody 按字节累加；String.length 是 UTF-16 码元，
    // 中文文件名会低估约 3 倍，接近上限时预检可能误放行）
    const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null;
    const byteLen = enc
        ? enc.encode(String(name || '') + String(mime || '')).length
        : (String(name || '') + String(mime || '')).length;
    return b64Len + byteLen + 120;
}
/**
 * 取得本机稳定设备 ID：首次运行用 crypto.randomUUID() 生成并持久化（GM_setValue），
 * 之后刷新/重开都读同一值。用于区分不同电脑（A、B 各自不同链接）。
 * @returns {string} 设备 UUID 字符串
 */
export function getDeviceId() {
    let id = '';
    try {
        id = typeof GM_getValue === 'function' ? GM_getValue(DEVICE_ID_KEY, '') || '' : '';
    } catch (e) {
        id = '';
    }
    if (!id) {
        try {
            id =
                window.crypto && crypto.randomUUID
                    ? crypto.randomUUID()
                    : 'd' + Date.now().toString(16) + Math.random().toString(16).slice(2);
        } catch (e) {
            id = 'd' + Date.now().toString(16) + Math.random().toString(16).slice(2);
        }
        try {
            if (typeof GM_setValue === 'function') GM_setValue(DEVICE_ID_KEY, id);
        } catch (e) {
            /* 忽略 */
        }
    }
    return id;
}

/**
 * 将 base64 字符串还原为 Blob（用于把中继返回的图片字节写剪贴板）。
 * @param {string} b64 - base64 文本
 * @param {string} mime - MIME 类型
 * @returns {Blob} 图片 Blob
 */
function base64ToBlob(b64: any, mime: any) {
    const bin = atob(b64);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'image/jpeg' });
}

/**
 * 将图片 Blob 转成 PNG Blob（best-effort）。
 * 原因：异步 Clipboard API（navigator.clipboard.write + ClipboardItem）在部分
 * Chromium 内核里只可靠支持 image/png；手机传来的图多为 image/jpeg，
 * 直接以 image/jpeg 写入可能失败。统一转 PNG 可规避该限制。
 * 若环境不支持位图解码 / Canvas，则返回原 blob。
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
function blobToPng(blob: any) {
    return new Promise((resolve) => {
        if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
            resolve(blob);
            return;
        }
        try {
            createImageBitmap(blob)
                .then((bmp) => {
                    const cv = document.createElement('canvas');
                    cv.width = bmp.width;
                    cv.height = bmp.height;
                    const ctx = cv.getContext('2d');
                    if (!ctx) {
                        if (bmp.close) bmp.close();
                        resolve(blob);
                        return;
                    }
                    ctx.drawImage(bmp, 0, 0);
                    if (bmp.close) bmp.close();
                    cv.toBlob((b) => {
                        resolve(b || blob);
                    }, 'image/png');
                })
                .catch(() => resolve(blob));
        } catch (e) {
            resolve(blob);
        }
    });
}

/**
 * 尝试把图片写入剪贴板：优先「页面主世界(unsafeWindow)」的 navigator.clipboard.write，
 * 失败再退回「隔离世界」的同名 API。两者都不行则返回 false。
 * 页面主世界路径是文档确认的、唯一能把图片真正写进系统剪贴板的可靠方式
 * （ScriptCat 隔离世界里 ClipboardItem 常缺失，且 ScriptCat 的 GM_setClipboard 仅支持文本，
 *  传 Blob 会静默无效——故图片复制不再依赖 GM_setClipboard）。
 * @param {Blob} data
 * @param {string} type
 * @returns {Promise<boolean>}
 */
function attemptWriteImage(data: any, type: any) {
    const doWrite = (nav: any, CI: any) =>
        new Promise((r) => {
            try {
                if (nav && nav.clipboard && nav.clipboard.write && typeof CI !== 'undefined') {
                    nav.clipboard
                        .write([new CI({ [type]: data })])
                        .then(() => r(true))
                        .catch(() => r(false));
                    return;
                }
            } catch (e) {
                /* 忽略，走降级 */
            }
            r(false);
        });
    const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    return doWrite(w && w.navigator, w && w.ClipboardItem).then((ok) => {
        if (ok) return true;
        return doWrite(navigator, ClipboardItem);
    });
}

/**
 * 将图片 Blob 写入系统剪贴板（由一次「用户点击」触发，以保留浏览器要求的用户手势）。
 * 流程：
 *   1) 先用「原始 blob」直接写（此时点击手势最新鲜、无任何异步转换，成功率最高）；
 *   2) 若失败（多半因内核仅支持 image/png 而原图为 jpeg），再统一转 PNG 后重试；
 *   3) 写入一律走页面主世界的 navigator.clipboard.write（见 attemptWriteImage），
 *      不再依赖 GM_setClipboard（ScriptCat 该 API 仅支持文本，传 Blob 会静默无效导致"假成功"）。
 * @param {Blob} blob - 图片 Blob
 * @returns {Promise<boolean>} 成功返回 true，失败返回 false
 */
export function copyImageToClipboard(blob: any) {
    return new Promise((resolve) => {
        if (!blob) {
            addLog('[复制] 图片数据为空', 'error', true);
            resolve(false);
            return;
        }
        const type0 = blob.type ? blob.type : 'image/png';
        // 1) 原始 blob 直接写（手势最新鲜）
        attemptWriteImage(blob, type0).then((ok) => {
            if (ok) {
                addLog('[复制] 图片已复制到剪贴板', 'success', true);
                resolve(true);
                return;
            }
            // 2) 转 PNG 后重试（规避内核仅支持 image/png 的限制）
            blobToPng(blob)
                .then((png) => {
                    const data = png || blob;
                    const type = data.type ? data.type : 'image/png';
                    attemptWriteImage(data, type).then((ok2) => {
                        if (ok2) {
                            addLog('[复制] 图片已复制到剪贴板 (转PNG)', 'success', true);
                            resolve(true);
                        } else {
                            addLog('[复制] 所有复制方式均失败，请长按图片手动保存', 'error', true);
                            resolve(false);
                        }
                    });
                })
                .catch(() => {
                    addLog('[复制] PNG 转换失败', 'error', true);
                    resolve(false);
                });
        });
    });
}

/**
 * 启动「设备互联」长轮询接收循环（直到 stop() 调用）。
 * 通过 GM_xmlhttpRequest 轮询中继服务器 /recv/<uuid>（绕过税务页面 CSP 对 connect-src 的限制）。
 * 收到图片时回调 onImage；状态变化回调 onStatus；网络异常自动重连。
 * @param {object} opt - { server, uuid, onStatus, onImage }
 * @returns {Function} stop() 停止接收
 */
export function startPhoneReceive(opt: any) {
    const server = (opt.server || '').trim().replace(/\/+$/, '');
    const uuid = opt.uuid;
    let stopped = false;
    let lastXhr: { abort: () => void } | null = null;
    let connected = false;
    let loggedConnFail = false;
    let firstPoll = true;
    function markConnected() {
        if (connected) return;
        connected = true;
        loggedConnFail = false; // 恢复连接后复位失败标记，后续再次断线仍会记日志（旧实现不复位，之后断连静默）
        if (opt.onConnected) {
            try {
                opt.onConnected();
            } catch (e) {
                /* 忽略 */
            }
        }
    }
    // 说明：不单独探测 /health。旧版中继可能没有该端点，会导致请求挂起并误报
    // 「连接服务器超时」，而真正的 /recv 接收始终正常（与用户报告的现象一致）。
    // 改用「首次 /recv 轮询用极短 maxwait」来快速确认已连上：服务器会很快返回空响应，
    // 从而 markConnected → onConnected 触发「已自动开始接收」日志（约 1 秒内）。
    function poll() {
        if (stopped) return;
        if (opt.onStatus) opt.onStatus('正在等待手机上传…');
        // 首次轮询用极短 maxwait 仅用于快速确认「已连上服务器」（服务器会很快返回空），
        // 让「已自动开始接收」日志尽快出现；后续轮询用长 maxwait 实时等待图片。
        const maxwait = firstPoll ? 1000 : 25000;
        firstPoll = false;
        const url = server + '/recv/' + encodeURIComponent(uuid) + '?maxwait=' + maxwait;
        try {
            lastXhr = GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                timeout: maxwait + 5000,
                onload: function (resp) {
                    if (stopped) return;
                    markConnected(); // 首次成功收到服务器响应即视为已连上
                    try {
                        let data = null;
                        try {
                            data = JSON.parse(resp.responseText);
                        } catch (e) {
                            data = null;
                        }
                        if (data && data.empty) {
                            poll();
                            return;
                        }
                        if (data && data.type === 'image' && data.data) {
                            const blob = base64ToBlob(data.data, data.mime || 'image/jpeg');
                            // 预览统一用 objectURL（与「发送到手机」待发列表一致）：
                            // ① 画廊上限淘汰/单张移除/清空全部时的 URL.revokeObjectURL 真正生效
                            //   （data:URL 字符串无法 revoke，旧写法实为无效空操作）；
                            // ② 避免最多 27 张图的 base64 dataURL 长字符串常驻 JS 堆（可达几十 MB）。
                            const previewUrl = URL.createObjectURL(blob);
                            if (opt.onStatus) opt.onStatus('收到图片：' + (data.name || 'image'));
                            if (opt.onImage)
                                opt.onImage({ blob: blob, previewUrl: previewUrl, name: data.name, mime: data.mime });
                            poll(); // 继续接收下一张
                            return;
                        }
                        if (data && data.type === 'text' && typeof data.text === 'string') {
                            if (opt.onStatus) opt.onStatus('收到文本');
                            if (opt.onText) opt.onText({ text: data.text, ts: data.ts });
                            poll(); // 继续接收下一条
                            return;
                        }
                        setTimeout(poll, 1000); // 解析失败稍后重试
                    } catch (e) {
                        // 单条数据异常（base64 损坏 atob 抛错、回调抛错等）不得杀死接收循环：
                        // 记录一次后继续下一次轮询（旧实现无兜底，异常会让 poll 链永久中断、收图静默失效）
                        addLog('[设备互联] 处理收到数据失败: ' + (e && e.message ? e.message : e), 'error', true);
                        setTimeout(poll, 1000);
                    }
                },
                onerror: function () {
                    if (stopped) return;
                    if (!loggedConnFail) {
                        loggedConnFail = true;
                        addLog('[设备互联] 连接服务器失败，请检查中继地址/网络（' + server + '）', 'error');
                    }
                    if (opt.onStatus) opt.onStatus('连接中断，正在重连…');
                    setTimeout(poll, 2000);
                },
                ontimeout: function () {
                    if (stopped) return;
                    poll(); // 超时继续轮询
                },
            });
        } catch (e) {
            if (stopped) return;
            if (opt.onStatus) opt.onStatus('请求异常，正在重连…');
            setTimeout(poll, 2000);
        }
    }
    poll();
    return function stop() {
        stopped = true;
        try {
            if (lastXhr && typeof lastXhr.abort === 'function') lastXhr.abort();
        } catch (e) {
            /* 忽略 */
        }
    };
}

/**
 * 电脑端 → 手机端 发送（图片或文本）。POST 到中继 /phone/send/<deviceId>。
 * 仅负责投递；手机是否在线由调用方先查 /phone/status 决定（离线时调用方直接拦截）。
 * @param {object} opt - { server, uuid, payload, onOk, onFail }
 *   payload: { text } 或 { name, mime, data(base64) }
 */
export function sendToPhone(opt: any) {
    const server = (opt.server || '').trim().replace(/\/+$/, '');
    const uuid = opt.uuid;
    const url = server + '/phone/send/' + encodeURIComponent(uuid);
    try {
        const body = JSON.stringify(opt.payload);
        GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: { 'Content-Type': 'application/json' },
            data: body,
            // 超时随载荷缩放：放行的最大单请求约 16MB（base64 膨胀后），固定 20s 在慢上行时会把合法大图误杀
            timeout: 20000 + Math.round(body.length / 200), // ≈ 20s + 每 200B 1ms；16MB 体 ≈ 100s
            onload: function (resp) {
                let j = null;
                try {
                    j = JSON.parse(resp.responseText);
                } catch (e) {
                    j = null;
                }
                if (j && j.ok) {
                    if (opt.onOk) opt.onOk();
                } else {
                    // 优先用服务端 JSON 里的中文错误（如 413「内容过大」）；否则按状态码给可读提示，避免笼统报错。
                    let msg = j && j.error ? String(j.error) : '';
                    if (!msg && resp.status === 413) msg = '内容过大，请压缩后再发送';
                    else if (!msg && resp.status >= 400) msg = '服务器错误（HTTP ' + resp.status + '）';
                    if (opt.onFail) opt.onFail(msg || 'HTTP ' + resp.status);
                }
            },
            onerror: function () {
                if (opt.onFail) opt.onFail('网络错误，请检查中继地址');
            },
            ontimeout: function () {
                if (opt.onFail) opt.onFail('发送超时');
            },
        });
    } catch (e) {
        if (opt.onFail) opt.onFail(e.message);
    }
}
