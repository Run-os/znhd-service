from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Request, Depends, Cookie, UploadFile, File
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import redis.asyncio as redis
import base64
import json
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, Set, Optional
import logging
import os
import re
import secrets
import hashlib
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import httpx
import pytz

# 配置时区为中国时区
CHINA_TZ = pytz.timezone('Asia/Shanghai')

def now_china():
    """获取中国时区的当前时间"""
    return datetime.now(CHINA_TZ)

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Webhook Service")

# 配置模板和静态文件
templates = Jinja2Templates(directory="templates")

# 认证配置
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
SESSION_SECRET = os.getenv("SESSION_SECRET", secrets.token_hex(32))
active_sessions: Dict[str, datetime] = {}  # session_token -> expiry_time

# 自定义 CORS 中间件，支持通配符子域名


class CustomCORSMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        # 允许的域名模式
        self.allowed_origin_patterns = [
            re.compile(r"^https://.*\.zeabur\.app$"),
            re.compile(r"^https://.*\.730406\.xyz$"),
            re.compile(r"^http://localhost(:\d+)?$"),
            re.compile(r"^http://127\.0\.0\.1(:\d+)?$"),
        ]

    def is_origin_allowed(self, origin: str) -> bool:
        if not origin:
            return True
        for pattern in self.allowed_origin_patterns:
            if pattern.match(origin):
                return True
        return False

    async def dispatch(self, request: Request, call_next):
        origin = request.headers.get("origin", "")

        # 处理预检请求 (OPTIONS)
        if request.method == "OPTIONS":
            response = Response(status_code=200)
            if self.is_origin_allowed(origin):
                response.headers["Access-Control-Allow-Origin"] = origin if origin else "*"
            else:
                response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "*"
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Access-Control-Max-Age"] = "600"
            return response

        # 处理正常请求
        response = await call_next(request)

        # 添加 CORS 头
        if self.is_origin_allowed(origin):
            response.headers["Access-Control-Allow-Origin"] = origin if origin else "*"
        else:
            response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Access-Control-Expose-Headers"] = "*"
        return response


app.add_middleware(CustomCORSMiddleware)

# Redis 连接
redis_client = None

# WebSocket 连接管理


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, Set[WebSocket]] = {}

    async def connect(self, client_token: str, websocket: WebSocket):
        await websocket.accept()
        if client_token not in self.active_connections:
            self.active_connections[client_token] = set()
        self.active_connections[client_token].add(websocket)
        log_event("INFO", "WEBSOCKET", f"🔌 客户端已连接, 总连接数: {len(self.active_connections[client_token])}", client_token[:20])

    def disconnect(self, client_token: str, websocket: WebSocket):
        if client_token in self.active_connections:
            self.active_connections[client_token].discard(websocket)
            if not self.active_connections[client_token]:
                del self.active_connections[client_token]
        log_event("INFO", "WEBSOCKET", f"❌ 客户端已断开连接", client_token[:20])

    async def send_message(self, client_token: str, message: dict):
        if client_token in self.active_connections:
            disconnected = set()
            for connection in self.active_connections[client_token]:
                try:
                    await connection.send_json(message)
                except Exception as e:
                    logger.error(f"客户端 {client_token} 发送消息时出错: {e}")
                    disconnected.add(connection)

            # 清理断开的连接
            for conn in disconnected:
                self.disconnect(client_token, conn)

    async def send_binary(self, client_token: str, data: bytes, metadata: dict = None):
        """发送二进制数据（如图片）给客户端"""
        if client_token in self.active_connections:
            disconnected = set()
            total_size = len(data)
            chunk_size = 64 * 1024  # 64KB 每块
            total_chunks = (total_size + chunk_size - 1) // chunk_size
            transfer_id = metadata.get("transfer_id", "") if metadata else ""
            filename = metadata.get("filename", "") if metadata else ""
            
            # 添加分割线
            # log_event("INFO", "BINARY", "=" * 50, transfer_id)
            # 记录日志
            log_event("INFO", "BINARY", f"📤 开始发送图片: {filename}, 大小: {format_size(total_size)}, 分{total_chunks}块", transfer_id)
            
            for connection in self.active_connections[client_token]:
                try:
                    # 先发送元数据
                    metadata_msg = {
                        "type": "binary_start",
                        "data_type": metadata.get("data_type", "image"),
                        "filename": filename,
                        "size": total_size,
                        "content_type": metadata.get("content_type", "image/jpeg"),
                        "transfer_id": transfer_id
                    }
                    log_event("DEBUG", "BINARY", f"发送 binary_start: {filename}", transfer_id)
                    await connection.send_json(metadata_msg)
                    
                    # 分块发送二进制数据
                    sent_chunks = 0
                    sent_bytes = 0
                    for i in range(0, total_size, chunk_size):
                        chunk = data[i:i + chunk_size]
                        await connection.send_bytes(chunk)
                        sent_chunks += 1
                        sent_bytes += len(chunk)
                    
                    # 发送完成标记
                    end_msg = {
                        "type": "binary_end",
                        "transfer_id": transfer_id,
                        "size": total_size,
                        "chunks": sent_chunks
                    }
                    log_event("DEBUG", "BINARY", f"发送 binary_end: {filename}, 块数:{sent_chunks}", transfer_id)
                    await connection.send_json(end_msg)
                    
                    log_event("INFO", "BINARY", f"✅ 图片发送完成: {filename}, 块数:{sent_chunks}, 大小:{format_size(sent_bytes)}", transfer_id)
                    # log_event("INFO", "BINARY", "=" * 50, transfer_id)
                except Exception as e:
                    log_event("ERROR", "BINARY", f"❌ 发送失败到 {client_token[:20]}...: {str(e)}", transfer_id)
                    disconnected.add(connection)

            # 清理断开的连接
            for conn in disconnected:
                self.disconnect(client_token, conn)


manager = ConnectionManager()

# ==================== 日志队列（环形缓冲区）====================

MAX_LOGS = 1000  # 最大日志条数


class LogEntry:
    """日志条目"""
    def __init__(self, level: str, category: str, message: str, transfer_id: str = ""):
        self.id = secrets.token_hex(8)
        # 使用中国时区时间戳
        self.timestamp = now_china().isoformat()
        self.level = level  # INFO, WARNING, ERROR, DEBUG
        self.category = category  # BINARY, WEBSOCKET, MESSAGE, AUTH, REDIS, SYSTEM
        self.message = message
        self.transfer_id = transfer_id
    
    def to_dict(self):
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "level": self.level,
            "category": self.category,
            "message": self.message,
            "transfer_id": self.transfer_id
        }


class LogQueue:
    """日志队列（环形缓冲区）"""
    def __init__(self, max_size=MAX_LOGS):
        self.max_size = max_size
        self.logs = []
        self.lock = asyncio.Lock()
    
    async def add(self, level: str, category: str, message: str, transfer_id: str = ""):
        """添加日志"""
        async with self.lock:
            entry = LogEntry(level, category, message, transfer_id)
            self.logs.append(entry)
            # 超过最大容量时删除最旧的日志
            if len(self.logs) > self.max_size:
                self.logs.pop(0)
    
    async def get(self, level: str = None, category: str = None,
                  since: str = None, limit: int = 100):
        """获取日志（支持过滤）"""
        async with self.lock:
            filtered = self.logs.copy()
            
            # 按级别过滤
            if level:
                filtered = [log for log in filtered if log.level == level]
            
            # 按分类过滤
            if category:
                filtered = [log for log in filtered if log.category == category]
            
            # 按时间过滤
            if since:
                since_dt = datetime.fromisoformat(since)
                filtered = [log for log in filtered if datetime.fromisoformat(log.timestamp) > since_dt]
            
            # 按时间倒序排列
            filtered.sort(key=lambda x: x.timestamp, reverse=True)
            
            # 限制数量
            return [log.to_dict() for log in filtered[:limit]]
    
    async def get_stats(self):
        """获取日志统计"""
        async with self.lock:
            by_level = {}
            by_category = {}
            for log in self.logs:
                by_level[log.level] = by_level.get(log.level, 0) + 1
                by_category[log.category] = by_category.get(log.category, 0) + 1
            return {
                "total": len(self.logs),
                "by_level": by_level,
                "by_category": by_category
            }
    
    async def clear(self):
        """清空日志"""
        async with self.lock:
            self.logs.clear()


log_queue = LogQueue()


def format_size(size_bytes: int) -> str:
    """将字节转换为易读的单位（MB）"""
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.2f} KB"
    else:
        return f"{size_bytes / (1024 * 1024):.2f} MB"


def log_event(level: str, category: str, message: str, transfer_id: str = ""):
    """记录日志的便捷函数"""
    # 同时输出到标准日志
    if level == "ERROR":
        logger.error(f"[{category}] {message}")
    elif level == "WARNING":
        logger.warning(f"[{category}] {message}")
    else:
        logger.info(f"[{category}] {message}")
    
    # 添加到日志队列
    asyncio.create_task(log_queue.add(level, category, message, transfer_id))

# 请求体模型


class Message(BaseModel):
    message: str
    priority: int = 2
    title: str = "通知"


class LoginRequest(BaseModel):
    password: str


# 认证辅助函数
def create_session_token() -> str:
    """创建会话令牌"""
    return secrets.token_hex(32)


def verify_session(session_token: Optional[str]) -> bool:
    """验证会话是否有效"""
    if not session_token or session_token not in active_sessions:
        return False
    if now_china() > active_sessions[session_token]:
        del active_sessions[session_token]
        return False
    return True


async def get_current_user(session_token: Optional[str] = Cookie(None, alias="session_token")):
    """获取当前用户（依赖注入）"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权访问")
    return True


@app.on_event("startup")
async def startup_event():
    global redis_client
    
    # 构建 Redis 连接 URL
    redis_url = os.getenv("REDIS_URI", "")
    redis_password = os.getenv("REDIS_PASSWORD", "")
    redis_host = os.getenv("REDIS_HOST", "localhost")
    redis_port = os.getenv("REDIS_PORT", "6379")
    
    # 如果没有 REDIS_URI，则根据环境变量构建
    if not redis_url:
        if redis_password:
            redis_url = f"redis://:{redis_password}@{redis_host}:{redis_port}/0"
        else:
            redis_url = f"redis://{redis_host}:{redis_port}/0"
    
    try:
        redis_client = await redis.from_url(redis_url, decode_responses=True)
        await redis_client.ping()
        # 隐藏密码显示
        safe_url = redis_url.replace(f":{redis_password}@", ":***@") if redis_password else redis_url
        logger.info(f"[SUCCESS] Redis connected successfully to {safe_url}")
    except Exception as e:
        logger.error(f"Redis connection failed: {e}")
        # Zeabur 环境如果 Redis 暂时不可用，不退出，后续请求会失败但应用继续运行
        if os.getenv("REDIS_URI"):
            logger.warning("Zeabur Redis not ready yet, continuing without Redis...")
        else:
            raise

    # 启动定时清理任务
    asyncio.create_task(weekly_cleanup())


@app.on_event("shutdown")
async def shutdown_event():
    if redis_client:
        await redis_client.close()


async def weekly_cleanup():
    """每周清空一次所有数据"""
    while True:
        try:
            # 等待 7 天
            await asyncio.sleep(7 * 24 * 60 * 60)
            # 每次检查 Redis 连接状态
            if redis_client is not None:
                try:
                    await redis_client.ping()
                except Exception:
                    redis_client = None
                    logger.warning("Redis connection lost in cleanup task")
                    continue
                await redis_client.flushdb()
                logger.info("Weekly cleanup completed")
        except Exception as e:
            logger.error(f"Cleanup error: {e}")


async def get_client_ip(request: Request) -> str:
    """获取客户端真实IP地址"""
    # 尝试从各种请求头获取真实IP
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip
    
    # 如果没有代理，直接获取
    if request.client:
        return request.client.host
    
    return "unknown"


def is_private_ip(ip: str) -> bool:
    """检测是否为私有IP地址"""
    import ipaddress
    try:
        addr = ipaddress.ip_address(ip)
        return addr.is_private
    except:
        return False


async def get_ip_geolocation(ip: str) -> dict:
    """获取IP对应的地理位置信息"""
    if ip == "unknown" or is_private_ip(ip):
        return {"country": "本地", "region": "本地", "city": "本地"}
    
    # 多个备用API
    apis = [
        ("http://ip-api.com/json/{ip}?lang=zh-CN", "ip-api.com"),
        ("https://ipinfo.io/{ip}/json", "ipinfo.io"),
    ]
    
    for api_url, api_name in apis:
        try:
            url = api_url.replace("{ip}", ip)
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    
                    if api_name == "ip-api.com":
                        if data.get("status") == "success":
                            return {
                                "country": data.get("country", ""),
                                "region": data.get("regionName", ""),
                                "city": data.get("city", "")
                            }
                    elif api_name == "ipinfo.io":
                        # ipinfo.io 返回格式不同
                        if "country" in data or "region" in data or "city" in data:
                            return {
                                "country": data.get("country", ""),
                                "region": data.get("region", ""),
                                "city": data.get("city", "")
                            }
        except Exception as e:
            logger.warning(f"从 {api_name} 获取IP地理位置失败: {e}")
            continue
    
    logger.error(f"所有API获取IP地理位置失败: {ip}")
    return {"country": "未知", "region": "未知", "city": "未知"}


async def get_geo_info(request: Request) -> dict:
    """获取客户端IP和地理位置信息"""
    ip = get_client_ip(request)
    geo = await get_ip_geolocation(ip)
    return {"ip": ip, **geo}


# 通过 appToken 获取 clientToken（用于消息推送）
async def get_client_token(app_token: str, trace_id: str = "") -> str:
    """通过 appToken 获取 clientToken"""
    if redis_client:
        redis_start = now_china()
        try:
            client_token = await asyncio.wait_for(
                redis_client.get(f"app:{app_token}"),
                timeout=2.0  # 2秒超时
            )
            elapsed = (now_china() - redis_start).total_seconds()
            if elapsed > 0.1:  # 超过100ms记录警告
                log_event("WARNING", "REDIS", f"⚠️ Redis读取慢: {elapsed:.3f}秒, trace: {trace_id[:20]}", trace_id)
            if client_token:
                return client_token
        except asyncio.TimeoutError:
            log_event("ERROR", "REDIS", f"❌ Redis读取超时: trace: {trace_id[:20]}", trace_id)
        except Exception as e:
            log_event("ERROR", "REDIS", f"❌ Redis读取错误: {e}, trace: {trace_id[:20]}", trace_id)
    return None


# 挂载静态文件目录
app.mount("/static", StaticFiles(directory="static"), "static")


@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    """主页 - 返回静态HTML页面"""
    with open("static/index.html", "r", encoding="utf-8") as f:
        return HTMLResponse(content=f.read())


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    """登录页面"""
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/admin", response_class=HTMLResponse)
async def admin_page(request: Request, session_token: Optional[str] = Cookie(None)):
    """管理后台页面"""
    if not verify_session(session_token):
        return RedirectResponse(url="/login", status_code=302)
    return templates.TemplateResponse("admin.html", {"request": request})


@app.websocket("/stream")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(...)):
    """WebSocket 连接端点 - 指纹验证"""
    fingerprint = token  # webhookToken直接作为指纹
    
    # 检查是否在黑名单中
    if redis_client:
        blocked = await redis_client.get(f"fingerprint:blocked:{fingerprint}")
        if blocked:
            logger.warning(f"拒绝封禁设备的连接: {fingerprint[:20]}...")
            await websocket.close(code=4000, reason="设备已被封禁")
            return
    
    # 获取IP和地理位置信息
    geo_info = None
    try:
        # 优先从请求头获取真实客户端IP（支持代理层）
        client_host = "unknown"
        
        # 从WebSocket scope的headers中获取
        headers_dict = dict(websocket.scope.get("headers", []))
        
        # 尝试从X-Forwarded-For获取
        forwarded_for = headers_dict.get(b"x-forwarded-for", b"").decode()
        if forwarded_for:
            client_host = forwarded_for.split(",")[0].strip()
        else:
            # 尝试从X-Real-IP获取
            real_ip = headers_dict.get(b"x-real-ip", b"").decode()
            if real_ip:
                client_host = real_ip
            else:
                # 兜底使用websocket.client.host
                client_host = websocket.client.host if websocket.client else "unknown"
        
        geo_info = await get_ip_geolocation(client_host)
        geo_info["ip"] = client_host
    except Exception as e:
        logger.error(f"获取IP地理位置失败: {e}")
        geo_info = {"ip": "unknown", "country": "未知", "region": "未知", "city": "未知"}
    
    # 指纹注册/更新
    if redis_client:
        fp_data = await redis_client.get(f"fingerprint:{fingerprint}")
        if not fp_data:
            # 新设备，注册指纹
            fp_data_new = {
                "fingerprint": fingerprint,
                "created_at": now_china().isoformat(),
                "last_seen": now_china().isoformat(),
                "ip": geo_info.get("ip", ""),
                "location": f"{geo_info.get('country', '')} {geo_info.get('region', '')} {geo_info.get('city', '')}"
            }
            await redis_client.set(
                f"fingerprint:{fingerprint}",
                json.dumps(fp_data_new, ensure_ascii=False),
                ex=30*24*60*60  # 30天过期
            )
            logger.info(f"新设备指纹已注册: {fingerprint[:20]}...")
        else:
            # 更新最后活跃时间
            data = json.loads(fp_data)
            data["last_seen"] = now_china().isoformat()
            data["ip"] = geo_info.get("ip", "")
            await redis_client.set(
                f"fingerprint:{fingerprint}",
                json.dumps(data, ensure_ascii=False),
                ex=30*24*60*60  # 保持30天过期时间
            )
    
    # 生成app_token
    client_token = fingerprint
    app_token = base64.b64encode(client_token.encode()).decode()
    
    # 存储到Redis
    if redis_client:
        token_data = {
            "app_token": app_token,
            "created_at": now_china().isoformat(),
            "ip": geo_info.get("ip", ""),
            "location": {
                "country": geo_info.get("country", ""),
                "region": geo_info.get("region", ""),
                "city": geo_info.get("city", "")
            }
        }
        # client:token 30天过期，app:token 7天过期
        await redis_client.set(f"client:{client_token}", json.dumps(token_data, ensure_ascii=False), ex=30*24*60*60)
        await redis_client.set(f"app:{app_token}", client_token, ex=7*24*60*60)

    await manager.connect(client_token, websocket)

    try:
        # 保持连接
        while True:
            data = await websocket.receive_text()
            logger.info(f"已接收来自 {client_token[:20]}... 的消息: {data}")

    except WebSocketDisconnect:
        manager.disconnect(client_token, websocket)
        logger.info(f"客户端 {client_token[:20]}... 已断开连接")
    except Exception as e:
        logger.error(f"WebSocket 错误: {e}")
        manager.disconnect(client_token, websocket)


@app.get("/message")
async def message_page(request: Request, token: str = Query(...)):
    """消息页面 - 用于显示消息内容"""
    try:
        # 检查 token 是否有效
        client_token = await get_client_token(token)
        
        if not client_token:
            return HTMLResponse("""
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>消息推送服务</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        max-width: 600px;
                        margin: 50px auto;
                        padding: 20px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                    }
                    .container {
                        background: white;
                        border-radius: 16px;
                        padding: 40px;
                        box-shadow: 0 20px 70px rgba(0, 0, 0, 0.25);
                        text-align: center;
                    }
                    h1 { color: #333; margin-bottom: 20px; }
                    .error { color: #ef4444; background: #fee2e2; padding: 20px; border-radius: 8px; }
                    a {
                        display: inline-block;
                        margin-top: 20px;
                        padding: 12px 24px;
                        background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                        color: white;
                        text-decoration: none;
                        border-radius: 8px;
                        font-weight: 600;
                    }
                    a:hover { transform: translateY(-2px); }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>📤 消息推送服务</h1>
                    <div class="error">
                        <h2>无效的 Token</h2>
                        <p>该 token 不存在或已过期</p>
                    </div>
                    <a href="/">打开前端界面</a>
                </div>
            </body>
            </html>
            """, status_code=400)
        
        # 返回消息页面（内容由前端 JavaScript 填充）
        html_content = """
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>消息推送服务</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .container {
                    background: white;
                    border-radius: 16px;
                    padding: 40px;
                    box-shadow: 0 20px 70px rgba(0, 0, 0, 0.25);
                    max-width: 600px;
                    width: 100%;
                }
                h1 { color: #333; margin-bottom: 20px; text-align: center; }
                .info { background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
                .connection-status { text-align: center; padding: 20px; margin: 20px 0; border-radius: 8px; }
                .connected { background: #dcfce7; color: #166534; }
                .disconnected { background: #fee2e2; color: #991b1b; }
                #message-content {
                    background: #f8fafc;
                    padding: 20px;
                    border-radius: 8px;
                    margin: 20px 0;
                    min-height: 100px;
                    white-space: pre-wrap;
                    word-break: break-all;
                }
                .timestamp { color: #64748b; font-size: 14px; text-align: center; margin-top: 10px; }
                a {
                    display: inline-block;
                    margin-top: 20px;
                    padding: 12px 24px;
                    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 8px;
                    font-weight: 600;
                }
                a:hover { transform: translateY(-2px); }
                .btn-group { text-align: center; margin-top: 20px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>📤 消息推送服务</h1>
                <div id="connection-status" class="connection-status disconnected">
                    正在连接 WebSocket...
                </div>
                <div id="message-content">
                    等待接收消息...
                </div>
                <div id="timestamp" class="timestamp"></div>
                <div class="btn-group">
                    <a href="/">打开前端界面</a>
                </div>
            </div>
            <script>
                const token = "{{token}}";
                const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const wsUrl = wsProtocol + '//' + window.location.host + '/stream?token=' + token;
                
                const statusDiv = document.getElementById('connection-status');
                const contentDiv = document.getElementById('message-content');
                const timestampDiv = document.getElementById('timestamp');
                
                function connectWebSocket() {
                    const ws = new WebSocket(wsUrl);
                    
                    ws.onopen = function() {
                        statusDiv.className = 'connection-status connected';
                        statusDiv.textContent = '✓ WebSocket 已连接 - 正在等待消息...';
                        console.log('WebSocket connected');
                    };
                    
                    ws.onmessage = function(event) {
                        try {
                            const data = JSON.parse(event.data);
                            if (data.type === 'message') {
                                contentDiv.textContent = data.message;
                                timestampDiv.textContent = '接收时间: ' + new Date().toLocaleString('zh-CN');
                                
                                statusDiv.className = 'connection-status connected';
                                statusDiv.textContent = '✓ 新消息已接收';
                            }
                        } catch (e) {
                            contentDiv.textContent = event.data;
                            timestampDiv.textContent = '接收时间: ' + new Date().toLocaleString('zh-CN');
                        }
                    };
                    
                    ws.onclose = function() {
                        statusDiv.className = 'connection-status disconnected';
                        statusDiv.textContent = '✗ 连接已断开 - 5秒后重新连接...';
                        console.log('WebSocket disconnected, reconnecting...');
                        setTimeout(connectWebSocket, 5000);
                    };
                    
                    ws.onerror = function(error) {
                        console.error('WebSocket error:', error);
                    };
                }
                
                connectWebSocket();
            </script>
        </body>
        </html>
        """.replace("{{token}}", token)
        
        return HTMLResponse(content=html_content)
    except Exception as e:
        logger.error(f"message_page 错误: {e}")
        error_msg = str(e).replace("{", "{{").replace("}", "}}")
        return HTMLResponse("""
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>错误</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    max-width: 600px;
                    margin: 50px auto;
                    padding: 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                }
                .container {
                    background: white;
                    border-radius: 16px;
                    padding: 40px;
                    box-shadow: 0 20px 70px rgba(0, 0, 0, 0.25);
                    text-align: center;
                }
                h1 { color: #333; margin-bottom: 20px; }
                .error { color: #ef4444; background: #fee2e2; padding: 20px; border-radius: 8px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>服务器错误</h1>
                <div class="error">
                    <p>抱歉，页面加载失败。</p>
                    <p>错误信息: """ + error_msg + """</p>
                </div>
            </div>
        </body>
        </html>
        """, status_code=500)


@app.post("/message")
async def send_message(message: Message, token: str = Query(...)):
    """接收 POST 请求并推送到对应的 WebSocket 客户端"""
    app_token = token

    # 通过 appToken 获取 clientToken
    client_token = await get_client_token(app_token)

    if not client_token:
        raise HTTPException(status_code=400, detail="Invalid app token format")

    # 构造消息
    msg_data = {
        "type": "message",
        "title": message.title,
        "message": message.message,
        "priority": message.priority,
        "timestamp": now_china().isoformat()
    }

    # 检查是否有活跃的连接
    if client_token not in manager.active_connections or not manager.active_connections[client_token]:
        logger.warning(
            f"没有活跃的 WebSocket 连接 for client {client_token}, 消息未发送")
        return JSONResponse(
            status_code=200,
            content={
                "status": "no_connection",
                "message": "信息已发送，但没有活跃的 WebSocket 连接",
                "client_token": client_token,
                "connections": 0
            }
        )

    # 发送到对应的 WebSocket 连接
    await manager.send_message(client_token, msg_data)

    logger.info(f"消息已发送到客户端 {client_token}: {message.title}")

    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "message": "信息已发送",
            "client_token": client_token,
            "connections": len(manager.active_connections.get(client_token, []))
        }
    )


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
    request_start = now_china()
    log_event("INFO", "BINARY", f"📨 HTTP请求开始: {file.filename if file else 'unknown'}", "")
    
    app_token = token

    # 通过 appToken 获取 clientToken
    client_token = await get_client_token(app_token, "send_image")

    if not client_token:
        raise HTTPException(status_code=400, detail="Invalid app token format")

    # 读取图片二进制数据
    read_start = now_china()
    image_data = await file.read()
    read_elapsed = (now_china() - read_start).total_seconds()
    
    filename = file.filename or "image.jpg"
    content_type = file.content_type or "image/jpeg"

    # 添加分割线
    log_event("INFO", "BINARY", "=" * 50, "")
    log_event("INFO", "BINARY", f"📥 收到图片: {filename}, 大小: {format_size(len(image_data))}", "")
    log_event("DEBUG", "BINARY", f"   图片读取耗时: {read_elapsed:.3f}秒, HTTP请求总耗时: {(now_china() - request_start).total_seconds():.3f}秒", "")

    # 生成传输 ID 用于追踪
    transfer_id = f"{now_china().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(8)}"

    # 检查是否有活跃的连接
    if client_token not in manager.active_connections or not manager.active_connections[client_token]:
        log_event("WARNING", "BINARY", f"⚠️ 没有活跃连接, 图片未发送: {filename}", transfer_id)
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

    # 立即返回 HTTP 响应，在后台异步发送 WebSocket 数据
    # 这样可以避免 HTTP 请求超时
    async def send_image_async():
        """后台异步发送图片"""
        try:
            # 不再等待，立即发送
            ws_start = now_china()
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
            elapsed = (now_china() - ws_start).total_seconds()
            log_event("INFO", "BINARY", f"✅ WebSocket发送完成, 耗时: {elapsed:.3f}秒", transfer_id)
        except Exception as e:
            log_event("ERROR", "BINARY", f"异步发送图片失败: {e}", transfer_id)

    # 启动后台任务发送图片
    http_end_time = now_china()
    asyncio.create_task(send_image_async())
    
    http_elapsed = (http_end_time - request_start).total_seconds()
    log_event("DEBUG", "BINARY", f"   HTTP响应返回耗时: {http_elapsed:.3f}秒, 后台任务已启动", transfer_id)

    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "message": "图片已接收并开始发送",
            "client_token": client_token,
            "filename": filename,
            "size": len(image_data),
            "transfer_id": transfer_id,
            "connections": len(manager.active_connections.get(client_token, []))
        }
    )


@app.get("/health")
async def health_check():
    """健康检查"""
    redis_status = "connected"
    try:
        if redis_client:
            await redis_client.ping()
    except:
        redis_status = "disconnected"

    return {
        "status": "healthy",
        "redis": redis_status,
        "active_clients": len(manager.active_connections),
        "total_connections": sum(len(conns) for conns in manager.active_connections.values())
    }


# 添加 token_exists 辅助函数
async def token_exists(client_token: str) -> bool:
    """检查 token 是否存在"""
    if not redis_client:
        return False
    data = await redis_client.get(f"client:{client_token}")
    return data is not None


@app.get("/tokens/{client_token}")
async def get_token_info(client_token: str, request: Request = None):
    """获取 token 信息（调试用）"""
    if not await token_exists(client_token):
        raise HTTPException(status_code=404, detail="Token not found")

    if redis_client:
        data = await redis_client.get(f"client:{client_token}")
        token_data = json.loads(data)
        
        # 如果没有IP信息，尝试更新
        if "ip" not in token_data and request:
            geo_info = await get_geo_info(request)
            token_data["ip"] = geo_info.get("ip", "")
            token_data["location"] = {
                "country": geo_info.get("country", ""),
                "region": geo_info.get("region", ""),
                "city": geo_info.get("city", "")
            }
            # 更新Redis中的数据
            await redis_client.set(f"client:{client_token}", json.dumps(token_data, ensure_ascii=False))
        
        return {
            "client_token": client_token,
            "app_token": token_data["app_token"],
            "created_at": token_data["created_at"],
            "ip": token_data.get("ip", ""),
            "location": token_data.get("location", {}),
            "has_connection": client_token in manager.active_connections
        }


# ==================== 认证 API ====================

@app.post("/api/login")
async def api_login(login_request: LoginRequest):
    """登录API"""
    if login_request.password == ADMIN_PASSWORD:
        session_token = create_session_token()
        # 会话有效期24小时
        active_sessions[session_token] = now_china() + timedelta(hours=24)
        response = JSONResponse(content={"success": True, "message": "登录成功"})
        response.set_cookie(
            key="session_token",
            value=session_token,
            httponly=True,
            max_age=86400,  # 24小时
            samesite="lax"
        )
        logger.info("管理员登录成功")
        return response
    else:
        logger.warning("登录失败：密码错误")
        return JSONResponse(
            status_code=401,
            content={"success": False, "message": "密码错误"}
        )


@app.get("/api/auth/check")
async def api_auth_check(session_token: Optional[str] = Cookie(None)):
    """检查认证状态"""
    if verify_session(session_token):
        return {"authenticated": True}
    raise HTTPException(status_code=401, detail="未授权")


@app.post("/api/logout")
async def api_logout(session_token: Optional[str] = Cookie(None)):
    """登出API"""
    if session_token and session_token in active_sessions:
        del active_sessions[session_token]
    response = JSONResponse(content={"success": True, "message": "已登出"})
    response.delete_cookie("session_token")
    return response


# ==================== Redis 查询 API ====================

@app.get("/api/admin/redis/stats")
async def api_redis_stats(session_token: Optional[str] = Cookie(None)):
    """获取Redis统计信息"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    if not redis_client:
        return {"error": "Redis未连接"}
    
    try:
        # 获取所有键
        all_keys = await redis_client.keys("*")
        client_keys = [k for k in all_keys if k.startswith("client:")]
        app_keys = [k for k in all_keys if k.startswith("app:")]
        
        return {
            "total_keys": len(all_keys),
            "client_keys": len(client_keys),
            "app_keys": len(app_keys),
            "active_connections": sum(len(conns) for conns in manager.active_connections.values())
        }
    except Exception as e:
        logger.error(f"获取Redis统计失败: {e}")
        return {"error": str(e)}


@app.get("/api/admin/redis/all")
async def api_redis_all(session_token: Optional[str] = Cookie(None)):
    """获取所有Redis数据"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    if not redis_client:
        return {"error": "Redis未连接", "data": []}
    
    try:
        keys = await redis_client.keys("*")
        data = []
        for key in keys[:100]:  # 限制最多100条
            value = await redis_client.get(key)
            data.append({"key": key, "value": value})
        return {"data": data, "total": len(keys)}
    except Exception as e:
        logger.error(f"获取Redis数据失败: {e}")
        return {"error": str(e), "data": []}


@app.get("/api/admin/redis/tokens")
async def api_redis_tokens(session_token: Optional[str] = Cookie(None)):
    """获取整合后的 token 列表"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    if not redis_client:
        return {"error": "Redis未连接", "data": []}
    
    try:
        # 获取所有 client:* 键
        client_keys = await redis_client.keys("client:*")
        tokens = []
        
        for key in client_keys:
            client_token = key.replace("client:", "")
            value = await redis_client.get(key)
            token_data = json.loads(value)
            app_token = token_data.get("app_token", "")
            
            # 如果缺少IP信息或IP为空，尝试获取并更新
            current_ip = token_data.get("ip", "")
            if not current_ip or current_ip in ["unknown", "未知", ""]:
                # 不再尝试获取地理位置，直接标记为未知
                token_data["ip"] = "未知"
                token_data["location"] = {
                    "country": "未知",
                    "region": "未知",
                    "city": "未知"
                }
                await redis_client.set(key, json.dumps(token_data, ensure_ascii=False))
            
            tokens.append({
                "app_token": app_token,
                "client_token": client_token,
                "created_at": token_data.get("created_at", ""),
                "ip": token_data.get("ip", ""),
                "location": token_data.get("location", {})
            })
        
        return {"data": tokens, "total": len(tokens)}
    except Exception as e:
        logger.error(f"获取整合Token数据失败: {e}")
        return {"error": str(e), "data": []}


@app.get("/api/admin/redis/keys")
async def api_redis_keys(
    pattern: str = "*",
    session_token: Optional[str] = Cookie(None)
):
    """按模式查询Redis键"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    if not redis_client:
        return {"error": "Redis未连接", "data": []}
    
    try:
        keys = await redis_client.keys(pattern)
        data = []
        for key in keys[:100]:  # 限制最多100条
            value = await redis_client.get(key)
            data.append({"key": key, "value": value})
        return {"data": data, "total": len(keys)}
    except Exception as e:
       logger.error(f"查询Redis失败: {e}")
       return {"error": str(e), "data": []}


@app.post("/api/admin/redis/clear")
async def api_redis_clear(session_token: Optional[str] = Cookie(None)):
    """清空数据库（所有数据）"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    if not redis_client:
        raise HTTPException(status_code=500, detail="Redis未连接")
    
    try:
        await redis_client.flushdb()
        logger.info("数据库已手动清空")
        return {"success": True, "message": "数据库已清空"}
    except Exception as e:
        logger.error(f"清空数据库失败: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== 指纹管理 API ====================

@app.get("/api/fingerprint/list")
async def list_fingerprints(session_token: Optional[str] = Cookie(None)):
    """获取所有已注册的设备指纹"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    if not redis_client:
        return {"error": "Redis未连接", "data": []}
    
    try:
        # 获取所有 fingerprint:* 键
        keys = await redis_client.keys("fingerprint:*")
        fingerprints = []
        
        for key in keys:
            # 跳过黑名单键
            if ":blocked:" in key:
                continue
            
            value = await redis_client.get(key)
            data = json.loads(value)
            fingerprints.append({
                "fingerprint": data.get("fingerprint", ""),
                "created_at": data.get("created_at", ""),
                "last_seen": data.get("last_seen", ""),
                "ip": data.get("ip", ""),
                "location": data.get("location", ""),
                "has_connection": data.get("fingerprint", "") in manager.active_connections
            })
        
        return {"data": fingerprints, "total": len(fingerprints)}
    except Exception as e:
        logger.error(f"获取指纹列表失败: {e}")
        return {"error": str(e), "data": []}


@app.post("/api/fingerprint/block")
async def block_fingerprint(
    fingerprint: str = Query(...),
    reason: str = Query("管理员封禁"),
    session_token: Optional[str] = Cookie(None)
):
    """封禁设备指纹"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    if not redis_client:
        raise HTTPException(status_code=500, detail="Redis未连接")
    
    # 封禁指纹
    await redis_client.set(
        f"fingerprint:blocked:{fingerprint}",
        reason,
        ex=365*24*60*60  # 1年过期
    )
    
    # 关闭该设备的现有连接
    if fingerprint in manager.active_connections:
        for conn in list(manager.active_connections[fingerprint]):
            try:
                await conn.close(code=4001, reason="设备已被封禁")
            except Exception:
                pass
        del manager.active_connections[fingerprint]
    
    logger.info(f"设备已被封禁: {fingerprint[:20]}...")
    
    return {"success": True, "message": "设备已封禁"}


@app.post("/api/fingerprint/unblock")
async def unblock_fingerprint(
    fingerprint: str = Query(...),
    session_token: Optional[str] = Cookie(None)
):
    """解除设备指纹封禁"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    if not redis_client:
        raise HTTPException(status_code=500, detail="Redis未连接")
    
    await redis_client.delete(f"fingerprint:blocked:{fingerprint}")
    
    logger.info(f"设备已解封: {fingerprint[:20]}...")
    
    return {"success": True, "message": "设备已解封"}


# ==================== 日志查看 API ====================

@app.get("/api/admin/logs")
async def get_logs(
    level: str = Query(None),
    category: str = Query(None),
    since: str = Query(None),
    limit: int = Query(100, le=500),
    session_token: Optional[str] = Cookie(None)
):
    """获取日志列表"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    logs = await log_queue.get(level=level, category=category, since=since, limit=limit)
    return {
        "logs": logs,
        "total": len(logs),
        "has_more": len(logs) == limit
    }


@app.get("/api/admin/logs/stats")
async def get_logs_stats(session_token: Optional[str] = Cookie(None)):
    """获取日志统计"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    stats = await log_queue.get_stats()
    return stats


@app.delete("/api/admin/logs")
async def clear_logs(session_token: Optional[str] = Cookie(None)):
    """清空日志"""
    if not verify_session(session_token):
        raise HTTPException(status_code=401, detail="未授权")
    
    await log_queue.clear()
    log_event("INFO", "SYSTEM", "🧹 日志已清空", "")
    return {"success": True, "message": "日志已清空"}
