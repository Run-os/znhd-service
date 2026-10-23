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
import { startImageContextMenu, stopImageContextMenu } from './lib/imageContextMenu';
import { startNavBarAutoMount, stopNavBarAutoMount } from './panel/navBarMount';
import { startQuickReplyBar, stopQuickReplyBar } from './phrases/mountQuickBar';
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
        // 标题栏注入控件（v26.10.21-v4）：语音开关 + 4 入口挂站点导航条，
        // 失败不连累主面板（内部每秒自愈重试，导航条没渲染就等下一轮）
        startNavBarAutoMount();
        // 站点图片右键菜单注入【打印】（v26.10.22-v6）：调脚本自身的 A4 打印，
        // 失败不连累主面板（站点没有菜单项 API，靠 DOM 注入，见模块头注）
        startImageContextMenu();
        // 会话输入框上方的常用语快捷按钮（v26.10.23）：按当前对话匹配飞书规则表。
        // 未授权 / 接口不可用时内部静默降级为不显示按钮，不连累主面板。
        startQuickReplyBar();
    } catch (error) {
        console.error('[监控] 面板挂载失败:', error);
        addLog('面板挂载失败: ' + (error as Error)?.message, 'error', true);
    }

    window.addEventListener('beforeunload', () => {
        flushSaveAllvalue();
        stopMonitoring();
        clearSpeechTimer();
        unwatchPanelHost();
        stopNavBarAutoMount();
        stopImageContextMenu();
        stopQuickReplyBar();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMonitoring);
    } else {
        startMonitoring();
    }
};

app();
