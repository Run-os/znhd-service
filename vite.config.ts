import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import monkey from 'vite-plugin-monkey';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

/**
 * 脚本端构建（v26.10.18-v7 起为**唯一**构建：React 19 + antd v6 + webpack 已删除）。
 *
 * 与旧 webpack 版的关键差异：
 *  · Vue3 走 CDN + UMD 全局 `Vue`，**不打包进产物**（externalGlobals 自动补 `@require`）；
 *  · 依赖清单里明确禁止 external 的包（reka-ui / tailwind-merge / cva / floating-ui）全部打进 bundle；
 *  · Tailwind CSS 以 `?inline` 字符串注入 shadowRoot（见 src-vue/main.ts），不走插件默认的
 *    `GM_addStyle`-to-head 通道 —— 否则影子树里一条样式都不生效。
 */
const meta = JSON.parse(readFileSync(new URL('./config/common.meta.json', import.meta.url), 'utf8')) as {
    name: string;
    namespace: string;
    version: string;
    description: string;
    author: string;
    license: string;
    icon: string;
    match: string[];
    grant: string[];
    connect: string[];
    homepageURL: string;
    updateURL: string;
    downloadURL: string;
    require: string[];
};

export default defineConfig({
    resolve: {
        alias: {
            // 业务层（src/lib）沿用 @/ 前缀；Vue UI 在 src-vue，用 @vue/ 前缀
            '@': fileURLToPath(new URL('./src', import.meta.url)),
            '@vue': fileURLToPath(new URL('./src-vue', import.meta.url)),
        },
    },
    plugins: [
        vue(),
        tailwindcss(),
        monkey({
            entry: 'src-vue/app.ts',
            userscript: {
                name: meta.name,
                namespace: meta.namespace,
                version: meta.version,
                description: meta.description,
                author: meta.author,
                license: meta.license,
                icon: meta.icon,
                match: meta.match,
                grant: meta.grant,
                connect: meta.connect,
                homepageURL: meta.homepageURL,
                updateURL: meta.updateURL,
                downloadURL: meta.downloadURL,
                require: meta.require,
                'run-at': 'document-end',
            },
            build: {
                // 阶段 5 切换完成：产物名回到正式名（油猴 updateURL/downloadURL 指向的就是它）
                fileName: 'znhd.user.js',
                // Vue 只在运行时用 CDN 那份：产物里保留 import 形式，由下面 externalGlobals
                // 映射到全局 `Vue` 并自动把 CDN 地址写进 @require。
                externalGlobals: {
                    vue: ['Vue', 'https://cdn.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js'],
                },
                // 插件默认的 cssSideEffects 会 GM_addStyle 到 document.head —— 影子树拿不到。
                // 这里置空，CSS 由 main.ts 以字符串注入 shadowRoot。
                cssSideEffects: () => {},
            },
        }),
    ],
    build: {
        target: 'es2019',
        // 产物要提交进仓库、靠 git diff 看「这次改了什么」，因此**默认不压缩**：
        // esbuild minify 会把整包压成几十行，diff 只能看到「一行全变」。
        // 需要发布压缩版时临时跑 `ZNHD_MINIFY=1 npm run build:vue`。
        minify: process.env.ZNHD_MINIFY === '1' ? 'esbuild' : false,
        // CSS 单独压缩：Tailwind 产生的几千条工具类排成多行没有阅读价值，只按字符串注入。
        cssMinify: true,
        sourcemap: false,
        // dist/ 现在只有这一个产物（构建会把整个目录清掉再写）。
        emptyOutDir: true,
    },
});
