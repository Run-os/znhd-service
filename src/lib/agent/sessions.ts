/**
 * Agent 会话索引（v26.10.10-v12）。
 *
 * ── 为什么脚本要自己记一份会话列表 ───────────────────────────────────────────
 * 官方 `CAT.agent.conversation` 只对脚本开放两个方法：`create()` 和 `get(id)`
 * （ScriptCat 侧 `src/types/scriptcat.d.ts:1104-1115`，内容侧实现
 * `src/app/service/content/gm_api/cat_agent.ts:924-960`）。内部的
 * `listConversations()` / `deleteConversation()`（`src/app/repo/agent_chat.ts:173`、`:237`）
 * 没有对应的 `@GMContext.API` 出口，而脚本侧的 `sendMessage` 是 `protected`，绕不过去。
 * 所以「有哪些对话、叫什么名字、上次打开的是哪个」只能由脚本自己记账 —— 就是本模块。
 *
 * ── 这里存的**只是索引** ───────────────────────────────────────────────────
 * 对话消息本体一直在 ScriptCat 的 OPFS 里（本脚本用的是非 ephemeral 对话）。
 * 索引丢了最多是「列表看不到」，消息不会丢；切回某个对话时仍走 `conversation.get(id)` 取历史。
 * 反过来，索引里的 id 在 ScriptCat 侧被清掉时 `get()` 会返回 null，调用方按「已失效」处理。
 *
 * ── 为什么对话 id 是 ScriptCat 生成的 ──────────────────────────────────────
 * `create()` 支持传自定义 id，但没必要：id 拿到就存下来即可，少一处自造 id 的撞号风险。
 */

import { AGENT_CHATS_KEY, CONFIG } from '@/lib/constants';
import { addLog } from '@/lib/logger';

export interface AgentChatSession {
    /** ScriptCat 侧的对话 id */
    id: string;
    /** 列表里显示的名字（取首条消息前 N 字，规则对齐官方自动标题） */
    title: string;
    /** 首次创建时间（毫秒时间戳） */
    createtime: number;
    /** 最近一次发送时间（毫秒时间戳），列表按它倒序 */
    updatetime: number;
}

export interface AgentChatStore {
    /** 上次打开的对话 id；空串 / null = 当前是「还没发第一条消息」的空白对话 */
    activeId: string | null;
    items: AgentChatSession[];
}

const EMPTY_STORE: AgentChatStore = { activeId: null, items: [] };

function isSession(value: unknown): value is AgentChatSession {
    if (!value || typeof value !== 'object') return false;
    const item = value as Record<string, unknown>;
    return typeof item.id === 'string' && !!item.id && typeof item.title === 'string';
}

/**
 * 读索引。任何异常（localStorage 不可用、JSON 被别的东西写坏）都退化成空列表 ——
 * 弹窗打开时读它，绝不能因为一份索引解析失败就整块面板报错。
 */
export function loadAgentChatStore(): AgentChatStore {
    try {
        const raw = localStorage.getItem(AGENT_CHATS_KEY);
        if (!raw) return EMPTY_STORE;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return EMPTY_STORE;
        const record = parsed as Record<string, unknown>;
        const items = (Array.isArray(record.items) ? record.items : [])
            .filter(isSession)
            .slice(0, CONFIG.MAX_AGENT_CHATS)
            .map((item) => ({
                id: item.id,
                title: item.title,
                createtime: typeof item.createtime === 'number' ? item.createtime : 0,
                updatetime: typeof item.updatetime === 'number' ? item.updatetime : 0,
            }));
        const activeId = typeof record.activeId === 'string' && record.activeId ? record.activeId : null;
        // activeId 指向的条目不在索引里（索引被手改过 / 写入中断）：当作没有活动对话，避免界面显示一个点不开的选项
        return { activeId: items.some((item) => item.id === activeId) ? activeId : null, items };
    } catch (error) {
        addLog('[Agent] 读取会话列表失败: ' + (error instanceof Error ? error.message : String(error)), 'warning');
        return EMPTY_STORE;
    }
}

/** 写索引。失败只记日志：会话列表写不进去不该打断正在进行的对话。 */
export function saveAgentChatStore(store: AgentChatStore): void {
    try {
        localStorage.setItem(AGENT_CHATS_KEY, JSON.stringify(store));
    } catch (error) {
        addLog('[Agent] 保存会话列表失败: ' + (error instanceof Error ? error.message : String(error)), 'warning');
    }
}

/**
 * 由首条用户消息生成会话标题，规则与官方一致（截断长度见 CONFIG.AGENT_CHAT_TITLE_LENGTH）。
 * 换行/连续空白压成单个空格，否则列表里会出现莫名其妙的空白。
 */
export function agentChatTitle(text: string): string {
    const flat = text.replace(/\s+/g, ' ').trim();
    const limit = CONFIG.AGENT_CHAT_TITLE_LENGTH;
    if (flat.length <= limit) return flat || '新对话';
    return flat.slice(0, limit) + '…';
}

/**
 * 写入/更新一条会话，并把它提到列表最前（最近使用）。
 * 已存在时以传入的 session 为准整条替换，调用方负责决定是否保留原标题。
 */
export function upsertAgentChat(items: AgentChatSession[], session: AgentChatSession): AgentChatSession[] {
    const rest = items.filter((item) => item.id !== session.id);
    return [session, ...rest].slice(0, CONFIG.MAX_AGENT_CHATS);
}

/** 从索引里移除一条（删对话时用）。官方没有删除会话的接口，这里只动本地索引。 */
export function removeAgentChat(items: AgentChatSession[], id: string): AgentChatSession[] {
    return items.filter((item) => item.id !== id);
}

/** 取一条会话的标题，取不到时回退成 id 前 8 位（界面上总得显示点东西） */
export function agentChatLabel(items: AgentChatSession[], id: string): string {
    const found = items.find((item) => item.id === id);
    if (found && found.title) return found.title;
    return id ? id.slice(0, 8) : '新对话';
}
