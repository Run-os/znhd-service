/**
 * 客户端（网页）本地 toast —— daisyUI 官方 `toast` + `alert` 原生 DOM 实现，
 * 与脚本端保持一致：状态图标（内联 SVG）+ 可选标题。
 *
 * 为什么不直接用 `@vue/lib/toast`：共享实现把容器挂在**影子树 #app** 下
 * （daisyUI 主题变量由脚本端的 `#app[data-theme]` 提供），而客户端没有影子树，
 * getShadowRoot() 恒为 null ⇒ 共享版在网页里永远静默 no-op。
 * 这里挂 document.body：daisyUI 主题（business）挂在 :root，body 下直接取得到 `--color-*`。
 *
 * API 与共享版一致（success / error / warning / info），App.vue 只改 import 来源；
 * 入参向后兼容：string = 纯消息，{ title?, msg } = 标题 + 正文。
 */
type ToastKind = 'success' | 'error' | 'warning' | 'info';

/** 向后兼容：string = 纯消息；对象可带 title 标题 + msg 正文 */
type ToastInput = string | { title?: string; msg: string };

/** 配色类严格取自 daisyUI alert 的 color 分类 */
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

function ensureContainer(): HTMLElement {
    if (container?.isConnected) return container;
    container = document.createElement('div');
    container.className = 'toast toast-top toast-center z-50';
    container.setAttribute('data-znhd', 'toast');
    document.body.appendChild(container);
    return container;
}

function show(kind: ToastKind, input: ToastInput): void {
    const box = ensureContainer();

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
