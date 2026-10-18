import { onBeforeUnmount, onMounted, ref } from 'vue';
import { savePanelPoint } from '@/lib/storage';
import { clampIntoView, clampPanelPoint } from './geometry';

/**
 * 面板拖拽（Vue 版，行为与 `panelHost.tsx` 的 usePanelDrag 一致）。
 *
 * 为什么不用 v-draggable 之类的指令/组件：位置写的是**影子宿主**的 left/top，
 * 且必须区分「点击」与「拖拽」—— pointerdown 里 preventDefault 并不能阻止后续 click
 * （实测Chrome 154 序列：拖拽 = pd|pm×N|pu|click），悬浮球拖完一松手会被顺带展开。
 */
const DRAG_THRESHOLD = 4;

export function usePanelDrag(host: HTMLElement) {
    const drag = ref<{ dx: number; dy: number } | null>(null);
    const start = ref<{ x: number; y: number } | null>(null);
    const moved = ref(false);

    function onPointerDown(e: PointerEvent) {
        // 只响应主键（触摸 / 鼠标左键）
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const rect = host.getBoundingClientRect();
        drag.value = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
        start.value = { x: e.clientX, y: e.clientY };
        moved.value = false;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        e.preventDefault();
    }

    function onPointerMove(e: PointerEvent) {
        const d = drag.value;
        if (!d) return;
        const s = start.value;
        if (s && !moved.value) {
            if (Math.abs(e.clientX - s.x) > DRAG_THRESHOLD || Math.abs(e.clientY - s.y) > DRAG_THRESHOLD) {
                moved.value = true;
            }
        }
        const pt = clampPanelPoint(
            { x: e.clientX - d.dx, y: e.clientY - d.dy },
            { w: host.offsetWidth, h: host.offsetHeight }
        );
        host.style.left = Math.round(pt.x) + 'px';
        host.style.top = Math.round(pt.y) + 'px';
    }

    function endDrag() {
        if (!drag.value) return;
        drag.value = null;
        start.value = null;
        const pt = {
            x: parseFloat(host.style.left) || 0,
            y: parseFloat(host.style.top) || 0,
        };
        const clamped = clampPanelPoint(pt, { w: host.offsetWidth, h: host.offsetHeight });
        host.style.left = Math.round(clamped.x) + 'px';
        host.style.top = Math.round(clamped.y) + 'px';
        savePanelPoint(clamped);
    }

    /** 取走「本次是否拖动过」并复位：悬浮球 onClick 用它吃掉拖拽尾巴的那次 click */
    function consumeDrag(): boolean {
        const v = moved.value;
        moved.value = false;
        return v;
    }

    // 视口尺寸变化时按真实尺寸重新裁回可视范围
    function clampNow(persist: boolean) {
        const pt = clampIntoView(
            { x: parseFloat(host.style.left) || 0, y: parseFloat(host.style.top) || 0 },
            host.offsetWidth,
            host.offsetHeight
        );
        host.style.left = Math.round(pt.x) + 'px';
        host.style.top = Math.round(pt.y) + 'px';
        if (persist) savePanelPoint(pt);
    }

    onMounted(() => {
        clampNow(false);
        window.addEventListener('resize', onResize);
    });
    onBeforeUnmount(() => window.removeEventListener('resize', onResize));

    function onResize() {
        clampNow(true);
    }

    return {
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        consumeDrag,
    };
}
