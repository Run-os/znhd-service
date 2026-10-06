// ========== 依赖（模块化抽出的 lib / ui 模块） ==========
import { MainPanel } from '@/lib/ui/MainPanel';
import { setupPanelPositionTracking } from '@/lib/ui/panelPosition';
import { loadPanelPoint, flushSaveAllvalue } from '@/lib/storage';
import { addLog } from '@/lib/logger';
import { startMonitoring, stopMonitoring } from '@/lib/monitor';
import { clearSpeechTimer } from '@/lib/speech';

/**
 * 脚本入口：本文件只做「装配」，业务实现全部在 src/lib/ 与 src/lib/ui/。
 * 顺序：创建主面板 → 跟踪面板位置 → 注册卸载清理 → 启动监控。
 * @returns {void}
 */
const app = () => {
    // ========== 创建主面板 ==========
    // 面板初始位置：优先使用上次保存的位置，否则用默认坐标
    try {
        CAT_UI.createPanel({
            header: {
                title: CAT_UI.Space(
                    [
                        CAT_UI.createElement('div', {
                            style: {
                                width: '24px',
                                height: '24px',
                                verticalAlign: 'middle',
                                borderRadius: '4px',
                                display: 'inline-block',
                                backgroundImage: 'url("https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico")',
                                backgroundSize: 'contain',
                                backgroundRepeat: 'no-repeat',
                                backgroundPosition: 'center',
                            },
                        }),
                        CAT_UI.Text('征纳互动监控', {
                            style: { fontSize: '16px' },
                        }),
                        // 获取并显示版本号
                        CAT_UI.Text(`v${GM_info.script.version}`, {
                            style: {
                                fontSize: '12px',
                                color: '#999',
                                marginLeft: '8px',
                            },
                        }),
                    ],
                    { style: { marginLeft: '5px' } }
                ),
                style: {
                    borderBottom: '1px solid var(--color-neutral-3)',
                },
            },
            render: MainPanel,

            point: loadPanelPoint() || {
                x: window.screen.width * 0.55,
                y: window.screen.height * 0.01,
            },
        });
    } catch (error) {
        // UI 面板创建失败时，至少不连累监控逻辑
        console.error('[监控] 面板创建失败:', error);
        if (typeof addLog === 'function') {
            addLog('面板创建失败: ' + (error && error.message), 'error', true);
        }
    }

    // ========== 面板位置保存 ==========
    setupPanelPositionTracking();

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
