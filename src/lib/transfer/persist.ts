/**
 * 传输会话的本地持久化（v26.10.12-v5）。
 *
 * 用户要求：脚本可以持久化保存对话内容（包括图片和文本），仅保留一周，超期自动删除。
 *
 * ── 为什么是 IndexedDB 而不是 localStorage ─────────────────────────────
 * 图片消息带 Blob（压缩后最大仍可到 ~12MB/张），localStorage 只有 ~5MB 且只能存字符串；
 * IndexedDB 原生支持存 Blob、配额以 MB/GB 计。隐私模式 / 存储被清时打开失败 → 全部
 * 操作静默降级为内存态（回到 v4 之前的行为），绝不因持久化失败影响收发主链路。
 *
 * ── 设计 ───────────────────────────────────────────────────────────────
 *   · 一个会话一条记录（keyPath = 会话键），整体覆盖写 —— 消息量级（百条内）下
 *     比「每条消息一行」简单得多，且天然与会话删除对齐；
 *   · 存前剥掉 previewUrl（objectURL 跨会话无效），载入后用存下来的 Blob 重建；
 *   · TTL 7 天：写入前与载入时都做裁剪（丢弃 ts 超期消息与空会话）；
 *   · 写入走 800ms 防抖（连续收发不抖爆 IDB）；载入完成前不落盘（防「空状态覆盖旧数据」）。
 */
import type { DeviceSession, TransferMessage } from '@/lib/transfer/types';

/** 消息保留时长：7 天 */
export const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DB_NAME = 'znhd-transfer';
const DB_VERSION = 1;
const STORE = 'sessions';

/** 持久化用的消息形态：去掉运行时字段（previewUrl） */
type StoredMessage = Omit<TransferMessage, 'previewUrl'> & { previewUrl?: undefined };

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
}

/** 裁剪超期消息；返回新数组（不修改入参）。空会话直接丢弃。 */
export function pruneSessions(sessions: DeviceSession[], now = Date.now()): DeviceSession[] {
    const minTs = now - TRANSFER_TTL_MS;
    const out: DeviceSession[] = [];
    sessions.forEach((s) => {
        const messages = s.messages.filter((m) => (m.ts || 0) >= minTs);
        if (messages.length) out.push({ ...s, messages, lastTs: messages[messages.length - 1].ts || s.lastTs });
    });
    return out;
}

/** 载入持久化的会话：裁剪超期 + 重建图片预览 URL + 中断的「发送中」标记为失败 */
export async function loadPersistedSessions(): Promise<DeviceSession[]> {
    let rows: Array<{ key: string; messages: StoredMessage[]; unread?: number; lastTs?: number }> = [];
    try {
        const db = await openDb();
        rows = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).getAll();
            req.onsuccess = () => resolve((req.result || []) as typeof rows);
            req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
        });
        db.close();
    } catch (e) {
        return []; // 存储不可用：按无历史处理（内存态照常工作）
    }
    const sessions: DeviceSession[] = rows.map((r) => ({
        key: r.key,
        unread: 0, // 重启后未读清零（未读是「本次会话期」的概念）
        lastTs: r.lastTs || 0,
        messages: (r.messages || []).map((m) => {
            const msg: TransferMessage = { ...m } as TransferMessage;
            // 上次退出时还卡在「发送中」的图片：真实状态已不可考，标记为失败让用户可辨
            if (msg.sendState === 'sending') {
                msg.sendState = 'failed';
                msg.sendError = '上次会话中断，发送状态未知';
            }
            if (msg.blob) {
                try {
                    msg.previewUrl = URL.createObjectURL(msg.blob);
                } catch (e) {
                    /* 忽略：预览建不出来就只少一张缩略图 */
                }
            }
            return msg;
        }),
    }));
    return pruneSessions(sessions);
}

/** 把会话整体写入 IndexedDB（覆盖写；失败静默 —— 持久化是锦上添花，不能拖垮主链路） */
async function writeSessions(sessions: DeviceSession[]): Promise<void> {
    try {
        const db = await openDb();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            store.clear();
            sessions.forEach((s) => {
                const messages: StoredMessage[] = s.messages.map((m) => {
                    const { previewUrl: _drop, ...rest } = m;
                    return rest as StoredMessage;
                });
                store.put({ key: s.key, messages, unread: s.unread, lastTs: s.lastTs });
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
        });
        db.close();
    } catch (e) {
        /* 静默 */
    }
}

let persistTimer: number | null = null;

/**
 * 防抖落盘（800ms）：连续收发只写最后一次。
 * ⚠️ 调用方须在「载入完成」之后才允许调（store 里的 persistReady 守着），
 * 否则启动初期的空状态会把旧数据覆盖掉。
 */
export function schedulePersist(sessions: DeviceSession[]): void {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
        persistTimer = null;
        void writeSessions(pruneSessions(sessions));
    }, 800) as unknown as number;
}
