import { useState } from 'react';
import { Modal, Button, Space, Typography } from 'antd';
import { LogEntry, LogType } from '@/lib/logger';
import { getOverlayContainer } from '@/lib/ui/panelHost';

const { Text } = Typography;

export interface LogModalProps {
    open: boolean;
    onClose: () => void;
    logEntries: LogEntry[];
    onClear: () => void;
}

/** 四种日志类型的展示元信息（顺序即筛选条顺序） */
const TYPE_META: { type: LogType; label: string; color: string }[] = [
    { type: 'info', label: '信息', color: '#1890ff' },
    { type: 'success', label: '成功', color: '#52c41a' },
    { type: 'warning', label: '警告', color: '#faad14' },
    { type: 'error', label: '错误', color: '#ff4d4f' },
];

/**
 * 运行日志弹窗（v26.10.06-v9：由 CAT_UI.Drawer 侧边抽屉改为 antd Modal 弹窗）。
 *
 * ⚠️ 排序（v26.10.06-v23 按用户要求改为「最新在最上方」）：DOM 按 logger 的「最新在前」顺序渲染
 *    （`logger.ts` 是 `[logItem, ...prevEntries]`），容器用默认的 `column` 即可让最新一条落在顶部，
 *    且视口天然停在顶部、**不需要任何 JS 锚定**。
 *    历史写法是用 `column-reverse` 把最新一条翻到底部并自动锚底；用户明确要求「从上到下生成、最新在最上方」，
 *    故改回 `column`——若日后有人想改回去，注意那会同时改变阅读方向（新日志从底部冒出）。
 *    弹窗内高度固定 + 自身滚动，外层 Modal 不再滚动。
 */
export default function LogModal({ open, onClose, logEntries, onClear }: LogModalProps) {
    const [filter, setFilter] = useState<Record<LogType, boolean>>({
        info: true,
        success: true,
        warning: true,
        error: true,
    });

    const counts: Record<string, number> = { info: 0, success: 0, warning: 0, error: 0 };
    logEntries.forEach((e) => {
        counts[e.type] = (counts[e.type] || 0) + 1;
    });
    const shown = logEntries.filter((e) => filter[e.type]);
    const allOn = TYPE_META.every((m) => filter[m.type]);

    const chip = (key: string, label: string, color: string, on: boolean, onClick: () => void) => (
        <div
            key={key}
            onClick={onClick}
            title={on ? '点击隐藏该类日志' : '点击显示该类日志'}
            style={{
                cursor: 'pointer',
                userSelect: 'none',
                fontSize: 12,
                lineHeight: '20px',
                padding: '0 9px',
                borderRadius: 11,
                border: '1px solid ' + (on ? color : '#d9d9d9'),
                background: on ? color : '#fff',
                color: on ? '#fff' : '#999',
                opacity: on ? 1 : 0.85,
            }}>
            {label}
        </div>
    );

    return (
        <Modal
            open={open}
            title="运行日志"
            onCancel={onClose}
            getContainer={getOverlayContainer}
            width={560}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            footer={
                <Space>
                    <Button onClick={onClose}>关闭</Button>
                </Space>
            }>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {chip('all', allOn ? '全部（点此全隐）' : '全部', '#666', allOn, () =>
                        setFilter({ info: !allOn, success: !allOn, warning: !allOn, error: !allOn })
                    )}
                    {TYPE_META.map((m) =>
                        chip(m.type, m.label + ' ' + (counts[m.type] || 0), m.color, filter[m.type], () =>
                            setFilter({ ...filter, [m.type]: !filter[m.type] })
                        )
                    )}
                </div>
                <Button danger disabled={logEntries.length === 0} onClick={onClear} style={{ flex: '0 0 auto' }}>
                    清空
                </Button>
            </div>

            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column', // v26.10.06-v23：最新日志在最上方（原为 column-reverse 自动锚底）
                    overflowY: 'auto',
                    height: 360,
                    marginTop: 10,
                    backgroundColor: '#f5f5f5',
                    padding: 8,
                    borderRadius: 4,
                    fontFamily: 'monospace',
                    fontSize: 12,
                }}>
                {shown.length ? (
                    shown.map((entry, index) => {
                        const color = (TYPE_META.filter((m) => m.type === entry.type)[0] || { color: '#333' }).color;
                        return (
                            <div
                                key={index}
                                style={{
                                    flex: '0 0 auto',
                                    color,
                                    marginBottom: 4,
                                    borderLeft: '3px solid ' + color,
                                    paddingLeft: 8,
                                    fontWeight: 'bold',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                }}>
                                {entry.timestamp} - {entry.message}
                            </div>
                        );
                    })
                ) : (
                    <div style={{ color: '#999', textAlign: 'center', padding: '24px 0' }}>
                        {logEntries.length ? '没有符合当前筛选条件的日志' : '暂无日志'}
                    </div>
                )}
            </div>

            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                共 {logEntries.length} 条（显示 {shown.length} 条，按 {allOn ? '全部类型' : '已选类型'}过滤）；
                <strong>新日志出现在最上方</strong>，向下翻阅历史时不会被拉回。
            </Text>
        </Modal>
    );
}
