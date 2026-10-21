import { h, type FunctionalComponent } from 'vue';

/**
 * 内联 SVG 图标（从 `src/lib/ui/icons.tsx` 等价迁到 Vue）。
 *
 * 为什么继续内联、不用 lucide-vue-next：
 *  · 约束文档要求优先内联；
 *  · 图形是 Lucide（ISC）的几何数据，原样保留即可，不随依赖升级改外观；
 *  · 图标数量少，内联只多几百字节。
 *
 * ⚠️ Win7 没有 Segoe UI Emoji，禁止换回补充平面 emoji。
 */

type SvgNode = [tag: string, attrs: Record<string, string | number>];

const ICONS = {
    settings: [
        [
            'path',
            {
                d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
            },
        ],
        ['circle', { cx: 12, cy: 12, r: 3 }],
    ],
    transfer: [
        [
            'path',
            {
                // 纸飞机（Heroicons 2 outline `paper-airplane`，v26.10.22 用户指定替换传输助手入口图标）
                d: 'M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5',
            },
        ],
    ],
    phrases: [
        [
            'path',
            {
                d: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z',
            },
        ],
    ],
    sniff: [
        [
            'path',
            {
                d: 'M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21',
            },
        ],
        ['path', { d: 'm14 19 3 3v-5.5' }],
        ['path', { d: 'm17 22 3-3' }],
        ['circle', { cx: 9, cy: 9, r: 2 }],
    ],
    volumeOn: [
        [
            'path',
            {
                d: 'M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z',
            },
        ],
        ['path', { d: 'M16 9a5 5 0 0 1 0 6' }],
        ['path', { d: 'M19.364 18.364a9 9 0 0 0 0-12.728' }],
    ],
    volumeOff: [
        [
            'path',
            {
                d: 'M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z',
            },
        ],
        ['path', { d: 'm16.5 14.5 5-5' }],
        ['path', { d: 'm16.5 9.5 5 5' }],
    ],
    crosshair: [
        ['circle', { cx: 12, cy: 12, r: 10 }],
        ['line', { x1: 22, x2: 18, y1: 12, y2: 12 }],
        ['line', { x1: 6, x2: 2, y1: 12, y2: 12 }],
        ['line', { x1: 12, x2: 12, y1: 6, y2: 2 }],
        ['line', { x1: 12, x2: 12, y1: 22, y2: 18 }],
    ],
    close: [
        ['path', { d: 'M18 6 6 18' }],
        ['path', { d: 'm6 6 12 12' }],
    ],
    /** 二维码（「连接设备」按钮，Lucide `qr-code`） */
    qr: [
        ['rect', { width: 5, height: 5, x: 3, y: 3, rx: 1 }],
        ['rect', { width: 5, height: 5, x: 16, y: 3, rx: 1 }],
        ['rect', { width: 5, height: 5, x: 3, y: 16, rx: 1 }],
        ['path', { d: 'M21 16h-3a2 2 0 0 0-2 2v3' }],
        ['path', { d: 'M21 21v.01' }],
        ['path', { d: 'M12 7v3a2 2 0 0 1-2 2H7' }],
        ['path', { d: 'M3 12h.01' }],
        ['path', { d: 'M12 3h.01' }],
        ['path', { d: 'M12 16v.01' }],
        ['path', { d: 'M16 12h1' }],
        ['path', { d: 'M21 12v.01' }],
        ['path', { d: 'M12 21v-1' }],
    ],
    /** 刷新（常用语标题栏按钮，与 React 版 RefreshIcon 同源） */
    refresh: [
        ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
        ['path', { d: 'M21 3v5h-5' }],
        ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
        ['path', { d: 'M3 21v-5h5' }],
    ],

    /* ==================================================== 传输助手（阶段 3 新增） */
    /** 对话（Lucide `message-circle`） */
    message: [['path', { d: 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z' }]],
    /** 文件分组（Lucide `folder`） */
    files: [
        [
            'path',
            {
                d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
            },
        ],
    ],
    info: [
        ['circle', { cx: 12, cy: 12, r: 10 }],
        ['path', { d: 'M12 16v-4' }],
        ['path', { d: 'M12 8h.01' }],
    ],
    grid: [
        ['rect', { width: 7, height: 7, x: 3, y: 3, rx: 1 }],
        ['rect', { width: 7, height: 7, x: 14, y: 3, rx: 1 }],
        ['rect', { width: 7, height: 7, x: 14, y: 14, rx: 1 }],
        ['rect', { width: 7, height: 7, x: 3, y: 14, rx: 1 }],
    ],
    plus: [
        ['path', { d: 'M5 12h14' }],
        ['path', { d: 'M12 5v14' }],
    ],
    search: [
        ['circle', { cx: 11, cy: 11, r: 8 }],
        ['path', { d: 'm21 21-4.3-4.3' }],
    ],
    smartphone: [
        ['rect', { width: 14, height: 20, x: 5, y: 2, rx: 2, ry: 2 }],
        ['path', { d: 'M12 18h.01' }],
    ],
    send: [
        ['path', { d: 'm5 12 7-7 7 7' }],
        ['path', { d: 'M12 19V5' }],
    ],
    fileText: [
        ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }],
        ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
        ['path', { d: 'M10 9H8' }],
        ['path', { d: 'M16 13H8' }],
        ['path', { d: 'M16 17H8' }],
    ],
    paperclip: [
        [
            'path',
            {
                d: 'm16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551',
            },
        ],
    ],
    image: [
        ['rect', { width: 18, height: 18, x: 3, y: 3, rx: 2, ry: 2 }],
        ['circle', { cx: 9, cy: 9, r: 2 }],
        ['path', { d: 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21' }],
    ],
    user: [
        ['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }],
        ['circle', { cx: 12, cy: 7, r: 4 }],
    ],
    trash: [
        ['path', { d: 'M3 6h18' }],
        ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6' }],
        ['path', { d: 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }],
        ['line', { x1: 10, x2: 10, y1: 11, y2: 17 }],
        ['line', { x1: 14, x2: 14, y1: 11, y2: 17 }],
    ],
    copy: [
        ['rect', { width: 14, height: 14, x: 8, y: 8, rx: 2, ry: 2 }],
        ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }],
    ],
    download: [
        ['path', { d: 'M12 15V3' }],
        ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
        ['path', { d: 'm7 10 5 5 5-5' }],
    ],
    check: [['path', { d: 'M20 6 9 17l-5-5' }]],
    printer: [
        ['path', { d: 'M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2' }],
        ['path', { d: 'M6 9V3h12v6' }],
        ['rect', { width: 12, height: 8, x: 6, y: 14, rx: 1 }],
    ],
    chevronLeft: [['path', { d: 'm15 18-6-6 6-6' }]],
    chevronRight: [['path', { d: 'm9 18 6-6-6-6' }]],
    rotateCw: [
        ['path', { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' }],
        ['path', { d: 'M21 3v5h-5' }],
    ],
    zoomIn: [
        ['circle', { cx: 11, cy: 11, r: 8 }],
        ['path', { d: 'm21 21-4.3-4.3' }],
        ['path', { d: 'M11 8v6' }],
        ['path', { d: 'M8 11h6' }],
    ],
    zoomOut: [
        ['circle', { cx: 11, cy: 11, r: 8 }],
        ['path', { d: 'm21 21-4.3-4.3' }],
        ['path', { d: 'M8 11h6' }],
    ],
    /** 主题切换：日间显示 sun（当前是白天，点击可切夜间由 moon 表示，面板里按当前模式二选一） */
    sun: [
        ['circle', { cx: 12, cy: 12, r: 4 }],
        ['path', { d: 'M12 2v2' }],
        ['path', { d: 'M12 20v2' }],
        ['path', { d: 'm4.93 4.93 1.41 1.41' }],
        ['path', { d: 'm17.66 17.66 1.41 1.41' }],
        ['path', { d: 'M2 12h2' }],
        ['path', { d: 'M20 12h2' }],
        ['path', { d: 'm6.34 17.66-1.41 1.41' }],
        ['path', { d: 'm19.07 4.93-1.41 1.41' }],
    ],
    moon: [['path', { d: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z' }]],
    /** 更多（Lucide `ellipsis`）：chat 窗口头部把次要动作收进下拉菜单 */
    more: [
        ['circle', { cx: 12, cy: 12, r: 1 }],
        ['circle', { cx: 19, cy: 12, r: 1 }],
        ['circle', { cx: 5, cy: 12, r: 1 }],
    ],
} satisfies Record<string, SvgNode[]>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
    name: IconName;
    /** 边长（px），默认 16 */
    size?: number;
    /** 描边色，默认 currentColor */
    color?: string;
}

export const Icon: FunctionalComponent<IconProps> = (props) =>
    h(
        'svg',
        {
            xmlns: 'http://www.w3.org/2000/svg',
            width: props.size ?? 16,
            height: props.size ?? 16,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: props.color || 'currentColor',
            'stroke-width': 2,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            'aria-hidden': 'true',
            focusable: 'false',
            style: 'display:block;flex:0 0 auto',
        },
        ICONS[props.name].map(([tag, attrs]) => h(tag, attrs))
    );

Icon.props = ['name', 'size', 'color'];
