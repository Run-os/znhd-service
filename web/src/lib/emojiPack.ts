/**
 * 手机端在线表情包数据层（v26.10.13-v3）—— `EmojiPanel` 的数据来源。
 *
 * 与脚本端 `src/lib/transfer/emojiPack.ts` **同一份 8 个合集清单**（用户给定，均在
 * cdn.klyang.com），差异只在取数方式：脚本端在税务页里必须走 `GM_xmlhttpRequest`
 * （宿主页 CSP 的 img-src 白名单没有这个域）；手机页是本服务**同源托管**的独立页、
 * 无 CSP 约束，且 CDN 对带 Origin 的请求会回 `Access-Control-Allow-Origin: *`
 * （实测：清单 JSON 与 webp 资产都回），故直接用 `fetch` 即可，无需中继代理。
 *
 * ── 两个缓存（理由与脚本端相同）─────────────────────────────────────────────
 * 1. **清单缓存**：面板每开一次拉 8 个请求没必要 —— localStorage（键 `znhd_EmojiPacks`）
 *    存 12 小时；表情包是静态资源，TTL 给长一些，面板上有「刷新」可强制重拉。
 * 2. **图片 blob 缓存**：点选后要把图片 base64 后 POST 到中继，本来就需要 blob，
 *    面板缩略图也用同一份（`URL.createObjectURL`）。objectURL **不主动 revoke**：
 *    单张 2–6KB，撤销反而会让面板缩略图与会话气泡里的图一起裂掉。
 *
 * 失败处理：单个合集失败就跳过（其余照常显示）；全部失败才 reject，面板给出「重试」。
 */

export interface EmojiItem {
    /** 合集内的键（`01` / `tv_doge` …），用于拼发送时的文件名 */
    key: string;
    /** 原图地址（CDN） */
    url: string;
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

/** 与脚本端完全一致的 8 个合集（顺序即面板里的顺序） */
export const EMOJI_PACK_SOURCES: Array<{ id: string; url: string }> = [
    { id: 'aluhedwm', url: 'https://cdn.klyang.com/json/aluhedwm.json' },
    { id: 'alurc', url: 'https://cdn.klyang.com/json/alurc.json' },
    { id: 'alurc2', url: 'https://cdn.klyang.com/json/alurc2.json' },
    { id: 'aluyn', url: 'https://cdn.klyang.com/json/aluyn.json' },
    { id: 'jralu', url: 'https://cdn.klyang.com/json/jralu.json' },
    { id: 'rcxly', url: 'https://cdn.klyang.com/json/rcxly.json' },
    { id: 'tvxds', url: 'https://cdn.klyang.com/json/tvxds.json' },
    { id: 'xhl', url: 'https://cdn.klyang.com/json/xhl.json' },
];

const CACHE_KEY = 'znhd_EmojiPacks';
/** 清单缓存时长：表情包基本不变，12 小时足够，避免每次开面板都打 8 个请求 */
const CACHE_TTL = 12 * 60 * 60 * 1000;
/** 单张图片下载超时（比脚本端 20s 收紧：手机网络差时让用户早点看到失败重试） */
const ASSET_TIMEOUT = 15000;

/** 文件名净化：去掉路径分隔符与控制字符（合集 key 里可能有中文，中文本身不处理） */
function sanitizeName(s: string): string {
    return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'emoji';
}

function emojiFileName(packId: string, key: string, url: string): string {
    const ext = (url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i) || [])[1] || 'webp';
    return sanitizeName(packId + '-' + key) + '.' + ext.toLowerCase();
}

/** 把一份合集 JSON 规范成 EmojiPack（字段缺失/结构异常时返回 null） */
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

/** 拉全部合集（单集失败跳过）；全部失败才 reject。`force` = 跳过缓存重拉 */
export function loadEmojiPacks(force: boolean): Promise<EmojiPack[]> {
    if (!force) {
        const hit = readCache();
        if (hit && hit.length) return Promise.resolve(hit);
    }
    return Promise.all(EMOJI_PACK_SOURCES.map((s) => fetchPack(s).catch(() => null)))
        .then((list) => {
            const packs = list.filter((p): p is EmojiPack => !!p);
            if (!packs.length) throw new Error('表情包加载失败（8 个合集均无法访问）');
            writeCache(packs);
            return packs;
        });
}

/* ============================== 图片：blob 缓存 ============================== */

/** url -> { blob, objectURL }（进程内缓存，关页即失） */
const blobCache = new Map<string, { blob: Blob; objectUrl: string }>();

/** 取缓存的 blob 条目（未下载返回 undefined）——面板渲染与点选发送共用 */
export function cachedEmojiBlob(url: string): { blob: Blob; objectUrl: string } | undefined {
    return blobCache.get(url);
}

/** 下载一张表情为 blob（命中缓存直接返回）；失败 reject 由调用方兜 */
export function loadEmojiBlob(url: string): Promise<{ blob: Blob; objectUrl: string }> {
    const hit = blobCache.get(url);
    if (hit) return Promise.resolve(hit);
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
                const entry = { blob, objectUrl: URL.createObjectURL(blob) };
                blobCache.set(url, entry);
                resolve(entry);
            })
            .catch((e: Error) => {
                window.clearTimeout(timer);
                reject(e);
            });
    });
}
