/**
 * Vue 版脚本入口（迁移期，与 `src/app.ts` 的装配顺序保持一致）。
 *
 * 和 React 版的差别只有一处：`mountPanel()` 来自 `src-vue/main.ts`（ShadowDOM + Vue），
 * 业务逻辑、监控、嗅探预热全部复用 `src/lib/*`，不做二次实现。
 */
import { addLog } from '@/lib/logger';
import { startMonitoring, stopMonitoring } from '@/lib/monitor';
import { clearSpeechTimer } from '@/lib/speech';
import { flushSaveAllvalue, loadAllvalue } from '@/lib/storage';
import { startPerfCollect } from '@/lib/snifferPerf';
import { setPreMeasureEnabled } from '@/lib/snifferPre';
import { mountPanel, unwatchPanelHost, watchPanelHost } from './main';

const app = () => {
    // 资源表预收：越早启动漏掉的资源越少（与 React 版同序）
    startPerfCollect();

    // 嗅探后台预测量：按设置项决定是否跑（默认开，安全阀见 lib/snifferPre.ts）
    try {
        setPreMeasureEnabled(loadAllvalue().sniffPreMeasure !== false);
    } catch {
        /* 读设置失败就当关掉：宁可不预测量，也不能连累启动 */
    }

    try {
        mountPanel();
        watchPanelHost();
    } catch (error) {
        console.error('[监控] 面板挂载失败:', error);
        addLog('面板挂载失败: ' + (error as Error)?.message, 'error', true);
    }

    window.addEventListener('beforeunload', () => {
        flushSaveAllvalue();
        stopMonitoring();
        clearSpeechTimer();
        unwatchPanelHost();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMonitoring);
    } else {
        startMonitoring();
    }
};

app();
