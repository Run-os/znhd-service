import { CONFIG } from '@/lib/constants';
import { addLog } from '@/lib/logger';
import { resolveGithubUrl } from '@/lib/utils';

/**
 * 剪贴板与提示音（原 app.ts 的 playDidaSound / safeCopyText）。
 * 模块化 P3：逐字迁移，仅加 export（playDidaSound 仅内部使用，不导出）。
 */

// 复用的音频播放器实例（避免每次创建新对象）
let didaAudioPlayer: HTMLAudioElement | null = null;

// 播放提示音函数
/**
 * 播放提示音（dida.mp3）。复用 Audio 实例，避免重复解码。
 * @returns {void}
 */
function playDidaSound() {
    if (!CONFIG.didaUrl) return;
    try {
        // 复用 Audio 实例，避免重复解码
        if (!didaAudioPlayer) {
            didaAudioPlayer = new Audio();
            didaAudioPlayer.volume = 0.5;
        }
        // src 每次按当前 useCdn 状态解析并比对重设：切换 CDN 开关后提示音即刻走新选择，无需刷新
        const src = resolveGithubUrl(CONFIG.didaUrl);
        if (didaAudioPlayer.src !== src) didaAudioPlayer.src = src;
        // 重置播放位置并播放
        didaAudioPlayer.currentTime = 0;
        // play() 的 rejection 多来自浏览器自动播放策略（预期行为），静默忽略避免干扰
        didaAudioPlayer.play().catch(() => {
            // 预期行为：被浏览器自动播放策略拒绝，静默忽略避免干扰
        });
    } catch (e) {
        // 结构性异常（如 Audio 构造/赋值失败）需留痕，便于排查
        addLog('播放提示音失败: ' + e.message, 'warning', true);
    }
}

// 安全复制工具：仅在页面聚焦且支持 clipboard 时尝试复制
/**
 * 安全复制文本到剪贴板：优先 GM_setClipboard（无需焦点），降级到 navigator.clipboard；
 * 成功复制后播放提示音。失败时记录日志，不抛出。
 * @param {string} text - 待复制文本（空值直接返回并回调 false）
 * @param {Function} [onResult] - 可选结果回调 (ok:boolean)，供调用方据实更新 UI（如复制按钮文案）
 * @returns {void}
 */
export function safeCopyText(text: string, onResult: ((ok: boolean) => void) | null = null): void {
    const notify = (v: boolean) => {
        if (typeof onResult === 'function') {
            try {
                onResult(!!v);
            } catch (e) {
                /* 忽略回调异常 */
            }
        }
    };
    if (!text) {
        notify(false);
        return;
    }
    // 1) 优先使用 GM_setClipboard（无需焦点）
    if (typeof GM_setClipboard === 'function') {
        try {
            GM_setClipboard(text);
            addLog('[复制] 已复制到剪贴板 (GM_setClipboard)', 'success', true);
            playDidaSound();
            notify(true);
            return;
        } catch (e) {
            addLog('[复制] GM_setClipboard 失败: ' + e.message, 'error', true);
        }
    }

    // 2) 浏览器异步 clipboard API
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard
            .writeText(text)
            .then(() => {
                addLog('[复制] 已复制到剪贴板 (navigator.clipboard)', 'success', true);
                playDidaSound();
                notify(true);
            })
            .catch((err) => {
                addLog('[复制] 复制到剪贴板失败: ' + err.message, 'error', true);
                notify(false);
            });
        return;
    }
    notify(false); // 无任何可用复制途径
}
