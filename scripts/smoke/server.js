/**
 * 冒烟测试用静态服务器：把「测试页 + 构建产物」暴露在同一源上，避免 CORS。
 *
 *   GET /                 → scripts/smoke/znhd-smoke.html
 *   GET /znhd.user.js     → dist/znhd.user.js（构建产物）
 *
 * 端口：默认 0（随机，供 run.js 自动选择）；手动调试时可 `PORT=8123 node scripts/smoke/server.js`。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HARNESS = path.join(__dirname, 'znhd-smoke.html');
const BUNDLE = path.join(ROOT, 'dist', 'znhd.user.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = null;
      if (url === '/' || url === '/smoke.html') file = HARNESS;
      else if (url === '/znhd.user.js') file = BUNDLE;

      if (!file) {
        res.writeHead(404);
        res.end('not found: ' + url);
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('not found: ' + url);
          return;
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    const port = Number(process.env.PORT || 0);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (require.main === module) {
  startServer().then((server) => {
    console.log(`冒烟服务器: http://127.0.0.1:${server.address().port}/`);
  });
}

module.exports = { startServer, BUNDLE };
