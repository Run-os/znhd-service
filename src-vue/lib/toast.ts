import { toast as sonner } from 'vue-sonner';

/**
 * 全局提示（Vue 侧）—— 底层换成官方 **Sonner**。
 *
 * ── 为什么现在能用了（2026-10-18 第二次评估，推翻第一次结论）──────────────
 * 第一次迁移时判定「sonner 用不了」的理由是：它运行时把样式表注入 `document.head`，
 * 而我们的 UI 整个活在 ShadowDOM 里，影子树拿不到那些规则 ⇒ 弹出来是裸文本。
 * 但 `vue-sonner@2` 已把样式作为**独立样式表**发布（`vue-sonner/style.css`），
 * 于是可以由 `main.ts` 以 `?inline` 打进影子树；Sonner 组件本身也是**原地渲染**
 * （`<Toaster>` 处生成 `<section data-sonner-toaster>`，不 portal 到 body），
 * 两件事凑齐之后 ShadowDOM 里完全可用 —— 之前那份手写 toast 已删除。
 *
 * 保留 `success / error / warning / info` 四个方法名，调用点无需改动；
 * 关窗/未挂载早期调用也无所谓：vue-sonner 的 toast 状态是模块级的，Toaster 挂上后会补渲染。
 */
export const toast = {
    success: (msg: string) => sonner.success(msg),
    error: (msg: string) => sonner.error(msg),
    warning: (msg: string) => sonner.warning(msg),
    info: (msg: string) => sonner.info(msg),
};
