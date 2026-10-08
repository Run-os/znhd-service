/**
 * CSS 模块的 TypeScript 声明。
 *
 * 为什么要单独一个文件、而不能塞进 `src/global.d.ts`：
 *   那个文件带 `export {}` + `declare global`，整体是一个**模块**；
 *   而 `declare module '*.css'` 的**通配符形式只在 ambient（脚本）文件里才生效** ——
 *   写在模块文件里会被 TypeScript 当成「模块增强」，`*` 匹配不上任何真实模块，于是报 TS2307。
 *
 * 对应实现：webpack 用 css-loader（esModule: true）把 .css 导出为**字符串**，
 * 再经 postcss-loader 跑 Tailwind 编译（配置见 config/webpack.config.base.js）。
 * uiReset.ts 拿它走 GM_addStyle 注入 —— 宿主页面可能有 CSP style-src，页面内 <style> 不可靠。
 */
declare module '*.css' {
    const css: string;
    export default css;
}
