import { useState } from 'react';
import { Modal, Button } from 'antd';
import type { LogEntry, LogType } from '@/lib/logger';
import { getOverlayContainer } from '@/lib/ui/panelHost';

export interface LogModalProps {
    open: boolean;
    onClose: () => void;
    logEntries: LogEntry[];
    onClear: () => void;
}

/** 暗色终端风：等宽字体栈（与日志区一致复用） */
const MONO = "'SF Mono','Consolas','Menlo','Courier New',monospace";

/**
 * 四种日志类型的展示元信息（顺序即筛选条顺序）。
 * color = 类型色；fg = 徽章文字色（亮色类型用深色字，深色类型用白字）；
 * bg = 整行底色；bar = 左侧 3px 色条（信息行不设，保持安静）。
 */
const TYPE_META: { type: LogType; label: string; color: string; fg: string; bg: string; bar: string }[] = [
    { type: 'info', label: '信息', color: '#1677ff', fg: '#ffffff', bg: 'transparent', bar: 'transparent' },
    { type: 'success', label: '成功', color: '#52c41a', fg: '#08130c', bg: 'rgba(82,196,26,.06)', bar: '#52c41a' },
    { type: 'warning', label: '警告', color: '#faad14', fg: '#332a0a', bg: 'rgba(250,173,20,.07)', bar: '#faad14' },
    { type: 'error', label: '错误', color: '#ff4d4f', fg: '#ffffff', bg: 'rgba(255,77,79,.08)', bar: '#ff4d4f' },
];
const metaOf = (t: LogType) => TYPE_META.find((m) => m.type === t) || TYPE_META[0];

/**
 * 行级样式（内联 style 表达不了 `:hover`）——在本文件内注入一小段 scoped CSS，
 * 不引入任何依赖、不动全局样式；类名统一 `znhd-log-` 前缀避免与宿主页面冲突。
 */
const LOG_CSS = `
.znhd-log-row { display: flex; align-items: flex-start; gap: 8px; padding: 2px 10px 2px 9px; border-left: 3px solid transparent; }
.znhd-log-row:hover { background: rgba(127,127,127,.12); }
.znhd-log-ts { flex: 0 0 86px; color: #52667a; }
.znhd-log-tag { flex: 0 0 52px; font-weight: 600; }
.znhd-log-msg { flex: 1 1 auto; min-width: 0; color: #c3d1df; white-space: pre-wrap; word-break: break-word; }
`;

/**
 * 运行日志弹窗（v26.10.07-v1：按 `运行日志样式重构-开发文档.md` 重构为专业暗色终端风）。
 *
 * 版式：暗色终端底 + 等宽字体 + 三栏行（时间戳 86px / 类型标签 52px / 消息自适应）。
 * 行级提示：错误/警告/成功行带整行底色与左侧 3px 色条；hover 高亮。底部为暗色状态栏。
 *
 * ⚠️ 排序（v26.10.06-v23 起）：DOM 按 logger 的「最新在前」顺序渲染（`logger.ts` 是
 * `[logItem, ...prevEntries]`），容器用 `column` 让最新一条落在顶部，视口天然停顶、无需 JS 锚定；
 * 不要改成 `column-reverse`（那会把最新翻到底部并改变阅读方向）。
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
    const latest = logEntries[0]; // logger 写入顺序：index 0 是最新

    /** 筛选徽章：背景 = 类型色，文字色按类型明暗取反差色；关闭态为描边弱化样式 */
    const chip = (key: string, label: string, color: string, fg: string, on: boolean, onClick: () => void) => (
        <div
            key={key}
            onClick={onClick}
            title={on ? '点击隐藏该类日志' : '点击显示该类日志'}
            style={{
                cursor: 'pointer',
                userSelect: 'none',
                fontSize: 12,
                lineHeight: '20px',
                padding: '0 10px',
                borderRadius: 11,
                border: '1px solid ' + (on ? color : '#3a4655'),
                background: on ? color : 'transparent',
                color: on ? fg : '#8b9aab',
                fontWeight: 500,
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
            footer={<Button onClick={onClose}>关闭</Button>}>
            <style>{LOG_CSS}</style>

            {/* 筛选徽章 + 清空 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {chip('all', allOn ? '全部（点此全隐）' : '全部', '#6b7b8d', '#ffffff', allOn, () =>
                        setFilter({ info: !allOn, success: !allOn, warning: !allOn, error: !allOn })
                    )}
                    {TYPE_META.map((m) =>
                        chip(m.type, m.label + ' ' + (counts[m.type] || 0), m.color, m.fg, filter[m.type], () =>
                            setFilter({ ...filter, [m.type]: !filter[m.type] })
                        )
                    )}
                </div>
                <Button danger disabled={logEntries.length === 0} onClick={onClear} style={{ flex: '0 0 auto' }}>
                    清空
                </Button>
            </div>

            {/* 暗色终端日志区 */}
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column', // 最新在最上方（见文件头说明，勿改回 column-reverse）
                    overflowY: 'auto',
                    height: 360,
                    marginTop: 10,
                    background: '#0f141a',
                    border: '1px solid #1f2733',
                    borderRadius: 4,
                    padding: '8px 0',
                    fontFamily: MONO,
                    fontSize: 12.5,
                    lineHeight: 1.9,
                }}>
                {shown.length ? (
                    shown.map((entry, index) => {
                        const m = metaOf(entry.type);
                        return (
                            <div
                                key={index}
                                className="znhd-log-row"
                                style={{ background: m.bg, borderLeftColor: m.bar }}>
                                <span className="znhd-log-ts">{entry.timestamp}</span>
                                <span className="znhd-log-tag" style={{ color: m.color }}>
                                    {m.label}
                                </span>
                                <span className="znhd-log-msg">{entry.message}</span>
                            </div>
                        );
                    })
                ) : (
                    <div style={{ color: '#6b7b8d', textAlign: 'center', padding: '24px 0' }}>
                        {logEntries.length ? '没有符合当前筛选条件的日志' : '暂无日志'}
                    </div>
                )}
            </div>

            {/* 状态栏（替代原说明文字）：总数 · 显示数 · 最新时间 */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    borderTop: '1px solid #1f2733',
                    marginTop: 8,
                    paddingTop: 6,
                    color: '#6b7b8d',
                    fontSize: 11.5,
                }}>
                <span>
                    共 <b style={{ color: '#c3d1df' }}>{logEntries.length}</b> 条 · 显示{' '}
                    <b style={{ color: '#c3d1df' }}>{shown.length}</b> 条（{allOn ? '全类型' : '已选'}）
                </span>
                <span>
                    最新{' '}
                    <span
                        style={{
                            fontFamily: MONO,
                            color: latest ? metaOf(latest.type).color : '#6b7b8d',
                        }}>
                        {latest ? latest.timestamp : '--:--:--'}
                    </span>
                </span>
            </div>
        </Modal>
    );
}
