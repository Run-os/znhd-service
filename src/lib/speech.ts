import { CONFIG } from '@/lib/constants';
import { addLog } from '@/lib/logger';
import { runtime } from '@/lib/state';

/**
 * 语音播报（原 app.ts「语音播报函数」段）。
 * 模块化 P2：逐字迁移，仅加 export；新增 clearSpeechTimer() 供页面卸载时清理超时定时器。
 * 队列语义：FIFO、去重不在这里做；超长丢最旧、超 TTL 剔除，均由 CONSTANT 控制。
 */

// 语音播报函数
// 语音队列：元素为 { utterance, enqueuedAt }，enqueuedAt 用于过期清理；
// 队列长度受 CONFIG.MAX_SPEECH_QUEUE 限制，超出时丢弃最早（最旧）的消息。
/** 语音队列条目（enqueuedAt 用于过期清理） */
interface SpeechItem {
    utterance: SpeechSynthesisUtterance;
    enqueuedAt: number;
}

const speechQueue: SpeechItem[] = [];
let isSpeaking = false;
let speechTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 清空语音队列并中止当前播报，重置播放状态与超时定时器。
 * 主要用于语音开关关闭时，避免旧消息堆积、再次开启时集中涌出。
 * @returns {void}
 */
export function clearSpeechQueue() {
    speechQueue.length = 0;
    isSpeaking = false;
    if (speechTimer) {
        clearTimeout(speechTimer);
        speechTimer = null;
    }
    if ('speechSynthesis' in window) {
        try {
            window.speechSynthesis.cancel();
        } catch (e) {
            /* 忽略中止异常 */
        }
    }
}

/**
 * 移除队列中已过期的语音消息（入队时间距今超过 CONFIG.SPEECH_QUEUE_TTL）。
 * @returns {number} 被移除的过期消息条数
 */
function pruneExpiredSpeechItems() {
    if (speechQueue.length === 0) return 0;
    const now = Date.now();
    const before = speechQueue.length;
    for (let i = speechQueue.length - 1; i >= 0; i--) {
        if (now - speechQueue[i].enqueuedAt > CONFIG.SPEECH_QUEUE_TTL) {
            speechQueue.splice(i, 1);
        }
    }
    return before - speechQueue.length;
}

/**
 * 语音播报：将文本加入语音队列并触发播放（受语音开关与浏览器能力限制）。
 * 入队时执行长度上限与过期清理：队列超过 CONFIG.MAX_SPEECH_QUEUE 时丢弃最早（最旧）消息，
 * 超过 CONFIG.SPEECH_QUEUE_TTL 的过期消息也会被剔除，避免播报过时内容。
 * @param {string} text - 要播报的文本
 * @returns {void}
 */
export function speak(text: string): void {
    // 直接读取缓存的语音状态，避免每次读取 localStorage
    if (!runtime.voiceEnabled || !('speechSynthesis' in window)) {
        return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.0;

    // 添加到队列，记录入队时间用于过期判断
    speechQueue.push({ utterance, enqueuedAt: Date.now() });

    // 长度上限：超过则丢弃最早（最旧）的消息，保留最新内容
    while (speechQueue.length > CONFIG.MAX_SPEECH_QUEUE) {
        speechQueue.shift();
        addLog('语音队列已满，丢弃最早的一条旧消息', 'warning', true);
    }

    // 过期清理：剔除超过有效期的陈旧消息
    const expired = pruneExpiredSpeechItems();
    if (expired > 0) {
        addLog(`语音队列已清理 ${expired} 条过期消息`, 'warning', true);
    }

    processSpeechQueue();
}

// 处理语音队列
/**
 * 从语音队列中取出一条依次播放，带超时保护（防止 onend/onerror 不触发导致队列卡死）；
 * 播放前先剔除过期消息，避免播报过时内容。
 * @returns {void}
 */
function processSpeechQueue() {
    if (isSpeaking) {
        return;
    }

    // 先清理过期消息，避免播报过时内容
    pruneExpiredSpeechItems();

    if (speechQueue.length === 0) {
        return;
    }

    isSpeaking = true;
    const item = speechQueue.shift();
    // 上面已确认队列非空，这里只为类型收窄（同时兜住异常清空的情况，避免 isSpeaking 卡死）
    if (!item) {
        isSpeaking = false;
        return;
    }
    const utterance = item.utterance;

    // 清理上一次的超时定时器
    if (speechTimer) {
        clearTimeout(speechTimer);
    }

    // 超时保护：防止 onend/onerror 不触发导致队列卡死（Chrome 已知 bug）
    speechTimer = setTimeout(() => {
        addLog('语音播报超时，强制继续队列', 'warning', true);
        isSpeaking = false;
        speechTimer = null;
        processSpeechQueue();
    }, CONFIG.SPEECH_TIMEOUT);

    const clearTimer = () => {
        if (speechTimer) {
            clearTimeout(speechTimer);
            speechTimer = null;
        }
    };

    utterance.onend = () => {
        clearTimer();
        isSpeaking = false;
        processSpeechQueue();
    };

    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        clearTimer();
        isSpeaking = false;
        // 如果是not-allowed错误，清空队列避免堆积
        if (event.error === 'not-allowed') {
            speechQueue.length = 0;
        } else {
            processSpeechQueue();
        }
    };

    // 在播放前确保语音合成已恢复（某些浏览器会暂停）
    if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
    }
    window.speechSynthesis.speak(utterance);
}

/**
 * 仅清理语音超时定时器（不清队列、不取消合成）。
 * 对应原 beforeunload 中的 speechTimer 清理，页面卸载时调用。
 * @returns {void}
 */
export function clearSpeechTimer() {
    if (speechTimer) {
        clearTimeout(speechTimer);
        speechTimer = null;
    }
}
