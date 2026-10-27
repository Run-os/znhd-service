#!/bin/sh
# 通知 ScriptCat 同步脚本（webhook · push）—— .cnb.yml「部署」流水线的第 3 阶段。
# ScriptCat 的 webhook 完全按 GitHub webhook 约定校验：
#   POST application/json + 头 X-Hub-Signature: sha1=HMAC(secret, body)
#                     + 头 X-Hub-Signature-256: sha256=HMAC(secret, body)
#   事件类型头 X-GitHub-Event: push（即 ScriptCat 设置页里的「监听事项: push」）。
# 密钥 = SCRIPTCAT_WEBHOOK_SECRET（密钥仓库 env.prod.yml，imports 已注入本流水线）。
# 放在部署成功之后：/health 不过就轮不到它；通知失败整条流水线红（可重跑，部署幂等）。
# 请求体的构造与签名见同目录 sc-webhook.js。
set -eu

if [ -z "${SCRIPTCAT_WEBHOOK_SECRET:-}" ]; then
  echo "❌ 密钥仓库 env.prod.yml 缺 SCRIPTCAT_WEBHOOK_SECRET"
  echo "   （ScriptCat 用户设置 → Webhook 页的 Secret，Webhook URL = https://scriptcat.org/api/v2/webhook/<用户ID>）"
  env | sed -n 's/^\([A-Za-z0-9_]*\)=.*/\1/p' \
    | grep -Ei 'webhook|secret|scriptcat' | sort | sed 's/^/     - /' || true
  exit 1
fi

# URL 默认写死为当前账号的 webhook 地址；换号/换地址时在密钥文件里加 SCRIPTCAT_WEBHOOK_URL 覆盖
SC_URL="${SCRIPTCAT_WEBHOOK_URL:-https://scriptcat.org/api/v2/webhook/8492}"
SC_SHA="$(git rev-parse HEAD)"
SC_MSG="$(git log -1 --pretty=%s)"
SC_REPO_FULL="bbbbaa/znhd-service"
SC_REPO_URL="https://cnb.cool/bbbbaa/znhd-service"
SC_REF="refs/heads/main"

echo "📡 通知 ScriptCat（push 事件 → $SC_URL）..."
SC_URL="$SC_URL" \
SC_SECRET="$SCRIPTCAT_WEBHOOK_SECRET" \
SC_SHA="$SC_SHA" \
SC_MSG="$SC_MSG" \
SC_REPO_FULL="$SC_REPO_FULL" \
SC_REPO_URL="$SC_REPO_URL" \
SC_REF="$SC_REF" \
node ci/sc-webhook.js
