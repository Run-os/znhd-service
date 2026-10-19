import { readonly, ref, type Ref } from 'vue';

/**
 * 主题（日间 / 夜间）。
 *
 * 迁移到 daisyUI 后改为切换**官方主题名**：在影子树根容器（#app）上写 `data-theme`，
 *   light → `wireframe`（线框风，无品牌主色）
 *   dark  → `business`（深灰底 + 暗蓝主色）
 * 具体色值全部由 daisyUI 内置主题提供，本项目不再自定义任何色板。
 *
 * ⚠️ 必须挂在影子树**内部**元素上：daisyUI 的主题选择器是 `[data-theme=xxx]`，
 * 普通属性选择器不能选中 shadow host（只有 `:host()` 能跨边界），写在宿主上会整站无色。
 *
 * 同时保留 `dark` class：少量布局微调仍用 `dark:` 变体
 * （style.css 里已把它绑定到 `[data-theme='business']`）。
 *
 * 为什么不用 prefers-color-scheme 直接控制：用户要能**手动**切换，系统偏好只作为首启默认值。
 */
export type ThemeMode = 'light' | 'dark';

/** 主题模式 → daisyUI 官方主题名 */
const THEME_NAME: Record<ThemeMode, string> = {
    light: 'wireframe',
    dark: 'business',
};

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
    if (!hostEl) return;
    hostEl.dataset.theme = THEME_NAME[next];
    hostEl.classList.toggle('dark', next === 'dark');
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
