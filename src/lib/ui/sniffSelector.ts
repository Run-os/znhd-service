/**
 * 「图片嗅探」扫描时要跳过的子树选择器（v26.10.14-v4 起从 SniffModal 下沉到本叶子模块）。
 *
 * 原先它是 `ui/SniffModal.tsx` 的模块级常量。v26.10.14-v4 加了**后台预测量**（`lib/snifferPre.ts`，
 * 不开窗口也在跑）后，那个非 UI 的后台任务同样需要这份选择器 —— 若从 UI 组件取，等于让一个
 * lib 模块 import 一个组件文件：既把整棵 UI 依赖树拉进后台任务，又撞上循环 import 的雷。
 *
 * 故下沉到这里：**只 import 宿主 id 的叶子模块**，谁要用谁来取。
 *
 * v26.10.18-v7：React + antd 已删。Vue 版的浮层（Dialog/Sheet 的 Portal）与图片预览
 * （ImagePreview 的 Teleport）全部挂进**面板宿主的影子树**里，因此排除面板宿主一棵
 * 就覆盖了「面板 / 弹窗 / 预览」三层；浮层宿主（OVERLAY_HOST_ID）保留在清单里，
 * 万一将来有浮层挂到 documentElement 下也不至于「自己嗅自己」。
 * （旧 React 版的第三个宿主 `#__znhd_preview_host__` 随 `shared/preview/host.ts` 一起删除。）
 */

import { OVERLAY_HOST_ID, PANEL_HOST_ID } from '@/lib/ui/panelIds';

/** 本脚本自己的宿主：面板（内含影子树里的全部弹窗与预览）/ 浮层兜底宿主 */
export const SNIFF_EXCLUDE_SELECTOR = ['#' + PANEL_HOST_ID, '#' + OVERLAY_HOST_ID].join(',');
