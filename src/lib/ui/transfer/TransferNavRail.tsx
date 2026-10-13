import { useState, type ReactElement } from 'react';
import { Tooltip, theme } from 'antd';
import { RADIUS, WECHAT } from '@/lib/ui/transfer/wechatTheme';
import { FilesIcon, InfoIcon, MessageIcon, SettingsIcon, TransferIcon, type IconProps } from '@/lib/ui/icons';

export type TransferNav = 'devices' | 'files';

/** 第一栏宽度：微信式窄侧边栏（只放图标，不可折叠 —— 折叠开关随宽栏一起移除） */
export const NAV_WIDTH = 58;

/**
 * 第一栏导航项（v26.10.12-v4 改微信式窄栏）。
 *
 * 顺序与命名（用户要求）：**「设备」改名「对话」并置于最上**，文件随后。
 * 注意 key 保持 `devices` 不变 —— store / 自动弹窗 / 冒烟夹具都按 key 路由，改 key 是纯风险。
 *
 * ⚠️ v26.10.13-v9：中间的 **Agents 入口（含 `BotIcon`）已随 Agent 能力整体删除**，
 * 第一栏现在只有「对话 / 文件」两个入口。
 */
const NAV_ITEMS: Array<{ key: TransferNav; label: string; icon: (p: IconProps) => ReactElement }> = [
    { key: 'devices', label: '对话', icon: MessageIcon },
    { key: 'files', label: '文件', icon: FilesIcon },
];

/**
 * 微信规范的图标按钮三态（v26.10.12-v5，用户给的交互规格逐条实现）：
 *
 *   · 默认：白色描边线条图标、背景透明、无底色；
 *   · hover（**仅未选中项**）：外层加一块深色圆角方形底板（带轻微浮起阴影），图标本身不变；
 *   · 选中：图标变成微信绿（填充色变化），**不叠加圆角方形底板**；
 *   · 选中优先于 hover：已选中的按钮悬浮只有绿色图标，不出底板；
 *   · 右上角红色圆形未读角标保留（角标不受三态影响）。
 *
 * hover 用 React state 而不是 :hover 伪类 —— 冒烟要用「派发 mouseover → 稍后采样」的两拍
 * 方式量底色（React setState 异步，同帧读不到新值），伪类没法这样测。
 */
function NavIconButton({
    label,
    icon,
    onClick,
    active,
    badge,
}: {
    label: string;
    icon: ReactElement;
    onClick: () => void;
    active?: boolean;
    badge?: number;
}) {
    const { token } = theme.useToken();
    const [hovered, setHovered] = useState(false);
    const isActive = !!active;
    const plate = !isActive && hovered; // 选中优先于 hover：选中项永远不出底板
    const count = badge || 0;
    return (
        <Tooltip title={label} placement="right">
            <button
                type="button"
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                onClick={onClick}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
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
                    borderRadius: 10,
                    background: plate ? WECHAT.navHoverPlate : 'transparent',
                    boxShadow: plate ? '0 2px 8px rgba(0, 0, 0, 0.35)' : 'none',
                    cursor: 'pointer',
                    color: isActive ? token.colorPrimary : 'rgba(255, 255, 255, 0.9)',
                }}>
                {icon}
                {count > 0 ? (
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
                        {count > 99 ? '99+' : count}
                    </span>
                ) : null}
            </button>
        </Tooltip>
    );
}

/**
 * 第一栏（最左侧窄导航栏，v26.10.12-v4 微信桌面版样式；v26.10.13-v10 圆角 + 层级）。
 *
 * 结构：顶部 logo（头像位）→ 中部图标入口（对话 / 文件，只放图标不显示文字）
 * → 底部设置 / 企业信息。未读总数在「对话」图标右上角挂红色角标（微信同款位置）。
 *
 * v26.10.13-v10：本栏**贴满窗口高度**（不随第二三栏的内嵌圆角卡片一起内缩），
 * 外框左上 / 左下两个大圆角由窗口容器的 overflow:hidden 裁出来；logo 加大到
 * 36px 方坯 + 10px 圆角（对齐用户 excalidraw 白板稿的头像位）。
 *
 * 原「外观设置」入口已随窗口固定微信暗色一起移除（见 wechatTheme.ts 头注）；
 * 原中间的 Agents 入口已随 Agent 能力删除（v26.10.13-v9）。
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
            {/* 顶部：logo（微信这里是用户头像位；v26.10.13-v10 加大到 36px 方坯 + 10 圆角） */}
            <span
                title="传输助手"
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: RADIUS.control + 2,
                    background: token.colorPrimary,
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flex: '0 0 auto',
                    marginBottom: 14,
                }}>
                <TransferIcon size={20} color="#fff" />
            </span>

            {/* 中部入口（对话在最上，其次文件） */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                        <NavIconButton
                            key={item.key}
                            label={item.label}
                            icon={<Icon size={20} color="currentColor" />}
                            onClick={() => onNav(item.key)}
                            active={nav === item.key}
                            badge={item.key === 'devices' ? unreadTotal : 0}
                        />
                    );
                })}
            </div>

            <span style={{ flex: '1 1 auto' }} />

            {/* 底部：设置 / 企业信息（原「外观设置」已随固定暗色移除） */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <NavIconButton
                    label="设置"
                    icon={<SettingsIcon size={19} color="currentColor" />}
                    onClick={onOpenSettings}
                />
                <NavIconButton
                    label="企业信息"
                    icon={<InfoIcon size={19} color="currentColor" />}
                    onClick={onOpenAbout}
                />
            </div>
        </div>
    );
}
