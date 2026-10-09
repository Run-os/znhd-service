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
            // colorPrimary：v26.10.06-v22 起由原税务绿 #007e44 改为 **antd 官方色彩规范的蓝色系主色 blue-6 #1677FF**
            //（https://ant.design/docs/spec/colors-cn）。只改这一个 token，antd 会自动派生 hover/active/focus
            // 与浅色底：语音 Switch 选中态背景、以及链接/焦点环都会同步变蓝。
            // ⚠️ v26.10.07-v3 起面板四个入口按钮统一为 antd 默认样式（原「设置」实心主色按钮已按用户要求去掉），
            //    故此处不再有「实心按钮」这一主色消费方；主色 token 的回归断言改挂到 Switch 上（见 scripts/smoke）。
            // ⚠️ 语义色不跟着变：在线/已连接/日志「成功」仍用 success 绿（#52c41a / #389e0d），
            //    错误红、警告黄同理——规范里主色与状态色是两套东西，混用会让人误判状态。
            theme={{ token: { colorPrimary: '#1677ff', borderRadius: 8, zIndexPopupBase: 1000000 } }}
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
