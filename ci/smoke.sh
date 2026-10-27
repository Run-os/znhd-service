#!/bin/sh
# 端到端冒烟（无头 Chromium）—— .cnb.yml「构建门禁」流水线的第 4 阶段
# node 官方镜像不带浏览器：装 Debian 自带 chromium，并让 puppeteer 直接用它
# （scripts/smoke/*.js 会按 PUPPETEER_EXECUTABLE_PATH → google-chrome → chromium 顺序探测）
# ⚠️ fonts-noto-cjk 不是可选项：GitHub 的 ubuntu 镜像自带 CJK 字体，裸 node:22 没有 ⇒
#    中文全落 .notdef，文字度量/换行/元素高度都会和本地不一致（断言按本地调过）。
if ! command -v google-chrome >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq chromium fonts-noto-cjk fonts-liberation
fi
export PUPPETEER_EXECUTABLE_PATH="$(
  command -v google-chrome || command -v chromium || command -v chromium-browser
)"
echo "浏览器: $PUPPETEER_EXECUTABLE_PATH"
"$PUPPETEER_EXECUTABLE_PATH" --version || true
npm run verify
