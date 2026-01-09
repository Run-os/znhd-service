# WebSocket 二进制图片传输优化开发文档

## 项目背景

基于 FastAPI 的 WebSocket 消息推送服务，需要优化图片传输性能。

## 问题描述

当前图片传输链路存在性能瓶颈：
- 800KB 图片需要约 8 秒传输完成
- 用户期望时间：1-3 秒

### 当前传输流程

```
用户选择图片 → Base64 编码（800KB → 1MB） → JSON POST → 服务器 → WebSocket → 客户端
```

### 性能瓶颈

1. **Base64 膨胀**：二进制数据转 Base64 后体积增加约 33%
2. **JSON 序列化**：大字符串序列化和传输效率低
3. **双重传输**：HTTP POST 接收 + WebSocket 转发

## 解决方案

### 优化后传输流程

```
用户选择图片 → FormData 二进制上传 → 服务器 → WebSocket 二进制推送 → 客户端
```

### 核心优化点

1. 使用 `multipart/form-data` 直接上传图片二进制数据
2. 使用 WebSocket `send_bytes()` 分块发送二进制数据
3. 避免 Base64 编码和 JSON 序列化开销

## 实现要求

### 后端要求

#### 1. 新增 WebSocket 二进制发送方法

在 `ConnectionManager` 类中添加 `send_binary()` 方法：

```python
async def send_binary(self, client_token: str, data: bytes, metadata: dict = None):
    """发送二进制数据（如图片）给客户端"""
    if client_token in self.active_connections:
        disconnected = set()
        for connection in self.active_connections[client_token]:
            try:
                # 1. 先发送元数据（JSON）
                await connection.send_json({
                    "type": "binary_start",
                    "data_type": metadata.get("data_type", "image"),
                    "filename": metadata.get("filename", ""),
                    "size": len(data),
                    "content_type": metadata.get("content_type", "image/jpeg"),
                    "transfer_id": metadata.get("transfer_id", "")
                })
                
                # 2. 分块发送二进制数据（64KB/块）
                chunk_size = 64 * 1024
                for i in range(0, len(data), chunk_size):
                    chunk = data[i:i + chunk_size]
                    await connection.send_bytes(chunk)
                
                # 3. 发送完成标记
                await connection.send_json({
                    "type": "binary_end",
                    "transfer_id": metadata.get("transfer_id", ""),
                    "size": len(data)
                })
            except Exception as e:
                logger.error(f"客户端 {client_token} 发送二进制数据时出错: {e}")
                disconnected.add(connection)
        
        # 清理断开的连接
        for conn in disconnected:
            self.disconnect(client_token, conn)
```

#### 2. 新增图片上传接口

```python
from fastapi import FastAPI, UploadFile, File, Query

@app.post("/message/image")
async def send_image(
    token: str = Query(...),
    title: str = Query("图片消息"),
    priority: int = Query(2),
    message: str = Query(""),
    file: UploadFile = File(...)
):
    """
    接收图片二进制数据并通过 WebSocket 推送给客户端
    使用 multipart/form-data 上传图片，性能更好
    """
    app_token = token
    
    # 通过 appToken 获取 clientToken
    client_token = await get_client_token(app_token)
    if not client_token:
        raise HTTPException(status_code=400, detail="Invalid app token format")
    
    # 读取图片二进制数据
    image_data = await file.read()
    filename = file.filename or "image.jpg"
    content_type = file.content_type or "image/jpeg"
    
    # 生成传输 ID
    transfer_id = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(8)}"
    
    # 检查是否有活跃的连接
    if client_token not in manager.active_connections:
        return JSONResponse(
            status_code=200,
            content={
                "status": "no_connection",
                "message": "图片已接收，但没有活跃的 WebSocket 连接",
                "client_token": client_token,
                "filename": filename,
                "size": len(image_data)
            }
        )
    
    # 通过 WebSocket 发送二进制数据
    await manager.send_binary(
        client_token,
        image_data,
        {
            "data_type": "image",
            "filename": filename,
            "content_type": content_type,
            "transfer_id": transfer_id,
            "title": title,
            "message": message,
            "priority": priority
        }
    )
    
    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "message": "图片已发送",
            "client_token": client_token,
            "filename": filename,
            "size": len(image_data),
            "transfer_id": transfer_id
        }
    )
```

#### 3. 导入依赖

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Request, Depends, Cookie, UploadFile, File
```

### 前端要求

#### 1. 新增二进制图片发送函数

```javascript
// 发送图片使用 multipart/form-data 二进制传输
async function sendWithBinaryImage(targetUrl, messageContent) {
    const tokenMatch = targetUrl.match(/[?&]token=([^&]+)/);
    if (!tokenMatch) {
        throw new Error('目标地址中未找到token参数');
    }
    const token = tokenMatch[1];
    
    addLog('正在通过二进制方式发送图片...', 'info');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 图片上传超时60秒

    try {
        const formData = new FormData();
        formData.append('file', originalImageFile);  // 使用原始文件对象
        formData.append('title', 'znhd-同步');
        formData.append('priority', '2');
        formData.append('message', messageContent);

        const response = await fetch(`${window.location.origin}/message/image?token=${token}`, {
            method: 'POST',
            body: formData,  // 不设置 Content-Type，让浏览器自动设置
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        // 检查 HTTP 状态码
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
        }

        // 解析 JSON 响应
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const responseText = await response.text();
            throw new Error(`服务器返回非JSON响应: ${responseText.substring(0, 100)}`);
        }

        const result = await response.json();
        
        if (result.status === 'success') {
            addLog(`成功: 二进制图片传输完成 - ${result.filename} (${(result.size / 1024).toFixed(2)}KB)`, 'success');
        } else {
            addLog(`警告: 图片已接收但客户端未连接 - ${result.message}`, 'info');
        }
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('图片上传超时 (60秒)');
        }
        throw error;
    }
}
```

#### 2. 修改发送逻辑

```javascript
async function sendPostRequest() {
    const targetUrl = targetUrlInput.value.trim();
    const messageContent = messageContentInput.value.trim();

    if (!targetUrl) { addLog('错误: 请输入目标地址', 'error'); return; }
    if (!messageContent && !selectedImageBase64) { addLog('错误: 请输入消息内容', 'error'); return; }
    if (isRequesting) { addLog('错误: 请求正在进行中，请稍候', 'error'); return; }

    isRequesting = true;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="spinner"></span><span class="status-text">发送中...</span>';

    try {
        // 如果有图片，优先使用二进制传输
        if (selectedImageBase64 && originalImageFile) {
            await sendWithBinaryImage(targetUrl, messageContent);
        } else {
            // 没有图片，使用原来的 JSON 方式
            await sendJsonRequest(targetUrl, messageContent);
        }
    } catch (error) {
        let errorMessage = '未知错误';
        if (error.name === 'AbortError') errorMessage = '请求超时';
        else if (error instanceof TypeError) errorMessage = `网络错误: ${error.message}`;
        else errorMessage = error.message || '请求失败';
        addLog(`失败: POST to ${targetUrl} - ${errorMessage}`, 'error');
    } finally {
        isRequesting = false;
        sendBtn.disabled = false;
        sendBtn.innerHTML = '发送请求';
    }
}
```

## API 文档

### 原有接口（保持兼容）

| 方法 | 路径                        | 说明                 |
|------|-----------------------------|----------------------|
| POST | `/message?token={appToken}` | 发送文本消息（JSON） |

请求体：
```json
{
  "message": "消息内容",
  "title": "标题",
  "priority": 2
}
```

### 新增接口

| 方法 | 路径                                                                            | 说明               |
|------|---------------------------------------------------------------------------------|--------------------|
| POST | `/message/image?token={appToken}&title={标题}&message={消息}&priority={优先级}` | 上传图片（二进制） |

请求格式：`multipart/form-data`

表单字段：
- `file`: 图片文件（必填）
- `title`: 消息标题（默认：图片消息）
- `message`: 附加消息（可选）
- `priority`: 优先级（默认：2）

## 性能对比

| 项目       | 优化前           | 优化后                     |
|------------|------------------|----------------------------|
| 图片编码   | Base64 (+33%)    | 无                         |
| 数据格式   | JSON 序列化      | 原始二进制                 |
| 传输次数   | HTTP + WebSocket | HTTP 直传 + WebSocket 通知 |
| 800KB 耗时 | ~8秒             | ~1-2秒                     |

## 依赖要求

确保 `python-multipart` 已安装（用于 `UploadFile`）：

```
python-multipart>=0.0.6
```

## 兼容性说明

- 原有 `/message` 接口保持不变，继续支持文本消息
- 新增 `/message/image` 接口专门处理图片
- 前端自动判断：有图片时使用二进制传输，无图片时使用 JSON
