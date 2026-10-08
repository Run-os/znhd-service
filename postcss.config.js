/**
 * PostCSS 配置：Tailwind v4 走 `@tailwindcss/postcss`（v4 起官方不再用 tailwindcss 自己的 postcss 插件）。
 *
 * 作用范围：**只有本仓库自己的 CSS**（webpack 规则的 include 限定在 src/ 与 shared/），
 * node_modules 里第三方库自带的 .css 不经过这条链 —— 也就是说这个插件不可能重置到宿主页或
 * 污染第三方样式（而且我们本来就不要 preflight，见 shared/ui/tailwind.css 的说明）。
 */
module.exports = {
    plugins: {
        '@tailwindcss/postcss': {},
    },
};