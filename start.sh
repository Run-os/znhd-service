#!/bin/bash

echo "========================================="
echo "🚀 启动服务..."
echo "========================================="

# Zeabur 会自动注入 REDIS_URI 环境变量
if [ -n "$REDIS_URI" ]; then
    echo "✅ [SUCCESS] 使用 Zeabur Redis"
else
    echo "⚠️  未检测到 Redis，请确保 Zeabur Redis Addon 已配置"
fi

echo "========================================="

exec uvicorn main:app --host 0.0.0.0 --port 8080
