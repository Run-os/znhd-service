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
        ['path', { d: 'M8 3 4 7l4 4' }],
        ['path', { d: 'M4 7h16' }],
        ['path', { d: 'm16 21 4-4-4-4' }],
        ['path', { d: 'M20 17H4' }],
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
    /** 刷新（常用语标题栏按钮，与 React 版 RefreshIcon 同源） */
    refresh: [
        ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
        ['path', { d: 'M21 3v5h-5' }],
        ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
        ['path', { d: 'M3 21v-5h5' }],
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
