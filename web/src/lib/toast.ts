/**
 * 客户端（网页）本地 toast —— 薄封装，逻辑已收敛到 `shared/ui/toast.ts`（v26.10.26-v9）。
 *
 * ── 为什么不能直接用 `@vue/lib/toast` ───────────────────────────────────────
 * 脚本端那份把容器挂在**影子树内的 `#app`** 下（daisyUI 主题变量由 `#app[data-theme]`
 * 提供），而客户端没有影子树，`getShadowRoot()` 恒为 null ⇒ 那条路径在网页里永远静默
 * no-op。所以共享层只提供 `createToast(getHost)`，宿主由各端自己回答：
 *
 *   · 脚本端 → 影子树内的 `#app`（见 `src-vue/lib/toast.ts`）
 *   · 客户端 → `document.body`（daisyUI 主题挂在 :root，body 下直接取得到 `--color-*`）
 *
 * API 与脚本端一致：`toast.success | error | warning | info(string | { title?, msg })`，
 * 另有 v9 新增的 `toast.loading()` 与句柄方法 `close()` / `update()`。
 */
import { createToast } from '../../../shared/ui/toast';

export const toast = createToast(() => document.body);
