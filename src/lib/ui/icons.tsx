/**
 * 内联 SVG 图标集（v26.10.09-v7 新增）。
 *
 * ── 为什么不用 emoji（本次要解决的问题）────────────────────────────────────
 * Win7 **没有 Segoe UI Emoji 字体**（Win8.1 才随系统引入），而原图标用的是补充平面 emoji：
 * `💬 U+1F4AC`、`🖼 U+1F5BC`、`💻 U+1F4BB`、`🎯 U+1F3AF`、`📱 U+1F4F1`、`🔊/🔇`。
 * 这些码位在 Win7 的任何系统字体里都没有字形，浏览器沿回退链退到底就是豆腐块/乱码。
 * 关键点：**「有没有字形」取决于目标机器装了什么字体**，我们无法控制 ——
 * 所以凡是「靠字体渲染」的方案（emoji、BMP 符号字符、图标字体）在 Win7 上都有残余风险。
 * 这里改用**矢量路径**：不经字体系统，全平台一致，任意缩放都清晰。
 *
 * ── 为什么不引图标库 ───────────────────────────────────────────────────────
 * `@ant-design/icons` 虽已在依赖里（antd 的传递依赖），但那是**在 src/ 里运行时 import 一个
 * devDependency**（分类不规范），且图标外观会随库版本升级而变化。这里把 path 直接内联：
 * 零运行时依赖、产物只多这几条 path、不受任何库升级影响。
 *
 * ── 来源与许可（必须保留）──────────────────────────────────────────────────
 * 图形取自 **Lucide**（https://lucide.dev）的官方 SVG，**ISC 许可**（lucide-static v1.53.0）。
 * 按原样内联其几何数据（24×24 viewBox、stroke-width 2、round cap/join），仅去掉 class 与注释头。
 * ISC 许可要求保留版权与许可声明 —— 就是本段注释。
 *
 * ⚠️ 新增图标时：保持同一规格（24×24、stroke 2、round），否则并排会粗细/大小不一。
 */

import type { CSSProperties, ReactNode } from 'react';

export interface IconProps {
    /** 边长（px），默认 16 */
    size?: number;
    /** 描边色，默认 `currentColor`（跟随所在元素的 color） */
    color?: string;
    style?: CSSProperties;
    className?: string;
}

/**
 * 统一的 SVG 外壳（Lucide 规格）。
 *
 * `display: block` + `flex: 0 0 auto` 不是随手写的：宿主税务页给 `svg` 加过
 * `margin: -2.75em auto 0` 与自己的 `vertical-align`，会把图标顶出控件
 * （见 `uiReset.ts` 里专门压 svg margin 的那段及其踩坑记录）。固定成块级、
 * 且在 flex 容器（antd Button）里不参与压缩后，图标位置在任何宿主页面下都一致。
 */
function SvgIcon({ size = 16, color, style, className, children }: IconProps & { children: ReactNode }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color || 'currentColor'}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            // 纯装饰性图标：对读屏隐藏，语义由按钮的 aria-label / 文案承担
            aria-hidden="true"
            focusable="false"
            className={className}
            style={{ display: 'block', flex: '0 0 auto', ...style }}>
            {children}
        </svg>
    );
}

/* ============================================================ 主面板四个入口 */

/** 设置（Lucide `settings`：齿轮 + 圆心） */
export function SettingsIcon(p: IconProps) {
    return (
        <SvgIcon {...p}>
            <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
            <circle cx="12" cy="12" r="3" />
        </SvgIcon>
    );
}

/** 常用语（Lucide `message-square`：对话气泡） */
export function PhrasesIcon(p: IconProps) {
    return (
        <SvgIcon {...p}>
            <path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z" />
        </SvgIcon>
    );
}

/** 历史记录（Lucide `image`：相框 + 太阳 + 山） */
export function HistoryIcon(p: IconProps) {
    return (
        <SvgIcon {...p}>
            <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </SvgIcon>
    );
}

/** 设备互联（Lucide `monitor`：显示器 + 底座） */
export function DeviceIcon(p: IconProps) {
    return (
        <SvgIcon {...p}>
            <rect width="20" height="14" x="2" y="3" rx="2" />
            <line x1="8" x2="16" y1="21" y2="21" />
            <line x1="12" x2="12" y1="17" y2="21" />
        </SvgIcon>
    );
}

/* ============================================================ 面板其它位置 */

/** 语音开（Lucide `volume-2`） */
export function VolumeOnIcon(p: IconProps) {
    return (
        <SvgIcon {...p}>
            <path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" />
            <path d="M16 9a5 5 0 0 1 0 6" />
            <path d="M19.364 18.364a9 9 0 0 0 0-12.728" />
        </SvgIcon>
    );
}

/** 语音关（Lucide `volume-x`） */
export function VolumeOffIcon(p: IconProps) {
    return (
        <SvgIcon {...p}>
            <path d="M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z" />
            <path d="m16.5 14.5 5-5" />
            <path d="m16.5 9.5 5 5" />
        </SvgIcon>
    );
}

/** 品牌图标加载失败时的回退（Lucide `crosshair`：准星） */
export function CrosshairIcon(p: IconProps) {
    return (
        <SvgIcon {...p}>
            <circle cx="12" cy="12" r="10" />
            <line x1="22" x2="18" y1="12" y2="12" />
            <line x1="6" x2="2" y1="12" y2="12" />
            <line x1="12" x2="12" y1="6" y2="2" />
            <line x1="12" x2="12" y1="22" y2="18" />
        </SvgIcon>
    );
}

/** 手机（Lucide `smartphone`：设备互联弹窗标题用） */
export function SmartphoneIcon(p: IconProps) {
    return (
        <SvgIcon {...p}>
            <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
            <path d="M12 18h.01" />
        </SvgIcon>
    );
}

/* ============================================================ 通用符号（替代 ✕ / ✓ 这类 Dingbats 字符） */

/**
 * 关闭/叉（Lucide `x`）。
 *
 * ⚠️ 为什么连 `✕`(U+2715) 也要换掉：它属 **Dingbats（U+2700–U+27BF）**，
 * Win7 的 Segoe UI Symbol 对该区段的覆盖**不确定**（我们无法在目标机器上验证），
 * 而「面板收起按钮」是高频入口，一旦是豆腐块就非常显眼。改用矢量后与字体彻底无关。
 */
export function CloseIcon(p: IconProps) {
    return (
        <SvgIcon {...p}>
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
        </SvgIcon>
    );
}

/** 对勾（Lucide `check`）：替代 `✓`(U+2713，同属 Dingbats) */
export function CheckIcon(p: IconProps) {
    return (
        <SvgIcon {...p}>
            <path d="M20 6 9 17l-5-5" />
        </SvgIcon>
    );
}
