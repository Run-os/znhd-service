import type { CSSProperties } from 'vue';
import { RADIUS, WECHAT } from '@/lib/ui/transfer/wechatTheme';

/**
 * 传输助手（微信暗色）的视觉常量与色板覆盖。
 *
 * 色板本体不在这里重写 —— 直接复用 React 版的 `@/lib/ui/transfer/wechatTheme`
 * （纯常量、零依赖），两边永远同一个绿、同一套分层灰。
 *
 * ── 为什么用「CSS 变量覆盖」而不是给每个组件传色 ────────────────────────────
 * 官方 shadcn 组件的样式类写的是语义色（`bg-primary` / `bg-muted` / `text-primary-foreground`），
 * 编译后是 `var(--color-*)`。Tailwind v4 的 `@theme` 变量是**可继承的普通 CSS 变量**，
 * 所以在窗口根节点上重declare 一遍，整棵子树（含官方 Bubble / Button / Empty）就自动变成
 * 微信暗色 —— 组件源码一个字符都不用改，也不会出现「官方组件装上就是白板」。
 *
 * ⚠️ 弹窗内容由 Reka Portal 挂到 shadowRoot（不在窗口子树里），拿不到这里的覆盖，
 * 因此 `DarkDialog.vue` 会把同一份 `TRANSFER_VARS` 绑到自己的根节点上。
 */
export { RADIUS, WECHAT };

export const TRANSFER_VARS = {
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
} as CSSProperties;

/** 窗口级 z-index（要盖住主面板的 1000000/1000001） */
export const Z = {
    windowMask: 1000010,
    window: 1000011,
    preview: 1000020,
    dialogMask: 1000030,
    dialog: 1000031,
} as const;
