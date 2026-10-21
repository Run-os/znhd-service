import { createApp, h, type App as VueApp } from 'vue';
import css from '../style.css?inline';
import { registerTailwindProperties } from '../main';
import NavBarControls from './NavBarControls.vue';

/**
 * 站点导航条注入（v26.10.21-v4）：把「语音播报开关 + 4 个功能入口」挂到
 * 征纳互动标题栏（`.nav-bar-main` = 【工作台】【业务管理】所在的 TDesign 菜单）。
 *
 * 挂载范式与 main.ts 一致：host（inline-flex）→ shadowRoot(open) → <style> → #app。
 * 为什么用独立 shadow 而不是往页面 DOM 塞裸节点：隔离税务页的全局 CSS
 * （通配 line-height / box-sizing 等），同时自家 Tailwind 产物零改动复用。
 *
 * 自愈策略 = 1s 轮询 tryMount（幂等）：
 *   · 标题栏是站点 SPA 的一部分，路由切换/框架重绘会整块替换 DOM；
 *   · 对「深层节点被替换」MutationObserver 要监听整个 subtree 才可靠，
 *     事件量反而大 —— 每秒一次 querySelector + isConnected 判断更便宜且稳。
 *
 * 锚点与回退（实机 2026-10-21 探测）：`.nav-bar-main`（232px）挂在 `.right`
 * （440px = 标题 208 + 菜单 232，恰好等宽）里，站点布局疑似写死宽度 ——
 * 首选挂 `.right`（菜单后面 = 业务管理右侧），挂完做可见性自检；不可见
 * （被 overflow 裁掉 / 挤出视口）就回退挂进菜单自身内部；再不行本轮放弃，
 * 下一轮轮询重试。
 */
const NAV_HOST_ID = '__znhd_nav_host__';
const NAV_MENU = '.nav-bar-main';
const POLL_MS = 1000;

let app: VueApp | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

/** 可见性自检：尺寸非 0 且整体落在视口内（右边被顶出视口 = 布局写死宽度装不下） */
function hostVisible(host: HTMLElement): boolean {
    const r = host.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= window.innerWidth + 1;
}

function unmountHost(): void {
    try {
        app?.unmount();
    } catch {
        /* 重复卸载忽略 */
    }
    app = null;
    document.getElementById(NAV_HOST_ID)?.remove();
}

function mountInto(parent: Element): HTMLElement {
    const host = document.createElement('div');
    host.id = NAV_HOST_ID;
    // 防御性盒样式与 main.ts 同理：宿主 div 暴露在页面 CSS 下（通配规则会命中它）
    host.style.cssText =
        'display:inline-flex;align-items:center;align-self:center;vertical-align:middle;' +
        'margin:0 0 0 10px;padding:0;background:none;border:0;box-shadow:none;outline:none;border-radius:0;';
    parent.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    registerTailwindProperties(style);
    shadowRoot.appendChild(style);

    const container = document.createElement('div');
    container.id = 'app';
    // 同 main.ts：daisyUI 的 [data-theme] 刷底色会让 #app 在蓝条上裸露白角
    container.style.setProperty('background-color', 'transparent', 'important');
    shadowRoot.appendChild(container);

    app = createApp({ render: () => h(NavBarControls) });
    app.mount(container);
    return host;
}

function tryMount(): boolean {
    if (document.getElementById(NAV_HOST_ID)?.isConnected) return true;
    unmountHost();
    const menu = document.querySelector(NAV_MENU);
    if (!menu) return false;

    const primary = mountInto(menu.parentElement ?? menu);
    if (hostVisible(primary)) return true;

    unmountHost();
    const fallback = mountInto(menu);
    if (hostVisible(fallback)) return true;

    unmountHost();
    return false;
}

export function startNavBarAutoMount(): void {
    if (timer !== null) return;
    tryMount();
    timer = setInterval(tryMount, POLL_MS);
}

export function stopNavBarAutoMount(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
    unmountHost();
}
