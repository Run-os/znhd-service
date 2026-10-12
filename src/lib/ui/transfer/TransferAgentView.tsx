import { useState } from 'react';
import { Alert, Empty, Select, Tooltip, Typography, theme } from 'antd';
import { BotIcon, ClockIcon, GridIcon, ImageIcon, PaperclipIcon, UserIcon } from '@/lib/ui/icons';
import { agentChatLabel } from '@/lib/agent/sessions';
import MarkdownBody from '@/lib/ui/agent/MarkdownBody';
import SkillsPanel from '@/lib/ui/agent/SkillsPanel';
import TaskPanel from '@/lib/ui/agent/TaskPanel';
import { toolDisplayName } from '@/lib/agent/types';
import ChatBubble from '@/lib/ui/transfer/ChatBubble';
import ChatComposer from '@/lib/ui/transfer/ChatComposer';
import { ChatHeader, ChatScroll } from '@/lib/ui/transfer/ChatPanel';
import type { AgentPane } from '@/lib/transfer/types';
import type { UiMessage } from '@/lib/ui/transfer/useAgentChat';
import type { AgentChatController } from '@/lib/ui/transfer/useAgentChat';

/**
 * Agent 视图（v26.10.12-v1：原「Agent 助手」弹窗的对话区，搬进传输助手右侧主聊天区）。
 *
 * v26.10.12-v3 两处改动（用户要求「设备菜单和 agent 菜单下的对话主区域使用相同的样式」）：
 *   · 第三栏**不再有页签**：显示什么由第二栏的两个控件（技能 / 定时任务）决定 ——
 *     状态提在 `TransferAssistantModal`（`pane` 属性），本组件只按值渲染；
 *   · 对话 pane 的排版与设备会话**完全共用** ChatHeader / ChatScroll / ChatBubble / ChatComposer
 *     （气泡左右分栏 + 头像、底部吸附输入框、Enter 发送 / Shift+Enter 换行 …）。
 * 输入框那两条实测结论（禁聚焦蓝框、高度稳定）跟着 ChatComposer 走，理由写在那边。
 */
export default function TransferAgentView({ agent, pane }: { agent: AgentChatController; pane: AgentPane }) {
    const { token } = theme.useToken();
    /** 技能 / 任务面板的数据版本：卸载技能、增删任务后 +1 触发重拉（与旧实现同一机制） */
    const [skillsVersion, setSkillsVersion] = useState(0);
    const [tasksVersion, setTasksVersion] = useState(0);

    const renderMessage = (message: UiMessage) => {
        const isUser = message.role === 'user';
        return (
            <ChatBubble
                key={message.key}
                side={isUser ? 'right' : 'left'}
                maxWidth="86%"
                avatar={isUser ? <UserIcon size={15} /> : <BotIcon size={15} />}>
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
                    // 两侧都按 Markdown 渲染（见 MarkdownBody 的注释）：用户消息里的单换行
                    // 由 remark-breaks 兜住；用户气泡是主色实心，走反色档保证链接/代码块可见
                    <MarkdownBody content={message.content} inverted={isUser} />
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
            </ChatBubble>
        );
    };

    const renderChat = () => {
        if (!agent.api) {
            return (
                <>
                    <ChatHeader left={<Typography.Text strong>Agents</Typography.Text>} />
                    <div style={{ padding: 12 }}>
                        <Alert
                            type="warning"
                            showIcon
                            icon={<BotIcon size={16} />}
                            message="Agent 功能不可用"
                            description={agent.availability.reason}
                        />
                    </div>
                </>
            );
        }
        return (
            <>
                <ChatHeader
                    left={
                        <>
                            <span
                                style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: 6,
                                    flex: '0 0 auto',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: '#4A4A4A',
                                    color: '#fff',
                                }}>
                                <BotIcon size={16} color="currentColor" />
                            </span>
                            <Typography.Text strong style={{ fontSize: 15 }} ellipsis>
                                {agent.activeChatId ? agentChatLabel(agent.chats, agent.activeChatId) : '新的聊天'}
                            </Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 11, flex: '0 0 auto' }}>
                                共 {agent.chats.length} 条对话
                            </Typography.Text>
                        </>
                    }
                />

                {agent.fatalError ? (
                    <div style={{ padding: '8px 12px 0' }}>
                        <Alert type="error" showIcon message={agent.fatalError} />
                    </div>
                ) : null}

                <ChatScroll className="znhd-agent-messages" scrollDep={agent.messages}>
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
                </ChatScroll>

                <ChatComposer
                    value={agent.input}
                    onChange={agent.setInput}
                    onSend={() => void agent.send()}
                    disabled={!agent.api}
                    streaming={agent.streaming}
                    onStop={agent.stopStreaming}
                    canSend={!!agent.input.trim()}
                    // 表情包是「图片」：Agent 通道只吃文本，故不传 onPickEmojiImage（按钮禁用），
                    // 说明与紧邻的「图片上传 / 附件」两个灰按钮保持一致
                    emojiDisabledReason="暂不支持：ScriptCat Agent 目前只接受文本"
                    placeholder={
                        agent.models.length
                            ? '输入问题，Enter 发送，Shift + Enter 换行'
                            : '还没在 ScriptCat 里配置模型：请先到 ScriptCat 的 Agent 设置里添加一个模型'
                    }
                    rightExtras={
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
                    }
                    actions={[
                        {
                            key: 'image',
                            label: '图片上传',
                            tooltip: '暂不支持：ScriptCat Agent 目前只接受文本',
                            icon: <ImageIcon size={15} />,
                            disabled: true,
                        },
                        {
                            key: 'file',
                            label: '附件',
                            tooltip: '暂不支持：ScriptCat Agent 目前只接受文本',
                            icon: <PaperclipIcon size={15} />,
                            disabled: true,
                        },
                    ]}
                />
            </>
        );
    };

    /** 技能 / 定时任务：第二栏点了控件才渲染到这里（第三栏顶部给个标题，避免「这是哪儿」） */
    const renderPanel = (kind: 'skills' | 'tasks') => {
        const title = kind === 'skills' ? '技能' : '定时任务';
        if (!agent.api) {
            return (
                <>
                    <ChatHeader left={<Typography.Text strong>{title}</Typography.Text>} />
                    <div style={{ padding: 12 }}>
                        <Alert
                            type="warning"
                            showIcon
                            message={title + '不可用'}
                            description={agent.availability.reason}
                        />
                    </div>
                </>
            );
        }
        return (
            <>
                <ChatHeader
                    left={
                        <Typography.Text strong style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            {kind === 'skills' ? <GridIcon size={15} /> : <ClockIcon size={15} />}
                            {title}
                        </Typography.Text>
                    }
                    right={
                        <Typography.Text type="secondary" style={{ fontSize: 11, flex: '0 0 auto' }}>
                            {kind === 'skills'
                                ? '对话时已启用的技能会自动加载，不必逐个勾选'
                                : '由 ScriptCat 调度器在后台执行，关掉网页也照跑'}
                        </Typography.Text>
                    }
                />
                <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: 12 }}>
                    {kind === 'skills' ? (
                        <SkillsPanel
                            api={agent.api}
                            version={skillsVersion}
                            onChange={() => setSkillsVersion((v) => v + 1)}
                        />
                    ) : (
                        <TaskPanel
                            api={agent.api}
                            version={tasksVersion}
                            onChange={() => setTasksVersion((v) => v + 1)}
                        />
                    )}
                </div>
            </>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>
            {pane === 'chat' ? renderChat() : null}
            {pane === 'skills' ? renderPanel('skills') : null}
            {pane === 'tasks' ? renderPanel('tasks') : null}
        </div>
    );
}
