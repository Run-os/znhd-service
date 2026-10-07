/**
 * 本脚本 UI 的共享常量。
 * 单独成文件是为了让 uiReset（样式隔离）与 panelHost（宿主/挂载）都能引用，
 * 避免两者互相 import 形成循环依赖。
 */

/** 面板宿主元素 id */
export const PANEL_HOST_ID = '__znhd_panel_host__';

/**
 * 主面板宽度（px）。
 *
 * v26.10.07-v3 按用户要求**缩到原来的 70%**（340 → 238）。
 * 放在这里而不是 MainPanel 内部，是因为 panelHost 的 `initialPoint()` 也要用它做初始坐标粗裁剪 ——
 * 若两边各写一份字面量，改宽度时必漏一处，表现为「存档在右侧的面板每次加载都往左漂」
 * （旧代码就是硬编码 340，见 panelHost 的 initialPoint）。
 */
export const PANEL_WIDTH = 238;
