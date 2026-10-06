// ========== 依赖（模块化抽出的 lib / ui 模块） ==========
import { mountPanel } from '@/lib/ui/panelHost';
import { flushSaveAllvalue } from '@/lib/storage';
import { addLog } from '@/lib/logger';
import { startMonitoring, stopMonitoring } from '@/lib/monitor';
import { clearSpeechTimer } from '@/lib/speech';

/**
 * 脚本入口：本文件只做「装配」，业务实现全部在 src/lib/ 与 src/lib/ui/。
 * 顺序：挂载 React+antd 面板（内含位置恢复与拖拽） → 注册卸载清理 → 启动监控。
 *
 * v26.10.06-v9：面板不再是 CAT_UI.createPanel（脚本猫 UI 库），改为自建宿主 + React 19 + Ant Design v6；
 * 位置持久化与拖拽一并移到 `lib/ui/panelHost.tsx`（原 `lib/ui/panelPosition.ts` 已删除）。
 * @returns {void}
 */
const app = () => {
    // ========== 挂载主面板 ==========
    try {
        mountPanel();
    } catch (error) {
        // UI 面板挂载失败时，至少不连累监控逻辑
        console.error('[监控] 面板挂载失败:', error);
        if (typeof addLog === 'function') {
            addLog('面板挂载失败: ' + (error && error.message), 'error', true);
        }
    }

    // ========== 页面关闭时清理定时器 ==========
    window.addEventListener('beforeunload', () => {
        flushSaveAllvalue(); // 落盘防抖窗口内的最后一笔设置，避免关页丢改动
        stopMonitoring();
        clearSpeechTimer();
    });

    // ========== 页面启动 ==========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMonitoring);
    } else {
        startMonitoring();
    }
};

export default app;
