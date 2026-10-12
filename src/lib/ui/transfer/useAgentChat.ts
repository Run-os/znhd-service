import { useCallback, useEffect, useRef, useState } from 'react';
import { addLog } from '@/lib/logger';
import {
    agentErrorMessage,
    clearConversation,
    createConversation,
    describeAgentError,
    detectCatAgent,
    getConversation,
    listModels,
    pickDefaultModelId,
    readConversationMessages,
    streamConversation,
} from '@/lib/agent/api';
import {
    agentChatLabel,
    agentChatTitle,
    loadAgentChatStore,
    removeAgentChat,
    saveAgentChatStore,
    upsertAgentChat,
} from '@/lib/agent/sessions';
import type { AgentChatSession } from '@/lib/agent/sessions';
import { contentToText, thinkingToText } from '@/lib/agent/types';
import type { AgentConversation, AgentModelSummary, AgentToolCall, CatAgentApi } from '@/lib/agent/types';

/** 界面上的消息（与后端 ChatMessage 解耦：多了本地的 pending/cancelled 等展示态） */
export interface UiMessage {
    key: number;
    role: 'user' | 'assistant';
    content: string;
    thinking?: string;
    toolCalls?: AgentToolCall[];
    /** 本轮失败时的错误文案 */
    error?: string;
    /** 被用户中止 */
    cancelled?: boolean;
    /** 仍在流式接收中 */
    pending?: boolean;
}

/**
 * 交代脚本自身的上下文，让 Agent 知道「自己在哪、能干什么」。刻意写短：
 * 太长会与用户的真实问题抢注意力，而且它是每轮都要付的 token。
 */
const SYSTEM_PROMPT = [
    '你是「征纳互动人数和在线监控」油猴脚本内置的助手。',
    '这个脚本运行在税务人员的工作电脑上：监控征纳互动的等待人数与掉线弹窗、语音播报提醒、',
    '还有常用语、传输助手（手机 ↔ 电脑互传文件）、图片嗅探几个面板入口。',
    '回答请用简体中文，尽量简短直接；涉及操作步骤时说清楚点哪个按钮。',
].join('\n');

export interface AgentChatController {
    /** 能力探测结果（ScriptCat v1.4+ 之外为不可用，UI 照常渲染并说明原因） */
    availability: ReturnType<typeof detectCatAgent>;
    api: CatAgentApi | null;
    models: AgentModelSummary[];
    modelId: string;
    setModelId: (id: string) => void;
    messages: UiMessage[];
    input: string;
    setInput: (value: string) => void;
    streaming: boolean;
    fatalError: string;
    /** 会话索引（官方 API 只有 create/get，列表由脚本自记，见 sessions.ts） */
    chats: AgentChatSession[];
    /** 当前会话 id；空串 = 空白对话（发第一条消息时才会真正创建） */
    activeChatId: string;
    send: () => Promise<void>;
    stopStreaming: () => void;
    newChat: () => void;
    switchChat: (id: string) => Promise<void>;
    deleteChat: (id: string) => Promise<void>;
    /** 消息 key 自增（渲染列表用） */
    nextKey: () => number;
}

/**
 * Agent 对话状态机（v26.10.12-v1 从原 AgentModal 抽取）。
 *
 * 重构背景：「Agent 助手」不再是独立弹窗，而是传输助手第一栏的 Agents 入口 ——
 * 点击后在右侧主聊天区直接打开对话。本 hook 把原弹窗里的全部会话逻辑原样搬过来，
 * 由传输助手窗口（第一栏 Agents 选中时）持有；`active` 即「Agent 视图当前可见」。
 *
 * ⚠️ 以下实测结论全部沿用（原 AgentModal 已于 v26.10.12-v1 删除，结论随本 hook 保留），改前必读 AGENT.md 对应条目：
 *   · 流式分片回调早于 `await` 返回值可用 ⇒ 增量累加必须用调用前建好的独立对象（TDZ）；
 *   · 历史消息的 `thinking` 是对象，必须过 `thinkingToText()` 再进 JSX；
 *   · 官方没有 list/delete 会话接口，列表是本地索引（`scriptCat_AgentChats`）；
 *   · `clear()` 只清消息、不删会话记录，UI 不承诺「彻底删除」。
 */
export function useAgentChat(active: boolean): AgentChatController {
    // 探测是纯内存判空，每次 render 重算也无所谓（不缓存，避免 ScriptCat 热重载后状态过期）
    const availability = detectCatAgent();
    const api = availability.api;

    const [models, setModels] = useState<AgentModelSummary[]>([]);
    const [modelId, setModelId] = useState<string>('');
    const [messages, setMessages] = useState<UiMessage[]>([]);
    const [input, setInput] = useState<string>('');
    const [streaming, setStreaming] = useState<boolean>(false);
    const [fatalError, setFatalError] = useState<string>('');

    const [conversation, setConversation] = useState<AgentConversation | null>(null);
    const [chats, setChats] = useState<AgentChatSession[]>([]);
    /** 当前会话 id；空串 = 空白对话（发第一条消息时才会真正创建） */
    const [activeChatId, setActiveChatId] = useState<string>('');

    const keyRef = useRef<number>(0);
    /** 会话索引的最新值：回调里要读它，不能依赖 state 快照（否则连发两条会用同一份旧列表去 upsert） */
    const chatsRef = useRef<AgentChatSession[]>([]);
    const streamTokenRef = useRef<number>(0);

    const nextKey = useCallback(() => {
        keyRef.current += 1;
        return keyRef.current;
    }, []);

    /**
     * 会话索引的唯一写入口：同时更新 ref（回调里读最新值）、state（触发渲染）与 localStorage。
     * activeId 用空串表示「当前没有活动对话」，落盘时统一换成 null。
     */
    const persistChats = useCallback((items: AgentChatSession[], activeId: string) => {
        chatsRef.current = items;
        setChats(items);
        setActiveChatId(activeId);
        saveAgentChatStore({ activeId: activeId || null, items });
    }, []);

    /* ---------------------------------------------------------- 模型列表 */
    useEffect(() => {
        if (!active || !api) return;
        let alive = true;
        void (async () => {
            const [list, preferred] = await Promise.all([listModels(api), pickDefaultModelId(api)]);
            if (!alive) return;
            setModels(list);
            setModelId((current) => current || preferred || list[0]?.id || '');
        })();
        return () => {
            alive = false;
        };
    }, [active, api]);

    /* ---------------------------------------------------------- 接回上次的会话 */
    /**
     * Agent 视图变为可见时先把本地会话索引读出来，再按上次的 activeId 把那个对话接回来。
     * 这一步就是「刷新网页 / 关掉窗口后对话还在」的关键：对话本体一直在 ScriptCat 的 OPFS 里，
     * 缺的只是脚本这边记住「上次聊的是哪一个」。
     */
    useEffect(() => {
        if (!active) return;
        const store = loadAgentChatStore();
        chatsRef.current = store.items;
        setChats(store.items);
        if (!store.activeId) {
            // 上次停在「新建但还没发第一条消息」的空白对话：保持空白，不接任何历史
            setActiveChatId('');
            setConversation(null);
            return;
        }
        if (!api) return;
        let alive = true;
        void (async () => {
            const conv = await getConversation(api, store.activeId as string);
            if (!alive) return;
            if (!conv) {
                // ScriptCat 侧已经找不到这个对话（用户在 Agent 设置里清过数据）：回到空白对话，
                // 索引条目留着让用户自己删，但绝不因为取不到就报错或让面板崩掉。
                setActiveChatId('');
                setConversation(null);
                addLog('[Agent] 上次的对话已不存在，已回到空白对话', 'warning');
                return;
            }
            setActiveChatId(conv.id || (store.activeId as string));
            setConversation(conv);
        })();
        return () => {
            alive = false;
        };
    }, [active, api]);

    /** 打开 Agent 视图时把该对话已有的历史拉回来，切走再切回仍能接着看 */
    useEffect(() => {
        if (!active || !conversation) return;
        let alive = true;
        void (async () => {
            try {
                const history = await readConversationMessages(conversation);
                if (!alive || !history.length) return;
                setMessages(
                    history
                        .filter((message) => message.role === 'user' || message.role === 'assistant')
                        .map((message) => ({
                            key: nextKey(),
                            role: message.role as 'user' | 'assistant',
                            content: contentToText(message.content),
                            // 历史消息的 thinking 是官方 ThinkingBlock（对象 { content }），
                            // 必须归一成字符串再交给 React，否则整棵树会被卸载（v26.10.10-v11）。
                            thinking: thinkingToText(message.thinking),
                            toolCalls: message.toolCalls,
                        }))
                );
            } catch (error) {
                if (alive) addLog('[Agent] 读取对话历史失败: ' + agentErrorMessage(error), 'warning');
            }
        })();
        return () => {
            alive = false;
        };
        // conversation 变化（新建对话）时也要重新拉
    }, [active, conversation, nextKey]);

    const patchLast = useCallback((patch: Partial<UiMessage>) => {
        setMessages((prev) => {
            if (!prev.length) return prev;
            const next = prev.slice();
            const last = next[next.length - 1];
            if (last.role !== 'assistant') return prev;
            next[next.length - 1] = { ...last, ...patch };
            return next;
        });
    }, []);

    /** 把流式分片里的工具调用合并进最后一条助手消息（同名 id 只保留一份，状态取最新） */
    const mergeToolCall = useCallback((toolCall: AgentToolCall) => {
        setMessages((prev) => {
            if (!prev.length) return prev;
            const next = prev.slice();
            const last = next[next.length - 1];
            if (last.role !== 'assistant') return prev;
            const list = last.toolCalls ? last.toolCalls.slice() : [];
            const id = toolCall.id || toolCall.name;
            const index = list.findIndex((item) => (item.id || item.name) === id);
            if (index >= 0) list[index] = { ...list[index], ...toolCall };
            else list.push(toolCall);
            next[next.length - 1] = { ...last, toolCalls: list };
            return next;
        });
    }, []);

    const stopStreaming = useCallback(() => {
        // 递增令牌即可让正在跑的消费循环在下一个分片处 break（并走 finally → iterator.return()）
        streamTokenRef.current += 1;
    }, []);

    const send = useCallback(async () => {
        const text = input.trim();
        if (!api || !text || streaming) return;

        let conv = conversation;
        if (!conv) {
            try {
                conv = await createConversation(api, {
                    system: SYSTEM_PROMPT,
                    model: modelId || undefined,
                    skills: 'auto',
                });
                setConversation(conv);
                addLog('[Agent] 已创建对话 ' + (conv.id || ''), 'info');
            } catch (error) {
                const message = describeAgentError(error);
                setFatalError('无法创建对话：' + message);
                addLog('[Agent] 创建对话失败: ' + message, 'error');
                return;
            }
        }

        // 登记进本地会话索引：新对话用首条消息当标题（规则对齐官方自动标题），
        // 已有对话只更新时间戳并把原标题留住 —— 否则接着聊会把标题改成最新那条消息。
        const now = Date.now();
        const known = chatsRef.current.find((item) => item.id === conv.id);
        persistChats(
            upsertAgentChat(chatsRef.current, {
                id: conv.id,
                title: known && known.title ? known.title : agentChatTitle(text),
                createtime: known && known.createtime ? known.createtime : now,
                updatetime: now,
            }),
            conv.id
        );

        const token = streamTokenRef.current + 1;
        streamTokenRef.current = token;
        setFatalError('');
        setStreaming(true);
        setInput('');
        setMessages((prev) => [
            ...prev,
            { key: nextKey(), role: 'user', content: text },
            { key: nextKey(), role: 'assistant', content: '', pending: true },
        ]);

        try {
            // ⚠️ 分片回调会在 streamConversation 的 Promise resolve 之前就被调用，那一刻
            // `const outcome = await ...` 还处于 TDZ，读它会抛 ReferenceError（表现为「对话异常」
            // 且回答永远不落地）。所以增量累加用独立对象承载，不依赖返回值。
            const live = { content: '', thinking: '' };
            const outcome = await streamConversation(conv, text, {
                onContent: (delta) => {
                    if (streamTokenRef.current !== token) return;
                    live.content += delta;
                    patchLast({ content: live.content, pending: true });
                },
                onThinking: (delta) => {
                    if (streamTokenRef.current !== token) return;
                    live.thinking += delta;
                    patchLast({ thinking: live.thinking, pending: true });
                },
                onToolCall: (toolCall) => {
                    if (streamTokenRef.current !== token) return;
                    mergeToolCall(toolCall);
                },
                onWarning: (warning) => {
                    if (streamTokenRef.current !== token) return;
                    addLog('[Agent] ' + warning, 'warning');
                },
            });

            if (streamTokenRef.current !== token) {
                patchLast({ pending: false, cancelled: true, content: live.content, thinking: live.thinking });
                return;
            }
            patchLast({
                pending: false,
                content: live.content,
                thinking: live.thinking,
                error: outcome.error,
            });
            if (outcome.error) {
                addLog('[Agent] 对话出错: ' + outcome.error, 'error');
            } else if (outcome.usage) {
                addLog(
                    '[Agent] 本轮完成：输入 ' +
                        outcome.usage.inputTokens +
                        ' / 输出 ' +
                        outcome.usage.outputTokens +
                        ' tokens',
                    'info'
                );
            }
        } catch (error) {
            const message = describeAgentError(error);
            if (streamTokenRef.current === token) patchLast({ pending: false, error: message });
            addLog('[Agent] 对话异常: ' + message, 'error');
        } finally {
            setStreaming(false);
        }
    }, [api, input, streaming, conversation, modelId, nextKey, patchLast, mergeToolCall, persistChats]);

    const newChat = useCallback(() => {
        stopStreaming();
        setStreaming(false);
        setConversation(null);
        setMessages([]);
        setFatalError('');
        // 只清指针：真正的对话等第一条消息发出去时才创建，避免列表里堆一堆没内容的空对话
        persistChats(chatsRef.current, '');
        addLog('[Agent] 已新建对话（发出第一条消息后才会出现在会话列表里）', 'info');
    }, [persistChats, stopStreaming]);

    /** 切换会话：先中止正在跑的流，再按 id 把那个对话接回来 */
    const switchChat = useCallback(
        async (id: string) => {
            if (!api || !id || id === activeChatId) return;
            stopStreaming();
            setStreaming(false);
            setFatalError('');
            const conv = await getConversation(api, id);
            // 先清空消息：目标对话没有历史时，不能把上一个对话的内容留在屏幕上
            setMessages([]);
            setConversation(conv);
            setActiveChatId(id);
            saveAgentChatStore({ activeId: id, items: chatsRef.current });
            if (!conv) {
                setFatalError(
                    '这个对话在 ScriptCat 里已经不存在了（可能被清理过）。可以删掉它，或直接发消息另起一个。'
                );
                addLog('[Agent] 切换对话失败：ScriptCat 里找不到 ' + id, 'warning');
                return;
            }
            addLog('[Agent] 已切换到对话「' + agentChatLabel(chatsRef.current, id) + '」', 'info');
        },
        [api, activeChatId, stopStreaming]
    );

    /**
     * 删除某个会话：清空它的消息 + 从本地索引移除（官方没有删除会话的接口，见 sessions.ts）。
     * 传输助手的会话列表里每条都能删，所以这里按 id 工作，不再是「只能删当前这条」。
     */
    const deleteChat = useCallback(
        async (id: string) => {
            if (!id) return;
            const label = agentChatLabel(chatsRef.current, id);
            // 只有手里正拿着的实例才能 clear；索引里那条在 ScriptCat 侧已失效时本来也没有消息可清
            if (conversation && conversation.id === id) {
                stopStreaming();
                setStreaming(false);
                await clearConversation(conversation);
                setConversation(null);
                setMessages([]);
                setFatalError('');
                persistChats(removeAgentChat(chatsRef.current, id), '');
            } else {
                // 删的是别的会话：当前视图与 activeId 都不动，只把它从列表里去掉
                persistChats(removeAgentChat(chatsRef.current, id), activeChatId);
            }
            addLog('[Agent] 已删除对话「' + label + '」', 'info');
        },
        [activeChatId, conversation, persistChats, stopStreaming]
    );

    return {
        availability,
        api,
        models,
        modelId,
        setModelId,
        messages,
        input,
        setInput,
        streaming,
        fatalError,
        chats,
        activeChatId,
        send,
        stopStreaming,
        newChat,
        switchChat,
        deleteChat,
        nextKey,
    };
}
