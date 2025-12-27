#!/bin/bash

# Redis 密码管理脚本
REDIS_PASSWORD_FILE="redis/redis_password.txt"

echo "========================================="
echo "🚀 启动服务..."
echo "========================================="

# 检测 Zeabur 环境变量 (Zeabur 注入的 Redis 连接信息)
if [ -n "$REDIS_URI" ]; then
    echo "✅ [SUCCESS] 使用 Zeabur Redis"
    echo "========================================="
    exec uvicorn main:app --host 0.0.0.0 --port 8080
fi

# 检测本地 Redis 服务 (Zeabur docker-compose 部署)
if [ -n "$REDIS_HOST" ] && [ "$REDIS_HOST" = "redis" ]; then
    echo "✅ [SUCCESS] 使用本地 Redis 服务"
    
    # 检查密码文件
    if [ -f "$REDIS_PASSWORD_FILE" ]; then
        REDIS_PASSWORD=$(cat "$REDIS_PASSWORD_FILE" | tr -d '\n\r')
        echo "📋 Redis 密码已配置"
    else
        echo "⚠️  使用默认 Redis 密码"
    fi
    
    echo "========================================="
    # 等待 Redis 启动
    echo "⏳ 等待 Redis 启动..."
    sleep 5
    
    exec uvicorn main:app --host 0.0.0.0 --port 8080
fi

# 本地开发环境
echo "📦 本地开发环境..."

# 检查密码文件是否存在
if [ -f "$REDIS_PASSWORD_FILE" ]; then
    REDIS_PASSWORD=$(cat "$REDIS_PASSWORD_FILE" | tr -d '\n\r')
    echo "✅ [SUCCESS] 使用现有 Redis 密码"
else
    REDIS_PASSWORD=$(openssl rand -base64 32 | tr -dc A-Za-z0-9 | head -c 32)
    mkdir -p redis
    echo "$REDIS_PASSWORD" > "$REDIS_PASSWORD_FILE"
    echo "✅ [SUCCESS] 已自动生成 Redis 密码"
fi

echo "========================================="
echo "📋 Redis 密码: $REDIS_PASSWORD"
echo "========================================="
echo "⚠️  密码已保存到: $REDIS_PASSWORD_FILE"
echo "========================================="

export REDIS_PASSWORD="$REDIS_PASSWORD"
export REDIS_HOST="localhost"

echo "⏳ 等待 Redis 启动..."
sleep 3

exec uvicorn main:app --host 0.0.0.0 --port 8080
