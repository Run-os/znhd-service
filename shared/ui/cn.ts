/**
 * className 拼接工具（共享层，两端都用）。
 *
 * 为什么不用 clsx/tailwind-merge：`shared/` 的硬约束是「零宿主依赖」，多加一个运行时依赖
 * 不值得。这里手写一个 20 行的实现，够用且没有产物负担。
 *
 * 用法：`cn('a', cond && 'b', { c: cond2 })` —— 假值与 `undefined` 会被丢掉。
 */
export type ClassValue = string | number | null | undefined | false | Record<string, boolean | undefined>;

export function cn(...args: ClassValue[]): string {
    const out: string[] = [];
    for (const a of args) {
        if (!a) continue;
        if (typeof a === 'string' || typeof a === 'number') {
            out.push(String(a));
        } else if (typeof a === 'object') {
            for (const key in a) {
                if (a[key]) out.push(key);
            }
        }
    }
    return out.join(' ');
}