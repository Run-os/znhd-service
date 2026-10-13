/**
 * 手机端在线表情包数据层（v26.10.14-v3）—— `EmojiPanel` 的数据来源。
 *
 * ── 数据来源：同源中继优先，CDN 兜底（v26.10.14-v3 起）────────────────────────────
 * 旧实现（v26.10.13-v3）手机页**直连 cdn.klyang.com**：每开一次面板打 8 个清单请求 +
 * N 个图片请求，既慢又有被 CDN 限流的风险（用户原话：「我怕触发限流」）。
 * 现改为优先走**同源中继**（`/emoji/packs.json` 与 `/emoji/<合集>/<文件>`）——
 * 中继已把整套表情包拉到自己的磁盘（见 relay-server/emoji-store.js），手机页又是中继
 * 同源托管的，取数就是一次内网/同源请求，快且无限流风险；中继不可用（老中继没有
 * /emoji 路由等）时自动回退 CDN 直连，功能不回退。
 *
 * 与脚本端 `src/lib/transfer/emojiPack.ts` 的差异只在取数方式：脚本端在税务页里必须走
 * `GM_xmlhttpRequest`（宿主页 CSP 的 img-src 白名单没有 CDN 这个域）；手机页是本服务
 * **同源托管**的独立页、无 CSP 约束，普通 `fetch` 即可（CDN 兜底路径对带 Origin 的请求
 * 会回 `Access-Control-Allow-Origin: *`，实测清单 JSON 与 webp 资产都回）。
 *
 * 合集清单的**单一来源**是 `relay-server/emoji-sources.json`（CDN 兜底路径与中继共用，
 * 改合集只改那一处）。
 *
 * ── 两个缓存（理由与脚本端相同）─────────────────────────────────────────────
 * 1. **清单缓存**：面板每开一次拉 1 个请求没必要 —— localStorage（键 `znhd_EmojiPacks`）
 *    存 12 小时；表情包是静态资源，TTL 给长一些，面板上有「刷新」可强制重拉。
 * 2. **图片 blob 缓存**：点选后要把图片 base64 后 POST 到中继，本来就需要 blob，
 *    面板缩略图也用同一份（`URL.createObjectURL`）。objectURL **不主动 revoke**：
 *    单张 2–6KB，撤销反而会让面板缩略图与会话气泡里的图一起裂掉。
 *
 * 失败处理：单个合集失败就跳过（其余照常显示）；中继与 CDN **都**失败才 reject，
 * 面板给出「重试」。
 */

// 合集清单单一来源：relay-server/emoji-sources.json（中继预热与手机端 CDN 兜底共用一份）
import emojiSources from '../../../relay-server/emoji-sources.json';

export interface EmojiItem {
    /** 合集内的键（`01` / `tv_doge` …），用于拼发送时的文件名 */
    key: string;
    /** 原图地址（CDN；中继不可用时的兜底） */
    url: string;
    /** 中继上的图片路径（`/emoji/<合集id>/<文件名>`；来自中继清单，CDN 兜底清单没有） */
    path?: string;
    /** 发送到电脑时用的文件名（`<合集id>-<key>.<ext>`，做了非法字符净化） */
    name: string;
}

export interface EmojiPack {
    /** 合集 id（= JSON 文件名，如 `alurc`） */
    id: string;
    /** 合集显示名（JSON 里的 name，如「阿鲁日常」） */
    name: string;
    items: EmojiItem[];
}

/** 用户点选的一张表情（blob 已就绪，调用方直接 base64 后发送） */
export interface PickedEmoji {
    /** 合集显示名 */
    pack: string;
    /** 合集内的键 */
    key: string;
    /** 原图地址 */
    url: string;
    /** 发送到电脑时用的文件名 */
    name: string;
    blob: Blob;
}

/** CDN 兜底用的 8 个合集（顺序即面板里的顺序；单一来源 = relay-server/emoji-sources.json） */
export const EMOJI_PACK_SOURCES: Array<{ id: string; url: string }> = emojiSources as Array<{
    id: string;
    url: string;
}>;

const CACHE_KEY = 'znhd_EmojiPacks';
/** 清单缓存时长：表情包基本不变，12 小时足够，避免每次开面板都打请求 */
const CACHE_TTL = 12 * 60 * 60 * 1000;
/** 单张图片下载超时（比脚本端 20s 收紧：手机网络差时让用户早点看到失败重试） */
const ASSET_TIMEOUT = 15000;

/** 中继清单条目形态（relay-server/emoji-store.js 的 normalizePack 产出） */
interface RelayManifestItem {
    key: string;
    name: string;
    path: string;
    src: string;
}

/** 文件名净化：去掉路径分隔符与控制字符（合集 key 里可能有中文，中文本身不处理） */
function sanitizeName(s: string): string {
    return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'emoji';
}

function emojiFileName(packId: string, key: string, url: string): string {
    const ext = (url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i) || [])[1] || 'webp';
    return sanitizeName(packId + '-' + key) + '.' + ext.toLowerCase();
}

/** 把一份 CDN 合集 JSON 规范成 EmojiPack（字段缺失/结构异常时返回 null） */
function normalizePack(id: string, json: unknown): EmojiPack | null {
    const obj = json as { name?: unknown; type?: unknown; items?: unknown };
    if (!obj || typeof obj !== 'object') return null;
    // type 存在且不是 image 时跳过（清单格式约定，防御性保留）
    if (obj.type !== undefined && obj.type !== 'image') return null;
    const items = Array.isArray(obj.items) ? obj.items : [];
    const norm: EmojiItem[] = [];
    items.forEach((it) => {
        const rec = it as { key?: unknown; val?: unknown };
        const key = typeof rec.key === 'string' ? rec.key : '';
        const url = typeof rec.val === 'string' ? rec.val : '';
        if (!key || !/^https?:\/\//i.test(url)) return;
        norm.push({ key, url, name: emojiFileName(id, key, url) });
    });
    if (!norm.length) return null;
    return { id, name: typeof obj.name === 'string' && obj.name ? obj.name : id, items: norm };
}

/**
 * 中继合并清单 → EmojiPack[]（带 path，图片走中继）。
 *
 * ⚠️ path 严格校验：只放行 `/emoji/<本合集id>/<白名单文件名>` 形态（与服务端路由正则
 * 同一套）。中继是本服务自己，但载荷毕竟来自网络，防御性校验不花钱。
 */
function parseRelayManifest(json: unknown): EmojiPack[] {
    const obj = json as { packs?: unknown };
    const rawPacks = obj && typeof obj === 'object' ? obj.packs : undefined;
    const list: unknown[] = Array.isArray(rawPacks) ? rawPacks : [];
    const packs: EmojiPack[] = [];
    list.forEach((p) => {
        const rec = (p || {}) as { id?: unknown; name?: unknown; items?: unknown };
        const id = typeof rec.id === 'string' ? rec.id : '';
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) return;
        const items: EmojiItem[] = [];
        const rawItems: unknown[] = Array.isArray(rec.items) ? rec.items : [];
        rawItems.forEach((it) => {
            const row = (it || {}) as Partial<RelayManifestItem>;
            const key = typeof row.key === 'string' ? row.key.trim() : '';
            const src = typeof row.src === 'string' ? row.src.trim() : '';
            const path = typeof row.path === 'string' ? row.path : '';
            if (!key || !/^https?:\/\//i.test(src)) return;
            const m = new RegExp('^/emoji/' + id + '/([A-Za-z0-9._-]{1,80})$').exec(path);
            if (!m) return;
            if (!/\.(webp|png|jpe?g|gif|svg|bmp)$/i.test(m[1])) return;
            items.push({ key, url: src, path, name: (typeof row.name === 'string' && row.name) || emojiFileName(id, key, src) });
        });
        if (!items.length) return;
        packs.push({ id, name: (typeof rec.name === 'string' && rec.name) || id, items });
    });
    return packs;
}

/* ============================== 清单：拉取 + 缓存 ============================== */

function readCache(): EmojiPack[] | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { ts?: number; packs?: EmojiPack[] };
        if (!parsed || typeof parsed.ts !== 'number' || !Array.isArray(parsed.packs)) return null;
        if (Date.now() - parsed.ts > CACHE_TTL) return null;
        return parsed.packs;
    } catch (e) {
        return null;
    }
}

function writeCache(packs: EmojiPack[]): void {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), packs }));
    } catch (e) {
        /* 隐私模式等写不进去：忽略，面板仍可用（只是每次重拉） */
    }
}

async function fetchPack(src: { id: string; url: string }): Promise<EmojiPack | null> {
    const r = await fetch(src.url, { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return normalizePack(src.id, await r.json());
}

/** 从中继（同源）拉合并清单；失败 reject，由调用方回退 CDN */
async function loadFromRelay(): Promise<EmojiPack[]> {
    const r = await fetch('/emoji/packs.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const packs = parseRelayManifest(await r.json());
    if (!packs.length) throw new Error('中继清单为空');
    return packs;
}

/** 拉全部合集（单集失败跳过）；全部失败才 reject。`force` = 跳过缓存重拉 */
export function loadEmojiPacks(force: boolean): Promise<EmojiPack[]> {
    if (!force) {
        const hit = readCache();
        if (hit && hit.length) return Promise.resolve(hit);
    }
    return loadFromRelay()
        .catch(() =>
            // 中继没拿到（老中继没有 /emoji 路由 / 网络抖动）：回退 CDN 直连，功能不回退
            Promise.all(EMOJI_PACK_SOURCES.map((s) => fetchPack(s).catch(() => null))).then((list) => {
                const packs = list.filter((p): p is EmojiPack => !!p);
                if (!packs.length) throw new Error('表情包加载失败（中继与 8 个 CDN 合集都没取到）');
                return packs;
            })
        )
        .then((packs) => {
            writeCache(packs);
            return packs;
        });
}

/* ============================== 图片：blob 缓存 ============================== */

/** 缓存键（url -> { blob, objectURL }）；有中继路径就用它（中继优先），否则 CDN 原址 */
function blobCacheKey(url: string, path?: string): string {
    return path || url;
}

const blobCache = new Map<string, { blob: Blob; objectUrl: string }>();

/** 取缓存的 blob 条目（未下载返回 undefined）——面板渲染与点选发送共用 */
export function cachedEmojiBlob(url: string, path?: string): { blob: Blob; objectUrl: string } | undefined {
    return blobCache.get(blobCacheKey(url, path));
}

/** 带超时地 fetch 一张图为 blob（AbortController + 定时器双保险，老 WebView 也认） */
function fetchBlob(url: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const ctrl = 'AbortController' in window ? new AbortController() : null;
        const timer = window.setTimeout(() => {
            if (ctrl) ctrl.abort();
            reject(new Error('下载超时'));
        }, ASSET_TIMEOUT);
        const opt: RequestInit = {};
        if (ctrl) opt.signal = ctrl.signal;
        fetch(url, opt)
            .then((r) => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.blob();
            })
            .then((blob) => {
                window.clearTimeout(timer);
                if (!blob.size) throw new Error('响应不是有效的图片数据');
                resolve(blob);
            })
            .catch((e: Error) => {
                window.clearTimeout(timer);
                reject(e);
            });
    });
}

/**
 * 下载一张表情为 blob（命中缓存直接返回）。
 * 优先走中继（`item.path`，同源），失败自动回退 CDN 原址 —— 中继未部署该图 /
 * 老中继没有 /emoji 路由时用户无感。两个地址都失败才 reject，由调用方兜。
 */
export function loadEmojiBlob(url: string, path?: string): Promise<{ blob: Blob; objectUrl: string }> {
    const key = blobCacheKey(url, path);
    const hit = blobCache.get(key);
    if (hit) return Promise.resolve(hit);
    return (path ? fetchBlob(path).catch(() => fetchBlob(url)) : fetchBlob(url)).then((blob) => {
        const entry = { blob, objectUrl: URL.createObjectURL(blob) };
        blobCache.set(key, entry);
        return entry;
    });
}
