/**
 * 全局消息提示桥（v26.10.08-v14 重写：antd message → 自研 Toast）。
 *
 * 历史：v26.10.06-v9 起 UI 从 CAT_UI 换成 React + Ant Design，模块级代码（storage.ts 等）
 * 要弹提示只能靠 `App.useApp()` 注入的 message 实例，是个绕路。
 * 换成自研 Toast 后**注入环节整个不需要了** —— `toast()` 自持队列，
 * `storage.ts` 等非组件模块直接 import 即可用，与 UI 是否已挂载无关。
 *
 * ⚠️ 保留本文件是为了**不改动所有调用点**：它们写的是 `notify.success(...)`。
 *    真正的实现在 `shared/ui/feedback.tsx`，两端共用（手机页的 ToastHost 也用它）。
 */

import { notify } from '../../../shared/ui/feedback';

export { notify };
