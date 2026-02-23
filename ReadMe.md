# 局域网P2P文件/文本传输工具

## 项目简介

一个轻量级的局域网P2P传输工具，实现**公网信令握手，纯局域网高速传输**。所有文件和文本数据流仅在局域网内直接传输，不经过公网服务器，确保数据安全和传输速度。

### 核心特性

- **安全隔离**：强制校验仅允许同一局域网内的设备建立P2P连接（通过IP段判断）
- **高速传输**：数据流仅在 `192.168.x.x` / `10.x.x.x` 等内网网段传输
- **对等设计**：双端逻辑完全对等，无固定主动/被动角色，均可发起/接受传输请求
- **轻量级**：服务端仅作为WebSocket信令服务器，不处理任何业务数据
- **WebRTC优先**：优先使用WebRTC（无需额外端口），备选方案可扩展TCP套接字

### 架构说明

```
公网服务器（端口3000）
    ↓ 仅传输信令数据
    ↓ IP交换、配对握手、WebRTC信令
    ↓
[油猴脚本客户端] ←←←← WebRTC直连（局域网） ←←←← [网页客户端]
     (192.168.x.x)           数据流不走公网           (192.168.x.x)
```

## 项目结构

```
znhd-service/
├── server/                      # 服务端代码
│   ├── package.json            # Node.js 依赖配置
│   ├── server.js               # 信令服务器主程序
│   ├── Dockerfile              # Docker 镜像构建文件
│   ├── docker-compose.yml      # Docker Compose 配置
│   ├── .dockerignore           # Docker 忽略文件
│   └── public/                 # 网页客户端
│       ├── index.html          # 网页客户端HTML
│       ├── styles.css          # 样式文件
│       └── app.js              # 网页客户端JS（含WebRTC逻辑）
└── p2p-transfer.user.js        # 油猴脚本客户端
```

## 快速开始

### 脚本运行

1. 赋予执行权限

```
chmod +x redeploy.sh
```

2. 运行部署

```
# 普通部署（推荐使用缓存，速度快）
./redeploy.sh

# 强制重新构建（解决某些缓存问题时使用）
./redeploy.sh --no-cache

# 查看帮助
./redeploy.sh --help
脚本功能特性
```

### 1. 服务端部署（公网服务器）

#### 方式一：Docker 部署（推荐）

```bash
# 进入服务端目录
cd server

# 构建并启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

#### 方式二：手动部署

```bash
# 安装依赖
cd server
npm install

# 启动服务
npm start
```

服务启动后监听 `3000` 端口：
- WebSocket 信令服务：`ws://服务器IP:3000/ws`
- 网页客户端访问：`http://服务器IP:3000`

### 2. 配置油猴脚本

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 打开 [`p2p-transfer.user.js`](p2p-transfer.user.js:1) 文件
3. 点击 Tampermonkey 图标 → 创建新脚本
4. 复制 `p2p-transfer.user.js` 的全部内容并粘贴
5. 保存脚本（Ctrl+S）

**重要：修改信令服务器地址**

打开脚本，找到配置部分并修改 `signalingServer` 为您的公网服务器地址：

```javascript
const CONFIG = {
    // 修改为您的公网服务器IP或域名
    signalingServer: 'your-server-ip.com',
    port: '3000'
};
```

### 3. 使用网页客户端

1. 在浏览器中访问：`http://您的服务器IP:3000`
2. 页面会自动连接到信令服务器
3. 查看设备信息（设备ID、IP地址）

## 使用步骤

### 配对流程

1. **确保两台设备在同一局域网**
   - 两台设备都应连接到同一个路由器/交换机
   - IP地址应属于同一网段（如 192.168.1.x）

2. **启动客户端**
   - 油猴脚本：打开任意网页，点击右下角 📡 按钮
   - 网页客户端：访问 `http://服务器IP:3000`

3. **建立配对**
   - 在"可用设备"列表中选择目标设备
   - 点击"请求配对"按钮
   - 另一端会收到配对请求提示，选择"接受"

4. **P2P连接建立**
   - 配对成功后，双方自动建立WebRTC直连
   - 连接状态显示为"已建立连接"

### 数据传输

#### 发送文本
1. 在文本框中输入内容
2. 点击"发送文本"按钮
3. 对方会立即收到文本

#### 发送文件
1. 点击"选择文件"按钮
2. 选择要发送的文件
3. 点击"发送文件"按钮
4. 文件会分块传输到对方设备
5. 对方浏览器会自动触发下载

### 接收数据
- 收到的文本会显示在"接收数据"区域
- 收到的文件会自动下载到浏览器默认下载目录

## 安全说明

### IP 校验机制

服务端实现了严格的安全校验：

1. **私有IP检测**：仅允许私有IP地址的设备配对
   - `192.168.x.x`
   - `10.x.x.x`
   - `172.16.x.x` - `172.31.x.x`

2. **网段校验**：确保两台设备在同一局域网网段
   - IPv4：检查前三段是否相同（/24网段）
   - 10.x.x.x 网段：检查前两段是否相同

3. **WebRTC候选者过滤**：仅接受内网IP的ICE候选者
   - 忽略所有公网IP的候选者
   - 强制数据流走局域网

```javascript
// 服务端安全校验示例
if (!isPrivateIP(ip)) {
    return false;  // 拒绝非内网地址
}

if (!isSameNetwork(ip1, ip2)) {
    return false;  // 拒绝不同网段
}
```

### 数据隔离

- **信令服务器**：仅传输握手信号（IP、端口、SDP），不处理任何业务数据
- **WebRTC数据通道**：所有文件/文本数据直接在两台设备间传输
- **代码注释**：关键位置明确标注数据流走向

```javascript
// 数据流仅在局域网传输，不经过公网服务器
const message = {
    type: 'text',
    content: text
};
dataChannel.send(JSON.stringify(message));  // WebRTC 直连
```

## 技术栈

### 服务端
- **Node.js 18** - 运行环境
- **Express** - HTTP服务
- **WebSocket (ws)** - 信令服务

### 客户端
- **原生 JavaScript** - 无重型框架依赖
- **WebRTC API** - P2P数据传输
- **WebSocket API** - 信令通信

## Docker 部署详情

### 环境要求
- Docker 20.10+
- Docker Compose 2.0+

### 配置说明

#### 端口映射
```yaml
ports:
  - "3000:3000"  # 映射容器3000端口到宿主机3000端口
```

#### 环境变量
```yaml
environment:
  - NODE_ENV=production
  - PORT=3000
```

#### 重启策略
```yaml
restart: unless-stopped  # 自动重启（除非手动停止）
```

### 自定义配置

修改端口：
```yaml
ports:
  - "8080:3000"  # 使用8080端口访问
```

修改主机绑定：
```yaml
ports:
  - "0.0.0.0:3000:3000"  # 监听所有网络接口
```

## 故障排查

### 常见问题

1. **配对失败**
   - 确认两台设备在同一局域网
   - 检查防火墙是否阻止 WebSocket 连接
   - 查看浏览器控制台错误信息

2. **P2P连接建立失败**
   - 检查两台设备是否在同一网段
   - 确认 WebRTC 在浏览器中可用（https://webrtc.org/compatibility）
   - 尝试关闭 VPN 或代理

3. **文件传输失败**
   - 确认文件大小不超过浏览器限制
   - 检查磁盘空间
   - 查看网络连接稳定性

### 日志查看

#### Docker 日志
```bash
# 查看实时日志
docker-compose logs -f

# 查看最近100行日志
docker-compose logs --tail=100
```

#### 浏览器控制台
- 按 F12 打开开发者工具
- 切换到 Console 标签页
- 查看 `[P2P]` 开头的日志

## 性能优化

### 传输速度优化

- **分块大小调整**：根据网络环境调整 `fileChunkSize`
  ```javascript
  let fileChunkSize = 32768;  // 32KB，适合高速局域网
  ```

- **数据通道配置**：选择合适的传输模式
  ```javascript
  const dataChannel = peerConnection.createDataChannel('data', {
    ordered: true,      // 有序传输
    maxRetransmits: 0   // 禁用重传，提高速度
  });
  ```

### 内存优化

- **清理接收的文件**：定期清理 `receivedData` 区域
- **限制日志条目**：控制台日志不累积过多信息

## 扩展功能

### 添加TCP传输模式（可选）

如需TCP作为备选方案，可在服务端添加TCP服务，客户端通过WebSocket获取TCP端口后建立TCP连接。

### 添加断点续传

- 保存传输状态到本地存储
- 实现分块验证和重传机制

### 多文件传输

- 实现文件队列管理
- 支持批量文件选择和传输

## 许可证

MIT License

## 免责声明

本项目仅供学习、研究与个人非商业使用。使用者需自行遵守所在网络环境及相关法律法规，严禁用于非法用途。使用本工具所产生的一切风险、后果及法律责任均由使用者自行承担。

## 贡献

欢迎提交 Issue 和 Pull Request！

## 联系方式

- 作者：runos
- 项目地址：https://github.com/runos/znhd-service
