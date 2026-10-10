/**
 * 本脚本 UI 的共享常量。
 * 单独成文件是为了让 uiReset（样式隔离）与 panelHost（宿主/挂载）都能引用，
 * 避免两者互相 import 形成循环依赖。
 */

/** 面板宿主元素 id */
export const PANEL_HOST_ID = '__znhd_panel_host__';

/**
 * 浮层宿主元素 id（antd 弹窗/抽屉的 portal 容器，见 panelHost 的 `getOverlayContainer`）。
 *
 * ⚠️ **为什么定义在这里而不是 panelHost.tsx**（v26.10.10-v4 修）：
 * 原先它是 panelHost 顶层的 `const`。MainPanel → SniffModal → panelHost 存在真实的循环 import
 * （panelHost → PanelApp → MainPanel），webpack 按依赖顺序求值时 SniffModal 的**模块级常量**
 * `SNIFF_EXCLUDE_SELECTOR` 会先读到这里 → 运行时报
 * `Uncaught ReferenceError: Cannot access 'OVERLAY_HOST_ID' before initialization`（TDZ），整个脚本启动即挂。
 * 放到 panelIds 这个**叶子模块**（uiReset/panelHost 都只 import 它、它不 import 任何东西）才是根治；
 * 与 PANEL_HOST_ID 当初「单独成文件避免循环依赖」是同一个理由。
 * panelHost 仍转出该常量，保持既有 import 路径可用。
 */
export const OVERLAY_HOST_ID = '__znhd_overlay_host__';

/**
 * 主面板宽度（px）。
 *
 * v26.10.07-v3 按用户要求**缩到原来的 70%**（340 → 238）。
 * 放在这里而不是 MainPanel 内部，是因为 panelHost 的 `initialPoint()` 也要用它做初始坐标粗裁剪 ——
 * 若两边各写一份字面量，改宽度时必漏一处，表现为「存档在右侧的面板每次加载都往左漂」
 * （旧代码就是硬编码 340，见 panelHost 的 initialPoint）。
 */
export const PANEL_WIDTH = 238;
