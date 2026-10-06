/**
 * 全局消息提示桥。
 *
 * 背景：v26.10.06-v9 起 UI 从 CAT_UI 换成 React + Ant Design，`CAT_UI.Message` 不复存在。
 * 但 `storage.ts` 这类**非组件**模块也要能弹提示，而 antd 的静态 `message.error()`：
 *   · 不继承 ConfigProvider 的主题；
 *   · v6 官方推荐改用 `App.useApp()`（能拿到 context 内的实例）。
 * 故这里保存一份由根组件注入的 message 实例，模块级代码统一走 `notify.*`。
 */

import type { MessageInstance } from 'antd/es/message/interface';

let messageApi: MessageInstance | null = null;

/** 由根组件注入/清除 antd message 实例 */
export function setMessageApi(api: MessageInstance | null): void {
    messageApi = api;
}

type Level = 'success' | 'error' | 'warning' | 'info';

/** 统一提示入口；根组件尚未挂载时静默丢弃（启动早期信息走 addLog，不阻塞流程） */
function toast(level: Level, content: string): void {
    if (!messageApi) return;
    messageApi[level](content);
}

export const notify = {
    success: (msg: string) => toast('success', msg),
    error: (msg: string) => toast('error', msg),
    warning: (msg: string) => toast('warning', msg),
    info: (msg: string) => toast('info', msg),
};
