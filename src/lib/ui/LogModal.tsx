import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Switch } from '../../../shared/ui/controls';
import { Modal } from '../../../shared/ui/OverlayModal';
import { cn } from '../../../shared/ui/cn';
import type { LogEntry, LogType } from '@/lib/logger';

export interface LogModalProps {
    open: boolean;
    onClose: () => void;
    logEntries: LogEntry[];
    onClear: () => void;
    /** 自动刷新：开=持续接收新日志并自动滚到底部；关=列表冻结在关闭那一刻的快照 */
    autoRefresh: boolean;
    onAutoRefreshChange: (next: boolean) => void;
}

/** 暗色终端风：等宽字体栈（走 Tailwind 的 font-mono token，与 tailwind.css 的定义同一份） */
const MONO_CLASS = 'font-mono';

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
 * 运行日志弹窗（v26.10.07-v1 重构为专业暗色终端风；v26.10.08-v14 换自研 Modal 基座）。
 *
 * 版式：暗色终端底 + 等宽字体 + 三栏行（时间戳 86px / 类型标签 52px / 消息自适应）。
 * 行级提示：错误/警告/成功行带整行底色与左侧 3px 色条；hover 高亮。底部为暗色状态栏。
 *
 * ⚠️ 排序（v26.10.07-v4，**反转了 v26.10.06-v23 的「最新在顶部」**）：
 *   `logger.ts` 的写入顺序是「最新在前」（`[logItem, ...prevEntries]`），本组件渲染前**把数组反过来**，
 *   于是 DOM 顺序 = 视觉顺序 = 最旧在上、**最新在下**。
 *   容器仍保持 `column`，**不是 `column-reverse`** —— 后者会把滚动原点翻到底部、阅读方向也跟着反过来。
 *
 * ⚠️ 自动刷新（v26.10.07-v4）：
 *   · 开（默认）：新日志持续进来，且每次更新后把滚动条拉到底部（用户明确选择「总是滚到底」）；
 *   · 关：列表**冻结**在关闭那一刻的快照（`snapshot`），往上翻看历史不会被新日志打断；
 *   · 开关持久化在 Allvalue（`constants` 的 `DEFAULTS.logAutoRefresh`），下次打开保持上次选择。
 */
export default function LogModal({
    open,
    onClose,
    logEntries,
    onClear,
    autoRefresh,
    onAutoRefreshChange,
}: LogModalProps) {
    const [filter, setFilter] = useState<Record<LogType, boolean>>({
        info: true,
        success: true,
        warning: true,
        error: true,
    });
    /** 关闭自动刷新时冻结下来的列表快照 */
    const [snapshot, setSnapshot] = useState<LogEntry[]>([]);
    const scrollerRef = useRef<HTMLDivElement | null>(null);

    /**
     * 滚动区节点的**回调 ref**。
     *
     * ⚠️ 不能只靠下面那个 effect：弹窗内容是在 `open` 之后才挂进 DOM 的，
     *    effect 触发那一刻 `scrollerRef.current` 仍是 null ——
     *    表现为「弹窗首屏永远停在最顶部」（v26.10.07-v4 实测：17 行日志、scrollHeight 630 > 360，
     *    scrollTop 却恒为 0）。回调 ref 在节点挂载那一刻触发，此时日志行已全部在 DOM 中、
     *    `scrollHeight` 已是最终值，可一次性滚到底。
     *
     * 依赖 `autoRefresh`：开关切换时回调身份变化 → React 重新挂载该 ref → 重新开启时自动回到底部。
     */
    const attachScroller = useCallback(
        (el: HTMLDivElement | null) => {
            scrollerRef.current = el;
            if (el && autoRefresh) el.scrollTop = el.scrollHeight;
        },
        [autoRefresh]
    );

    // 列表数据源：开 = 实时（logEntries 每次新增都是新数组引用）；关 = 冻结快照
    const source = autoRefresh ? logEntries : snapshot;

    const toggleAutoRefresh = (next: boolean) => {
        // ⚠️ 必须在关掉**之前**先冻结「此刻」的列表：否则 source 立刻切到空快照，列表会瞬间清空
        if (!next) setSnapshot(logEntries);
        onAutoRefreshChange(next);
    };

    const counts: Record<string, number> = { info: 0, success: 0, warning: 0, error: 0 };
    source.forEach((e) => {
        counts[e.type] = (counts[e.type] || 0) + 1;
    });
    const shown = source.filter((e) => filter[e.type]);
    const allOn = TYPE_META.every((m) => filter[m.type]);
    const latest = source[0]; // logger 写入顺序：index 0 是最新

    // 新日志到达 / 重新开启自动刷新 → 滚到底部看最新内容。
    // ⚠️ 冻结态下 source 是稳定引用且 autoRefresh 为 false，这里直接不触发（正确：冻结时不滚动）。
    // ⚠️ 弹窗**首次打开**由上面的回调 ref 负责（此刻 ref 尚为 null，本 effect 会静默跳过）。
    useEffect(() => {
        if (!open || !autoRefresh) return;
        const el = scrollerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [open, autoRefresh, source, filter]);

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
            width={560}
            onClose={onClose}
            footer={<Button onClick={onClose}>关闭</Button>}>
            {/* 筛选徽章 + 清空 */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                    {chip('all', allOn ? '全部（点此全隐）' : '全部', '#6b7b8d', '#ffffff', allOn, () =>
                        setFilter({ info: !allOn, success: !allOn, warning: !allOn, error: !allOn })
                    )}
                    {TYPE_META.map((m) =>
                        chip(m.type, m.label + ' ' + (counts[m.type] || 0), m.color, m.fg, filter[m.type], () =>
                            setFilter({ ...filter, [m.type]: !filter[m.type] })
                        )
                    )}
                </div>
                <Button danger disabled={logEntries.length === 0} onClick={onClear} className="shrink-0">
                    清空
                </Button>
            </div>

            {/* 暗色终端日志区 */}
            <div
                ref={attachScroller}
                className={cn(
                    MONO_CLASS,
                    'mt-2.5 flex flex-col overflow-y-auto rounded border border-[#1f2733] bg-[#0f141a] py-2',
                    'text-[12.5px] leading-[1.9]'
                )}
                style={{ height: 360 }}>
                {shown.length ? (
                    // 反转成「最旧在上、最新在下」；slice() 先复制，避免 reverse() 改动源数组
                    shown
                        .slice()
                        .reverse()
                        .map((entry, index) => {
                            const m = metaOf(entry.type);
                            return (
                                <div
                                    key={index}
                                    // ⚠️ 这三个 znhd-log-* 类名是**冒烟断言的稳定契约**
                                    //    （scripts/smoke/znhd-smoke.html 按它们取时间戳/类型/消息三栏，
                                    //    并用行数断言「日志确实渲染了」）。Tailwind 工具类能表达布局，
                                    //    但**语义分栏的钩子**仍要用类名承载，故这里保留。
                                    className="znhd-log-row group flex items-start gap-2 border-l-[3px] border-l-transparent py-0.5 pl-2 pr-2.5 hover:bg-white/10"
                                    style={{ background: m.bg, borderLeftColor: m.bar }}>
                                    <span className="znhd-log-ts w-[86px] shrink-0 text-[#52667a]">
                                        {entry.timestamp}
                                    </span>
                                    <span
                                        className="znhd-log-tag w-[52px] shrink-0 font-semibold"
                                        style={{ color: m.color }}>
                                        {m.label}
                                    </span>
                                    <span className="znhd-log-msg min-w-0 flex-1 whitespace-pre-wrap break-words text-[#c3d1df]">
                                        {entry.message}
                                    </span>
                                </div>
                            );
                        })
                ) : (
                    <div className="py-6 text-center text-[#6b7b8d]">
                        {source.length ? '没有符合当前筛选条件的日志' : '暂无日志'}
                    </div>
                )}
            </div>

            {/* 状态栏（替代原说明文字）：总数 · 显示数 · 最新时间 */}
            <div
                className="mt-2 flex items-center justify-between gap-2 border-t border-[#1f2733] pt-1.5 text-[11.5px] text-[#6b7b8d]"
                style={{ borderTopColor: '#1f2733' }}>
                <span>
                    共 <b className="text-[#c3d1df]">{source.length}</b> 条 · 显示{' '}
                    <b className="text-[#c3d1df]">{shown.length}</b> 条（{allOn ? '全类型' : '已选'}）
                    {autoRefresh ? '' : ' · 已冻结'}
                </span>
                <span className="flex items-center gap-2.5">
                    <span
                        className="flex items-center gap-1.5"
                        title="开启后新日志持续刷新并自动滚到底部；关闭后列表冻结在当前快照，便于往上翻看历史">
                        <Switch size="small" checked={autoRefresh} onChange={toggleAutoRefresh} />
                        自动刷新
                    </span>
                    <span>
                        最新{' '}
                        <span className="font-mono" style={{ color: latest ? metaOf(latest.type).color : '#6b7b8d' }}>
                            {latest ? latest.timestamp : '--:--:--'}
                        </span>
                    </span>
                </span>
            </div>
        </Modal>
    );
}
