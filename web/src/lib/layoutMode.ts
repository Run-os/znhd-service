/**
 * 布局模式检测（v26.10.13-v4）：决定「传输助手」网页是**全屏聊天窗**（手机）
 * 还是**屏幕居中的弹窗**（桌面）。
 *
 * ── 需求 ───────────────────────────────────────────────────────────────────
 * 检测传输助手网页为**桌面版**时，不用全屏聊天窗口，改为类似弹窗的形式放在屏幕
 * 中心（参考微信 PC 端「文件传输助手」独立聊天窗的位置与大小：约 420×680 居中）；
 * 检测为**手机版**时用全屏聊天窗口（保持 v26.10.13-v3 的 fixed 贴视口骨架）。
 *
 * ── 判定规则（按优先级）────────────────────────────────────────────────────
 *  1. UA 含移动端特征（Android / iPhone / iPod / Windows Phone / …）→ phone；
 *  2. 粗指针（触屏）+ 屏幕短边 < 820px → phone：兜底 iPadOS 13+ 的 Safari
 *     （它报的是 Mac 桌面 UA，但确实是触屏设备，且屏幕短边 768/810 < 820）；
 *  3. 其余一律 desktop（含桌面浏览器窗口拖窄、DevTools 设备模式若只改视口
 *     未改 UA 的情况——那种场景弹窗会等比缩到 100% 宽，依然居中可用）。
 *
 * ⚠️ 为什么不做「innerWidth < 某值就算 phone」：桌面用户把窗口拖窄是常见操作，
 *    一拖窄就整页从弹窗跳成全屏反而惊吓；反之手机横屏（UA 仍含 Mobile）保持全屏。
 */

import { useEffect, useState } from 'react';

export type LayoutMode = 'phone' | 'desktop';

/** UA 里的移动端特征词（覆盖 iOS / Android / Windows Phone / 功能机 / 国产浏览器） */
const UA_MOBILE =
    /Android|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|Silk|Kindle|UCBrowser|QQBrowser|MicroMessenger.*Mobile|Mobile Safari/i;

/** 粗指针 + 屏幕短边阈值：iPadOS 桌面 UA 的兜底（iPad 短边 768/810，桌面 Mac 短边通常 ≥900） */
const COARSE_SHORT_SIDE_MAX = 820;

export function detectLayoutMode(): LayoutMode {
    if (typeof navigator === 'undefined') return 'phone'; // SSR/异常场景按最保守的手机全屏
    if (UA_MOBILE.test(navigator.userAgent)) return 'phone';
    try {
        const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
        if (coarse && Math.min(screen.width, screen.height) < COARSE_SHORT_SIDE_MAX) return 'phone';
    } catch {
        /* matchMedia 异常（老 WebView）：忽略，走 desktop */
    }
    return 'desktop';
}

/**
 * 带响应式的 layout mode：窗口尺寸变化 / 横竖屏切换 / 指针能力变化时重算，
 * **只有 mode 真变了才 setState**（resize 每秒可触发几十次，无脑 setState 会抖）。
 */
export function useLayoutMode(): LayoutMode {
    // useState 的惰性初始化：只在首次渲染跑一次 detect，不随每次 render 重跑
    const [mode, setMode] = useState<LayoutMode>(detectLayoutMode);
    useEffect(() => {
        const recalc = () => {
            const next = detectLayoutMode();
            setMode((prev) => (prev === next ? prev : next));
        };
        window.addEventListener('resize', recalc);
        window.addEventListener('orientationchange', recalc);
        let mq: MediaQueryList | null = null;
        try {
            mq = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
        } catch {
            mq = null;
        }
        // addEventListener 的 change 事件老 WebView 没有，退化成不管它（检测仍会在下次 resize 时重算）
        if (mq && mq.addEventListener) mq.addEventListener('change', recalc);
        return () => {
            window.removeEventListener('resize', recalc);
            window.removeEventListener('orientationchange', recalc);
            if (mq && mq.removeEventListener) mq.removeEventListener('change', recalc);
        };
    }, [setMode]);
    return mode;
}
