/**
 * 基础控件：Button / Input / Textarea / Switch / Checkbox / Tag / Progress / Empty / Spinner / Divider。
 * v26.10.08-v14 起替代 antd 的同名组件。
 *
 * 为什么这几个要自己写而不用 Radix：
 *   · Button/Input/Tag/Empty/Spinner/Divider 是**纯样式**的，Radix 没有对应物，加进来只是多一层间接；
 *   · Switch / Checkbox 用 Radix（键盘交互/无障碍语义是真本事，自己写容易漏）；
 *   · Dialog / Tooltip / Tabs 用 Radix（焦点陷阱、Esc、方向键是真本事）。
 */

import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { cn } from './cn';

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

/** 各变体的类名集中在一处，改配色只改这张表 */
const BTN_VARIANT: Record<ButtonVariant, string> = {
    default: 'border border-ink-5 bg-white text-ink-1 hover:border-brand-400 hover:text-brand-500',
    primary: 'border border-brand-500 bg-brand-500 text-white hover:bg-brand-400 hover:border-brand-400',
    dashed: 'border border-dashed border-ink-5 bg-white text-ink-1 hover:border-brand-400 hover:text-brand-500',
    text: 'border border-transparent bg-transparent text-ink-2 hover:bg-ink-7 hover:text-ink-1',
    link: 'border border-transparent bg-transparent text-brand-500 hover:text-brand-400',
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
        <button
            ref={ref}
            type="button"
            disabled={disabled || loading}
            className={cn(
                'inline-flex items-center justify-center rounded-[6px] font-normal whitespace-nowrap',
                'transition-colors select-none cursor-pointer',
                'disabled:cursor-not-allowed disabled:opacity-50',
                BTN_SIZE[size],
                danger
                    ? 'border border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-200 hover:text-white hover:border-danger-200'
                    : BTN_VARIANT[variant],
                block && 'w-full',
                className
            )}
            {...rest}>
            {loading ? <Spinner className="shrink-0" size={size === 'large' ? 14 : 12} /> : null}
            {children}
        </button>
    );
});

/* ============================================================ Input */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
    invalid?: boolean;
}

/**
 * 受控输入框。
 *
 * ⚠️ 宿主页面常给 `input` 加边框/背景/内边距（特异性 0,0,1 级联不赢我们），因此这里
 *    用**完整的单类**写全外观（border/bg/px/py/rounded 都在一个 class 里），
 *    并且在 `uiReset` 里给 `.znhd-root input` 加一条带前缀的复位兜底。
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
    { className, invalid, ...rest },
    ref
) {
    return (
        <input
            ref={ref}
            className={cn(
                'w-full h-7 px-2 rounded-[6px] border bg-white text-[13px] text-ink-1',
                'placeholder:text-ink-4 outline-none transition-colors',
                'focus:border-brand-400 focus:shadow-[0_0_0_2px_rgb(22_126_255/0.12)]',
                'disabled:bg-ink-7 disabled:text-ink-4 disabled:cursor-not-allowed',
                invalid ? 'border-danger-500' : 'border-ink-5',
                className
            )}
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
        <textarea
            ref={ref}
            className={cn(
                'w-full px-2 py-1.5 rounded-[6px] border bg-white text-[13px] text-ink-1',
                'placeholder:text-ink-4 outline-none transition-colors resize-y',
                'focus:border-brand-400 focus:shadow-[0_0_0_2px_rgb(22_126_255/0.12)]',
                invalid ? 'border-danger-500' : 'border-ink-5',
                className
            )}
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

/** Radix Switch：负责键盘（Space 切换）与无障碍语义，这里只给外观 */
export function Switch({ checked, onChange, size = 'middle', disabled, className, ...rest }: SwitchProps) {
    const track = size === 'small' ? 'w-6 h-3.5' : 'w-8 h-[18px]';
    const knob = size === 'small' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5';
    const shift = size === 'small' ? 'translate-x-2.5' : 'translate-x-3.5';
    return (
        <RadixSwitch.Root
            checked={checked}
            disabled={disabled}
            onCheckedChange={onChange}
            // ⚠️ data-znhd-switch 是冒烟断言的稳定钩子（替换前断言读的是 antd 的 ant-switch-checked）。
            //    data-state 由 Radix 自己维护（checked/unchecked），不必自己再记一份。
            data-znhd-switch=""
            className={cn(
                'relative inline-flex shrink-0 items-center rounded-full border-2 border-transparent',
                'transition-colors cursor-pointer outline-none shrink-0',
                'focus-visible:ring-2 focus-visible:ring-brand-300',
                'data-[state=checked]:bg-brand-500 data-[state=unchecked]:bg-ink-4',
                'disabled:cursor-not-allowed disabled:opacity-50',
                track,
                className
            )}
            {...rest}>
            <RadixSwitch.Thumb
                className={cn(
                    'pointer-events-none block rounded-full bg-white shadow transition-transform',
                    'data-[state=checked]:translate-x-0 data-[state=unchecked]:-translate-x-[calc(100%-2px)]',
                    knob,
                    shift
                )}
            />
        </RadixSwitch.Root>
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
            <RadixCheckbox.Root
                checked={checked}
                disabled={disabled}
                onCheckedChange={(v) => onChange(v === true)}
                // ⚠️ data-znhd-checkbox 是冒烟断言的稳定钩子（替换前读的是 .ant-checkbox-input）。
                //    勾选态同样由 Radix 的 data-state 表达。
                data-znhd-checkbox=""
                className={cn(
                    'mt-[2px] inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border transition-colors',
                    'focus-visible:ring-2 focus-visible:ring-brand-300 outline-none',
                    checked ? 'border-brand-500 bg-brand-500' : 'border-ink-5 bg-white hover:border-brand-400'
                )}>
                <RadixCheckbox.Indicator className="text-white leading-none">
                    <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2 6.2 4.7 9 10 3.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </RadixCheckbox.Indicator>
            </RadixCheckbox.Root>
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
 *   每项自己 `onChange` 回抛。这样多选逻辑留在业务组件里（PhoneModal 要按设备 ID 算选中集合），
 *   基座不掺和业务，也省掉一层「点了组内任意处要不要联动」的纠结。
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

export function Tag({ children, color = 'default', className, title }: TagProps) {
    return (
        <span
            title={title}
            className={cn(
                'inline-flex items-center rounded-[4px] border px-1.5 text-xs leading-[18px] font-normal',
                TAG_COLOR[color],
                className
            )}>
            {children}
        </span>
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
    const bar = status === 'exception' ? 'bg-danger-600' : 'bg-brand-500';
    const h = size === 'small' ? 'h-1.5' : 'h-2.5';
    return (
        <div
            className={cn('w-full rounded-full bg-ink-6 overflow-hidden', h, className)}
            role="progressbar"
            aria-valuenow={p}
            aria-valuemin={0}
            aria-valuemax={100}>
            <div className={cn('h-full rounded-full transition-[width] duration-200', bar)} style={{ width: p + '%' }} />
        </div>
    );
}

/* ============================================================ Empty / Spinner / Divider */

export function Empty({ description }: { description?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center py-6 text-ink-3 text-[13px] gap-2">
            <svg width="34" height="34" viewBox="0 0 48 48" aria-hidden="true" className="opacity-40">
                <rect x="5" y="11" width="38" height="26" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
                <circle cx="16" cy="21" r="3.5" fill="currentColor" opacity="0.5" />
                <path d="M9 33l9-8 7 6 6-5 8 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
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
            className={cn('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', className)}
            style={{ width: size, height: size }}
        />
    );
}

export interface DividerProps {
    children?: React.ReactNode;
    className?: string;
}

/** 分割线；带 children 时为「文字居中的分割线」（替换前 antd 的 Divider orientation="left"） */
export function Divider({ children, className }: DividerProps) {
    if (!children) return <div className={cn('h-px w-full bg-ink-6 my-2', className)} />;
    return (
        <div className={cn('flex items-center gap-2 my-2', className)}>
            <div className="flex-1 h-px bg-ink-6" />
            <span className="text-ink-3 text-xs">{children}</span>
            <div className="flex-1 h-px bg-ink-6" />
        </div>
    );
}