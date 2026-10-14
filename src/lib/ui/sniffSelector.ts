/**
 * 「图片嗅探」扫描时要跳过的子树选择器（v26.10.14-v4 起从 SniffModal 下沉到本叶子模块）。
 *
 * 原先它是 `ui/SniffModal.tsx` 的模块级常量。v26.10.14-v4 加了**后台预测量**（`lib/snifferPre.ts`，
 * 不开窗口也在跑）后，那个非 UI 的后台任务同样需要这份选择器 —— 若从 SniffModal 取，等于让一个
 * lib 模块 import 一个 antd 组件文件：既把整棵 UI 依赖树拉进后台任务，又正好撞上 SniffModal 那条
 * 循环 import 的雷（MainPanel → SniffModal → panelHost，见 panelIds.ts 里 TDZ 的踩坑记录）。
 *
 * 故下沉到这里：**只 import 三个宿主 id 的叶子模块**，谁要用谁来取。
 * 判据本身不变 —— 我们的面板 / 浮层 / 预览三层都挂在 documentElement 下，扫描必须整棵排除，
 * 否则就是「自己嗅自己」（图标全是内联 SVG，面板里还有一堆 antd 自带插图）。
 */

import { OVERLAY_HOST_ID, PANEL_HOST_ID } from '@/lib/ui/panelIds';
import { PREVIEW_HOST_ID } from '../../../shared/preview/host';

/** 本脚本自己的三个宿主：面板 / 浮层（弹窗抽屉的 portal 容器）/ 预览 */
export const SNIFF_EXCLUDE_SELECTOR = ['#' + PANEL_HOST_ID, '#' + OVERLAY_HOST_ID, '#' + PREVIEW_HOST_ID].join(',');
