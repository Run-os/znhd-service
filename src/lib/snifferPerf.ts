/**
 * 嗅探「资源表预收」（v26.10.14-v2）。
 *
 * 解决什么问题：`performance.getEntriesByType('resource')` 的缓冲区默认只有 **250 条**，
 * 图片稍多的页面（几十张）就会把早期条目挤出去。原来「打开嗅探面板时才读表」，
 * 于是明明加载过的图也量不到字节数，只能退回 HEAD / Range 逐张发请求 ——
 * 这才是「嗅探慢」的观感主因（测量是并发 5，几百张图就是几百个请求）。
 *
 * 做法（借鉴 SiteAssetDL 的 `boot()`，但只搬零风险的那一半，详见 AGENT.md 红线）：
 *   · 脚本启动时**立即把缓冲扩容到 20000**（setResourceTimingBufferSize）——
 *     已丢的条目救不回来，但不再继续丢；
 *   · 起一个 **PerformanceObserver（buffered:true）**：既能把当前缓冲区里的历史条目
 *     一次性收回来，又能实时收到之后加载的每条资源，全部抄进模块级 Map ——
 *     这个 Map 不受缓冲区大小限制，从此「开窗即有数据」，不需要真机配合滚动页面。
 *
 * 尺寸取值优先级（与 SiteAssetDL 一致，全部**零请求**）：
 *   decodedBodySize → encodedBodySize → transferSize，取第一个 > 0 的。
 *   三者都 ≤ 0 说明拿不到（跨域且响应没有 Timing-Allow-Origin），返回 null，
 * 由调用方走 HEAD / Range 兜底。
 *   ⚠️ decodedBodySize 是「去掉 content-coding 后的报文大小」。对 JPEG / PNG / WebP
 *     这类本身已压缩的格式，服务器不会再套 gzip，故它就等于**文件字节数**
 *     （不是解码后的位图字节数 —— 资源表不暴露位图大小），可以放心当文件大小用。
 *
 * 红线：本模块**只读** performance，不碰页面 DOM、不发任何请求、不注入样式、不改全局对象。
 */

/** 扩容目标：performance 资源表默认 250 条，图片多的页面会把早期条目挤出缓冲区 */
export const PERF_BUFFER_SIZE = 20000;

/** Map 条目上限：与缓冲区对齐，防极端页面把内存吃爆（到顶淘汰最早一条） */
export const MAX_PERF_ENTRIES = 20000;

/**
 * 图片扩展名（与 sniffer.ts 的 IMG_EXT_RE 同形）。
 * 此处独立一份而不是从 sniffer.ts import：sniffer.ts 要 import 本模块，
 * 互相 import 会成环；规则本身极稳定，改的时候两边一起改（有注释互指）。
 */
const IMG_EXT_RE = /\.(?:jpe?g|png|gif|webp|bmp|ico|avif|tiff?|svg)(?:[?#]|$)/i;

/** 资源表里这些 initiatorType 明确不是图片（与 sniffer.ts 的 VIDEO_INITIATORS 对齐） */
const VIDEO_INITIATORS = ['video', 'audio'];

/** url → 字节数（>0）。模块级单例：脚本不开面板也在持续积累 */
const perfBytes = new Map<string, number>();

/** observer 句柄（留着只为将来想 stop 时有处可调） */
let observer: PerformanceObserver | null = null;

/** 是否已启动（幂等） */
let started = false;

/** 一条资源表条目的字节数：decoded → encoded → transfer，取第一个 > 0 的 */
function entryBytes(e: PerformanceResourceTiming): number {
    const decoded = Number(e.decodedBodySize || 0);
    if (decoded > 0) return decoded;
    const encoded = Number(e.encodedBodySize || 0);
    if (encoded > 0) return encoded;
    const transfer = Number(e.transferSize || 0);
    return transfer > 0 ? transfer : 0;
}

/** 收一条资源：只留图片 URL（防 Map 被 JS/CSS/XHR 撑爆），字节 ≤ 0 的不要 */
function remember(name: string, bytes: number): void {
    if (!name || bytes <= 0) return;
    if (!IMG_EXT_RE.test(name)) return;
    if (!perfBytes.has(name) && perfBytes.size >= MAX_PERF_ENTRIES) {
        // 到顶先淘汰最早的一条（Map 保持插入序），保证新资源仍能进来
        const oldest = perfBytes.keys().next();
        if (!oldest.done) perfBytes.delete(oldest.value);
    }
    perfBytes.set(name, bytes);
}

/** PerformanceObserver 回调：把这一批条目抄进 Map */
function onEntries(list: PerformanceObserverEntryList): void {
    try {
        const entries = (
            list && typeof list.getEntries === 'function' ? list.getEntries() : []
        ) as PerformanceResourceTiming[];
        for (const e of entries) {
            const it = String(e.initiatorType || '');
            if (VIDEO_INITIATORS.indexOf(it) >= 0) continue;
            remember(String(e.name || ''), entryBytes(e));
        }
    } catch (err) {
        /* 单批出错不影响后续批次 */
    }
}

/**
 * 启动预收（幂等）：脚本装配时调一次即可，之后无需再管。
 * 失败一律静默降级 —— sniffer.ts 的 collectCandidates 里仍有「实时读表」一路兜底。
 */
export function startPerfCollect(): void {
    if (started) return;
    started = true;
    try {
        if (typeof performance !== 'undefined' && typeof performance.setResourceTimingBufferSize === 'function') {
            performance.setResourceTimingBufferSize(PERF_BUFFER_SIZE);
        }
    } catch (e) {
        /* 个别浏览器不让调，忽略 */
    }
    try {
        if (typeof PerformanceObserver === 'undefined') return;
        observer = new PerformanceObserver(onEntries);
        // buffered:true 会把启动前已进入缓冲区（且还没被挤出的）历史条目一并回放
        observer.observe({ type: 'resource', buffered: true });
    } catch (e) {
        /* 老浏览器没有 PerformanceObserver：靠 collectCandidates 的实时读表兜底 */
    }
}

/** 查某个 URL 已知的字节数；没有（或 ≤ 0）返回 null */
export function perfBytesOf(url: string): number | null {
    if (!url) return null;
    const b = perfBytes.get(url);
    return b && b > 0 ? b : null;
}

/** 遍历全部预收条目（回调形式：不产生中间数组，20000 条也不心疼） */
export function perfForEach(fn: (url: string, bytes: number) => void): void {
    perfBytes.forEach((bytes, url) => fn(url, bytes));
}

/** 预收条目数（调试 / 冒烟用） */
export function perfEntryCount(): number {
    return perfBytes.size;
}
