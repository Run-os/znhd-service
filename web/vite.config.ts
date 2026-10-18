import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 手机上传页构建配置（v26.10.18-v7 起为 Vue 3 + Tailwind CSS v4，原 React 19 + antd v6）。
 * 产物直接写进 relay-server/public/（提交进仓库）：中继运行时不装依赖、不构建，
 * 只负责把 public/index.html 与 public/assets/* 原样同源托管出去。
 */

// 版本号唯一来源：relay-server/package.json（与 /health 返回的一致），构建期注入到页面
const relayPkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../relay-server/package.json', import.meta.url)), 'utf8')
) as { version: string };

/** 仓库根 `src-vue/`（与脚本端共用的 UI 底层件），统一用 posix 分隔符便于前缀比较 */
const UI_ROOT = fileURLToPath(new URL('../src-vue/', import.meta.url)).replace(/\\/g, '/');
const WEB_SRC = fileURLToPath(new URL('./src/', import.meta.url)).replace(/\\/g, '/');

/**
 * `@vue/*` → 仓库根 `src-vue/*` 的别名。
 *
 * ⚠️ 不能直接写进 `resolve.alias`：Vue 自身（`vue/dist/vue.runtime.esm-bundler.js`）内部
 *    import 的是 `@vue/runtime-dom`、`@vue/reactivity` 这些**官方包**，字符串前缀别名会把它们
 *    一起改写成 `../src-vue/runtime-dom` ⇒ 构建报 ENOENT。
 *    （脚本端没踩到是因为那边 vue 走 CDN 外置，根本不会去解析 vue 的内部 import。）
 *
 * 所以做成一个只对**本仓库源码**生效的 resolveId 钩子：importer 必须落在 `src-vue/` 或
 * `web/src/` 里才改写；来自 node_modules（含 vue 自己）的一律放行，交给默认解析。
 */
function znhdUiAlias(): Plugin {
    return {
        name: 'znhd-ui-alias',
        enforce: 'pre',
        resolveId(source, importer) {
            if (!source.startsWith('@vue/') || !importer) return null;
            const from = importer.replace(/\\/g, '/');
            if (!from.startsWith(UI_ROOT) && !from.startsWith(WEB_SRC)) return null;
            return this.resolve(UI_ROOT + source.slice('@vue/'.length), importer, { skipSelf: true });
        },
    };
}

export default defineConfig({
    plugins: [znhdUiAlias(), vue(), tailwindcss()],
    resolve: {
        /**
         * ⚠️ `dedupe` 不是可选项：被复用的 `src-vue/` 组件内部 import `vue` / `reka-ui`，
         *    Vite 默认按「就近的 node_modules」解析；一旦 web/node_modules 里也装了一份，
         *    就会加载出**两个 Vue 实例** —— provide/inject 全断链，表现是浮层不渲染。
         */
        dedupe: ['vue', 'reka-ui'],
    },
    // 共享层在 web/ 之外（仓库根 shared/，以及被复用的 src-vue/）。⚠️ 只影响 `npm run dev:web`：
    // 本目录有自己的 package.json ⇒ Vite 判定工作区根就是 web/，默认会拒绝 serve 项目外文件
    // （报 "The request url ... is outside of Vite serving allow list"）。`vite build` 不受影响。
    // relay-server/ 同样在 web/ 之外：表情包清单单一来源 emoji-sources.json 在那里（v26.10.14-v3）。
    server: {
        fs: {
            allow: [
                fileURLToPath(new URL('.', import.meta.url)),
                fileURLToPath(new URL('../shared', import.meta.url)),
                fileURLToPath(new URL('../src-vue', import.meta.url)),
                fileURLToPath(new URL('../relay-server', import.meta.url)),
            ],
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
