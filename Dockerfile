FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制应用代码
COPY main.py .

# 复制静态文件和模板
COPY static/ ./static/
COPY templates/ ./templates/

# 确保redis目录存在并复制内容
RUN mkdir -p redis && \
    cp redis/redis_password.txt redis/ 2>/dev/null || echo "👾 没有找到redis密码文件，将在启动时自动生成"

# 复制启动脚本
COPY start.sh .
RUN chmod +x start.sh

# 暴露端口
EXPOSE 8080

# 启动应用
CMD ["./start.sh"]
