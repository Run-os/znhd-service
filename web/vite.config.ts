import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync, realpathSync } from 'node:fs';
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

/**
 * 真实路径（realpath 统一目录大小写；⚠️ realpathSync 会吃掉结尾分隔符，拼接时自己补）。
 * 再把盘符强制大写：npm 从 Git Bash 传下来的 cwd 可能是 `c:/...`，而 Vite 解析器
 * realpath 出来的 id 盘符恒为大写 `C:/...`，混用会让 HTML 内联样式的 proxy 模块
 * 对不上号（"No matching HTML proxy module found"，v26.10.18-v8 实测）。
 */
function trueCasePath(p: string): string {
    return realpathSync(p).replace(/^([a-zA-Z]):/, (m) => m.toUpperCase());
}
const WEB_ROOT = trueCasePath(fileURLToPath(new URL('.', import.meta.url)));
const UI_ROOT = trueCasePath(fileURLToPath(new URL('../src-vue/', import.meta.url)));
// 业务层（脚本端 src/lib）也被共享组件引用（ChatTurn/ChatWindow 等 import '@/lib/...'）
const SRC_ROOT = trueCasePath(fileURLToPath(new URL('../src/', import.meta.url)));

/** 前缀比较用：posix 分隔符 + 全小写 */
const UI_PREFIX = (UI_ROOT + '\\').replace(/\\/g, '/').toLowerCase();
const WEB_SRC_PREFIX = (WEB_ROOT + '\\src\\').replace(/\\/g, '/').toLowerCase();
const SRC_PREFIX = (SRC_ROOT + '\\').replace(/\\/g, '/').toLowerCase();

/**
 * `@vue/*` → 仓库根 `src-vue/*`、`@/*` → 仓库根 `src/*` 的别名。
 *
 * ⚠️ 不能直接写进 `resolve.alias`：Vue 自身（`vue/dist/vue.runtime.esm-bundler.js`）内部
 *    import 的是 `@vue/runtime-dom`、`@vue/reactivity` 这些**官方包**，字符串前缀别名会把它们
 *    一起改写成 `../src-vue/runtime-dom` ⇒ 构建报 ENOENT。
 *    （脚本端没踩到是因为那边 vue 走 CDN 外置，根本不会去解析 vue 的内部 import。）
 *
 * 所以做成一个只对**本仓库源码**生效的 resolveId 钩子：importer 必须落在 `src/`、`src-vue/`
 * 或 `web/src/` 里才改写；来自 node_modules（含 vue 自己）的一律放行，交给默认解析。
 */
function znhdUiAlias(): Plugin {
    return {
        name: 'znhd-ui-alias',
        enforce: 'pre',
        resolveId(source, importer) {
            if (!importer) return null;
            // ⚠️ 两侧都必须 toLowerCase：npm 传下来的 cwd 盘符大小写不稳定（C: / c: 混着来），
            //    大小写敏感的 startsWith 会随机失配 —— v26.10.18-v8 实测「同一个命令时而构建失败」。
            const from = importer.replace(/\\/g, '/').toLowerCase();
            if (!from.startsWith(UI_PREFIX) && !from.startsWith(WEB_SRC_PREFIX) && !from.startsWith(SRC_PREFIX)) {
                return null;
            }
            if (source.startsWith('@vue/')) {
                return this.resolve(UI_ROOT + '\\' + source.slice('@vue/'.length), importer, { skipSelf: true });
            }
            // v26.10.18-v9：共享组件里的 '@/lib/...' 也要能解析（v8 漏了这条，build:web 一直起不来）
            if (source.startsWith('@/')) {
                return this.resolve(SRC_ROOT + '\\' + source.slice(2), importer, { skipSelf: true });
            }
            return null;
        },
    };
}

export default defineConfig({
    // ⚠️ root 必须钉死且用 realpath：Vite 默认取 process.cwd()，而 npm 传下来的 cwd 盘符
    //    大小写不稳定（Git Bash 里可能是 c:/...）。rollup 的模块 id 是小写 root 拼出来的，
    //    但 HTML 内联 <style> 的 proxy 模块经 Vite 解析器 realpath 后变成真实大小写（C:/...），
    //    两边对不上号就报 "No matching HTML proxy module found"。realpath 后全链路 id 恒定。
    root: WEB_ROOT,
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
