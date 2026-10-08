import { ToastHost } from '../../../shared/ui/feedback';
import MainPanel from './MainPanel';

/**
 * 面板根（v26.10.08-v14 重写：antd ConfigProvider + App → 自研基座）。
 *
 * 替换掉的三个 antd 职责：
 *  1. **主题/语言**：antd 需要 ConfigProvider + zhCN locale；Tailwind 是纯 CSS，
 *     主色写在 `shared/ui/tailwind.css` 的 `@theme` 里，两端自动一致，不需要 Provider。
 *  2. **message 实例桥**：antd 的静态 message 不继承主题、必须靠 `App.useApp()` 取实例；
 *     自研 Toast 自持队列，`ToastHost` 只需渲染一次即可（见 notify.ts 的说明）。
 *  3. **浮层挂载点**：`getPopupContainer` 指向 documentElement —— 现在由各基座组件
 *     自己接 `<Portal container={getOverlayHost()}>`，不再需要全局配置项。
 */
export default function PanelApp({ host }: { host: HTMLElement }) {
    return (
        <>
            <ToastHost />
            <MainPanel host={host} />
        </>
    );
}
