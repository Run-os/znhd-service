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

# 复制redis配置目录
COPY redis/ ./redis/

# 复制启动脚本
COPY start.sh .
RUN chmod +x start.sh

# 暴露端口
EXPOSE 8080

# 启动应用
CMD ["./start.sh"]
