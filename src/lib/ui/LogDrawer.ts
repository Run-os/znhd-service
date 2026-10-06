/**
 * 日志抽屉（v26.10.06-v8 从「设置菜单」里独立出来）：时间正序 + 自动停在最新一条 + 按类型过滤 + 清空。
 *
 * ⚠️ 两个关键实现取舍（改动前先读）：
 * 1. **自动滚底不写一行 JS**：列表容器用 `flexDirection: 'column-reverse'`，而 DOM 仍按
 *    logger 的存储顺序（最新在前）渲染 —— 浏览器自动把视口锚在「底部＝最新一条」，
 *    新日志到达时只要用户还停在底部就保持跟随；用户向上翻阅历史时不会被新日志拽回底部。
 *    比「useEffect + ref + scrollTop」省掉 ref API 依赖（CAT_UI.createElement 是否透传 ref 无保证）。
 * 2. **不要把日志塞进设置抽屉**：日志条目里含版本号（「脚本已启动，版本 vX」），而面板版本号断言
 *    取的是 shadow 文本里**第一个** `vX.Y.Z-vN` 匹配（见 AGENT.md「读面板文本要用 collectShadowText」
 *    那条踩坑）。日志与面板同处一个 shadow root，一旦展开就会与面板版本号串台，故日志必须独立成一个
 *    抽屉、默认收起（收起时不展开、不参与面板文本）。
 */

import { LogEntry, LogType } from '@/lib/logger';

/** LogDrawer 组件属性 */
export interface LogDrawerProps {
    visible: boolean;
    setVisible: (v: boolean) => void;
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

export function LogDrawer({ visible, setVisible, logEntries, onClear }: LogDrawerProps) {
    // 四种类型各自的开关（可多选）；默认全开
    const [filter, setFilter] = CAT_UI.useState({ info: true, success: true, warning: true, error: true });

    // 各类型条数（显示在筛选条上，便于一眼看出有没有错误）
    const counts: Record<string, number> = { info: 0, success: 0, warning: 0, error: 0 };
    logEntries.forEach((e) => {
        counts[e.type] = (counts[e.type] || 0) + 1;
    });

    const shown = logEntries.filter((e) => (filter as any)[e.type]);
    const allOn = TYPE_META.every((m) => (filter as any)[m.type]);
    const toggle = (type: LogType) => setFilter({ ...filter, [type]: !(filter as any)[type] });
    const setAll = (on: boolean) => setFilter({ info: on, success: on, warning: on, error: on });

    // 筛选条上的一个小胶囊（用 div 而非 Button：需要按类型着色，且点击切换开关）
    const chip = (key: string, label: string, color: string, on: boolean, onClick: () => void) =>
        CAT_UI.createElement(
            'div',
            {
                key,
                onClick,
                title: on ? '点击隐藏该类日志' : '点击显示该类日志',
                style: {
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontSize: '12px',
                    lineHeight: '20px',
                    padding: '0 9px',
                    marginRight: '6px',
                    marginBottom: '6px',
                    borderRadius: '11px',
                    border: '1px solid ' + (on ? color : '#d9d9d9'),
                    background: on ? color : '#fff',
                    color: on ? '#fff' : '#999',
                    opacity: on ? 1 : 0.85,
                },
            },
            label
        );

    return CAT_UI.Drawer(
        CAT_UI.createElement('div', { style: { textAlign: 'left' } }, [
            // 第一行：筛选胶囊（左）+ 清空（右）
            CAT_UI.createElement(
                'div',
                {
                    style: {
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                    },
                },
                [
                    CAT_UI.createElement(
                        'div',
                        { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center' } },
                        [
                            chip('all', allOn ? '全部（点此全隐）' : '全部', '#666', allOn, () => setAll(!allOn)),
                            ...TYPE_META.map((m) =>
                                chip(
                                    m.type,
                                    m.label + ' ' + (counts[m.type] || 0),
                                    m.color,
                                    (filter as any)[m.type],
                                    () => toggle(m.type)
                                )
                            ),
                        ]
                    ),
                    CAT_UI.Button('清空', {
                        type: 'primary',
                        onClick: onClear,
                        disabled: logEntries.length === 0,
                        style: { marginBottom: '6px', flex: '0 0 auto' },
                    }),
                ]
            ),
            // 日志列表：column-reverse 实现「自动停在最新一条」（见文件头说明 1）
            CAT_UI.createElement(
                'div',
                {
                    style: {
                        display: 'flex',
                        flexDirection: 'column-reverse',
                        overflowY: 'auto',
                        height: '360px',
                        backgroundColor: '#f5f5f5',
                        padding: '8px',
                        borderRadius: '4px',
                        fontFamily: 'monospace',
                        fontSize: '12px',
                    },
                },
                shown.length
                    ? shown.map((entry, index) => {
                          const color =
                              TYPE_META.filter((m) => m.type === entry.type).map((m) => m.color)[0] || '#333333';
                          return CAT_UI.createElement(
                              'div',
                              {
                                  key: index,
                                  style: {
                                      flex: '0 0 auto',
                                      color: color,
                                      marginBottom: '4px',
                                      borderLeft: '3px solid ' + color,
                                      paddingLeft: '8px',
                                      fontWeight: 'bold',
                                      whiteSpace: 'pre-wrap',
                                      wordBreak: 'break-word',
                                  },
                              },
                              entry.timestamp + ' - ' + entry.message
                          );
                      })
                    : CAT_UI.createElement(
                          'div',
                          { style: { color: '#999', textAlign: 'center', padding: '24px 0' } },
                          logEntries.length ? '没有符合当前筛选条件的日志' : '暂无日志'
                      )
            ),
            CAT_UI.createElement(
                'p',
                { style: { margin: '8px 0 0', color: '#999', fontSize: '12px', lineHeight: '1.5' } },
                '共 ' +
                    logEntries.length +
                    ' 条（显示 ' +
                    shown.length +
                    ' 条，按 ' +
                    (allOn ? '全部类型' : '已选类型') +
                    '过滤）；新日志会自动出现在最下方，向上翻阅时不会被拉回。'
            ),
        ]),
        {
            title: '运行日志',
            visible,
            width: 460,
            focusLock: true,
            autoFocus: false,
            zIndex: 10001,
            onOk: () => {
                setVisible(false);
            },
            onCancel: () => {
                setVisible(false);
            },
        }
    );
}
