/**
 * 图片放大预览（v26.10.08-v14 起替代 antd `Image` / `Image.PreviewGroup`）。
 *
 * ── 为什么自己写而不用现成库 ───────────────────────────────────────────────
 * 替换前用的是 antd 的预览，它带来了两个**都很难在别处复现**的行为：
 *   ① 多图左右切换（`items` 是一组 URL）；② 工具栏里能塞自定义按钮（打印）。
 *   现成的轻量库（viewer.js / photo-swatch 等）要么带不上的依赖，要么自定义工具栏要动它们的内部结构
 *   （本仓库 v13 之前就用 Viewer.js，为「移动容器打断 CSS 过渡导致主图永不创建」踩过一整轮，见 CHANGELOG）。
 *   自己写反而最短：全屏遮罩 + 一张图 + 左右切换 + 缩放/旋转 + 底部工具栏，都是几十行。
 *
 * ── 层级与遮罩 ────────────────────────────────────────────────────────────
 *   · 预览必须**盖住触发它的那个弹窗**（如「历史记录」）⇒ 层级比 OVERLAY_Z 高（PREVIEW_Z）。
 *   · 预览打开期间，下层弹窗的遮罩**要压掉**（否则两层 0.45 叠加 = 0.6975，白底被压到灰度 77）。
 *     这一步由 `shared/preview/mask.ts` 在 `<html>` 上挂类完成，本文件只负责在开/关时调用它。
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';
import { OVERLAY_ROOT_CLASS, PREVIEW_Z } from './zindex';
import { useEscapeClose } from './Overlay';
import { setPreviewing } from '../preview/mask';

/** 预览里额外挂一个宿主 div 的 id（本模块自带 getPreviewHost，不依赖 shared/preview/host） */
const HOST_ID = '__znhd_preview_host__';

/**
 * 取得（必要时创建）预览浮层的宿主 div。
 *
 * ⚠️ 必须自己建一个挂在 documentElement 下的 div，**不能直接用 documentElement 本身**：
 *   税务页的 `body` 常被加 transform/filter 形成独立层叠上下文（见 panelHost.tsx 的完整记录），
 *   浮层一旦落在它里面就以 body 的盒子而非视口为包含块 ⇒ 图片与工具栏位置全错。
 *   而替换前实测 antd 的 `preview.getContainer` 传「返回 documentElement 的函数」**不生效**
 *   （仍挂 body），必须传一个真实存在的子元素。
 */
function getPreviewHost(): HTMLElement {
    let el = document.getElementById(HOST_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = HOST_ID;
        document.documentElement.appendChild(el);
    }
    return el;
}

/** 预览期间挂在 html 上的类名已移交给 shared/preview/mask.ts（PREVIEWING_CLASS），此处不再重复定义 */

export interface PreviewItem {
    /** 预览用的图片地址（原分辨率 objectURL，缩略图请另传 thumbnail） */
    url: string;
    /** 工具栏上「下载/打印」用的文件名（缺省用序号） */
    name?: string;
}

export interface ImagePreviewProps {
    /** 当前预览项的下标；-1 或 null 表示未打开 */
    index: number;
    items: PreviewItem[];
    onIndexChange: (next: number) => void;
    onClose: () => void;
    /**
     * 工具栏自定义按钮（在「关闭」左侧追加）。
     * 脚本端与手机页的「打印」都走这里（两端用的是同一个 `buildA4ImageNode`，见 shared/preview/print.ts）。
     */
    extraActions?: (item: PreviewItem, index: number) => ReactNode;
    /** 主图下方的一行说明（如「图片 2 / 7」） */
    caption?: (item: PreviewItem, index: number, total: number) => ReactNode;
}

/** 工具栏按钮：统一成一个胶囊内的圆形图标按钮 */
function ToolButton({
    label,
    onClick,
    children,
    disabled,
}: {
    label: string;
    onClick: () => void;
    children: ReactNode;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors cursor-pointer',
                'hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed'
            )}>
            {children}
        </button>
    );
}

/** 简单的线性图标集（避免为此引入图标库依赖） */
const ICONS = {
    close: (
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M1.5 1.5l11 11M12.5 1.5l-11 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    ),
    prev: (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M10 2L4 8l6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    ),
    next: (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M6 2l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    ),
    zoomIn: (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 11l4 4M7 4.8v4.4M4.8 7h4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    ),
    zoomOut: (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M11 11l4 4M4.8 7h4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
    ),
    rotate: (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
                d="M13 8a5 5 0 1 1-1.6-3.7M13 1.5V5h-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    ),
    printer: (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4.5 6V1.5h7V6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <rect x="2" y="6" width="12" height="5.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4.5 9.5h7v5h-7z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
    ),
};

/**
 * 缩略图网格 + 点击打开预览（对应 antd 的 `Image.PreviewGroup` 用法）。
 *
 * ⚠️ **缩略图不能用懒加载占位**而只给 alt：冒烟测试判定「放大后主图真的出来」的依据是
 *    「img 已解码（naturalWidth > 0）+ 有可见尺寸」，用 background-image 承载会丢掉这个判据，
 *    也让「点开是空白」这类问题更难排查。这里坚持用真实 `<img>`。
 */
export function ImagePreview({
    index,
    items,
    onIndexChange,
    onClose,
    extraActions,
    caption,
}: ImagePreviewProps) {
    const open = index >= 0 && index < items.length;
    /** 缩放倍率（1 = 适应窗口）；旋转角度（0/90/180/270） */
    const [zoom, setZoom] = useState(1);
    const [rot, setRot] = useState(0);

    const close = useCallback(() => {
        setZoom(1);
        setRot(0);
        onClose();
    }, [onClose]);

    const go = useCallback(
        (delta: number) => {
            if (!items.length) return;
            const next = (index + delta + items.length) % items.length;
            setZoom(1);
            setRot(0);
            onIndexChange(next);
        },
        [index, items.length, onIndexChange]
    );

    // 键盘：Esc 关闭，左右方向键切换，加减号缩放
    useEscapeClose(open, close);
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft') go(-1);
            else if (e.key === 'ArrowRight') go(1);
            else if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(4, z + 0.25));
            else if (e.key === '-') setZoom((z) => Math.max(0.5, z - 0.25));
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, go]);

    // 预览开/关 → 压掉或恢复下层遮罩（与 shared/preview/mask.ts 同一套类名；
    // 复用它导出的 setPreviewing，保证两端与遮罩规则永远是同一份）
    useEffect(() => {
        setPreviewing(open);
        return () => setPreviewing(false);
    }, [open]);

    if (!open) return null;
    const item = items[index];
    const multi = items.length > 1;

    return createPortal(
        <div
            className={cn(OVERLAY_ROOT_CLASS, 'fixed inset-0 flex flex-col items-center justify-center')}
            style={{ zIndex: PREVIEW_Z }}
            data-znhd-preview=""
            role="dialog"
            aria-modal="true"
            aria-label="图片预览">
            {/* 背景层：点击空白处关闭 */}
            <div className="absolute inset-0 bg-black/80" onClick={close} aria-hidden="true" />

            {/* 关闭按钮（右上角固定） */}
            <div className="absolute right-4 top-4 z-10">
                <ToolButton label="关闭预览" onClick={close}>
                    {ICONS.close}
                </ToolButton>
            </div>

            {/* 上一张/下一张 */}
            {multi ? (
                <>
                    <div className="absolute left-4 top-1/2 z-10 -translate-y-1/2">
                        <ToolButton label="上一张" onClick={() => go(-1)}>
                            {ICONS.prev}
                        </ToolButton>
                    </div>
                    <div className="absolute right-4 top-1/2 z-10 -translate-y-1/2">
                        <ToolButton label="下一张" onClick={() => go(1)}>
                            {ICONS.next}
                        </ToolButton>
                    </div>
                </>
            ) : null}

            {/* 主图：max-w/max-h 适应视口，缩放/旋转用 transform（不改变布局，故不会撑破遮罩） */}
            <img
                src={item.url}
                alt={item.name || '预览图片'}
                className="znhd-preview-img relative z-[1] max-w-[92vw] max-h-[82vh] select-none"
                style={{ transform: `scale(${zoom}) rotate(${rot}deg)`, transition: 'transform .12s ease-out' }}
                draggable={false}
            />

            {/* 工具栏胶囊 */}
            <div
                className={cn(
                    OVERLAY_ROOT_CLASS,
                    'absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1',
                    'rounded-full bg-black/55 px-2 py-1.5'
                )}>
                <ToolButton label="缩小" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} disabled={zoom <= 0.5}>
                    {ICONS.zoomOut}
                </ToolButton>
                <ToolButton label="放大" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} disabled={zoom >= 4}>
                    {ICONS.zoomIn}
                </ToolButton>
                <ToolButton
                    label="旋转"
                    onClick={() => setRot((r) => (r + 90) % 360)}
                    disabled={false}>
                    {ICONS.rotate}
                </ToolButton>
                {/* 自定义按钮区：脚本端与手机页的「打印」都挂在这里 */}
                {extraActions ? (
                    <div className="znhd-preview-actions flex items-center gap-1">
                        {extraActions(item, index)}
                    </div>
                ) : null}
                <ToolButton label="关闭预览" onClick={close}>
                    {ICONS.close}
                </ToolButton>
            </div>

            {/* 说明行 */}
            {caption ? (
                <div className="absolute bottom-[68px] left-1/2 z-10 -translate-x-1/2 text-[13px] text-white/85">
                    {caption(item, index, items.length)}
                </div>
            ) : null}
        </div>,
        getPreviewHost()
    );
}

/** 供两端复用「打印」按钮（图标在 preview 模块内，避免共享层反向依赖） */
export const PRINT_ICON = ICONS.printer;