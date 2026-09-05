# 部署密钥设置（通用模板）

> 适用范围：任何「本地 push 代码 → CI 自动 SSH 登录服务器 → 拉代码/重启服务」的部署架构。
> 本文专讲**两套独立 SSH 密钥**的规划、生成与校验，与具体的部署流程笔记互补。

---

## 核心思路：两套密钥，方向相反

部署涉及两条**方向相反**的 SSH 链路，必须用两把互不相关的密钥：

| 密钥 | 方向 | 用途 |
|---|---|---|
| **密钥 A** | 服务器 → 代码托管（GitHub/GitLab 等） | 服务器向托管平台证明身份，拉取/克隆代码 |
| **密钥 B** | CI/CD → 服务器 | CI 用私钥 SSH 登录服务器，执行部署脚本 |

两把必须**独立生成、绝不共用**——否则任一侧泄露会牵连另一侧；且方向相反，互不可替。

> CI/CD 平台示例：GitHub Actions、GitLab CI、Drone、Gitea Actions 等。下文以 GitHub Actions 为主示例，括号内标注其它平台差异。

---

## 密钥 A：服务器 ↔ 代码托管（服务器拉代码用）

CI 在服务器侧执行 `git fetch` / `git pull`，仓库地址通常是 SSH 形式（如 `git@github.com:<OWNER>/<REPO>.git`），因此**服务器必须用一把 SSH 密钥向托管平台证明身份**才能拉代码。这把密钥只在「服务器 → 托管平台」方向使用。

### 1. 生成（在云服务器上执行）

```bash
# 生成无密码密钥对
ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519

# 修复 SSH 目录权限（必做，权限错误会直接认证失败）
mkdir -p /root/.ssh && chmod 700 /root/.ssh
chmod 600 /root/.ssh/id_ed25519
chmod 644 /root/.ssh/id_ed25519.pub

# 将托管平台加入已知主机（避免首次连接交互卡住）
ssh-keyscan github.com >> /root/.ssh/known_hosts
chmod 600 /root/.ssh/known_hosts
```

> 若为 GitLab，将 `github.com` 换成 `gitlab.com`（或你的自建域名）；多平台可重复 `ssh-keyscan`。

### 2. 登记公钥

- 公钥文件：`/root/.ssh/id_ed25519.pub`（以 `ssh-ed25519` 开头的整行文本）
- 粘贴位置（GitHub）：仓库 → **Settings → Deploy keys**
  - 服务器只用来 `git pull`（读），**仅需读权限即可，可不勾 Allow write access**；以后要从服务器回推代码再勾选。
- 其它平台：GitLab 在 `Settings → Repository → Deploy Keys`；Gitea 在 `仓库设置 → 部署密钥`。

### 3. 校验（服务器上执行）

```bash
ssh -T git@github.com
```

成功标识（GitHub 示例）：

```
Hi <OWNER>/<REPO>! You've successfully authenticated
```

> 若提示 `Permission denied (publickey)`，按序排查：公钥是否完整粘贴、是否勾了写权限冲突、known_hosts 是否写入、`.ssh` 权限是否为 700。

---

## 密钥 B：CI/CD ↔ 云服务器（CI 远程执行部署用）

CI 配置以私钥身份 SSH 登录你的服务器，执行 `git pull` + 重启服务等部署动作。这把密钥只在「CI → 服务器」方向使用，与密钥 A 方向相反、互不可替。

### 1. 生成（在云服务器上执行，独立密钥不和 A 共用）

```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/ci-deploy

# 写入授权列表，允许 CI 的 SSH 会话免密登录服务器
touch /root/.ssh/authorized_keys
cat /root/.ssh/ci-deploy.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
```

### 2. 登记

- **公钥**：`/root/.ssh/ci-deploy.pub` → 追加到服务器 `/root/.ssh/authorized_keys`（同上一步已完成）。
- **私钥**：`/root/.ssh/ci-deploy`（首尾包含 `-----BEGIN/END OPENSSH PRIVATE KEY-----`）。
  - **GitHub Actions**：存入仓库 **Settings → Secrets and variables → Actions**（如变量名 `KEY`）。
  - **GitLab CI**：存入仓库 **Settings → CI/CD → Variables**（勾 Masked，如 `SSH_KEY`）。
  - **Drone**：存入仓库后台 **Secrets**（如 `KEY`）。
  - **Gitea Actions**：同 GitHub Actions，仓库 **Settings → Actions Secrets**。
- **同组还需建立的变量**（与 CI 配置文件里的 `secrets.*` 一一对应）：
  - `SERVER_IP`：服务器公网 IP 或域名
  - `USERNAME`：登录用户名（如 `root` 或 `deploy`）
  - `PORT`：SSH 端口（默认 22）
- **注意**：私钥**不要设 passphrase**，否则 `appleboy/ssh-action` 等动作会报 `key is not password protected`（无交互入口可输入密码）。

### 3. 校验（在服务器上模拟 CI 登录，排查握手失败）

```bash
# 用这把私钥自登录本机，无密码即正常
ssh -i /root/.ssh/ci-deploy root@127.0.0.1
```

> 若需从**本地电脑**模拟 CI 登录（验证公网可达 + 端口/防火墙）：
> ```bash
> ssh -i /root/.ssh/ci-deploy root@<SERVER_IP> -p <PORT>
> ```

---

## 配置对照表（部署前填空）

| 项 | 你的取值 | 说明 |
|---|---|---|
| 托管平台 | `<github.com / gitlab.com / 自建域名>` | 决定 `ssh-keyscan` 与 `ssh -T` 的目标 |
| 仓库 | `<OWNER>/<REPO>` | Deploy key 粘贴位置 |
| 服务器 IP | `<SERVER_IP>` | CI 变量 `SERVER_IP` |
| 登录用户 | `<USERNAME>` | CI 变量 `USERNAME` |
| SSH 端口 | `<PORT>` | CI 变量 `PORT`，默认 22 |
| 私钥变量名 | `<KEY>` | CI 变量名，需与 CI 配置文件 `secrets.*` 一致 |
| 密钥 A 路径 | `/root/.ssh/id_ed25519` | 服务器拉代码用 |
| 密钥 B 路径 | `/root/.ssh/ci-deploy` | CI 登录服务器用 |

---

## 常见故障速查

| 现象 | 可能原因 | 排查 |
|---|---|---|
| `Permission denied (publickey)` 拉代码失败 | 密钥 A 公钥未正确粘贴 / 权限错 | 重查 Deploy key；确认 `.ssh` 700、私钥 600 |
| CI 报 `key is not password protected` | 密钥 B 设了 passphrase | 重新 `ssh-keygen -N ""` 生成无密码密钥 |
| CI 报 `Connection refused (111)` | 服务器 SSH 未监听 / 端口错 / 防火墙 | 服务器 `ss -tlnp | grep :22`；查安全组入站规则 |
| `Host key verification failed` | 服务器未写入 known_hosts | 重跑 `ssh-keyscan` 追加 |
| CI 能登录但 `git pull` 无权限 | 密钥 A 是部署钥但仓库地址用了 HTTPS | 统一用 SSH 地址 `git@...` |

---

## 一句话总结

- **密钥 A**：服务器上生成 → 公钥给托管平台（Deploy key）→ 服务器用它拉代码。
- **密钥 B**：服务器上生成 → 公钥写入自己 `authorized_keys` → 私钥给 CI Secrets → CI 用它登录服务器部署。
- 两套独立、方向相反、绝不共用。
