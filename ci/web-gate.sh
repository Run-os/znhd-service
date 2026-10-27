#!/bin/sh
# 手机上传页门禁 —— .cnb.yml「构建门禁」流水线的第 6 阶段
# web/ 是 Vue 3 独立子项目，复用根 node_modules，故必须在根 npm ci 之后。
npm --prefix web ci || npm --prefix web ci
npm run typecheck:web
npm run build:web
# 产物提交在 relay-server/public（部署时直接 tar 进容器，运行时不构建）：
# 源码改了却忘了 build:web 提交，这里会红，避免线上跑旧页面
if [ -n "$(git status --porcelain relay-server/public)" ]; then
  echo "❌ relay-server/public 与 web/ 源码不一致：请本地执行 npm run build:web 并提交产物"
  git status --porcelain relay-server/public
  exit 1
fi
echo "✅ 手机上传页产物与源码一致"
