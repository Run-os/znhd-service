/**
 * 面板位置保存（原 app.ts 中 setupPanelPositionTracking 的具名 IIFE）。
 * 模块化 P5：逐字迁移，仅把 IIFE 改为导出函数，调用点移回 app()。
 * 关键事实与踩坑见块内注释（Shadow DOM、react-draggable transform）。
 */

import { loadPanelPoint, savePanelPoint } from '@/lib/storage';

// ==========面板位置保存==========
// 关键事实（已核对 CAT_UI 源码）：
//  1) createPanel 不提供 onDrag 回调，位置恢复只能靠 point 选项（已在上面用 loadPanelPoint 实现）。
//  2) 面板渲染在 Shadow DOM 内（attachShadow open），普通 document 选择器穿不透，必须走 shadowRoot。
//  3) 面板由 react-draggable 实现拖拽，拖拽时改写内部层的 transform: translate(x,y)。
// 本模块只负责「保存」：定位 shadow 内的面板 → 监听拖拽 → 用 getBoundingClientRect 存真实视口坐标。
// 下次加载时 createPanel 的 point 即读取该存档，形成闭环。
export function setupPanelPositionTracking() {
    const PDBG = false; // 诊断开关：验证通过后可改 false

    // resize 监听句柄（保存引用，供页面卸载时移除，避免监听器残留）
    let resizeHandler: (() => void) | null = null;

    // 缓存已扫描到的 shadow 宿主（面板宿主由 ScriptCat 插入，扫描到后结构不再变化）
    let shadowHostsCache: Element[] | null = null;

    // 收集页面上所有带 open shadowRoot 的宿主元素
    /**
     * 收集页面上所有带有 open shadowRoot 的宿主元素（用于穿透 Shadow DOM 定位面板）。
     * 结果做缓存：首次扫描到非空结果后直接复用，避免定时器里反复全树遍历 `querySelectorAll('*')`；
     * 空结果不缓存（面板可能尚未插入 DOM），下次仍会重新扫描。
     * @returns {Array<Element>} 带有 shadowRoot 的 DOM 元素数组
     */
    function getShadowHosts() {
        if (shadowHostsCache) return shadowHostsCache;
        const hosts: Element[] = [];
        document.querySelectorAll('*').forEach((el) => {
            if (el.shadowRoot) hosts.push(el);
        });
        if (hosts.length) shadowHostsCache = hosts;
        return hosts;
    }

    // 穿透 Shadow DOM 定位面板主体（shadow 内含本脚本标题、且带内联 left/top 的 div）
    /**
     * 穿透 Shadow DOM 定位面板主体：在带 shadowRoot 的宿主中查找含本脚本标题、且带内联 left/top 的 div。
     * @returns {(Element|null)} 找到返回面板主体元素，否则返回 null
     */
    function findPanelRoot() {
        for (const host of getShadowHosts()) {
            const sr = host.shadowRoot;
            if (!sr || !sr.textContent || !sr.textContent.includes('征纳互动监控')) continue;
            const divs = sr.querySelectorAll('div');
            for (const el of divs) {
                if (el.style && el.style.left && el.style.top) return el;
            }
            const container = sr.querySelector('.container');
            if (container) return container;
        }
        return null;
    }

    // 在面板内找当前带 transform: translate 的拖拽层（react-draggable 施加）
    /**
     * 在面板子树中查找当前被 react-draggable 施加 transform: translate 的拖拽层。
     * @param {Element} root - 面板根元素
     * @returns {(Element|null)} 找到返回拖拽层元素，否则返回 null
     */
    function findDraggableNode(root: any) {
        const all = root.querySelectorAll('*');
        for (const el of all) {
            const t = (el.style && el.style.transform) || '';
            if (t.indexOf('translate') !== -1) return el;
        }
        return null;
    }

    // 读取面板当前真实视口坐标：优先取被拖拽的层（transform 后位置随之变化），
    // 否则取面板主体本身。getBoundingClientRect 与 createPanel 的 point 同坐标系。
    /**
     * 读取面板当前真实视口坐标：优先取被拖拽层（transform 后位置随之变化），否则取面板主体本身。
     * @param {Element} root - 面板根元素
     * @returns {{x:number,y:number}} 面板左上角的视口坐标（四舍五入）
     */
    function getCurrentPoint(root: any) {
        const el = findDraggableNode(root) || root;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top) };
    }

    // 边界约束：面板只有顶部标题栏可拖动，必须保证该「可抓取区域」始终可见，
    // 否则拖出后就无法再抓回来。
    //  - 水平方向：至少保留 MIN_VISIBLE 像素在视口内（标题栏为整条宽度，露出一段即可抓取）。
    //  - 垂直方向：顶边不允许移出视口上方(minY=0)；且至少保留 HANDLE_MIN 高的标题栏在视口内(maxY)。
    const MIN_VISIBLE = 48;
    const HANDLE_MIN = 40; // 标题栏（可抓取区）至少保留的高度

    /**
     * 将面板坐标约束在视口内，保证顶部标题栏（唯一可抓取区）始终可见、水平方向至少保留部分在视口内。
     * @param {{x:number,y:number}} pt - 待约束的坐标
     * @param {{w?:number,h?:number}} [size] - 面板尺寸（缺省按 320 宽估算）
     * @returns {{x:number,y:number}} 约束后的安全坐标
     */
    function clampPoint(pt: any, size: any) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = size && size.w ? size.w : 320;
        const minX = -(w - MIN_VISIBLE);
        const maxX = vw - MIN_VISIBLE;
        const minY = 0; // 顶边不超出视口上方，标题栏始终可见
        const maxY = vh - HANDLE_MIN; // 至少保留一条标题栏高度在视口内，可抓取
        return {
            x: Math.min(Math.max(pt.x, minX), maxX),
            y: Math.min(Math.max(pt.y, minY), maxY),
        };
    }

    // 读取面板当前尺寸与可见矩形（用于精确计算边界）
    /**
     * 读取面板当前尺寸与可见矩形（用于精确计算边界）。
     * @param {Element} root - 面板根元素
     * @returns {{el:Element,rect:DOMRect,w:number,h:number}} 拖拽层元素、视口矩形及宽高
     */
    function getPanelRect(root: any) {
        const el = findDraggableNode(root) || root;
        const r = el.getBoundingClientRect();
        return { el: el, rect: r, w: r.width, h: r.height };
    }

    // 计算当前点 -> 裁剪到视口内 -> 保存；若越界则同时把拖拽层 transform 拉回边界，
    // 确保「视觉上」也始终留在可视范围（不止是存档安全）。
    /**
     * 计算当前面板坐标，裁剪到视口内后保存；若越界则同步把拖拽层 transform 拉回边界。
     * @param {Element} root - 面板根元素
     * @returns {{x:number,y:number}} 约束并保存后的坐标
     */
    function persistAndClamp(root: any) {
        const info = getPanelRect(root);
        const pt = { x: info.rect.left, y: info.rect.top };
        const clamped = clampPoint(pt, { w: info.w, h: info.h });
        if (clamped.x !== pt.x || clamped.y !== pt.y) {
            const dx = clamped.x - pt.x;
            const dy = clamped.y - pt.y;
            const el = info.el;
            const t = el.style.transform || '';
            const m = /translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/.exec(t);
            if (m) {
                const nx = (parseFloat(m[1]) + dx).toFixed(1);
                const ny = (parseFloat(m[2]) + dy).toFixed(1);
                el.style.transform = t.replace(/translate\([^)]*\)/, 'translate(' + nx + 'px, ' + ny + 'px)');
            } else if (t.indexOf('translate') === -1) {
                el.style.transform = (t ? t + ' ' : '') + 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
            }
        }
        savePanelPoint(clamped);
        return clamped;
    }

    /**
     * 对面板根元素安装位置跟踪：用 MutationObserver 监听 style 变化 + mousedown/move/up 双保险，实时裁剪并保存位置。
     * @param {Element} root - 面板根元素
     * @returns {void}
     */
    function applyTracking(root: any) {
        // 监听整棵子树的 style 变化（transform 可能加在任意内部层）
        const observer = new MutationObserver(() => {
            const pt = persistAndClamp(root);
            if (PDBG) console.log('[面板位置] 检测到移动，保存坐标:', pt);
        });
        observer.observe(root, { attributes: true, attributeFilter: ['style'], subtree: true });

        // 双保险：拖拽过程（mousedown→mousemove→mouseup）中实时裁剪并保存最终位置
        root.addEventListener('mousedown', () => {
            const onMove = () => persistAndClamp(root);
            // mouseup 以 once 注册：无论鼠标是否在面板内释放都会自动解绑，避免监听器残留
            const onUp = () => {
                persistAndClamp(root);
                document.removeEventListener('mousemove', onMove);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp, { once: true });
        });

        // 页面卸载时统一清理：断开 MutationObserver、移除 resize 监听，避免监听器残留
        window.addEventListener(
            'beforeunload',
            () => {
                try {
                    observer.disconnect();
                } catch (e) {
                    /* 忽略已断开的情况 */
                }
                if (resizeHandler) {
                    window.removeEventListener('resize', resizeHandler);
                    resizeHandler = null;
                }
            },
            { once: true }
        );
    }

    let tries = 0;
    const timer = setInterval(() => {
        tries++;
        const root = findPanelRoot() as HTMLElement | null;
        if (root) {
            clearInterval(timer);
            // 加载即裁剪：若存档位置（或默认位置）已越界，立即拉回并写回根容器 left/top
            const info = getPanelRect(root);
            const clamped = clampPoint({ x: info.rect.left, y: info.rect.top }, { w: info.w, h: info.h });
            root.style.left = Math.round(clamped.x) + 'px';
            root.style.top = Math.round(clamped.y) + 'px';
            savePanelPoint(clamped);
            if (PDBG) console.log('[面板位置] 已定位面板(Shadow DOM)，初始坐标:', clamped);
            applyTracking(root);
            // 视口尺寸变化时重新裁剪，防止面板被挤出可视范围（保存句柄以便卸载时移除）
            resizeHandler = () => persistAndClamp(root);
            window.addEventListener('resize', resizeHandler);
        } else if (tries > 80) {
            clearInterval(timer);
            if (PDBG) console.warn('[面板位置] 未找到面板(已尝试穿透 Shadow DOM)，放弃位置跟踪');
        }
    }, 150);
}
