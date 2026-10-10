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
import { OVERLAY_HOST_ID, PANEL_HOST_ID, PANEL_WIDTH } from '@/lib/ui/panelIds';
import { injectUiReset } from '@/lib/ui/uiReset';

// 面板/浮层宿主 id 都定义在 panelIds（叶子模块，供 uiReset 共用、避免循环依赖，也避免 TDZ）；
// 此处转出，保持既有 import 路径可用。
// 浮层宿主 div：v26.10.09-v6 起自建、挂在 documentElement 下、自身不影响布局。
export { OVERLAY_HOST_ID, PANEL_HOST_ID };

/**
 * 浮层容器（antd 的 `getContainer` / `ConfigProvider.getPopupContainer` 都指向它）：
 * **自建的宿主 div**，而**不是 `documentElement` 本身**。
 *
 * ⚠️ 为什么不能直接返回 `documentElement`（v26.10.09-v6 修，实测证据在下面）：
 *   实测（Chrome 154 + React 19）把 `documentElement` 交给 antd/rc-util 的 Portal 时，
 *   浮层**最终仍落在 `<body>` 里**（`document.querySelector('.ant-drawer').parentElement === body`）。
 *   而税务页 `body` 常被加 `transform`/`filter` 形成独立层叠上下文 ⇒ `position:fixed` 的浮层
 *   改以 **body 的盒子**为包含块：
 *     · 抽屉/弹窗的 `inset-y-0` / `h-full` / `top:1/2` 全按 body 的高度算 ——
 *       冒烟 harness 里 `body` 只有 117px 高，实测 `.ant-drawer` 的 rect 就是 `[0,0,1000,117]`
 *       （应为 `[0,0,1000,800]`），常用语按钮落在抽屉盒子之外、**鼠标事件根本到不了**；
 *     · 顺带把浮层压到面板宿主（z-index 999999）**之下** —— body 那个层叠上下文整体先被绘制，
 *       浮层自己的 `zIndexPopupBase=1000000` 出不了 body 的层叠上下文。
 *   换成「自建 div」后包含块回到**视口**，两个问题一起消失（这正是预览层当年用的办法，
 *   见 `shared/preview/host.ts` 的 `getPreviewHost` 与 v26.10.08-v7/8 的踩坑记录）。
 *
 * ⚠️ 宿主 div 自身**不带任何样式**：它在 `<html>` 的普通流里、没有尺寸（子节点全是 fixed/absolute），
 *   既不创建层叠上下文也不影响布局；antd 浮层的 z-index 因此在**根层叠上下文**里生效，
 *   能正确盖住面板宿主。
 *
 * ⚠️ 隔离层（`uiReset.ts`）用的是 `.ant-*` 类选择器而不是容器前缀，浮层换容器后复位规则照旧命中。
 */
export function getOverlayContainer(): HTMLElement {
    let el = document.getElementById(OVERLAY_HOST_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = OVERLAY_HOST_ID;
        document.documentElement.appendChild(el);
    }
    return el;
}

// 边界约束：标题栏是唯一可抓取区，必须始终露出一部分，否则拖出去就抓不回来
const MIN_VISIBLE = 48; // 水平方向至少留在视口内的像素
const HANDLE_MIN = 40; // 垂直方向至少保留的标题栏高度

/**
 * 「拖动」与「点击」的判定阈值（px）：指针位移超过它才算拖动。
 *
 * 为什么必须区分（v26.10.07-v3 实测 Chrome 154）：`pointerdown` 里调用 `preventDefault()`
 * **并不能**阻止后续的 `click` —— 原地点击序列是 `pd|pu|click`，拖拽序列是
 * `pd|pm×N|pu|click`，两者最后都会派发 click。悬浮球既要「点击展开」又要「拖动移动」，
 * 不区分就会出现「拖完一松手面板被顺带展开」。
 */
const DRAG_THRESHOLD = 4;

/** 把坐标裁剪到视口内（与旧实现同参数） */
export function clampPanelPoint(pt: { x: number; y: number }, size?: { w?: number; h?: number }) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = size && size.w ? size.w : 320;
    const h = size && size.h ? size.h : 0;
    // ⚠️ 保留量必须与元素自身尺寸取小：悬浮球只有 36px，若仍要求「至少留 48px」，
    //    minX 会被算成 +12 —— 表现为「悬浮球拖不到视口最左侧」（v26.10.07-v3 加悬浮球拖拽时踩到）。
    //    面板宽度 340 > 48，keepX 仍是 48，行为与旧实现完全一致。
    const keepX = Math.min(MIN_VISIBLE, w);
    const keepY = h ? Math.min(HANDLE_MIN, h) : HANDLE_MIN;
    const minX = -(w - keepX);
    const maxX = vw - keepX;
    const minY = 0;
    const maxY = vh - keepY;
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

/** 按「整块尽量可见」把宿主裁回视口并存档（悬浮球展开回面板时用：球可以贴边，面板不行） */
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

/** 读取存档位置（无存档时给默认坐标），先按默认尺寸做一次粗裁剪 */
function initialPoint(): { x: number; y: number } {
    const saved = loadPanelPoint();
    // ⚠️ 默认坐标必须用 innerWidth/innerHeight（视口），不能用 screen.width/height（物理屏幕）：
    // 在多屏或缩窄窗口时二者差别很大，用后者会把面板初始位置算到视口外。
    const pt = saved || { x: Math.round(window.innerWidth * 0.55), y: 12 };
    return clampIntoView(pt, PANEL_WIDTH, 0);
}

let root: Root | null = null;

/** 创建宿主并挂载 React 面板，返回宿主元素 */
export function mountPanel(): HTMLElement {
    // 先注入样式隔离层：宿主页面的全局 CSS（居中、非 border-box、svg 对齐等）会污染 antd 组件外观，
    // 详见 uiReset.ts。（必须在渲染前，避免第一帧抖动）
    injectUiReset();
    const host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    // 方案 B（v26.10.06-v15）：面板层级仍高于宿主页面自身内容（页面弹窗多在 1000~9999），
    // 但**低于 antd 浮层的基数**（见 PanelApp 的 zIndexPopupBase=1000000）——
    // 于是 Modal / Drawer / message 都会盖在面板之上（弹窗遮罩也会遮住面板，符合常规层级直觉）。
    host.style.cssText = 'position:fixed;z-index:999999;left:0;top:0;';
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

// 面板自愈（v26.10.10-v8 新增）
let panelWatcher: MutationObserver | null = null;

/**
 * 面板被宿主页删除时立即重新挂回（幂等），供自愈监听器复用。
 *
 * ⚠️ 自己删除并重建：宿主页删掉的只是**容器 div**，若直接按同一个 root 再 render，
 *   组件树会继续挂在已脱离文档的旧宿主上（位置/拖拽都失效）。而 createRoot 在旧 root
 *   尚存时会对同一容器报 warning，所以这里先正规卸载旧 root、再走 mountPanel() 重建。
 * ⚠️ 卸载会触发面板自身的 cleanup（设备互联长轮询/手机在线轮询被停掉），重建后全新实例会重启它们，
 *   故不要改成「只 appendChild 旧节点」的写法。
 */
function remountPanel(): void {
    unmountPanel();
    mountPanel();
}

/**
 * 监听面板宿主被宿主页删除并自动重挂。
 *
 * 税务页是单页应用：路由切换或框架重绘 `documentElement` 子树时，会把我们 append 进去的
 * `PANEL_HOST_ID` 容器（以及 antd 浮层宿主）一并删掉，而挂载只在 `app.ts` 启动时发生一次 ⇒
 * 面板与悬浮球永久消失、用户失去唯一入口，但监控/语音/长轮询都还在后台跑（静默故障）。
 *
 * 策略（对应油猴指南 `02.实用知识库/01.JavaScript 知识篇/09.MutationObserve 知识/03.MutationObserve实战.md`：
 * 「如果在 removedNodes 属性中的数组中找到 button 元素，就再次执行插入操作」、
 * `01.油猴教程/01.入门篇/07.使用脚本向页面上添加新元素.md`：
 * 「反复监听重新渲染判断是否存在，如果不存在就再次插入」「提前判断了按钮是否存在」）：
 *  - 只观察 `documentElement` 的**直接子节点**增删。面板自身 DOM 变化都在宿主容器**内部**，
 *    不会命中这个目标；自家浮层（`#__znhd_overlay_host__`、antd 弹窗）的进出会附带触发回调，
 *    但回调里「先判存在再补挂」是幂等的，没有副作用（回调也不会与观察目标相互触发）。
 *  - 在**微任务**里判断（flag + queueMicrotask），等本轮 DOM 变更结算完，避免中途误判。
 * @returns {void}
 */
export function watchPanelHost(): void {
    if (panelWatcher) return; // 幂等：重复调用不叠加观察器
    let pending = false;
    panelWatcher = new MutationObserver(() => {
        if (pending) return;
        pending = true;
        queueMicrotask(() => {
            pending = false;
            // ⚠️ 只信「还在不在文档里」，且必须重新查 DOM：模块级的 host 引用可能是已脱离文档的旧节点
            if (!document.getElementById(PANEL_HOST_ID)?.isConnected) {
                remountPanel();
            }
        });
    });
    panelWatcher.observe(document.documentElement, { childList: true });
}

/** 停止面板自愈监听（页面卸载时调用，对应 watchPanelHost） */
export function unwatchPanelHost(): void {
    if (panelWatcher) {
        panelWatcher.disconnect();
        panelWatcher = null;
    }
}

/**
 * 面板拖拽：把事件绑到可抓取区即可 —— 展开态绑标题栏，收起态绑悬浮球。
 * @param host 面板宿主元素（定位写它的 left/top）
 * @returns 需要挂到可抓取区上的指针事件处理器 + `consumeDrag()`（供 onClick 判断「这次点击是不是拖拽的尾巴」）
 */
export function usePanelDrag(host: HTMLElement) {
    const dragRef = useRef<{ dx: number; dy: number } | null>(null);
    const startRef = useRef<{ x: number; y: number } | null>(null);
    /** 本次按下是否真的拖动过（位移超过 DRAG_THRESHOLD） */
    const movedRef = useRef(false);

    const onPointerDown = useCallback(
        (e: React.PointerEvent) => {
            // 只响应主键（触摸/鼠标左键）
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            const rect = host.getBoundingClientRect();
            dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
            startRef.current = { x: e.clientX, y: e.clientY };
            movedRef.current = false;
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
            e.preventDefault();
        },
        [host]
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent) => {
            const d = dragRef.current;
            if (!d) return;
            const s = startRef.current;
            if (s && !movedRef.current) {
                if (Math.abs(e.clientX - s.x) > DRAG_THRESHOLD || Math.abs(e.clientY - s.y) > DRAG_THRESHOLD) {
                    movedRef.current = true;
                }
            }
            const pt = clampPanelPoint(
                { x: e.clientX - d.dx, y: e.clientY - d.dy },
                { w: host.offsetWidth, h: host.offsetHeight }
            );
            host.style.left = Math.round(pt.x) + 'px';
            host.style.top = Math.round(pt.y) + 'px';
        },
        [host]
    );

    const endDrag = useCallback(() => {
        if (!dragRef.current) return;
        dragRef.current = null;
        startRef.current = null;
        const pt = { x: parseFloat(host.style.left) || 0, y: parseFloat(host.style.top) || 0 };
        const clamped = clampPanelPoint(pt, { w: host.offsetWidth, h: host.offsetHeight });
        host.style.left = Math.round(clamped.x) + 'px';
        host.style.top = Math.round(clamped.y) + 'px';
        savePanelPoint(clamped);
    }, [host]);

    /**
     * 取走「本次是否拖动过」并复位。
     * 悬浮球的 onClick 里用它：拖动过就不要再展开面板。取走后立刻复位，
     * 避免这个标记残留到下一次**键盘**触发的 click（键盘激活不会经过 pointerdown）。
     */
    const consumeDrag = useCallback(() => {
        const moved = movedRef.current;
        movedRef.current = false;
        return moved;
    }, []);

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

    return { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, consumeDrag };
}
