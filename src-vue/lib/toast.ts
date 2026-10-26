/**
 * 全局提示（脚本端薄封装）—— 逻辑已收敛到 `shared/ui/toast.ts`（v26.10.26-v9）。
 *
 * ── 为什么这里只剩一行「取容器」 ────────────────────────────────────────────
 * v9 之前本文件是一整套 DOM 实现，与 `web/src/lib/toast.ts` 逐字重复（只差容器挂哪儿）。
 * 现在 DOM、动画、计时、去重、上限、loading 全在共享层，本文件只回答**一个问题**：
 * 容器该挂到哪个元素下。
 *
 * 答案必须是**影子树内的 `#app`**：daisyUI 的主题变量由脚本端 `#app[data-theme]` 提供，
 * 容器挂到 shadowRoot 直下就取不到 `--color-*`，卡片会没有底色/图标色。
 * 影子树还没挂载（`getShadowRoot()` 为 null）时返回 null，共享层据此静默 no-op。
 *
 * 共享层零宿主依赖，所以取容器这一步只能留在各端（`web/` 那边挂 `document.body`）。
 *
 * API 与原实现完全一致：`toast.success | error | warning | info(string | { title?, msg })`，
 * 调用点零改动；v9 起每个方法额外返回 `{ close(), update() }` 句柄，
 * 并新增 `toast.loading()` / `toast.loading(...).update({ kind: 'success', msg })`。
 */
import { getShadowRoot } from './shadow';
import { createToast } from '../../shared/ui/toast';

export const toast = createToast(() => {
    const root = getShadowRoot();
    if (!root) return null;
    // ⚠️ 泛型参数不能省：`querySelector` 默认返回 `Element | null`，而共享层的宿主类型是
    // `HTMLElement | ShadowRoot`（`Element` 不是 `HTMLElement` 的超集）。TS 5.9 与 6.0 对
    // 无泛型时的推断不一致（6.0 推出 HTMLElement、5.9 推出 Element），
    // `npm run typecheck:web` 走的是 web/node_modules 里的 TS 5.9 ⇒ 会挂在 TS2345。
    return root.querySelector<HTMLElement>('#app') ?? root;
});
