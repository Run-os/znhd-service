import { CONFIG } from '@/lib/constants';

/**
 * 日志管理：addLog / addLogDebounced（原 app.ts「日志管理」段）。
 * 模块化 P1：逐字迁移，仅加 export；日志写入回调改为 setLogEntriesSink() 注入。
 */

/** 日志类型（决定面板着色） */
export type LogType = 'info' | 'warning' | 'success' | 'error';

/** 一条日志条目 */
export interface LogEntry {
    timestamp: string;
    message: string;
    type: LogType;
}

/** 日志写入回调：接收 React setState 风格的更新函数（由主面板注入） */
export type LogSink = (updater: (prevEntries: LogEntry[]) => LogEntry[]) => void;

// ==========日志管理==========
// 全局日志状态管理
let setLogEntriesCallback: LogSink | null = null;

// 日志去重窗口：保留最近若干条日志文本，同文本重复出现即忽略
// （避免「每 3 秒一条」的间隔性重复刷屏，比只比对上一条更可靠）
const RECENT_LOG_COUNT = 5;
const recentLogMessages: string[] = [];

// 添加日志条目函数
/**
 * 添加一条日志条目，输出到设置面板的日志窗口（通过回调写入 React 状态）。
 * 内置重复内容过滤：最近 RECENT_LOG_COUNT（5）条内出现过相同文本则忽略，避免刷屏。
 * @param {string} message - 日志正文
 * @param {('info'|'warning'|'success'|'error')} [type='info'] - 日志类型，决定着色
 * @param {boolean} [logenabled=false] - 是否同时输出到浏览器控制台（console.log）
 * @returns {void}
 */
export function addLog(message: string, type: LogType = 'info', logenabled = false): void {
    const timestamp = new Date().toTimeString().slice(0, 8);

    // 检查是否为重复内容（最近 RECENT_LOG_COUNT 条内出现过相同文本即忽略）
    if (recentLogMessages.indexOf(message) !== -1) {
        // 如果内容相同，不输出本次内容
        console.log('[监控] 重复日志，已忽略:', message);
        return;
    }

    // 更新日志去重窗口（滚动保留最近 RECENT_LOG_COUNT 条）
    recentLogMessages.push(message);
    if (recentLogMessages.length > RECENT_LOG_COUNT) {
        recentLogMessages.shift();
    }

    const logItem: LogEntry = { timestamp, message, type };

    // 更新React状态
    if (setLogEntriesCallback) {
        setLogEntriesCallback((prevEntries) => {
            const newEntries = [logItem, ...prevEntries];
            if (newEntries.length > CONFIG.MAX_LOG_ENTRIES) {
                newEntries.pop();
            }
            return newEntries;
        });
    }
    if (logenabled) {
        console.log(`[监控] ${timestamp} ${message}`);
    }
}

// 逐字输入类设置项的日志防抖：同一 key 的连续变化只在停顿后记一条「最终值」。
// 输入/粘贴一个地址若每键都记日志，一次输入就能把 20 条上限的日志面板刷满（只剩中间态）。
const _logDebounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};
/**
 * 防抖写日志：同一 key 在 400ms 内的多次调用只保留最后一次。
 * @param {string} key - 防抖分组键（同一设置项用同一 key）
 * @param {string} message - 日志正文（取最后一次调用的值）
 * @param {('info'|'warning'|'success'|'error')} [type='info'] - 日志类型
 * @returns {void}
 */
export function addLogDebounced(key: string, message: string, type: LogType = 'info'): void {
    clearTimeout(_logDebounceTimers[key]);
    _logDebounceTimers[key] = setTimeout(() => {
        delete _logDebounceTimers[key];
        addLog(message, type);
    }, 400);
}

/**
 * 注入/清除「日志写入」回调（主面板的 setLogEntries）。
 * 之所以用函数而不是直接导出变量：ES module 的 import 绑定是只读的，调用方无法赋值。
 * @param {Function|null} cb - 接收 setState 风格更新函数的回调；传 null 表示解除
 * @returns {void}
 */
export function setLogEntriesSink(cb: LogSink | null): void {
    setLogEntriesCallback = cb;
}
