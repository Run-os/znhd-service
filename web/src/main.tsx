import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Tailwind 编译后的样式（唯一入口见 shared/ui/tailwind.css）。
// 手机页是**自己的页面**（中继同源托管），不受宿主 CSP 限制，故走 Vite 的常规 CSS 链路，
// 与脚本端「导出字符串 + GM_addStyle」那条路殊途同归。
import '../../shared/ui/tailwind.css';
import './app.css';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>
);

// 挂载后移除内联首屏占位（占位在 #root 外，需手动摘掉）
window.setTimeout(() => {
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
}, 0);