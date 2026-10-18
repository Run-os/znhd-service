import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn-vue 同款 className 合并：后写的 Tailwind 类覆盖先写的同类工具类 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
