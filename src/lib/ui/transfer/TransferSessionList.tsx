import { Button, Input, Tooltip } from 'antd';
import { theme } from 'antd';
import { GridIcon, PlusIcon, SearchIcon, SmartphoneIcon } from '@/lib/ui/icons';
import { RADIUS, WECHAT } from '@/lib/ui/transfer/wechatTheme';
import type { TransferMessage } from '@/lib/transfer/types';
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
    if (msg.type === 'image') return '[图片]';
    // v26.10.14-v6：文件预览带文件名（纯 [文件] 看不出是哪个，用户在列表里选会话时没有信息量）
    if (msg.type === 'file') return '[文件] ' + (msg.name || '');
    return (msg.text || '').replace(/\s+/g, ' ').slice(0, 40);
}

/** 列表里的时间（今天 HH:mm，昨天加「昨天」，否则 MM-DD） */
function listTime(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const dayOf = (x: Date) => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (dayOf(d) === dayOf(now)) return hm;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayOf(d) === dayOf(yesterday)) return '昨天 ' + hm;
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * 第二栏（中间会话列表栏，v26.10.12-v1；v26.10.12-v4 微信化；v26.10.13-v10 圆角化）。
 *
 * 结构：顶部**搜索框 +「＋」按钮**（仅对话分组有；文件分组没有 —— 用户要求
 * 文件下不放任何新建入口），下方按第一栏当前分组显示会话列表。
 * 「＋」的含义：对话分组 →「配对设备」。
 *
 * 会话条目为微信结构：左头像 / 中名称 + 预览摘要 / 右时间 + 未读红点角标；
 * 选中条目用比栏底浅一档的底色高亮（#383838，微信暗色同款），不再用主色底。
 *
 * v26.10.13-v10（对齐用户 excalidraw 白板稿）：搜索框 /「＋」/ 会话条目 / 头像
 * 统一 8px 圆角（`RADIUS.control`），「＋」改成与搜索框同款的圆角方块（同底同高）。
 *
 * 文件分组（v26.10.13-v5）：条目**可点 = 筛选第三栏的文件视图**（点哪个会话就只显示
 * 哪个会话的文件，不跳去聊天窗口 —— v26.10.12-v5「只作展示」的行为由此取代）；
 * 列表最顶上常驻一条「全部文件」，点了回到跨会话汇总。
 *
 * ⚠️ v26.10.13-v9：原 Agents 分组（技能 / 定时任务控件 + Agent 会话列表）已随 Agent 能力删除。
 */
export default function TransferSessionList({
    nav,
    search,
    onSearch,
    onPair,
    deviceEntries,
    activeSessionKey,
    onSelectSession,
    filesActiveKey,
    onSelectFilesSession,
}: {
    nav: TransferNav;
    search: string;
    onSearch: (value: string) => void;
    onPair: () => void;
    deviceEntries: DeviceEntry[];
    activeSessionKey: string;
    onSelectSession: (key: string) => void;
    /** 文件分组：当前文件视图正筛选哪个会话（'' = 全部文件） */
    filesActiveKey?: string;
    /** 文件分组：点击会话条目 = 筛选文件视图（不传则条目退回纯展示） */
    onSelectFilesSession?: (key: string) => void;
}) {
    const { token } = theme.useToken();
    const isFiles = nav === 'files';
    /** 文件分组 + 父组件提供了筛选回调 ⇒ 条目可点（= 筛选第三栏文件视图） */
    const filesMode = isFiles && !!onSelectFilesSession;

    const keyword = search.trim().toLowerCase();
    const filtered = keyword
        ? deviceEntries.filter(
              (e) => e.label.toLowerCase().includes(keyword) || previewText(e.lastMsg).toLowerCase().includes(keyword)
          )
        : deviceEntries;

    return (
        <div
            className="znhd-transfer-sessions"
            style={{
                flex: '0 0 auto',
                width: 250,
                display: 'flex',
                flexDirection: 'column',
                background: WECHAT.list,
                minWidth: 0,
            }}>
            {/* 搜索框 +「＋」（对话=配对；文件分组没有「＋」） */}
            <div style={{ display: 'flex', gap: 6, padding: '10px 10px 8px' }}>
                <Input
                    allowClear
                    prefix={<SearchIcon size={14} color="rgba(255,255,255,0.35)" />}
                    placeholder="搜索"
                    value={search}
                    onChange={(e) => onSearch(e.target.value)}
                    style={{
                        background: WECHAT.chat,
                        borderRadius: RADIUS.control,
                    }}
                />
                {isFiles ? null : (
                    <Tooltip title="配对设备（手机扫码 / 打开链接即完成配对）">
                        <Button
                            type="text"
                            aria-label="配对设备"
                            onClick={onPair}
                            style={{
                                // v26.10.13-v10：与搜索框同款圆角方块（同底同高同圆角）
                                width: 32,
                                height: 32,
                                padding: 0,
                                background: WECHAT.chat,
                                borderRadius: RADIUS.control,
                                color: 'rgba(255,255,255,0.65)',
                            }}>
                            <PlusIcon size={16} />
                        </Button>
                    </Tooltip>
                )}
            </div>

            {/* 列表 */}
            <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '0 6px 10px' }}>
                {filtered.length ? (
                    <>
                        {/* 文件分组：常驻「全部文件」入口（回到跨会话汇总；data 钩子供冒烟定位） */}
                        {filesMode ? (
                            <div
                                key="__all_files__"
                                className="znhd-transfer-session-item"
                                data-all-files="1"
                                title="全部文件"
                                aria-label="全部文件"
                                onClick={() => onSelectFilesSession('')}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '9px 10px',
                                    borderRadius: RADIUS.control,
                                    cursor: 'pointer',
                                    background: filesActiveKey === '' ? WECHAT.selected : 'transparent',
                                }}
                                onMouseEnter={(ev) => {
                                    if (filesActiveKey !== '') ev.currentTarget.style.background = WECHAT.hover;
                                }}
                                onMouseLeave={(ev) => {
                                    if (filesActiveKey !== '') ev.currentTarget.style.background = 'transparent';
                                }}>
                                <span
                                    style={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: RADIUS.control,
                                        flex: '0 0 auto',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: WECHAT.bubblePeer,
                                        color: 'rgba(255,255,255,0.8)',
                                    }}>
                                    <GridIcon size={18} color="currentColor" />
                                </span>
                                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                                    <div
                                        style={{
                                            fontSize: 13,
                                            color: 'rgba(255,255,255,0.9)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                        }}>
                                        全部文件
                                    </div>
                                    <div
                                        style={{
                                            fontSize: 12,
                                            color: 'rgba(255,255,255,0.4)',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            marginTop: 1,
                                        }}>
                                        所有会话的图片、文件与文本
                                    </div>
                                </div>
                            </div>
                        ) : null}
                        {filtered.map((e) => {
                            // 文件分组：选中/点击都走「筛选文件视图」；其余分组照旧（选中会话 → 聊天）
                            const active = filesMode ? e.key === filesActiveKey : e.key === activeSessionKey;
                            const clickable = filesMode || !isFiles;
                            const pick = () => {
                                if (filesMode) onSelectFilesSession(e.key);
                                else onSelectSession(e.key);
                            };
                            return (
                                <div
                                    key={e.key}
                                    className="znhd-transfer-session-item"
                                    title={e.label}
                                    onClick={clickable ? pick : undefined}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        padding: '9px 10px',
                                        borderRadius: RADIUS.control,
                                        cursor: clickable ? 'pointer' : 'default',
                                        // 选中 = 比栏底浅一档（微信暗色同款）；悬停 = 中间档
                                        background: active ? WECHAT.selected : 'transparent',
                                    }}
                                    onMouseEnter={(ev) => {
                                        if (clickable && !active) ev.currentTarget.style.background = WECHAT.hover;
                                    }}
                                    onMouseLeave={(ev) => {
                                        if (clickable && !active) ev.currentTarget.style.background = 'transparent';
                                    }}>
                                    {/* 设备头像位：彩色圆 + 首字符（聚合会话用手机图标占位） */}
                                    <span
                                        style={{
                                            width: 36,
                                            height: 36,
                                            borderRadius: RADIUS.control,
                                            flex: '0 0 auto',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: e.isAggregate ? WECHAT.bubblePeer : token.colorPrimaryBg,
                                            color: e.isAggregate ? 'rgba(255,255,255,0.8)' : token.colorPrimary,
                                            fontSize: 14,
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
                                                    right: -2,
                                                    bottom: -2,
                                                    width: 9,
                                                    height: 9,
                                                    borderRadius: '50%',
                                                    background: '#52c41a',
                                                    border: '1.5px solid ' + WECHAT.list,
                                                }}
                                            />
                                        ) : null}
                                    </span>
                                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                                        <div
                                            style={{
                                                fontSize: 13,
                                                color: 'rgba(255,255,255,0.9)',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                            {e.label}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: 12,
                                                color: 'rgba(255,255,255,0.4)',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                marginTop: 1,
                                            }}>
                                            {e.lastMsg ? previewText(e.lastMsg) : e.online ? '在线' : '离线'}
                                        </div>
                                    </div>
                                    <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
                                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                                            {listTime(e.lastTs || 0)}
                                        </div>
                                        {e.unread > 0 ? (
                                            <div
                                                style={{
                                                    marginTop: 3,
                                                    marginLeft: 'auto',
                                                    background: '#FA5151',
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
                        })}
                    </>
                ) : (
                    <div
                        style={{
                            fontSize: 12,
                            color: 'rgba(255,255,255,0.35)',
                            padding: '12px 4px',
                            textAlign: 'center',
                        }}>
                        {keyword ? '没有匹配的会话 / 设备' : isFiles ? '暂无文件' : '暂无会话——点右上角 + 配对手机'}
                    </div>
                )}
            </div>
        </div>
    );
}
