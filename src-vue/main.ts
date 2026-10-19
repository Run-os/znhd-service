import { createApp, h, type App as VueApp } from 'vue';
import App from './App.vue';
import css from './style.css?inline';
import { SHADOW_ROOT_KEY, setShadowRoot } from './lib/shadow';
import { initTheme } from './lib/theme';
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
/**
 * Tailwind v4 用 `@property` 给 --tw-* 工具类变量提供初值（如 --tw-border-style: solid）。
 * ⚠️ Chromium 只在**文档级**样式表处理 @property，影子树 <style> 里的声明会被忽略 ——
 * 后果是 shadow DOM 里 border / shadow / ring / transform 等依赖初值的工具类全部退化
 * （实测：border-b 算出 0px 宽）。CSS.registerProperty 是文档级 JS API，可以绕过该限制：
 * 在注入样式前把构建产物里声明的 @property 逐个重新注册。
 * 页面若已注册同名属性则抛错，忽略即可（同名注册语义一致，页面版本优先生效）。
 */
function registerTailwindProperties(styleEl: HTMLStyleElement): void {
    const re = /@property\s+(--[\w-]+)\s*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(styleEl.textContent ?? '')) !== null) {
        const [, name, body] = m;
        const pick = (key: string): string | undefined => {
            const hit = new RegExp(key + '\\s*:\\s*([^;}]+)').exec(body);
            return hit ? hit[1].trim() : undefined;
        };
        try {
            CSS.registerProperty({
                name,
                // CSS 文本里 syntax 是带引号的字符串（syntax:"*"），JS API 要去掉引号
                syntax: (pick('syntax') ?? '*').replace(/^["']+|["']+$/g, ''),
                inherits: pick('inherits') === 'true',
                initialValue: pick('initial-value'),
            });
        } catch {
            /* 页面已注册同名属性或重复注册 —— 忽略 */
        }
    }
}

let app: VueApp | null = null;

export function mountPanel(): HTMLElement {
    const existing = document.getElementById(PANEL_HOST_ID);
    if (existing) return existing;

    const host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    host.style.cssText = 'position:fixed;z-index:999999;left:0;top:0;margin:0;padding:0;';
    // 防御性盒样式重置：shadow DOM 只保护影子树内部，宿主 div 本身会被页面 CSS 命中
    //（如暗色插件/通配 div 规则的背景强涂）——表现为面板/悬浮球圆角外露出「黑色直角」。
    // 视觉外观属性必须用内联 !important 钉死：v10 用普通内联仍被带 !important 的页面
    // 规则盖过（实测右下角黑角还在）。级联规则：同元素上，内联 !important 优先级
    // 高于页面样式表的 !important，是样式表无法突破的最终档位。
    for (const [k, v] of [
        ['background', 'none'],
        ['background-color', 'transparent'],
        ['border', '0'],
        ['box-shadow', 'none'],
        ['outline', 'none'],
        ['border-radius', '0'],
        ['filter', 'none'],
        ['backdrop-filter', 'none'],
        ['text-shadow', 'none'],
    ] as const) {
        host.style.setProperty(k, v, 'important');
    }
    const pt = initialPanelPoint();
    host.style.left = Math.round(pt.x) + 'px';
    host.style.top = Math.round(pt.y) + 'px';
    document.documentElement.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    setShadowRoot(shadowRoot);

    // 样式必须在首帧前进影子树：Vite 把 Tailwind 编译后的 CSS 以字符串交给我们，
    // 不能依赖插件往 document.head 注入（那样 :host 与工具类在影子树里都不可见）。
    const style = document.createElement('style');
    style.textContent = css;
    registerTailwindProperties(style);
    shadowRoot.appendChild(style);

    const appContainer = document.createElement('div');
    appContainer.id = 'app';
    shadowRoot.appendChild(appContainer);

    // 主题：daisyUI 的 `[data-theme=...]` 选择器只在**影子树内部**生效
    //（`:host` 是跨边界的伪类，普通属性选择器选不到宿主），因此挂载点是 #app 而不是 host。
    // 首帧前完成，避免日→夜闪一下。
    initTheme(appContainer);

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
    setShadowRoot(null);
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
