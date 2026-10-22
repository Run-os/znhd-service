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
 *  · **url 里的 blob: 不落盘**（objectURL 跨刷新必然失效），但消息本身要留住：
 *    v26.10.22-v4 起自己发出的图 / 文件额外挂 `blob` 字段，让 IndexedDB 原生存二进制，
 *    载入时再用它重建 objectURL。旧实现只会「把 blob: 消息整条丢掉」⇒ 自己发的图一刷新全没；
 *  · 写入走 800ms 防抖（连续收发 / 进度回写不抖爆 IDB），并额外提供 flush
 *    供 pagehide / 页面隐藏时立刻落盘。
 */
export interface ChatMsg {
    id: string;
    type: 'image' | 'file' | 'text';
    /** out = 手机发到电脑；in = 电脑发来 */
    side: 'in' | 'out';
    text?: string;
    /** 图片展示地址（out = objectURL；in = data:URL）；文件消息里它是 Blob 的 objectURL（供下载） */
    url?: string;
    /**
     * 原始二进制（v26.10.22-v4）：out 的图片 / 文件必须带上它才能跨刷新留存 ——
     * url 里的 objectURL 刷新即失效，只有 Blob 能进 IndexedDB。in 的消息是 data:URL，可不带。
     */
    blob?: Blob;
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

/**
 * 裁剪：超期消息丢弃；图片 / 文件消息若既没有 Blob（跨刷新可复用）也没有 data:URL，
 * 说明它是旧版本存下的「只剩失效 objectURL」的残骸 → 丢掉（渲染出来必然裂图）。
 */
function prune(list: ChatMsg[], now = Date.now()): ChatMsg[] {
    const minTs = now - TTL_MS;
    return list.filter((m) => {
        if ((m.ts || 0) < minTs) return false;
        if (m.type === 'text') return true;
        return !!m.blob || (m.url || '').startsWith('data:');
    });
}

/**
 * 落盘前转成**纯对象**并摘掉跨刷新必失效的 objectURL。
 *
 * ⚠️ 必须返回新对象（v26.10.22-v4）：调用方传进来的 `msgs` 是 Vue 的响应式 Proxy，
 * Chrome 对 Proxy 执行结构化克隆会抛 `DataCloneError: could not be cloned`，
 * 而 put 失败只被 catch 成一条 console.warn —— 表现就是「聊天记录一条都没存下来，
 * 刷新全丢」（有文本消息时必崩，因为文本走不到下面那条浅拷贝分支）。
 */
function toStored(m: ChatMsg): ChatMsg {
    const { url, ...rest } = m;
    return (url && !url.startsWith('blob:') ? { ...rest, url } : { ...rest }) as ChatMsg;
}

export async function loadChatMessages(): Promise<ChatMsg[]> {
    try {
        const db = await openDb();
        const list = await new Promise<ChatMsg[]>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(KEY);
            req.onsuccess = () => resolve(Array.isArray(req.result?.messages) ? req.result.messages : []);
            req.onerror = () => reject(req.error || new Error('IndexedDB get failed'));
        });
        db.close();
        // 有 Blob 的消息就地重建预览地址（旧记录里的 url 已是无效 objectURL，会被覆盖掉）
        return prune(list).map((m) => {
            // 上次刷新/关闭时还卡在「发送中」的：真实状态已不可考，标成失败让用户看得见
            const base: ChatMsg =
                m.state === 'sending'
                    ? { ...m, state: 'failed', err: '上次页面关闭时发送未完成', progress: undefined }
                    : m;
            if (!base.blob) return base;
            try {
                return { ...base, url: URL.createObjectURL(base.blob) };
            } catch (e) {
                return base;
            }
        });
    } catch (e) {
        console.warn('[手机页] 聊天记录载入失败（降级为内存态）:', e);
        return [];
    }
}

let saveTimer: number | null = null;
let pending: ChatMsg[] = [];

/** 立刻写盘（不等防抖）—— pagehide / 页面隐藏时用，尽力而为（IDB 写入是异步的） */
export function flushChatMessages(): void {
    if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
    }
    const list = prune(pending).map(toStored);
    openDb()
        .then((db) => {
            const tx = db.transaction(STORE, 'readwrite');
            if (list.length) tx.objectStore(STORE).put({ messages: list }, KEY);
            else tx.objectStore(STORE).delete(KEY);
            tx.oncomplete = () => db.close();
            tx.onerror = () => db.close();
        })
        .catch((e) => console.warn('[手机页] 聊天记录保存失败（降级为内存态）:', e));
}

/** 800ms 防抖写盘；重复调用自动合并（只保存最后一次的列表） */
export function saveChatMessages(messages: ChatMsg[]): void {
    pending = messages;
    if (saveTimer !== null) return;
    saveTimer = window.setTimeout(() => {
        saveTimer = null;
        flushChatMessages();
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
