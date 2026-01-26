# FastAPI Webhook Service

基于 FastAPI 的 WebSocket 推送服务，集成前端界面和管理后台，使用 Redis 存储数据。

## 功能特性

- **WebSocket 推送**：实时消息推送服务
- **POST 请求工具**：集成的前端界面，支持发送消息和图片
- **管理后台**：登录认证 + Redis 数据查询 + 设备指纹管理
- **自动 Token 管理**：自动创建和管理 token 对
- **设备指纹识别**：基于 FingerprintJS 的设备指纹验证
- **设备封禁**：支持封禁/解封设备
- **每周自动清理**：定期清理过期数据

## 目录结构

```
webhook-service/
├── main.py              # FastAPI 主应用
├── requirements.txt     # Python 依赖
├── Dockerfile          # Docker 构建配置
├── README.md           # 项目说明
├── static/             # 静态文件
│   └── index.html      # POST 请求工具页面
└── templates/          # HTML 模板
    ├── login.html      # 登录页面
    └── admin.html      # 管理后台页面
```

## 环境变量

| 变量名           | 必填 | 默认值                   | 说明             |
|------------------|------|--------------------------|------------------|
| `REDIS_URI`      | 否   | `redis://localhost:6379` | Redis 连接地址   |
| `ADMIN_PASSWORD` | 否   | `admin123`               | 管理后台登录密码 |

## 部署

### 本地开发

```bash
cd webhook-service
pip install -r requirements.txt
uvicorn main:app --reload
```

### Docker Compose 部署（推荐）

```bash
cd webhook-service

# 1. 设置Redis密码
mkdir -p redis
echo "your_secure_password" > redis/redis_password.txt

# 2. 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f
```

### Docker 部署（独立Redis）

```bash
cd webhook-service
docker build -t webhook-service .

# 启动Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# 启动应用
docker run -p 8000:8000 \
  -e REDIS_URI=redis://:your_password@host:6379 \
  -e ADMIN_PASSWORD=your_password \
  webhook-service
```

### Zeabur 部署

1. 连接 Redis 服务
2. 设置环境变量：`ADMIN_PASSWORD`
3. 部署服务

## API 接口

### 页面路由

| 路径     | 说明               |
|----------|--------------------|
| `/`      | POST 请求工具主页  |
| `/login` | 登录页面           |
| `/admin` | 管理后台（需登录） |

### WebSocket 连接

```
ws://your-domain/stream?token=your-client-token
```

### 发送消息

```bash
curl -X POST "http://your-domain/message?token=your-app-token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "测试标题",
    "message": "测试消息",
    "priority": 2
  }'
```

### 认证 API

| 方法 | 路径              | 说明         |
|------|-------------------|--------------|
| POST | `/api/login`      | 登录         |
| GET  | `/api/auth/check` | 检查认证状态 |
| POST | `/api/logout`     | 登出         |

### 管理 API（需认证）

| 方法 | 路径                              | 说明            |
|------|-----------------------------------|-----------------|
| GET  | `/api/admin/redis/stats`          | 获取 Redis 统计 |
| GET  | `/api/admin/redis/all`            | 获取所有数据    |
| GET  | `/api/admin/redis/keys?pattern=*` | 按模式查询      |

### 指纹管理 API（需认证）

| 方法 | 路径                       | 说明             |
|------|----------------------------|------------------|
| GET  | `/api/fingerprint/list`    | 获取设备指纹列表 |
| POST | `/api/fingerprint/block`   | 封禁设备         |
| POST | `/api/fingerprint/unblock` | 解封设备         |

### 其他 API

| 方法 | 路径                     | 说明            |
|------|--------------------------|-----------------|
| GET  | `/health`                | 健康检查        |
| GET  | `/tokens/{client_token}` | 获取 token 信息 |

## 设备指纹说明

### 概述

服务集成 FingerprintJS v5 实现设备指纹识别，用于生成唯一的 `webhookToken` 和设备验证。

### 工作流程

1. 客户端脚本启动时加载 FingerprintJS
2. 获取设备指纹并直接作为 `webhookToken`
3. 连接 WebSocket 时自动注册/更新指纹
4. 服务器验证指纹合法性，支持封禁设备

### Redis 数据结构

```
# 指纹存储
key: fingerprint:{fingerprint}
value: JSON {
    "fingerprint": "设备指纹",
    "created_at": "创建时间",
    "last_seen": "最后活跃时间",
    "ip": "IP地址",
    "location": "地理位置"
}

# 设备黑名单
key: fingerprint:blocked:{fingerprint}
value: "封禁原因"
```

### 管理后台

管理后台提供设备指纹管理功能：
- 查看所有已注册设备列表
- 查看设备详细信息（IP、位置、创建时间、活跃状态）
- 封禁/解封设备
