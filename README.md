# ZNHD Service - 征纳互动推送服务

基于 FastAPI 的实时 WebSocket 推送服务，专为征纳互动监控脚本设计，集成前端界面、管理后台、设备指纹识别和图片传输功能，使用 Redis 存储数据。

## 功能特性

- **实时 WebSocket 推送**：支持文本消息和二进制数据（图片）的实时推送
- **分块图片传输**：64KB 分块传输，支持大文件高效传输，带进度追踪
- **双 Token 系统**：自动管理 App Token 和 Client Token，支持一对多推送
- **设备指纹识别**：基于 FingerprintJS v5 的设备唯一标识
- **设备管理**：支持封禁/解封设备，防止恶意连接
- **管理后台**：登录认证 + Redis 数据查询 + 设备指纹管理 + 实时日志查看
- **环形日志系统**：内存环形缓冲区，支持分类、过滤和实时查询
- **IP 地理定位**：自动识别客户端地理位置（国家/省份/城市）
- **每周自动清理**：定期清理过期 Redis 数据
- **健康监控**：实时监控服务状态、连接数和 Redis 状态
- **自定义 CORS**：支持通配符子域名的跨域配置
- **用户脚本集成**：配套 Tampermonkey 脚本 (znhd.user.js)

## 目录结构

```
znhd-service/
├── main.py              # FastAPI 主应用 (1385 行)
├── requirements.txt     # Python 依赖
├── Dockerfile          # Docker 构建配置
├── start.sh            # 启动脚本
├── README.md           # 项目说明
├── znhd.user.js        # Tampermonkey 用户脚本（配套客户端）
├── static/             # 静态文件
│   └── index.html      # POST 请求工具页面
├── templates/          # HTML 模板
│   ├── login.html      # 登录页面
│   └── admin.html      # 管理后台页面
└── plans/              # 设计文档
    ├── binary-image-transfer.md
    ├── fingerprint-integration-plan.md
    ├── implementation-plan.md
    └── logs-viewer-design.md
```

## 环境变量

| 变量名              | 必填 | 默认值        | 说明                                   |
|---------------------|------|---------------|----------------------------------------|
| `REDIS_URI`         | 否   | 无            | Redis 连接 URI（优先级高于分项配置）   |
| `REDIS_HOST`        | 否   | `localhost`   | Redis 服务器地址                       |
| `REDIS_PORT`        | 否   | `6379`        | Redis 服务器端口                       |
| `REDIS_PASSWORD`    | 否   | 无            | Redis 认证密码                         |
| `ADMIN_PASSWORD`    | 否   | `admin123`    | 管理后台登录密码（强烈建议修改）       |
| `SESSION_SECRET`    | 否   | 随机生成      | 会话 Token 生成密钥                    |

## 部署

### 本地开发

```bash
# 安装依赖
pip install -r requirements.txt

# 启动 Redis（如果本地没有）
docker run -d --name redis -p 6379:6379 redis:7-alpine

# 启动服务
uvicorn main:app --reload --port 8080

# 访问
# 主页：http://localhost:8080
# 管理后台：http://localhost:8080/login
```

### Docker Compose 部署（推荐）

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    command: redis-server --requirepass your_redis_password
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    restart: unless-stopped

  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      - REDIS_URI=redis://:your_redis_password@redis:6379
      - ADMIN_PASSWORD=your_admin_password
    depends_on:
      - redis
    restart: unless-stopped

volumes:
  redis-data:
```

启动服务：

```bash
docker-compose up -d

# 查看日志
docker-compose logs -f app
```

### Docker 部署（独立 Redis）

```bash
# 构建镜像
docker build -t znhd-service .

# 启动 Redis
docker run -d --name redis \
  -p 6379:6379 \
  redis:7-alpine redis-server --requirepass your_password

# 启动应用
docker run -d --name znhd-service \
  -p 8080:8080 \
  -e REDIS_URI=redis://:your_password@host.docker.internal:6379 \
  -e ADMIN_PASSWORD=your_password \
  znhd-service
```

### Zeabur 部署

1. 在 Zeabur 添加 Redis 服务（会自动注入 `REDIS_URI` 环境变量）
2. 设置环境变量：`ADMIN_PASSWORD`
3. 部署服务
4. Zeabur 会自动配置域名和 HTTPS

## API 接口

### 页面路由

| 路径         | 说明                           |
|--------------|--------------------------------|
| `/`          | POST 请求工具主页              |
| `/login`     | 登录页面                       |
| `/admin`     | 管理后台（需登录）             |
| `/message`   | 消息显示页面（需 token 参数）  |

### WebSocket 连接

```javascript
// 连接示例
const token = "your-client-token"; // 设备指纹或 Client Token
const ws = new WebSocket(`wss://your-domain/stream?token=${token}`);

ws.onmessage = (event) => {
  if (typeof event.data === 'string') {
    const msg = JSON.parse(event.data);
    if (msg.type === 'message') {
      console.log(`${msg.title}: ${msg.message}`);
    } else if (msg.type === 'binary_start') {
      // 准备接收图片
      console.log(`开始接收图片: ${msg.filename}, 大小: ${msg.size}`);
    }
  } else if (event.data instanceof Blob) {
    // 接收图片块
    console.log('接收图片数据块');
  }
};
```

### 发送文本消息

```bash
# POST 请求发送消息
curl -X POST "https://your-domain/message?token=your-app-token" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "测试标题",
    "message": "测试消息内容",
    "priority": 2
  }'
```

### 发送图片

```bash
# POST 请求上传图片
curl -X POST "https://your-domain/message/image?token=your-app-token" \
  -F "file=@/path/to/image.jpg" \
  -F "title=图片标题" \
  -F "priority=2"
```

### 认证 API

| 方法 | 路径              | 说明                          | 认证 |
|------|-------------------|-------------------------------|------|
| POST | `/api/login`      | 登录（返回会话 Cookie）       | 否   |
| GET  | `/api/auth/check` | 检查认证状态                  | 是   |
| POST | `/api/logout`     | 登出（清除会话）              | 是   |

### 管理 API（需认证）

**Redis 管理**

| 方法   | 路径                              | 说明                          |
|--------|-----------------------------------|-------------------------------|
| GET    | `/api/admin/redis/stats`          | 获取 Redis 统计信息           |
| GET    | `/api/admin/redis/all`            | 获取所有数据（限制 100 条）   |
| GET    | `/api/admin/redis/tokens`         | 获取完整 Token 列表及客户端信息 |
| GET    | `/api/admin/redis/keys?pattern=*` | 按模式查询 Redis 键           |
| POST   | `/api/admin/redis/clear`          | 清空所有 Redis 数据           |

**设备指纹管理**

| 方法 | 路径                                    | 说明                      |
|------|-----------------------------------------|---------------------------|
| GET  | `/api/fingerprint/list`                 | 获取所有设备指纹列表      |
| POST | `/api/fingerprint/block?fingerprint=XXX&reason=原因` | 封禁设备 |
| POST | `/api/fingerprint/unblock?fingerprint=XXX` | 解封设备             |

**日志管理**

| 方法   | 路径                                        | 说明                                 |
|--------|---------------------------------------------|--------------------------------------|
| GET    | `/api/admin/logs?level=INFO&category=BINARY&limit=100` | 获取日志（支持过滤） |
| GET    | `/api/admin/logs/stats`                     | 获取日志统计信息                     |
| DELETE | `/api/admin/logs`                           | 清空所有日志                         |

### 其他 API

| 方法 | 路径                     | 说明                        |
|------|--------------------------|----------------------------|
| GET  | `/health`                | 健康检查（Redis 状态、连接数）|
| GET  | `/tokens/{client_token}` | 获取 Token 信息（调试用）   |

## 核心功能说明

### 双 Token 系统

服务使用双 Token 机制实现一对多推送：

- **Client Token**：设备指纹（永久），标识客户端设备
- **App Token**：Base64 编码的 Client Token，用于 API 调用

**工作流程：**
1. 客户端通过 WebSocket 连接时使用 Client Token
2. 服务器自动创建 Client Token ↔ App Token 映射关系
3. 外部 API 使用 App Token 发送消息
4. 服务器通过映射找到 Client Token，推送给所有该设备的 WebSocket 连接

**数据结构（Redis）：**
```
client:{token} → {app_token, created_at, ip, location}  # 30天过期
app:{token} → client_token                               # 7天过期
```

### 图片传输系统

采用分块传输协议，支持大文件传输：

**传输流程：**
1. HTTP POST 上传图片 → 服务器接收完整文件
2. 返回 HTTP 200 响应（立即响应）
3. 后台异步通过 WebSocket 分块发送：
   - 发送 `binary_start` 消息（包含文件名、大小、类型）
   - 发送 64KB 二进制数据块（可能多个）
   - 发送 `binary_end` 消息（确认传输完成）

**优势：**
- HTTP 响应速度快，不阻塞
- 支持大文件传输（无大小限制）
- 分块传输，降低内存占用
- 传输进度可追踪（通过日志）

### 设备指纹识别

使用 FingerprintJS v5 实现设备唯一标识和管理：

**特性：**
- 自动识别设备指纹（浏览器、操作系统、硬件特征）
- WebSocket 连接时自动注册/更新设备信息
- 记录设备 IP 和地理位置（国家、省份、城市）
- 支持设备封禁（黑名单机制）
- 私有 IP 自动标记为"本地"

### Redis 数据结构

```
# 指纹存储（30天过期）
key: fingerprint:{fingerprint}
value: JSON {
    "fingerprint": "设备指纹",
    "created_at": "创建时间（ISO 8601）",
    "last_seen": "最后活跃时间",
    "ip": "IP地址",
    "location": "country region city"
}

# 设备黑名单（1年过期）
key: fingerprint:blocked:{fingerprint}
value: "封禁原因"

# Token 映射
client:{token} → {app_token, created_at, ip, location}  # 30天
app:{token} → client_token                               # 7天
```

### 日志系统

服务内置环形缓冲区日志系统（最多存储 1000 条）：

**日志级别：** INFO, WARNING, ERROR, DEBUG

**日志分类：**
- `BINARY` - 图片传输相关
- `WEBSOCKET` - WebSocket 连接管理
- `MESSAGE` - 消息推送
- `AUTH` - 认证相关
- `REDIS` - Redis 操作
- `SYSTEM` - 系统事件

**特性：**
- 实时查询和过滤（按级别、分类、时间）
- 统计功能（按级别和分类统计）
- 所有时间戳使用中国时区（Asia/Shanghai）
- 管理后台可视化查看

### IP 地理定位

自动获取客户端地理位置信息：

**数据源：**
- 主要：ip-api.com（免费，中文支持）
- 备用：ipinfo.io（Fallback）

**功能：**
- 识别国家、省份、城市
- 自动检测私有 IP（RFC1918）
- 5秒超时保护
- 结果存储在 Token 数据中

## 用户脚本集成

项目包含 `znhd.user.js` Tampermonkey 用户脚本，用于监控征纳互动平台：

**功能特性：**
- 实时监控等待人数和在线状态
- 语音播报功能
- 通过 WebSocket 推送文本消息和图片到本服务
- 自定义常用语
- 集成 FingerprintJS 设备指纹识别

**安装使用：**
1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 导入 `znhd.user.js` 脚本
3. 在脚本中配置 WebSocket 服务地址
4. 访问征纳互动平台时自动激活

**配置项：**
- `CHECK_INTERVAL` - 检查间隔（毫秒）
- `WORKING_HOURS` - 工作时间配置
- WebSocket 服务器地址

## 技术栈

**后端框架：**
- FastAPI 0.104.1 - 现代 Python Web 框架
- Uvicorn 0.24.0 - ASGI 服务器
- Starlette - ASGI 框架（中间件）

**数据存储：**
- Redis 5.0.1 (asyncio) - 异步 Redis 客户端
- JSON - 数据序列化

**实时通信：**
- WebSockets 12.0 - WebSocket 协议实现

**数据验证：**
- Pydantic 2.5.0 - 数据验证和序列化

**模板引擎：**
- Jinja2 3.1.2 - HTML 模板渲染

**工具库：**
- httpx 0.25.2 - 异步 HTTP 客户端（IP 定位）
- pytz 2024.1 - 时区处理（Asia/Shanghai）
- python-multipart 0.0.6 - 文件上传处理

**前端：**
- FingerprintJS v5 - 设备指纹识别
- 原生 JavaScript + WebSocket API

## 安全特性

✅ **会话认证** - 24 小时有效期的 HttpOnly Cookie  
✅ **密码保护** - 管理后台密码认证（环境变量配置）  
✅ **设备指纹** - 唯一设备标识，防止伪造  
✅ **设备封禁** - 黑名单机制，阻止恶意设备连接  
✅ **CORS 保护** - 自定义 CORS 中间件，支持域名白名单  
✅ **私有 IP 检测** - 识别内网 IP 地址  
✅ **Token 过期** - Redis TTL 自动清理过期数据  
✅ **环形日志** - 日志数量限制，防止内存溢出  
✅ **超时保护** - HTTP 请求 5 秒超时  
✅ **错误隔离** - 连接异常自动清理，不影响其他客户端  

## 监控与运维

### 健康检查

```bash
curl https://your-domain/health
```

响应示例：
```json
{
  "status": "healthy",
  "redis": "connected",
  "active_clients": 5,
  "total_connections": 8
}
```

### 日志查看

管理后台提供实时日志查看功能：
- 按级别过滤（INFO、WARNING、ERROR、DEBUG）
- 按分类过滤（BINARY、WEBSOCKET、MESSAGE 等）
- 时间范围筛选
- 实时刷新

### Redis 数据管理

管理后台支持：
- 查看所有 Redis 键值对
- 按模式搜索（支持通配符 `*`）
- 查看 Token 列表和客户端信息
- 清空所有数据（危险操作）

### 设备管理

- 查看所有已注册设备
- 设备详情（IP、位置、创建时间、最后活跃时间）
- 封禁/解封设备
- 查看当前在线状态

## 常见问题

### 1. WebSocket 连接失败

**检查项：**
- Token 是否正确
- 设备是否被封禁
- Redis 连接是否正常
- 防火墙/代理配置

**调试方法：**
```bash
# 查看健康状态
curl https://your-domain/health

# 查看 Token 信息
curl https://your-domain/tokens/{your-client-token}
```

### 2. 图片推送失败

**可能原因：**
- WebSocket 连接已断开
- 图片文件过大（建议 < 10MB）
- Token 映射关系不存在

**解决方案：**
- 检查 WebSocket 连接状态
- 查看管理后台日志
- 确认 Token 有效性

### 3. Redis 连接问题

**配置优先级：**
1. `REDIS_URI`（完整 URI，优先）
2. `REDIS_HOST` + `REDIS_PORT` + `REDIS_PASSWORD`（分项配置）

**Zeabur 部署注意：**
- Zeabur 会自动注入 `REDIS_URI` 环境变量
- 无需手动配置 Redis 连接信息

### 4. 管理后台无法登录

**检查项：**
- `ADMIN_PASSWORD` 环境变量是否正确设置
- 浏览器是否支持 Cookie
- 时区设置是否正确

## 开发指南

### 本地开发环境设置

```bash
# 克隆仓库
git clone https://github.com/Run-os/znhd-service.git
cd znhd-service

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 启动 Redis（Docker）
docker run -d --name redis -p 6379:6379 redis:7-alpine

# 启动开发服务器
uvicorn main:app --reload --port 8080
```

### 环境变量配置文件

创建 `.env` 文件（用于本地开发）：

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
ADMIN_PASSWORD=your_secure_password
SESSION_SECRET=your_secret_key
```

### 代码结构说明

```python
# main.py 主要模块
├── CustomCORSMiddleware      # CORS 中间件
├── ConnectionManager          # WebSocket 连接管理
├── LogQueue                   # 环形日志系统
├── startup_event()            # 启动时初始化
├── shutdown_event()           # 关闭时清理
├── weekly_cleanup()           # 每周清理任务
├── 页面路由                   # HTML 页面
├── WebSocket 端点             # /stream
├── 消息推送 API               # /message, /message/image
├── 认证 API                   # /api/login, /api/logout
├── 管理 API                   # /api/admin/*
├── 指纹管理 API               # /api/fingerprint/*
└── 日志 API                   # /api/admin/logs
```

## 贡献指南

欢迎贡献代码、报告问题或提出建议！

**贡献方式：**
1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 作者

- **runos** - [GitHub](https://github.com/Run-os)

## 相关链接

- [Tampermonkey](https://www.tampermonkey.net/) - 用户脚本管理器
- [FingerprintJS](https://fingerprintjs.com/) - 设备指纹识别库
- [FastAPI](https://fastapi.tiangolo.com/) - Python Web 框架
- [Redis](https://redis.io/) - 内存数据库
