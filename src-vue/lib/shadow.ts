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
