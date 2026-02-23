# 局域网P2P传输工具 - 信令服务器 Docker 镜像

# 替换为国内镜像源（如阿里云）
FROM swr.cn-north-4.myhuaweicloud.com/ddn-k8s/docker.io/node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json（如果存在）
COPY package.json* ./

# 安装依赖
RUN npm install --production --no-audit --no-fund

# 复制服务器代码
COPY server.js ./

# 复制静态文件
COPY public ./public

# 暴露端口
EXPOSE 3000

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 启动服务器
CMD ["node", "server.js"]
