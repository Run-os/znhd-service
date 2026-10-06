/**
 * 日志面板组件（原 app.ts「UI部分」内的 LogPanel）。
 * 模块化 P5：逐字迁移，仅加 export。
 */

import { LogEntry } from '@/lib/logger';

/** LogPanel 组件属性 */
export interface LogPanelProps {
    logEntries: LogEntry[];
}

export function LogPanel({ logEntries }: LogPanelProps) {
    // 根据日志类型定义颜色
    const colorMap = {
        info: '#1890ff', // 蓝色
        warning: '#faad14', // 橙黄色
        success: '#52c41a', // 绿色
        error: '#ff4d4f', // 红色
    };

    return CAT_UI.createElement(
        'div',
        {
            style: {
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: '500px',
                overflowY: 'auto',
                backgroundColor: '#f5f5f5',
                padding: '10px',
                borderRadius: '4px',
                fontFamily: 'monospace',
                fontSize: '12px',
            },
        },
        logEntries.map((entry, index) => {
            const color = colorMap[entry.type] || '#333333';
            return CAT_UI.createElement(
                'div',
                {
                    key: index,
                    style: {
                        color: color,
                        marginBottom: '4px',
                        borderLeft: `3px solid ${color}`,
                        paddingLeft: '8px',
                        fontWeight: 'bold',
                    },
                },
                `${entry.timestamp} - ${entry.message}`
            );
        })
    );
}
