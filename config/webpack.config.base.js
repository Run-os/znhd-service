const { resolve } = require('path');
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const commonMeta = require('./common.meta.json');

const year = new Date().getFullYear();

// 元信息说明（勿随意改动，均为有意为之）：随构建写入产物头注释，避免构建后丢失
const bannerNotes = [
  '元信息说明（勿随意改动，均为有意为之）：',
  ' - @match https://example.com/* ：本脚本面板/弹窗的调试宿主，本地验证用，发布版保留以便排查问题。',
  ' - @connect * ：中继服务器地址由用户在设置面板自定义（域名不固定），必须通配，无法收窄为固定域名。',
];

/**
 * 生成 ==UserScript== 头注释。
 * 注意：这里用 Object.assign({}, commonMeta, meta)（不修改 commonMeta 本身），
 * 数组型字段（match/grant/require/resource/connect）在 dev 侧是「整体覆盖」而非追加，
 * 因此 dev.meta.json 必须写全量 require 列表。
 */
const getBanner = (meta) => `// ==UserScript==\n${Object.entries(Object.assign({}, commonMeta, meta))
  .map(([key, value]) => {
    if (Array.isArray(value)) {
      return value.map((item) => `// @${key.padEnd(20, ' ')}${item}`).join('\n');
    }
    return `// @${key.padEnd(20, ' ')}${value.replace(/\[year\]/g, year)}`;
  })
  .join('\n')}
// ==/UserScript==
/* eslint-disable */ /* spell-checker: disable */
// @[ 本文件是构建产物，源码与构建方式见 GitHub 仓库 Run-os/znhd-service，请勿直接编辑 ]
${bannerNotes.map((line) => `// ${line}`).join('\n')}`;

const relativePath = (p) => path.join(process.cwd(), p);
const src = relativePath('src');
// 共享层（v26.10.08-v13 起）：脚本端与手机上传页共用的纯逻辑/纯 DOM 代码。
// ⚠️ 必须加进下面 ts-loader 的 include，否则 webpack 会因为「src 之外的文件没有匹配的 loader」
//    把 .ts 当成 JS 解析而报错（这是接共享层时最容易踩的一步）。
const shared = relativePath('shared');

const baseOptions = {
  entry: './src/index.ts',
  output: {
    // 默认输出到 dist/（开发产物）；生产产物在 webpack.prod.js 里改到仓库根
    path: resolve(__dirname, '../dist'),
  },
  externals: {},
  module: {
    rules: [
      {
        test: /\.(js|jsx|mjs)$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              // 预设：指示babel做怎么样的兼容性处理。
              presets: [
                [
                  '@babel/preset-env',
                  {
                    corejs: {
                      version: 3,
                    }, // 按需加载
                    useBuiltIns: 'usage',
                  },
                ],
              ],
            },
          },
        ],
      },
      {
        test: /\.(tsx|ts)?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
        include: [src, shared],
      },
      {
        test: /\.css$/,
        // 第三方库自带的 CSS：只做解析，不走 Tailwind（避免我们的 postcss 插件去动它们）
        use: ['style-loader', 'css-loader'],
        include: /node_modules/,
      },
      {
        test: /\.css$/,
        // 使用哪些 loader 进行处理
        use: [
          // use 数组中 loader 执行顺序：从右到左，从下到上 依次执行
          // 把 css 变成 JS 模块，导出**样式字符串**（uiReset.ts 用 GM_addStyle 注入，
          // 因为宿主页面可能有 CSP style-src，页面内 <style> 落地不可靠）
          {
            loader: 'css-loader',
            options: {
              // ⚠️ esModule 必须保持默认 true：uiReset.ts 走 `import css from './x.css'`。
              //    （早年的 esModule:false + GM_addStyle 组合已随 style-loader 一起删除）
              esModule: true,
            },
          },
          // Tailwind v4 由 @tailwindcss/postcss 编译（配置见仓库根 postcss.config.js）。
          // 放在 css-loader **右侧**（loader 从右到左执行 ⇒ 先 postcss 再 css），
          // 这样拿到的是 Tailwind 编译并 tree-shake 后的 CSS，而不是未处理的指令。
          'postcss-loader',
        ],
        include: [src, shared],
      },
      {
        test: /\.less$/,
        // 使用哪些 loader 进行处理
        use: [
          // use 数组中 loader 执行顺序：从右到左，从下到上 依次执行
          'style-loader',
          // 将 css 文件变成 commonjs 模块加载 js 中，里面内容是样式字符串
          'css-loader',
          {
            loader: 'less-loader',
            options: {
              lessOptions: {
                javascriptEnabled: true,
              },
            },
          },
        ],
      },
    ],
  },
  optimization: {
    // v26.10.09-v2：**关闭 Terser 压缩**（v26.10.06-v19 曾设为 true，v26.10.09-v2 按用户要求改回 false）。
    // 实测（26.10.09-v1 产物）：minimize=true 425.4 KB，false 1218.0 KB（1.19 MiB），压缩比 2.86×。
    // ⚠️ 下面是完整的 Terser 配置（含保住 `==UserScript==` 头与 `@`/eslint/spell-checker 注释的
    //    comments 白名单），**故意保留不删**：白名单是脚本元信息的保险，日后想开启只需把
    //    minimize 改回 true 即可，不必重写。
    //    （脚本元信息不是"注释"，是运行时的解析依据，压掉脚本直接废掉。）
    // ⚠️ dev 侧在 webpack.dev.js 里也显式设 false：调试产物要可读、构建要快。
    minimize: false,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          output: {
            comments: /==\/?UserScript==|^[ ]?@|eslint-disable|spell-checker/i,
          },
        },
        extractComments: false,
      }),
    ],
  },
  watchOptions: {
    ignored: /node_modules/,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx', '.json'],
    alias: {
      '@': src,
      // v26.10.09-v3：shadcn 组件落 shared/ui/（两端共用），components.json 里 alias 前缀写作 `@ui`。
      // webpack 不读 tsconfig.paths，必须在这里显式补一条，否则 `import { cn } from '@ui/utils'` 解析失败。
      '#ui': path.join(shared, 'ui'),
    },
  },
  plugins: [],
};

module.exports = {
  getBanner,
  baseOptions,
};
