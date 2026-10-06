import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
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
    plugins: [react()],
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
