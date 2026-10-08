/**
 * 基础控件：Button / Input / Textarea / Switch / Checkbox / Tag / Progress / Empty / Spinner / Divider。
 *
 * v26.10.09-v3 起：内部**全部改用 shadcn 组件**（`shared/ui/{button,input,...}.tsx`），
 * 但对外导出名与 `data-znhd-*` 钩子保持不变 —— 原因：
 *   · `src/lib/ui/` 下 9 个业务组件按这里的签名调用，改名要动约 3900 行；
 *   · 冒烟断言 41 项靠 `data-znhd-*` 钩子定位元素，钩子是刻意加的稳定契约。
 *
 * ── 为什么 Tag / Empty / Spinner / Divider 不直接换成 shadcn 同名件 ──────────
 *   · Tag → shadcn `Badge`：Tag 的 `color` 语义（blue/success/warning/danger）沿用替换前 antd 配色，
 *     与 Badge 的 variant 体系不一致，故保留 `Tag` 名但内部用 `Badge`；
 *   · Empty / Spinner：shadcn 有 `Empty`，但本仓库这两个还承担「日志区/加载中」的特定尺寸与文案，
 *     先保留自研实现 + 语义色，待业务组件改造时再换；
 *   · Divider → shadcn `Separator`：已直接换（语义一致）。
 */

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
// ⚠️ button.tsx 只导出 `Button` 与 `buttonVariants`（没有 ButtonProps 类型），
//    组件 props 类型用 ComponentProps 从官方组件推导，避免与官方源码耦合。
import { Button as ShadcnButton } from '#ui/button';
import { Input as ShadcnInput } from '#ui/input';
import { Textarea as ShadcnTextarea } from '#ui/textarea';
import { Switch as ShadcnSwitch } from '#ui/switch';
import { Checkbox as ShadcnCheckbox } from '#ui/checkbox';
import { Progress as ShadcnProgress } from '#ui/progress';
import { Separator as ShadcnSeparator } from '#ui/separator';
import { Badge as ShadcnBadge } from '#ui/badge';
import { cn } from '#ui/utils';

/* ============================================================ Button */

export type ButtonVariant = 'default' | 'primary' | 'dashed' | 'text' | 'link';
export type ButtonSize = 'small' | 'middle' | 'large';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    block?: boolean;
    loading?: boolean;
    danger?: boolean;
}

/**
 * 旧 variant 名 → shadcn variant 的映射。
 * ⚠️ `dashed`（虚线边框）是 antd 遗留语义，shadcn 没有对应 variant，用 className 补。
 */
const BTN_VARIANT: Record<ButtonVariant, React.ComponentProps<typeof ShadcnButton>['variant']> = {
    default: 'outline',
    primary: 'default',
    dashed: 'outline',
    text: 'ghost',
    link: 'link',
};

const BTN_SIZE: Record<ButtonSize, string> = {
    small: 'h-6 px-2 text-xs gap-1',
    middle: 'h-7 px-3 text-[13px] gap-1',
    large: 'h-8 px-3 text-[13px] gap-1',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    { variant = 'default', size = 'middle', block, loading, danger, className, children, disabled, ...rest },
    ref
) {
    return (
        <ShadcnButton
            ref={ref}
            type="button"
            variant={danger ? 'destructive' : BTN_VARIANT[variant]}
            disabled={disabled || loading}
            className={cn(BTN_SIZE[size], variant === 'dashed' && !danger && 'border-dashed', block && 'w-full', className)}
            {...rest}>
            {loading ? <Spinner className="shrink-0" size={size === 'large' ? 14 : 12} /> : null}
            {children}
        </ShadcnButton>
    );
});

/* ============================================================ Input */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
    invalid?: boolean;
}

/**
 * 受控输入框（内部走 shadcn `Input`）。
 *
 * ⚠️ 宿主页面常给 `input` 加边框/背景/内边距（特异性 0,0,1 级联不赢我们），
 *    故仍显式写全外观，并在 `uiReset` 里给 `.znhd-root input` 加带前缀的复位兜底。
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, invalid, ...rest }, ref) {
    return (
        <ShadcnInput
            ref={ref}
            aria-invalid={invalid || undefined}
            className={cn('h-7 text-[13px]', invalid && 'border-destructive', className)}
            {...rest}
        />
    );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
    { className, invalid, ...rest },
    ref
) {
    return (
        <ShadcnTextarea
            ref={ref}
            aria-invalid={invalid || undefined}
            className={cn('text-[13px]', invalid && 'border-destructive', className)}
            {...rest}
        />
    );
});

/* ============================================================ Switch */

export interface SwitchProps {
    checked: boolean;
    onChange: (next: boolean) => void;
    size?: 'small' | 'middle';
    disabled?: boolean;
    className?: string;
    'aria-label'?: string;
}

/**
 * 内部走 shadcn `Switch`（Radix 打底，键盘与无障碍语义由它提供）。
 *
 * ⚠️ `data-znhd-switch` 是冒烟断言的稳定钩子（替换前断言读的是 antd 的 ant-switch-checked）。
 *    `data-state` 由 Radix 自己维护，不必自己记一份。
 */
export function Switch({ checked, onChange, size = 'middle', disabled, className, ...rest }: SwitchProps) {
    return (
        <ShadcnSwitch
            checked={checked}
            disabled={disabled}
            onCheckedChange={onChange}
            data-znhd-switch=""
            // shadcn Switch 的 size 是 "sm" | "default"，尺寸由 data-size 驱动
            size={size === 'small' ? 'sm' : 'default'}
            className={className}
            {...rest}
        />
    );
}

/* ============================================================ Checkbox */

export interface CheckboxProps {
    checked: boolean;
    onChange: (next: boolean) => void;
    children?: React.ReactNode;
    className?: string;
    disabled?: boolean;
}

/** 单个勾选框；多选列表请用 `CheckboxGroup` */
export function Checkbox({ checked, onChange, children, className, disabled }: CheckboxProps) {
    return (
        <label
            className={cn(
                'inline-flex items-start gap-1.5 cursor-pointer select-none text-[13px]',
                disabled && 'cursor-not-allowed opacity-50',
                className
            )}>
            <ShadcnCheckbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(v) => onChange(v === true)}
                // ⚠️ data-znhd-checkbox 是冒烟断言的稳定钩子（替换前读的是 .ant-checkbox-input）
                data-znhd-checkbox=""
                className="mt-[2px]"
            />
            {children}
        </label>
    );
}

export interface CheckboxGroupProps {
    children: React.ReactNode;
    className?: string;
}

/**
 * 多个 Checkbox 的纵向排列容器。
 *
 * ⚠️ **它不持有勾选状态**（不接 value/onChange）：受控语义保持「父组件算好 checked 传进来」，
 *   每项自己 `onChange` 回抛。
 */
export function CheckboxGroup({ children, className }: CheckboxGroupProps) {
    return <div className={cn('flex flex-col gap-1', className)}>{children}</div>;
}

/* ============================================================ Tag */

export type TagColor = 'default' | 'blue' | 'success' | 'warning' | 'danger';

const TAG_COLOR: Record<TagColor, string> = {
    default: 'border-ink-5 bg-ink-8 text-ink-2',
    blue: 'border-brand-200 bg-brand-50 text-brand-600',
    success: 'border-success-200 bg-success-50 text-success-700',
    warning: 'border-warning-200 bg-warning-50 text-warning-700',
    danger: 'border-danger-200 bg-danger-50 text-danger-700',
};

export interface TagProps {
    children: React.ReactNode;
    color?: TagColor;
    className?: string;
    title?: string;
}

/** 内部走 shadcn `Badge`，但保留 antd 沿用的语义色（blue/success/warning/danger） */
export function Tag({ children, color = 'default', className, title }: TagProps) {
    return (
        <ShadcnBadge
            title={title}
            variant="outline"
            className={cn('rounded-[4px] px-1.5 text-xs leading-[18px] font-normal', TAG_COLOR[color], className)}>
            {children}
        </ShadcnBadge>
    );
}

/* ============================================================ Progress */

export interface ProgressProps {
    /** 0-100 */
    percent: number;
    /** 失败态：条变红（替换前 antd 的 status="exception"） */
    status?: 'normal' | 'exception';
    size?: 'small' | 'middle';
    className?: string;
}

export function Progress({ percent, status = 'normal', size = 'small', className }: ProgressProps) {
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    const h = size === 'small' ? 'h-1.5' : 'h-2.5';
    return (
        <ShadcnProgress
            value={p}
            className={cn(
                h,
                // ⚠️ shadcn Progress 的 Indicator 类名是硬编码的（没有 indicatorClassName 这类 prop），
                //    失败态只能靠子元素选择器改色。data-slot 是 shadcn 自己的稳定标记。
                status === 'exception' && '[&_[data-slot=progress-indicator]]:bg-destructive',
                className
            )}
        />
    );
}

/* ============================================================ Empty / Spinner / Divider */

export function Empty({ description }: { description?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center py-6 text-muted-foreground text-[13px] gap-2">
            <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true" className="opacity-40">
                <rect x="5" y="11" width="38" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
                <circle cx="16" cy="21" r="3.5" fill="currentColor" opacity="0.5" />
                <path
                    d="M9 33l9-8 7 6 6-5 8 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                />
            </svg>
            {description ? <span>{description}</span> : null}
        </div>
    );
}

/** 旋转指示器（纯 CSS，不引依赖） */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
    return (
        <span
            role="status"
            aria-label="加载中"
            className={cn(
                'inline-block animate-spin rounded-full border-2 border-current border-r-transparent',
                className
            )}
            style={{ width: size, height: size }}
        />
    );
}

export interface DividerProps {
    children?: React.ReactNode;
    className?: string;
}

/**
 * 分割线；带 children 时为「文字居中的分割线」。
 * 内部走 shadcn `Separator`。
 */
export function Divider({ children, className }: DividerProps) {
    if (!children) return <ShadcnSeparator className={cn('my-2', className)} />;
    return (
        <div className={cn('flex items-center gap-2 my-2', className)}>
            <ShadcnSeparator className="flex-1" />
            <span className="text-muted-foreground text-xs">{children}</span>
            <ShadcnSeparator className="flex-1" />
        </div>
    );
}
