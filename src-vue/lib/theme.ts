import { readonly, ref, type Ref } from 'vue';

/**
 * 主题（日间 / 夜间）。
 *
 * 做法（对齐 shadcn-vue theming）：只在**影子宿主**上切一个 `dark` class，
 * 具体色值全在 style.css 的 `:host` / `:host(.dark)` 里 —— 组件与业务代码不感知主题，
 * 官方 shadcn 组件的 `dark:` 变体也由 `@custom-variant dark (&:where(.dark, .dark *))` 接管。
 *
 * 为什么不用 prefers-color-scheme 直接控制：用户要能**手动**切换，系统偏好只作为首启默认值。
 */
export type ThemeMode = 'light' | 'dark';

/** 与既有存储键同族（scriptCat_*），独立存放，避免和 React 版 Allvalue 互相覆盖 */
const STORAGE_KEY = 'scriptCat_VueTheme';

const mode = ref<ThemeMode>('light');
let hostEl: HTMLElement | null = null;

function systemPrefersDark(): boolean {
    try {
        return !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
        return false;
    }
}

function readSaved(): ThemeMode | null {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v === 'dark' || v === 'light' ? v : null;
    } catch {
        return null;
    }
}

function apply(next: ThemeMode): void {
    mode.value = next;
    hostEl?.classList.toggle('dark', next === 'dark');
}

/** 挂载时调用一次：优先用上次选择，其次跟随系统 */
export function initTheme(host: HTMLElement): void {
    hostEl = host;
    apply(readSaved() ?? (systemPrefersDark() ? 'dark' : 'light'));
}

export function setTheme(next: ThemeMode): void {
    try {
        localStorage.setItem(STORAGE_KEY, next);
    } catch {
        /* 隐私模式 / 存储被禁：不持久化，仅本次生效 */
    }
    apply(next);
}

/** 返回切换后的模式（调用方可能要据此打日志） */
export function toggleTheme(): ThemeMode {
    const next: ThemeMode = mode.value === 'dark' ? 'light' : 'dark';
    setTheme(next);
    return next;
}

/** 只读引用，供 UI（Sonner 的 theme prop 等）跟随 */
export const themeMode: Readonly<Ref<ThemeMode>> = readonly(mode);
