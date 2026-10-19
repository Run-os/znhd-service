/**
 * 客户端（网页）本地 toast —— daisyUI 官方 `toast` + `alert` 原生 DOM 实现。
 *
 * 为什么不直接用 `@vue/lib/toast`：共享实现把容器挂在**影子树 #app** 下
 * （daisyUI 主题变量由脚本端的 `#app[data-theme]` 提供），而客户端没有影子树，
 * getShadowRoot() 恒为 null ⇒ 共享版在网页里永远静默 no-op。
 * 这里挂 document.body：daisyUI 主题（business）挂在 :root，body 下直接取得到 `--color-*`。
 *
 * API 与共享版一致（success / error / warning / info），App.vue 只改 import 来源。
 */
type ToastKind = 'success' | 'error' | 'warning' | 'info';

/** 配色类严格取自 daisyUI alert 的 color 分类 */
const KIND_CLASS: Record<ToastKind, string> = {
    success: 'alert-success',
    error: 'alert-error',
    warning: 'alert-warning',
    info: 'alert-info',
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

function show(kind: ToastKind, msg: string): void {
    const box = ensureContainer();
    const el = document.createElement('div');
    el.className = `alert ${KIND_CLASS[kind]}`;
    el.setAttribute('role', 'alert');
    el.textContent = msg;
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
    success: (msg: string) => show('success', msg),
    error: (msg: string) => show('error', msg),
    warning: (msg: string) => show('warning', msg),
    info: (msg: string) => show('info', msg),
};
