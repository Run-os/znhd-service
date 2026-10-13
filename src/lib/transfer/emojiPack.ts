/**
 * 传输助手的**在线表情包**数据层（v26.10.14-v3）。
 *
 * ── 为什么从「字符符号面板」换成在线表情包 ──────────────────────────────────
 * 旧面板（`chatEmojis.ts`，本版已删）只能在 BMP 区里挑 `☺ ☝ ★` 这类**老符号**：脚本的主战场是
 * 税务办的 Win7 机器，系统没有 Segoe UI Emoji 字体，U+1F300+ 的彩色 emoji 一律渲染成豆腐块。
 * 换成**图片表情**后这个约束自动消失 —— 图片不靠字体，Win7 上一样是彩色的。
 *
 * ── 数据来源：中继优先，CDN 兜底（v26.10.14-v3 起）────────────────────────────
 * 旧实现（v26.10.13-v3）每个客户端都**直连 cdn.klyang.com**：开一次面板打 8 个清单请求 +
 * N 个图片请求，既慢（跨网 + CDN 排队）又有被限流的风险（用户原话：「我怕触发限流」）。
 * 现改为：
 *   · **优先走中继** `<relayServer>/emoji/packs.json` 与 `/emoji/<合集>/<文件>` ——
 *     中继已把整套表情包拉到**自己的磁盘**（见 relay-server/emoji-store.js），同源、内网、
 *     可并发；这也是「表情包加载慢」的解药（客户端不再跨网逐张排队）。
 *   · **中继不可用（未部署 / 老中继没这些路由 / 该图中转失败）时自动回退 CDN 直连**，
 *     功能不回退 —— `EmojiItem.path` 为空时本来就走 CDN。
 * 合集清单的**单一来源**是 `relay-server/emoji-sources.json`（CDN 兜底路径与中继共用，
 * 改合集只改那一处；根 tsconfig 已开 resolveJsonModule）。
 *
 * ── 三个必须绕开的坑 ────────────────────────────────────────────────────────
 * 1. **必须走 `GM_xmlhttpRequest`，不能用 `<img src>` 直接引 CDN**：宿主税务页有 CSP，
 *    img-src 白名单里没有这个域，直接引用会整片裂图；GM 请求不受页面 CSP 约束
 *    （与中继长轮询绕过 connect-src 同一个理由）。中继图片同样走 GM：中继地址
 *    与税务页不同源，一样受 CSP 约束。
 * 2. **清单必须缓存**：面板每开一次就发 1 个（中继）或 8 个（CDN）请求没必要 ——
 *    缓存在 localStorage（键 `scriptCat_EmojiPacks`）12 小时；表情包是静态资源，
 *    TTL 给得长一些，面板上有「刷新」可强制重拉。
 * 3. **图片 blob 也要缓存**：点选表情后要把图片交给「待发图片 → 逐张发送」链路，
 *    本来就需要 blob，面板显示也用同一份（`URL.createObjectURL`）。objectURL **不主动 revoke**：
 *    全套最多几百张、单张几 KB，撤销反而会让面板缩略图与会话里的待发缩略图一起裂掉。
 *
 * 失败处理：单个合集失败就跳过（其余照常显示）；中继与 CDN **都**拿不到合集才 reject，
 * 面板给出「重试」。
 */

import { loadTransferSettings } from '@/lib/transfer/settings';
import { DEFAULT_RELAY_SERVER } from '@/lib/transfer/settings';
// 合集清单单一来源：relay-server/emoji-sources.json（中继预热与脚本端 CDN 兜底共用一份）
import emojiSources from '../../../relay-server/emoji-sources.json';

export interface EmojiItem {
    /** 合集内的键（`01` / `tv_doge` / `念诗之王` …），用于拼发送时的文件名 */
    key: string;
    /** 原图地址（CDN；中继不可用时的兜底） */
    url: string;
    /** 中继上的图片路径（`/emoji/<合集id>/<文件名>`；来自中继清单，CDN 兜底清单没有） */
    path?: string;
    /** 发送到手机时用的文件名（`<合集id>-<key>.<ext>`，做了非法字符净化） */
    name: string;
}

export interface EmojiPack {
    /** 合集 id（= JSON 文件名，如 `alurc`） */
    id: string;
    /** 合集显示名（JSON 里的 name，如「阿鲁日常」） */
    name: string;
    items: EmojiItem[];
}

/** CDN 兜底用的 8 个合集（顺序即面板里的顺序；单一来源 = relay-server/emoji-sources.json） */
export const EMOJI_PACK_SOURCES: Array<{ id: string; url: string }> = emojiSources as Array<{
    id: string;
    url: string;
}>;

const CACHE_KEY = 'scriptCat_EmojiPacks';
/** 清单缓存时长：表情包基本不变，12 小时足够，避免每次开面板都打请求 */
const CACHE_TTL = 12 * 60 * 60 * 1000;
/** 中继清单/图片请求超时（与 CDN 同档；中继在内网通常远快于这个） */
const RELAY_TIMEOUT = 15000;

/** 中继清单条目形态（relay-server/emoji-store.js 的 normalizePack 产出） */
interface RelayManifestItem {
    key: string;
    name: string;
    path: string;
    src: string;
}
interface RelayManifestPack {
    id: string;
    name: string;
    items: RelayManifestItem[];
}

/* ============================ GM 请求（脚本端才有） ============================ */

function gmGetText(url: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: RELAY_TIMEOUT,
            onload: (resp) => {
                if (resp.status >= 200 && resp.status < 300 && typeof resp.responseText === 'string') {
                    resolve(resp.responseText);
                    return;
                }
                reject(new Error('HTTP ' + resp.status));
            },
            onerror: () => reject(new Error('网络请求失败')),
            ontimeout: () => reject(new Error('请求超时')),
        });
    });
}

function gmGetBlob(url: string, timeoutMs: number): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: timeoutMs,
            onload: (resp) => {
                if (resp.status < 200 || resp.status >= 300) {
                    reject(new Error('HTTP ' + resp.status));
                    return;
                }
                const blob: Blob | undefined = resp && resp.response;
                if (!blob || typeof blob.size !== 'number' || !blob.size) {
                    reject(new Error('响应不是有效的图片数据'));
                    return;
                }
                resolve(blob);
            },
            onerror: () => reject(new Error('网络请求失败')),
            ontimeout: () => reject(new Error('请求超时')),
        });
    });
}

/* ============================ 中继地址 ============================ */

/**
 * 当前中继地址（表情包缓存服务就挂在这上面）。
 * 读传输助手设置里用户配的地址；没配过 / 配空了用线上默认地址。
 * 注意：老中继没有 /emoji 路由时请求会 404，调用方据此回退 CDN，功能不受影响。
 */
function currentRelayBase(): string {
    try {
        const base = loadTransferSettings().relayServer;
        return (base || DEFAULT_RELAY_SERVER).replace(/\/+$/, '');
    } catch (e) {
        return DEFAULT_RELAY_SERVER;
    }
}

/* ============================== 清单：拉取 + 缓存 ============================== */

/** 文件名净化：去掉路径分隔符与控制字符（合集 key 里可能有中文，中文本身不处理） */
function sanitizeName(s: string): string {
    return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'emoji';
}

function emojiFileName(packId: string, key: string, url: string): string {
    const ext = (url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i) || [])[1] || 'webp';
    return sanitizeName(packId + '-' + key) + '.' + ext.toLowerCase();
}

/** CDN 合集 JSON → EmojiPack（无 path，图片走 CDN 直连） */
function parsePack(srcId: string, text: string): EmojiPack {
    const raw = JSON.parse(text) as { name?: unknown; items?: unknown };
    // 先落到变量上再 Array.isArray：对「表达式」做类型守卫不会收窄，list 会退化成 unknown
    const rawItems = raw ? raw.items : undefined;
    const list: unknown[] = Array.isArray(rawItems) ? rawItems : [];
    const items: EmojiItem[] = [];
    list.forEach((it) => {
        const row = (it || {}) as { key?: unknown; val?: unknown };
        const url = String(row.val || '').trim();
        // 只收 http(s) 的图片地址，脏数据直接跳过（别让一条坏记录毁掉整个合集）
        if (!/^https?:\/\//i.test(url)) return;
        const key = String(row.key || '').trim() || 'emoji';
        items.push({ key, url, name: emojiFileName(srcId, key, url) });
    });
    if (!items.length) throw new Error('合集为空');
    return { id: srcId, name: String((raw && raw.name) || srcId), items };
}

/**
 * 中继合并清单 → EmojiPack[]（带 path，图片走中继）。
 *
 * ⚠️ path 必须严格校验：中继地址是用户可配的，恶意/被劫持的中继可能返回任意 path，
 *   而 GM_xmlhttpRequest 能跨域 —— 不校验就等于替中继打探任意 URL（SSRF 化）。
 *   只放行 `/emoji/<本合集id>/<白名单文件名>` 形态（与服务端路由正则同一套）。
 */
function parseRelayManifest(json: unknown): EmojiPack[] {
    const obj = json as { packs?: unknown };
    const rawPacks = obj && typeof obj === 'object' ? obj.packs : undefined;
    const list: unknown[] = Array.isArray(rawPacks) ? rawPacks : [];
    const packs: EmojiPack[] = [];
    list.forEach((p) => {
        const rec = (p || {}) as Partial<RelayManifestPack>;
        const id = String(rec.id || '');
        if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id)) return;
        const items: EmojiItem[] = [];
        const rawItems: unknown[] = Array.isArray(rec.items) ? rec.items : [];
        rawItems.forEach((it) => {
            const row = (it || {}) as Partial<RelayManifestItem>;
            const key = String(row.key || '').trim();
            const src = String(row.src || '').trim();
            const path = String(row.path || '');
            if (!key || !/^https?:\/\//i.test(src)) return;
            // path 必须形如 /emoji/<本合集id>/<文件名>，且文件名过服务端同款白名单
            const m = new RegExp('^/emoji/' + id + '/([A-Za-z0-9._-]{1,80})$').exec(path);
            if (!m) return;
            if (!/\.(webp|png|jpe?g|gif|svg|bmp)$/i.test(m[1])) return;
            items.push({ key, url: src, path, name: String(row.name || '') || emojiFileName(id, key, src) });
        });
        if (!items.length) return;
        packs.push({ id, name: String(rec.name || id), items });
    });
    return packs;
}

function readCache(): { base: string; packs: EmojiPack[] } | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { ts?: number; base?: unknown; packs?: EmojiPack[] };
        if (!parsed || !Array.isArray(parsed.packs) || !parsed.packs.length) return null;
        if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > CACHE_TTL) return null;
        if (typeof parsed.base !== 'string' || !parsed.base) return null;
        return { base: parsed.base, packs: parsed.packs };
    } catch (e) {
        return null;
    }
}

function writeCache(base: string, packs: EmojiPack[]): void {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), base, packs }));
    } catch (e) {
        /* 存储满 / 隐私模式：缓存失败不影响功能 */
    }
}

/** 清掉清单缓存（面板上的「刷新」用：强制重新拉取） */
export function clearEmojiPackCache(): void {
    try {
        localStorage.removeItem(CACHE_KEY);
    } catch (e) {
        /* 忽略 */
    }
}

/** 从中继拉合并清单（失败 reject，由调用方回退 CDN） */
function loadFromRelay(base: string): Promise<EmojiPack[]> {
    return gmGetText(base + '/emoji/packs.json').then((text) => {
        let json: unknown = null;
        try {
            json = JSON.parse(text);
        } catch (e) {
            throw new Error('中继清单不是合法 JSON');
        }
        const packs = parseRelayManifest(json);
        if (!packs.length) throw new Error('中继清单为空');
        return packs;
    });
}

/** 从 CDN 直拉全部合集（旧路径，兜底用；单个失败跳过） */
function loadFromCdn(): Promise<EmojiPack[]> {
    return Promise.all(
        EMOJI_PACK_SOURCES.map((src) =>
            gmGetText(src.url)
                .then((text) => parsePack(src.id, text))
                .catch(() => null)
        )
    ).then((results) => {
        const packs = results.filter((p): p is EmojiPack => !!p && p.items.length > 0);
        if (!packs.length) throw new Error('表情包全部加载失败（中继与 8 个 CDN 合集都没取到）');
        return packs;
    });
}

/**
 * 拉取全部表情包：命中缓存直接返回；否则**先试中继，失败回退 CDN**。
 *
 * @param force 忽略缓存强制重拉（面板「刷新」按钮）
 */
export async function loadEmojiPacks(force = false): Promise<EmojiPack[]> {
    const base = currentRelayBase();
    if (!force) {
        const hit = readCache();
        // 中继地址变过（用户改了设置）：缓存里的 path 属于旧中继，宁可重拉
        if (hit && hit.base === base) return hit.packs;
    }
    let packs: EmojiPack[];
    try {
        packs = await loadFromRelay(base);
    } catch (e) {
        packs = await loadFromCdn();
    }
    writeCache(base, packs);
    return packs;
}

/* ============================ 图片：blob + objectURL 缓存 ============================ */

interface CachedEmojiBlob {
    blob: Blob;
    objectUrl: string;
}

const blobCache = new Map<string, CachedEmojiBlob>();
const inflight = new Map<string, Promise<CachedEmojiBlob>>();

/** 缓存键：有中继路径就用它（中继优先）；否则 CDN 原址 */
function blobCacheKey(url: string, path?: string): string {
    return path || url;
}

/** 已经下好的表情图（面板渲染时先查它，避免重复请求） */
export function cachedEmojiBlob(url: string, path?: string): CachedEmojiBlob | undefined {
    return blobCache.get(blobCacheKey(url, path));
}

/**
 * 取表情图（带缓存与去重：同一张图面板显示与「点选加入待发」共用一次下载）。
 *
 * 优先走中继（`<中继>/<item.path>`），失败自动回退 CDN 原址 —— 中继未部署该图 /
 * 老中继没有 /emoji 路由时用户无感。两个地址都失败才 reject，由调用方决定
 * 「这张留白 / 提示失败」。
 */
export function loadEmojiBlob(url: string, path?: string): Promise<CachedEmojiBlob> {
    const key = blobCacheKey(url, path);
    const hit = blobCache.get(key);
    if (hit) return Promise.resolve(hit);
    const running = inflight.get(key);
    if (running) return running;
    const task = (async () => {
        if (path) {
            try {
                const blob = await gmGetBlob(currentRelayBase() + path, RELAY_TIMEOUT);
                return finish(key, blob);
            } catch (e) {
                /* 中继这条没拿到：落 CDN 兜底 */
            }
        }
        const blob = await gmGetBlob(url, 20000);
        return finish(key, blob);
    })().finally(() => {
        inflight.delete(key);
    });
    inflight.set(key, task);
    return task;
}

function finish(key: string, blob: Blob): CachedEmojiBlob {
    const entry: CachedEmojiBlob = { blob, objectUrl: URL.createObjectURL(blob) };
    blobCache.set(key, entry);
    return entry;
}
