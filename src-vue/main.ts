import { createApp, h, type App as VueApp } from 'vue';
import App from './App.vue';
import css from './style.css?inline';
import { SHADOW_ROOT_KEY } from './lib/shadow';
import { PANEL_HOST_ID } from '@/lib/ui/panelIds';
import { initialPanelPoint } from './panel/geometry';

/**
 * 面板宿主 + ShadowDOM 挂载（约束文档「入口固定范式」）：
 *   host（fixed，z-index 999999，挂 documentElement）
 *     └─ #shadow-root (mode: open)
 *          ├─ <style>  ← Tailwind 产物（?inline 字符串）
 *          └─ #app     ← Vue 挂载点
 *
 * 为什么挂 documentElement 而不是 body：税务页 body 常带 transform/filter，
 * 会形成独立层叠上下文，把 position:fixed 的浮层困在里面（沿用 panelHost.tsx 的结论）。
 */
let app: VueApp | null = null;

export function mountPanel(): HTMLElement {
    const existing = document.getElementById(PANEL_HOST_ID);
    if (existing) return existing;

    const host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    host.style.cssText = 'position:fixed;z-index:999999;left:0;top:0;';
    const pt = initialPanelPoint();
    host.style.left = Math.round(pt.x) + 'px';
    host.style.top = Math.round(pt.y) + 'px';
    document.documentElement.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });

    // 样式必须在首帧前进影子树：Vite 把 Tailwind 编译后的 CSS 以字符串交给我们，
    // 不能依赖插件往 document.head 注入（那样 :host 与工具类在影子树里都不可见）。
    const style = document.createElement('style');
    style.textContent = css;
    shadowRoot.appendChild(style);

    const appContainer = document.createElement('div');
    appContainer.id = 'app';
    shadowRoot.appendChild(appContainer);

    app = createApp({ render: () => h(App, { host }) });
    app.provide(SHADOW_ROOT_KEY, shadowRoot);
    app.mount(appContainer);

    return host;
}

export function unmountPanel(): void {
    try {
        app?.unmount();
    } catch {
        /* 重复卸载忽略 */
    }
    app = null;
    document.getElementById(PANEL_HOST_ID)?.remove();
}

/**
 * 面板自愈：宿主页是 SPA，路由切换/框架重绘会把我们 append 到 documentElement 的容器删掉。
 * 只观察 documentElement 的直接子节点增删，回调里先判存在再补挂（幂等）。
 */
let watcher: MutationObserver | null = null;

export function watchPanelHost(): void {
    if (watcher) return;
    let pending = false;
    watcher = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        queueMicrotask(() => {
            pending = false;
            if (!document.getElementById(PANEL_HOST_ID)?.isConnected) {
                unmountPanel();
                mountPanel();
            }
        });
    });
    watcher.observe(document.documentElement, { childList: true });
}

export function unwatchPanelHost(): void {
    watcher?.disconnect();
    watcher = null;
}
