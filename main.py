from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Request, Depends, Cookie
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import redis.asyncio as redis
import base64
import json
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Set, Optional
import logging
import os
import re
import secrets
import hashlib
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import httpx

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
        logger.info(
            f"客户端 {client_token} 已连接. 总连接数: {len(self.active_connections[client_token])}")

    def disconnect(self, client_token: str, websocket: WebSocket):
        if client_token in self.active_connections:
            self.active_connections[client_token].discard(websocket)
            if not self.active_connections[client_token]:
                del self.active_connections[client_token]
        logger.info(f"客户端 {client_token} 已断开连接")

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


manager = ConnectionManager()

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
    if datetime.now() > active_sessions[session_token]:
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
            if redis_client:
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


async def get_ip_geolocation(ip: str) -> dict:
    """获取IP对应的地理位置信息"""
    if ip == "unknown" or ip.startswith("127.") or ip.startswith("::1"):
        return {"country": "本地", "region": "本地", "city": "本地"}
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(f"http://ip-api.com/json/{ip}?lang=zh-CN")
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "success":
                    return {
                        "country": data.get("country", ""),
                        "region": data.get("regionName", ""),
                        "city": data.get("city", "")
                    }
    except Exception as e:
        logger.error(f"获取IP地理位置失败: {e}")
    
    return {"country": "未知", "region": "未知", "city": "未知"}


async def get_geo_info(request: Request) -> dict:
    """获取客户端IP和地理位置信息"""
    ip = get_client_ip(request)
    geo = await get_ip_geolocation(ip)
    return {"ip": ip, **geo}


# 根据clientToken创建appToken并存储到Redis
async def create_token_pair(client_token: str, geo_info: dict = None) -> str:
    """创建 clientToken 和对应的 appToken"""
    # appToken 为 clientToken 的 base64 编码
    app_token = base64.b64encode(client_token.encode()).decode()

    # 存储到 Redis
    if redis_client:
        token_data = {
            "app_token": app_token,
            "created_at": datetime.now().isoformat()
        }
        
        # 如果提供了地理位置信息，添加到数据中
        if geo_info:
            token_data["ip"] = geo_info.get("ip", "")
            token_data["location"] = {
                "country": geo_info.get("country", ""),
                "region": geo_info.get("region", ""),
                "city": geo_info.get("city", "")
            }
        
        await redis_client.set(f"client:{client_token}", json.dumps(token_data, ensure_ascii=False))
        await redis_client.set(f"app:{app_token}", client_token)
        logger.info(
            f"已创建 token 对 - client: {client_token}, app: {app_token}, IP: {geo_info.get('ip') if geo_info else 'unknown'}")

    return app_token


async def get_client_token(app_token: str) -> str:
    """通过 appToken 获取 clientToken"""
    if redis_client:
        client_token = await redis_client.get(f"app:{app_token}")
        if client_token:
            return client_token
    return None


async def token_exists(client_token: str) -> bool:
    """检查 clientToken 是否存在"""
    if redis_client:
        exists = await redis_client.exists(f"client:{client_token}")
        return bool(exists)
    return False


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
    """WebSocket 连接端点"""
    client_token = token

    # 检查 token 是否存在，不存在则创建
    if not await token_exists(client_token):
        # 获取IP和地理位置信息
        geo_info = None
        try:
            # 直接从 WebSocket 获取客户端 IP
            client_host = websocket.client.host if websocket.client else "unknown"
            geo_info = {
                "ip": client_host,
                "country": "查询中...",
                "region": "查询中...",
                "city": "查询中..."
            }
            # 异步查询地理位置
            geo_info = await get_ip_geolocation(client_host)
            geo_info["ip"] = client_host
        except Exception as e:
            logger.error(f"获取IP地理位置失败: {e}")
            geo_info = {"ip": "unknown", "country": "未知", "region": "未知", "city": "未知"}
        
        app_token = await create_token_pair(client_token, geo_info)
        logger.info(
            f"新的 client token 已创建: {client_token}, app token: {app_token}, IP: {geo_info.get('ip') if geo_info else 'unknown'}")

    await manager.connect(client_token, websocket)

    try:
        # 保持连接
        while True:
            data = await websocket.receive_text()
            # 可以处理客户端发送的消息（心跳等）
            logger.info(f"已接收来自 {client_token} 的消息: {data}")

    except WebSocketDisconnect:
        manager.disconnect(client_token, websocket)
        logger.info(f"客户端 {client_token} 已断开连接")
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
        "timestamp": datetime.now().isoformat()
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
        active_sessions[session_token] = datetime.now() + timedelta(hours=24)
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
                geo_info = await get_ip_geolocation("unknown")
                token_data["ip"] = "未知"
                token_data["location"] = {
                    "country": geo_info.get("country", "未知"),
                    "region": geo_info.get("region", "未知"),
                    "city": geo_info.get("city", "未知")
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
