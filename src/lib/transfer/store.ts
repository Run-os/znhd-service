/**
 * 传输助手的运行时存储（v26.10.12-v1，替代原 MainPanel 里的接收循环 / 手机轮询）。
 *
 * ── 为什么是模块级 store 而不是组件 state ──────────────────────────────
 * 传输助手窗口是「按需打开」的弹窗（关闭即卸载），而收件 / 在线状态必须在
 * **窗口不开的时候也照常工作**（手机发图到电脑，电脑端要自动弹窗）。
 * 因此数据放模块级，UI 通过 `useSyncExternalStore` 订阅；图片是 Blob + objectURL，
 * 无法持久化，故会话历史只在内存里（与重构前 recvImages/recvTexts 的行为一致）。
 *
 * ── 会话归组规则（重要）────────────────────────────────────────────────
 * 中继的正向通道（手机 → 电脑）是**广播**、载荷里不带手机 ID，所以收到的内容
 * **无法归组到具体某一台手机**：
 *   · 只有 1 台手机在线 → 归到那台手机的会话（最常见场景，收发同会话）；
 *   · 0 或多台在线 → 归到聚合会话 `__phone__`（列表里显示为「手机」）。
 * 发送方向知道目标（用户在哪个会话里发、发给哪台），所以发件记录总是进对应会话。
 */
import { useSyncExternalStore } from 'react';
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
import { loadTransferSettings, normalizeTransferSettings, saveTransferSettings } from '@/lib/transfer/settings';
import type { DeviceSession, PhoneInfo, TransferMessage, TransferSettings } from '@/lib/transfer/types';

/** 聚合会话键：多台手机在线时收到的内容（以及老版中继的未知设备）都归到这里 */
export const PHONE_SESSION_KEY = '__phone__';

/** 聚合会话的显示名（老版中继的未知设备也算它） */
export const PHONE_SESSION_LABEL = '手机';

/** 手机 ID → 会话键：空 ID（老版中继只回 online）并入聚合会话 */
export function sessionKeyOf(phoneId: string): string {
    return phoneId || PHONE_SESSION_KEY;
}

interface TransferState {
    settings: TransferSettings;
    /** 在线手机列表（/phone/status 每 5s 刷新） */
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

function emit(): void {
    listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => {
        listeners.delete(cb);
    };
}

function getSnapshot(): TransferState {
    return state;
}

/** React 订阅入口：组件里 `const s = useTransferStore()` 拿到整份 state */
export function useTransferStore(): TransferState {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
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

let phonePollTimer: number | null = null;
let receiveStop: (() => void) | null = null;
let knownPhones = new Set<string>();
let inited = false;

function validServer(): string {
    const s = (state.settings.relayServer || '').trim().replace(/\/+$/, '');
    return /^https?:\/\//i.test(s) ? s : '';
}

/** 启停接收循环 + 手机在线轮询（幂等：先停后启） */
function restartLoops(): void {
    stopLoops();
    const server = validServer();
    if (!server) {
        state = { ...state, phones: [] };
        knownPhones = new Set();
        emit();
        return;
    }
    startPhonePoll(server);
    startReceive(server);
}

function stopLoops(): void {
    if (phonePollTimer) {
        clearInterval(phonePollTimer);
        phonePollTimer = null;
    }
    if (receiveStop) {
        receiveStop();
        receiveStop = null;
    }
}

/**
 * 手机在线状态轮询（5s）。连接 / 断开写运行日志（与重构前一致，且不依赖窗口是否打开）。
 * 老版中继只回 `{online:true}` 没有 phones 时按「1 台未知手机」处理。
 */
function startPhonePoll(server: string): void {
    const uuid = getDeviceId();
    const check = () => {
        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url: server + '/phone/status/' + encodeURIComponent(uuid),
                timeout: 8000,
                onload: (r) => {
                    let j: { online?: boolean; phones?: { id?: string; lastSeen?: number }[] } | null = null;
                    try {
                        j = JSON.parse(r.responseText);
                    } catch (e) {
                        j = null;
                    }
                    const list: PhoneInfo[] =
                        j && Array.isArray(j.phones)
                            ? j.phones.map((p) => ({ id: String(p.id || ''), lastSeen: Number(p.lastSeen) || 0 }))
                            : j && j.online
                            ? [{ id: '', lastSeen: 0 }]
                            : [];
                    state = { ...state, phones: list };
                    const nowIds = new Set(list.map((p) => p.id).filter(Boolean));
                    knownPhones.forEach((id) => {
                        if (!nowIds.has(id)) addLog('[传输助手] 手机已断开：' + id, 'warning');
                    });
                    nowIds.forEach((id) => {
                        if (!knownPhones.has(id)) addLog('[传输助手] 手机已连接：' + id, 'success');
                    });
                    knownPhones = nowIds;
                    emit();
                },
                onerror: () => {
                    if (state.phones.length) {
                        state = { ...state, phones: [] };
                        emit();
                    }
                },
            });
        } catch (e) {
            /* 忽略单轮异常，5s 后自然重试 */
        }
    };
    check();
    phonePollTimer = setInterval(check, 5000) as unknown as number;
}

/** 接收循环（长轮询 /recv）：收到图片 / 文本进对应会话，并按设置自动弹窗 */
function startReceive(server: string): void {
    receiveStop = startPhoneReceive({
        server,
        uuid: getDeviceId(),
        onConnected: () => addLog('[传输助手] 已自动开始接收（' + server + '）', 'info'),
        onImage: (img) => {
            addLog('[传输助手] 收到图片：' + (img.name || 'image') + '（' + (img.mime || 'image') + '）', 'success');
            const key = sessionKeyForIncoming();
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
            const key = sessionKeyForIncoming();
            addMessage(key, {
                id: nextId(),
                type: 'text',
                direction: 'in',
                sessionKey: key,
                text: t,
                ts: txt.ts || Date.now(),
            });
        },
    });
}

/**
 * 收到内容时归到哪个会话：只有 1 台在线手机 → 那台；否则聚合会话。
 * （正向广播不带手机 ID，无法细分，见文件头「会话归组规则」。）
 */
function sessionKeyForIncoming(): string {
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
}

/** 清空全部文件（所有会话的图片一起清） */
export function clearAllTransferFiles(): void {
    state.sessions.forEach((s) => s.messages.forEach((m) => revokeUrl(m.previewUrl)));
    state = { ...state, sessions: [] };
    emit();
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

/** 发送目标：具体手机 → 定向；聚合 / 未知设备 → 广播 */
function sendTargets(sessionKey: string): 'all' | string[] {
    if (sessionKey === PHONE_SESSION_KEY) return 'all';
    return [sessionKey];
}

/** 发送文本到某会话；返回是否真正发出了请求 */
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
    if (!sessionSendable(sessionKey)) {
        addLog('[传输助手] 当前无在线设备，无法发送', 'error', true);
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
    addMessage(sessionKey, msg);
    sendToPhone({
        server,
        uuid: getDeviceId(),
        payload: { text: t, targets: sendTargets(sessionKey) },
        onOk: () => addLog('[传输助手] 文本已发送', 'success'),
        onFail: (e) => {
            patchMessage(sessionKey, msg.id, { sendState: 'failed', sendError: e });
            addLog('[传输助手] 发送失败：' + e, 'error');
        },
    });
    return true;
}

/**
 * 发送图片到某会话：逐张顺序发送（一张成功再发下一张，保证到达顺序）。
 * 图片先经 `compressImageForPhone` 压缩（与「手机 → 电脑」同套规格：最长边 1600、JPEG 0.75；
 * SVG/GIF、解码失败、压不小都回退原图），超 12MB 上限即停止。
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
        if (msgId) patchMessage(sessionKey, msgId, { sendState: 'failed', sendError: reason });
        addLog(
            '[传输助手] 第 ' + (sent + 1) + ' 张发送失败：' + reason + '（已发 ' + sent + '/' + total + '）',
            'error'
        );
        onProgress?.(sent, total, true, '已发送 ' + sent + '/' + total + '，已停止');
    };

    const sendNext = () => {
        if (sent >= total) {
            addLog('[传输助手] ' + total + ' 张图片已全部发送', 'success');
            onProgress?.(total, total, false, '已发送 ' + total + '/' + total);
            return;
        }
        const it = list[sent];
        addLog('[传输助手] 正在处理（' + (sent + 1) + '/' + total + '）：' + (it.name || 'image'), 'info');
        onProgress?.(sent, total, false, '处理中… ' + sent + '/' + total + '（第 ' + (sent + 1) + ' 张）');
        const msgId = nextId();
        compressImageForPhone(it.file)
            .then((out: { blob: Blob; name: string; mime: string; compressed?: boolean }) => {
                if (imagePayloadBytes(out.blob, out.name, out.mime) > RELAY_MAX_BODY) {
                    addLog(
                        '[传输助手] 第 ' +
                            (sent + 1) +
                            ' 张压缩后仍超限（单张约 12MB 上限），已停止（已发 ' +
                            sent +
                            '/' +
                            total +
                            '）',
                        'error',
                        true
                    );
                    failAt('压缩后仍超过单张上限（约 12MB）');
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
                // 先落一条「发送中」的气泡（缩略图用待发对象），成功/失败再改状态
                addMessage(sessionKey, {
                    id: msgId,
                    type: 'image',
                    direction: 'out',
                    sessionKey,
                    name: out.name,
                    mime: out.mime,
                    blob: out.blob,
                    previewUrl: it.url,
                    ts: Date.now(),
                    sendState: 'sending',
                });
                const rd = new FileReader();
                rd.onload = () => {
                    const b64 = ((rd.result as string) || '').split(',')[1] || '';
                    if (!b64) {
                        failAt('读取图片失败', msgId);
                        return;
                    }
                    sendToPhone({
                        server,
                        uuid: getDeviceId(),
                        payload: { name: out.name, mime: out.mime, data: b64, targets },
                        onOk: () => {
                            sent++;
                            patchMessage(sessionKey, msgId, { sendState: undefined, sendError: undefined });
                            onProgress?.(sent, total, false, '已发送 ' + sent + '/' + total);
                            sendNext();
                        },
                        onFail: (e) => failAt(e, msgId),
                    });
                };
                rd.onerror = () => failAt('读取图片失败', msgId);
                rd.readAsDataURL(out.blob);
            })
            .catch((e: { message?: string }) => failAt((e && e.message) || '图片处理失败'));
    };

    sendNext();
    return true;
}

/** 体积显示：统一按 KB（不足 1KB 也显示 1KB） */
function kbText(bytes: number): string {
    return Math.max(1, Math.round((Number(bytes) || 0) / 1024)) + 'KB';
}

/* ============================================================ 启动 / 停止 */

/**
 * 启动传输助手后台能力（幂等：主面板挂载 / 面板自愈重挂时调用）。
 * 中继地址没填好时只加载设置，不起轮询与接收。
 */
export function initTransfer(): void {
    if (inited) return;
    inited = true;
    restartLoops();
}

/** 停止全部后台能力（页面卸载时由 beforeunload 链路调用） */
export function stopTransfer(): void {
    stopLoops();
    knownPhones = new Set();
    inited = false;
}
