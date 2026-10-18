/**
 * 手机页聊天记录的本地持久化（v26.10.19-v10，对齐脚本端 `src/lib/transfer/persist.ts` 的语义）。
 *
 * 用户要求：客户端（手机页）与脚本端一致，会话内容持久化保存在本地，7 天过期自动删除，
 * 或由用户手动清空（标题栏「清空聊天记录」按钮）。
 *
 * ── 为什么是 IndexedDB ────────────────────────────────────────────────
 * 收到的图片 / 文件是 data:URL（base64 字符串，单张可达数 MB），localStorage 只有 ~5MB；
 * IndexedDB 配额以 MB/GB 计。隐私模式 / 存储被清时打开失败 → 全部操作静默降级为内存态，
 * 绝不因持久化失败影响收发主链路。
 *
 * ── 设计 ───────────────────────────────────────────────────────────────
 *  · 整个聊天一个记录（key='chat'）整体覆盖写 —— 消息量级（MAX_MSGS=100）下足够简单；
 *  · TTL 7 天：写入前与载入时都做裁剪（丢 ts 超期消息）；
 *  · **blob: URL 不落盘**：自己发出的图片 / 文件的 objectURL 跨刷新无效，载入时同样剔除；
 *    收到的内容是 data:URL，可无损往返；
 *  · 写入走 800ms 防抖（连续收发 / 进度回写不抖爆 IDB）。
 */
export interface ChatMsg {
    id: string;
    type: 'image' | 'file' | 'text';
    /** out = 手机发到电脑；in = 电脑发来 */
    side: 'in' | 'out';
    text?: string;
    /** 图片展示地址（out = objectURL；in = data:URL）；文件消息里它是 Blob 的 objectURL（供下载） */
    url?: string;
    name?: string;
    mime?: string;
    /** 文件消息的字节数（气泡里显示大小；图片不需要，靠自然尺寸展示） */
    size?: number;
    /** 发送状态（仅 out；发送中 / 已发送 / 发送失败） */
    state?: 'sending' | 'failed' | 'ok';
    /** 上传进度（0–100，仅 state==='sending' 时有意义）；首个 progress 事件到达前是 undefined */
    progress?: number;
    err?: string;
    ts: number;
}

/** 消息保留时长：7 天 */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DB_NAME = 'znhd-phone-chat';
const STORE = 'chat';
const KEY = 'chat';
const SAVE_DELAY = 800;

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
}

/** 裁剪：超期消息丢弃；blob: URL（自己发出的图 / 文件）刷新后无效，同样不保留 */
function prune(list: ChatMsg[], now = Date.now()): ChatMsg[] {
    const minTs = now - TTL_MS;
    return list.filter((m) => (m.ts || 0) >= minTs && !(m.url || '').startsWith('blob:'));
}

export async function loadChatMessages(): Promise<ChatMsg[]> {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(KEY);
            req.onsuccess = () => resolve(prune(Array.isArray(req.result?.messages) ? req.result.messages : []));
            req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
        });
    } catch (e) {
        console.warn('[手机页] 聊天记录载入失败（降级为内存态）:', e);
        return [];
    }
}

let saveTimer: number | null = null;
let pending: ChatMsg[] = [];

/** 800ms 防抖写盘；重复调用自动合并（只保存最后一次的列表） */
export function saveChatMessages(messages: ChatMsg[]): void {
    pending = messages;
    if (saveTimer !== null) return;
    saveTimer = window.setTimeout(() => {
        saveTimer = null;
        const list = prune(pending);
        openDb()
            .then((db) => {
                const tx = db.transaction(STORE, 'readwrite');
                if (list.length) tx.objectStore(STORE).put({ messages: list }, KEY);
                else tx.objectStore(STORE).delete(KEY);
            })
            .catch((e) => console.warn('[手机页] 聊天记录保存失败（降级为内存态）:', e));
    }, SAVE_DELAY);
}

/** 手动清空：删掉持久化记录（调用方负责清空内存态） */
export function clearChatMessages(): void {
    pending = [];
    if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
    }
    openDb()
        .then((db) => {
            db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY);
        })
        .catch((e) => console.warn('[手机页] 聊天记录清空失败:', e));
}
