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
        include: [src],
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
        include: /node_modules/,
      },
      {
        test: /\.css$/,
        // 使用哪些 loader 进行处理
        use: [
          // use 数组中 loader 执行顺序：从右到左，从下到上 依次执行
          // 创建 style 标签，将 js 中的样式资源插入进行，添加到 head 中生效
          'style-loader',
          'css-loader',
          // 'to-string-loader',
          // 将 css 文件变成 commonjs 模块加载 js 中，里面内容是样式字符串
          // GM_addStyle 不需要 style-loader
          // esModule: false 时可以 toString() 后使用 GM_addStyle 插入 css
          // {
          //   loader: 'css-loader',
          //   options: {
          //     esModule: false,
          //   },
          // },
        ],
        include: [src],
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
    },
  },
  plugins: [],
};

module.exports = {
  getBanner,
  baseOptions,
};
