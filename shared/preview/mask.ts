/**
 * 「预览期间压掉所有下层浮层遮罩」—— 两端共用（v26.10.08-v13 起）。
 *
 * 背景：antd 的 Modal / Drawer 遮罩都是 `rgba(0,0,0,0.45)`。图片预览是**全屏**浮层，它自己那层遮罩
 * 就够做背景了；可底下凡是还开着的弹窗/抽屉，遮罩**依然在画**，两层叠加就是 `1-(0.55×0.55)=0.6975`
 * —— 白底被压到灰度 **77**（单层是 140），肉眼即「没有官方明亮」。
 *
 * ⚠️ 只撤「自己那层」不够（v26.10.08-v9 的错）：实测预览打开时，取样点上还叠着别的浮层遮罩
 *    （例如设置抽屉的 `.ant-drawer-mask`）。故这里按「预览期间一律隐藏下层遮罩」处理：
 *    它们这时本来就被全屏预览完全盖住、对视觉毫无贡献，只是白白多加一层暗。
 *
 * 两端用法一致：预览开/关时调用 `syncPreviewMask(open)`（幂等，CSS 只注入一次）。
 */

/** 预览期间挂在 `<html>` 上的类名 */
export const PREVIEWING_CLASS = 'znhd-previewing';

/** 压掉下层遮罩的规则（唯一来源：脚本端不再往 uiReset 里重复写一份） */
export const PREVIEW_MASK_CSS = `html.${PREVIEWING_CLASS} .ant-modal-mask,
html.${PREVIEWING_CLASS} .ant-drawer-mask {
  display: none !important;
}
`;

const STYLE_ID = 'znhd-preview-mask-css';

/** 注入规则（幂等）：两端各自运行在独立页面里，谁先预览谁注入 */
export function ensurePreviewMaskCss(): void {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PREVIEW_MASK_CSS;
    (document.head || document.documentElement).appendChild(style);
}

/** 按预览开关挂/摘 `<html>` 上的类 */
export function setPreviewing(on: boolean): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (on) root.classList.add(PREVIEWING_CLASS);
    else root.classList.remove(PREVIEWING_CLASS);
}

/** 预览开/关时调用：确保规则已注入，并同步类名（幂等，可重复调用） */
export function syncPreviewMask(open: boolean): void {
    ensurePreviewMaskCss();
    setPreviewing(open);
}
