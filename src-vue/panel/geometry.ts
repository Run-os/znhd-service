import { loadPanelPoint, savePanelPoint } from '@/lib/storage';
import { PANEL_WIDTH } from '@/lib/ui/panelIds';

/**
 * 面板几何（从 `src/lib/ui/panelHost.tsx` 等价迁出，去掉 React 依赖）。
 *
 * 三条沿用下来的硬约束（改之前先读原注释）：
 *  1) 挂 `document.documentElement`，不挂 body —— 税务页 body 常带 transform/filter，会形成
 *     独立层叠上下文，把 position:fixed 的浮层困在里面。
 *  2) 只用 left/top 定位，不用 transform —— transform 会让后代 fixed 改以本元素为包含块。
 *  3) 存档坐标恢复时要求「整块尽量可见」，拖拽时才允许只留 48px 可抓取区。
 */

const MIN_VISIBLE = 48;
const HANDLE_MIN = 40;

/** 拖拽时的边界：至少留一小块可抓取区（用户可主动贴边藏起来） */
export function clampPanelPoint(pt: { x: number; y: number }, size?: { w?: number; h?: number }) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = size?.w || 320;
    const h = size?.h || 0;
    // 保留量必须与元素自身尺寸取小：悬浮球只有 36px，否则会被算到视口外
    const keepX = Math.min(MIN_VISIBLE, w);
    const keepY = h ? Math.min(HANDLE_MIN, h) : HANDLE_MIN;
    return {
        x: Math.min(Math.max(pt.x, -(w - keepX)), vw - keepX),
        y: Math.min(Math.max(pt.y, 0), vh - keepY),
    };
}

/** 恢复存档 / 视口变化时的边界：放得下就要求整块可见（否则会出现「面板不见了」） */
export function clampIntoView(pt: { x: number; y: number }, w: number, h: number) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
        x: Math.min(Math.max(pt.x, 4), Math.max(4, vw - w - 4)),
        y: Math.min(Math.max(pt.y, 4), Math.max(4, vh - h - 4)),
    };
}

/** 悬浮球展开回面板时：球可以贴边，面板不行 */
export function clampHostIntoView(host: HTMLElement): void {
    const pt = clampIntoView(
        { x: parseFloat(host.style.left) || 0, y: parseFloat(host.style.top) || 0 },
        host.offsetWidth,
        host.offsetHeight
    );
    host.style.left = Math.round(pt.x) + 'px';
    host.style.top = Math.round(pt.y) + 'px';
    savePanelPoint(pt);
}

/** 初始坐标：存档优先；默认落在视口右侧偏中（用视口尺寸，不用屏幕尺寸） */
export function initialPanelPoint(): { x: number; y: number } {
    const saved = loadPanelPoint();
    const pt = saved || { x: Math.round(window.innerWidth * 0.55), y: 12 };
    return clampIntoView(pt, PANEL_WIDTH, 0);
}
