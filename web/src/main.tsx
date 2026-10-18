import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './app.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ConfigProvider
            locale={zhCN}
            theme={{
                // v26.10.12-v5：手机页对齐脚本端第三栏（微信暗色 + 微信绿主色 #07C160）
                algorithm: theme.darkAlgorithm,
                token: {
                    colorPrimary: '#07C160',
                    borderRadius: 10,
                },
            }}
        >
            <AntApp>
                <App />
            </AntApp>
        </ConfigProvider>
    </StrictMode>
);

// 挂载后移除内联首屏占位（占位在 #root 外，需手动摘掉）
window.setTimeout(() => {
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
}, 0);

