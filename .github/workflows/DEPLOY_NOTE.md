# GitHub Actions 部署到云服务器（1panel / Docker / 裸机 Node）配置笔记

> 适用：push 到 `main` 后，自动通过 SSH 把仓库同步到云服务器，并重启服务。
> 本文是**踩坑后的成品笔记**，重点不是「怎么写」，而是「哪些地方会咬人」。
> 配套模板见文末，复制即用，改 5 个占位符即可。

---

## 一、前置准备（一次性）

1. **SSH 密钥对**（部署用，建议单独一把，不要带密码）
   - 服务端：`~/.ssh/authorized_keys` 追加**公钥**（必须是**无密码**的 key，否则 `appleboy/ssh-action` 会报 `key is not password protected`）。
   - 仓库端：把**私钥**作为 Secret `KEY` 存进 GitHub 仓库 `Settings → Secrets and variables → Actions`。
2. **仓库 Secrets**（最少 3 个）
   | Secret        | 含义                         | 示例           |
   |---------------|------------------------------|----------------|
   | `SERVER_IP`   | 服务器公网 IP                 | `1.2.3.4`      |
   | `USERNAME`    | SSH 登录用户名                | `root`         |
   | `KEY`         | 上面生成的**私钥全文**        | `-----BEGIN…`  |
   | `PORT`        | SSH 端口（非 22 时必填）      | `22`           |
3. **服务器目录**：先 `mkdir -p /opt/<项目名>` 作为 git 克隆根（首次部署会被 workflow 自动 `git init`）。

> ⚠️ 私钥**不要设 passphrase**。本方案 workflow 里也不写 `passphrase:` 那一行。

---

## 二、三种部署形态对照（先选一种）

| 形态 | 服务器上怎么跑 | 同步方式 | 重启命令 |
|------|----------------|----------|----------|
| A. 裸机 Node | `node server.js`（nohup/pm2） | `git pull` 到目录 + 杀旧进程 | `pm2 restart` 或 `kill -HUP` |
| **B. 1panel Docker（本文默认）** | 容器 bind 挂载代码目录 | `git sync` + **tar 管道写入容器** | `docker restart <容器名>` |
| C. Docker Compose | `docker compose up -d` 构建镜像 | 改代码后重新 `compose build` | `docker compose up -d --build` |

> 本笔记主模板是 **B（1panel Docker）**，最坑也最值得记。A / C 的差异只在「第 2、3 步」，文末给出变体片段。

---

## 三、关键陷阱（血泪教训，务必照做）

### 陷阱 1：`appleboy/ssh-action` **不注入顶层 `env` 到远程 shell**
- **现象**：你在 workflow 顶层写 `env: DEPLOY_PATH: /opt/xxx`，远程拿到的是**空字符串**。
- **后果（真实事故）**：`cd "$DEPLOY_PATH"` 变成 `cd`（无参）→ 进入 SSH 登录默认家目录 `/root`；而 `cd "" 2>/dev/null` 不报错，原 `|| exit 1` 保护**完全失效**。之后 `git init/fetch/checkout/reset --hard/clean -fd` 全部在 `/root` 执行 → 把 GitHub 项目文件解出到 `/root`，`git clean -fd` 删光家目录下未跟踪文件（`.ssh/`、`.bashrc` 等）。
- **✅ 修复**：变量在 `script` 内**硬编码**，**绝不依赖 env 传递**。
  ```bash
  script: |
    set -e
    DEPLOY_PATH="/opt/你的项目"      # 硬编码，不读 $DEPLOY_PATH
    CONTAINER_NAME="你的容器名"
  ```

### 陷阱 2：Docker **bind 挂载 + git reset 会让容器读到旧版本**
- **背景**：1panel 把本机 `/opt/项目/relay-server` bind 挂载为容器 `/app`。
- **现象**：`git reset --hard` + `clean -fd` 更新 `relay-server/` 时**替换了该目录的 inode**；Docker 的 bind 挂载 /app 仍指向「旧孤儿目录」（里面是旧版本），而 `docker stop/start/restart` **都不会重新解析 bind**，于是容器持续读旧代码 → 表现为「日志同步成功、/health 仍是旧版」。
- **✅ 修复**：不再依赖挂载自动同步，改用 **tar 管道把工作树最新代码直接写进容器当前看到的 `/app`**：
  ```bash
  rm -rf /tmp/deploy && mkdir -p /tmp/deploy
  cp -a "$DEPLOY_PATH/relay-server/." /tmp/deploy/
  rm -rf /tmp/deploy/node_modules /tmp/deploy/.git
  ( cd /tmp/deploy && tar cf - . ) | docker exec -i "$CID" tar xf - -C /app
  docker restart "$CID"
  ```
  > `docker cp` 也不可靠（`SRC` 路径 `/.` 解析坑），tar 管道最稳。
- 若容器与 nginx 各自独立容器，注意 `proxy_pass` 须用 Docker 服务名（如 `http://znhd:5689`），`127.0.0.1` 在 nginx 容器里指它自己。

### 陷阱 3：缺**安全阀** → 把事故从「可能」变「必然」
- 在 `cd` 之后立刻加保护，DEPLOY_PATH 万一再次失效时**宁可失败也不碰家目录**：
  ```bash
  cd "$DEPLOY_PATH" || { echo "❌ DEPLOY_PATH 不存在"; exit 1; }
  case "$(pwd)" in
    /root|/root/*|/home|/home/*|/|/*/..) echo "❌ 受保护目录，拒绝执行"; exit 1;;
  esac
  [ -f relay-server/server.js ] || { echo "❌ 不是预期仓库，拒绝执行"; exit 1; }
  ```

### 陷阱 4：嵌套 `.git` 导致「同步成功但文件不更新」
- 挂载源子目录里若有自己的 `.git`（如 `relay-server/.git`），父仓库会把该子目录当孤立目录，checkout/reset 永远碰不到它。
- **✅ 修复**：每次同步前删除嵌套 git 目录：
  ```bash
  for d in $(find . -name .git -type d -mindepth 2 2>/dev/null); do rm -rf "$d"; done
  ```

### 陷阱 5：版本号「看起来成功」≠ 真成功
- **✅ 自证式健康检查**：重启后直接读容器内 `/app/package.json` 的真实版本，与 git 工作树期望版本比对，不一致则 `exit 1` 明确报错，杜绝静默失败（见文末模板）。

---

## 四、通用工作流模板（B 形态：1panel Docker）

保存为 `.github/workflows/deploy.yml`。**只需改 5 处**：仓库地址、DEPLOY_PATH、容器名、健康检查端口/路径、服务端口。

```yaml
name: 同步到云服务器

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: 同步代码并重启容器
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_IP }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.KEY }}
          port: ${{ secrets.PORT }}
          script: |
            set -e
            # —— 以下两行硬编码，不要改成 ${{ env.xxx }} ——
            DEPLOY_PATH="/opt/你的项目"          # ① 服务器 git 克隆根
            CONTAINER_NAME="你的容器名"          # ② docker ps 看到的名字
            APP_SUBDIR="relay-server"            # ③ 挂载源子目录（无子目录则留空 ""）
            HEALTH_PORT="5689"                   # ④ 服务健康检查端口
            REPO="git@github.com:你的名/你的项目.git"   # ⑤ 仓库地址

            cd "$DEPLOY_PATH" || { echo "❌ DEPLOY_PATH 不存在"; exit 1; }
            case "$(pwd)" in
              /root|/root/*|/home|/home/*|/|/*/..) echo "❌ 受保护目录，拒绝执行"; exit 1;;
            esac
            SRC="$DEPLOY_PATH"; [ -n "$APP_SUBDIR" ] && SRC="$DEPLOY_PATH/$APP_SUBDIR"
            [ -f "$SRC/package.json" ] || { echo "❌ 不是预期仓库，拒绝执行"; exit 1; }
            git config --global --add safe.directory "$(pwd)"

            for d in $(find . -name .git -type d -mindepth 2 2>/dev/null); do rm -rf "$d"; done

            if [ ! -d .git ]; then
              git init -q && git remote add origin "$REPO"
            elif ! git remote get-url origin >/dev/null 2>&1; then
              git remote add origin "$REPO"
            fi

            git fetch origin
            git checkout -f -B main origin/main
            git reset --hard origin/main
            git clean -fd
            echo "✅ 已同步到 $(git rev-parse --short HEAD)"

            CID="$CONTAINER_NAME"
            [ -z "$CID" ] && CID=$(docker ps --format "{{.Names}}" | head -n1)
            [ -z "$CID" ] && { echo "❌ 未找到容器"; exit 1; }

            rm -rf /tmp/deploy && mkdir -p /tmp/deploy
            cp -a "$SRC/." /tmp/deploy/ 2>/dev/null || cp -r "$SRC/." /tmp/deploy/
            rm -rf /tmp/deploy/node_modules /tmp/deploy/.git
            ( cd /tmp/deploy && tar cf - . ) | docker exec -i "$CID" tar xf - -C /app
            docker restart "$CID"
            sleep 4

            EXPECT_VER="$(grep '"version"' "$SRC/package.json" | head -1 | tr -d ' ,"' | sed 's/version://')"
            CT_VER="$(docker exec "$CID" grep -m1 '"version"' /app/package.json 2>/dev/null | tr -d ' ,"' | sed 's/version://')"
            if [ "$CT_VER" = "$EXPECT_VER" ]; then
              echo "✅ 部署生效：容器内版本 $CT_VER 与代码库一致"
            else
              echo "❌ 版本不一致 容器=$CT_VER 期望=$EXPECT_VER"; exit 1
            fi
```

---

## 五、形态 A / C 的「第 2、3 步」替代片段

### A. 裸机 Node（pm2）
```bash
# 替换模板中「找到容器」到「健康检查」整段：
pkill -f "node server.js" || true
nohup node "$DEPLOY_PATH/server.js" > /var/log/app.log 2>&1 &
sleep 2
curl -fsS "http://127.0.0.1:$HEALTH_PORT/health" && echo "✅ 健康检查通过"
```
（或已用 pm2：`pm2 restart 你的应用名`）

### C. Docker Compose
```bash
cd "$DEPLOY_PATH"
docker compose up -d --build
sleep 4
docker compose ps
```

---

## 六、排错速查

| 现象 | 根因 | 处理 |
|------|------|------|
| `key is not password protected` | 私钥有密码 | 改用无密码密钥，删 workflow 的 `passphrase` 行 |
| `❌ 不是 git 仓库` | 目录未初始化 | 已自动 `git init`，重跑即可 |
| 日志同步成功、但 /health 是旧版 | bind 挂载 inode 失联（陷阱 2） | 用 tar 管道写入容器 /app |
| 家目录被项目文件覆盖（最严重） | env 未注入 → cd 进 /root（陷阱 1） | 路径硬编码 + 安全阀；事后恢复 `/root/.ssh/authorized_keys`、清理误入文件 |
| `Connection refused (111)` 报 upstream | relay 没在预期端口监听 | 核对服务端口与 nginx `proxy_pass` 一致 |
| 健康检查 404 | 服务端口/路径不对 | 调 `HEALTH_PORT`、`/health` 路径 |

---

## 七、一句话心法

> **远程变量硬编码、家目录加安全阀、容器靠 tar 管道喂、版本自证别静默。**
> 这四条少一条，都可能从「部署失败」升级成「把服务器家目录删了」。
