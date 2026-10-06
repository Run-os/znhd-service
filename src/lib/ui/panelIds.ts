/**
 * 本脚本 UI 的共享常量。
 * 单独成文件是为了让 uiReset（样式隔离）与 panelHost（宿主/挂载）都能引用，
 * 避免两者互相 import 形成循环依赖。
 */

/** 面板宿主元素 id */
export const PANEL_HOST_ID = '__znhd_panel_host__';
