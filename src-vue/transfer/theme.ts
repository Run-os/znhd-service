import { computed, type ComputedRef, type CSSProperties } from 'vue';
import { RADIUS, WECHAT } from '@/lib/ui/transfer/wechatTheme';
import { themeMode } from '@vue/lib/theme';

/**
 * 传输助手窗口的视觉常量与色板覆盖（v26.10.19-v12 起**跟随日/夜模式**）。
 *
 * 色板本体不在这里重写 —— 暗色的分层灰直接复用 React 版的
 * `@/lib/ui/transfer/wechatTheme`（纯常量、零依赖），两边永远同一个绿、同一套分层灰；
 * 日间那一套是新加的（微信桌面版亮色：浅灰聊天区 + 白色对方气泡 + 微信绿自己气泡）。
 *
 * ── 为什么用「CSS 变量覆盖」而不是给每个组件传色 ────────────────────────────
 * 官方 shadcn 组件的样式类写的是语义色（`bg-primary` / `bg-muted` / `text-primary-foreground`），
 * 编译后是 `var(--color-*)`。Tailwind v4 的 `@theme` 变量是**可继承的普通 CSS 变量**，
 * 所以在窗口根节点上重declare 一遍，整棵子树（含官方 Bubble / Button / Empty）就自动变成
 * 微信配色 —— 组件源码一个字符都不用改，也不会出现「官方组件装上就是白板」。
 *
 * ⚠️ 弹窗内容由 Reka Portal 挂到 shadowRoot（不在窗口子树里），拿不到这里的覆盖，
 * 因此 `DarkDialog.vue` 会把同一份色板绑到自己的根节点上。
 *
 * ⚠️ `--tw-*` 是**窗口分层专用 token**（聊天区底色 / 分隔细线 / 输入舱），
 * 语义色表达不了这几层（它们不是背景/卡片/边框的任何一种通名），所以单独开一套。
 * 组件里一律写 `var(--tw-xxx)`，别再写死 hex —— 写死就等于把窗口钉死成暗色。
 */
export { RADIUS, WECHAT };

/** 夜间（微信桌面版暗色）：窗口纯黑 + rgb(34,34,34) 细边 + 略浅的输入舱 */
const DARK: Record<string, string> = {
    '--color-primary': WECHAT.primary,
    '--color-primary-foreground': '#ffffff',
    '--color-primary-hover': '#06AD56',
    '--color-background': WECHAT.chat,
    '--color-foreground': 'rgba(255, 255, 255, 0.9)',
    '--color-card': WECHAT.list,
    '--color-card-foreground': 'rgba(255, 255, 255, 0.9)',
    '--color-popover': '#2B2B2B',
    '--color-popover-foreground': 'rgba(255, 255, 255, 0.9)',
    '--color-secondary': 'rgba(255, 255, 255, 0.1)',
    '--color-secondary-foreground': 'rgba(255, 255, 255, 0.9)',
    '--color-muted': WECHAT.bubblePeer,
    '--color-muted-foreground': 'rgba(255, 255, 255, 0.45)',
    '--color-accent': 'rgba(255, 255, 255, 0.08)',
    '--color-accent-foreground': '#ffffff',
    '--color-destructive': '#E81123',
    '--color-destructive-foreground': '#ffffff',
    '--color-border': 'rgba(255, 255, 255, 0.1)',
    '--color-input': 'rgba(255, 255, 255, 0.12)',
    '--color-ring': WECHAT.primary,
    '--color-text': 'rgba(255, 255, 255, 0.9)',
    '--color-text-secondary': 'rgba(255, 255, 255, 0.55)',
    '--color-text-tertiary': 'rgba(255, 255, 255, 0.35)',
    '--tw-window': '#000000',
    '--tw-hairline': 'rgb(34, 34, 34)',
    '--tw-composer-bg': 'rgb(32, 32, 32)',
    '--tw-composer-border': 'rgb(46, 46, 46)',
    '--tw-btn-border': 'rgb(58, 58, 58)',
};

/**
 * 日间（微信桌面版亮色）：浅灰聊天区 + 白色对方气泡 + 白色输入舱。
 * 自己气泡仍是微信绿（#07C160，两种模式同一个品牌色），气泡文字仍是黑色。
 */
const LIGHT: Record<string, string> = {
    '--color-primary': WECHAT.primary,
    '--color-primary-foreground': '#ffffff',
    '--color-primary-hover': '#06AD56',
    '--color-background': '#ffffff',
    '--color-foreground': '#1f2329',
    '--color-card': '#ffffff',
    '--color-card-foreground': '#1f2329',
    '--color-popover': '#ffffff',
    '--color-popover-foreground': '#1f2329',
    '--color-secondary': '#f2f3f5',
    '--color-secondary-foreground': '#1f2329',
    // 对方气泡：亮色下就是「白气泡铺在浅灰聊天区上」（微信亮色同款，靠 1px 边界分辨）
    '--color-muted': '#ffffff',
    '--color-muted-foreground': '#8c8c8c',
    '--color-accent': '#f2f3f5',
    '--color-accent-foreground': '#1f2329',
    '--color-destructive': '#E81123',
    '--color-destructive-foreground': '#ffffff',
    '--color-border': '#e0e0e0',
    '--color-input': '#d9d9d9',
    '--color-ring': WECHAT.primary,
    '--color-text': '#1f2329',
    '--color-text-secondary': 'rgba(0, 0, 0, 0.55)',
    '--color-text-tertiary': 'rgba(0, 0, 0, 0.35)',
    '--tw-window': '#f2f2f2',
    '--tw-hairline': '#e0e0e0',
    '--tw-composer-bg': '#ffffff',
    '--tw-composer-border': '#e0e0e0',
    '--tw-btn-border': '#d9d9d9',
};

export const TRANSFER_VARS = DARK as CSSProperties;
export const TRANSFER_VARS_LIGHT = LIGHT as CSSProperties;

/**
 * 按当前主题取色板（响应式）—— 窗口与子弹窗都用它绑 `:style`。
 * `themeMode` 是 `readonly(ref)`，切主题时这里跟着重算，窗口即时换色。
 */
export const transferVars: ComputedRef<CSSProperties> = computed(() =>
    themeMode.value === 'dark' ? TRANSFER_VARS : TRANSFER_VARS_LIGHT
);

/** 窗口级 z-index（要盖住主面板的 1000000/1000001） */
export const Z = {
    windowMask: 1000010,
    window: 1000011,
    preview: 1000020,
    dialogMask: 1000030,
    dialog: 1000031,
} as const;
