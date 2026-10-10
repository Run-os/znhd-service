/**
 * 放大预览浮层的挂载容器 —— 两端共用（v26.10.08-v13 起）。
 *
 * ⚠️ **必须自己建一个挂在 `documentElement` 下的宿主 div，不能直接用「documentElement 本身」**：
 * antd 的 Image 预览是 `position: fixed` 浮层，**默认 portal 到 `document.body`**；而税务页的 `body`
 * 常被加 `transform`/`filter` 形成独立层叠上下文（本仓库 `panelHost.tsx` 已记录这个坑），
 * 一旦被放进去，浮层就以 **body 的盒子**而不是视口为包含块 ⇒ 工具栏被推到视口外、图片占住它的位置。
 *
 * 实测（1280×800、页面滚到 y=600、`body{transform:translateZ(0)}`）：
 *   · 不传：预览根 `y=-579 h=3000`（= body 盒子），工具栏 `y=2330`（视口外），命中测试拿到的是 `img`；
 *   · 传「返回 documentElement 的函数」：**仍然被挂到 body**（实测，本 antd/rc-portal 版本下不生效，别改回去）；
 *   · 传本函数（自建宿主 div）：预览根 `y=0`，工具栏回到视口内，命中测试通过。
 *
 * ⚠️ 共享层约束：本文件只碰 DOM，不得 import 任何宿主相关模块（见 `shared/image/compress.ts` 头部说明）。
 */

/** 宿主 div 的 id（v26.10.10-v4 起对外导出：图片嗅探要把它整棵子树排除在扫描之外） */
export const PREVIEW_HOST_ID = '__znhd_preview_host__';

/** 取得（必要时创建）预览浮层的宿主 div —— 传给 antd 的 `preview.getContainer` */
export function getPreviewHost(): HTMLElement {
    let el = document.getElementById(PREVIEW_HOST_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = PREVIEW_HOST_ID;
        document.documentElement.appendChild(el);
    }
    return el;
}
