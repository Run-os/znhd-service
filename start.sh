#!/bin/bash

# Redis 密码管理脚本
REDIS_PASSWORD_FILE="redis/redis_password.txt"

echo "========================================="
echo "🚀 启动服务..."
echo "========================================="

# 检查 Zeabur Redis URI (Zeabur 注入的格式通常是 redis://:password@host:port)
if [ -n "$REDIS_URI" ]; then
    echo "✅ [SUCCESS] 使用 Zeabur Redis"
    echo "REDIS_URI: $REDIS_URI"
    echo "========================================="
    # Zeabur 环境不需要等待本地 Redis
    # 启动应用
    exec uvicorn main:app --host 0.0.0.0 --port 8080
fi

# 检查 Zeabur 其他可能的 Redis 变量格式
if [ -n "$REDIS_HOST" ] && [ "$REDIS_HOST" != "redis" ]; then
    echo "✅ [SUCCESS] 使用 Zeabur Redis (HOST: $REDIS_HOST)"
    echo "========================================="
    exec uvicorn main:app --host 0.0.0.0 --port 8080
fi

# 本地/Docker 环境
echo "📦 本地/Docker 环境初始化..."

# 检查密码文件是否存在
if [ -f "$REDIS_PASSWORD_FILE" ]; then
    # 读取现有密码
    REDIS_PASSWORD=$(cat "$REDIS_PASSWORD_FILE" | tr -d '\n\r')
    echo "✅ [SUCCESS] 使用现有 Redis 密码"
else
    # 生成随机密码 (32位)
    REDIS_PASSWORD=$(openssl rand -base64 32 | tr -dc A-Za-z0-9 | head -c 32)
    
    # 确保目录存在
    mkdir -p redis
    
    # 保存密码
    echo "$REDIS_PASSWORD" > "$REDIS_PASSWORD_FILE"
    echo "✅ [SUCCESS] 已自动生成 Redis 密码"
fi

echo "========================================="
echo "📋 Redis 密码: $REDIS_PASSWORD"
echo "========================================="
echo "⚠️  密码已保存到: $REDIS_PASSWORD_FILE"
echo "⚠️  请妥善保管此密码！"
echo "========================================="

# 导出密码环境变量供Python使用
export REDIS_PASSWORD="$REDIS_PASSWORD"
export REDIS_HOST="redis"

# 等待Redis启动
echo "⏳ 等待 Redis 启动..."
sleep 5

# 启动应用
exec uvicorn main:app --host 0.0.0.0 --port 8080
