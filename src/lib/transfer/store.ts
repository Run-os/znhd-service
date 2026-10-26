/**
 * 传输助手的运行时存储（v26.10.12-v1，替代原 MainPanel 里的接收循环 / 手机轮询）。
 *
 * ── 为什么是模块级 store 而不是组件 state ──────────────────────────────
 * 传输助手窗口是「按需打开」的弹窗（关闭即卸载），而收件 / 在线状态必须在
 * **窗口不开的时候也照常工作**（手机发图到电脑，电脑端要自动弹窗）。
 * 因此数据放模块级，UI 通过订阅函数取快照；图片是 Blob + objectURL，
 * v26.10.12-v5 起通过 IndexedDB 持久化（见 `persist.ts`，含 7 天 TTL 自动清理），
 * 载入时机在 `initTransfer`；存储不可用时静默退回纯内存态。
 *
 * ── 会话归组规则（重要）────────────────────────────────────────────────
 * v26.10.13-v6 起，中继的正向通道（手机 → 电脑）**随条目回传发送者手机 ID**
 * （手机页上传时带 `phoneId`，服务端写进 `from`），因此收到的内容**按发送者归组**：
 *   · 载荷带 `from` → 归那台手机的会话（多台在线也各归各的，这是常态路径）；
 *   · 不带 `from`（老中继 / 老手机页 / 发送测试图）→ 旧规则兜底：
 *     只有 1 台在线归那台手机的会话，0 或多台在线归聚合会话 `__phone__`。
 * 发送方向知道目标（用户在哪个会话里发、发给哪台），所以发件记录总是进对应会话。
 */
import { addLog } from '@/lib/logger';
import {
    RELAY_MAX_BODY,
    compressImageForPhone,
    getDeviceId,
    imagePayloadBytes,
    sendToPhone,
    startPhoneReceive,
} from '@/lib/relay';
import { runtime } from '@/lib/state';
import { TRANSFER_TTL_MS, loadPersistedSessions, schedulePersist } from '@/lib/transfer/persist';
import { loadTransferSettings, normalizeTransferSettings, saveTransferSettings } from '@/lib/transfer/settings';
import type { DeviceSession, PhoneInfo, TransferMessage, TransferSettings } from '@/lib/transfer/types';

/** 聚合会话键：无法识别发送者时收到的内容（老中继多台在线 / 老手机页）都归到这里 */
export const PHONE_SESSION_KEY = '__phone__';

/** 聚合会话的显示名（老版中继的未知设备也算它） */
export const PHONE_SESSION_LABEL = '手机';

/** 手机 ID → 会话键：空 ID（老版中继只回 online）并入聚合会话 */
export function sessionKeyOf(phoneId: string): string {
    return phoneId || PHONE_SESSION_KEY;
}

/**
 * 传输助手的只读状态快照（v26.10.18-v5：UI 框架无关）。
 *
 * ⚠️ 每次变更都替换整个对象（`state = { ...state, ... }`），所以订阅方可以按
 * **引用比较**判断是否重渲染 —— React 的 `useSyncExternalStore` 与 Vue 的
 * `shallowRef` 都依赖这一点，别改成原地改字段。
 */
export interface TransferState {
    settings: TransferSettings;
    /**
     * 在线手机列表。来源（v26.10.14-v7 起）：
     *  ① 正向长轮询每个响应捎带的 `phones`（常态，≤25s 一次且随消息即时）；
     *  ② 手机上线 / 下线时服务器主动唤醒的那一条 `{type:'phones'}`（亚秒级）；
     *  ③ 窗口打开时 + 60s 兜底 tick 的按需 `/phone/status` 查询（老中继兜底）。
     * ⚠️ 不再是 5s 定时轮询 —— 那是 8h 里 5760 次请求、占了近一半的最大头。
     */
    phones: PhoneInfo[];
    /** 有消息的会话（按最后消息时间倒序；UI 再与在线手机并集） */
    sessions: DeviceSession[];
    /** 当前选中的会话键（'' = 未选中） */
    activeSessionKey: string;
    /** 传输助手窗口是否打开（决定未读累计与自动弹窗） */
    windowOpen: boolean;
}

let state: TransferState = {
    settings: loadTransferSettings(runtime.init.relayServer),
    phones: [],
    sessions: [],
    activeSessionKey: '',
    windowOpen: false,
};

const listeners = new Set<() => void>();
const autoOpenListeners = new Set<(sessionKey: string) => void>();

/**
 * 持久化闸门：`initTransfer` 里从 IndexedDB 载入完成之前**不落盘** ——
 * 否则启动初期的空状态会先把旧数据覆盖掉（写入是整体覆盖）。
 */
let persistReady = false;

/** 消息/会话发生变更后调用：闸门开着才防抖落盘 */
function persistSoon(): void {
    if (persistReady) schedulePersist(state.sessions);
}

function emit(): void {
    listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

/**
 * 订阅入口（框架无关，v26.10.18-v5）：
 *   · React 侧包装（useTransferStore / reactStore.ts）已随 React+antd 迁移删除（v26.10.18-v7）；
 *   · Vue 侧包装见 `@vue/composables/useTransferStore`。
 * 之所以把 `useSyncExternalStore` 从本文件挪走：Vue 版产物会把 store 打进去，
 * 一旦本文件 import react，Vue 侧就必须把 react 一起打包（约 140KB，且违背迁移约束）。
 */
export function subscribeTransfer(cb: () => void): () => void {
    return subscribe(cb);
}

/** 当前状态快照（与 `subscribeTransfer` 配套；引用在每次变更后必然变化） */
export function getTransferSnapshot(): TransferState {
    return state;
}

/* ============================================================ 设置 */

/** 改设置（持久化；中继地址变化时重启轮询与接收循环） */
export function updateTransferSettings(patch: Partial<TransferSettings>): void {
    const prev = state.settings;
    const next = normalizeTransferSettings({ ...prev, ...patch });
    if (
        next.relayServer === prev.relayServer &&
        next.theme === prev.theme &&
        next.autoOpenOnReceive === prev.autoOpenOnReceive
    ) {
        return;
    }
    saveTransferSettings(next);
    state = { ...state, settings: next };
    emit();
    if (next.relayServer !== prev.relayServer) restartLoops();
}

/* ============================================================ 生命周期 */

let phoneFallbackTimer: number | null = null;
/**
 * 最近一次从**长轮询**拿到在线名单的时刻（v26.10.14-v7）。
 * 兜底轮询据此判断「名单是不是已经由推送渠道送达」—— 送达过就跳过这一轮，一个请求都不打。
 */
let phonesSeenAt = 0;
let receiveStop: (() => void) | null = null;
let knownPhones = new Set<string>();
let inited = false;

function validServer(): string {
    const s = (state.settings.relayServer || '').trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(s) ? s : '';
}

/** 启停接收循环 + 在线名单兜底轮询（幂等：先停后启） */
function restartLoops(): void {
    stopLoops();
    const server = validServer();
    if (!server) {
        state = { ...state, phones: [] };
        knownPhones = new Set();
        emit();
        return;
    }
    startPhonesWatch();
    startReceive(server);
}

function stopLoops(): void {
    if (phoneFallbackTimer) {
        clearInterval(phoneFallbackTimer);
        phoneFallbackTimer = null;
    }
    if (receiveStop) {
        receiveStop();
        receiveStop = null;
    }
}

/** 两份名单是否等价（只比 id 集合与顺序；lastSeen 每次都变，比它等于永远「不等」） */
function samePhones(a: PhoneInfo[], b: PhoneInfo[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].id !== b[i].id) return false;
    }
    return true;
}

/**
 * 应用一份在线手机名单 —— 三个来源共用：长轮询 piggyback、上下线唤醒、按需查询。
 * 连接 / 断开写运行日志（与重构前一致，且不依赖窗口是否打开）；
 * 名单没变就**不 emit**（长轮询每 ≤25s 捎带一次，无谓重建 state 会让整个窗口跟着重渲染）。
 */
function applyPhones(list: PhoneInfo[]): void {
    const nowIds = new Set(list.map((p) => p.id).filter(Boolean));
    knownPhones.forEach((id) => {
        if (!nowIds.has(id)) addLog('[传输助手] 手机已断开：' + id, 'warning');
    });
    nowIds.forEach((id) => {
        if (!knownPhones.has(id)) addLog('[传输助手] 手机已连接：' + id, 'success');
    });
    knownPhones = nowIds;
    if (samePhones(state.phones, list)) return;
    state = { ...state, phones: list };
    emit();
    // v26.10.19-v8：有设备上线就补发离线排队的文本（无排队时零开销）
    if (list.length) flushQueuedTexts();
}

/** 正在飞的按需查询（避免窗口连续开合时并发打同一接口） */
let phoneRefreshInFlight = false;

/**
 * 按需查询一次在线状态（v26.10.14-v7，替代原来 5s 一次的定时轮询）。
 * 调用点：① 传输助手窗口打开时；② 60s 兜底 tick 发现长轮询长时间没捎带名单时。
 * 接口 `/phone/status` 的形态与语义完全没变（老中继也能应答）。
 */
export function refreshPhones(): void {
    const server = validServer();
    if (!server || phoneRefreshInFlight) return;
    phoneRefreshInFlight = true;
    try {
        GM_xmlhttpRequest({
            method: 'GET',
            url: server + '/phone/status/' + encodeURIComponent(getDeviceId()),
            timeout: 8000,
            onload: (r) => {
                phoneRefreshInFlight = false;
                let j: { online?: boolean; phones?: { id?: string; lastSeen?: number }[] } | null = null;
                try {
                    j = JSON.parse(r.responseText);
                } catch (e) {
                    j = null;
                }
                // 老版中继只回 {online:true} 没有 phones 时按「1 台未知手机」处理
                const list: PhoneInfo[] =
                    j && Array.isArray(j.phones)
                        ? j.phones.map((p) => ({ id: String(p.id || ''), lastSeen: Number(p.lastSeen) || 0 }))
                        : j && j.online
                        ? [{ id: '', lastSeen: 0 }]
                        : [];
                applyPhones(list);
            },
            onerror: () => {
                phoneRefreshInFlight = false;
                if (state.phones.length) {
                    state = { ...state, phones: [] };
                    emit();
                }
            },
        });
    } catch (e) {
        phoneRefreshInFlight = false;
    }
}

/**
 * 在线名单兜底轮询（v26.10.14-v7）。
 *
 * 正常路径：名单由正向长轮询 piggyback（每个响应都带）+ 上下线唤醒实时送达，
 * 此时本定时器每一轮都会「看到长轮询刚捎带过」而**直接跳过，零请求**。
 *
 * 它存在的唯一理由是**兼容尚未升级的中继**：老中继不返回 `phones` 字段，
 * 若没有这条兜底，`state.phones` 会永远是空 —— 发送按钮恒不可用、无 `from` 的条目
 * 永远归聚合会话。60s 粒度足够兜住（浏览器开启时仍会立刻查一次）。
 */
function startPhonesWatch(): void {
    const tick = () => {
        if (!validServer()) return;
        if (Date.now() - phonesSeenAt < 55000) return; // 推送渠道在送名单，无需兜底
        refreshPhones();
    };
    tick(); // 启动时先查一次（拿到名单再进入「推送为主」的稳态）
    phoneFallbackTimer = setInterval(tick, 60000) as unknown as number;
}

/** 接收循环（长轮询 /recv）：收到图片 / 文本进对应会话，并按设置自动弹窗 */
function startReceive(server: string): void {
    receiveStop = startPhoneReceive({
        server,
        uuid: getDeviceId(),
        onConnected: () => addLog('[传输助手] 已自动开始接收（' + server + '）', 'info'),
        // v26.10.14-v7（P0-b/P0-c）：在线名单改由长轮询**捎带/唤醒**送达（原来靠 5s 轮询）。
        // 记下送达时刻，60s 兜底轮询据此判断「推送渠道是否在正常工作」。
        onPhones: (list) => {
            phonesSeenAt = Date.now();
            applyPhones(list);
        },
        onImage: (img) => {
            addLog('[传输助手] 收到图片：' + (img.name || 'image') + '（' + (img.mime || 'image') + '）', 'success');
            const key = sessionKeyForIncoming(img.from);
            addMessage(key, {
                id: nextId(),
                type: 'image',
                direction: 'in',
                sessionKey: key,
                name: img.name,
                mime: img.mime,
                blob: img.blob,
                previewUrl: img.previewUrl,
                ts: Date.now(),
            });
        },
        onText: (txt) => {
            const t = (txt.text || '').replace(/\s+$/, '');
            addLog('[传输助手] 收到文本：' + (t.length > 40 ? t.slice(0, 40) + '…' : t), 'success');
            const key = sessionKeyForIncoming(txt.from);
            addMessage(key, {
                id: nextId(),
                type: 'text',
                direction: 'in',
                sessionKey: key,
                text: t,
                ts: txt.ts || Date.now(),
            });
        },
        // v26.10.14-v6：任意文件（中继按 mime 分流，非 image/* 的都走这里）。
        // 与图片走同一条「会话落消息」路径，只是 type 用 'file'（渲染成文件卡片而非缩略图）。
        onFile: (f) => {
            addLog(
                '[传输助手] 收到文件：' + (f.name || 'file') + '（' + (f.mime || 'application/octet-stream') + '）',
                'success'
            );
            const key = sessionKeyForIncoming(f.from);
            addMessage(key, {
                id: nextId(),
                type: 'file',
                direction: 'in',
                sessionKey: key,
                name: f.name,
                mime: f.mime,
                blob: f.blob,
                previewUrl: f.previewUrl,
                ts: Date.now(),
            });
        },
    });
}

/**
 * 收到内容时归到哪个会话（v26.10.13-v6 起按发送者归组）：
 *  · 载荷带发送者手机 ID（新中继 + 新手机页）→ 归那台手机的会话，多台在线也各归各的；
 *  · 不带（老中继 / 发送测试图）→ 旧规则：只有 1 台在线归那台，否则聚合会话。
 */
function sessionKeyForIncoming(from?: string): string {
    const sender = (from || '').trim();
    if (sender) return sessionKeyOf(sender);
    const online = state.phones.filter((p) => p.id);
    if (online.length === 1) return sessionKeyOf(online[0].id);
    return PHONE_SESSION_KEY;
}

function nextId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

/* ============================================================ 消息变更 */

/** 新增一条消息（收或发）；未读累计 + 自动弹窗都在这里 */
function addMessage(sessionKey: string, msg: TransferMessage): void {
    const sessions = state.sessions.slice();
    const at = sessions.findIndex((s) => s.key === sessionKey);
    const prev: DeviceSession = at >= 0 ? sessions[at] : { key: sessionKey, messages: [], unread: 0, lastTs: 0 };
    // 只有「窗口开着且正停在这个会话」才算已读；其余情况（窗关着 / 停在别的会话）累计未读
    const isViewing = state.windowOpen && state.activeSessionKey === sessionKey;
    const next: DeviceSession = {
        ...prev,
        messages: prev.messages.concat(msg),
        lastTs: msg.ts || Date.now(),
        unread: isViewing ? prev.unread : prev.unread + 1,
    };
    if (at >= 0) sessions[at] = next;
    else sessions.push(next);
    sessions.sort((a, b) => b.lastTs - a.lastTs);

    // 窗关着：把选中切到新消息所在会话（窗口打开后即停在它上面）；窗开着：选中不动
    const nextActive = state.windowOpen ? state.activeSessionKey : sessionKey;
    state = { ...state, sessions, activeSessionKey: nextActive };
    emit();
    persistSoon();

    // 自动打开：仅在**窗口关着**时（企业微信逻辑：窗口开着就只累计未读，不强行切会话）
    if (!state.windowOpen && state.settings.autoOpenOnReceive) {
        autoOpenListeners.forEach((cb) => cb(sessionKey));
    }
}

/** 更新一条消息（发送中 → 成功 / 失败） */
function patchMessage(sessionKey: string, msgId: string, patch: Partial<TransferMessage>): void {
    const sessions = state.sessions.slice();
    const at = sessions.findIndex((s) => s.key === sessionKey);
    if (at < 0) return;
    const session = sessions[at];
    const messages = session.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m));
    sessions[at] = { ...session, messages };
    state = { ...state, sessions };
    emit();
    persistSoon();
}

/** 移除一条消息（revoke 预览 URL，防内存泄漏） */
export function removeTransferMessage(sessionKey: string, msgId: string): void {
    const sessions = state.sessions.slice();
    const at = sessions.findIndex((s) => s.key === sessionKey);
    if (at < 0) return;
    const session = sessions[at];
    const removed = session.messages.find((m) => m.id === msgId);
    if (removed) revokeUrl(removed.previewUrl);
    sessions[at] = { ...session, messages: session.messages.filter((m) => m.id !== msgId) };
    state = { ...state, sessions };
    emit();
    persistSoon();
}

/** 清空一个会话的消息（清完后会话若无消息且设备离线，就会从列表消失） */
export function clearTransferSession(sessionKey: string): void {
    const sessions = state.sessions
        .map((s) => {
            if (s.key !== sessionKey) return s;
            s.messages.forEach((m) => revokeUrl(m.previewUrl));
            return { ...s, messages: [], unread: 0, lastTs: 0 };
        })
        .filter((s) => s.messages.length > 0);
    state = { ...state, sessions };
    emit();
    persistSoon();
}

/** 清空全部文件（所有会话的图片一起清） */
export function clearAllTransferFiles(): void {
    state.sessions.forEach((s) => s.messages.forEach((m) => revokeUrl(m.previewUrl)));
    state = { ...state, sessions: [] };
    emit();
    persistSoon();
}

function revokeUrl(url?: string): void {
    if (!url) return;
    try {
        URL.revokeObjectURL(url);
    } catch (e) {
        /* 忽略 */
    }
}

/* ============================================================ 选中 / 窗口状态 */

/** 选中会话（切会话时由 UI 调用） */
export function setActiveSession(sessionKey: string): void {
    if (state.activeSessionKey === sessionKey) return;
    state = { ...state, activeSessionKey: sessionKey };
    emit();
}

/** 窗口开 / 关（UI 调用；关窗不清空选中，重开时停回原会话） */
export function setTransferWindowOpen(open: boolean): void {
    if (state.windowOpen === open) return;
    state = { ...state, windowOpen: open };
    emit();
    // 用户正要看名单 → 现查一次（v26.10.14-v7 的「按需查询」，替代原 5s 定时轮询）。
    // 只在实际发生「关 → 开」跳变时打，一次开窗 1 个请求。
    if (open) refreshPhones();
}

/** 已读：窗口开着且正停在该会话上时清零未读 */
export function markSessionRead(sessionKey: string): void {
    const at = state.sessions.findIndex((s) => s.key === sessionKey);
    if (at < 0 || state.sessions[at].unread === 0) return;
    const sessions = state.sessions.slice();
    sessions[at] = { ...sessions[at], unread: 0 };
    state = { ...state, sessions };
    emit();
}

/**
 * 注册「收到新内容且需要自动打开窗口」的回调（主面板用来把传输助手带到眼前）。
 * @returns 取消注册的函数
 */
export function onTransferAutoOpen(cb: (sessionKey: string) => void): () => void {
    autoOpenListeners.add(cb);
    return () => {
        autoOpenListeners.delete(cb);
    };
}

/* ============================================================ 发送（电脑 → 手机） */

/** 某会话的对方是否可发送（聚合会话 = 有任一手机在线；具体会话 = 那台在线） */
export function sessionSendable(sessionKey: string): boolean {
    if (sessionKey === PHONE_SESSION_KEY) return state.phones.length > 0;
    return state.phones.some((p) => sessionKeyOf(p.id) === sessionKey);
}

/**
 * 把**卡死的「发送中」**判为失败（v26.10.26-v10）。
 *
 * 为什么需要：`sendState === 'sending'` 只在 onOk / onFail 里被清掉。一旦宿主丢了回调
 * （GM_xmlhttpRequest 的 ontimeout 在个别管理器上不触发、压缩 Promise 挂在解码里、
 * 页面切走导致回调丢失），这条消息会**永远**停在 sending。它带来两个可见故障：
 *   ① 气泡永远转圈、进度条不动；
 *   ② `ChatWindow` 的 `sending` 恒为 true ⇒ 输入舱 + 菜单里的「图片 / 文件」被永久禁用，
 *      使用者点任何一项都没反应（v26.10.26-v10 使用者反馈「选择窗口无法点击」的根因之一）。
 *
 * 判据用「开始时间 + 阈值」而不是「有没有进度」：单次请求的超时上限约 100s（见 relay.ts
 * 的 timeout = 20s + 每 200B 1ms），3 分钟还挂着必然是死状态。
 *
 * @returns 被修正的条数（0 = 没有卡死的）
 */
export function healStaleSending(maxAgeMs = 3 * 60 * 1000): number {
    const now = Date.now();
    let fixed = 0;
    const sessions = state.sessions.map((s) => {
        let changed = false;
        const messages = s.messages.map((m) => {
            if (m.sendState !== 'sending') return m;
            if (now - (m.ts || 0) <= maxAgeMs) return m;
            changed = true;
            fixed++;
            return { ...m, sendState: 'failed' as const, sendError: '发送超时（未收到响应）', sendProgress: undefined };
        });
        return changed ? { ...s, messages } : s;
    });
    if (fixed) {
        state = { ...state, sessions };
        emit();
        persistSoon();
    }
    return fixed;
}

/** 发送目标：具体手机 → 定向；聚合 / 未知设备 → 广播 */
function sendTargets(sessionKey: string): 'all' | string[] {
    if (sessionKey === PHONE_SESSION_KEY) return 'all';
    return [sessionKey];
}

/** 发送文本到某会话；返回是否接受了这次发送（离线时也接受——进队列等设备上线补发） */
export function sendTextToSession(sessionKey: string, text: string): boolean {
    const t = (text || '').trim();
    const server = validServer();
    if (!t) {
        addLog('[传输助手] 文本为空', 'error', true);
        return false;
    }
    if (!server) {
        addLog('[传输助手] 尚未配置中继服务器，无法发送', 'error', true);
        return false;
    }
    const msg: TransferMessage = {
        id: nextId(),
        type: 'text',
        direction: 'out',
        sessionKey,
        text: t,
        ts: Date.now(),
    };
    if (!sessionSendable(sessionKey)) {
        // v26.10.19-v8：离线不再拒绝——落成「排队」气泡，等设备上线后 flushQueuedTexts 自动补发
        msg.sendState = 'queued';
        addMessage(sessionKey, msg);
        addLog('[传输助手] 当前无在线设备，消息已排队等设备上线', 'warning');
        return true;
    }
    addMessage(sessionKey, msg);
    deliverText(sessionKey, msg.id, t, server);
    return true;
}

/** 真正把一条文本投递给中继（成功清状态 / 失败标 failed）。排队补发走同一条路。 */
function deliverText(sessionKey: string, msgId: string, t: string, server: string): void {
    sendToPhone({
        server,
        uuid: getDeviceId(),
        payload: { text: t, targets: sendTargets(sessionKey) },
        onOk: () => addLog('[传输助手] 文本已发送', 'success'),
        onFail: (e) => {
            patchMessage(sessionKey, msgId, { sendState: 'failed', sendError: e });
            addLog('[传输助手] 发送失败：' + e, 'error');
        },
    });
}

/**
 * 补发所有「离线排队」的文本（v26.10.19-v8）。
 * 单一事实来源 = 会话里 sendState==='queued' 的消息（不另设内存队列 ⇒ 页面刷新后照样能补发，
 * 排队消息随会话一起持久化）。挂载点：applyPhones 发现设备从无到有时。
 */
function flushQueuedTexts(): void {
    const server = validServer();
    if (!server) return;
    state.sessions.forEach((s) => {
        s.messages.forEach((m) => {
            if (m.type === 'text' && m.direction === 'out' && m.sendState === 'queued') {
                patchMessage(s.key, m.id, { sendState: undefined, sendError: undefined });
                deliverText(s.key, m.id, m.text || '', server);
            }
        });
    });
}

/**
 * 发送图片到某会话：逐张顺序发送（一张成功再发下一张，保证到达顺序）。
 * 图片先经 `compressImageForPhone` 压缩（与「手机 → 电脑」同套规格：最长边 1600、JPEG 0.75；
 * SVG/GIF、解码失败、压不小都回退原图），超 100MB 上限即停止。
 *
 * @returns 是否开始了发送（调用方用于清空待发列表 / 显示进度）
 */
export function sendImagesToSession(
    sessionKey: string,
    files: { file: File; name: string; mime: string; url: string }[],
    onProgress?: (done: number, total: number, failed: boolean, text: string) => void
): boolean {
    const server = validServer();
    if (!files.length) return false;
    if (!server) {
        addLog('[传输助手] 尚未配置中继服务器，无法发送', 'error', true);
        return false;
    }
    if (!sessionSendable(sessionKey)) {
        addLog('[传输助手] 当前无在线设备，无法发送', 'error', true);
        return false;
    }
    const targets = sendTargets(sessionKey);
    const list = files.slice();
    const total = list.length;
    let sent = 0;

    const failAt = (reason: string, msgId?: string) => {
        if (msgId) patchMessage(sessionKey, msgId, { sendState: 'failed', sendError: reason, sendProgress: undefined });
        addLog(
            '[传输助手] 第 ' + (sent + 1) + ' 张发送失败：' + reason + '（已发 ' + sent + '/' + total + '）',
            'error'
        );
        onProgress?.(sent, total, true, '已发送 ' + sent + '/' + total + '，已停止');
    };

    // v26.10.18-v1：**先把所有待发图片落成「发送中」气泡**（预览用待发对象自带的 objectURL，
    // 压缩前后显示的是同一张图），用户选完立刻能在会话里看到传的是什么；
    // 压缩完成后再把气泡的 blob/name/mime 替换成压缩产物。
    const msgIds = list.map(() => nextId());
    list.forEach((it, i) => {
        addMessage(sessionKey, {
            id: msgIds[i],
            type: 'image',
            direction: 'out',
            sessionKey,
            name: it.name,
            mime: it.mime,
            blob: it.file,
            previewUrl: it.url,
            ts: Date.now(),
            sendState: 'sending',
        });
    });

    const sendNext = () => {
        if (sent >= total) {
            addLog('[传输助手] ' + total + ' 张图片已全部发送', 'success');
            onProgress?.(total, total, false, '已发送 ' + total + '/' + total);
            return;
        }
        const it = list[sent];
        const msgId = msgIds[sent];
        addLog('[传输助手] 正在处理（' + (sent + 1) + '/' + total + '）：' + (it.name || 'image'), 'info');
        onProgress?.(sent, total, false, '处理中… ' + sent + '/' + total + '（第 ' + (sent + 1) + ' 张）');
        compressImageForPhone(it.file)
            .then((out: { blob: Blob; name: string; mime: string; compressed?: boolean }) => {
                if (imagePayloadBytes(out.blob, out.name, out.mime) > RELAY_MAX_BODY) {
                    addLog(
                        '[传输助手] 第 ' +
                            (sent + 1) +
                            ' 张压缩后仍超限（单张约 100MB 上限），已停止（已发 ' +
                            sent +
                            '/' +
                            total +
                            '）',
                        'error',
                        true
                    );
                    failAt('压缩后仍超过单张上限（约 100MB）', msgId);
                    return;
                }
                addLog(
                    '[传输助手] ' +
                        (out.compressed
                            ? '已压缩 ' + it.name + '：' + kbText(it.file.size) + ' → ' + kbText(out.blob.size)
                            : '原图发送 ' + out.name + '（' + kbText(out.blob.size) + '）') +
                        '，正在发送（' +
                        (sent + 1) +
                        '/' +
                        total +
                        '）',
                    'info'
                );
                // 压缩产物回填进第一步已落好的气泡（blob/文件名/MIME 以压缩结果为准）
                patchMessage(sessionKey, msgId, { blob: out.blob, name: out.name, mime: out.mime });
                const rd = new FileReader();
                rd.onload = () => {
                    const b64 = ((rd.result as string) || '').split(',')[1] || '';
                    if (!b64) {
                        failAt('读取图片失败', msgId);
                        return;
                    }
                    let lastPct = -1; // 同值不重发：progress 事件比百分比密，避免无谓重渲染
                    sendToPhone({
                        server,
                        uuid: getDeviceId(),
                        payload: { name: out.name, mime: out.mime, data: b64, targets },
                        // v26.10.18-v1：上传进度逐事件写回气泡
                        onUploadProgress: (pct) => {
                            if (pct !== lastPct) {
                                lastPct = pct;
                                patchMessage(sessionKey, msgId, { sendProgress: pct });
                            }
                        },
                        onOk: () => {
                            sent++;
                            patchMessage(sessionKey, msgId, {
                                sendState: undefined,
                                sendError: undefined,
                                sendProgress: undefined,
                            });
                            onProgress?.(sent, total, false, '已发送 ' + sent + '/' + total);
                            sendNext();
                        },
                        onFail: (e) => failAt(e, msgId),
                    });
                };
                rd.onerror = () => failAt('读取图片失败', msgId);
                rd.readAsDataURL(out.blob);
            })
            .catch((e: { message?: string }) => failAt((e && e.message) || '图片处理失败', msgIds[sent]));
    };

    sendNext();
    return true;
}

/** 体积显示：统一按 KB（不足 1KB 也显示 1KB） */
function kbText(bytes: number): string {
    return Math.max(1, Math.round((Number(bytes) || 0) / 1024)) + 'KB';
}

/**
 * 发送任意文件到某会话（v26.10.14-v6 新增）。
 *
 * 与 `sendImagesToSession` 的两点关键差异：
 *  ① **不做压缩** —— 文件不是图片，画布解码无意义（PDF/zip/视频解码必然失败）。原样直传。
 *  ② **按体积预检** —— 用 `imagePayloadBytes`（同一套 base64 膨胀估算，对任意二进制同样成立）
 *     与 `RELAY_MAX_BODY` 比对，超限即停止，避免 base64 膨胀后撞中继 413。
 *
 * 逐条顺序发送（一条成功再发下一条，保证到达顺序），与图片一致。
 *
 * @returns 是否开始了发送（调用方用于清空待发列表 / 显示进度）
 */
export function sendFilesToSession(
    sessionKey: string,
    files: { file: File; name: string; mime: string; url: string }[],
    onProgress?: (done: number, total: number, failed: boolean, text: string) => void
): boolean {
    const server = validServer();
    if (!files.length) return false;
    if (!server) {
        addLog('[传输助手] 尚未配置中继服务器，无法发送', 'error', true);
        return false;
    }
    if (!sessionSendable(sessionKey)) {
        addLog('[传输助手] 当前无在线设备，无法发送', 'error', true);
        return false;
    }
    const targets = sendTargets(sessionKey);
    const list = files.slice();
    const total = list.length;
    let sent = 0;

    const failAt = (reason: string, msgId?: string) => {
        if (msgId) patchMessage(sessionKey, msgId, { sendState: 'failed', sendError: reason, sendProgress: undefined });
        addLog(
            '[传输助手] 第 ' + (sent + 1) + ' 个文件发送失败：' + reason + '（已发 ' + sent + '/' + total + '）',
            'error'
        );
        onProgress?.(sent, total, true, '已发送 ' + sent + '/' + total + '，已停止');
    };

    // v26.10.18-v1：与图片一致 —— 先把所有待发文件落成「发送中」气泡再逐个发送
    const msgIds = list.map(() => nextId());
    list.forEach((it, i) => {
        addMessage(sessionKey, {
            id: msgIds[i],
            type: 'file',
            direction: 'out',
            sessionKey,
            name: it.name,
            mime: it.mime,
            blob: it.file,
            previewUrl: it.url,
            ts: Date.now(),
            sendState: 'sending',
        });
    });

    const sendNext = () => {
        if (sent >= total) {
            addLog('[传输助手] ' + total + ' 个文件已全部发送', 'success');
            onProgress?.(total, total, false, '已发送 ' + total + '/' + total);
            return;
        }
        const it = list[sent];
        const msgId = msgIds[sent];
        // 体积预检：base64 膨胀 ≈4/3，超限就停（与图片同判据、同上限）
        const est = imagePayloadBytes(it.file, it.name, it.mime);
        if (est > RELAY_MAX_BODY) {
            addLog(
                '[传输助手] 第 ' +
                    (sent + 1) +
                    ' 个文件过大（' +
                    kbText(it.file.size) +
                    '，编码后约 ' +
                    kbText(est) +
                    '，超过单次上限约 100MB），已停止（已发 ' +
                    sent +
                    '/' +
                    total +
                    '）',
                'error',
                true
            );
            failAt('文件过大（编码后约 ' + kbText(est) + '，超过单次上限约 100MB）', msgId);
            return;
        }
        addLog(
            '[传输助手] 正在发送文件（' +
                (sent + 1) +
                '/' +
                total +
                '）：' +
                it.name +
                '（' +
                kbText(it.file.size) +
                '）',
            'info'
        );
        onProgress?.(sent, total, false, '发送中… ' + sent + '/' + total + '（第 ' + (sent + 1) + ' 个）');
        const rd = new FileReader();
        rd.onload = () => {
            const b64 = ((rd.result as string) || '').split(',')[1] || '';
            if (!b64) {
                failAt('读取文件失败', msgId);
                return;
            }
            let lastPct = -1; // 同值不重发：progress 事件比百分比密，避免无谓重渲染
            sendToPhone({
                server,
                uuid: getDeviceId(),
                payload: { name: it.name, mime: it.mime, data: b64, targets },
                // v26.10.18-v1：上传进度逐事件写回气泡
                onUploadProgress: (pct) => {
                    if (pct !== lastPct) {
                        lastPct = pct;
                        patchMessage(sessionKey, msgId, { sendProgress: pct });
                    }
                },
                onOk: () => {
                    sent++;
                    patchMessage(sessionKey, msgId, {
                        sendState: undefined,
                        sendError: undefined,
                        sendProgress: undefined,
                    });
                    onProgress?.(sent, total, false, '已发送 ' + sent + '/' + total);
                    sendNext();
                },
                onFail: (e) => failAt(e, msgId),
            });
        };
        rd.onerror = () => failAt('读取文件失败', msgId);
        rd.readAsDataURL(it.file);
    };

    sendNext();
    return true;
}

/* ============================================================ 启动 / 停止 */

/** 每小时跑一次超期裁剪（长开的税务页一挂一整天，TTL 不能只在启动时执行一次） */
let pruneTimer: number | null = null;

function pruneExpiredNow(): void {
    const minTs = Date.now() - TRANSFER_TTL_MS;
    let changed = false;
    const next: DeviceSession[] = [];
    state.sessions.forEach((s) => {
        const kept = s.messages.filter((m) => (m.ts || 0) >= minTs);
        if (kept.length !== s.messages.length) {
            // 被裁掉的消息顺手回收内存里的预览 URL（防长开页面泄漏 objectURL）
            s.messages.forEach((m) => {
                if ((m.ts || 0) < minTs) revokeUrl(m.previewUrl);
            });
            changed = true;
        }
        if (kept.length) next.push({ ...s, messages: kept, lastTs: kept[kept.length - 1].ts || s.lastTs });
    });
    if (changed) {
        state = {
            ...state,
            sessions: next,
            activeSessionKey: next.some((s) => s.key === state.activeSessionKey) ? state.activeSessionKey : '',
        };
        emit();
        persistSoon();
    }
}

/**
 * 启动传输助手后台能力（幂等：主面板挂载 / 面板自愈重挂时调用）。
 * 中继地址没填好时只加载设置，不起轮询与接收。
 */
export function initTransfer(): void {
    if (inited) return;
    inited = true;
    restartLoops();
    // 载入持久化会话（IndexedDB；失败静默退回内存态）。与启动初期已收到的消息合并：
    // state 里已有的会话优先（活的），只补 state 里没有的。
    void loadPersistedSessions()
        .then((loaded) => {
            if (loaded.length) {
                const merged = state.sessions.slice();
                loaded.forEach((s) => {
                    if (!merged.some((x) => x.key === s.key)) merged.push(s);
                });
                merged.sort((a, b) => b.lastTs - a.lastTs);
                state = { ...state, sessions: merged };
                emit();
            }
        })
        .catch(() => {
            /* 存储不可用：纯内存态 */
        })
        .finally(() => {
            persistReady = true;
        });
    // 超期裁剪：启动先跑一次（覆盖「跨天挂机」），之后每小时一次
    pruneExpiredNow();
    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = setInterval(pruneExpiredNow, 60 * 60 * 1000) as unknown as number;
}

/** 停止全部后台能力（页面卸载时由 beforeunload 链路调用） */
export function stopTransfer(): void {
    stopLoops();
    if (pruneTimer) {
        clearInterval(pruneTimer);
        pruneTimer = null;
    }
    knownPhones = new Set();
    phonesSeenAt = 0;
    inited = false;
}
