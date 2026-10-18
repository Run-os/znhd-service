/**
 * 冒烟测试用静态服务器：把「测试页 + 构建产物」暴露在同一源上，避免 CORS。
 *
 *   GET /                 → scripts/smoke/znhd-smoke.html
 *   GET /znhd.user.js     → dist/znhd.user.js（构建产物）
 *   GET /sniff-perf.png   → 嗅探「perf 优先」夹具图（v26.10.14-v2，见下方 makePerfPng）
 *
 * 端口：默认 0（随机，供 run.js 自动选择）；手动调试时可 `PORT=8123 node scripts/smoke/server.js`。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..', '..');
const HARNESS = path.join(__dirname, 'znhd-smoke.html');
const BUNDLE = path.join(ROOT, 'dist', 'znhd.user.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

/**
 * v26.10.14-v2：嗅探「perf 优先」夹具图。
 *
 * 为什么必须是**同源真实加载**的图：performance 资源表只记录浏览器真正发起
 * 并完成的请求，跨域假域名的 <img>（sniff-smoke.test）DNS 就失败、根本不进表。
 * 这张图由本服务器同源提供，浏览器真加载 ⇒ 资源表里有真实 decodedBodySize。
 *
 * 字节数被垫到**精确 22528**（formatBytes 显示 '22 KB'，> 20KB 阈值会出卡片），
 * 且与 GM 桩给它的假 content-length（123456789）完全不同 —— 两者只要对不上，
 * 就证明尺寸走的是资源表而不是 HEAD。
 */
const PERF_PNG_BYTES = 22528;

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** 生成一张精确 PERF_PNG_BYTES 字节的 RGB PNG（实心灰 + tEXt 垫到目标尺寸） */
function makePerfPng() {
  const w = 200;
  const h = 100;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = 0x80;
      raw[row + 2 + x * 3] = 0x80;
      raw[row + 3 + x * 3] = 0x80;
    }
  }
  const base = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  // 垫一个 tEXt 块到目标尺寸：块净增 = 12(头/CRC) + 8('Comment' + \0) + text长度
  const pad = PERF_PNG_BYTES - base.length - 20;
  if (pad < 0) throw new Error('perf png base too big: ' + base.length);
  const text = Buffer.concat([Buffer.from('Comment\0', 'ascii'), Buffer.alloc(pad, 0x20)]);
  const withPad = Buffer.concat([base.slice(0, base.length - 12), pngChunk('tEXt', text), base.slice(base.length - 12)]);
  if (withPad.length !== PERF_PNG_BYTES) throw new Error('perf png size mismatch: ' + withPad.length);
  return withPad;
}

const PERF_PNG = makePerfPng();

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      let file = null;
      if (url === '/' || url === '/smoke.html') file = HARNESS;
      else if (url === '/znhd.user.js') file = BUNDLE;
      else if (url === '/sniff-perf.png') {
        // 同源夹具图：真加载、真进资源表（v26.10.14-v2 嗅探 perf 优先断言用）
        res.writeHead(200, { 'Content-Type': MIME['.png'], 'Content-Length': PERF_PNG.length });
        res.end(PERF_PNG);
        return;
      }

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
