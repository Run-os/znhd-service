/**
 * 弹窗与抽屉（v26.10.08-v14 起替代 antd Modal / Drawer）。
 *
 * ── 为什么用 Radix Dialog 打底 ─────────────────────────────────────────────
 * 焦点陷阱（Tab 不会跑到宿主页面的输入框里）、Esc 关闭、`role="dialog"` + `aria-modal`、
 * 打开时把焦点移进弹窗、关闭后归还 —— 这些自己写必漏其中一两项，而它们恰好是**注入别人页面**
 * 的场景里最要紧的（不然用户在弹窗里按 Tab 会把焦点送进税务页的表单）。
 *
 * ── 与 antd 版的关键行为差异（都已刻意对齐）────────────────────────────────
 *  1. **挂载到 documentElement**：`<Dialog.Portal container={getOverlayHost()}>`。
 *  2. **默认不锁背景滚动**：见 Overlay.tsx 里的说明（避免与宿主 body 打架）。
 *  3. **关闭时卸载内容**（Radix 默认行为，对应 antd 的 destroyOnHidden）：
 *     日志弹窗依赖「打开即滚到底」的回调 ref，内容在挂载那一刻才有 scrollHeight。
 *
 * ── 选择器钩子（data-* 而非类名）───────────────────────────────────────────
 * 冒烟测试（scripts/smoke/znhd-smoke.html）需要定位「弹窗本体 / 内容区 / 标题 / 关闭按钮 /
 * 遮罩」。Tailwind 的工具类名会被编译期 tree-shake 掉（写进 CSS，不进 DOM 属性），
 * 拿它们当契约太脆；故这里给各部件挂 `data-znhd-*` 属性作为**稳定契约**。
 * ⚠️ 这些属性是冒烟断言的依赖面，改名/删除会连带改测试，改之前先看 znhd-smoke.html。
 */

import type { ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Overlay } from './Overlay';
import { getOverlayHost, OVERLAY_ROOT_CLASS } from './zindex';
import { cn } from './cn';
import { Button } from './controls';

/** 关闭按钮（✕）：用原生 button，避免依赖 Radix 的 Close 组件带来的默认样式 */
function CloseButton({ onClose, label = '关闭' }: { onClose: () => void; label?: string }) {
    return (
        <button
            type="button"
            data-znhd-modal-close
            aria-label={label}
            title={label}
            onClick={onClose}
            className={cn(
                'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]',
                'text-ink-3 text-base leading-none transition-colors cursor-pointer',
                'hover:bg-ink-7 hover:text-ink-1'
            )}>
            ✕
        </button>
    );
}

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
    //    关掉后 `Root` 不再渲染隐藏层的交互上下文，浮层的挂载/关闭都会失灵
    //    （实测点面板按钮弹窗不开、抽屉也不出）。
    //    它带来的「Esc 只关自己」由 Radix 自己保证，无需我们接管。
    return (
        // ⚠️ 保留 Radix 的 modal 模式（v26.10.08-v14 实测结论）：
        //    它负责「同一时刻只有一个浮层可交互」—— 这正是我们要的。多个弹窗并存时
        //    后开的会接管交互，先开的只是**被盖住**（不是被禁用）；Radix 的模态层处理是正确的。
        //    真正踩过的坑是「页签点不动」，根因不在这里，见下方 Tabs 的说明。
        <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
            <RadixDialog.Portal container={getOverlayHost()}>
                <Overlay onMaskClick={maskClosable ? onClose : undefined} masked={showMask} className="flex items-center justify-center">
                    <RadixDialog.Content
                        data-znhd-modal="modal"
                        className={cn(
                            OVERLAY_ROOT_CLASS,
                            'relative flex max-h-[88vh] flex-col overflow-hidden rounded-[10px] bg-white',
                            'shadow-[0_8px_32px_rgb(0_0_0/0.2)] outline-none',
                            className
                        )}
                        style={{ width: `min(${width}px, calc(100vw - 32px))` }}>
                        {title ? (
                            <RadixDialog.Title
                                data-znhd-modal-title
                                className="shrink-0 border-b border-ink-6 px-4 py-3 text-[15px] font-semibold leading-6 text-ink-1">
                                {title}
                            </RadixDialog.Title>
                        ) : (
                            /* 无标题时仍要有一个 Title 供读屏软件识别（否则 Radix 会警告） */
                            <RadixDialog.Title className="sr-only">对话框</RadixDialog.Title>
                        )}

                        <div
                            data-znhd-modal-body
                            className={cn('min-h-0 flex-1 overflow-auto px-4 py-3 text-left', bodyClassName)}>
                            {children}
                        </div>

                        {footer ? (
                            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ink-6 px-4 py-2.5">
                                {footer}
                            </div>
                        ) : null}

                        <div className="absolute right-3 top-2.5">
                            <CloseButton onClose={onClose} />
                        </div>
                    </RadixDialog.Content>
                </Overlay>
            </RadixDialog.Portal>
        </RadixDialog.Root>
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
        // ⚠️ modal 模式的取舍同 Modal（见上）
        <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
            <RadixDialog.Portal container={getOverlayHost()}>
                <Overlay onMaskClick={onClose} className="flex justify-end">
                    <RadixDialog.Content
                        data-znhd-modal="drawer"
                        className={cn(
                            OVERLAY_ROOT_CLASS,
                            'relative flex h-full flex-col bg-white shadow-[-8px_0_32px_rgb(0_0_0/0.18)] outline-none',
                            className
                        )}
                        style={{ width: `min(${size}px, 100vw)` }}>
                        <div className="shrink-0 border-b border-ink-6 px-4 py-3 pr-10">
                            <RadixDialog.Title
                                data-znhd-modal-title
                                className="text-[15px] font-semibold leading-6 text-ink-1">
                                {title ?? '面板'}
                            </RadixDialog.Title>
                        </div>
                        <div
                            data-znhd-modal-body
                            className={cn('min-h-0 flex-1 overflow-auto px-4 py-3 text-left', bodyClassName)}>
                            {children}
                        </div>
                        {footer ? (
                            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-ink-6 px-4 py-2.5">
                                {footer}
                            </div>
                        ) : null}
                        <div className="absolute right-3 top-2.5">
                            <CloseButton onClose={onClose} />
                        </div>
                    </RadixDialog.Content>
                </Overlay>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}

/* ============================================================ confirm 便捷封装 */

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