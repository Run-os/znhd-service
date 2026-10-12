/**
 * 传输助手的自有设置存储（v26.10.12-v1）。
 *
 * 与 App 主面板设置**完全隔离**（用户要求：数据、入口、UI 均不共用）：
 *   · 主面板 `SettingsModal` 里不再有「中继服务器地址」——它搬到了这里；
 *   · 本模块的设置只进 `scriptCat_TransferSettings`，不写 `scriptCat_Allvalue`。
 *
 * 存量迁移（一次性）：老用户的中继地址存在 `scriptCat_Allvalue.relayServer` 里
 * （可能还是自己改过的地址）。第一次读取本模块设置时若本地没有任何记录，
 * 就把旧地址搬过来当默认值，避免升级后要重填。
 */

import type { TransferSettings, TransferTheme } from '@/lib/transfer/types';

/**
 * 中继服务器默认地址（v26.10.12-v1 起由本模块自有，不再走主面板 DEFAULTS）。
 * 即原 `DEFAULTS.relayServer` 的线上地址，随「设置隔离」一起搬过来。
 */
export const DEFAULT_RELAY_SERVER = 'https://znhd.122050.xyz';

/** 传输助手设置的 localStorage 键（与主设置的 `scriptCat_Allvalue` 分开） */
export const TRANSFER_STORAGE_KEY = 'scriptCat_TransferSettings';

/** 默认设置：中继地址为线上默认地址 */
export const DEFAULT_TRANSFER_SETTINGS: TransferSettings = {
    relayServer: DEFAULT_RELAY_SERVER,
    theme: 'light',
    autoOpenOnReceive: true,
};

/**
 * 读取传输助手设置（与默认值合并；形状损坏一律退化成默认值）。
 *
 * @param legacyRelayServer 旧主设置里的中继地址（`runtime.init.relayServer`）：
 *        仅当本地**从来没有**存过传输助手设置时用作默认值，之后用户在本模块改的值优先。
 */
export function loadTransferSettings(legacyRelayServer?: string): TransferSettings {
    let stored: Partial<TransferSettings> | null = null;
    try {
        const raw = localStorage.getItem(TRANSFER_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed;
        }
    } catch (e) {
        stored = null;
    }
    const base: TransferSettings = stored
        ? { ...DEFAULT_TRANSFER_SETTINGS, ...stored }
        : {
              ...DEFAULT_TRANSFER_SETTINGS,
              // 一次性迁移：老用户在别处填过的中继地址继续生效
              relayServer:
                  typeof legacyRelayServer === 'string' && legacyRelayServer.trim()
                      ? legacyRelayServer.trim().replace(/\/+$/, '')
                      : DEFAULT_TRANSFER_SETTINGS.relayServer,
          };
    return normalize(base);
}

/** 保存传输助手设置（同步写入；本模块设置项少，不需要防抖） */
export function saveTransferSettings(settings: TransferSettings): void {
    try {
        localStorage.setItem(TRANSFER_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
        /* 隐私模式等写不进去时静默：设置仍能在当次会话内生效 */
    }
}

/** 归一化：地址去尾部斜杠、主题只认 light/dark、开关强制布尔 */
export function normalizeTransferSettings(input: Partial<TransferSettings>): TransferSettings {
    const theme: TransferTheme = input.theme === 'dark' ? 'dark' : 'light';
    return {
        relayServer: String(input.relayServer || '')
            .trim()
            .replace(/\/+$/, ''),
        theme,
        autoOpenOnReceive: input.autoOpenOnReceive === undefined ? true : !!input.autoOpenOnReceive,
    };
}

function normalize(input: Partial<TransferSettings>): TransferSettings {
    return normalizeTransferSettings(input);
}
