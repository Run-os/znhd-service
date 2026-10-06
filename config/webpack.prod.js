const webpack = require('webpack');
const { baseOptions, getBanner } = require('./webpack.config.base');

module.exports = (env) => {
  // 生产产物输出到模板默认位置 dist/（与 douyu-helper 一致）：
  //   dist/znhd.user.js 是提交进仓库的发布产物，@updateURL/@downloadURL 指向
  //   https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/dist/znhd.user.js
  // 输出目录由 webpack.config.base.js 的 output.path 决定（resolve(__dirname, '../dist')）。
  baseOptions.output.filename = env.filename;
  baseOptions.plugins.push(
    new webpack.BannerPlugin({
      banner: getBanner({}),
      raw: true,
      entryOnly: true,
    }),
    new webpack.DefinePlugin({
      PRODUCTION: true,
    })
  );
  baseOptions.mode = 'production';

  return baseOptions;
};
