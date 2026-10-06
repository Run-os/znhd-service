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
#${PANEL_HOST_ID}, .ant-modal-root, .ant-picker-dropdown, .ant-message, .ant-notification, .ant-tooltip, .ant-dropdown {
  box-sizing: border-box;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.5715;
}
#${PANEL_HOST_ID} *, .ant-modal-root *, .ant-picker-dropdown *, .ant-message *, .ant-notification *, .ant-tooltip *, .ant-dropdown * {
  box-sizing: border-box;
  /* inherit：低优先级复位，antd 自己需要居中的组件（Empty 等）仍用其类规则覆盖 */
  text-align: inherit;
}
/* 图标垂直对齐：宿主页面若有 svg 的 vertical-align/line-height 规则，会把 antd 图标顶出输入框 */
#${PANEL_HOST_ID} svg, .ant-modal-root svg, .ant-picker-dropdown svg, .ant-message svg, .ant-notification svg {
  vertical-align: inherit;
}
/* 输入类控件去掉宿主页面可能带来的额外外边距/最小高度 */
#${PANEL_HOST_ID} input, #${PANEL_HOST_ID} textarea, .ant-modal-root input, .ant-modal-root textarea {
  margin: 0;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
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
