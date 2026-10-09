import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './app.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ConfigProvider
            locale={zhCN}
            theme={{
                token: {
                    // 与油猴脚本面板同色（#007e44），保持两端观感一致
                    colorPrimary: '#007e44',
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

