// 征纳互动 · 手机图片 → 电脑剪贴板 中继服务器
// 纯 Node 内置模块实现，无需 npm install。
// 运行： node server.js        （可选 PORT 环境变量，默认 3000）
//
// 工作流程：
//   1) 电脑端脚本生成稳定 deviceId，拼出上传链接  http(s)://<本服务>/u/<deviceId>
//   2) 手机浏览器打开该链接 → 选图（前端 canvas 压缩）→ POST JSON 到同一路径
//   3) 服务器把图片按 deviceId 暂存（TTL 内）
//   4) 电脑端脚本用 GM_xmlhttpRequest 长轮询 /recv/<deviceId> 取走图片 → 写剪贴板
//
// 说明：电脑端使用长轮询而非 WebSocket，是为了绕过征纳互动页面的 CSP 对 connect-src 的限制
//       （GM_xmlhttpRequest 不受页面 CSP 约束）。手机端页面由本服务同源托管，也无 CORS 问题。

const http = require('http');
const PORT = process.env.PORT || 3000;

const PENDING_TTL = 60 * 1000;      // 暂存有效期 60s（手机先传、电脑后开也来得及）
const MAX_BODY = 12 * 1024 * 1024; // 单图体积上限 12MB
const UUID_RE = /^[a-z0-9-]{8,64}$/i;

// deviceId -> { name, mime, data(base64), ts }
const pending = new Map();

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  setCors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ===================== 手机上传页（内联，同源托管） =====================
function uploadPageHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>上传图片到电脑</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;margin:0;padding:16px;background:#f5f5f5;color:#222}
  h2{font-size:18px;margin:0 0 4px}
  .tip{color:#888;font-size:13px;margin:0 0 16px;line-height:1.6}
  #pick{display:block;width:100%;box-sizing:border-box;padding:16px;border:2px dashed #bbb;border-radius:10px;text-align:center;color:#555;background:#fff;font-size:15px;margin-bottom:12px}
  #preview{width:100%;border-radius:10px;display:none;margin-bottom:12px;background:#fff}
  #info{font-size:13px;color:#666;margin-bottom:12px;word-break:break-all;min-height:18px}
  button.act{width:100%;box-sizing:border-box;padding:14px;border:0;border-radius:10px;background:#007e44;color:#fff;font-size:16px;font-weight:bold}
  button.act:disabled{background:#bbb}
  .status{margin-top:12px;font-size:13px;color:#007e44;text-align:center;line-height:1.6}
  .err{color:#e4393c}
</style>
</head>
<body>
  <h2>📷 上传图片到电脑</h2>
  <p class="tip">选择或拍摄一张图片，将自动压缩后发送到你的电脑剪贴板。</p>
  <label id="pick">点击选择图片 / 拍照</label>
  <input id="file" type="file" accept="image/*" capture="environment" style="display:none">
  <img id="preview" alt="">
  <div id="info"></div>
  <button id="send" class="act" disabled>发送到电脑</button>
  <div id="status" class="status"></div>

<script>
(function(){
  var MAX_DIM = 1600, QUALITY = 0.75;
  var fileInput = document.getElementById('file');
  var preview = document.getElementById('preview');
  var info = document.getElementById('info');
  var sendBtn = document.getElementById('send');
  var statusEl = document.getElementById('status');
  var lastBlob = null, lastName = 'image.jpg', lastMime = 'image/jpeg';

  fileInput.addEventListener('change', function(e){
    var f = e.target.files && e.target.files[0];
    if(!f){ return; }
    lastName = f.name || 'image.jpg';
    statusEl.className = 'status'; statusEl.textContent = '';
    var reader = new FileReader();
    reader.onload = function(){
      var img = new Image();
      img.onload = function(){
        var w = img.width, h = img.height;
        var scale = Math.min(1, MAX_DIM / Math.max(w, h));
        var cw = Math.round(w*scale), ch = Math.round(h*scale);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, cw, ch);
        canvas.toBlob(function(blob){
          lastBlob = blob; lastMime = blob.type || 'image/jpeg';
          preview.src = URL.createObjectURL(blob);
          preview.style.display = 'block';
          info.textContent = '尺寸 ' + cw + '×' + ch + '，约 ' + (blob.size/1024).toFixed(0) + ' KB';
          sendBtn.disabled = false;
        }, 'image/jpeg', QUALITY);
      };
      img.onerror = function(){ statusEl.className = 'status err'; statusEl.textContent = '图片解析失败'; };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  });

  document.getElementById('pick').addEventListener('click', function(){ fileInput.click(); });

  sendBtn.addEventListener('click', function(){
    if(!lastBlob){ return; }
    sendBtn.disabled = true;
    statusEl.className = 'status'; statusEl.textContent = '发送中…';
    var fr = new FileReader();
    fr.onload = function(){
      var b64 = fr.result.split(',')[1];
      fetch(window.location.pathname, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: lastName, mime: lastMime, data: b64 })
      }).then(function(r){ return r.json(); }).then(function(j){
        if(j && j.ok){
          statusEl.textContent = '✅ 已发送到电脑，请在电脑端点击“复制到剪贴板”';
          sendBtn.textContent = '再发一张'; sendBtn.disabled = false;
        } else {
          statusEl.className = 'status err';
          statusEl.textContent = '发送失败：' + ((j && j.error) || '未知错误');
          sendBtn.disabled = false;
        }
      }).catch(function(err){
        statusEl.className = 'status err';
        statusEl.textContent = '发送失败：' + err.message;
        sendBtn.disabled = false;
      });
    };
    fr.readAsDataURL(lastBlob);
  });
})();
</script>
</body>
</html>`;
}

// ===================== 路由 =====================
const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const u = new URL(req.url, 'http://localhost');
    const path = u.pathname;
    const method = req.method;

    if (method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>征纳互动 · 图片中继服务</h2><p>手机请打开脚本面板「手机传图」提供的上传链接。</p>');
      return;
    }
    if (method === 'GET' && path === '/health') { sendJson(res, 200, { ok: true }); return; }

    // 二维码改由电脑端脚本用 qrcodejs 客户端生成，本服务不再提供 /qr 端点。

    // /u/<deviceId> ：手机上传页 + 接收上传
    const m = /^\/u\/([a-z0-9-]{8,64})$/i.exec(path);
    if (m) {
      const uuid = m[1];
      if (method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(uploadPageHtml());
        return;
      }
      if (method === 'POST') {
        const buf = await readBody(req);
        let payload;
        try { payload = JSON.parse(buf.toString('utf8')); }
        catch (e) { sendJson(res, 400, { error: 'invalid json' }); return; }
        if (!payload || typeof payload.data !== 'string') { sendJson(res, 400, { error: 'missing data' }); return; }
        pending.set(uuid, {
          name: String(payload.name || 'image.jpg').slice(0, 200),
          mime: String(payload.mime || 'image/jpeg').slice(0, 100),
          data: payload.data.slice(0, MAX_BODY),
          ts: Date.now()
        });
        sendJson(res, 200, { ok: true });
        return;
      }
      res.writeHead(405); res.end(); return;
    }

    // /recv/<deviceId> ：电脑端长轮询取图
    const r = /^\/recv\/([a-z0-9-]{8,64})$/i.exec(path);
    if (r && method === 'GET') {
      const uuid = r[1];
      let maxwait = parseInt(u.searchParams.get('maxwait') || '', 10);
      if (!Number.isFinite(maxwait)) maxwait = 25000;
      maxwait = Math.min(Math.max(maxwait, 1000), 30000);
      const start = Date.now();
      const tick = () => {
        const p = pending.get(uuid);
        if (p && (Date.now() - p.ts) < PENDING_TTL) {
          pending.delete(uuid);
          sendJson(res, 200, { name: p.name, mime: p.mime, data: p.data });
          return;
        }
        if (Date.now() - start > maxwait) {
          sendJson(res, 200, { empty: true });
          return;
        }
        setTimeout(tick, 400);
      };
      tick();
      return;
    }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    if (!res.headersSent) res.writeHead(500);
    res.end('server error: ' + e.message);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[中继服务] 已启动: http://0.0.0.0:' + PORT);
});
