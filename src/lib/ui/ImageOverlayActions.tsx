/**
 * 图片右下角的悬浮功能按钮条（v26.10.10-v16 新增）。
 *
 * ── 它解决什么问题 ─────────────────────────────────────────────────────────
 * 历史记录窗口与图片嗅探窗口原先把「复制 / 下载 / 删除」等按钮**排在图片下方**，
 * 每个格子要占掉一行按钮的高度，图片本身被压得很小。用户要求（v26.10.10-v16）：
 * 按钮挪到**图片内部右下角**、**只显示图标不显示文字**、**鼠标移到图片上才出现**、
 * hover 时才用 tooltip 显示文字。
 *
 * ── 为什么用 state 而不是 CSS `:hover` ──────────────────────────────────────
 * 宿主税务页有自己的样式表，我们不想为了这个悬浮效果往页面里注入全局 CSS 规则
 * （`:hover` 只能靠样式表实现）。这里沿用 `AgentModal.tsx` 侧栏「hover 才出现的删除图标」
 * 的既有做法：`onMouseEnter/onMouseLeave` 改 React state，样式全部内联。
 *
 * ── 为什么隐藏时按钮仍留在 DOM 里 ───────────────────────────────────────────
 * 隐藏只改 `opacity / visibility / pointerEvents`，**不卸载按钮**：
 * ① 冒烟夹具（`scripts/smoke/znhd-smoke.html`）是按 `button[aria-label="复制"]` 找按钮再
 *    程序化 `.click()` 的，元素被卸载就找不到（`visibility: hidden` 不影响 `.click()` 派发）；
 * ② 读屏/键盘用户仍能 Tab 到这些按钮。
 *
 * ── 无障碍 ─────────────────────────────────────────────────────────────────
 * 按钮内没有文字，语义**只由 `aria-label` 承担**（读屏靠它，冒烟测试也按它定位）。
 * tooltip 文案与 `aria-label` 用同一个 `label`，两者不会漂移。
 */

import { useState, type ReactNode } from 'react';
import { Button, Tooltip } from 'antd';

export interface ImageOverlayAction {
    /** 无障碍名（按钮内不再显示文字，读屏与冒烟测试都靠它定位）；默认也用作 hover 提示文案 */
    label: string;
    /**
     * hover 提示文案，默认取 `label`。
     * 需要「文案随状态变、但 `aria-label` 保持不变」时用它（如复制按钮的 复制中…/已复制/复制失败）。
     */
    tooltip?: string;
    /** 图标（本仓库 `icons.tsx` 的内联 SVG，保持 24×24 / stroke 2 规格） */
    icon: ReactNode;
    onClick: () => void;
    /** 删除这类破坏性动作：图标标红 */
    danger?: boolean;
    /** 动作进行中（下载等）：交给 antd Button 显示转圈 */
    loading?: boolean;
}

export interface ImageOverlayActionsProps {
    /** 图片本体：hover 判定挂在包住它的外层 div 上，按钮压在它右下角 */
    children: ReactNode;
    actions: ImageOverlayAction[];
}

export default function ImageOverlayActions({ children, actions }: ImageOverlayActionsProps) {
    const [hover, setHover] = useState(false);

    return (
        <div
            className="znhd-img-hover"
            style={{ position: 'relative', width: '100%', minWidth: 0 }}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}>
            {children}
            <div
                className="znhd-img-actions"
                style={{
                    position: 'absolute',
                    right: 6,
                    bottom: 6,
                    display: 'flex',
                    gap: 2,
                    padding: 2,
                    borderRadius: 6,
                    // 半透明黑底：图片本身深浅不定，没有底衬时白色图标会看不清
                    background: 'rgba(0, 0, 0, 0.55)',
                    zIndex: 2,
                    opacity: hover ? 1 : 0,
                    visibility: hover ? 'visible' : 'hidden',
                    // 隐藏时不吃鼠标事件，避免挡住图片本身的点击（antd Image 点开预览）
                    pointerEvents: hover ? 'auto' : 'none',
                    transition: 'opacity 0.15s',
                }}>
                {actions.map((a) => (
                    <Tooltip key={a.label} title={a.tooltip ?? a.label}>
                        <Button
                            size="small"
                            type="text"
                            aria-label={a.label}
                            loading={a.loading}
                            onClick={a.onClick}
                            style={{
                                color: a.danger ? '#ff7875' : '#fff',
                                padding: 0,
                                width: 22,
                                height: 22,
                            }}>
                            {a.icon}
                        </Button>
                    </Tooltip>
                ))}
            </div>
        </div>
    );
}
