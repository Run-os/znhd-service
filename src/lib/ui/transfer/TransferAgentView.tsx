import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, Select, Tooltip, Typography, theme } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { BotIcon, SendIcon, StopIcon } from '@/lib/ui/icons';
import { agentChatLabel } from '@/lib/agent/sessions';
import MarkdownBody from '@/lib/ui/agent/MarkdownBody';
import SkillsPanel from '@/lib/ui/agent/SkillsPanel';
import TaskPanel from '@/lib/ui/agent/TaskPanel';
import { toolDisplayName } from '@/lib/agent/types';
import type { UiMessage } from '@/lib/ui/transfer/useAgentChat';
import type { AgentChatController } from '@/lib/ui/transfer/useAgentChat';

/** 消息区高度：窗口固定高度，输入框永远留在视口内，不随消息变长而抖 */
const MESSAGES_HEIGHT = 300;

type TabKey = 'chat' | 'skills' | 'tasks';

/**
 * Agent 视图（v26.10.12-v1：原「Agent 助手」弹窗的对话区，搬进传输助手右侧主聊天区）。
 *
 * 三个页签（对话 / 技能 / 定时任务）与原弹窗一致；对话页签的输入框样式
 * （无聚焦蓝框、高度稳定）是 v26.10.10-v13~v15 的实测结论，勿动。
 */
export default function TransferAgentView({ agent }: { agent: AgentChatController }) {
    const { token } = theme.useToken();
    const [tab, setTab] = useState<TabKey>('chat');
    /** 技能 / 任务面板的数据版本：卸载技能、增删任务后 +1 触发重拉（与原弹窗同一机制） */
    const [skillsVersion, setSkillsVersion] = useState(0);
    const [tasksVersion, setTasksVersion] = useState(0);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    // antd 的 Input.TextArea ref 不是原生 textarea，而是带 nativeElement 的 TextAreaRef（rc-textarea 约定）
    const inputRef = useRef<TextAreaRef | null>(null);

    /* ---------------------------------------------------------- 输入框自适应高度 */
    useEffect(() => {
        const el = inputRef.current?.nativeElement;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 96) + 'px';
    }, [agent.input, tab]);

    /* ---------------------------------------------------------- 消息区自动滚到底 */
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [agent.messages]);

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
                        // 两侧都按 Markdown 渲染（见 MarkdownBody 的注释）：
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

    const renderChat = () => {
        if (!agent.api) {
            return (
                <Alert
                    type="warning"
                    showIcon
                    icon={<BotIcon size={16} />}
                    message="Agent 功能不可用"
                    description={agent.availability.reason}
                />
            );
        }
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: '1 1 auto' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <Typography.Text strong style={{ fontSize: 14 }}>
                        {agent.activeChatId ? agentChatLabel(agent.chats, agent.activeChatId) : '新的聊天'}
                    </Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                        共 {agent.chats.length} 条对话
                    </Typography.Text>
                </div>

                {agent.models.length ? null : (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        还没有在 ScriptCat 里配置模型：请打开 ScriptCat 的 Agent 设置添加一个模型（支持 OpenAI 兼容 /
                        Anthropic / 智谱），之后这里会列出可选模型。
                    </Typography.Text>
                )}

                {agent.fatalError ? <Alert type="error" showIcon message={agent.fatalError} /> : null}

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
                    {agent.messages.length ? (
                        agent.messages.map(renderMessage)
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
                        value={agent.input}
                        onChange={(event) => agent.setInput(event.target.value)}
                        onPressEnter={(event) => {
                            if (event.shiftKey) return;
                            event.preventDefault();
                            void agent.send();
                        }}
                        placeholder="输入问题，Enter 发送，Shift+Enter 换行"
                        // minRows 从 1 改成 2：rc-textarea 在挂载时按 minRows 算高度（1 行 ≈ 20px），
                        // 而一旦输入过内容，它就按「行数 × 行高 + padding」重算（1 行文本实测 41px）——
                        // 于是「打一个字再全删掉」会把输入框永久留在 41px，与刚打开时的 20px 不一致
                        // （用户报告的「高度会变」）。minRows: 2 让初始态就等于打过字的高度。
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        disabled={!agent.api}
                        variant="borderless"
                        // antd v6 的 borderless 变体在 :focus-visible 时会给文本域**自己**画一层
                        // outline 聚焦框（node_modules/antd/es/input/style/variants.js 的
                        // genBorderlessFocusVisibleStyle），看上去就像输入框外围多了一圈蓝框。
                        // 这里显式关掉 outline 与 boxShadow（内联样式优先级高于 antd 的类规则）。
                        // 要恢复聚焦提示的话请改外层容器的边框，别打开这里。
                        style={{
                            resize: 'none',
                            padding: 0,
                            fontSize: 13,
                            // 显式钉住行高：rc-textarea 的 autoSize 靠「把计算样式复制到隐藏测量
                            // textarea」算高度，挂载那一刻 antd 的样式还没注入完，行高按 20px 算
                            // （2 行 = 40px），输入过一次之后再量就是 20.5px（2 行 = 41px），
                            // 于是「打一个字再删掉」会永久差 1px。钉死行高后两条路径算出来完全一致。
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
                            value={agent.modelId || undefined}
                            placeholder={agent.models.length ? '选择模型' : '未配置模型'}
                            disabled={agent.streaming}
                            options={agent.models.map((model) => ({
                                value: model.id,
                                label: model.name + '（' + model.provider + '）',
                            }))}
                            onChange={(value) => agent.setModelId(value)}
                        />
                        {agent.streaming ? (
                            <Tooltip title="中止本轮回答">
                                <Button
                                    shape="circle"
                                    size="small"
                                    danger
                                    aria-label="中止"
                                    icon={<StopIcon size={12} />}
                                    onClick={agent.stopStreaming}
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
                                    onClick={() => void agent.send()}
                                    disabled={!agent.input.trim()}
                                />
                            </Tooltip>
                        )}
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
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>
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

            <div style={{ paddingTop: 10, flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                {tab === 'chat' ? renderChat() : null}
                {tab === 'skills' ? (
                    agent.api ? (
                        <SkillsPanel
                            api={agent.api}
                            version={skillsVersion}
                            onChange={() => setSkillsVersion((value) => value + 1)}
                        />
                    ) : (
                        <Alert type="warning" showIcon message="技能不可用" description={agent.availability.reason} />
                    )
                ) : null}
                {tab === 'tasks' ? (
                    agent.api ? (
                        <TaskPanel
                            api={agent.api}
                            version={tasksVersion}
                            onChange={() => setTasksVersion((value) => value + 1)}
                        />
                    ) : (
                        <Alert
                            type="warning"
                            showIcon
                            message="定时任务不可用"
                            description={agent.availability.reason}
                        />
                    )
                ) : null}
            </div>
        </div>
    );
}
