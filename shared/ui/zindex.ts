/**
 * 层级与浮层挂载约定（两端共用，v26.10.08-v14 起替代 antd 的 zIndexPopupBase）。
 *
 * ── 三层为什么是这三个数 ──────────────────────────────────────────────────
 * 1. `PANEL_Z = 999999`：面板宿主本身。低于宿主页面自身的弹窗（税务页多在 1000~9999 之上有层级），
 *    但高于普通内容 —— 替换前 panelHost.tsx 就是这个值，保持不变。
 * 2. `OVERLAY_Z = 1000000`：所有浮层（Modal / Drawer / Tooltip / Toast / 图片预览）的基线。
 *    替换前是 antd 的 `zIndexPopupBase: 1000000`，数值刻意保持一致，
 *    这样「浮层盖住面板」的层级关系与替换前完全相同。
 * 3. `PREVIEW_Z = OVERLAY_Z + 10`：图片预览要盖住触发它的那个弹窗（如「历史记录」），
 *    所以必须比 OVERLAY_Z 再高一点。
 *
 * ⚠️ 所有浮层都挂 `documentElement`（`getOverlayHost`）而不是 body：
 *    税务页 body 常被加 transform/filter 形成独立层叠上下文，会把 fixed 浮层困在里面
 *    （仓库既有结论，panelHost.tsx 有完整记录）。
 */

/** 面板宿主层级 */
export const PANEL_Z = 999999;
/** 浮层（弹窗/抽屉/提示/预览）的基线层级 */
export const OVERLAY_Z = 1000000;
/** 图片预览层级（必须高于触发它的弹窗） */
export const PREVIEW_Z = OVERLAY_Z + 10;

/**
 * 浮层挂载容器：统一返回 `documentElement`。
 *
 * 用法：`createPortal(node, getOverlayHost())`（自绘浮层）或 `<Dialog.Portal container={getOverlayHost()}>`（Radix）。
 */
export function getOverlayHost(): HTMLElement {
    return document.documentElement;
}

/**
 * 浮层根节点统一带的类名。
 *
 * 作用有二：① `shared/ui/tailwind.css` 的 znhd-base 层用它把基线复位限定在我们的 UI 内；
 * ② 冒烟测试可用它做「面板渲染成功了吗」的最外层判据（比找具体按钮稳）。
 */
export const OVERLAY_ROOT_CLASS = 'znhd-root';
