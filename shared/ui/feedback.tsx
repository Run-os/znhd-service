/**
 * Tooltip / Tabs / Toast。
 *
 * v26.10.09-v3 起：Tooltip 与 Tabs 内部改用 shadcn 组件（`shared/ui/tooltip.tsx`、`tabs.tsx`），
 * Toast 保持自研队列（shadcn 的 sonner 依赖外部 toast 库且自带全局容器，不适合注入宿主页）。
 * 对外导出名与 `data-znhd-*` 钩子保持不变 —— 冒烟断言 41 项靠它们定位元素。
 */

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
    Tooltip as ShadcnTooltip,
    TooltipContent as ShadcnTooltipContent,
    TooltipProvider as ShadcnTooltipProvider,
    TooltipTrigger as ShadcnTooltipTrigger,
} from '#ui/tooltip';
import { Tabs as ShadcnTabs, TabsContent as ShadcnTabsContent, TabsList, TabsTrigger } from '#ui/tabs';
import { cn } from '#ui/utils';
import { getOverlayHost, OVERLAY_Z, OVERLAY_ROOT_CLASS } from './zindex';

/* ============================================================ Tooltip */

export interface TooltipProps {
    /** 提示文案；空则不渲染（调用方可直接条件渲染整个 Tooltip） */
    content: ReactNode;
    children: ReactNode;
    /** 相对 OVERLAY_Z 的层级微调：Tooltip 常出现在按钮上，默认抬高一档避免被弹窗裁掉 */
    zIndex?: number;
    side?: 'top' | 'bottom' | 'left' | 'right';
    className?: string;
}

/**
 * 悬停提示（内部走 shadcn `Tooltip`，Radix 打底）。
 *
 * ⚠️ 用 Radix 而不是原生 title 属性：原生 title 延迟约 1s 且**无法自定义样式**，
 *    在深色浮层上还是浏览器默认的黄底黑字，与整体观感不符（需求：常用语按钮 hover 显示对应文本）。
 *
 * ⚠️ 每个 Tooltip 自带一个 `TooltipProvider`（delayDuration=200）：shadcn 官方建议在应用根包一次，
 *    但本仓库的 UI 是**注入到别人页面**的，没有统一的 React 根，只能就地包。
 */
export function Tooltip({ content, children, zIndex = 1, side = 'top', className }: TooltipProps) {
    if (content === null || content === undefined || content === '') return <>{children}</>;
    return (
        <ShadcnTooltipProvider delayDuration={200}>
            <ShadcnTooltip>
                <ShadcnTooltipTrigger asChild>{children}</ShadcnTooltipTrigger>
                <ShadcnTooltipContent
                    side={side}
                    sideOffset={6}
                    className={cn(
                        OVERLAY_ROOT_CLASS,
                        'max-w-[280px] break-words whitespace-pre-wrap px-2 py-1 text-xs leading-[18px]',
                        className
                    )}
                    style={{ zIndex: OVERLAY_Z + zIndex }}>
                    {content}
                </ShadcnTooltipContent>
            </ShadcnTooltip>
        </ShadcnTooltipProvider>
    );
}

/* ============================================================ Tabs */

export interface TabItem {
    key: string;
    label: ReactNode;
    content: ReactNode;
}

export interface TabsProps {
    items: TabItem[];
    value: string;
    onChange: (key: string) => void;
    className?: string;
}

/**
 * 受控页签（内部走 shadcn `Tabs`，Radix 打底）：键盘左右方向键切换、role="tablist/tab/tabpanel" 齐备。
 *
 * ⚠️ **坑（v26.10.08-v14 实测）**：浮层里同时开着两个弹窗时（如「收到文本」自动弹窗 +
 *    「历史记录」弹窗），Radix Dialog 的模态层会让**非最上层**的内容变成 `aria-hidden`，
 *    此时点页签**没有任何反应**（页签的 data-state 一直不变，看起来像「页签坏了」）。
 *    规避办法有两条，都在这里做了：
 *      ① `forceMount`：让两个页签的 content **始终在 DOM 里**，只靠 `hidden` 隐藏
 *         —— 于是断言/读内容不必依赖「当前恰好是激活态」，点击目标也一直存在；
 *      ② 由调用方保证「要操作哪个弹窗，就让它是最后打开的那个」。
 */
export function Tabs({ items, value, onChange, className }: TabsProps) {
    return (
        <ShadcnTabs value={value} onValueChange={onChange} className={cn('flex flex-col', className)}>
            <TabsList className="h-auto w-full justify-start gap-4 rounded-none border-b border-border bg-transparent p-0">
                {items.map((it) => (
                    <TabsTrigger
                        key={it.key}
                        value={it.key}
                        // ⚠️ data-znhd-tab 是冒烟断言的稳定钩子（替换前读的是 .ant-tabs-tab）
                        data-znhd-tab=""
                        className={cn(
                            'relative -mb-px rounded-none border-b-2 border-transparent bg-transparent px-0 pb-2 text-sm',
                            'cursor-pointer shadow-none transition-colors',
                            'data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none',
                            'data-[state=active]:font-medium data-[state=active]:bg-transparent'
                        )}>
                        {it.label}
                    </TabsTrigger>
                ))}
            </TabsList>
            {items.map((it) => (
                <ShadcnTabsContent
                    key={it.key}
                    value={it.key}
                    forceMount
                    data-znhd-tabpanel=""
                    // 非激活态用 hidden 隐藏（forceMount 下 Radix 不再自动加它）
                    className={cn('min-h-0 pt-3 outline-none', it.key === value ? 'block' : 'hidden')}>
                    {it.content}
                </ShadcnTabsContent>
            ))}
        </ShadcnTabs>
    );
}

/* ============================================================ Toast（替代 antd message） */

export type ToastLevel = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
    id: number;
    level: ToastLevel;
    text: string;
}

/** 悬浮提示队列（模块级状态：非组件模块如 storage.ts 也要能弹提示） */
let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<(v: ToastItem[]) => void>();

function emit() {
    const snapshot = items.slice();
    listeners.forEach((fn) => fn(snapshot));
}

/**
 * 弹一条提示。
 *
 * ⚠️ 替换前走 antd 的 `message` 实例（由 PanelApp 的 `App.useApp()` 注入桥接，见 notify.ts）。
 *    现在自持队列：省掉一个 provider 层级，也不必再让根组件注入实例
 *    —— 模块级代码可以直接调用，行为更直白。
 */
export function toast(level: ToastLevel, text: string, duration = 3000): void {
    if (typeof document === 'undefined') return;
    const id = ++seq;
    items = [...items, { id, level, text }].slice(-3);
    emit();
    window.setTimeout(() => {
        items = items.filter((t) => t.id !== id);
        emit();
    }, duration);
}

export const notify = {
    success: (msg: string) => toast('success', msg),
    error: (msg: string) => toast('error', msg),
    warning: (msg: string) => toast('warning', msg),
    info: (msg: string) => toast('info', msg),
};

const TOAST_STYLE: Record<ToastLevel, string> = {
    success: 'text-success-700',
    error: 'text-danger-600',
    warning: 'text-warning-700',
    info: 'text-brand-500',
};

/**
 * 提示宿主：挂在面板根组件里渲染一次即可。
 *
 * 挂在 documentElement 上（与其它浮层一致），且 `pointer-events-none` ——
 * 提示不该挡住用户继续操作面板（antd message 同样是纯展示）。
 */
export function ToastHost() {
    const [list, setList] = useState<ToastItem[]>(items);
    useEffect(() => {
        listeners.add(setList);
        return () => {
            listeners.delete(setList);
        };
    }, []);

    if (!list.length) return null;
    return createPortal(
        <div
            className={cn(OVERLAY_ROOT_CLASS, 'pointer-events-none fixed left-1/2 top-6 z-0 -translate-x-1/2')}
            style={{ zIndex: OVERLAY_Z + 20 }}
            role="status"
            aria-live="polite">
            <div className="flex flex-col items-center gap-1.5">
                {list.map((t) => (
                    <div
                        key={t.id}
                        className="max-w-[420px] rounded-[8px] border border-border bg-popover px-3 py-2 shadow-[0_4px_16px_rgb(0_0_0/0.16)]">
                        <span className={cn('text-[13px] leading-[20px] break-words', TOAST_STYLE[t.level])}>{t.text}</span>
                    </div>
                ))}
            </div>
        </div>,
        getOverlayHost()
    );
}
