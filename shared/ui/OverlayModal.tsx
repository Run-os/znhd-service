/**
 * 弹窗与抽屉（v26.10.09-v3 起改用 shadcn 的 Dialog / Sheet）。
 *
 * ── 为什么用 Radix Dialog 打底 ─────────────────────────────────────────────
 * 焦点陷阱（Tab 不会跑到宿主页面的输入框里）、Esc 关闭、`role="dialog"` + `aria-modal`、
 * 打开时把焦点移进弹窗、关闭后归还 —— 这些自己写必漏其中一两项，而它们恰好是**注入别人页面**
 * 的场景里最要紧的（不然用户在弹窗里按 Tab 会把焦点送进税务页的表单）。
 *
 * ── ⚠️ 唯一绕开官方封装的地方：`DialogContent` / `SheetContent` ──────────────
 * shadcn 的这两个组件**内部自己渲染 `<DialogPortal>` 且不传 container** ⇒ 挂到 `body`。
 * 而本项目必须挂 `documentElement`：税务页 body 常被加 transform/filter 形成独立层叠上下文，
 * 会把 fixed 浮层困在里面（仓库既有结论，见 zindex.ts）。
 * 故这里用 shadcn 导出的 `DialogPortal` + `DialogOverlay` + `DialogTitle` + `DialogClose`
 * 自行组合 —— **Portal 与 Overlay 都是官方部件**，只有 Content 用 Radix primitive
 * （shadcn 没单独导出无 Portal 的 Content）。这是 shadcn 官方支持的组合用法。
 *
 * ── 遮罩为什么用官方 `DialogOverlay` 而不是自绘 ─────────────────────────────
 * 背景色、`data-open/closed` 进出场动画都由官方给齐，这里只覆盖两处：
 *   · `zIndex`：本项目浮层要盖住 999999 的面板，官方 `z-50` 不够（见 zindex.ts）；
 *   · `MASK_ATTR`：`shared/preview/mask.ts` 靠它在预览期间压掉**所有**下层遮罩
 *     （否则两层 0.45 叠加 = 0.6975，白底被压到灰度 77）。
 *
 * ── 选择器钩子（data-* 而非类名）───────────────────────────────────────────
 * 冒烟测试需要定位「弹窗本体 / 内容区 / 标题 / 关闭按钮 / 遮罩」。
 * Tailwind 工具类名会被编译期 tree-shake（写进 CSS，不进 DOM 属性），拿它们当契约太脆；
 * 故这里给各部件挂 `data-znhd-*` 属性作为**稳定契约**。
 * ⚠️ 这些属性是冒烟断言的依赖面，改名/删除会连带改测试，改之前先看 znhd-smoke.html。
 */

import type { ReactNode } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Dialog as ShadcnDialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle } from '#ui/dialog';
// ⚠️ sheet.tsx 只导出 8 个部件（无 SheetPortal / SheetOverlay），而 Sheet 底层就是 Radix Dialog，
//    故 Drawer 的 Portal / Overlay 复用 dialog 的同名件，只有 Title 用 SheetTitle。
import { Sheet as ShadcnSheet, SheetTitle } from '#ui/sheet';
import { getOverlayHost, OVERLAY_ROOT_CLASS, OVERLAY_Z } from './zindex';
import { MASK_ATTR } from '../preview/mask';
import { cn } from '#ui/utils';
import { Button } from './controls';

/** 遮罩配色：与替换前 antd 的 `rgba(0,0,0,0.45)` 一致（官方默认是 bg-black/10，偏浅） */
const MASK_BG = 'rgb(0 0 0 / 0.45)';

/* ============================================================ Modal */

export interface ModalProps {
    open: boolean;
    onClose: () => void;
    title?: ReactNode;
    children?: ReactNode;
    /** 底部按钮区；不传则不渲染底栏 */
    footer?: ReactNode;
    /** 像素宽度（antd 的 width）；默认 520 */
    width?: number;
    /** 点击遮罩是否关闭，默认 true */
    maskClosable?: boolean;
    /**
     * 遮罩是否显示，默认 true。
     *
     * ⚠️ **「显示」而非「隐藏」**：预览是全屏浮层，它自己那层遮罩就够做背景了；
     *    本弹窗这层若还画着，会把画面多压暗一层（见 shared/preview/mask.ts 的完整推导）。
     *    注意本项目不在这里关它（antd 的 `mask={false}` 只是不可见、元素仍在 DOM，会被别的逻辑数到），
     *    而是统一交给 shared/preview/mask.ts 在 `<html>` 上挂类来压掉所有下层遮罩。
     */
    showMask?: boolean;
    className?: string;
    /** 面板内容区 className（默认 `text-left`，因宿主常有全局 text-align:center） */
    bodyClassName?: string;
}

export function Modal({
    open,
    onClose,
    title,
    children,
    footer,
    width = 520,
    maskClosable = true,
    showMask = true,
    className,
    bodyClassName,
}: ModalProps) {
    // ⚠️ Radix 的 modal 模式**必须保留**（v26.10.08-v14 试过关掉，结论是不行）：
    //    关掉后 `Root` 不再渲染隐藏层的交互上下文，浮层的挂载/关闭都会失灵。
    return (
        <ShadcnDialog open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogPortal container={getOverlayHost()}>
                {showMask ? (
                    <DialogOverlay
                        // ⚠️ 必须挂 MASK_ATTR：shared/preview/mask.ts 靠它把**所有**下层遮罩在预览期间压掉
                        {...{ [MASK_ATTR]: '' }}
                        className={cn(OVERLAY_ROOT_CLASS, 'bg-[var(--znhd-mask-bg)]')}
                        style={{ zIndex: OVERLAY_Z, background: MASK_BG }}
                    />
                ) : null}
                <DialogPrimitive.Content
                    data-znhd-modal="modal"
                    // 官方 Content 的定位是 fixed top-1/2 left-1/2；这里沿用官方，只覆盖圆角与阴影
                    className={cn(
                        OVERLAY_ROOT_CLASS,
                        'fixed top-1/2 left-1/2 z-50 flex max-h-[88vh] w-full -translate-x-1/2 -translate-y-1/2',
                        'flex-col gap-0 overflow-hidden rounded-xl bg-popover p-0 text-popover-foreground',
                        'shadow-[0_8px_32px_rgb(0_0_0/0.2)] ring-1 ring-foreground/10 outline-none',
                        className
                    )}
                    style={{ zIndex: OVERLAY_Z, width: `min(${width}px, calc(100vw - 32px))` }}
                    // 官方默认点遮罩即关闭；maskClosable=false 时用官方 API 阻止（不自己写 onClick）
                    onPointerDownOutside={(e) => {
                        if (!maskClosable) e.preventDefault();
                    }}>
                    {title ? (
                        <DialogTitle
                            data-znhd-modal-title
                            className="shrink-0 border-b border-border px-4 py-3 text-[15px] font-semibold leading-6">
                            {title}
                        </DialogTitle>
                    ) : (
                        /* 无标题时仍要有一个 Title 供读屏软件识别（否则 Radix 会警告） */
                        <DialogTitle className="sr-only">对话框</DialogTitle>
                    )}

                    <div
                        data-znhd-modal-body
                        className={cn('min-h-0 flex-1 overflow-auto px-4 py-3 text-left', bodyClassName)}>
                        {children}
                    </div>

                    {footer ? (
                        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-2.5">
                            {footer}
                        </div>
                    ) : null}

                    <div className="absolute right-3 top-2.5">
                        <CloseButton onClose={onClose} />
                    </div>
                </DialogPrimitive.Content>
            </DialogPortal>
        </ShadcnDialog>
    );
}

/* ============================================================ Drawer */

export interface DrawerProps {
    open: boolean;
    onClose: () => void;
    title?: ReactNode;
    children?: ReactNode;
    footer?: ReactNode;
    /** 抽屉宽度（像素）；antd v6 的 size={number} 对应此项 */
    size?: number;
    className?: string;
    bodyClassName?: string;
}

/**
 * 右侧抽屉（网页侧边栏习惯）。
 *
 * 为什么常用语这类长列表用 Drawer 而非 Modal：抽屉能用满整屏高度，
 * 且滑出时不遮挡右侧网页内容，更贴近「网页侧边栏」的用法。
 */
export function Drawer({
    open,
    onClose,
    title,
    children,
    footer,
    size = 360,
    className,
    bodyClassName,
}: DrawerProps) {
    return (
        <ShadcnSheet open={open} onOpenChange={(o) => !o && onClose()}>
            <DialogPortal container={getOverlayHost()}>
                <DialogOverlay
                    {...{ [MASK_ATTR]: '' }}
                    className={cn(OVERLAY_ROOT_CLASS)}
                    style={{ zIndex: OVERLAY_Z, background: MASK_BG }}
                />
                <DialogPrimitive.Content
                    data-znhd-modal="drawer"
                    className={cn(
                        OVERLAY_ROOT_CLASS,
                        'fixed inset-y-0 right-0 z-50 flex h-full flex-col gap-0 border-l bg-popover p-0',
                        'text-popover-foreground shadow-[-8px_0_32px_rgb(0_0_0/0.18)] outline-none',
                        className
                    )}
                    style={{ zIndex: OVERLAY_Z, width: `min(${size}px, 100vw)` }}>
                    <div className="shrink-0 border-b border-border px-4 py-3 pr-10">
                        <SheetTitle data-znhd-modal-title className="text-[15px] font-semibold leading-6">
                            {title ?? '面板'}
                        </SheetTitle>
                    </div>
                    <div
                        data-znhd-modal-body
                        className={cn('min-h-0 flex-1 overflow-auto px-4 py-3 text-left', bodyClassName)}>
                        {children}
                    </div>
                    {footer ? (
                        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-2.5">
                            {footer}
                        </div>
                    ) : null}
                    <div className="absolute right-3 top-2.5">
                        <CloseButton onClose={onClose} />
                    </div>
                </DialogPrimitive.Content>
            </DialogPortal>
        </ShadcnSheet>
    );
}

/* ============================================================ 关闭按钮 / confirm 便捷封装 */

/**
 * 关闭按钮（✕）。
 *
 * 用官方 `DialogClose` 承载（它提供 Radix 的关闭语义与 aria），
 * 挂 `data-znhd-modal-close` 钩子供冒烟断言定位。
 */
function CloseButton({ onClose, label = '关闭' }: { onClose: () => void; label?: string }) {
    return (
        <DialogClose
            data-znhd-modal-close
            aria-label={label}
            title={label}
            onClick={onClose}
            className={cn(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]',
                'text-muted-foreground text-base leading-none transition-colors cursor-pointer',
                'hover:bg-muted hover:text-foreground'
            )}>
            ✕
        </DialogClose>
    );
}

/**
 * 「确定/取消」两按钮弹窗 —— 替换前各弹窗的 footer 几乎都是这个组合。
 * 单独抽出来是为了让各调用点少写两遍，且间距/主次顺序不会各处写歪。
 */
export function ConfirmFooter({
    onCancel,
    onOk,
    okText = '确定',
    cancelText = '取消',
    okDisabled,
    danger,
    extra,
}: {
    onCancel: () => void;
    onOk: () => void;
    okText?: string;
    cancelText?: string;
    okDisabled?: boolean;
    danger?: boolean;
    /** 主按钮左侧的额外按钮（如「清空图片」） */
    extra?: ReactNode;
}) {
    return (
        <>
            {extra}
            <Button onClick={onCancel}>{cancelText}</Button>
            <Button variant={danger ? 'default' : 'primary'} danger={danger} disabled={okDisabled} onClick={onOk}>
                {okText}
            </Button>
        </>
    );
}
