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
  // 本地调试产物保持未压缩（v26.10.06-v19 起）：dev 产物是给人看/断点调试用的，
  // 压缩后既不可读、构建也明显变慢。v26.10.10-v1 起 base 也已改成 minimize=false
  // （生产产物同样不压缩），这里仍显式关一遍，防止将来 base 重新开压缩时把 dev 带上。
  baseOptions.optimization.minimize = false;

  return baseOptions;
};
