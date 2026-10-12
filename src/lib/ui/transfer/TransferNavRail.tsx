import type { ReactElement } from 'react';
import { Tooltip, theme } from 'antd';
import { WECHAT } from '@/lib/ui/transfer/wechatTheme';
import { BotIcon, FilesIcon, InfoIcon, MessageIcon, SettingsIcon, TransferIcon, type IconProps } from '@/lib/ui/icons';

export type TransferNav = 'agents' | 'devices' | 'files';

/** 第一栏宽度：微信式窄侧边栏（只放图标，不可折叠 —— 折叠开关随宽栏一起移除） */
export const NAV_WIDTH = 58;

/**
 * 第一栏导航项（v26.10.12-v4 改微信式窄栏）。
 *
 * 顺序与命名（用户要求）：**「设备」改名「对话」并置于 Agents 之上**，文件随后。
 * 注意 key 保持 `devices` 不变 —— store / 自动弹窗 / 冒烟夹具都按 key 路由，改 key 是纯风险。
 */
const NAV_ITEMS: Array<{ key: TransferNav; label: string; icon: (p: IconProps) => ReactElement }> = [
    { key: 'devices', label: '对话', icon: MessageIcon },
    { key: 'agents', label: 'Agents', icon: BotIcon },
    { key: 'files', label: '文件', icon: FilesIcon },
];

/**
 * 第一栏（最左侧窄导航栏，v26.10.12-v4 微信桌面版样式）。
 *
 * 结构：顶部 logo（头像位）→ 中部图标入口（对话 / Agents / 文件，只放图标不显示文字）
 * → 底部设置 / 企业信息。未读总数在「对话」图标右上角挂红色角标（微信同款位置）。
 * 选中态 = 图标变主色（微信绿）；悬停有 Tooltip（placement right）。
 *
 * 原「外观设置」入口已随窗口固定微信暗色一起移除（见 wechatTheme.ts 头注）。
 */
export default function TransferNavRail({
    nav,
    onNav,
    onOpenSettings,
    onOpenAbout,
    unreadTotal,
}: {
    nav: TransferNav;
    onNav: (nav: TransferNav) => void;
    onOpenSettings: () => void;
    onOpenAbout: () => void;
    unreadTotal: number;
}) {
    const { token } = theme.useToken();

    /** 一个纯图标导航按钮（微信式：48px 见方热区，选中变主色，右上角可挂红色角标） */
    const iconButton = (
        label: string,
        icon: ReactElement,
        onClick: () => void,
        opts?: { active?: boolean; badge?: number }
    ) => {
        const active = !!opts?.active;
        const badge = opts?.badge || 0;
        return (
            <Tooltip title={label} placement="right">
                <button
                    type="button"
                    aria-label={label}
                    onClick={onClick}
                    style={{
                        position: 'relative',
                        width: 40,
                        height: 40,
                        margin: '0 auto',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: 'none',
                        borderRadius: 8,
                        background: 'transparent',
                        cursor: 'pointer',
                        color: active ? token.colorPrimary : 'rgba(255,255,255,0.55)',
                        // 选中态给一个浅色底（微信暗色下是比栏底略浅的一块），比纯变色更可辨
                        boxShadow: active ? 'inset 0 0 0 100px rgba(255,255,255,0.08)' : 'none',
                    }}>
                    {icon}
                    {badge > 0 ? (
                        <span
                            style={{
                                position: 'absolute',
                                top: 2,
                                right: 2,
                                minWidth: 15,
                                height: 15,
                                padding: '0 4px',
                                borderRadius: 9,
                                background: '#FA5151',
                                color: '#fff',
                                fontSize: 10,
                                lineHeight: '15px',
                                textAlign: 'center',
                                fontWeight: 600,
                            }}>
                            {badge > 99 ? '99+' : badge}
                        </span>
                    ) : null}
                </button>
            </Tooltip>
        );
    };

    return (
        <div
            className="znhd-transfer-nav"
            style={{
                flex: '0 0 auto',
                width: NAV_WIDTH,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '10px 0 8px',
                background: WECHAT.rail,
            }}>
            {/* 顶部：logo（微信这里是用户头像位） */}
            <span
                title="传输助手"
                style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: token.colorPrimary,
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: '0 0 auto',
                    marginBottom: 14,
                }}>
                <TransferIcon size={18} color="#fff" />
            </span>

            {/* 中部入口（对话在最上，其次 Agents、文件） */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                        <span key={item.key}>
                            {iconButton(item.label, <Icon size={20} color="currentColor" />, () => onNav(item.key), {
                                active: nav === item.key,
                                badge: item.key === 'devices' ? unreadTotal : 0,
                            })}
                        </span>
                    );
                })}
            </div>

            <span style={{ flex: '1 1 auto' }} />

            {/* 底部：设置 / 企业信息（原「外观设置」已随固定暗色移除） */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {iconButton('设置', <SettingsIcon size={19} color="currentColor" />, onOpenSettings)}
                {iconButton('企业信息', <InfoIcon size={19} color="currentColor" />, onOpenAbout)}
            </div>
        </div>
    );
}
