import { useState, type ReactElement } from 'react';
import { Button, Popover, Segmented, Tooltip } from 'antd';
import { theme } from 'antd';
import {
    BotIcon,
    DeviceIcon,
    FilesIcon,
    InfoIcon,
    MoonIcon,
    PanelLeftIcon,
    SettingsIcon,
    SunIcon,
    TransferIcon,
    type IconProps,
} from '@/lib/ui/icons';
import type { TransferTheme } from '@/lib/transfer/types';

export type TransferNav = 'agents' | 'devices' | 'files';

/** 第一栏宽度：展开 / 折叠（企业微信式窄导航） */
export const NAV_WIDTH = 196;
export const NAV_WIDTH_COLLAPSED = 52;

/** 中部入口（Agents 固定最顶部，其余为传输助手相关的会话 / 设备分组） */
const NAV_ITEMS: Array<{ key: TransferNav; label: string; icon: (p: IconProps) => ReactElement }> = [
    { key: 'agents', label: 'Agents', icon: BotIcon },
    { key: 'devices', label: '设备', icon: DeviceIcon },
    { key: 'files', label: '文件', icon: FilesIcon },
];

/**
 * 第一栏（最左侧窄导航栏，v26.10.12-v1）。
 *
 * 结构（对齐企业微信桌面端）：顶部 logo + 折叠开关 → 中部入口列表
 * （**Agents 固定在最顶部**，支持整栏折叠 / 展开）→ 底部外观设置 / 设置 / 企业信息。
 *
 * 折叠后只剩图标（展开时显示完整入口）；未读总数在「设备」入口上挂小红点。
 */
export default function TransferNavRail({
    nav,
    onNav,
    collapsed,
    onToggleCollapsed,
    themeMode,
    onThemeMode,
    onOpenSettings,
    onOpenAbout,
    unreadTotal,
}: {
    nav: TransferNav;
    onNav: (nav: TransferNav) => void;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    themeMode: TransferTheme;
    onThemeMode: (theme: TransferTheme) => void;
    onOpenSettings: () => void;
    onOpenAbout: () => void;
    unreadTotal: number;
}) {
    const { token } = theme.useToken();
    const [appearanceOpen, setAppearanceOpen] = useState(false);

    const renderNavItem = (item: (typeof NAV_ITEMS)[number]) => {
        const active = nav === item.key;
        const Icon = item.icon;
        const btn = (
            <Button
                type="text"
                block
                aria-label={item.label}
                onClick={() => onNav(item.key)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    height: 38,
                    padding: collapsed ? '0 8px' : '0 10px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    borderRadius: 8,
                    background: active ? token.colorPrimaryBg : 'transparent',
                    color: active ? token.colorPrimary : token.colorText,
                    fontWeight: active ? 600 : 400,
                    fontSize: 13,
                }}>
                <Icon size={17} color="currentColor" />
                {collapsed ? null : (
                    <span style={{ minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>{item.label}</span>
                )}
                {!collapsed && item.key === 'devices' && unreadTotal > 0 ? (
                    <span
                        style={{
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
                        {unreadTotal > 99 ? '99+' : unreadTotal}
                    </span>
                ) : null}
                {collapsed && item.key === 'devices' && unreadTotal > 0 ? (
                    <span
                        style={{
                            position: 'absolute',
                            top: 4,
                            right: 6,
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: token.colorError,
                        }}
                    />
                ) : null}
            </Button>
        );
        return (
            <div key={item.key} style={{ position: 'relative', marginBottom: 2 }}>
                {collapsed ? (
                    <Tooltip title={item.label} placement="right">
                        {btn}
                    </Tooltip>
                ) : (
                    btn
                )}
            </div>
        );
    };

    const bottomItem = (label: string, icon: ReactElement, onClick: () => void, extra?: ReactElement) => {
        const btn = (
            <Button
                type="text"
                block
                aria-label={label}
                onClick={onClick}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    height: 36,
                    padding: collapsed ? '0 8px' : '0 10px',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    borderRadius: 8,
                    color: token.colorTextSecondary,
                    fontSize: 13,
                }}>
                {icon}
                {collapsed ? null : <span>{label}</span>}
                {extra}
            </Button>
        );
        return (
            <div key={label} style={{ marginBottom: 2 }}>
                {collapsed ? (
                    <Tooltip title={label} placement="right">
                        {btn}
                    </Tooltip>
                ) : (
                    btn
                )}
            </div>
        );
    };

    const appearance = (
        <Popover
            trigger="click"
            open={appearanceOpen}
            onOpenChange={setAppearanceOpen}
            placement="right"
            content={
                <div style={{ width: 180 }}>
                    <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8 }}>窗口外观</div>
                    <Segmented
                        block
                        value={themeMode}
                        onChange={(v) => onThemeMode(v as TransferTheme)}
                        options={[
                            { label: '浅色', value: 'light' },
                            { label: '深色', value: 'dark' },
                        ]}
                    />
                    <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 8 }}>
                        只影响传输助手窗口，与主面板设置无关。
                    </div>
                </div>
            }>
            {bottomItem(
                '外观设置',
                themeMode === 'dark' ? (
                    <MoonIcon size={17} color="currentColor" />
                ) : (
                    <SunIcon size={17} color="currentColor" />
                ),
                () => setAppearanceOpen((v) => !v)
            )}
        </Popover>
    );

    return (
        <div
            className="znhd-transfer-nav"
            style={{
                flex: '0 0 auto',
                width: collapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH,
                display: 'flex',
                flexDirection: 'column',
                padding: '10px 8px',
                borderRight: '1px solid ' + token.colorBorderSecondary,
                background: token.colorBgLayout,
                transition: 'width 0.15s',
            }}>
            {/* 顶部：logo + 折叠开关 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '0 2px' }}>
                <span
                    style={{
                        width: 30,
                        height: 30,
                        borderRadius: 8,
                        background: token.colorPrimary,
                        color: '#fff',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flex: '0 0 auto',
                    }}>
                    <TransferIcon size={17} color="#fff" />
                </span>
                {collapsed ? null : (
                    <span
                        style={{
                            fontSize: 15,
                            fontWeight: 700,
                            minWidth: 0,
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                        }}>
                        传输助手
                    </span>
                )}
                <span style={{ flex: '1 1 auto' }} />
                <Tooltip title={collapsed ? '展开导航栏' : '折叠导航栏'} placement="right">
                    <Button
                        type="text"
                        size="small"
                        aria-label={collapsed ? '展开导航栏' : '折叠导航栏'}
                        onClick={onToggleCollapsed}
                        style={{
                            padding: 4,
                            minWidth: 24,
                            color: token.colorTextTertiary,
                            transform: collapsed ? 'rotate(180deg)' : 'none',
                            transition: 'transform 0.15s',
                        }}>
                        <PanelLeftIcon size={16} color="currentColor" />
                    </Button>
                </Tooltip>
            </div>

            {/* 中部入口（Agents 固定最顶部） */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>{NAV_ITEMS.map(renderNavItem)}</div>

            <span style={{ flex: '1 1 auto' }} />

            {/* 底部：外观设置 / 设置 / 企业信息 */}
            <div style={{ borderTop: '1px solid ' + token.colorBorderSecondary, paddingTop: 8 }}>
                {appearance}
                {bottomItem('设置', <SettingsIcon size={17} color="currentColor" />, onOpenSettings)}
                {bottomItem('企业信息', <InfoIcon size={17} color="currentColor" />, onOpenAbout)}
            </div>
        </div>
    );
}
