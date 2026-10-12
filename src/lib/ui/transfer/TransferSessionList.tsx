import type { ReactNode } from 'react';
import { Button, Input, Tooltip } from 'antd';
import { theme } from 'antd';
import { ClockIcon, GridIcon, PlusIcon, SearchIcon, SmartphoneIcon } from '@/lib/ui/icons';
import AgentConversationList from '@/lib/ui/transfer/AgentConversationList';
import type { AgentChatController } from '@/lib/ui/transfer/useAgentChat';
import type { AgentPane, TransferMessage } from '@/lib/transfer/types';
import type { TransferNav } from '@/lib/ui/transfer/TransferNavRail';

/** 第二栏的一条设备会话（由父组件从 store 汇总） */
export interface DeviceEntry {
    key: string;
    /** 展示名（短 ID 或「手机」） */
    label: string;
    isAggregate: boolean;
    online: boolean;
    unread: number;
    lastTs: number;
    lastMsg?: TransferMessage;
    hasMessages: boolean;
}

/** 会话列表里对最后一条消息的预览文案 */
function previewText(msg?: TransferMessage): string {
    if (!msg) return '';
    if (msg.type === 'image') return '[图片] ' + (msg.name || '');
    return (msg.text || '').replace(/\s+/g, ' ').slice(0, 40);
}

/** 列表里的时间（今天 HH:mm，否则 MM-DD） */
function listTime(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const sameDay =
        d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    return sameDay ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * 第二栏（中间会话列表栏，v26.10.12-v1）。
 *
 * 结构（对齐企业微信桌面端）：顶部**搜索框 + 紧邻右侧的「＋」按钮**，下方按第一栏当前分组
 * 显示会话 / 设备列表。**「＋」的含义随分组变**（v26.10.12-v3，用户要求）：
 *   · 设备分组 → 「配对设备」（弹配对窗口）；
 *   · Agents 分组 → 「新建对话」（清空当前视图，发出下一条消息时另起一个对话）——
 *     直接把新建塞进搜索框旁边，不再让「＋」在 Agents 下复用设备的那套配对。
 *
 * Agents 分组下「＋」下面还有两个控件：**技能 / 定时任务**（v26.10.12-v3 从第三栏页签提上来），
 * 点哪个第三栏就显示哪个；再往下才是「对话」列表。
 */
export default function TransferSessionList({
    nav,
    search,
    onSearch,
    onPair,
    deviceEntries,
    activeSessionKey,
    onSelectSession,
    agent,
    agentPane,
    onAgentPane,
}: {
    nav: TransferNav;
    search: string;
    onSearch: (value: string) => void;
    onPair: () => void;
    deviceEntries: DeviceEntry[];
    activeSessionKey: string;
    onSelectSession: (key: string) => void;
    /** Agents 分组时的会话控制器（对话列表 + 新建 / 切换 / 删除） */
    agent?: AgentChatController;
    /** Agents 分组下第三栏正在显示哪一块（chat / skills / tasks） */
    agentPane?: AgentPane;
    onAgentPane?: (pane: AgentPane) => void;
}) {
    const { token } = theme.useToken();
    const isAgents = nav === 'agents';

    const keyword = search.trim().toLowerCase();
    const filtered = keyword
        ? deviceEntries.filter(
              (e) => e.label.toLowerCase().includes(keyword) || previewText(e.lastMsg).toLowerCase().includes(keyword)
          )
        : deviceEntries;

    /** Agents 分组下的「技能 / 定时任务」控件：选中态与第一栏导航同一套视觉 */
    const agentControl = (key: AgentPane, label: string, icon: ReactNode) => {
        const active = agentPane === key;
        return (
            <div key={key}>
                <Button
                    type="text"
                    block
                    aria-label={label}
                    onClick={() => onAgentPane && onAgentPane(key)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        height: 32,
                        justifyContent: 'flex-start',
                        padding: '0 8px',
                        borderRadius: 8,
                        fontSize: 13,
                        background: active ? token.colorPrimaryBg : 'transparent',
                        color: active ? token.colorPrimary : token.colorText,
                        fontWeight: active ? 600 : 400,
                    }}>
                    {icon}
                    <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>{label}</span>
                </Button>
            </div>
        );
    };

    return (
        <div
            className="znhd-transfer-sessions"
            style={{
                flex: '0 0 auto',
                width: 264,
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid ' + token.colorBorderSecondary,
                background: token.colorBgContainer,
                minWidth: 0,
            }}>
            {/* 搜索框 + 「＋」（设备=配对 / Agents=新建对话） */}
            <div style={{ display: 'flex', gap: 8, padding: 10 }}>
                <Input
                    allowClear
                    prefix={<SearchIcon size={14} color={token.colorTextQuaternary} />}
                    placeholder={isAgents ? '搜索对话' : '搜索会话 / 设备'}
                    value={search}
                    onChange={(e) => onSearch(e.target.value)}
                />
                {isAgents ? (
                    <Tooltip title="新建对话（清空当前视图，发出下一条消息时另起一个对话）">
                        <Button
                            color="primary"
                            variant="solid"
                            aria-label="新建对话"
                            onClick={() => {
                                if (onAgentPane) onAgentPane('chat');
                                if (agent) agent.newChat();
                            }}
                            style={{ width: 38, padding: 0 }}>
                            <PlusIcon size={14} />
                        </Button>
                    </Tooltip>
                ) : (
                    <Tooltip title="配对设备（手机扫码 / 打开链接即完成配对）">
                        <Button
                            color="primary"
                            variant="solid"
                            aria-label="配对设备"
                            onClick={onPair}
                            style={{ width: 38, padding: 0 }}>
                            <PlusIcon size={14} />
                        </Button>
                    </Tooltip>
                )}
            </div>

            {/* Agents 分组：技能 / 定时任务（点在第三栏显示） */}
            {isAgents ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px 6px' }}>
                    {agentControl('skills', '技能', <GridIcon size={15} color="currentColor" />)}
                    {agentControl('tasks', '定时任务', <ClockIcon size={15} color="currentColor" />)}
                </div>
            ) : null}

            {/* 列表 */}
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 8px 10px' }}>
                {isAgents && agent ? (
                    <AgentConversationList
                        chats={agent.chats}
                        activeChatId={agent.activeChatId}
                        onSwitch={(id) => {
                            // 从技能 / 定时任务页切回对话（点会话卡片就是「我要看这个对话」）
                            if (onAgentPane) onAgentPane('chat');
                            void agent.switchChat(id);
                        }}
                        onDelete={(id) => void agent.deleteChat(id)}
                    />
                ) : isAgents ? null : filtered.length ? (
                    filtered.map((e) => {
                        const active = e.key === activeSessionKey;
                        return (
                            <div
                                key={e.key}
                                className="znhd-transfer-session-item"
                                title={e.label}
                                onClick={() => onSelectSession(e.key)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    padding: '8px 10px',
                                    marginBottom: 2,
                                    borderRadius: 8,
                                    cursor: 'pointer',
                                    background: active ? token.colorPrimaryBg : 'transparent',
                                    border: '1px solid ' + (active ? token.colorPrimaryBorder : 'transparent'),
                                }}>
                                {/* 设备头像位：彩色圆 + 首字符（聚合会话用手机图标占位） */}
                                <span
                                    style={{
                                        width: 34,
                                        height: 34,
                                        borderRadius: 8,
                                        flex: '0 0 auto',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: e.isAggregate ? token.colorFillSecondary : token.colorPrimaryBg,
                                        color: e.isAggregate ? token.colorTextSecondary : token.colorPrimary,
                                        fontSize: 13,
                                        fontWeight: 600,
                                        position: 'relative',
                                    }}>
                                    {/* 聚合会话用手机图标（⚠️ 不用 emoji：Win7 无 Segoe UI Emoji ⇒ 豆腐块，v26.10.12-v1） */}
                                    {e.isAggregate ? (
                                        <SmartphoneIcon size={18} color="currentColor" />
                                    ) : (
                                        e.label.slice(0, 1).toUpperCase()
                                    )}
                                    {e.online ? (
                                        <span
                                            style={{
                                                position: 'absolute',
                                                right: -1,
                                                bottom: -1,
                                                width: 9,
                                                height: 9,
                                                borderRadius: '50%',
                                                background: '#52c41a',
                                                border: '1.5px solid ' + token.colorBgContainer,
                                            }}
                                        />
                                    ) : null}
                                </span>
                                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontSize: 13,
                                            fontWeight: active ? 600 : 400,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}>
                                        {e.label}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 11,
                                            color: token.colorTextTertiary,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}>
                                        {e.lastMsg ? previewText(e.lastMsg) : e.online ? '在线' : '离线'}
                                    </div>
                                </div>
                                <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                                    <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
                                        {listTime(e.lastTs || 0)}
                                    </div>
                                    {e.unread > 0 ? (
                                        <div
                                            style={{
                                                marginTop: 2,
                                                marginLeft: 'auto',
                                                background: token.colorError,
                                                color: '#fff',
                                                borderRadius: 9,
                                                fontSize: 11,
                                                lineHeight: '16px',
                                                padding: '0 5px',
                                                minWidth: 16,
                                                textAlign: 'center',
                                            }}>
                                            {e.unread > 99 ? '99+' : e.unread}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div
                        style={{
                            fontSize: 12,
                            color: token.colorTextTertiary,
                            padding: '12px 4px',
                            textAlign: 'center',
                        }}>
                        {keyword ? '没有匹配的会话 / 设备' : '暂无会话——点右上角 + 配对手机'}
                    </div>
                )}
            </div>
        </div>
    );
}
