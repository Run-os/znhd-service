import { CONFIG } from '@/lib/constants';
import { addLog } from '@/lib/logger';
import { runtime } from '@/lib/state';
import { speak } from '@/lib/speech';

/**
 * 人数监控 / 掉线检测 / 工作时间判断（原 app.ts「监控部分」段）。
 * 模块化 P2：逐字迁移，仅加 export；新增 stopMonitoring() 供页面卸载时清理定时器。
 */

// ==========监控部分==========
// 工具函数：获取当前小时（支持小数）
/**
 * 获取当前时间的十进制小时（如 13:30 -> 13.5），供工作时间判断。
 * @returns {number} 当前十进制小时
 */
function getCurrentHour() {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
}

// 检查是否在工作时间内（读取用户可配置的时间段缓存）
/**
 * 判断当前是否处于用户配置的监控工作时间段内（读取缓存，无配置则视为工作时间内）。
 * @returns {boolean} 在工作时间内返回 true，否则 false
 */
function isWorkingHours() {
    const wh = runtime.workingHours;
    // 兜底：若未配置则视为工作时间内，避免完全停止监控
    if (!wh) return true;
    const currentHour = getCurrentHour();
    return (
        (currentHour >= wh.morningStart && currentHour <= wh.morningEnd) ||
        (currentHour >= wh.afternoonStart && currentHour <= wh.afternoonEnd)
    );
}

// 缓存DOM元素引用（只缓存稳定元素）
const domCache: { ocurrentElement: Element | null } = {
    ocurrentElement: null,
    // 注意：offlineElement 不缓存，每次重新查询
};

// 记录上一次的等待人数，用于检测状态变化
let lastWaitCount: number | null = null;

// 记录上一次的工作时间状态，用于检测「进入/离开工作时间」的变化（仅在翻转时记日志）
let lastWorkingState: boolean | null = null;

// 掉线语音已在播报标记：只在「掉线弹窗新出现」的上升沿播报一次，
// 弹窗停留期间每 3s 轮询不再重复（避免循环报警占满语音队列）；弹窗消失后复位可再次提醒。
let lastOfflineAnnounced = false;

// 修改主要检测函数
/**
 * 主检测函数：每次轮询执行。判断工作时间、读取等待人数（状态变化时记录/播报），
 * 并检测掉线弹窗（发现时记录并语音告警）。
 * @returns {void}
 */
function checkCount() {
    // 工作时间状态变化时记录日志（进入/离开），仅在翻转时输出，避免刷屏
    const inWork = isWorkingHours();
    if (inWork !== lastWorkingState) {
        lastWorkingState = inWork;
        addLog(inWork ? '已进入工作时间，开始监控征纳互动' : '已离开工作时间，暂停监控', inWork ? 'success' : 'info');
    }
    if (!inWork) return;

    try {
        // 清理缓存中已失效的人数元素（isConnected 为假即已脱离文档）
        if (domCache.ocurrentElement && !domCache.ocurrentElement.isConnected) {
            domCache.ocurrentElement = null;
        }

        // 重新查找人数元素（相对稳定，可以缓存）
        if (!domCache.ocurrentElement) {
            domCache.ocurrentElement = document.querySelector('.count:nth-child(2)');
        }

        const ocurrentElement = domCache.ocurrentElement;
        if (!ocurrentElement) {
            addLog('找不到人数元素', 'warning');
            return;
        }

        const currentCount = parseInt(ocurrentElement.textContent!.trim(), 10);
        if (isNaN(currentCount)) {
            addLog(`无法解析等待人数: "${ocurrentElement.textContent!.trim()}"`, 'warning');
            return;
        }

        // 人数状态处理：仅在状态变化时记录日志，避免日志被重复内容填满
        if (currentCount === 0) {
            // 仅在从 >0 变为 0 时记录
            if (lastWaitCount !== 0) {
                addLog('当前等待人数为0', 'success');
            }
        } else {
            speak('征纳互动有人来了');
            addLog(`当前等待人数: ${currentCount}`, 'info');
        }
        lastWaitCount = currentCount;

        // ========== 离线检测 ==========
        // 每次重新查询，不缓存（弹窗元素动态创建/销毁）
        // 掉线弹窗图标：两个选择器是「互补兜底」关系而非冗余——
        // :nth-child(2) 按父元素下所有子元素的序号匹配，:nth-of-type(2) 按同标签类型序号匹配；
        // 不同版本页面在图标前可能插入额外节点（导致两者命中不同元素），故保留双写法。
        const offlineEl: HTMLElement | null =
            (document.querySelector('.t-dialog__body__icon:nth-child(2)') as HTMLElement | null) ||
            (document.querySelector('.t-dialog__body__icon:nth-of-type(2)') as HTMLElement | null);
        // 使用可选链安全读取文本
        const offlineText = offlineEl ? (offlineEl?.innerText ?? offlineEl?.textContent ?? '').trim() : '';
        if (offlineText.includes('掉线')) {
            addLog(`掉线提示：${offlineText}`, 'error');
            if (!lastOfflineAnnounced) {
                lastOfflineAnnounced = true; // 仅弹窗新出现时播报一次，避免停留期间每 3s 循环报警
                speak('征纳互动已掉线');
            }
        } else {
            // 掉线弹窗消失/尚未出现：复位标记，下次真正掉线仍会提醒
            lastOfflineAnnounced = false;
        }
    } catch (error) {
        addLog(`检测错误: ${error.message}`, 'error', true);
    }
}

// 全局定时器引用，用于清理
let monitoringInterval: ReturnType<typeof setInterval> | null = null;

// 页面加载完成后启动监控
/**
 * 启动监控：立即执行一次检测，并按 CHECK_INTERVAL 定时轮询 checkCount。
 * @returns {void}
 */
export function startMonitoring() {
    // 立即执行一次检查
    checkCount();
    // 启动定时检查
    monitoringInterval = setInterval(checkCount, CONFIG.CHECK_INTERVAL);
}

/**
 * 停止监控轮询（对应原 beforeunload 中的 monitoringInterval 清理）。
 * @returns {void}
 */
export function stopMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
}
