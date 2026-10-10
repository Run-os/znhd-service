import { addLog } from '@/lib/logger';
import { notify } from '@/lib/ui/notify';
import { DEFAULTS, LEGACY_COMMON_PHRASES_URL, PANEL_POINT_KEY, PHRASES_CACHE_KEY, STORAGE_KEY } from '@/lib/constants';

/**
 * 全部用户配置的形状（= DEFAULTS 的结构）。
 * 用 type 而非 interface：type 别名带隐式索引签名，可直接传给 saveAllvalue(Record<string, unknown>)。
 * 有了它，loadAllvalue 的返回值不再是推断出的 any，UI 侧也不必再写 useState<any>。
 */
export type Allvalue = typeof DEFAULTS;

/**
 * 本地存储读写：面板位置 / 常用语缓存 / 全部用户配置（原 app.ts「存储管理」段）。
 * 模块化 P1：逐字迁移，仅加 export。注意 saveAllvalue 是 300ms 尾防抖，
 * 返回时尚未落盘——需要写完立刻读时先调 flushSaveAllvalue()。
 */

// 读取面板保存的位置（无记录返回 null，由调用方兜底默认坐标）
/**
 * 从 localStorage 读取上次保存的面板位置。
 * @returns {({x:number,y:number}|null)} 命中且坐标合法时返回 {x,y}，否则返回 null（由调用方兜底默认坐标）
 */
export function loadPanelPoint() {
    try {
        const saved = localStorage.getItem(PANEL_POINT_KEY);
        if (saved) {
            const p = JSON.parse(saved);
            if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
                // isFinite 同时排除 NaN/±Infinity（typeof NaN==='number' 会漏）
                return p;
            }
        }
    } catch (error) {
        addLog('读取面板位置失败: ' + error.message, 'error', true);
    }
    return null;
}

// 保存面板位置（带防抖，避免拖拽过程中高频写 localStorage）
let _savePointTimer: number | null = null;
/**
 * 保存面板位置到 localStorage（带 requestAnimationFrame 防抖，避免拖拽中高频写入）。
 * @param {{x:number,y:number}} point - 面板视口坐标
 * @returns {void}
 */
export function savePanelPoint(point: { x: number; y: number } | null): void {
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return;
    if (_savePointTimer) return; // 已计划在下一帧保存，跳过重复
    _savePointTimer = requestAnimationFrame(() => {
        _savePointTimer = null;
        try {
            localStorage.setItem(
                PANEL_POINT_KEY,
                JSON.stringify({
                    x: Math.round(point.x),
                    y: Math.round(point.y),
                })
            );
        } catch (error) {
            addLog('保存面板位置失败: ' + error.message, 'error', true);
        }
    });
}

// 读取常用语本地缓存（2 小时有效期内且 URL 一致则命中）
/**
 * 从 localStorage 读取常用语本地缓存（含加载时间戳、数据源 URL 与数据本体）。
 * @returns {({time:number,url:string,data:object}|null)} 命中且结构合法时返回缓存对象，否则返回 null
 */
export function loadPhrasesCache() {
    try {
        const saved = localStorage.getItem(PHRASES_CACHE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed.time === 'number' && typeof parsed.url === 'string' && parsed.data) {
                return parsed;
            }
        }
    } catch (error) {
        addLog('读取常用语缓存失败: ' + error.message, 'error', true);
    }
    return null;
}

// 保存常用语本地缓存（记录加载时间戳、数据源 URL 与数据本体）
/**
 * 将常用语数据连同加载时间戳与数据源 URL 写入 localStorage 缓存。
 * @param {string} url - 数据源地址（用于后续判断缓存是否仍有效）
 * @param {object} data - 解析后的常用语数据（键值对）
 * @returns {void}
 */
export function savePhrasesCache(url: string, data: Record<string, unknown>): void {
    try {
        localStorage.setItem(
            PHRASES_CACHE_KEY,
            JSON.stringify({
                time: Date.now(),
                url: url,
                data: data,
            })
        );
    } catch (error) {
        addLog('保存常用语缓存失败: ' + error.message, 'error', true);
    }
}

// 从localStorage加载Allvalue数据
/**
 * 从 localStorage 加载全部用户配置，并与 DEFAULTS 合并（已存储值覆盖默认值）。
 * 解析失败时回退到 DEFAULTS，保证调用方始终拿到完整配置对象。
 * @returns {object} 合并后的配置对象（含 voiceEnabled / workingHours / commonPhrasesUrl 等）
 */
export function loadAllvalue(): Allvalue {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            const merged = { ...DEFAULTS, ...parsed };
            // 对嵌套 workingHours 做字段级合并 + 数值校验：残缺/损坏的存量 workingHours
            // （如只存了 morningStart）不得整体顶掉 DEFAULTS 其余字段——否则缺字段变 undefined，
            // isWorkingHours 恒判「非工作时间」导致监控静默停摆（v26.9.6-v7 起因）。
            const wh = parsed && typeof parsed.workingHours === 'object' && parsed.workingHours;
            if (wh) {
                const defWh = DEFAULTS.workingHours;
                merged.workingHours = {
                    morningStart: Number.isFinite(wh.morningStart) ? wh.morningStart : defWh.morningStart,
                    morningEnd: Number.isFinite(wh.morningEnd) ? wh.morningEnd : defWh.morningEnd,
                    afternoonStart: Number.isFinite(wh.afternoonStart) ? wh.afternoonStart : defWh.afternoonStart,
                    afternoonEnd: Number.isFinite(wh.afternoonEnd) ? wh.afternoonEnd : defWh.afternoonEnd,
                };
            }
            // 旧默认数据源地址迁移（v26.10.10-v17）：存量存储里可能冻结着旧默认值（原因见 constants.ts
            // 的 LEGACY_COMMON_PHRASES_URL 注释）。只把「恰好等于旧默认值」的迁到新默认，
            // 用户自定义的地址不动——那才是这个可配置项的意义。
            if (merged.commonPhrasesUrl === LEGACY_COMMON_PHRASES_URL) {
                merged.commonPhrasesUrl = DEFAULTS.commonPhrasesUrl;
            }
            return merged;
        }
    } catch (error) {
        addLog('加载存储数据失败: ' + error.message, 'error', true);
    }
    // 返回默认值
    return { ...DEFAULTS };
}

// 保存Allvalue数据到localStorage（300ms 尾防抖）
// 设置项是逐字提交的（见 SettingsDrawer 的 onChange）：每键都落盘即每次按键一次同步
// JSON.stringify + localStorage.setItem，并顺带刷一条日志（面板位置保存早已用 rAF 防抖）。
// 这里只把「持久化」推迟到停顿后——状态仍逐字更新，最终写入的必然是最新值；
// 关页由 beforeunload 调 flushSaveAllvalue() 兜底，不会丢最后一笔。
let _saveAllvalueTimer: ReturnType<typeof setTimeout> | null = null;
let _saveAllvaluePending: Record<string, unknown> | null = null;
/**
 * 立即落盘待保存的配置并取消未到期的防抖定时器。幂等：无待写值时直接返回。
 * @returns {void}
 */
export function flushSaveAllvalue() {
    if (_saveAllvalueTimer) {
        clearTimeout(_saveAllvalueTimer);
        _saveAllvalueTimer = null;
    }
    if (_saveAllvaluePending === null) return;
    const data = _saveAllvaluePending;
    _saveAllvaluePending = null;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        addLog('数据已保存到localStorage', 'success', true);
    } catch (error) {
        addLog('保存数据失败: ' + error.message, 'error', true);
        notify.error('保存设置失败: ' + error.message);
    }
}
/**
 * 将全部用户配置写入 localStorage（300ms 尾防抖，语义见上方注释）。
 * 注意：返回时尚未落盘，需要立刻读到最新值时先调 flushSaveAllvalue()。
 * @param {object} data - 待保存的配置对象
 * @returns {void}
 */
export function saveAllvalue(data: Record<string, unknown>): void {
    _saveAllvaluePending = data;
    if (!_saveAllvalueTimer) _saveAllvalueTimer = setTimeout(flushSaveAllvalue, 300);
}
