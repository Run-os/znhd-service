// 本地HTTP/Socket服务，用于中转P2P传输数据
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
// 可通过环境变量配置端口，默认3000
const port = process.env.PORT || 3000;

// 配置CORS跨域（生产环境建议限制具体域名）
app.use(cors({
    origin: '*', // 生产环境改为油猴脚本运行的域名，如 "https://*"
    methods: ["GET", "POST"]
}));
app.use(express.static('public'));

// 创建HTTP服务器
const server = http.createServer(app);

// 创建Socket.IO服务器（增加跨域配置）
const io = new Server(server, {
    cors: {
        origin: "*", // 生产环境限制为具体域名
        methods: ["GET", "POST"],
        credentials: true
    },
    // 增加传输方式，确保兼容性
    transports: ['websocket', 'polling']
});

// 存储连接的客户端
let connectedClients = [];

// 监听Socket连接
io.on('connection', (socket) => {
    console.log('客户端已连接：', socket.id);
    connectedClients.push(socket.id);

    // 转发文本消息
    socket.on('sendText', (text) => {
        console.log('收到文本：', text);
        // 广播给所有客户端（包括发送方，可根据需求调整）
        io.emit('receiveText', text);
    });

    // 转发文件数据
    socket.on('sendFile', (fileData) => {
        console.log('收到文件：', fileData.name);
        // 广播给所有客户端
        io.emit('receiveFile', fileData);
    });

    // 监听断开连接
    socket.on('disconnect', () => {
        console.log('客户端已断开：', socket.id);
        connectedClients = connectedClients.filter(id => id !== socket.id);
    });
});

// 提供简单的网页界面（供扫码端访问）
app.get('/', (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>P2P传输工具</title>
          <style>
              body { font-family: Arial, sans-serif; max-width: 500px; margin: 20px auto; padding: 20px; }
              .container { text-align: center; }
              button { padding: 10px 20px; margin: 10px; cursor: pointer; }
              #fileInput { display: none; }
          </style>
      </head>
      <body>
          <div class="container">
              <h1>P2P文件/文本传输</h1>
              <button onclick="sendText()">发送文本</button>
              <button onclick="document.getElementById('fileInput').click()">发送文件</button>
              <input type="file" id="fileInput" onchange="sendFile(this)">
          </div>

          <script src="/socket.io/socket.io.js"></script>
          <script>
              // 连接云服务器的Socket服务
              const socket = io('http://${req.headers.host}');
              
              // 发送文本
              function sendText() {
                  const text = prompt('请输入要发送的文本：');
                  if (text) {
                      socket.emit('sendText', text);
                      alert('文本发送成功');
                  }
              }

              // 发送文件
              function sendFile(input) {
                  const file = input.files[0];
                  if (file) {
                      const reader = new FileReader();
                      reader.onload = (e) => {
                          socket.emit('sendFile', {
                              name: file.name,
                              type: file.type,
                              content: e.target.result
                          });
                          alert(\`文件 \${file.name} 发送成功\`);
                          input.value = '';
                      };
                      reader.readAsArrayBuffer(file);
                  }
              }

              // 接收文本
              socket.on('receiveText', (text) => {
                  alert(\`收到文本：\\n\${text}\`);
              });

              // 接收文件
              socket.on('receiveFile', (fileData) => {
                  const blob = new Blob([fileData.content], { type: fileData.type });
                  const a = document.createElement('a');
                  a.href = URL.createObjectURL(blob);
                  a.download = fileData.name;
                  a.click();
                  URL.revokeObjectURL(a.href);
                  alert(\`收到文件：\${fileData.name}\`);
              });
          </script>
      </body>
      </html>
  `);
});

// 监听所有网卡地址（公网可访问）
server.listen(port, '0.0.0.0', () => {
    console.log(`公网传输服务已启动：http://0.0.0.0:${port}`);
    console.log(`公网访问地址：http://[你的服务器公网IP]:${port}`);
});