/**
 * 主题（v26.10.21-v7：恒为日间 cupcake；夜间模式已于 v5 删除）。
 *
 * daisyUI 官方主题：影子树根容器（#app）上写 `data-theme="cupcake"`。
 * 具体色值全部由 daisyUI 内置主题提供，本项目不再自定义任何色板。
 *
 * ⚠️ 必须挂在影子树**内部**元素上：daisyUI 的主题选择器是 `[data-theme=xxx]`，
 * 普通属性选择器不能选中 shadow host（只有 `:host()` 能跨边界），写在宿主上会整站无色。
 *
 * 历史：v26.10.19-v26.10.21-v4 曾支持 business（夜间）与手动切换
 * （持久化在 scriptCat_VueTheme），v5 起整体删除 —— 用户只要日间；
 * v5-v6 为 wireframe（线框风），v7 起换 cupcake。
 */
export function initTheme(host: HTMLElement): void {
    host.dataset.theme = 'cupcake';
}
