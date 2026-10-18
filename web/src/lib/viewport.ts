/**
 * 视口同步（v26.10.13-v3；v26.10.18-v7 由 React hook 改为 Vue composable）：
 * 让「fixed 贴视口」的整页骨架跟随**视觉视口**。
 *
 * 为什么需要它：`.znhd-phone-chat` 是 `position:fixed` + `height:100dvh`。
 * 桌面/无键盘时 100dvh 就够；但移动端有两种「布局视口没缩、视觉视口缩了」的场景：
 *   · 虚拟键盘弹出（Android 默认 `interactive-widget=overlays-content`，布局视口不缩）——
 *     不处理的话输入区被键盘挡住；
 *   · 部分浏览器工具栏收放——同理。
 * 处理：监听 `visualViewport` 的 resize/scroll，当视觉视口比布局视口矮时，把
 * `--znhd-shell-h`（高）/ `--znhd-shell-top`（顶偏移）写成视觉视口的实测值；
 * 一致时删掉变量回到 100dvh。键盘收起/工具栏稳定后自动还原。
 *
 * ⚠️ 三条实现约束：
 * 1. **捏合缩放中不同步**（`scale !== 1`）：此时同步高度等于和浏览器缩放打架，
 *    直接删变量回到 100dvh（捏合时 fixed 壳盖住布局视口即可，不影响缩放查看）。
 * 2. **只在数值变化时写样式**：`scroll` 事件在惯性滑动中每秒几十次，
 *    每次都 setProperty 会引发无谓重排。
 * 3. 老 WebView 没有 `visualViewport`：整个 composable 空转，CSS 回退 100dvh。
 */

import { onBeforeUnmount, onMounted } from 'vue';

/** 把 shell 的 top/height 同步到视觉视口（变化才写；见文件头约束 2） */
export function useShellViewport(): void {
    let cleanup: (() => void) | null = null;

    onMounted(() => {
        const vv = window.visualViewport;
        if (!vv) return;
        const root = document.documentElement;
        let lastH: string | null = null;
        let lastT: string | null = null;

        const apply = (h: string, t: string) => {
            if (h !== lastH) {
                if (h) root.style.setProperty('--znhd-shell-h', h);
                else root.style.removeProperty('--znhd-shell-h');
                lastH = h;
            }
            if (t !== lastT) {
                if (t) root.style.setProperty('--znhd-shell-top', t);
                else root.style.removeProperty('--znhd-shell-top');
                lastT = t;
            }
        };

        const sync = () => {
            if (vv.scale && Math.abs(vv.scale - 1) > 0.02) {
                apply('', '');
                return;
            }
            const h = Math.round(vv.height);
            const t = Math.round(vv.offsetTop);
            // 视觉视口与布局视口一致（桌面 / 无键盘）：不写变量，走 CSS 的 100dvh
            if (h >= window.innerHeight - 2) apply('', '');
            else apply(h + 'px', t + 'px');
        };

        sync();
        vv.addEventListener('resize', sync);
        vv.addEventListener('scroll', sync);
        window.addEventListener('resize', sync);

        cleanup = () => {
            vv.removeEventListener('resize', sync);
            vv.removeEventListener('scroll', sync);
            window.removeEventListener('resize', sync);
            root.style.removeProperty('--znhd-shell-h');
            root.style.removeProperty('--znhd-shell-top');
        };
    });

    onBeforeUnmount(() => {
        cleanup?.();
        cleanup = null;
    });
}
