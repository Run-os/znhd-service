import { getShadowRoot } from './shadow';

/**
 * 全局提示 —— 底层用 daisyUI 原生 `toast` 容器 + `alert`，按官方结构美化：
 * 每个类型带状态图标（内联 SVG），支持可选标题 + 正文。
 *
 * ── 为什么是命令式 DOM 而不是 Vue 组件 ──────────────────────────────────────
 * daisyUI 的 toast 只是一个「堆叠定位容器」（skill/components/toast.md：
 * 只有 `toast` + 方向类，没有任何状态或队列），没有命令式 API。
 * 为了不在业务侧新增任何自定义组件/样式，这里直接用原生 DOM 拼官方结构：
 *
 *   <div class="toast toast-top toast-center">
 *     <div role="alert" class="alert alert-success">
 *       <svg …/>            ← 官方 alert 状态图标（内联 SVG）
 *       <div>标题 / 正文</div>
 *     </div>
 *   </div>
 *
 * 图标尺寸/描边类取自 daisyUI 官方 alert 示例，无新增样式。
 * 容器必须挂在**影子树内的 #app 下**：daisyUI 的主题变量由 `#app[data-theme]` 提供，
 * 挂在 shadowRoot 直下就取不到 `--color-*`，alert 会没有配色。
 *
 * 保留 `success / error / warning / info` 四个方法名，业务调用点无需改动；
 * 入参向后兼容：传 string 视为纯消息，传 { title?, msg } 可带标题。
 */
type ToastKind = 'success' | 'error' | 'warning' | 'info';

/** 向后兼容：string = 纯消息；对象可带 title 标题 + msg 正文 */
type ToastInput = string | { title?: string; msg: string };

/** 配色类严格取自 skill/components/alert.md 的 color 分类 */
const KIND_CLASS: Record<ToastKind, string> = {
    success: 'alert-success',
    error: 'alert-error',
    warning: 'alert-warning',
    info: 'alert-info',
};

/** 状态图标：daisyUI 官方 alert 示例同款 Heroicons path，仅内联 SVG，零自定义样式 */
const KIND_ICON: Record<ToastKind, string> = {
    success:
        '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="h-6 w-6 shrink-0 stroke-current" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    error:
        '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="h-6 w-6 shrink-0 stroke-current" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
    warning:
        '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="h-6 w-6 shrink-0 stroke-current" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>',
    info:
        '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="h-6 w-6 shrink-0 stroke-current" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
};

const DURATION = 3200;

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement | null {
    const root = getShadowRoot();
    if (!root) return null;
    if (container?.isConnected) return container;

    const host = root.querySelector('#app') ?? root;
    container = document.createElement('div');
    container.className = 'toast toast-top toast-center';
    container.setAttribute('data-znhd', 'toast');
    host.appendChild(container);
    return container;
}

function show(kind: ToastKind, input: ToastInput): void {
    const box = ensureContainer();
    if (!box) return;

    const title = typeof input === 'string' ? '' : (input.title ?? '');
    const msg = typeof input === 'string' ? input : input.msg;

    const el = document.createElement('div');
    el.className = `alert ${KIND_CLASS[kind]}`;
    el.setAttribute('role', 'alert');

    // 图标是固定常量，可直接注入；标题/正文一律走 textContent，避免 HTML 注入
    el.innerHTML = KIND_ICON[kind];

    const textWrap = document.createElement('div');
    if (title) {
        const h = document.createElement('h3');
        h.className = 'font-bold';
        h.textContent = title;
        textWrap.appendChild(h);
        const d = document.createElement('div');
        d.className = 'text-sm';
        d.textContent = msg;
        textWrap.appendChild(d);
    } else {
        textWrap.className = 'text-sm';
        textWrap.textContent = msg;
    }
    el.appendChild(textWrap);

    box.appendChild(el);

    window.setTimeout(() => {
        el.remove();
        if (container && container.childElementCount === 0) {
            container.remove();
            container = null;
        }
    }, DURATION);
}

export const toast = {
    success: (msg: ToastInput) => show('success', msg),
    error: (msg: ToastInput) => show('error', msg),
    warning: (msg: ToastInput) => show('warning', msg),
    info: (msg: ToastInput) => show('info', msg),
};
