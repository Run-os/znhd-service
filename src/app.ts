// ========== 依赖（模块化抽出的 lib / ui 模块） ==========
import { mountPanel, watchPanelHost, unwatchPanelHost } from '@/lib/ui/panelHost';
import { flushSaveAllvalue, loadAllvalue } from '@/lib/storage';
import { addLog } from '@/lib/logger';
import { startMonitoring, stopMonitoring } from '@/lib/monitor';
import { clearSpeechTimer } from '@/lib/speech';
// v26.10.14-v2：资源表预收要尽早启动 —— 脚本默认 document-end 执行，启动前的资源已进
// performance 缓冲区（observer 的 buffered:true 会一次性回放），此后的新资源由 observer
// 实时抄录。放 app() 第一行而不是 sniffer.ts 模块级：那个文件是按需加载的，太晚。
import { startPerfCollect } from '@/lib/snifferPerf';
// v26.10.14-v4：嗅探「后台预测量」（用户指定：测量也要在打开嗅探窗口之前跑）——
// 与上面的 perf 预收是互补的两件事：perf 只读资源表（零请求，覆盖同源图），
// 本模块专治资源表拿不到字节数的图（会发请求，故有开关与限额，见 lib/snifferPre.ts）。
import { setPreMeasureEnabled } from '@/lib/snifferPre';

/**
 * 脚本入口：本文件只做「装配」，业务实现全部在 src/lib/ 与 src/lib/ui/。
 * 顺序：挂载 React+antd 面板（内含位置恢复与拖拽） → 注册卸载清理 → 启动监控。
 *
 * v26.10.06-v9：面板不再是 CAT_UI.createPanel（脚本猫 UI 库），改为自建宿主 + React 19 + Ant Design v6；
 * 位置持久化与拖拽一并移到 `lib/ui/panelHost.tsx`（原 `lib/ui/panelPosition.ts` 已删除）。
 * @returns {void}
 */
const app = () => {
    // ========== 资源表预收（v26.10.14-v2，嗅探「开窗即有大小」的基础）==========
    // 必须在最前面：越早启动 observer，漏掉的资源越少。内部幂等 + 全异常静默降级。
    startPerfCollect();

    // ========== 嗅探后台预测量（v26.10.14-v4）==========
    // 按设置项决定是否跑（默认开）。首轮延后 5 秒（等首屏图先加载完），之后每 60 秒补一轮。
    // ⚠️ 这是唯一会在「用户没打开嗅探窗口」时发请求的地方，安全阀见 lib/snifferPre.ts 文件头。
    try {
        setPreMeasureEnabled(loadAllvalue().sniffPreMeasure !== false);
    } catch (e) {
        /* 读设置失败就当关掉：宁可不预测量，也不能连累启动 */
    }

    // ========== 挂载主面板 ==========
    try {
        mountPanel();
        // 面板被宿主页重绘（单页应用切路由等）连带删除时自动挂回，见 watchPanelHost 注释（v26.10.10-v8）
        watchPanelHost();
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
        unwatchPanelHost();
    });

    // ========== 页面启动 ==========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMonitoring);
    } else {
        startMonitoring();
    }
};

export default app;
