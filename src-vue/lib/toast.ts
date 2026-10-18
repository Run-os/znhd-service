import { getShadowRoot } from './shadow';

/**
 * 轻量 toast（Vue 侧替代 React 版的 `notify`）。
 *
 * 为什么手写而不是上 sonner：
 *   · sonner / vue-sonner 把**样式表注入 document.head**，而我们的整个 UI 活在 ShadowDOM 里，
 *     影子树拿不到那些规则 ⇒ 弹出来的提示是裸文本（2026-10-18 评估）；
 *   · 这里只有 4 种语气、纯文本、3 秒自动消失，用 Tailwind 类 + 影子树内节点即可，
 *     零新增依赖、零额外体积。
 *
 * 位置：挂在 shadowRoot 顶部居中。容器 `pointer-events:none`，不挡面板点击。
 */
const HOST_ID = 'znhd-toast-host';

type Level = 'success' | 'error' | 'warning' | 'info';

const LEVEL_STYLE: Record<Level, { bar: string; text: string }> = {
    success: { bar: 'bg-[#52c41a]', text: 'text-[#262626]' },
    error: { bar: 'bg-[#ff4d4f]', text: 'text-[#262626]' },
    warning: { bar: 'bg-[#faad14]', text: 'text-[#262626]' },
    info: { bar: 'bg-[#1677ff]', text: 'text-[#262626]' },
};

function ensureHost(): HTMLElement | null {
    const root = getShadowRoot();
    if (!root) return null;
    let host = root.getElementById(HOST_ID);
    if (!host) {
        host = document.createElement('div');
        host.id = HOST_ID;
        host.className = 'pointer-events-none fixed left-1/2 top-4 z-[1000010] flex -translate-x-1/2 flex-col items-center gap-2';
        root.appendChild(host);
    }
    return host;
}

function push(level: Level, message: string): void {
    const host = ensureHost();
    if (!host) return; // 面板尚未挂载：静默丢弃（启动早期信息走 addLog）

    const style = LEVEL_STYLE[level];
    const item = document.createElement('div');
    item.className =
        'pointer-events-auto flex max-w-[360px] items-start gap-2 overflow-hidden rounded-[8px] border border-[#f0f0f0] bg-white py-2 pl-0 pr-3 text-[13px] leading-5 shadow-[0_6px_16px_-8px_rgba(0,0,0,0.08),0_9px_28px_8px_rgba(0,0,0,0.05)] ' +
        style.text;
    const bar = document.createElement('span');
    bar.className = 'mt-0 h-full min-h-5 w-[3px] shrink-0 self-stretch ' + style.bar;
    const text = document.createElement('span');
    text.className = 'break-words';
    text.textContent = message;
    item.append(bar, text);
    host.appendChild(item);

    window.setTimeout(() => {
        item.remove();
        if (!host.childElementCount) host.remove();
    }, 3000);
}

export const toast = {
    success: (msg: string) => push('success', msg),
    error: (msg: string) => push('error', msg),
    warning: (msg: string) => push('warning', msg),
    info: (msg: string) => push('info', msg),
};
