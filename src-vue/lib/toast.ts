import { getShadowRoot } from './shadow';

/**
 * 全局提示 —— 底层换成 daisyUI 原生 `toast` 容器 + `alert`。
 *
 * ── 为什么是命令式 DOM 而不是 Vue 组件 ──────────────────────────────────────
 * daisyUI 的 toast 只是一个「堆叠定位容器」（skill/components/toast.md：
 * 只有 `toast` + 方向类，没有任何状态或队列），没有命令式 API。
 * 为了不在业务侧新增任何自定义组件/样式，这里直接用原生 DOM 拼官方结构：
 *
 *   <div class="toast toast-top toast-center">
 *     <div role="alert" class="alert alert-success">消息</div>
 *   </div>
 *
 * 容器必须挂在**影子树内的 #app 下**：daisyUI 的主题变量由 `#app[data-theme]` 提供，
 * 挂在 shadowRoot 直下就取不到 `--color-*`，alert 会没有配色。
 *
 * 保留 `success / error / warning / info` 四个方法名，业务调用点无需改动。
 */
type ToastKind = 'success' | 'error' | 'warning' | 'info';

/** 配色类严格取自 skill/components/alert.md 的 color 分类 */
const KIND_CLASS: Record<ToastKind, string> = {
    success: 'alert-success',
    error: 'alert-error',
    warning: 'alert-warning',
    info: 'alert-info',
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

function show(kind: ToastKind, msg: string): void {
    const box = ensureContainer();
    if (!box) return;

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
