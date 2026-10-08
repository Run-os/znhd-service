/**
 * 脚本端 UI 的样式注入与宿主隔离层（v26.10.08-v14 重写：antd v6 → Tailwind CSS v4）。
 *
 * ── 为什么 CSS 走「导出字符串 + GM_addStyle」而不是 style-loader ────────────
 * 面板注入的是**别人的页面**。宿主页可能带 CSP `style-src` 限制，页面内新建的 `<style>` 有可能落地失败；
 * `GM_addStyle` 由油猴管理器在沙箱侧插入，不受页面 CSP 影响（替换前 uiReset 就用它兜底）。
 * 样式入口是 `shared/ui/tailwind.css`（Tailwind 编译后的字符串），由 webpack 的
 * css-loader + postcss-loader 链处理后以字符串形式被 import 进来。
 *
 * ── 隔离策略：Tailwind 刻意不要 preflight ──────────────────────────────────
 * Tailwind v4 默认会带一份**全局 reset**（清 margin、统一字号/行高、按钮与表单控件的浏览器默认外观）。
 * 那会连带重置**税务页面**，不可接受。故 shared/ui/tailwind.css 只导入 theme + utilities 两层，
 * 不导入 preflight；本文件负责补上「我们自己的容器需要的」那点复位。
 *
 * ⚠️ **本文件的复位选择器必须带 `.znhd-root` 前缀**：不带前缀的规则会命中宿主页面的元素，
 *    那是明确禁止的（替换前 uiReset 也是这个思路，靠「容器前缀」把敌意样式挡在外面）。
 *    至于「Tailwind 工具类压不压得住这些复位」—— 见下方注释里 `!important` 的取舍说明。
 */

import { PANEL_HOST_ID } from '@/lib/ui/panelIds';
import tailwindCss from '../../../shared/ui/tailwind.css';

/**
 * 宿主页面敌意样式的兜底复位。
 *
 * ⚠️ 这里是**白名单**：只写「确实在真实税务页踩到过」的规则，且每条都带 .znhd-root 前缀。
 *    凡是 Tailwind 工具类已经能表达的（颜色、间距、圆角…）这里一律不重复写。
 *
 * ⚠️ **不用 `!important` 也能压住宿主页**的前提是选择器特异性够高：
 *    `.znhd-root input` 是 (0,2,1)，宿主页的 `input {}`（0,0,1）或 `.foo input`（0,1,1）都压得住；
 *    但宿主页若有 `#id input`（1,1,1）这类高特异性规则，则必须加 `!important` ——
 *    仓库历史上真实踩到的一条就是宿主给 svg 加了 `margin: -2.75em auto 0`（特异性 0,0,1）。
 *    故下面凡是复位元素**默认样式**（margin / background / border / appearance）的，都带 !important。
 */
const HOST_ISOLATION_CSS = `
/* 盒模型统一：宿主页常把 * 设成 content-box，会让所有宽度计算偏 2px（描边被挤出去） */
#${PANEL_HOST_ID}, #${PANEL_HOST_ID} *, .znhd-root, .znhd-root * {
  box-sizing: border-box;
}

/* ★ 宿主给 svg 加负外边距把图标顶出控件（真实税务页实测：margin: -2.75em auto 0 ≈ -44px）。
   antd 自身从不给 svg 设 margin，所以这条复位对图标是安全且必要的。 */
#${PANEL_HOST_ID} svg, .znhd-root svg {
  margin: 0 !important;
}

/* 按钮/表单控件去掉浏览器与宿主的默认外观：我们的按钮全部靠 Tailwind 类定外观，
   若宿主页给 button 加了 background/border/padding，会与我们的类叠加出「双层边框」效果。 */
#${PANEL_HOST_ID} button, .znhd-root button,
#${PANEL_HOST_ID} input, .znhd-root input,
#${PANEL_HOST_ID} textarea, .znhd-root textarea,
#${PANEL_HOST_ID} select, .znhd-root select {
  margin: 0 !important;
  appearance: none;
  -webkit-appearance: none;
}

/* 表单控件的字体必须继承（Chromium 默认表单字体与正文不一致，且宿主页常改 line-height） */
#${PANEL_HOST_ID} input, #${PANEL_HOST_ID} textarea, .znhd-root input, .znhd-root textarea {
  font-family: inherit !important;
  line-height: inherit !important;
}

/* 输入框的清空按钮/占位符颜色：宿主页常给 ::placeholder 上色，这里拉回中性灰 */
#${PANEL_HOST_ID} ::placeholder, .znhd-root ::placeholder {
  color: var(--color-ink-4, #bfbfbf) !important;
  opacity: 1;
}

/* 图片类元素不给宿主留 baseline 空隙 */
#${PANEL_HOST_ID} img, .znhd-root img {
  vertical-align: middle;
}

/* 自定义滚动条样式统一放在 shared/ui/tailwind.css 的 znhd-base 层（工具类形态），
   这里不再重复 —— 重复会让滚动条在不同容器里表现不一致。 */
`;

let injected = false;

/**
 * 注入样式（只注入一次，幂等）：Tailwind 编译产物 + 宿主隔离层。
 *
 * 顺序要求：隔离层在**后**。它带 !important 的复位必须能压过 Tailwind 的工具类，
 * 而同优先级下后插入的规则赢 —— 两者同在一个 style 标签里，靠先后顺序决定。
 */
export function injectUiReset(): void {
    if (injected) return;
    injected = true;
    const css = tailwindCss + '\n' + HOST_ISOLATION_CSS;
    try {
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(css);
            return;
        }
    } catch (e) {
        /* 落到下面的兜底 */
    }
    const style = document.createElement('style');
    style.id = '__znhd_ui_reset__';
    style.textContent = css;
    document.head.appendChild(style);
}
