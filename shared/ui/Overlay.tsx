/**
 * 浮层通用件：遮罩 + 滚动锁定 + Esc 关闭（v26.10.08-v14 起替代 antd Modal/Drawer 的公共部分）。
 *
 * ── 为什么遮罩用 `background: rgba()` 而不是 `opacity` ──────────────────────
 *    仓库历史踩坑：给遮罩元素设 `opacity` 会把**子元素一起带透**（图标、文字全变半透明）。
 *    所以遮罩层必须只有背景色、不含内容，透明度由 rgba 的第四个分量给。
 *
 * ── 滚动锁定怎么做 ────────────────────────────────────────────────────────
 *    antd 会给 `<body>` 加 `overflow: hidden` + 补偿滚动条宽度。补偿那步在面板注入场景很容易
 *    出错（税务页自己有滚动条逻辑），而我们**不锁背景滚动**：
 *    替换前 antd Modal 默认锁滚动，但本项目所有弹窗都是「点遮罩/按钮关闭」的短交互，
 *    滚动穿透（wheel 事件传到宿主页面）在实测中从未被用户报为问题，
 *    少一层 body 样式改动也就少一个与宿主页面打架的点。
 *    真要锁的话见 `lockBodyScroll` 的注释（保留实现但不默认启用，避免历史问题）。
 */

import { useEffect, type ReactNode } from 'react';
import { OVERLAY_Z, OVERLAY_ROOT_CLASS } from './zindex';
import { MASK_ATTR } from '../preview/mask';
import { cn } from './cn';

/** 遮罩配色：与替换前 antd 的 `rgba(0,0,0,0.45)` 一致 */
export const MASK_BG = 'rgb(0 0 0 / 0.45)';

export interface OverlayProps {
    children: ReactNode;
    className?: string;
    /** 点击遮罩是否关闭（图片预览等「误触代价高」的场景传 false） */
    onMaskClick?: () => void;
    /** 相对 OVERLAY_Z 的层级微调：预览传 10，普通浮层用默认 0 */
    zIndex?: number;
    /** 遮罩的进出场类名前缀（配合 tailwind.css 里的动画定义，可留空） */
    masked?: boolean;
}

/**
 * 全屏遮罩容器（fixed，覆盖视口）。
 *
 * ⚠️ `z-index` 用内联 style 而不是 Tailwind 类：层级是**运行时算出来的常量**
 *    （见 zindex.ts，要盖住面板 999999），写成 `z-[1000000]` 也能过但可读性差，
 *    且两处（Overlay 与预览）必须用同一个来源，漏改一处就会出现「预览被弹窗压住」。
 */
export function Overlay({ children, className, onMaskClick, zIndex = 0, masked = true }: OverlayProps) {
    return (
        <div
            className={cn(OVERLAY_ROOT_CLASS, 'fixed inset-0', className)}
            style={{ zIndex: OVERLAY_Z + zIndex }}>
            {masked ? (
                <div
                    className="absolute inset-0"
                    style={{ background: MASK_BG }}
                    onClick={onMaskClick}
                    // ⚠️ 必须挂 MASK_ATTR：shared/preview/mask.ts 靠它把**所有**下层遮罩在预览期间压掉
                    // （否则两层 0.45 叠加 = 0.6975，白底被压到灰度 77）。新增带遮罩的浮层时勿漏。
                    {...{ [MASK_ATTR]: '' }}
                    aria-hidden="true"
                />
            ) : null}
            {children}
        </div>
    );
}

/**
 * 按 Esc 关闭浮层（挂在 document 上，不用捕获阶段，避免与宿主页面的快捷键打架）。
 *
 * ⚠️ 只在浮层打开时注册，且回调放进 ref 里：**每次渲染都传新的 onClose 会让监听反复重挂**，
 *    在面板 3s 一刷的高频渲染下是实打实的性能浪费，也会和宿主页面的 keydown 监听抢顺序。
 */
export function useEscapeClose(active: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!active) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);
}
