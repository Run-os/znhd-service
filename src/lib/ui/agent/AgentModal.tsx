import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Modal, Popconfirm, Select, Space, Tooltip, Typography, theme } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { addLog } from '@/lib/logger';
import { getOverlayContainer } from '@/lib/ui/panelHost';
import { BotIcon, PlusIcon, SendIcon, StopIcon, TrashIcon } from '@/lib/ui/icons';
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
import { contentToText, thinkingToText, toolDisplayName } from '@/lib/agent/types';
import type { AgentConversation, AgentModelSummary, AgentToolCall } from '@/lib/agent/types';
import MarkdownBody from '@/lib/ui/agent/MarkdownBody';
import SkillsPanel from '@/lib/ui/agent/SkillsPanel';
import TaskPanel from '@/lib/ui/agent/TaskPanel';

/** 界面上的消息（与后端 ChatMessage 解耦：多了本地的 pending/cancelled 等展示态） */
interface UiMessage {
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

export interface AgentModalProps {
    open: boolean;
    onClose: () => void;
}

/** 面板宽度 238px 放不下的内容都进这个弹窗；v26.10.10-v13 起左侧多了会话栏，故 720 → 760 */
const MODAL_WIDTH = 760;
/** 消息区高度：弹窗固定高度，输入框永远留在视口内，不随消息变长而抖 */
const MESSAGES_HEIGHT = 360;
/** 侧栏会话栏宽度：够放「MM/DD HH:mm」与 30 字截断标题，又不至于把消息区压窄 */
const SIDEBAR_WIDTH = 172;

/**
 * 会话卡片上的时间（NextChat 的列表也是这个位置）。
 * 只到分钟：脚本不用 moment/dayjs（零运行时依赖），手写两行足够。
 */
function chatTimeText(timestamp: number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
        pad(date.getMonth() + 1) + '/' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    );
}

type TabKey = 'chat' | 'skills' | 'tasks';

/**
 * 交代脚本自身的上下文，让 Agent 知道「自己在哪、能干什么」。刻意写短：
 * 太长会与用户的真实问题抢注意力，而且它是每轮都要付的 token。
 */
const SYSTEM_PROMPT = [
    '你是「征纳互动人数和在线监控」油猴脚本内置的助手。',
    '这个脚本运行在税务人员的工作电脑上：监控征纳互动的等待人数与掉线弹窗、语音播报提醒、',
    '还有常用语、历史记录、设备互联（手机传图到电脑）、图片嗅探几个面板入口。',
    '回答请用简体中文，尽量简短直接；涉及操作步骤时说清楚点哪个按钮。',
].join('\n');

/**
 * Agent 弹窗（v26.10.10-v10）。
 *
 * ── 为什么是「弹窗 + 页签」而不是面板里再开一层 ──────────────────────────────
 * 主面板宽度固定 238px（`PANEL_WIDTH`），塞不下对话流。弹窗沿用本仓库既有做法
 * （`getOverlayContainer`，见 PhoneModal / SniffModal）挂到宿主页 body 之外的 overlay 容器，
 * 避免宿主页 `body { transform }` 把浮层限制在盒子内。
 *
 * ── 可用性 ─────────────────────────────────────────────────────────────────
 * `CAT.agent.*` 只在 ScriptCat v1.4+ 存在。探测在 render 期做（纯内存判空，无异步），
 * 不可用时**照常打开弹窗**并显示原因，而不是把按钮藏起来 —— 用户至少要知道「为什么点不动」。
 */
export default function AgentModal({ open, onClose }: AgentModalProps) {
    const { token } = theme.useToken();
    // 探测是纯内存判空，每次 render 重算也无所谓（不缓存，避免 ScriptCat 热重载后状态过期）
    const availability = detectCatAgent();
    const api = availability.api;

    const [tab, setTab] = useState<TabKey>('chat');
    const [models, setModels] = useState<AgentModelSummary[]>([]);
    const [modelId, setModelId] = useState<string>('');
    const [messages, setMessages] = useState<UiMessage[]>([]);
    const [input, setInput] = useState<string>('');
    const [streaming, setStreaming] = useState<boolean>(false);
    const [fatalError, setFatalError] = useState<string>('');

    const [conversation, setConversation] = useState<AgentConversation | null>(null);
    /** 会话索引（v26.10.10-v12）：官方 conversation API 没有 list/delete，列表由脚本自己记账 */
    const [chats, setChats] = useState<AgentChatSession[]>([]);
    /** 当前会话 id；空串 = 空白对话（发第一条消息时才会真正创建） */
    const [activeChatId, setActiveChatId] = useState<string>('');
    /** 鼠标正悬停的会话卡片：侧栏的删除图标只在悬停（或选中）时出现，用 state 而不是 CSS 类 */
    const [hoverChatId, setHoverChatId] = useState<string>('');
    const [skillsVersion, setSkillsVersion] = useState<number>(0);
    const [tasksVersion, setTasksVersion] = useState<number>(0);

    const keyRef = useRef<number>(0);
    /** 会话索引的最新值：回调里要读它，不能依赖 state 快照（否则连发两条会用同一份旧列表去 upsert） */
    const chatsRef = useRef<AgentChatSession[]>([]);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const streamTokenRef = useRef<number>(0);
    // antd 的 Input.TextArea ref 不是原生 textarea，而是带 nativeElement 的 TextAreaRef（rc-textarea 约定）
    const inputRef = useRef<TextAreaRef | null>(null);

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
        if (!open || !api) return;
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
    }, [open, api]);

    /* ---------------------------------------------------------- 接回上次的会话 */
    /**
     * 打开弹窗时先把本地会话索引读出来，再按上次的 activeId 把那个对话接回去。
     * 这一步就是「刷新网页 / 关掉弹窗后对话还在」的关键：对话本体一直在 ScriptCat 的 OPFS 里，
     * 缺的只是脚本这边记住「上次聊的是哪一个」。
     */
    useEffect(() => {
        if (!open) return;
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
    }, [open, api]);

    /* ---------------------------------------------------------- 输入框自适应高度 */
    useEffect(() => {
        const el = inputRef.current?.nativeElement;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 96) + 'px';
    }, [input, tab, open]);

    /* ---------------------------------------------------------- 消息区自动滚到底 */
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [messages]);

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

    /** 打开弹窗时把该对话已有的历史拉回来，关掉再开仍能接着看 */
    useEffect(() => {
        if (!open || !conversation) return;
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
    }, [open, conversation, nextKey]);

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
     * v26.10.10-v13 起侧栏每条都能删，所以这里按 id 工作，不再是「只能删当前这条」。
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

    const handleClose = useCallback(() => {
        stopStreaming();
        setStreaming(false);
        onClose();
    }, [stopStreaming, onClose]);

    const renderMessage = (message: UiMessage) => {
        const isUser = message.role === 'user';
        return (
            <div
                key={message.key}
                style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                <div
                    style={{
                        maxWidth: '86%',
                        padding: '8px 10px',
                        borderRadius: 8,
                        fontSize: 13,
                        lineHeight: 1.6,
                        wordBreak: 'break-word',
                        background: isUser ? token.colorPrimaryBg : token.colorFillQuaternary,
                        border: '1px solid ' + (isUser ? token.colorPrimaryBorder : token.colorBorderSecondary),
                    }}>
                    {!isUser && message.toolCalls?.length ? (
                        <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {message.toolCalls.map((toolCall, index) => (
                                <Tooltip
                                    key={(toolCall.id || toolCall.name) + '-' + index}
                                    title={toolCall.arguments ? toolCall.arguments.slice(0, 300) : toolCall.name}>
                                    <span
                                        style={{
                                            fontSize: 11,
                                            padding: '1px 6px',
                                            borderRadius: 9,
                                            background: token.colorFillTertiary,
                                            color: token.colorTextSecondary,
                                        }}>
                                        {toolDisplayName(toolCall.name)}
                                        {toolCall.status === 'running' ? ' …' : ''}
                                    </span>
                                </Tooltip>
                            ))}
                        </div>
                    ) : null}
                    {!isUser && message.thinking ? (
                        <details style={{ marginBottom: 6 }}>
                            <summary style={{ cursor: 'pointer', fontSize: 12, color: token.colorTextTertiary }}>
                                思考过程
                            </summary>
                            <div style={{ fontSize: 12, color: token.colorTextSecondary, marginTop: 4 }}>
                                {message.thinking}
                            </div>
                        </details>
                    ) : null}
                    {message.content ? (
                        // v26.10.10-v14 起两侧都按 Markdown 渲染（见 MarkdownBody 的注释）：
                        // 用户消息里的单换行由 remark-breaks 兜住，不会再被并成一行
                        <MarkdownBody content={message.content} />
                    ) : message.pending ? (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            正在思考…
                        </Typography.Text>
                    ) : null}
                    {message.cancelled ? (
                        <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 4 }}>（已中止）</div>
                    ) : null}
                    {message.error ? (
                        <div style={{ fontSize: 12, color: token.colorError, marginTop: 6 }}>{message.error}</div>
                    ) : null}
                </div>
            </div>
        );
    };

    /** 侧栏的一条会话卡片（NextChat 的列表项：标题 + 时间，选中高亮，悬停出现删除） */
    const renderChatItem = (item: AgentChatSession) => {
        const active = item.id === activeChatId;
        return (
            <div
                key={item.id}
                className={'znhd-agent-chat-item' + (active ? ' znhd-agent-chat-item-active' : '')}
                title={agentChatLabel(chats, item.id)}
                onClick={() => void switchChat(item.id)}
                onMouseEnter={() => setHoverChatId(item.id)}
                onMouseLeave={() => setHoverChatId((current) => (current === item.id ? '' : current))}
                style={{
                    position: 'relative',
                    padding: '6px 24px 6px 8px',
                    marginBottom: 4,
                    borderRadius: 6,
                    cursor: 'pointer',
                    lineHeight: 1.5,
                    background: active ? token.colorPrimaryBg : token.colorFillQuaternary,
                    border: '1px solid ' + (active ? token.colorPrimaryBorder : 'transparent'),
                }}>
                <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agentChatLabel(chats, item.id)}
                </div>
                <div style={{ fontSize: 11, color: token.colorTextTertiary }}>{chatTimeText(item.updatetime)}</div>
                <span
                    style={{
                        position: 'absolute',
                        top: 4,
                        right: 2,
                        opacity: active || hoverChatId === item.id ? 1 : 0,
                    }}
                    onClick={(event) => event.stopPropagation()}>
                    <Popconfirm
                        title="删除这个对话？"
                        description="会清空该对话的消息记录，并从会话列表里移除。"
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => void deleteChat(item.id)}>
                        <Button
                            type="text"
                            size="small"
                            aria-label="删除对话"
                            icon={<TrashIcon size={12} />}
                            style={{ width: 20, height: 20, minWidth: 20, padding: 0, color: token.colorTextTertiary }}
                        />
                    </Popconfirm>
                </span>
            </div>
        );
    };

    /**
     * 左侧会话栏（v26.10.10-v13）。
     *
     * 为什么是 state 控制删除图标的显隐、而不是 CSS `:hover`：本仓库没有给 Agent 弹窗引样式表
     * （图标全内联、面板样式走 PANEL_CSS），为一次 hover 再注入 <style> 不划算；
     * onMouseEnter/Leave 两行就够，且选中项永远可见，触屏/键盘用户也不会找不到入口。
     */
    const renderSidebar = () => (
        <div
            className="znhd-agent-sidebar"
            style={{
                flex: '0 0 ' + SIDEBAR_WIDTH + 'px',
                width: SIDEBAR_WIDTH,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                paddingRight: 10,
                borderRight: '1px solid ' + token.colorBorderSecondary,
            }}>
            <Tooltip title="清空当前视图，发出下一条消息时另起一个对话">
                <Button
                    size="small"
                    icon={<PlusIcon size={13} />}
                    onClick={newChat}
                    disabled={streaming && !conversation}
                    style={{ justifyContent: 'flex-start' }}>
                    新的聊天
                </Button>
            </Tooltip>
            <div
                className="znhd-agent-chat-list"
                style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                {chats.length ? (
                    chats.map(renderChatItem)
                ) : (
                    <div style={{ fontSize: 12, color: token.colorTextTertiary, padding: '4px 2px' }}>
                        还没有历史对话。发出第一条消息后，它会出现在这里。
                    </div>
                )}
            </div>
        </div>
    );

    const renderChat = () => {
        if (!api) {
            return (
                <Alert
                    type="warning"
                    showIcon
                    icon={<BotIcon size={16} />}
                    message="Agent 功能不可用"
                    description={availability.reason}
                />
            );
        }
        return (
            <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                {renderSidebar()}
                <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <Typography.Text strong style={{ fontSize: 14 }}>
                            {activeChatId ? agentChatLabel(chats, activeChatId) : '新的聊天'}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                            共 {chats.length} 条对话
                        </Typography.Text>
                    </div>

                    {models.length ? null : (
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            还没有在 ScriptCat 里配置模型：请打开 ScriptCat 的 Agent 设置添加一个模型（支持 OpenAI 兼容
                            / Anthropic / 智谱），之后这里会列出可选模型。
                        </Typography.Text>
                    )}

                    {fatalError ? <Alert type="error" showIcon message={fatalError} /> : null}

                    <div
                        ref={scrollRef}
                        className="znhd-agent-messages"
                        style={{
                            height: MESSAGES_HEIGHT,
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            padding: '8px 4px',
                            border: '1px solid ' + token.colorBorderSecondary,
                            borderRadius: 6,
                            background: token.colorBgContainer,
                        }}>
                        {messages.length ? (
                            messages.map(renderMessage)
                        ) : (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    <span style={{ fontSize: 12 }}>
                                        直接提问即可。可以试试「帮我总结这个页面能做什么」「征纳互动掉线提醒没声音怎么办」
                                    </span>
                                }
                            />
                        )}
                    </div>

                    {/* 输入框：整块带边框，模型下拉与发送箭头都在框内（参考 Chatbox / NextChat） */}
                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            padding: '6px 8px 4px',
                            border: '1px solid ' + token.colorBorderSecondary,
                            borderRadius: 8,
                            background: token.colorBgContainer,
                        }}>
                        <Input.TextArea
                            ref={inputRef}
                            value={input}
                            onChange={(event) => setInput(event.target.value)}
                            onPressEnter={(event) => {
                                if (event.shiftKey) return;
                                event.preventDefault();
                                void send();
                            }}
                            placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                            // v26.10.10-v15：minRows 从 1 改成 2。rc-textarea 在**挂载时**按 minRows 算高度
                            // （1 行 ≈ 20px），而一旦输入过内容，它就按「行数 × 行高 + padding」重算
                            // （1 行文本实测 41px）——于是「打一个字再全删掉」会把输入框永久留在 41px，
                            // 与刚打开时的 20px 不一致（用户报告的「高度会变」）。minRows: 2 让初始态
                            // 就等于打过字的高度，打一个字不再跳。冒烟 agentInputHeightOk 守着这条。
                            autoSize={{ minRows: 2, maxRows: 4 }}
                            disabled={!api}
                            variant="borderless"
                            // antd v6 的 borderless 变体在 :focus-visible 时会给文本域**自己**画一层
                            // outline 聚焦框（node_modules/antd/es/input/style/variants.js 的
                            // genBorderlessFocusVisibleStyle：`outline: 1px solid activeBorderColor`），
                            // 看上去就像输入框外围多了一圈蓝框。这里显式关掉 outline 与 boxShadow
                            // —— 内联样式优先级高于 antd 的类规则（那两条都没用 !important），两种画框
                            // 方式一起关，别只堵一半。要恢复聚焦提示的话请改外层容器的边框，别打开这里。
                            style={{
                                resize: 'none',
                                padding: 0,
                                fontSize: 13,
                                // v26.10.10-v15：显式钉住行高。rc-textarea 的 autoSize 靠「把计算样式复制到
                                // 隐藏测量 textarea」算高度：挂载那一刻 antd 的样式还没注入完，行高按 20px 算
                                // （2 行 = 40px），输入过一次之后再量就是 20.5px（2 行 = 41px），于是「打一个字
                                // 再删掉」会永久差 1px。钉死行高后两条路径算出来完全一致。
                                lineHeight: '20px',
                                outline: 'none',
                                boxShadow: 'none',
                            }}
                        />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Typography.Text
                                type="secondary"
                                style={{ fontSize: 11, flex: '1 1 auto', minWidth: 0 }}
                                ellipsis>
                                Enter 发送，Shift + Enter 换行
                            </Typography.Text>
                            <Select
                                size="small"
                                variant="borderless"
                                style={{ maxWidth: 190 }}
                                value={modelId || undefined}
                                placeholder={models.length ? '选择模型' : '未配置模型'}
                                disabled={streaming}
                                options={models.map((model) => ({
                                    value: model.id,
                                    label: model.name + '（' + model.provider + '）',
                                }))}
                                onChange={(value) => setModelId(value)}
                            />
                            {streaming ? (
                                <Tooltip title="中止本轮回答">
                                    <Button
                                        shape="circle"
                                        size="small"
                                        danger
                                        aria-label="中止"
                                        icon={<StopIcon size={12} />}
                                        onClick={stopStreaming}
                                    />
                                </Tooltip>
                            ) : (
                                <Tooltip title="发送（Enter）">
                                    <Button
                                        shape="circle"
                                        size="small"
                                        type="primary"
                                        aria-label="发送"
                                        icon={<SendIcon size={14} />}
                                        onClick={() => void send()}
                                        disabled={!input.trim()}
                                    />
                                </Tooltip>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const tabs: Array<{ key: TabKey; label: string }> = [
        { key: 'chat', label: '对话' },
        { key: 'skills', label: '技能' },
        { key: 'tasks', label: '定时任务' },
    ];

    return (
        <Modal
            open={open}
            title={
                <Space size={6}>
                    <BotIcon size={16} color={token.colorPrimary} />
                    <span>Agent 助手</span>
                </Space>
            }
            width={MODAL_WIDTH}
            getContainer={getOverlayContainer}
            onCancel={handleClose}
            destroyOnHidden
            footer={
                <Space>
                    <Button onClick={handleClose}>关闭</Button>
                </Space>
            }>
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid ' + token.colorBorderSecondary }}>
                {tabs.map((item) => (
                    <Button
                        key={item.key}
                        type="text"
                        size="small"
                        onClick={() => setTab(item.key)}
                        style={{
                            padding: '4px 10px',
                            fontSize: 13,
                            borderBottom: '2px solid ' + (tab === item.key ? token.colorPrimary : 'transparent'),
                            borderRadius: 0,
                        }}>
                        {item.label}
                    </Button>
                ))}
            </div>

            <div style={{ paddingTop: 10 }}>
                {tab === 'chat' ? renderChat() : null}
                {tab === 'skills' ? (
                    api ? (
                        <SkillsPanel
                            api={api}
                            version={skillsVersion}
                            onChange={() => setSkillsVersion((value) => value + 1)}
                        />
                    ) : (
                        <Alert type="warning" showIcon message="技能不可用" description={availability.reason} />
                    )
                ) : null}
                {tab === 'tasks' ? (
                    api ? (
                        <TaskPanel
                            api={api}
                            version={tasksVersion}
                            onChange={() => setTasksVersion((value) => value + 1)}
                        />
                    ) : (
                        <Alert type="warning" showIcon message="定时任务不可用" description={availability.reason} />
                    )
                ) : null}
            </div>
        </Modal>
    );
}
