import { useEffect } from 'react';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import MainPanel from './MainPanel';
import { setMessageApi } from './notify';
import { getOverlayContainer } from './panelHost';

/** 把 antd 的 message 实例交给模块级代码（storage.ts 等非组件模块要用） */
function MessageBridge() {
    const { message } = AntApp.useApp();
    useEffect(() => {
        setMessageApi(message);
        return () => setMessageApi(null);
    }, [message]);
    return null;
}

/**
 * 面板根：antd 主题/语言 + 消息桥 + 主面板。
 * getPopupContainer 统一指向 documentElement：税务页 body 常带 transform，
 * 浮层若默认挂在 body 会被困在它的层叠上下文里（详见 panelHost.tsx 的说明）。
 */
export default function PanelApp({ host }: { host: HTMLElement }) {
    return (
        <ConfigProvider
            locale={zhCN}
            // zIndexPopupBase：把 antd 全部浮层（Modal/Drawer/message/notification/Picker 下拉…）的
            // 层级基数抬到面板宿主（999999）之上，实现「弹窗/侧边栏盖住面板」的方案 B；
            // 面板本身仍高于宿主页面自身内容，不会被页面弹窗压住。
            theme={{ token: { colorPrimary: '#007e44', borderRadius: 8, zIndexPopupBase: 1000000 } }}
            getPopupContainer={getOverlayContainer}
            // antd 默认给「两个汉字」的按钮自动插空格（设置 → 设 置），会改变按钮文案；
            // 面板按钮沿用旧文案（设置/常用语/日志…），故关掉。v6 用 button.autoInsertSpace
            //（config-provider/index.d.ts 明确标注 autoInsertSpaceInButton 已弃用）。
            button={{ autoInsertSpace: false }}>
            <AntApp>
                <MessageBridge />
                <MainPanel host={host} />
            </AntApp>
        </ConfigProvider>
    );
}
