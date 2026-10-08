/**
 * 「预览期间压掉所有下层浮层遮罩」—— 两端共用（v26.10.08-v13 起；v26.10.08-v14 起不再依赖 antd 类名）。
 *
 * 背景：浮层遮罩都是 `rgb(0 0 0 / 0.45)`。图片预览是**全屏**浮层，它自己那层遮罩就够做背景了；
 * 可底下凡是还开着的弹窗/抽屉，遮罩**依然在画**，两层叠加就是 `1-(0.55×0.55)=0.6975`
 * —— 白底被压到灰度 **77**（单层是 140），肉眼即「没有官方明亮」。
 *
 * ⚠️ 只撤「自己那层」不够（v26.10.08-v9 的错）：实测预览打开时，取样点上还叠着别的浮层遮罩
 *    （例如设置抽屉的遮罩）。故这里按「预览期间一律隐藏下层遮罩」处理：
 *    它们这时本来就被全屏预览完全盖住、对视觉毫无贡献，只是白白多加一层暗。
 *
 * ⚠️ **为什么改用 data 属性**：替换 antd 时遮罩的标记从 .ant-modal-mask 换成了我们自己的
 *    MASK_ATTR。选 data- 属性而非语义类，是因为遮罩 div 的外观已由 Tailwind 类名承担，
 *    再加一个类名容易与外观类混淆；data- 的语义就是「这是遮罩」，冲突面最小。
 *    ⚠️ 它是**白名单**：每新增一种带遮罩的浮层，都必须给它挂上 MASK_ATTR，
 *    否则预览期间那层遮罩不会被压掉（表现为「预览打开后背景仍然发灰」）。
 *
 * 两端用法一致：预览开/关时调用 syncPreviewMask(open)（幂等，CSS 只注入一次）。
 *
 * ⚠️ 本文件是模板字符串，**注释里不能出现反引号**（会截断模板、tsc 报 TS1005）。
 */

/** 预览期间挂在 html 上的类名 */
export const PREVIEWING_CLASS = 'znhd-previewing';

/** 遮罩层必须带的属性（见 shared/ui/Overlay.tsx 里 mask 层的用法） */
export const MASK_ATTR = 'data-znhd-mask';

/** 压掉下层遮罩的规则（唯一来源：uiReset 与两端都不再另写一份） */
export const PREVIEW_MASK_CSS = `html.${PREVIEWING_CLASS} [${MASK_ATTR}] {
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

/** 按预览开关挂/摘 html 上的类 */
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