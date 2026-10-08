const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { baseOptions, getBanner } = require('./webpack.config.base');
const devBanner = require('./dev.meta.json');

module.exports = (env) => {
  baseOptions.output.filename = env.filename;
  baseOptions.plugins.push(
    new webpack.BannerPlugin({
      banner: getBanner(devBanner),
      raw: true,
      entryOnly: true,
    }),
    new webpack.DefinePlugin({
      PRODUCTION: false,
      FILENAME: JSON.stringify(env.filename),
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html',
      inject: 'body',
    })
  );
  baseOptions.devServer = {
    static: [
      {
        directory: path.join(__dirname, '../public'),
      },
      {
        directory: path.join(__dirname, '../dist'),
      },
    ],
    compress: true,
    port: 8080,
    hot: false,
    open: true,
    liveReload: true,
    watchFiles: ['src/**/*', 'public/**/*'],
  };
  baseOptions.mode = 'development';
  // 本地调试产物保持未压缩（v26.10.06-v19 起显式设 false，v26.10.09-v2 起 base 里也已关闭压缩）：
  // 调试产物是给人看/断点调试用的，压缩后既不可读、构建也明显变慢，故这里保持关闭。
  // 这里保留显式赋值是为了不依赖 base 的取值 —— 单独调整 base 时 dev 侧行为不会被带偏。
  baseOptions.optimization.minimize = false;

  return baseOptions;
};
