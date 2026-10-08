/**
 * 本脚本 UI 的样式隔离层（v26.10.06-v11）。
 *
 * 背景：antd v5+ **不再自带全局 reset**，官方迁移文档明确要求手动引入 `antd/dist/reset.css`；
 * 我们没引入，而面板/弹窗又是注入到**别人的页面**里，于是宿主页面的全局 CSS 会渗进来：
 *   · `* { text-align: center }` → 弹窗里所有文字变居中；
 *   · 非 `border-box` 的盒模型 / 页面自定义 `line-height`/`font-size` → 输入框内的
 *     图标（时间选择器时钟、输入框清空 ×）垂直偏移、跑出输入框。
 *
 * 为什么不用 `import 'antd/dist/reset.css'`：那会**全局重置宿主页面**（税务页也会被改样式），
 * 不可接受。故这里把 reset 的关键规则**按本脚本的容器加前缀**注入，等价于「只给我们的 UI 做 reset」。
 *
 * ⚠️ 选择器只覆盖本脚本自己渲染的容器：面板宿主、Modal/Drawer 根、Picker 浮层、message 浮层。
 */

import { PANEL_HOST_ID } from '@/lib/ui/panelIds';

const RESET_CSS = `
/* 盒模型与文本基线：宿主页面常把 * 设为 content-box / 居中，这里只复位我们的容器 */
#${PANEL_HOST_ID}, .ant-modal-root, .ant-drawer, .ant-picker-dropdown, .ant-message, .ant-notification, .ant-tooltip, .ant-dropdown {
  box-sizing: border-box;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.5715;
}
#${PANEL_HOST_ID} *, .ant-modal-root *, .ant-drawer *, .ant-picker-dropdown *, .ant-message *, .ant-notification *, .ant-tooltip *, .ant-dropdown * {
  box-sizing: border-box;
  /* inherit：低优先级复位，antd 自己需要居中的组件（Empty 等）仍用其类规则覆盖 */
  text-align: inherit;
}
/* 图标垂直对齐：宿主页面若有 svg 的 vertical-align/line-height 规则，会把 antd 图标顶出输入框 */
#${PANEL_HOST_ID} svg, .ant-modal-root svg, .ant-drawer svg, .ant-picker-dropdown svg, .ant-message svg, .ant-notification svg, .ant-image-preview svg {
  vertical-align: inherit;
}
/* ★ 图标被第三方样式加负外边距而跑出控件（用户实测：时钟图标的计算样式里
   margin: -2.75em auto 0，按 16px 字号约 -44px；antd 自身从不给 svg 设 margin）。
   这类规则特异性只有 (0,0,1)，用带容器前缀的选择器即可稳压。
   ⚠️ v26.10.08-v8：**.ant-image-preview 必须在内** —— 预览挂在自己建的宿主 div 下
   （见 RecvHistoryModal 的 getPreviewHost），既不在面板宿主里、也不在 .ant-modal-root 里；
   漏了它就会让工具栏图标被顶到胶囊上方（实测偏移 25px），表现成「图标看不见、只剩一条灰色胶囊」。
   对照：弹窗关闭图标的同类偏移为 0（因为它被本规则覆盖）。 */
#${PANEL_HOST_ID} svg, .ant-modal-root svg, .ant-drawer svg, .ant-picker-dropdown svg, .ant-message svg, .ant-notification svg, .ant-tooltip svg, .ant-dropdown svg, .ant-image-preview svg {
  margin: 0;
}
/* 输入类控件去掉宿主页面可能带来的额外外边距/最小高度 */
#${PANEL_HOST_ID} input, #${PANEL_HOST_ID} textarea, .ant-modal-root input, .ant-modal-root textarea, .ant-drawer input, .ant-drawer textarea {
  margin: 0;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
}

/* ===== 放大预览期间压掉所有「下层浮层遮罩」（v26.10.08-v11）=====
   背景：antd 的 Modal / Drawer 遮罩都是 rgba(0,0,0,0.45)。图片预览是**全屏**浮层，
   它自己那层遮罩就够做背景了；可底下凡是还开着的弹窗/抽屉，遮罩**依然在画**，
   两层叠加就是 1-(0.55×0.55)=0.6975 —— 白底被压到灰度 77（单层是 140），肉眼即「没有官方明亮」。
   ⚠️ 只挡「历史记录」自己那层不够：实测预览打开时，取样点上还叠着设置抽屉的 .ant-drawer-mask，
   以及其它弹窗的 .ant-modal-mask。故这里按「预览期间一律隐藏下层遮罩」处理：
   它们这时本来就被全屏预览完全盖住、对视觉毫无贡献，只是白白多加一层暗。
   类名由 RecvHistoryModal 在预览开/关时挂到 documentElement 上。 */
html.znhd-previewing .ant-modal-mask,
html.znhd-previewing .ant-drawer-mask {
  display: none !important;
}

/* ===== 滚动条（v26.10.06-v20）=====
   antd 没有滚动条组件，也没有对应的 design token（CLI 实测：「info Scrollbar」找不到、
   「token」里 scroll/thumb/track 零匹配）；它自己也只在 @rc-component/virtual-list 内部自绘滚动条，
   且不对外导出。故此处按 antd 的通用做法：定制浏览器原生滚动条。
   不动它时，Windows 默认滚动条又宽又带箭头（约 17px），嵌在圆角弹窗里显得很生硬。
   做法：10px 槽宽 + 3px 透明边框 + background-clip: padding-box → 视觉上是一条细圆角灰条；
   标准属性（scrollbar-width/color）覆盖 Firefox 与 Chrome 121+，::-webkit-* 覆盖旧版 Chromium/Edge。
   ⚠️ 本段是模板字符串的一部分：注释里**不能出现反引号**，否则会提前截断模板（本次踩过）。 */
#${PANEL_HOST_ID} *, .ant-modal-root *, .ant-drawer *, .ant-picker-dropdown *, .ant-message *, .ant-notification *, .ant-tooltip *, .ant-dropdown *, .ant-image-preview * {
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.25) transparent;
}
#${PANEL_HOST_ID} *::-webkit-scrollbar,
.ant-modal-root *::-webkit-scrollbar,
.ant-drawer *::-webkit-scrollbar,
.ant-picker-dropdown *::-webkit-scrollbar,
.ant-dropdown *::-webkit-scrollbar,
.ant-image-preview *::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
#${PANEL_HOST_ID} *::-webkit-scrollbar-thumb,
.ant-modal-root *::-webkit-scrollbar-thumb,
.ant-drawer *::-webkit-scrollbar-thumb,
.ant-picker-dropdown *::-webkit-scrollbar-thumb,
.ant-dropdown *::-webkit-scrollbar-thumb,
.ant-image-preview *::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.22);
  border: 3px solid transparent;
  background-clip: padding-box;
  border-radius: 8px;
}
#${PANEL_HOST_ID} *::-webkit-scrollbar-thumb:hover,
.ant-modal-root *::-webkit-scrollbar-thumb:hover,
.ant-drawer *::-webkit-scrollbar-thumb:hover,
.ant-picker-dropdown *::-webkit-scrollbar-thumb:hover,
.ant-dropdown *::-webkit-scrollbar-thumb:hover,
.ant-image-preview *::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.38);
  background-clip: padding-box;
}
#${PANEL_HOST_ID} *::-webkit-scrollbar-track,
.ant-modal-root *::-webkit-scrollbar-track,
.ant-drawer *::-webkit-scrollbar-track,
.ant-picker-dropdown *::-webkit-scrollbar-track,
.ant-dropdown *::-webkit-scrollbar-track,
.ant-image-preview *::-webkit-scrollbar-track,
#${PANEL_HOST_ID} *::-webkit-scrollbar-corner,
.ant-modal-root *::-webkit-scrollbar-corner,
.ant-drawer *::-webkit-scrollbar-corner {
  background: transparent;
}
`;

let injected = false;

/**
 * 注入样式隔离层（只注入一次，幂等）。
 * 用 GM_addStyle：不进构建产物的 CSS 流程，也不受宿主页面 CSP 的 <style> 限制影响
 * （GM_addStyle 由油猴管理器在沙箱侧插入，且只在文档里加一个 style 节点）。
 */
export function injectUiReset(): void {
    if (injected) return;
    injected = true;
    try {
        if (typeof GM_addStyle === 'function') {
            GM_addStyle(RESET_CSS);
            return;
        }
    } catch (e) {
        /* 落到下面的兜底 */
    }
    const style = document.createElement('style');
    style.id = '__znhd_ui_reset__';
    style.textContent = RESET_CSS;
    document.head.appendChild(style);
}
