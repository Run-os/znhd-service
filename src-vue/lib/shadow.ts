import type { InjectionKey } from 'vue';

/**
 * shadowRoot 注入键。
 *
 * Reka UI 的浮层默认 portal 到 document.body —— 那会**脱离影子树**，Tailwind 样式一条都命中不了。
 * 所以每个浮层组件都必须显式拿到 shadowRoot 并传给 Portal：
 *   DialogPortal `:to` / DropdownMenuContent `:container` / SelectContent `:container` / PopoverContent `:container`
 * 组件内部已经做掉这件事，业务代码不要自己再挂 body。
 */
export const SHADOW_ROOT_KEY: InjectionKey<ShadowRoot> = Symbol('znhd-shadow-root');

/**
 * 模块级 shadowRoot 引用。
 *
 * 组件里用 inject（有 provide/inject 链），但**非组件的工具代码**（toast、浮层兜底）没有 inject 上下文，
 * 只能从这里取。由 main.ts 在挂载时写入，卸载时清空。
 */
let currentShadowRoot: ShadowRoot | null = null;

export function setShadowRoot(root: ShadowRoot | null): void {
    currentShadowRoot = root;
}

export function getShadowRoot(): ShadowRoot | null {
    return currentShadowRoot;
}
