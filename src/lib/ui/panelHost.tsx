/**
 * 面板宿主：把 React + Ant Design 面板挂到税务页上，并负责「位置 + 拖拽」。
 *
 * 三个关键取舍（都影响能不能用，改之前先读）：
 *  1) **挂 documentElement 而不是 body**：税务页 body 常被加 transform/filter 形成独立层叠上下文，
 *     会把 position:fixed 的浮层困在里面（仓库既有结论，gallery 弹窗当年也是因此挂 html）。
 *  2) **定位用 left/top，不用 transform**：transform 会让后代 position:fixed 改以本元素为包含块，
 *     弹窗会被「困」在面板里；CAT_UI 当年用 react-draggable 的 transform，本实现不再沿用。
 *  3) **不再使用 Shadow DOM**：antd 的弹窗/浮层默认 portal 到 body，样式走 document.head 的
 *     CSS-in-JS；若把组件塞进 shadow root，两者都进不去 → 弹窗会变成无样式裸 DOM。
 *     故这里用普通容器 + antd 全局样式，浮层统一 portal 到 documentElement（见 getOverlayContainer）。
 *     ⚠️ CAT_UI 当年是 Shadow DOM 方案，`panelPosition.ts` 里「穿透 shadowRoot 找面板」的代码随之作废。
 *
 * 拖拽：只允许标题栏拖动（HANDLE），指针事件实现，落点做视口裁剪，保证「可抓取区」始终可见。
 */

import { createRoot, type Root } from 'react-dom/client';
import { useCallback, useEffect, useRef } from 'react';
import PanelApp from './PanelApp';
import { loadPanelPoint, savePanelPoint } from '@/lib/storage';
import { PANEL_HOST_ID } from '@/lib/ui/panelIds';
import { injectUiReset } from '@/lib/ui/uiReset';

// 面板宿主 id 定义在 panelIds（供 uiReset 共用，避免循环依赖）；此处转出，保持既有 import 路径可用
export { PANEL_HOST_ID };

/** 浮层容器：所有弹窗/浮层统一挂到 documentElement，避开 body 的层叠上下文 */
export function getOverlayContainer(): HTMLElement {
    return document.documentElement;
}

// 边界约束：标题栏是唯一可抓取区，必须始终露出一部分，否则拖出去就抓不回来
const MIN_VISIBLE = 48; // 水平方向至少留在视口内的像素
const HANDLE_MIN = 40; // 垂直方向至少保留的标题栏高度

/** 把坐标裁剪到视口内（与旧实现同参数） */
export function clampPanelPoint(pt: { x: number; y: number }, size?: { w?: number; h?: number }) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = size && size.w ? size.w : 320;
    const minX = -(w - MIN_VISIBLE);
    const maxX = vw - MIN_VISIBLE;
    const minY = 0;
    const maxY = vh - HANDLE_MIN;
    return {
        x: Math.min(Math.max(pt.x, minX), maxX),
        y: Math.min(Math.max(pt.y, minY), maxY),
    };
}

/**
 * 把坐标约束到「尽量完整可见」（挂载与窗口尺寸变化时用）。
 *
 * ⚠️ 与 clampPanelPoint 的区别：那个只保证留 48px 可抓取（拖拽时允许用户主动贴边藏起来），
 * 用它来**恢复存档坐标**会出事——存档若来自更宽的窗口/别的显示器，面板会被算到视口外，
 * 只剩一条边（用户看到的是「面板不见了/按钮点不到」）。所以这里在放得下的前提下要求整块可见。
 */
export function clampIntoView(pt: { x: number; y: number }, w: number, h: number) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const maxX = Math.max(4, vw - w - 4);
    const maxY = Math.max(4, vh - h - 4);
    return {
        x: Math.min(Math.max(pt.x, 4), maxX),
        y: Math.min(Math.max(pt.y, 4), maxY),
    };
}

/** 读取存档位置（无存档时给默认坐标），先按默认尺寸做一次粗裁剪 */
function initialPoint(): { x: number; y: number } {
    const saved = loadPanelPoint();
    // ⚠️ 默认坐标必须用 innerWidth/innerHeight（视口），不能用 screen.width/height（物理屏幕）：
    // 在多屏或缩窄窗口时二者差别很大，用后者会把面板初始位置算到视口外。
    const pt = saved || { x: Math.round(window.innerWidth * 0.55), y: 12 };
    return clampIntoView(pt, 340, 0);
}

let root: Root | null = null;

/** 创建宿主并挂载 React 面板，返回宿主元素 */
export function mountPanel(): HTMLElement {
    // 先注入样式隔离层：宿主页面的全局 CSS（居中、非 border-box、svg 对齐等）会污染 antd 组件外观，
    // 详见 uiReset.ts。（必须在渲染前，避免第一帧抖动）
    injectUiReset();
    const host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    host.style.cssText = 'position:fixed;z-index:2147482000;left:0;top:0;';
    const pt = initialPoint();
    host.style.left = Math.round(pt.x) + 'px';
    host.style.top = Math.round(pt.y) + 'px';
    document.documentElement.appendChild(host);
    root = createRoot(host);
    root.render(<PanelApp host={host} />);
    return host;
}

/** 卸载面板（页面卸载/热重载清理用） */
export function unmountPanel(): void {
    try {
        root?.unmount();
    } catch (e) {
        /* 忽略重复卸载 */
    }
    root = null;
    const ex = document.getElementById(PANEL_HOST_ID);
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
}

/**
 * 面板拖拽：把事件绑到标题栏即可。
 * @param host 面板宿主元素（定位写它的 left/top）
 * @returns 需要挂到标题栏上的指针事件处理器
 */
export function usePanelDrag(host: HTMLElement) {
    const dragRef = useRef<{ dx: number; dy: number } | null>(null);

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            // 只响应主键（触摸/鼠标左键）
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            const rect = host.getBoundingClientRect();
            dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            e.preventDefault();
        },
        [host]
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            const d = dragRef.current;
            if (!d) return;
            const pt = clampPanelPoint({ x: e.clientX - d.dx, y: e.clientY - d.dy }, { w: host.offsetWidth });
            host.style.left = Math.round(pt.x) + 'px';
            host.style.top = Math.round(pt.y) + 'px';
        },
        [host]
    );

    const endDrag = useCallback(() => {
        if (!dragRef.current) return;
        dragRef.current = null;
        const pt = { x: parseFloat(host.style.left) || 0, y: parseFloat(host.style.top) || 0 };
        const clamped = clampPanelPoint(pt, { w: host.offsetWidth });
        host.style.left = Math.round(clamped.x) + 'px';
        host.style.top = Math.round(clamped.y) + 'px';
        savePanelPoint(clamped);
    }, [host]);

    // 视口尺寸变化时重新裁剪，避免面板被挤出可视范围
    useEffect(() => {
        const clampNow = (persist: boolean) => {
            // 用真实尺寸要求「整块可见」；拖拽过程中的贴边约束仍走 clampPanelPoint（允许只留 48px）
            const pt = clampIntoView(
                { x: parseFloat(host.style.left) || 0, y: parseFloat(host.style.top) || 0 },
                host.offsetWidth,
                host.offsetHeight
            );
            host.style.left = Math.round(pt.x) + 'px';
            host.style.top = Math.round(pt.y) + 'px';
            if (persist) savePanelPoint(pt);
        };
        // 挂载后先按「面板真实宽度」裁剪一次：存档坐标可能来自更宽的窗口或多屏，
        // 若只按默认宽度裁剪，面板会被算到视口外（只剩 48px 可抓取 → 表现为「按钮点不到」）。
        // 首次提交后 host.offsetWidth 才可用，故放在 effect 里而不是初始坐标计算里。
        clampNow(false);
        const onResize = () => clampNow(true);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [host]);

    return { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag };
}
