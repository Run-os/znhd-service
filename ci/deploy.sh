#!/bin/sh
# SSH 同步并重启容器 —— .cnb.yml「部署到 1panel 服务器」流水线的第 2 阶段
# 凭据全部来自密钥仓库 env.prod.yml 的 imports 注入（见 .cnb.yml 头部注释）。
#
# ⚠️ CNB 用 sh(dash) 执行 script：`set -o pipefail` 会直接报
#    "sh: 1: set: Illegal option -o pipefail" 并整条流水线秒红，只能用 POSIX 写法
set -eu

# ---- 解析部署凭据（全部来自密钥仓库 env.prod.yml 的 imports 注入）----
# 键名不做硬编码假设：按候选别名取第一个非空值。若密钥文件里用了别的名字，
# 下面的诊断会列出「当前环境里实际存在的相关变量名」（**只列名，不打印值**），
# 一眼就能对上是哪个键名写岔了。
SERVER_HOST="${SERVER_HOST:-${DEPLOY_HOST:-${SSH_HOST:-${REMOTE_HOST:-${HOST:-}}}}}"
SERVER_PORT="${SERVER_PORT:-${DEPLOY_PORT:-${SSH_PORT:-${PORT:-}}}}"
SERVER_USER="${SERVER_USER:-${DEPLOY_USER:-${SSH_USER:-${REMOTE_USER:-${LOGIN_USER:-}}}}}"
SSH_KEY_B64="${SSH_KEY_B64:-${SERVER_KEY_B64:-${DEPLOY_KEY_B64:-${SSH_PRIVATE_KEY_B64:-${SSH_KEY:-}}}}}"

env_names() {
  echo "   当前环境里与部署相关的变量名（仅列名，不含值）："
  env | sed -n 's/^\([A-Za-z0-9_]*\)=.*/\1/p' \
    | grep -Ei 'host|port|user|key|ssh|server|deploy|secret' \
    | sort | sed 's/^/     - /' || true
}

if [ -z "$SERVER_HOST" ]; then
  echo "❌ 未能解析服务器地址：密钥仓库 env.prod.yml 里缺 SERVER_HOST（别名 DEPLOY_HOST/SSH_HOST/HOST 也可）"
  env_names; exit 1
fi
if [ -z "$SERVER_PORT" ]; then
  echo "❌ 未能解析 SSH 端口：密钥仓库 env.prod.yml 里缺 SERVER_PORT（别名 DEPLOY_PORT/SSH_PORT/PORT 也可）"
  env_names; exit 1
fi
if [ -z "$SERVER_USER" ]; then
  # 容器里 USER 不一定有值，硬失败太脆；本项目的部署账号就是 root，缺省即用它
  SERVER_USER=root
  echo "ℹ️ 密钥文件里未找到登录用户名，使用默认 root（若服务器账号不同，请加 SERVER_USER）"
fi
if [ -z "$SSH_KEY_B64" ]; then
  echo "❌ 未能解析部署私钥：密钥仓库 env.prod.yml 里缺 SSH_KEY_B64（私钥单行 base64）"
  env_names; exit 1
fi
# 回显解析结果时只给长度，不打印凭据本体
echo "🔐 凭据已解析：host=$SERVER_HOST port=$SERVER_PORT user=$SERVER_USER key_len=${#SSH_KEY_B64}"

mkdir -p ~/.ssh && chmod 700 ~/.ssh
# 兼容两种形态：单行 base64（推荐），或直接把 PEM 明文贴进密钥文件
case "$SSH_KEY_B64" in
  -----BEGIN*) printf '%s\n' "$SSH_KEY_B64" > ~/.ssh/id_deploy ;;
  *) printf '%s' "$SSH_KEY_B64" | base64 -d > ~/.ssh/id_deploy 2>/dev/null \
       || printf '%s\n' "$SSH_KEY_B64" > ~/.ssh/id_deploy ;;
esac
chmod 600 ~/.ssh/id_deploy
# 没有 pipefail 了，解坏要自己兜住（空文件只会让 ssh 报 "no such identity"，更难查）
[ -s ~/.ssh/id_deploy ] || { echo "❌ 私钥解码为空：请检查 SSH_KEY_B64 是否为单行 base64"; exit 1; }
head -1 ~/.ssh/id_deploy | grep -q 'PRIVATE KEY' \
  || { echo "❌ 私钥解码后不是 PEM（首行无 PRIVATE KEY）：请检查 SSH_KEY_B64 内容"; exit 1; }
# 首次连接不交互：禁用 known_hosts 写入（IP + 非标端口，指纹变更不应阻断部署）
SSH_OPTS="-i $HOME/.ssh/id_deploy -p $SERVER_PORT -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15"

# 远端脚本用「引号 heredoc」整体投喂 ⇒ 本地不展开任何 $，变量靠 ssh 命令串里的赋值传入
ssh $SSH_OPTS "$SERVER_USER@$SERVER_HOST" \
  "DEPLOY_PATH='$DEPLOY_PATH' CONTAINER_NAME='$CONTAINER_NAME' REPO_URL='$REPO_URL' bash -s" <<'REMOTE'
set -e
set -o pipefail   # 让 (tar)|docker tar 管道左侧失败也能暴露，防「静默部署坏/空文件」

cd "$DEPLOY_PATH" || { echo "❌ DEPLOY_PATH=$DEPLOY_PATH 不存在，请先在服务器创建该目录"; exit 1; }
# 安全阀：绝不在家目录/根目录执行 git 强覆盖
case "$(pwd)" in
  /root|/root/*|/home|/home/*|/|/*/..) echo "❌ 危险：当前目录 $(pwd) 是受保护目录，拒绝执行 git 操作"; exit 1;;
esac
[ -f relay-server/server.js ] || { echo "❌ $DEPLOY_PATH 不是预期仓库（缺 relay-server/server.js），拒绝执行"; exit 1; }
git config --global --add safe.directory "$(pwd)"

# 清掉挂载源子目录里的嵌套 .git，否则父仓库 checkout 永远碰不到 relay-server/
for d in $(find . -name .git -type d -mindepth 2 2>/dev/null); do
  echo "⚠️ 发现嵌套 git 目录: $d，已移除（由 $DEPLOY_PATH 根仓库统一管理）"
  rm -rf "$d"
done

if [ ! -d .git ]; then
  echo "ℹ️ 首次部署：$DEPLOY_PATH 不是 git 仓库，自动就地初始化..."
  git init -q
  git remote add origin "$REPO_URL"
else
  # 迁移关键步：远端源从 GitHub 换成 CNB（幂等，重复执行无副作用）
  git remote set-url origin "$REPO_URL" 2>/dev/null || git remote add origin "$REPO_URL"
fi
echo "ℹ️ origin = $(git remote get-url origin)"

git fetch origin
git checkout -f -B main origin/main
git reset --hard origin/main
git clean -fd
echo "✅ 代码已同步到提交: $(git rev-parse --short HEAD) / relay 版本: $(grep '"version"' relay-server/package.json | head -1 | tr -d ' ,')"

CID="$CONTAINER_NAME"
if [ -z "$CID" ] || ! docker inspect "$CID" >/dev/null 2>&1; then
  echo "❌ 未找到容器 $CONTAINER_NAME"
  exit 1
fi

# 1panel 的 /app 是 bind 挂载，git reset 会换掉 inode 导致挂载指向旧孤儿目录
# ⇒ 不依赖挂载自动同步，直接 tar 把工作树写进容器当前看到的 /app
rm -rf /tmp/znhd-deploy && mkdir -p /tmp/znhd-deploy
cp -a "$DEPLOY_PATH/relay-server/." /tmp/znhd-deploy/ 2>/dev/null || cp -r "$DEPLOY_PATH/relay-server/." /tmp/znhd-deploy/
rm -rf /tmp/znhd-deploy/node_modules /tmp/znhd-deploy/.git
echo "📦 将最新代码强制写入容器 /app（tar 管道，绕过 bind 失联）..."
( cd /tmp/znhd-deploy && tar cf - . ) | docker exec -i "$CID" tar xf - -C /app
echo "✅ 代码已写入容器 /app"

echo "🔄 重启容器以加载新代码: $CID"
docker restart "$CID"
sleep 4

# 健康检查 + 版本自证（必须能失败：进程真的在服务新代码才算部署成功）
EXPECT_VER="$(grep '"version"' relay-server/package.json 2>/dev/null | head -1 | tr -d ' ,"' | sed 's/version://')"
HL=""
for i in $(seq 1 10); do
  HL="$(curl -fsS --max-time 3 http://127.0.0.1:5689/health 2>/dev/null || true)"
  [ -n "$HL" ] && break
  sleep 1
done
if [ -z "$HL" ]; then
  echo "❌ 健康检查失败：重启后约 10s 内 /health 无响应（服务可能未启动/crash-loop）"
  echo "   请登录服务器执行： docker logs $CID"
  exit 1
fi
ACTUAL_VER="$(printf '%s' "$HL" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
echo "✅ 健康检查通过: $HL"
if [ -n "$ACTUAL_VER" ] && [ "$ACTUAL_VER" != "$EXPECT_VER" ]; then
  echo "❌ 版本不一致：/health=$ACTUAL_VER  期望=$EXPECT_VER —— 进程仍在服务旧代码"
  echo "   请登录服务器执行： docker logs $CID   和   docker exec $CID sh -c 'ls -la /app | head'"
  exit 1
fi
echo "✅ /health 版本($ACTUAL_VER) 与代码库($EXPECT_VER) 一致，部署生效"
REMOTE
