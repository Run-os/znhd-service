import { createApp } from 'vue';
import App from './App.vue';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';
import './style.css';
import './app.css';

/**
 * 手机上传页入口（v26.10.18-v7：React 19 + antd v6 → Vue 3）。
 *
 * ⚠️ `provide(SHADOW_ROOT_KEY, document.body)`：这个键在脚本端表示「浮层往哪挂」。
 *    脚本端必须给 shadowRoot（否则浮层脱离影子树、样式全丢）；手机页是**独立页面、
 *    没有影子树**，浮层直接挂 body 就是正确行为 —— 复用的 `ImagePreview.vue` 靠它 Teleport。
 */
const app = createApp(App);
app.provide(SHADOW_ROOT_KEY, document.body as unknown as ShadowRoot);
app.mount('#root');

// 挂载后移除内联首屏占位（占位在 #root 外，需手动摘掉）
window.setTimeout(() => {
    const boot = document.getElementById('boot');
    if (boot) boot.remove();
}, 0);
