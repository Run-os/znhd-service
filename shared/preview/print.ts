/**
 * A4 打印版式 —— 两端共用（v26.10.08-v13 起：脚本端与手机页都用 `react-to-print` 打印原图）。
 *
 * ⚠️ **为什么 `@page` 的 margin 必须是 0**：浏览器的「页眉和页脚」（标题 / URL / 日期 / 页码）
 *    画在**页边距区域**里，而 Chrome 打印对话框里该项**默认是勾上的**。只要页边距非 0，
 *    它们就有地方可画 ⇒ 纸上会多出页眉页脚。把 `@page` 边距归零后它们无处容身（这也是
 *    react-to-print 默认 pageStyle 用 `margin: 0` 的原因，它自己注释写着 "Remove browser default
 *    header (title) and footer (url)"）。CSS 没有直接关掉那个勾选项的能力，只能这样「不给它留位置」。
 *    ⇒ 图片与纸边之间的距离改由**内容框自己的 padding** 提供（`A4_PAD_MM`），效果一样且不会被浏览器占用。
 *
 * ⚠️ 这几个数必须与 `PRINT_PAGE_STYLE` 里的 `@page { size: A4 portrait; margin: 0 }` **配套**：
 *   · 内容框 = 整张 A4（210 × 297mm），减去 3mm 高度余量取 294mm；
 *   · `padding: 10mm` 且**必须 `box-sizing: border-box`** —— 否则 padding 会把框撑到 230×314mm，
 *     直接溢出纸张、多吐空白页（这是最容易写错的一处）；
 *   · 于是真正给图片的区域仍是 190 × 274mm；
 *   · 高度留 3mm 余量：框高**正好等于**纸高时，部分浏览器/打印驱动会因舍入多吐一张空白页。
 */

export const A4_W_MM = 210;
export const A4_H_MM = 297;
/** 图片与纸边的距离（自己留，不靠 @page margin —— 那个位置要留给「没有页眉页脚」） */
export const A4_PAD_MM = 10;
/** 内容框宽度 = 整张 A4（含内边距） */
export const PRINT_BOX_W_MM = A4_W_MM;
/** 内容框高度 = A4 减 3mm 余量（含内边距） */
export const PRINT_BOX_H_MM = A4_H_MM - 3;

/**
 * 注入打印窗口的页面样式（`react-to-print` 的 `pageStyle`）。
 * - `size: A4 portrait`：浏览器默认按 A4 纵向出纸（用户没在对话框改纸张时生效）；
 * - `margin: 0`：**不是为了贴边打印**，而是让浏览器没地方画页眉页脚（见上）；
 * - `html, body { margin: 0 }`：打印 iframe 的 body 默认 8px 外边距，不归零会把内容框挤出纸张、多吐空白页。
 */
export const PRINT_PAGE_STYLE =
    '@page { size: A4 portrait; margin: 0; } html, body { margin: 0; padding: 0; }';

/**
 * 构造「打印用」的游离节点：固定成 A4 可用区的图片框 + `object-fit: contain` 等比居中。
 *
 * ⚠️ 为什么用**游离节点**（不挂进 DOM）：`react-to-print` 的 `cloneNode` 会把**内联样式**一起克隆，
 *    所以「`display:none` / 挪到视口外的隐藏容器」在打印 iframe 里同样不可见 ⇒ 打出来是空白。
 *    游离节点只带我们给的打印样式，没有这个坑；而且不进渲染树，也就不会「闪一下大图」。
 *
 * @param src 打印的图片地址（**用原分辨率地址**，不要用预览里缩放/旋转后的画面，清晰度最好）
 * @param alt 无障碍替代文字（同时用于下载/打印对话框的标题）
 */
export function buildA4ImageNode(src: string, alt: string): HTMLElement {
    const node = document.createElement('div');
    // ⚠️ `box-sizing: border-box` 不能省：width 已按 A4 取 210mm，若按 content-box 再加 10mm padding，
    //    实际宽度会变成 230mm ⇒ 溢出纸张、多吐空白页。
    node.style.cssText = `box-sizing:border-box;width:${PRINT_BOX_W_MM}mm;height:${PRINT_BOX_H_MM}mm;padding:${A4_PAD_MM}mm;overflow:hidden;`;
    const img = document.createElement('img');
    img.src = src;
    img.alt = alt;
    // 图片区域 = 内容框 padding 的内沿（190 × 274mm），等比缩放居中
    img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
    node.appendChild(img);
    return node;
}
