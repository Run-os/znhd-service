import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Tailwind v4 官方 Vite 插件：它同时接管 CSS 处理与 @source 扫描，
// 故 **不需要**再装 postcss.config.js 那条链（脚本端走 webpack + @tailwindcss/postcss，
// 两端各用各的官方接法，但生成的都是同一份 shared/ui/tailwind.css）。
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 手机上传页构建配置。
 * 产物直接写进 relay-server/public/（提交进仓库）：中继运行时不装依赖、不构建，
 * 只负责把 public/index.html 与 public/assets/* 原样同源托管出去。
 */

// 版本号唯一来源：relay-server/package.json（与 /health 返回的一致），构建期注入到页面
const relayPkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../relay-server/package.json', import.meta.url)), 'utf8')
) as { version: string };

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        // ⚠️ **必须** dedupe react / react-dom（v26.10.08-v14 实测踩到，症状极具迷惑性）：
        //    共享层 `shared/` 在**仓库根**，而页面源码在 `web/src`。Vite 按「引用文件所在目录向上找
        //    node_modules」解析 `import ... from 'react'` ⇒ shared/ 里的组件拿到**根 node_modules/react**，
        //    web/src 里的拿到 **web/node_modules/react**。两份副本即便版本号完全相同也是两个模块实例，
        //    于是「react-dom 往 A 份写 dispatcher、组件从 B 份读 hook」⇒ 首屏直接崩
        //    `Cannot read properties of null (reading 'useRef')`（H 是 dispatcher，永远是 null）。
        //    该报错看起来像 React 内部坏了，其实只是实例分裂；dedupe 是官方解法。
        dedupe: ['react', 'react-dom'],
    },
    // 共享层在 web/ 之外（仓库根 shared/）。⚠️ 只影响 `npm run dev:web`：
    // 本目录有自己的 package-lock.json ⇒ Vite 判定工作区根就是 web/，默认会拒绝 serve 项目外文件
    // （报 "The request url ... is outside of Vite serving allow list"）。`vite build` 不受影响。
    server: {
        fs: {
            allow: [fileURLToPath(new URL('.', import.meta.url)), fileURLToPath(new URL('../shared', import.meta.url))],
        },
    },
    define: {
        __APP_VERSION__: JSON.stringify(relayPkg.version),
    },
    build: {
        outDir: '../relay-server/public',
        emptyOutDir: true,
        assetsDir: 'assets',
        target: 'es2020',
        // 页面是手机端首屏，不产出 sourcemap
        sourcemap: false,
        chunkSizeWarningLimit: 2000,
    },
});
