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

/** 「发送到手机」压缩参数：与手机上传页保持一致（canvas 缩放到最大边 + JPEG 质量）。 */
export const PHONE_MAX_DIM = 1600;
export const PHONE_JPEG_QUALITY = 0.75;

/** 发送到手机的实际载荷：blob/name/mime 为最终要 POST 的内容；compressed 表示是否发生过压缩。 */
export interface PhoneImagePayload {
    blob: any;
    name: string;
    mime: string;
    compressed: boolean;
}

/** HEIC/HEIF 判定：MIME 可能为空串或 application/octet-stream，故扩展名也算 */
function isHeicLike(lowerMime: string, lowerName: string) {
    return (
        lowerMime === 'image/heic' ||
        lowerMime === 'image/heif' ||
        lowerMime === 'image/heic-sequence' ||
        lowerMime === 'image/heif-sequence' ||
        /\.(heic|heif)$/.test(lowerName)
    );
}

/**
 * 用 @require 进来的 heic2any 把 HEIC/HEIF 转成 JPEG。
 * 桌面 Chrome 原生解不开 HEIC/HEIF（createImageBitmap 与 <img> 都会失败），故必须先转码；
 * 与手机上传页用的是同一个库（那边是页面里按需加载，这里是脚本 @require）。
 */
function heicToJpeg(file: any): Promise<any> {
    return new Promise((resolve, reject) => {
        if (typeof heic2any !== 'function') {
            reject(new Error('heic2any 未加载'));
            return;
        }
        heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
            .then((out: any) => {
                const b = Array.isArray(out) ? out[0] : out; // 多图 HEIC 会返回数组，取首帧
                if (b) resolve(b);
                else reject(new Error('heic2any 未产出图片'));
            })
            .catch(reject);
    });
}

/**
 * 解码（createImageBitmap，失败回退 <img>）→ canvas 等比缩放到最大边 PHONE_MAX_DIM →
 * 铺白底 → 导出 JPEG。解码/编码失败时 resolve(null)，由调用方决定回退策略。
 */
function toPhoneJpeg(blob: any): Promise<any> {
    return new Promise((resolve) => {
        // <img> 兜底解码：createImageBitmap 在部分内核/格式上不可用或直接抛
        const decodeViaImg = () =>
            new Promise((rs: any, rj: any) => {
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () =>
                    rs({
                        source: img,
                        width: img.naturalWidth,
                        height: img.naturalHeight,
                        release: () => URL.revokeObjectURL(url),
                    });
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    rj(new Error('decode failed'));
                };
                img.src = url;
            });
        const decoded: Promise<any> =
            typeof createImageBitmap === 'function'
                ? createImageBitmap(blob)
                      .then((bmp: any) => ({
                          source: bmp,
                          width: bmp.width,
                          height: bmp.height,
                          release: () => {
                              if (bmp.close) bmp.close();
                          },
                      }))
                      .catch(() => decodeViaImg())
                : decodeViaImg();
        decoded
            .then((dec: any) => {
                const w = Number(dec.width) || 0;
                const h = Number(dec.height) || 0;
                if (!w || !h) {
                    dec.release();
                    resolve(null);
                    return;
                }
                const scale = Math.min(1, PHONE_MAX_DIM / Math.max(w, h));
                const cw = Math.max(1, Math.round(w * scale));
                const ch = Math.max(1, Math.round(h * scale));
                const cv = document.createElement('canvas');
                cv.width = cw;
                cv.height = ch;
                const ctx = cv.getContext('2d');
                if (!ctx) {
                    dec.release();
                    resolve(null);
                    return;
                }
                // JPEG 无透明通道：先铺白底，避免透明 PNG 被压成黑底（与手机上传页一致）
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, cw, ch);
                ctx.drawImage(dec.source, 0, 0, cw, ch);
                dec.release();
                cv.toBlob((b: any) => resolve(b || null), 'image/jpeg', PHONE_JPEG_QUALITY);
            })
            .catch(() => resolve(null));
    });
}

/**
 * 「电脑端 → 手机端」发送前的图片压缩，策略与手机上传页的 compressFile 对齐：
 * canvas 等比缩放到最大边 PHONE_MAX_DIM，铺白底后导出 JPEG（PHONE_JPEG_QUALITY）；
 * HEIC/HEIF 先经 heic2any 转成 JPEG，再走同一条压缩链。
 *
 * 以下情况回退「原图直传」，绝不阻断发送：
 *  - SVG：canvas 无法可靠光栅化（无固有尺寸时画布为 0），且压成 JPEG 会丢矢量特性；
 *  - GIF：canvas 只取首帧，会把动图压成静态图；
 *  - HEIC/HEIF 转码失败（库未加载 / 文件损坏）：退回原图，交由接收端自行处理；
 *  - 解码失败，或**非 HEIC**时「压完反而更大」（小图 / 已高度压缩的图）。
 *
 * @param {File|Blob} file - 用户选择的原始图片文件
 * @returns {Promise<PhoneImagePayload>} 实际要发送的内容
 */
export function compressImageForPhone(file: any): Promise<PhoneImagePayload> {
    const name = String((file && file.name) || 'image.jpg');
    const mime = String((file && file.type) || 'image/jpeg');
    const original: PhoneImagePayload = { blob: file, name: name, mime: mime, compressed: false };
    const lowerName = name.toLowerCase();
    const lowerMime = mime.toLowerCase();
    // SVG / GIF 原样直传（见上方说明）
    if (
        lowerMime === 'image/svg+xml' ||
        lowerMime === 'image/gif' ||
        /\.svg$/.test(lowerName) ||
        /\.gif$/.test(lowerName)
    ) {
        return Promise.resolve(original);
    }
    const heic = isHeicLike(lowerMime, lowerName);
    // HEIC 转码失败时 heicToJpeg 会 reject，被下面的 catch 兜成原图直传
    const source = heic ? heicToJpeg(file) : Promise.resolve(file);
    return source
        .then((blob: any) => toPhoneJpeg(blob))
        .then((out: any) => {
            if (!out) return original; // 解码/编码失败，或（HEIC）库不可用
            // HEIC 的「转码」本身就是目的：既压体积，也修掉安卓端不显示 HEIC 的兼容问题，
            // 故即使 JPEG 没比原始 HEIC 小也照样发 JPEG；其它格式仍遵循「压不小就不压」。
            if (!heic && out.size >= ((file && file.size) || 0)) return original;
            return {
                blob: out,
                name: name.replace(/\.[a-z0-9]+$/i, '') + '.jpg',
                mime: 'image/jpeg',
                compressed: true,
            };
        })
        .catch(() => original);
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

/** 剪贴板写入目标：一个 realm 的 navigator.clipboard + ClipboardItem + Blob 构造器 */
interface ClipboardRealm {
    name: string;
    nav: any;
    CI: any;
    BlobCtor: any;
    isPageRealm: boolean;
}

/** 统一取可读的异常文本 */
function errTextOf(e: any) {
    return e && e.name ? e.name + ': ' + e.message : String((e && e.message) || e);
}

/**
 * 用目标 realm 的原生 Blob 构造器重新包一层。
 * 跨 realm 直接把「隔离世界的 Blob」交给「页面主世界的 ClipboardItem」可能被拒绝；
 * 参考实现 qsniyg/maxurl 同样是用页面原生 `native_blob` 构造后再传入 ClipboardItem。
 */
function toRealmBlob(blob: any, BlobCtor: any) {
    const type = blob && blob.type ? blob.type : 'image/png';
    try {
        return BlobCtor ? new BlobCtor([blob], { type: type }) : blob;
    } catch (e) {
        return blob;
    }
}

/**
 * 在指定 realm 里写**一次**剪贴板（只写 image/png）。
 *
 * ⚠️ 为什么只写一次：`clipboard.write()` 通过用户手势校验后就会**消耗**这次手势，失败也不退还。
 * 所以任何「先拿原图试一下、失败再重试」的兜底都会把手势烧掉，让后面的重试必然 NotAllowedError。
 * preferPromiseForm=true 时使用 ClipboardItem 的 Promise 形式：write() 在本次点击手势内**同步发起**，
 * 由浏览器去等异步转换结果 —— 转换耗时（实测约 1s）不再影响手势有效性。
 * @param {ClipboardRealm} realm - 写入目标
 * @param {Promise<any>} pngPromise - 解析为 PNG Blob 的 Promise
 * @param {boolean} preferPromiseForm - 是否优先用 Promise 形式的 ClipboardItem
 * @returns {Promise<boolean>} 写入是否成功
 */
function writeClipboardOnce(realm: ClipboardRealm, pngPromise: Promise<any>, preferPromiseForm: boolean) {
    return new Promise<boolean>((resolve) => {
        const doWrite = (item: any) => {
            try {
                realm.nav.clipboard.write([item]).then(
                    () => resolve(true),
                    (e: any) => {
                        addLog('[复制] 写入剪贴板被拒（' + realm.name + '）: ' + errTextOf(e), 'warning', true);
                        resolve(false);
                    }
                );
            } catch (e) {
                addLog('[复制] 调用 clipboard.write 异常（' + realm.name + '）: ' + errTextOf(e), 'error', true);
                resolve(false);
            }
        };
        if (preferPromiseForm) {
            try {
                doWrite(new realm.CI({ 'image/png': pngPromise }));
                return;
            } catch (e) {
                addLog('[复制] ClipboardItem 不支持 Promise 形式，改为先转换再写入: ' + errTextOf(e), 'warning', true);
            }
        }
        pngPromise.then((png) => {
            try {
                doWrite(new realm.CI({ 'image/png': toRealmBlob(png, realm.BlobCtor) }));
            } catch (e) {
                addLog('[复制] 构造 ClipboardItem 失败（' + realm.name + '）: ' + errTextOf(e), 'error', true);
                resolve(false);
            }
        });
    });
}

/**
 * 将图片 Blob 写入系统剪贴板（必须由一次「用户点击」触发）。
 *
 * ⚠️ 2026-10-06 重写。旧实现「先按原图类型写一次 → 失败后再转 PNG 重试」是**注定失败**的写法：
 *   1) Chromium 的异步剪贴板**只支持写 `image/png`**（实测 `ClipboardItem.supports('image/jpeg') === false`），
 *      而手机传来的图多为 jpeg ⇒ 第一次写入必然失败；
 *   2) 按规范，`clipboard.write()` 通过手势校验后即**消耗**该手势（失败也不退还）
 *      ⇒ 转 PNG 后的第二次重试必然 `NotAllowedError: Write permission denied`，用户只看到「复制失败」；
 *   3) 正确顺序：**先转好 PNG，再只写一次**。
 *
 * 参考实现：qsniyg/maxurl（只调用一次 write + 用页面原生 Blob 构造 ClipboardItem + 显式异常分支）。
 * 本脚本不需要它们「跨域图片经 GM_xmlhttpRequest 取二进制」那一段 —— 图片本来就是中继传进来的 Blob。
 * @param {Blob} blob - 图片 Blob
 * @returns {Promise<boolean>} 成功返回 true，失败返回 false（失败原因写入日志）
 */
export function copyImageToClipboard(blob: any) {
    return new Promise<boolean>((resolve) => {
        if (!blob) {
            addLog('[复制] 图片数据为空', 'error', true);
            resolve(false);
            return;
        }
        const pageWin: any = typeof unsafeWindow !== 'undefined' ? unsafeWindow : null;
        const realms: ClipboardRealm[] = [];
        // 页面主世界优先：ScriptCat 隔离世界里的 ClipboardItem / 写入常不可用
        if (
            pageWin &&
            pageWin.navigator &&
            pageWin.navigator.clipboard &&
            pageWin.navigator.clipboard.write &&
            pageWin.ClipboardItem
        ) {
            realms.push({
                name: '页面主世界',
                nav: pageWin.navigator,
                CI: pageWin.ClipboardItem,
                BlobCtor: pageWin.Blob,
                isPageRealm: true,
            });
        }
        if (
            navigator.clipboard &&
            typeof navigator.clipboard.write === 'function' &&
            typeof ClipboardItem !== 'undefined'
        ) {
            realms.push({ name: '隔离世界', nav: navigator, CI: ClipboardItem, BlobCtor: Blob, isPageRealm: false });
        }
        if (!realms.length) {
            addLog('[复制] 当前环境不支持图片剪贴板（缺 clipboard.write 或 ClipboardItem）', 'error', true);
            resolve(false);
            return;
        }

        // 先启动 PNG 转换（不阻塞手势）：Chromium 只认 image/png
        const pngPromise: Promise<any> = (blob.type === 'image/png' ? Promise.resolve(blob) : blobToPng(blob)).then(
            (b: any) => {
                if (b && b.type !== 'image/png') {
                    // blobToPng 转换失败时会原样返回原图；此处只提示，成败仍交给写入阶段判定
                    addLog('[复制] 图片转 PNG 失败（内核不支持位图解码/Canvas），可能无法写入剪贴板', 'warning', true);
                }
                return b;
            }
        );

        (async () => {
            for (const realm of realms) {
                // 主世界优先用 Promise 形式（write 落在手势内）；隔离世界退化为「先转换、后写入」
                const ok = await writeClipboardOnce(realm, pngPromise, realm.isPageRealm);
                if (ok) {
                    addLog('[复制] 图片已复制到剪贴板（' + realm.name + '）', 'success', true);
                    resolve(true);
                    return;
                }
            }
            addLog(
                '[复制] 图片写入剪贴板失败：常见原因是浏览器/油猴未授予剪贴板权限、页面未获得焦点，或该内核不支持图片剪贴板；可长按图片手动保存',
                'error',
                true
            );
            resolve(false);
        })();
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
