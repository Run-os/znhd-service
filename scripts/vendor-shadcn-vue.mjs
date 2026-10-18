#!/usr/bin/env node
/**
 * shadcn-vue 组件 vendoring 脚本（替代 CLI 的下载器）。
 *
 * 为什么不用 `npx shadcn-vue add`：
 *   CLI 内部走 ofetch/undici，在本机带代理会抛 "Failed to fetch from registry"、不带代理又连不上
 *   （2026-10-18 实测：同一个 URL 用 Node 原生 fetch 返回 200）。因此这里用原生 fetch 拉
 *   **同一份官方 registry JSON**，只重写落盘路径与 import 别名，组件源码依旧是官方的。
 *
 * 用法：
 *   node scripts/vendor-shadcn-vue.mjs tabs input sheet empty spinner
 *   node scripts/vendor-shadcn-vue.mjs tabs --force       # 覆盖已存在文件
 *   node scripts/vendor-shadcn-vue.mjs --list             # 列出 registry 全部条目
 *
 * 行为：
 *   1. 读 components.json 的 style / aliases.ui / aliases.utils，别名经根 tsconfig paths 解析；
 *   2. GET https://www.shadcn-vue.com/r/styles/{style}/{name}.json；
 *   3. registry 的 `styles/{style}/ui/<组>/<文件>` 落到 `<aliases.ui>/<组>/<文件>`；
 *   4. import 改写：'cn' / '@/lib/utils' → 本地 utils；'@/styles/{style}/ui/x' → '<aliases.ui>/x'；
 *   5. 只报告缺失的 npm 依赖，不自动安装（依赖决策留给人）。
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve(process.cwd());
const CONFIG_PATH = join(ROOT, 'components.json');
const REGISTRY_ORIGIN = 'https://www.shadcn-vue.com';

function readJson(path) {
    return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * tsconfig 是 JSONC（带注释 + 尾逗号），不能用 JSON.parse，也别自己写正则 ——
 * `"@/*"` 里的 `/*` 会被块注释正则误吃。直接用 TypeScript 自己的解析器。
 */
async function readTsconfig(path) {
    const ts = (await import('typescript')).default;
    const file = ts.readConfigFile(path, ts.sys.readFile);
    if (file.error) throw new Error(ts.flattenDiagnosticMessageText(file.error.messageText, '\n'));
    return file.config;
}

/** '@vue/components/ui' → { dir: <root>/src-vue/components/ui, bare }；按 tsconfig paths 解析 */
function resolveAlias(alias, tsconfigPaths) {
    const hit = Object.entries(tsconfigPaths).find(([key]) => alias.startsWith(key.replace('*', '')));
    if (!hit) throw new Error(`别名 ${alias} 无法在 tsconfig paths 中解析`);
    const [key, targets] = hit;
    const rest = alias.slice(key.replace('*', '').length);
    return { dir: resolve(ROOT, targets[0].replace('*', rest)), bare: alias };
}

function rewriteImports(content, { style, uiAlias, utilsAlias }) {
    const edits = [];
    let out = content;
    const swap = (from, to) => {
        if (!out.includes(from)) return;
        out = out.split(from).join(to);
        edits.push(`${from} → ${to}`);
    };
    // 新版 registry 统一 `import { cn } from 'cn'`；本地保留 cn 包，其它写法兜底到本地 utils
    swap("from '@/lib/utils'", `from '${utilsAlias}'`);
    swap('from "@/lib/utils"', `from '${utilsAlias}'`);
    // preset 内部互相引用会指向 styles 目录，改成本地 ui 别名
    swap(`from '@/styles/${style}/ui/`, `from '${uiAlias}/`);
    swap(`from "../../styles/${style}/ui/`, `from '${uiAlias}/`);
    return { content: out, edits };
}

async function fetchItem(style, name) {
    const url = `${REGISTRY_ORIGIN}/r/styles/${style}/${name}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`拉取失败 ${res.status}: ${url}`);
    return res.json();
}

/** 'styles/reka-vega/ui/tabs/Tabs.vue' → <uiDir>/tabs/Tabs.vue */
function targetPath(filePath, style, uiDir) {
    const normalized = filePath.replace(/\\/g, '/');
    const prefix = `styles/${style}/`;
    let rest = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
    rest = rest.replace(/^ui\//, '');
    return join(uiDir, rest);
}

async function main() {
    const args = process.argv.slice(2);
    const force = args.includes('--force');
    const config = readJson(CONFIG_PATH);
    const tsconfig = await readTsconfig(join(ROOT, 'tsconfig.json'));
    const style = config.style;
    const ui = resolveAlias(config.aliases.ui, tsconfig.compilerOptions.paths);
    const utils = resolveAlias(config.aliases.utils, tsconfig.compilerOptions.paths);

    if (args.includes('--list')) {
        const index = await (await fetch(`${REGISTRY_ORIGIN}/r/index.json`)).json();
        const items = Array.isArray(index) ? index : index.items;
        console.log(`registry: ${items.length} 项`);
        console.log(items.map((i) => `${i.name} (${i.type})`).join('\n'));
        return;
    }

    const names = args.filter((a) => !a.startsWith('--'));
    if (!names.length) {
        console.log('用法: node scripts/vendor-shadcn-vue.mjs <组件名...> [--force]');
        process.exit(1);
    }

    const missingDeps = new Set();
    let written = 0;
    let skipped = 0;

    for (const name of names) {
        console.log(`\n=== ${name} (style: ${style}) ===`);
        let item;
        try {
            item = await fetchItem(style, name);
        } catch (e) {
            console.log(`  ✗ ${e.message}`);
            continue;
        }
        for (const dep of item.dependencies ?? []) {
            if (dep === 'cn') continue; // 已装（官方组件源码统一从 cn 包取 cn）
            try {
                require.resolve(dep, { paths: [ROOT] });
            } catch {
                missingDeps.add(dep);
            }
        }
        for (const file of item.files ?? []) {
            const dest = targetPath(file.path, style, ui.dir);
            if (existsSync(dest) && !force) {
                console.log(`  · 跳过（已存在）${dest.replace(ROOT, '.')}`);
                skipped++;
                continue;
            }
            const { content, edits } = rewriteImports(file.content, {
                style,
                uiAlias: ui.bare,
                utilsAlias: utils.bare,
            });
            mkdirSync(dirname(dest), { recursive: true });
            writeFileSync(dest, content, 'utf8');
            console.log(
                `  + ${dest.replace(ROOT, '.')}  (${content.split('\n').length} 行${
                    edits.length ? '，改写: ' + edits.join(' / ') : ''
                })`
            );
            written++;
        }
    }

    console.log(`\n完成：写入 ${written} 个文件，跳过 ${skipped} 个。`);
    if (missingDeps.size) {
        console.log(`\n⚠️ 需要安装的 npm 依赖：npm i -D ${[...missingDeps].join(' ')}`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
