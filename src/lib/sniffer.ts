/**
 * 网页图片嗅探（v26.10.10-v4 新增，配合 `ui/SniffModal.tsx`）。
 *
 * 目标：把**当前页面上的图片**收集起来，让用户能「下载」或「打印」，等价于暴力猴图片提取脚本
 * （参考 52pojie 的《SVG & 图片 & 视频资源提取器》），但按本仓库的约束做了三处裁剪：
 *   1. **只要图片，不要视频**（扩展名黑名单 + Content-Type 判定 + 资源表 initiatorType 三重排除）；
 *   2. 默认**只展示 ≧ 阈值（默认 20KB）**的图，未知大小的单独折叠保留（用户 2026-10-10 拍板）；
 *   3. **不对宿主页打任何桩**：不 patch fetch / XMLHttpRequest / URL.createObjectURL，不注入样式，
 *      只读 DOM、读计算样式、读 performance 资源表 —— 税务页是生产页面，任何侵入都可能影响报税。
 *      代价是「页面用 fetch/XHR 自己下载、且从未进过 DOM 的图」抓不到（v1 明确不做，见 CHANGELOG）。
 *
 * 三路来源（同一张图会合并、按归一化 URL 去重，sources 记录它从哪几路来）：
 *   · dom  —— <img>（currentSrc / src / srcset 取最大档 / data-* 懒加载属性）+ <picture><source>；
 *   · svg  —— 内联 <svg>（序列化成 data: URL，见下方「内联 SVG」说明）；
 *   · css  —— 所有元素的 background-image（getComputedStyle 全量遍历，元素数有上限防卡死）；
 *   · perf —— performance.getEntriesByType('resource')（能拿到已移出 DOM 的图；⚠️ 默认缓冲区只有
 *            250 条，且只覆盖「已经开始加载」的资源，故只当加分项，不作为唯一来源）。
 *
 * 尺寸测量阶梯（先命中先用，见 probeOne）：
 *   kind==='data' → 本地按 base64/百分号编码算字节；kind==='svg' → 序列化文本的 UTF-8 字节；
 *   kind==='blob' → 页面上下文 fetch(blob:) 拿真实字节与 MIME（CSP 拦截就退回未知）；
 *   资源表 encodedBodySize > 0 → 直接用（零成本、绝对准确）；
 *   GM_xmlhttpRequest HEAD → content-length / content-type；
 *   仍无 → GM_xmlhttpRequest GET + 'Range: bytes=0-0' → content-range 的 total；
 *           服务器忽略 Range（回 200 整份）时用返回 Blob 的 size；
 *   全失败 → size=null（UI 显示「大小未知」并保留，不是丢弃）。
 *
 * 内联 SVG：序列化后**补 xmlns** 再包成 data:image/svg+xml，于是预览/打印/下载三处都能直接用，
 * 不必维护 objectURL 的创建与 revoke。已知局限：靠 <use xlink:href="#id"> 引用同文档 symbol 的
 * 雪碧图，在脱离文档后会渲染成空白（这类 sprite 通常只有几 KB，会被 20KB 阈值先筛掉）。
 *
 * ⚠️ 跨域取图必须用 GM_xmlhttpRequest 而不是 fetch：税务页 CSP 限 connect-src
 * （结论见 CHANGELOG.md 2026-10 的「跨域取图」条）。本文件不新增任何 @grant。
 */

import { downloadFileName } from './gallery';

/** 一个候选（还没量尺寸）来源 */
export type SniffSource = 'dom' | 'svg' | 'css' | 'perf';

/** 候选的 URL 类型（决定用哪条测量阶梯） */
export type SniffKind = 'http' | 'data' | 'blob' | 'svg';

/** 尺寸是怎么来的：perf=资源表 / local=本地算 / head=HEAD content-length / range=Range / unknown=没测到 */
export type SizeVia = 'perf' | 'local' | 'head' | 'range' | 'unknown';

/** 候选图片（`key` 是去重键，也是 React 的 key） */
export interface SniffCandidate {
    /** 去重键：http(s) 是归一化 URL；内联 SVG 是内容哈希 */
    key: string;
    /** 可直接喂给 <img src>：http(s) / data: / blob: */
    url: string;
    kind: SniffKind;
    /** 从哪几路嗅到的（合并去重后可能多项） */
    sources: SniffSource[];
    /** 内联 SVG 的序列化文本（kind==='svg' 时存在） */
    svgText?: string;
    /** 元素上的显示尺寸（CSS px）——仅用于展示提示，与下载/打印无关 */
    width: number | null;
    height: number | null;
    /** 资源表里已知的字节数（>0 时零成本直接采用） */
    perfBytes: number | null;
    /** 已知 MIME（资源表不提供，基本只有 HEAD/本地路径能给出） */
    mime: string | null;
}

/** 量过尺寸的候选 */
export interface SniffedImage extends SniffCandidate {
    /** 字节数；null = 大小未知（UI 保留并折叠） */
    size: number | null;
    sizeVia: SizeVia;
    /** 测尺寸时发现响应根本不是图片（Content-Type 明确为 text/video/json 等）⇒ 调用方应丢弃 */
    drop: boolean;
}

/** 收集参数 */
export interface CollectOptions {
    /** 扫描起点，默认 document */
    root?: ParentNode;
    /** 跳过该选择器命中的子树（调用方传本脚本自己的面板/预览宿主，避免把自己 UI 的内联 SVG 嗅进来） */
    excludeSelector?: string;
    /** getComputedStyle 遍历元素数上限，默认 CSS_SCAN_LIMIT */
    cssLimit?: number;
    /** 候选数量上限，默认 MAX_SNIFF（超出置 truncated） */
    maxItems?: number;
}

/** 收集结果 */
export interface CollectResult {
    items: SniffCandidate[];
    /** 因为元素数/候选数上限被截断（UI 给出提示，避免用户以为「就这些」） */
    truncated: boolean;
}

/** 测量参数 */
export interface ResolveOptions {
    /** 并发数，默认 5（同一站点的图通常同源，5 条并发对服务器压力可控） */
    concurrency?: number;
    /** 每张图测完就回调（完成顺序，不是文档顺序） */
    onItem?: (item: SniffedImage) => void;
    /** 返回 true 表示调用方已关闭面板：在飞请求无法中断，但其结果会被丢弃 */
    shouldStop?: () => boolean;
}

/** getComputedStyle 遍历的元素数上限：超大页面（上万节点）遍历到底会明显卡顿 */
export const CSS_SCAN_LIMIT = 3000;

/** 候选数量上限：防极端页面把内存吃爆 */
export const MAX_SNIFF = 300;

/** 懒加载属性（顺序即优先级；与参考脚本的 imageAttributes 一致，另加 data-echo） */
const LAZY_ATTRS = [
    'data-src',
    'data-lazy-src',
    'data-original',
    'data-actual',
    'data-lazy',
    'data-defer-src',
    'data-load-src',
    'data-echo',
];

/** 图片扩展名：用于识别「没有 <img> 标签」的图（CSS 背景、资源表条目） */
const IMG_EXT_RE = /\.(?:jpe?g|png|gif|webp|bmp|ico|avif|tiff?|svg)(?:[?#]|$)/i;

/**
 * 视频扩展名：命中即排除（用户要求「只图片不要视频」）。
 * ⚠️ 不列 `.ts`（那边既可能是 MPEG-TS 视频，也可能是前端源码，误伤面大于收益）。
 */
const VIDEO_EXT_RE = /\.(?:mp4|m4v|webm|ogv|ogg|avi|mov|flv|mkv|wmv|3gp|mpe?g|m3u8|mpd)(?:[?#]|$)/i;

/** 资源表里这些 initiatorType 明确不是图片 */
const VIDEO_INITIATORS = ['video', 'audio'];

/** URL 里取 url(...)（计算样式里的 background-image，可能有多层） */
const CSS_URL_RE = /url\((['"]?)([^'")]+)\1\)/g;

/** HEAD 请求超时（毫秒） */
const HEAD_TIMEOUT = 8000;
/** Range 请求超时（毫秒） */
const RANGE_TIMEOUT = 15000;
/** 下载超时（毫秒） */
const DOWNLOAD_TIMEOUT = 30000;
/** blob: 探测超时（毫秒） */
const LOCAL_FETCH_TIMEOUT = 5000;

/** 嗅探到的尺寸怎么显示（1KB=1024B；未知返回「大小未知」） */
export function formatBytes(n: number | null): string {
    if (n === null || !Number.isFinite(n) || n < 0) return '大小未知';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
}

/** 去掉文件名里的非法字符（Windows/浏览器都会拿它当保存名）并截断到 100 字 */
export function sanitizeFileName(name: string): string {
    return (
        String(name || '')
            // eslint-disable-next-line no-control-regex -- 控制字符（\u0000-\u001f）也要消毒：它们会让文件名在 Windows 上打不开
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100)
    );
}

/**
 * 嗅探结果的下载文件名：取 URL 最后一段（解码 + 消毒），无扩展名时按 MIME 补、兜底 .jpg。
 * 复用「历史记录」那套 downloadFileName，避免两处各维护一份 MIME→扩展名映射。
 */
export function sniffFileName(url: string, mime: string | null, idx = 0): string {
    let base = '';
    if (!/^(?:data|blob):/i.test(url)) {
        try {
            const u = new URL(url, location.href);
            const seg = u.pathname.split('/').filter(Boolean).pop() || '';
            base = sanitizeFileName(decodeURIComponent(seg));
        } catch (e) {
            base = '';
        }
    }
    return downloadFileName(base || 'znhd-sniff-' + (idx + 1), mime, idx);
}

/** URL 归一化：非 http(s)/data/blob 一律丢弃；data: 只接受 data:image/* */
function normalizeUrl(raw: string): string | null {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (/^data:/i.test(s)) return /^data:image\//i.test(s) ? s : null;
    if (/^blob:/i.test(s)) return s;
    try {
        const abs = new URL(s, location.href);
        return /^https?:$/i.test(abs.protocol) ? abs.href : null;
    } catch (e) {
        return null;
    }
}

/** 这个 URL 看起来是视频吗 */
function isVideoUrl(url: string): boolean {
    return /^data:video\//i.test(url) || VIDEO_EXT_RE.test(url);
}

/** 这个 URL 看起来是图片吗（用于「没有 <img> 标签」的来源） */
function looksLikeImageUrl(url: string): boolean {
    return /^data:image\//i.test(url) || /^blob:/i.test(url) || IMG_EXT_RE.test(url);
}

/** Content-Type 明确不是图片（text/、video/、json 等）；application/octet-stream 不算明确，保留 */
function isClearlyNotImage(mime: string | null): boolean {
    if (!mime) return false;
    const m = mime.toLowerCase().split(';')[0].trim();
    if (m.startsWith('image/')) return false;
    return (
        m.startsWith('video/') ||
        m.startsWith('audio/') ||
        m.startsWith('text/') ||
        m === 'application/json' ||
        m === 'application/xml'
    );
}

/** 字符串的 UTF-8 字节数（data: 的百分号编码段、内联 SVG 文本要用） */
function utf8Bytes(s: string): number {
    try {
        return new TextEncoder().encode(s).length;
    } catch (e) {
        return s.length;
    }
}

/** data: URL 的字节数（base64 按 3/4 估算并减去补位 '='，百分号编码按 UTF-8 长度） */
function dataUrlBytes(url: string): number | null {
    const i = url.indexOf(',');
    if (i < 0) return null;
    const meta = url.slice(0, i);
    const payload = url.slice(i + 1);
    if (/;base64/i.test(meta)) {
        const clean = payload.replace(/\s+/g, '');
        const pad = (clean.match(/=+$/) || [''])[0].length;
        return Math.max(0, Math.floor((clean.length * 3) / 4) - pad);
    }
    try {
        return utf8Bytes(decodeURIComponent(payload));
    } catch (e) {
        return utf8Bytes(payload);
    }
}

/** data: URL 的 MIME */
function dataUrlMime(url: string): string | null {
    const m = /^data:([^;,]+)/i.exec(url);
    return m ? m[1].toLowerCase() : null;
}

/** 内联 SVG 尺寸：优先 width/height 属性，其次 viewBox，最后退到布局盒 */
function svgDims(el: SVGSVGElement): { width: number | null; height: number | null } {
    const num = (v: string | null): number | null => {
        const n = parseFloat(String(v || ''));
        return Number.isFinite(n) && n > 0 ? n : null;
    };
    let width = num(el.getAttribute('width'));
    let height = num(el.getAttribute('height'));
    if (!width || !height) {
        const vb = String(el.getAttribute('viewBox') || '')
            .trim()
            .split(/[\s,]+/);
        if (vb.length === 4) {
            width = width || num(vb[2]);
            height = height || num(vb[3]);
        }
    }
    if (!width || !height) {
        try {
            const r = el.getBoundingClientRect();
            width = width || Math.round(r.width) || null;
            height = height || Math.round(r.height) || null;
        } catch (e) {
            /* 取不到就留 null */
        }
    }
    return { width, height };
}

/** 序列化内联 SVG 并补 xmlns（缺了它 data: URL 里的 SVG 不会被渲染） */
function serializeSvg(el: SVGSVGElement): string {
    let text = '';
    try {
        text = el.outerHTML || '';
    } catch (e) {
        text = '';
    }
    if (!text) return '';
    if (!/\sxmlns=/.test(text)) text = text.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return text;
}

/** srcset 取最大一档（要下载/打印，取最高分辨率最合适） */
function pickFromSrcset(srcset: string): string {
    const parts = String(srcset || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    let best = '';
    let bestV = -1;
    for (const p of parts) {
        const seg = p.split(/\s+/);
        const url = seg[0];
        if (!url) continue;
        const d = String(seg[1] || '');
        let v = 1;
        if (/^\d+(\.\d+)?w$/.test(d)) v = parseFloat(d);
        else if (/^\d+(\.\d+)?x$/.test(d)) v = parseFloat(d) * 1000;
        if (v > bestV) {
            bestV = v;
            best = url;
        }
    }
    return best;
}

/** 计算样式的 background-image 里所有的 url() */
function backgroundUrls(bg: string): string[] {
    const out: string[] = [];
    if (!bg || bg === 'none') return out;
    CSS_URL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CSS_URL_RE.exec(bg))) {
        if (m[2]) out.push(m[2]);
    }
    return out;
}

/**
 * 收集候选（纯读，无网络）。同一个 URL 只留一份，`sources` 记来源。
 * MutationObserver / 手动「重新扫描」都直接再调它一次即可。
 */
export function collectCandidates(opts: CollectOptions = {}): CollectResult {
    const root: ParentNode = opts.root || document;
    const exclude = String(opts.excludeSelector || '');
    const cssLimit = opts.cssLimit && opts.cssLimit > 0 ? opts.cssLimit : CSS_SCAN_LIMIT;
    const maxItems = opts.maxItems && opts.maxItems > 0 ? opts.maxItems : MAX_SNIFF;
    const map = new Map<string, SniffCandidate>();
    let truncated = false;

    const skipped = (el: Element): boolean => {
        if (!exclude) return false;
        try {
            return !!el.closest(exclude);
        } catch (e) {
            return false;
        }
    };

    const add = (
        raw: string,
        source: SniffSource,
        dims?: { width: number | null; height: number | null },
        extra?: { perfBytes?: number | null; mime?: string | null; svgText?: string; force?: boolean }
    ): void => {
        const url = normalizeUrl(raw);
        if (!url) return;
        if (isVideoUrl(url)) return;
        // <img>/<picture> 这类「标签本身就是图片」的来源不必猜扩展名；其余来源（CSS/资源表）要猜
        if (!extra?.force && !looksLikeImageUrl(url)) return;
        const key = url;
        const found = map.get(key);
        if (found) {
            if (found.sources.indexOf(source) < 0) found.sources.push(source);
            if (!found.width && dims && dims.width) found.width = dims.width;
            if (!found.height && dims && dims.height) found.height = dims.height;
            if (!found.mime && extra?.mime) found.mime = extra.mime;
            if (!found.perfBytes && extra?.perfBytes) found.perfBytes = extra.perfBytes;
            return;
        }
        if (map.size >= maxItems) {
            truncated = true;
            return;
        }
        map.set(key, {
            key: key,
            url: url,
            kind: /^data:/i.test(url) ? 'data' : /^blob:/i.test(url) ? 'blob' : 'http',
            sources: [source],
            svgText: extra?.svgText,
            width: dims?.width ?? null,
            height: dims?.height ?? null,
            perfBytes: extra?.perfBytes ?? null,
            mime: extra?.mime ?? null,
        });
    };

    // ① <img>：currentSrc（浏览器实际选中的那一档）优先，其次 src，再退 srcset / 懒加载属性
    let imgs: Element[] = [];
    try {
        imgs = Array.from(root.querySelectorAll('img'));
    } catch (e) {
        imgs = [];
    }
    for (const el of imgs) {
        if (skipped(el)) continue;
        const img = el as HTMLImageElement;
        const dims = {
            width: img.naturalWidth || img.width || null,
            height: img.naturalHeight || img.height || null,
        };
        const cands: string[] = [];
        if (img.currentSrc) cands.push(img.currentSrc);
        if (img.getAttribute('src')) cands.push(img.getAttribute('src') as string);
        const ss = pickFromSrcset(img.getAttribute('srcset') || '');
        if (ss) cands.push(ss);
        for (const a of LAZY_ATTRS) {
            const v = img.getAttribute(a);
            if (v) cands.push(v);
        }
        for (const c of cands) add(c, 'dom', dims, { force: true });
    }

    // ② <picture><source>（srcset 取最大档；<source type="video/*"> 由 isVideoUrl 兜住）
    let sources: Element[] = [];
    try {
        sources = Array.from(root.querySelectorAll('picture source'));
    } catch (e) {
        sources = [];
    }
    for (const el of sources) {
        if (skipped(el)) continue;
        const ss = pickFromSrcset(el.getAttribute('srcset') || '');
        if (ss) add(ss, 'dom', undefined, { force: true });
        const s = el.getAttribute('src');
        if (s) add(s, 'dom', undefined, { force: true });
    }

    // ③ 内联 <svg>：序列化后包成 data:image/svg+xml，预览/打印/下载都能直接用
    let svgs: Element[] = [];
    try {
        svgs = Array.from(root.querySelectorAll('svg'));
    } catch (e) {
        svgs = [];
    }
    for (const el of svgs) {
        if (skipped(el)) continue;
        const text = serializeSvg(el as SVGSVGElement);
        if (!text) continue;
        const dims = svgDims(el as SVGSVGElement);
        add('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text), 'svg', dims, {
            svgText: text,
            mime: 'image/svg+xml',
            force: true,
        });
    }

    // ④ background-image：全量遍历（元素数有上限）；顺表补 <picture>/<video poster> 之外的 CSS 图
    const scanRoot = root instanceof Document ? root.body || root.documentElement : (root as Element);
    if (scanRoot) {
        let els: Element[] = [];
        try {
            els = Array.from(scanRoot.querySelectorAll('*'));
        } catch (e) {
            els = [];
        }
        if (els.length > cssLimit) truncated = true;
        for (let i = 0; i < els.length && i < cssLimit; i++) {
            const el = els[i];
            const tag = el.tagName ? el.tagName.toLowerCase() : '';
            if (tag === 'script' || tag === 'style' || tag === 'link' || tag === 'meta' || tag === 'noscript') continue;
            if (skipped(el)) continue;
            let bg = '';
            try {
                bg = getComputedStyle(el).backgroundImage;
            } catch (e) {
                continue;
            }
            if (!bg || bg === 'none') continue;
            for (const u of backgroundUrls(bg)) add(u, 'css');
        }
    }

    // ⑤ 资源表：能捞到「已经加载过但已移出 DOM」的图；blob: 也算（预览/下载在页面上下文里可用）
    try {
        if (typeof performance !== 'undefined' && performance.getEntriesByType) {
            const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
            for (const e of entries) {
                const it = String(e.initiatorType || '');
                if (VIDEO_INITIATORS.indexOf(it) >= 0) continue;
                const name = String(e.name || '');
                if (!looksLikeImageUrl(name)) continue;
                const bytes = Number(e.encodedBodySize || 0) || Number(e.transferSize || 0) || 0;
                add(name, 'perf', undefined, { perfBytes: bytes > 0 ? bytes : null });
            }
        }
    } catch (e) {
        /* 资源表不可用就当没有这一路 */
    }

    // 保持文档顺序：尺寸是异步补上的，顺序若在这里动过，UI 会边测边跳（排序交给展示层，量完再排）
    return { items: Array.from(map.values()), truncated: truncated };
}

/** 用 GM_xmlhttpRequest 发一次请求（GM_* 在个别管理器里可能不存在，故包一层） */
function gmRequest(details: Tampermonkey.Request<unknown>): Promise<Tampermonkey.Response<unknown>> {
    return new Promise<Tampermonkey.Response<unknown>>((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== 'function') {
            reject(new Error('GM_xmlhttpRequest 不可用'));
            return;
        }
        try {
            GM_xmlhttpRequest<unknown>({
                ...details,
                onload: (resp) => resolve(resp),
                onerror: (resp) => reject(new Error((resp && (resp.error || resp.statusText)) || '请求失败')),
                ontimeout: () => reject(new Error('请求超时')),
                onabort: () => reject(new Error('请求已取消')),
            });
        } catch (e) {
            reject(e);
        }
    });
}

/** 从响应头里取某个头（大小写不敏感；GM 给的是原始头字符串） */
function headerOf(rawHeaders: string, name: string): string | null {
    const lines = String(rawHeaders || '').split(/\r?\n/);
    const want = name.toLowerCase() + ':';
    for (const line of lines) {
        const i = line.indexOf(':');
        if (i < 0) continue;
        if (line.slice(0, i + 1).toLowerCase() === want) return line.slice(i + 1).trim();
    }
    return null;
}

/** 响应头里的 MIME */
function mimeOf(headers: string): string | null {
    const ct = headerOf(headers, 'content-type');
    return ct ? ct.toLowerCase().split(';')[0].trim() || null : null;
}

/** 测试结果 */
interface SizeProbe {
    size: number | null;
    mime: string | null;
    via: SizeVia;
    drop: boolean;
}

/** HEAD：只读 content-length；服务器 405/403 或没给长度就走下一阶梯 */
async function probeHead(url: string): Promise<SizeProbe> {
    try {
        const resp = await gmRequest({ method: 'HEAD', url: url, timeout: HEAD_TIMEOUT });
        const mime = mimeOf(resp.responseHeaders);
        if (resp.status >= 400) return { size: null, mime: mime, via: 'unknown', drop: false };
        if (isClearlyNotImage(mime)) return { size: null, mime: mime, via: 'unknown', drop: true };
        const len = Number(headerOf(resp.responseHeaders, 'content-length'));
        if (Number.isFinite(len) && len > 0) return { size: len, mime: mime, via: 'head', drop: false };
        return { size: null, mime: mime, via: 'unknown', drop: false };
    } catch (e) {
        return { size: null, mime: null, via: 'unknown', drop: false };
    }
}

/**
 * Range GET：'bytes=0-0' 只下 1 个字节，从 content-range 里读总大小。
 * 服务器忽略 Range（回 200 整份）时退用返回 Blob 的 size —— 这时确实把整张图下下来了，
 * 但既然拿到准确字节数，就不再多发一次 HEAD。
 */
async function probeRange(url: string): Promise<SizeProbe> {
    try {
        const resp = await gmRequest({
            method: 'GET',
            url: url,
            headers: { Range: 'bytes=0-0' },
            responseType: 'blob',
            timeout: RANGE_TIMEOUT,
        });
        const blob = resp.response as Blob | undefined;
        const mime = mimeOf(resp.responseHeaders) || (blob && blob.type ? blob.type.toLowerCase() : null);
        if (isClearlyNotImage(mime)) return { size: null, mime: mime, via: 'unknown', drop: true };
        const cr = headerOf(resp.responseHeaders, 'content-range');
        const m = cr ? /\/(\d+)\s*$/.exec(cr) : null;
        if (m) {
            const total = Number(m[1]);
            if (Number.isFinite(total) && total > 0) return { size: total, mime: mime, via: 'range', drop: false };
        }
        if (blob && blob.size > 0) return { size: blob.size, mime: mime, via: 'range', drop: false };
        return { size: null, mime: mime, via: 'unknown', drop: false };
    } catch (e) {
        return { size: null, mime: null, via: 'unknown', drop: false };
    }
}

/** blob: 只能在页面上下文里 fetch（GM_xhr 打不开）；CSP 拦截就返回未知，不报错 */
async function probeBlobUrl(url: string): Promise<SizeProbe> {
    const blob = await fetchBlobInPage(url);
    if (!blob) return { size: null, mime: null, via: 'unknown', drop: false };
    const mime = blob.type ? blob.type.toLowerCase() : null;
    if (isClearlyNotImage(mime)) return { size: null, mime: mime, via: 'local', drop: true };
    return { size: blob.size || null, mime: mime, via: 'local', drop: false };
}

/** 页面上下文取 Blob（blob: 图专用；带超时，任何失败都返回 null） */
function fetchBlobInPage(url: string): Promise<Blob | null> {
    return new Promise<Blob | null>((resolve) => {
        let done = false;
        const finish = (b: Blob | null) => {
            if (done) return;
            done = true;
            resolve(b);
        };
        const timer = setTimeout(() => finish(null), LOCAL_FETCH_TIMEOUT);
        try {
            if (typeof fetch !== 'function') {
                clearTimeout(timer);
                finish(null);
                return;
            }
            fetch(url)
                .then((r) => r.blob())
                .then((b) => {
                    clearTimeout(timer);
                    finish(b && b.size ? b : null);
                })
                .catch(() => {
                    clearTimeout(timer);
                    finish(null);
                });
        } catch (e) {
            clearTimeout(timer);
            finish(null);
        }
    });
}

/** 单张图走一遍测量阶梯 */
async function probeOne(it: SniffCandidate): Promise<SizeProbe> {
    if (it.kind === 'svg') {
        const bytes = it.svgText ? utf8Bytes(it.svgText) : null;
        return { size: bytes, mime: 'image/svg+xml', via: bytes ? 'local' : 'unknown', drop: false };
    }
    if (it.kind === 'data') {
        const bytes = dataUrlBytes(it.url);
        return { size: bytes, mime: dataUrlMime(it.url), via: bytes ? 'local' : 'unknown', drop: false };
    }
    if (it.perfBytes && it.perfBytes > 0) {
        return { size: it.perfBytes, mime: it.mime, via: 'perf', drop: false };
    }
    if (it.kind === 'blob') return probeBlobUrl(it.url);
    const head = await probeHead(it.url);
    if (head.drop || head.size) return head;
    const range = await probeRange(it.url);
    return { size: range.size, mime: range.mime || head.mime, via: range.via, drop: range.drop };
}

/** 并发池：固定 concurrency 条协程抢同一个下标 */
async function runPool(total: number, concurrency: number, worker: (index: number) => Promise<void>): Promise<void> {
    let next = 0;
    const run = async () => {
        while (next < total) {
            const i = next;
            next++;
            await worker(i);
        }
    };
    const n = Math.max(1, Math.min(concurrency, total));
    const runners: Promise<void>[] = [];
    for (let i = 0; i < n; i++) runners.push(run());
    await Promise.all(runners);
}

/** 量所有候选的尺寸（并发 + 逐张回调），返回完成顺序的结果数组 */
export async function resolveSizes(items: SniffCandidate[], opts: ResolveOptions = {}): Promise<SniffedImage[]> {
    const out: SniffedImage[] = [];
    const concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : 5;
    const stopped = () => !!(opts.shouldStop && opts.shouldStop());
    await runPool(items.length, concurrency, async (i) => {
        const it = items[i];
        if (stopped()) return;
        let probe: SizeProbe;
        try {
            probe = await probeOne(it);
        } catch (e) {
            probe = { size: null, mime: it.mime, via: 'unknown', drop: false };
        }
        if (stopped()) return;
        const img: SniffedImage = {
            ...it,
            size: probe.size,
            mime: probe.mime || it.mime,
            sizeVia: probe.via,
            drop: probe.drop,
        };
        out.push(img);
        if (opts.onItem) opts.onItem(img);
    });
    return out;
}

/** 触发一次下载（隐藏 <a download>）。跨域 URL 直接给 a 会被忽略 download 而变成导航，故调用方先用 GM_xhr 取 Blob */
function anchorDownload(href: string, name: string): boolean {
    try {
        const a = document.createElement('a');
        a.href = href;
        a.download = name || '';
        a.rel = 'noopener';
        a.style.display = 'none';
        const parent = document.body || document.documentElement;
        parent.appendChild(a);
        a.click();
        a.remove();
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * 下载一张图：GM_xhr 取二进制 → objectURL → <a download>（这样跨域也能存成文件），
 * 失败或 blob:/data: 则退回直接给 <a href download>。
 * @returns 是否成功触发下载
 */
export async function downloadImage(url: string, filename: string): Promise<boolean> {
    if (/^data:/i.test(url)) return anchorDownload(url, filename);
    if (/^blob:/i.test(url)) {
        const blob = await fetchBlobInPage(url);
        if (blob) {
            const objUrl = URL.createObjectURL(blob);
            const ok = anchorDownload(objUrl, filename);
            setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
            return ok;
        }
        return anchorDownload(url, filename);
    }
    try {
        const resp = await gmRequest({ method: 'GET', url: url, responseType: 'blob', timeout: DOWNLOAD_TIMEOUT });
        const blob = resp.response as Blob | undefined;
        if (blob && blob.size > 0) {
            const objUrl = URL.createObjectURL(blob);
            const ok = anchorDownload(objUrl, filename);
            setTimeout(() => URL.revokeObjectURL(objUrl), 1000);
            return ok;
        }
    } catch (e) {
        /* 落到回退路径 */
    }
    return anchorDownload(url, filename);
}
