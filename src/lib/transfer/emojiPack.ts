/**
 * 传输助手的**在线表情包**数据层（v26.10.13-v3）。
 *
 * ── 为什么从「字符符号面板」换成在线表情包 ──────────────────────────────────
 * 旧面板（`chatEmojis.ts`，本版已删）只能在 BMP 区里挑 `☺ ☝ ★` 这类**老符号**：脚本的主战场是
 * 税务办的 Win7 机器，系统没有 Segoe UI Emoji 字体，U+1F300+ 的彩色 emoji 一律渲染成豆腐块。
 * 换成**图片表情**后这个约束自动消失 —— 图片不靠字体，Win7 上一样是彩色的。
 *
 * ── 数据来源 ────────────────────────────────────────────────────────────────
 * 8 个合集的地址写死在 `EMOJI_PACK_SOURCES`（用户给定，均在 cdn.klyang.com）：
 *   · 清单 JSON：`https://cdn.klyang.com/json/<id>.json`
 *     → `{ name: '阿鲁日常', type: 'image', items: [{ key: '01', val: '<图片地址>' }] }`
 *   · 图片本体：`https://cdn.klyang.com/emo/.../<key>.webp`（静态 webp，实测单张 2–6 KB）
 *
 * ── 三个必须绕开的坑 ────────────────────────────────────────────────────────
 * 1. **必须走 `GM_xmlhttpRequest`，不能用 `<img src>` 直接引 CDN**：宿主税务页有 CSP，
 *    img-src 白名单里没有这个域，直接引用会整片裂图；GM 请求不受页面 CSP 约束
 *    （与中继长轮询绕过 connect-src 同一个理由）。
 * 2. **清单必须缓存**：面板每开一次就拉 8 个请求没必要 —— 缓存在 localStorage
 *    （键 `scriptCat_EmojiPacks`）12 小时；表情包是静态资源，TTL 给得长一些，
 *    面板上有「刷新」可强制重拉。
 * 3. **图片 blob 也要缓存**：点选表情后要把图片交给「待发图片 → 逐张发送」链路，
 *    本来就需要 blob，面板显示也用同一份（`URL.createObjectURL`）。objectURL **不主动 revoke**：
 *    全套最多几百张、单张几 KB，撤销反而会让面板缩略图与会话里的待发缩略图一起裂掉。
 *
 * 失败处理：单个合集失败就跳过（其余照常显示）；8 个全失败才 reject，面板给出「重试」。
 */

export interface EmojiItem {
    /** 合集内的键（`01` / `tv_doge` / `念诗之王` …），用于拼发送时的文件名 */
    key: string;
    /** 原图地址（CDN） */
    url: string;
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

/** 用户给定的 8 个合集（顺序即面板里的顺序） */
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

const CACHE_KEY = 'scriptCat_EmojiPacks';
/** 清单缓存时长：表情包基本不变，12 小时足够，避免每次开面板都打 8 个请求 */
const CACHE_TTL = 12 * 60 * 60 * 1000;

/* ============================ GM 请求（脚本端才有） ============================ */

function gmGetText(url: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            timeout: 15000,
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

function gmGetBlob(url: string): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
        GM_xmlhttpRequest({
            method: 'GET',
            url,
            responseType: 'blob',
            timeout: 20000,
            onload: (resp) => {
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

/* ============================== 清单：拉取 + 缓存 ============================== */

/** 文件名净化：去掉路径分隔符与控制字符（合集 key 里可能有中文，中文本身不处理） */
function sanitizeName(s: string): string {
    return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'emoji';
}

function emojiFileName(packId: string, key: string, url: string): string {
    const ext = (url.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i) || [])[1] || 'webp';
    return sanitizeName(packId + '-' + key) + '.' + ext.toLowerCase();
}

function readCache(): EmojiPack[] | null {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { ts?: number; packs?: EmojiPack[] };
        if (!parsed || !Array.isArray(parsed.packs) || !parsed.packs.length) return null;
        if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > CACHE_TTL) return null;
        return parsed.packs;
    } catch (e) {
        return null;
    }
}

function writeCache(packs: EmojiPack[]): void {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), packs }));
    } catch (e) {
        /* 存储满 / 隐私模式：缓存失败不影响功能 */
    }
}

/** 清掉清单缓存（面板上的「刷新」用：强制重新拉 8 个合集） */
export function clearEmojiPackCache(): void {
    try {
        localStorage.removeItem(CACHE_KEY);
    } catch (e) {
        /* 忽略 */
    }
}

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
 * 拉取全部表情包：命中缓存直接返回，否则并发拉 8 个清单（单个失败跳过）。
 *
 * @param force 忽略缓存强制重拉（面板「刷新」按钮）
 */
export async function loadEmojiPacks(force = false): Promise<EmojiPack[]> {
    if (!force) {
        const hit = readCache();
        if (hit) return hit;
    }
    const results = await Promise.all(
        EMOJI_PACK_SOURCES.map((src) =>
            gmGetText(src.url)
                .then((text) => parsePack(src.id, text))
                .catch(() => null)
        )
    );
    const packs = results.filter((p): p is EmojiPack => !!p && p.items.length > 0);
    if (!packs.length) throw new Error('表情包全部加载失败（8 个合集都没取到）');
    writeCache(packs);
    return packs;
}

/* ============================ 图片：blob + objectURL 缓存 ============================ */

interface CachedEmojiBlob {
    blob: Blob;
    objectUrl: string;
}

const blobCache = new Map<string, CachedEmojiBlob>();
const inflight = new Map<string, Promise<CachedEmojiBlob>>();

/** 已经下好的表情图（面板渲染时先查它，避免重复请求） */
export function cachedEmojiBlob(url: string): CachedEmojiBlob | undefined {
    return blobCache.get(url);
}

/**
 * 取表情图（带缓存与去重：同一张图面板显示与「点选加入待发」共用一次下载）。
 * 下载失败会 reject，由调用方决定「这张留白 / 提示失败」。
 */
export function loadEmojiBlob(url: string): Promise<CachedEmojiBlob> {
    const hit = blobCache.get(url);
    if (hit) return Promise.resolve(hit);
    const running = inflight.get(url);
    if (running) return running;
    const task = gmGetBlob(url)
        .then((blob) => {
            const entry: CachedEmojiBlob = { blob, objectUrl: URL.createObjectURL(blob) };
            blobCache.set(url, entry);
            return entry;
        })
        .finally(() => {
            inflight.delete(url);
        });
    inflight.set(url, task);
    return task;
}
