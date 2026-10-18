/**
 * 全局消息提示桥（v26.10.18-v7 重写）。
 *
 * 历史：v26.10.06-v9 起这里保存一份由 React 根组件注入的 antd `message` 实例，
 * 供 `storage.ts` 这类**非组件**模块弹提示（antd 静态方法不继承 ConfigProvider 主题，
 * v6 官方推荐改用 `App.useApp()` 拿 context 内的实例）。
 *
 * React + antd 已随 Vue 迁移删除 ⇒ 改为直接委托 Vue 侧的 Sonner 封装
 * （`src-vue/lib/toast.ts`）。调用时机早于 App 挂载也没关系：vue-sonner 的
 * toast 状态是模块级的，`<Toaster>` 挂上后会补渲染。动态 import 是为了
 * 不让业务层在模块加载期就拉起 UI 依赖（保持 src/lib 的装载顺序干净）。
 */

type Level = 'success' | 'error' | 'warning' | 'info';

/** 统一提示入口；与 Vue 侧 `lib/toast.ts` 同一套底层（vue-sonner） */
function toast(level: Level, content: string): void {
    void import('@vue/lib/toast').then(({ toast: t }) => t[level](content));
}

export const notify = {
    success: (msg: string) => toast('success', msg),
    error: (msg: string) => toast('error', msg),
    warning: (msg: string) => toast('warning', msg),
    info: (msg: string) => toast('info', msg),
};
