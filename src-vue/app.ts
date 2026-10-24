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
import { startTodoBadge, stopTodoBadge } from './lib/todoBadge';
import { startNavBarAutoMount, stopNavBarAutoMount } from './panel/navBarMount';
import { startQuickReplyBar, stopQuickReplyBar } from './phrases/mountQuickBar';
import { mountPanel, unwatchPanelHost, watchPanelHost } from './main';

/**
 * 单点启动：一个模块抛错只记日志，不连累同批的其它模块。
 *
 * ⚠️ 曾经是「一个大 try 包住 6 个 start」，任一项抛错（比如站点改版让某个
 * observer.observe 拿到 null body）就会**静默**把后面的待办提醒、快捷短语一起
 * 关掉 —— 现象是「面板好好的，新功能就是不出现」，排查时看不出是谁挂的
 * （v26.10.24-v3 拆开）。
 * 日志只进面板日志、不弹 toast：这些都不是核心功能，失败别打扰使用者。
 */
function boot(name: string, fn: () => void): void {
    try {
        fn();
    } catch (error) {
        console.error('[监控] ' + name + ' 启动失败:', error);
        addLog(name + ' 启动失败: ' + ((error as Error)?.message || String(error)), 'error');
    }
}

const app = () => {
    // 资源表预收：越早启动漏掉的资源越少（与 React 版同序）
    startPerfCollect();

    // 嗅探后台预测量：按设置项决定是否跑（默认开，安全阀见 lib/snifferPre.ts）
    try {
        setPreMeasureEnabled(loadAllvalue().sniffPreMeasure !== false);
    } catch {
        /* 读设置失败就当关掉：宁可不预测量，也不能连累启动 */
    }

    boot('面板挂载', () => {
        mountPanel();
        watchPanelHost();
    });
    // 标题栏注入控件（v26.10.21-v4）：语音开关 + 4 入口挂站点导航条，
    // 失败不连累主面板（内部每秒自愈重试，导航条没渲染就等下一轮）
    boot('导航栏注入', startNavBarAutoMount);
    // 站点图片右键菜单注入【打印】（v26.10.22-v6）：调脚本自身的 A4 打印，
    // 失败不连累主面板（站点没有菜单项 API，靠 DOM 注入，见模块头注）
    boot('右键打印', startImageContextMenu);
    // 「待处理留言/待处理预约」整卡红色呼吸提醒（v26.10.24-v3）：见模块头注
    boot('待办提醒', startTodoBadge);
    // 会话输出框上方的快捷短语按钮（v26.10.23）：按当前对话匹配飞书规则表。
    // 未授权 / 接口不可用时内部静默降级为不显示按钮，不连累主面板。
    boot('快捷短语', startQuickReplyBar);

    window.addEventListener('beforeunload', () => {
        flushSaveAllvalue();
        stopMonitoring();
        clearSpeechTimer();
        unwatchPanelHost();
        stopNavBarAutoMount();
        stopImageContextMenu();
        stopTodoBadge();
        stopQuickReplyBar();
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMonitoring);
    } else {
        startMonitoring();
    }
};

app();
