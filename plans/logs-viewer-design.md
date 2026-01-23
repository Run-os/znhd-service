# 管理后台日志查看功能设计

## 1. 日志存储方案

### 内存日志队列（环形缓冲区）
- **最大容量**: 1000 条日志
- **日志格式**: `{timestamp, level, category, message, transfer_id}`
- **日志级别**: INFO, WARNING, ERROR, DEBUG, BINARY

### 日志分类
- `BINARY` - 二进制图片传输日志
- `WEBSOCKET` - WebSocket 连接日志
- `MESSAGE` - 文本消息传输日志
- `AUTH` - 认证日志
- `REDIS` - Redis 操作日志
- `SYSTEM` - 系统日志

## 2. API 设计

### GET /api/admin/logs
获取日志列表

**参数**:
- `level` (可选) - 按级别过滤
- `category` (可选) - 按分类过滤
- `limit` (可选) - 返回数量，默认100，最大500
- `since` (可选) - 只返回指定时间戳之后的日志

**响应**:
```json
{
  "logs": [
    {
      "id": 1,
      "timestamp": "2024-01-01T12:00:00.000Z",
      "level": "INFO",
      "category": "BINARY",
      "message": "开始发送二进制数据...",
      "transfer_id": "xxx"
    }
  ],
  "total": 100,
  "has_more": true
}
```

### GET /api/admin/logs/stats
获取日志统计

**响应**:
```json
{
  "total": 1000,
  "by_level": {
    "INFO": 500,
    "WARNING": 50,
    "ERROR": 10
  },
  "by_category": {
    "BINARY": 200,
    "WEBSOCKET": 100
  }
}
```

### DELETE /api/admin/logs
清空日志

## 3. 前端界面设计

### 日志查看面板
- **日志列表**: 滚动显示日志条目
- **筛选器**: 按级别、分类过滤
- **搜索**: 搜索日志内容
- **自动刷新**: 每5秒自动刷新
- **分页/滚动加载**: 加载更多历史日志

### 日志条目显示
```
[2024-01-01 12:00:00] [INFO] [BINARY] 开始发送二进制数据...
```

### 颜色编码
- INFO: 蓝色
- WARNING: 橙色
- ERROR: 红色
- DEBUG: 灰色
- BINARY: 紫色

## 4. 日志记录位置

### main.py
1. `ConnectionManager.send_binary()` - 图片传输开始/结束
2. `websocket_endpoint` - 连接/断开
3. `send_message` - 文本消息发送
4. `send_image` - 图片接收
5. `api_login` - 登录成功/失败

## 5. 实现步骤

1. 在 main.py 添加日志队列类
2. 添加日志 API 端点
3. 在关键位置调用日志记录函数
4. 修改 admin.html 添加日志查看界面
5. 实现自动刷新功能
