import { useState } from 'react';
import { Button, Popconfirm } from 'antd';
import { theme } from 'antd';
import { TrashIcon } from '@/lib/ui/icons';
import { agentChatLabel } from '@/lib/agent/sessions';
import type { AgentChatSession } from '@/lib/agent/sessions';

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

/**
 * Agent 会话列表（v26.10.12-v1：从 AgentModal 左侧会话栏搬来，作为传输助手第二栏的
 * Agents 内容）。
 *
 * v26.10.12-v3 去掉列表顶部那个「新的聊天」按钮：用户要求把新建的入口并进**搜索框右侧的 ＋**
 * （`TransferSessionList` 里，Agents 分组下它是「新建对话」，设备分组下才是「配对设备」）——
 * 于是这里只剩「标题 + 一条条会话卡片（选中高亮、悬停出删除）」。
 *
 * ⚠️ 类名 `znhd-agent-chat-item` / `znhd-agent-chat-list` 是冒烟断言的定位符
 * （AGENT.md「历史踩坑索引」有记），勿改。
 */
export default function AgentConversationList({
    chats,
    activeChatId,
    onSwitch,
    onDelete,
}: {
    chats: AgentChatSession[];
    activeChatId: string;
    onSwitch: (id: string) => void;
    onDelete: (id: string) => void;
}) {
    const { token } = theme.useToken();
    /** 鼠标正悬停的会话卡片：删除图标只在悬停（或选中）时出现，用 state 而不是 CSS 类 */
    const [hoverChatId, setHoverChatId] = useState<string>('');

    const renderChatItem = (item: AgentChatSession) => {
        const active = item.id === activeChatId;
        return (
            <div
                key={item.id}
                className={'znhd-agent-chat-item' + (active ? ' znhd-agent-chat-item-active' : '')}
                title={agentChatLabel(chats, item.id)}
                onClick={() => onSwitch(item.id)}
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
                        onConfirm={() => void onDelete(item.id)}>
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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0, flex: '1 1 auto' }}>
            <div style={{ fontSize: 11, color: token.colorTextTertiary, padding: '0 2px' }}>对话</div>
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
}
