// 征纳互动 · 手机图片 → 电脑剪贴板 中继服务器
// 纯 Node 内置模块实现，无需 npm install。
// 运行： node server.js        （可选 PORT 环境变量，默认 5689）
//
// 工作流程（双向）：
//   正向（手机 → 电脑）：
//   1) 电脑端脚本生成稳定 deviceId，拼出上传链接  http(s)://<本服务>/u/<deviceId>
//   2) 手机浏览器打开该链接 → 选图（前端 canvas 压缩）/输入文本 → POST JSON 到同一路径
//   3) 服务器把图片或文本按 deviceId 暂存（TTL 内）
//   4) 电脑端脚本用 GM_xmlhttpRequest 长轮询 /recv/<deviceId> 取走条目（type 区分 image/text）→ 弹窗预览/复制
//
//   反向（电脑 → 手机）：
//   1) 手机打开 /u/<deviceId> 后，周期性 POST /phone/heartbeat/<deviceId> 报活（声明在线）
//   2) 电脑端「发送到手机」前先 GET /phone/status/<deviceId> 判断手机是否在线
//   3) 电脑端 POST /phone/send/<deviceId>（图片 {data,mime,name} 或文本 {text}）
//   4) 手机端长轮询 /phone/recv/<deviceId> 取走条目 → 全屏看图/复制文本
//
// 说明：电脑端使用长轮询而非 WebSocket，是为了绕过征纳互动页面的 CSP 对 connect-src 的限制
//       （GM_xmlhttpRequest 不受页面 CSP 约束）。手机端页面由本服务同源托管，也无 CORS 问题。

const http = require('http');
const PORT = process.env.PORT || 5689;
// 版本号唯一来源：package.json 的 version（格式 YY.M.D-vN，规范同 znhd.user.js）
const VERSION = (() => { try { return require('./package.json').version; } catch (e) { return 'unknown'; } })();

const PENDING_TTL = 60 * 1000;      // 暂存有效期 60s（手机先传、电脑后开也来得及）
const MAX_BODY = 12 * 1024 * 1024; // 单图体积上限 12MB
const UUID_RE = /^[a-z0-9-]{8,64}$/i;

// deviceId -> Array<{ type, name?, mime?, data?, text?, ts }> 待电脑端取走的条目队列（FIFO）
// 队列化以支持手机端一次多选发送多张图（旧实现是单槽，连发会互相覆盖丢图）
const MAX_QUEUE = 100; // 每设备最多暂存条目数（内存保护上限；手机端选图张数已不限制），超出丢弃最旧
const pending = new Map();
// deviceId -> Set<res> 当前正在等待长轮询的电脑端连接（用于「广播」：一张图同时发给所有在等的接收端）
const waiting = new Map();

// ===== 反向通道：电脑端 → 手机端 =====
const PHONE_TTL = 20 * 1000;       // 手机在线判定：超过该时长无心跳视为离线（心跳 8s 一次）
// deviceId -> lastSeen(ms) 手机最近一次心跳时间
const phoneOnline = new Map();
// deviceId -> Array<{ type:'image'|'text', text?, name?, mime?, data?, ts }> 电脑发来、待手机取的条目队列（FIFO）
// 队列化以支持电脑端多选图片连发（旧实现是单槽，连发会互相覆盖丢图）
const phonePending = new Map();
// deviceId -> Set<res> 当前正在长轮询收件的手机连接
const phoneWaiting = new Map();

// ===== 运行日志（每条前面带「精确到秒」的时间戳） =====
function tsNow() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} `;
}
function logEvent(msg) {
  console.log(tsNow() + msg);
}
// 估算 base64 图片体积（KB）
function b64SizeKB(b64) {
  const len = b64 ? b64.length : 0;
  const pad = b64 && b64.endsWith('==') ? 2 : (b64 && b64.endsWith('=') ? 1 : 0);
  const bytes = Math.max(0, Math.floor(len * 3 / 4) - pad);
  return Math.round(bytes / 1024);
}
// 文本预览：截前 40 字、合并空白、过长加省略号
function previewText(t) {
  const s = String(t || '').replace(/\s+/g, ' ');
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}
// 曾经在线过的手机设备集合，用于「离线」只告警一次
const phoneWasOnline = new Set();

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

// 把某 deviceId 当前暂存的条目（图片或文本）「广播」给所有正在等待的电脑端连接（每个连接各得一份拷贝）。
// 这样即使同一设备 ID 在多个标签页/浏览器同时长轮询，每个接收端都能拿到，不再出现抢唯一图槽的竞态。
// 若当前无人在等：保留 pending（不删），等下一个连上的轮询来取，绝不会漏。
// 直接回传整条 item（含 type: 'image' | 'text'），由电脑端按 type 分流处理。
function deliverToAll(uuid) {
  const q = pending.get(uuid);
  if (!q || q.length === 0) { pending.delete(uuid); return; }
  // 丢弃队头已过期的条目
  while (q.length && (Date.now() - q[0].ts) >= PENDING_TTL) q.shift();
  if (q.length === 0) { pending.delete(uuid); return; }
  const set = waiting.get(uuid);
  if (!set || set.size === 0) return; // 当前无等待连接：保留队列，等下个连接
  // 每次只投递队头一条（长轮询协议每个响应回一条）；电脑端收到后会立刻重新轮询取下一条
  const p = q.shift();
  if (q.length === 0) pending.delete(uuid);
  const targets = Array.from(set);
  waiting.delete(uuid);
  for (const r of targets) {
    try { sendJson(r, 200, p); } // 回传整条（含 type），图片为 {type,name,mime,data}，文本为 {type,text}
    catch (e) { /* 已断开的连接，忽略 */ }
  }
  logEvent(`[投递] 设备 ${uuid} 已向 ${targets.length} 个电脑端接收端投递条目（${p.type}）${q.length ? `，队列剩余 ${q.length} 条` : ''}`);
}

// 把某 deviceId 电脑发来的条目「广播」给所有正在等待的手机连接（每个连接各得一份拷贝）。
// 与 deliverToAll 对称，作用于反向通道的 phonePending/phoneWaiting。
// 若当前无手机在等：保留 phonePending（不删），等下一个连上的轮询来取，绝不会漏。
function deliverToPhone(uuid) {
  const q = phonePending.get(uuid);
  if (!q || q.length === 0) { phonePending.delete(uuid); return; }
  // 丢弃队头已过期的条目
  while (q.length && (Date.now() - q[0].ts) >= PENDING_TTL) q.shift();
  if (q.length === 0) { phonePending.delete(uuid); return; }
  const set = phoneWaiting.get(uuid);
  if (!set || set.size === 0) return; // 当前无等待连接：保留队列，等下个连接
  // 每次只投递队头一条（长轮询协议每个响应回一条）；手机端收到后会立刻重新轮询取下一条
  const p = q.shift();
  if (q.length === 0) phonePending.delete(uuid);
  const targets = Array.from(set);
  phoneWaiting.delete(uuid);
  for (const r of targets) {
    try { sendJson(r, 200, p); }
    catch (e) { /* 已断开的连接，忽略 */ }
  }
  logEvent(`[投递] 设备 ${uuid} 已向 ${targets.length} 个手机端接收端投递条目（${p.type}）${q.length ? `，队列剩余 ${q.length} 条` : ''}`);
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
<title>上传到电脑</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;margin:0;padding:16px;background:#f5f5f5;color:#222}
  h2{font-size:18px;margin:0 0 4px}
  .tip{color:#888;font-size:13px;margin:0 0 16px;line-height:1.6}
  #pick{display:block;width:100%;box-sizing:border-box;padding:16px;border:2px dashed #bbb;border-radius:10px;text-align:center;color:#555;background:#fff;font-size:15px;margin-bottom:12px}
  #grid{display:none;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px}
  #grid .cell{position:relative;padding-top:100%;border-radius:8px;overflow:hidden;background:#fff}
  #grid .cell img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
  #grid .cell .del{position:absolute;top:2px;right:2px;width:22px;height:22px;line-height:20px;text-align:center;font-size:16px;color:#fff;background:rgba(0,0,0,0.55);border-radius:50%;cursor:pointer}
  /* 来自电脑的图片：以弹窗方式查看（与脚本端弹出画廊一致），不再贴在网页底部 */
  #recvPopup{position:fixed;left:0;right:0;top:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9998;display:none;flex-direction:column;padding:14px;box-sizing:border-box}
  #recvPopup.show{display:flex}
  #recvPopup .rh{display:flex;align-items:center;justify-content:space-between;color:#fff;margin:2px 2px 10px}
  #recvPopup .rh .t{font-size:15px;font-weight:bold}
  #recvPopup .rh .close{width:34px;height:34px;line-height:32px;text-align:center;font-size:24px;color:#fff;background:rgba(255,255,255,0.2);border-radius:50%;cursor:pointer;flex:0 0 auto}
  #recvGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;flex:1;min-height:0;overflow:auto;align-content:start}
  #recvGrid .cell{position:relative;padding-top:100%;border-radius:8px;overflow:hidden;background:#fff;cursor:pointer}
  #recvGrid .cell img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}
  #recvGrid .cell .idx{position:absolute;right:4px;bottom:4px;font-size:11px;color:#fff;background:rgba(0,0,0,0.5);border-radius:8px;padding:0 5px;line-height:16px;pointer-events:none}
  #recvBtn{display:none;width:100%;box-sizing:border-box;padding:12px;border:0;border-radius:10px;background:#e6f3ec;color:#007e44;font-size:15px;font-weight:bold;margin-bottom:12px}
  #recvBtn.show{display:block}
  #info{font-size:13px;color:#666;margin-bottom:12px;word-break:break-all;min-height:18px}
  button.act{width:100%;box-sizing:border-box;padding:14px;border:0;border-radius:10px;background:#007e44;color:#fff;font-size:16px;font-weight:bold}
  button.act:disabled{background:#bbb}
  .sep{color:#bbb;font-size:13px;text-align:center;margin:16px 0 8px}
  #txt{width:100%;box-sizing:border-box;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:15px;line-height:1.5;resize:vertical;margin-bottom:12px;font-family:inherit;background:#fff;color:#222}
  .status{margin-top:12px;font-size:13px;color:#007e44;text-align:center;line-height:1.6}
  .err{color:#e4393c}
  .conn{font-size:12px;color:#007e44;text-align:center;margin:4px 0 2px}
  .conn.off{color:#e4393c}
  .devid{font-size:11px;color:#999;text-align:center;margin:0 0 8px;word-break:break-all}
  /* 来自电脑的收件弹层 */
  .recv{position:fixed;left:0;right:0;top:0;bottom:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
  .recv img{max-width:100%;max-height:72vh;border-radius:8px;background:#fff}
  .recvtip{color:#fff;font-size:13px;margin-top:10px}
  .recv pre{background:#fff;color:#222;padding:14px;border-radius:10px;max-width:92vw;max-height:60vh;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.6;margin:0;font-family:inherit}
  .recv .act{width:auto;padding:8px 18px;margin-top:12px}
  .recvclose{position:absolute;top:12px;right:14px;width:34px;height:34px;line-height:32px;text-align:center;font-size:24px;color:#fff;background:rgba(255,255,255,0.2);border-radius:50%;cursor:pointer}
</style>
</head>
<body>
  <h2>📷 上传到电脑</h2>
  <p class="tip">选择/拍摄图片自动压缩后发送，或直接输入文本发送到电脑剪贴板。</p>
  <div id="conn" class="conn">正在连接…</div>
  <div id="devid" class="devid"></div>
  <label id="pick">点击选择图片 / 拍照（可多选）</label>
  <input id="file" type="file" accept="image/*" multiple style="display:none">
  <div id="grid"></div>
  <div id="info"></div>
  <button id="send" class="act" disabled>发送图片到电脑</button>
  <div class="sep">— 或发送文本 —</div>
  <textarea id="txt" placeholder="输入要发送到电脑的文本…" rows="4"></textarea>
  <button id="sendText" class="act">发送文本到电脑</button>
  <div id="status" class="status"></div>
  <div class="sep">— 来自电脑 —</div>
  <p class="tip">电脑端「发送到手机」的图片会以弹窗形式自动弹出（与脚本端一致），点击缩略图可放大、长按可保存；文本仍自动弹出。</p>
  <button id="recvBtn">查看收到的图片</button>
  <div id="recvPopup">
    <div class="rh"><span class="t">收到的图片</span><span class="close">×</span></div>
    <div id="recvGrid"></div>
  </div>

<script>
(function(){
  var MAX_DIM = 1600, QUALITY = 0.75;
  var fileInput = document.getElementById('file');
  var grid = document.getElementById('grid');
  var info = document.getElementById('info');
  var sendBtn = document.getElementById('send');
  var statusEl = document.getElementById('status');
  // 待发送图片列表：{ blob, name, mime, url }
  var items = [];
  // 来自电脑的图片（九宫格画廊）：{ url, mime }
  var recvItems = [];
  var recvGrid = document.getElementById('recvGrid');
  var recvPopup = document.getElementById('recvPopup');
  var recvBtn = document.getElementById('recvBtn');

  function renderGrid(){
    grid.innerHTML = '';
    grid.style.display = items.length ? 'grid' : 'none';
    items.forEach(function(it, idx){
      var cell = document.createElement('div');
      cell.className = 'cell';
      var img = document.createElement('img');
      img.src = it.url;
      cell.appendChild(img);
      var del = document.createElement('div');
      del.className = 'del';
      del.textContent = '×';
      del.onclick = function(){
        URL.revokeObjectURL(it.url);
        items.splice(idx, 1);
        renderGrid();
      };
      cell.appendChild(del);
      grid.appendChild(cell);
    });
    var totalKB = 0;
    items.forEach(function(it){ totalKB += it.blob.size / 1024; });
    info.textContent = items.length
      ? ('已选 ' + items.length + ' 张，共约 ' + totalKB.toFixed(0) + ' KB')
      : '';
    sendBtn.disabled = items.length === 0;
    sendBtn.textContent = items.length > 1 ? ('发送 ' + items.length + ' 张图片到电脑') : '发送图片到电脑';
  }

  // 压缩单个文件为 blob（canvas 缩放 + JPEG 压缩）
  // SVG 例外：canvas 无法可靠光栅化 SVG（无固有尺寸时画布为 0、部分 WebView 直接 onerror），
  // 且压成 JPEG 会丢失矢量特性——故 SVG 跳过压缩，原样直传（修正 mime 为 image/svg+xml）。
  function compressFile(f, done, fail){
    var isSvg = (f.type === 'image/svg+xml') || /\\.svg$/i.test(f.name || '');
    if(isSvg){
      var svgBlob = (f.type === 'image/svg+xml') ? f : f.slice(0, f.size, 'image/svg+xml');
      done(svgBlob);
      return;
    }
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
          if(blob){ done(blob); } else { fail(new Error('压缩失败')); }
        }, 'image/jpeg', QUALITY);
      };
      img.onerror = function(){ fail(new Error('图片解析失败')); };
      img.src = reader.result;
    };
    reader.onerror = function(){ fail(new Error('读取文件失败')); };
    reader.readAsDataURL(f);
  }

  fileInput.addEventListener('change', function(e){
    var files = Array.prototype.slice.call(e.target.files || []);
    fileInput.value = ''; // 允许再次选同一批文件
    if(!files.length){ return; }
    statusEl.className = 'status';
    statusEl.textContent = '处理中…（0/' + files.length + '）';
    var doneCount = 0, failCount = 0;
    files.forEach(function(f){
      compressFile(f, function(blob){
        items.push({ blob: blob, name: f.name || 'image.jpg', mime: blob.type || 'image/jpeg', url: URL.createObjectURL(blob) });
        doneCount++;
        statusEl.textContent = '处理中…（' + (doneCount + failCount) + '/' + files.length + '）';
        if(doneCount + failCount === files.length){ finishPick(); }
      }, function(err){
        failCount++;
        if(doneCount + failCount === files.length){ finishPick(); }
      });
    });
    function finishPick(){
      renderGrid();
      var msg = failCount ? (failCount + ' 张处理失败已跳过；') : '';
      statusEl.className = failCount ? 'status err' : 'status';
      statusEl.textContent = msg;
    }
  });

  document.getElementById('pick').addEventListener('click', function(){ fileInput.click(); });

  // 逐张顺序发送（一张成功再发下一张，保证到达顺序；失败即停，剩余保留可重试）
  function blobToB64(blob, done, fail){
    var fr = new FileReader();
    fr.onload = function(){ done(fr.result.split(',')[1]); };
    fr.onerror = function(){ fail(new Error('读取图片失败')); };
    fr.readAsDataURL(blob);
  }

  sendBtn.addEventListener('click', function(){
    if(!items.length){ return; }
    sendBtn.disabled = true;
    var total = items.length, sent = 0;
    statusEl.className = 'status';
    function sendNext(){
      if(!items.length){
        statusEl.textContent = '✅ ' + total + ' 张已全部发送到电脑，请在电脑端接收';
        renderGrid();
        return;
      }
      var it = items[0];
      statusEl.textContent = '发送中…（' + (sent + 1) + '/' + total + '）';
      blobToB64(it.blob, function(b64){
        fetch(window.location.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: it.name, mime: it.mime, data: b64 })
        }).then(function(r){ return r.json(); }).then(function(j){
          if(j && j.ok){
            URL.revokeObjectURL(it.url);
            items.shift();
            sent++;
            sendNext();
          } else {
            statusEl.className = 'status err';
            statusEl.textContent = '第 ' + (sent + 1) + ' 张发送失败：' + ((j && j.error) || '未知错误') + '，已发 ' + sent + '/' + total + '，可点按钮重试剩余';
            renderGrid();
          }
        }).catch(function(err){
          statusEl.className = 'status err';
          statusEl.textContent = '第 ' + (sent + 1) + ' 张发送失败：' + err.message + '，已发 ' + sent + '/' + total + '，可点按钮重试剩余';
          renderGrid();
        });
      }, function(err){
        statusEl.className = 'status err';
        statusEl.textContent = err.message;
        renderGrid();
      });
    }
    sendNext();
  });

  // 发送文本到电脑
  var textArea = document.getElementById('txt');
  var sendTextBtn = document.getElementById('sendText');
  sendTextBtn.addEventListener('click', function(){
    var t = (textArea.value || '').trim();
    if (!t) { statusEl.className = 'status err'; statusEl.textContent = '请输入要发送的文本'; return; }
    sendTextBtn.disabled = true;
    statusEl.className = 'status'; statusEl.textContent = '发送中…';
    fetch(window.location.pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: t })
    }).then(function(r){ return r.json(); }).then(function(j){
      if (j && j.ok) {
        statusEl.textContent = '✅ 文本已发送到电脑，请在电脑端点击“复制到剪贴板”';
        sendTextBtn.textContent = '再发一条'; sendTextBtn.disabled = false;
      } else {
        statusEl.className = 'status err';
        statusEl.textContent = '发送失败：' + ((j && j.error) || '未知错误');
        sendTextBtn.disabled = false;
      }
    }).catch(function(err){
      statusEl.className = 'status err';
      statusEl.textContent = '发送失败：' + err.message;
      sendTextBtn.disabled = false;
    });
  });

  // ===== 反向通道：向电脑端证明本手机在线 + 接收电脑发来的内容 =====
  var idMatch = window.location.pathname.match(/\\/u\\/([a-z0-9-]{8,64})/i);
  var deviceId = idMatch ? idMatch[1] : '';
  var connEl = document.getElementById('conn');
  var devEl = document.getElementById('devid');
  if (devEl) devEl.textContent = deviceId ? ('设备ID：' + deviceId) : '设备ID：<未识别，请重新生成二维码>';

  // state: 'online' | 'offline' | 'error'
  function setConn(state, msg){
    if(!connEl) return;
    if(state === 'online'){ connEl.className = 'conn'; connEl.textContent = '🟢 已连接，可接收电脑发送'; }
    else if(state === 'error'){ connEl.className = 'conn off'; connEl.textContent = '⚠️ ' + (msg || '连接失败'); }
    else { connEl.className = 'conn off'; connEl.textContent = '⚪ 未连接（电脑端将提示无法发送）'; }
  }

  // 心跳：声明本手机在线（电脑端据此判断能否发送）
  // 用 Promise.race 做「硬性 8 秒超时」，不依赖 AbortController（部分老旧 WebView 不支持/不触发 abort），
  // 避免请求被代理/防火墙卡住时一直停在「连接中」而无提示。带 body+Content-Type，兼容对空 POST 敏感的代理。
  function heartbeat(){
    if(!deviceId){ setConn('error', '链接无效：未识别到设备ID，请重新生成二维码'); return; }
    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var opt = { method:'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
    if(ctrl) opt.signal = ctrl.signal;
    var timeout = new Promise(function(_, rej){ setTimeout(function(){ rej(new Error('timeout')); }, 8000); });
    Promise.race([ fetch('/phone/heartbeat/' + deviceId, opt), timeout ])
      .then(function(r){
        if(ctrl) ctrl.abort();
        if(r && r.ok){ setConn('online'); }
        else { setConn('error', '服务器返回 ' + (r && r.status) + '，请检查中继地址/代理'); }
      })
      .catch(function(err){
        if(ctrl) ctrl.abort();
        var m = (err && err.message === 'timeout') ? '连接超时（8秒无响应，请检查网络/代理/防火墙）'
                 : ('连接失败：' + ((err && err.message) || '未知错误'));
        setConn('error', m);
      });
  }
  heartbeat();
  setInterval(heartbeat, 8000);

  // 长轮询电脑发来的条目（图片/文本）
  function pollRecv(){
    if(!deviceId) return;
    fetch('/phone/recv/' + deviceId + '?maxwait=25000')
      .then(function(r){ return r.json(); })
      .then(function(j){
        if(j && j.type){ showReceived(j); }
        pollRecv(); // 继续下一次轮询
      })
      .catch(function(){ setTimeout(pollRecv, 1500); });
  }

  function renderRecvGrid(){
    recvGrid.innerHTML = '';
    recvItems.forEach(function(it, idx){
      var cell = document.createElement('div');
      cell.className = 'cell';
      var img = document.createElement('img');
      img.src = it.url;
      cell.appendChild(img);
      var idxEl = document.createElement('div');
      idxEl.className = 'idx';
      idxEl.textContent = (idx + 1);
      cell.appendChild(idxEl);
      cell.onclick = function(){ openRecvImage(it); };
      recvGrid.appendChild(cell);
    });
    // 同步「查看收到的图片」按钮（关闭弹窗后也能重新打开画廊）
    if (recvBtn) {
      recvBtn.classList.toggle('show', recvItems.length > 0);
      recvBtn.textContent = '🖼 收到的图片（' + recvItems.length + '）';
    }
  }

  function openRecvImage(it){
    var box = document.createElement('div');
    box.className = 'recv';
    var img = document.createElement('img');
    img.src = it.url;
    box.appendChild(img);
    var tip = document.createElement('div');
    tip.className = 'recvtip';
    tip.textContent = '长按图片可保存';
    box.appendChild(tip);
    var close = document.createElement('div');
    close.className = 'recvclose';
    close.textContent = '×';
    close.onclick = function(){ if(box.parentNode) box.parentNode.removeChild(box); };
    box.appendChild(close);
    document.body.appendChild(box);
  }

  // 收到的图片以弹窗（画廊）形式查看，与脚本端弹出画廊保持一致
  function openRecvPopup(){ if(recvItems.length) recvPopup.classList.add('show'); }
  function closeRecvPopup(){ recvPopup.classList.remove('show'); }
  if (recvPopup) {
    var rpClose = recvPopup.querySelector('.close');
    if (rpClose) rpClose.onclick = closeRecvPopup;
    recvPopup.onclick = function(e){ if(e.target === recvPopup) closeRecvPopup(); };
  }
  if (recvBtn) recvBtn.onclick = openRecvPopup;

  function showReceived(j){
    if(j.type === 'image'){
      // 收进画廊并自动弹出查看（与脚本端弹出画廊一致），点击缩略图再放大
      recvItems.push({ url: 'data:' + (j.mime || 'image/jpeg') + ';base64,' + j.data, mime: j.mime || 'image/jpeg' });
      renderRecvGrid();
      openRecvPopup();
      return;
    }
    // 文本仍弹独立弹层
    var box = document.createElement('div');
    box.className = 'recv';
    if(j.type === 'text'){
      var pre = document.createElement('pre');
      pre.textContent = j.text || '';
      box.appendChild(pre);
      var cp = document.createElement('button');
      cp.className = 'act';
      cp.textContent = '复制文本';
      cp.onclick = function(){
        var txt = j.text || '';
        function fallbackCopy(){
          // 老旧 WebView 无 navigator.clipboard，用隐藏 textarea + execCommand 兜底
          try {
            var ta = document.createElement('textarea');
            ta.value = txt;
            ta.style.position = 'fixed'; ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus(); ta.select();
            var ok = document.execCommand('copy');
            document.body.removeChild(ta);
            cp.textContent = ok ? '已复制' : '复制失败，请长按文本手动复制';
          } catch(e){ cp.textContent = '复制失败，请长按文本手动复制'; }
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(txt)
            .then(function(){ cp.textContent = '已复制'; })
            .catch(fallbackCopy);
        } else { fallbackCopy(); }
      };
      box.appendChild(cp);
    }
    var close = document.createElement('div');
    close.className = 'recvclose';
    close.textContent = '×';
    close.onclick = function(){ if(box.parentNode) box.parentNode.removeChild(box); };
    box.appendChild(close);
    document.body.appendChild(box);
  }

  pollRecv();
})();
</script>
</body>
</html>`;
}

// ===================== 路由 =====================
const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    const u = new URL(req.url, 'http://localhost');
    const path = u.pathname;
    const method = req.method;

    // ===== 访问日志：确认端口是否真的收到请求 =====
    // 跳过长轮询(/recv、/phone/recv)、心跳(/phone/heartbeat)与在线状态轮询(/phone/status)等
    // 高频路径，避免刷屏；这类请求另有 [连接]/[投递] 等语义日志。想全量记录可去掉下面的过滤条件。
    const ACCESS_NOISE = /^\/(recv|phone\/recv|phone\/heartbeat|phone\/status)(\/|$)/i;
    if (method !== 'OPTIONS' && !ACCESS_NOISE.test(path)) {
      const _t0 = Date.now();
      //logEvent(`[访问] ${method} ${req.url}`);
      res.on('finish', () => {
        logEvent(`[响应] ${res.statusCode} ${method} ${req.url} (${Date.now() - _t0}ms)`);
      });
    }

    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>征纳互动 · 图片中继服务</h2><p>手机请打开脚本面板「手机传图」提供的上传链接。</p>');
      return;
    }
    if (method === 'GET' && path === '/health') { sendJson(res, 200, { ok: true, version: VERSION }); return; }

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
        let item;
        if (typeof payload.text === 'string' && payload.text.length > 0) {
          // 手机发来的文本
          item = { type: 'text', text: payload.text.slice(0, MAX_BODY), ts: Date.now() };
        } else if (typeof payload.data === 'string') {
          // 手机发来的图片（base64）
          item = {
            type: 'image',
            name: String(payload.name || 'image.jpg').slice(0, 200),
            mime: String(payload.mime || 'image/jpeg').slice(0, 100),
            data: payload.data.slice(0, MAX_BODY),
            ts: Date.now()
          };
        } else {
          sendJson(res, 400, { error: 'missing data or text' }); return;
        }
        // 入队（FIFO）：支持手机端多选连发；超出 MAX_QUEUE 丢弃最旧一条
        if (!pending.has(uuid)) pending.set(uuid, []);
        const q = pending.get(uuid);
        q.push(item);
        if (q.length > MAX_QUEUE) {
          const dropped = q.shift();
          logEvent(`[丢弃] 设备 ${uuid} 暂存队列已满（>${MAX_QUEUE}），丢弃最旧条目（${dropped.type}）`);
        }
        if (item.type === 'image') {
          logEvent(`[发送] 设备 ${uuid} 手机端发送图片：${item.name}（${item.mime}，约 ${b64SizeKB(item.data)}KB），队列 ${q.length} 条`);
        } else {
          logEvent(`[发送] 设备 ${uuid} 手机端发送文本：${previewText(item.text)}`);
        }
        deliverToAll(uuid); // 落库后若存在在等待的接收端，立即广播给它们（避免条目留在 pending 无人来取）
        sendJson(res, 200, { ok: true });
        return;
      }
      res.writeHead(405); res.end(); return;
    }

    // /recv/<deviceId> ：电脑端长轮询取图
    // 支持「广播」：同一 deviceId 在多个标签页/浏览器同时长轮询时，每张图会**同时发给所有在等待的接收端**，
    // 彻底消除「两个接收端抢唯一图槽、第一张被别的标签抢走」的竞态（刷新网页后第一次不弹窗的根因）。
    const r = /^\/recv\/([a-z0-9-]{8,64})$/i.exec(path);
    if (r && method === 'GET') {
      const uuid = r[1];
      let maxwait = parseInt(u.searchParams.get('maxwait') || '', 10);
      if (!Number.isFinite(maxwait)) maxwait = 25000;
      maxwait = Math.min(Math.max(maxwait, 1000), 30000);
      const start = Date.now();
      let closed = false; // 客户端断开（刷新/关闭/重连）后置位，放弃本轮轮询
      // 把本次长轮询连接登记进 waiting 集合，便于广播给所有在等的接收端
      if (!waiting.has(uuid)) waiting.set(uuid, new Set());
      waiting.get(uuid).add(res);
      const removeFromWaiting = () => {
        const s = waiting.get(uuid);
        if (s) { s.delete(res); if (s.size === 0) waiting.delete(uuid); }
      };
      // 客户端一断开（刷新/关闭/重连）：放弃本轮、从等待集合移除，图片留在 pending 由其他存活连接取走
      req.on('close', () => { closed = true; removeFromWaiting(); });
      const tick = () => {
        if (closed || res.writableEnded) { removeFromWaiting(); return; } // 连接已失效/已结束，放弃本轮（不再调度、不再写入）
        const q = pending.get(uuid);
        if (q && q.length) {
          // 清掉队头过期条目后若仍有货，投递一条给所有等待连接（含本次）
          while (q.length && (Date.now() - q[0].ts) >= PENDING_TTL) q.shift();
          if (q.length) { deliverToAll(uuid); return; }
          pending.delete(uuid); // 全部过期，清空
        }
        if (Date.now() - start > maxwait) {
          try { sendJson(res, 200, { empty: true }); } catch (e) { /* 已断开，忽略 */ }
          removeFromWaiting();
          return;
        }
        setTimeout(tick, 400);
      };
      tick();
      return;
    }

    // ===== 反向通道：电脑端 → 手机端 =====

    // /phone/heartbeat/<deviceId> ：手机打开页面向服务器报活（证明本设备有手机在线）
    const hb = /^\/phone\/heartbeat\/([a-z0-9-]{8,64})$/i.exec(path);
    if (hb && method === 'POST') {
      const id = hb[1];
      const now = Date.now();
      const last = phoneOnline.get(id) || 0;
      const wasOnline = phoneWasOnline.has(id) && (now - last) < PHONE_TTL;
      phoneOnline.set(id, now);
      if (!wasOnline) {
        phoneWasOnline.add(id);
        logEvent(`[连接] 设备 ${id} 已连接（手机端在线）`);
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    // /phone/status/<deviceId> ：电脑端查询手机是否在线（用于发送前判断是否可发）
    const st = /^\/phone\/status\/([a-z0-9-]{8,64})$/i.exec(path);
    if (st && method === 'GET') {
      const last = phoneOnline.get(st[1]) || 0;
      sendJson(res, 200, { online: (Date.now() - last) < PHONE_TTL });
      return;
    }

    // /phone/send/<deviceId> ：电脑端发送图片或文本到手机（镜像 /u 的 POST，方向相反）
    const ps = /^\/phone\/send\/([a-z0-9-]{8,64})$/i.exec(path);
    if (ps && method === 'POST') {
      const buf = await readBody(req);
      let payload;
      try { payload = JSON.parse(buf.toString('utf8')); }
      catch (e) { sendJson(res, 400, { error: 'invalid json' }); return; }
      const uuid = ps[1];
      let item;
      if (typeof payload.text === 'string' && payload.text.length > 0) {
        item = { type: 'text', text: payload.text.slice(0, MAX_BODY), ts: Date.now() };
      } else if (typeof payload.data === 'string') {
        item = {
          type: 'image',
          name: String(payload.name || 'image.jpg').slice(0, 200),
          mime: String(payload.mime || 'image/jpeg').slice(0, 100),
          data: payload.data.slice(0, MAX_BODY),
          ts: Date.now()
        };
      } else {
        sendJson(res, 400, { error: 'missing data or text' }); return;
      }
      // 入队（FIFO）：支持电脑端多选连发；超出 MAX_QUEUE 丢弃最旧一条
      if (!phonePending.has(uuid)) phonePending.set(uuid, []);
      const pq = phonePending.get(uuid);
      pq.push(item);
      if (pq.length > MAX_QUEUE) {
        const dropped = pq.shift();
        logEvent(`[丢弃] 设备 ${uuid} 手机收件队列已满（>${MAX_QUEUE}），丢弃最旧条目（${dropped.type}）`);
      }
      if (item.type === 'image') {
        logEvent(`[发送] 设备 ${uuid} 电脑端发送图片到手机：${item.name}（${item.mime}，约 ${b64SizeKB(item.data)}KB），队列 ${pq.length} 条`);
      } else {
        logEvent(`[发送] 设备 ${uuid} 电脑端发送文本到手机：${previewText(item.text)}`);
      }
      deliverToPhone(uuid); // 若当前有手机在等，立即广播；否则留在 phonePending 等手机轮询
      sendJson(res, 200, { ok: true });
      return;
    }

    // /phone/recv/<deviceId> ：手机端长轮询取电脑发来的条目（镜像 /recv，方向相反）
    const pr = /^\/phone\/recv\/([a-z0-9-]{8,64})$/i.exec(path);
    if (pr && method === 'GET') {
      const uuid = pr[1];
      let maxwait = parseInt(u.searchParams.get('maxwait') || '', 10);
      if (!Number.isFinite(maxwait)) maxwait = 25000;
      maxwait = Math.min(Math.max(maxwait, 1000), 30000);
      const start = Date.now();
      let closed = false; // 手机断开（关页/切后台/重连）后置位，放弃本轮轮询
      if (!phoneWaiting.has(uuid)) phoneWaiting.set(uuid, new Set());
      phoneWaiting.get(uuid).add(res);
      const removeFromWaiting = () => {
        const s = phoneWaiting.get(uuid);
        if (s) { s.delete(res); if (s.size === 0) phoneWaiting.delete(uuid); }
      };
      req.on('close', () => { closed = true; removeFromWaiting(); });
      const tick = () => {
        if (closed || res.writableEnded) { removeFromWaiting(); return; }
        const q = phonePending.get(uuid);
        if (q && q.length) {
          // 清掉队头过期条目后若仍有货，投递一条给所有等待连接（含本次）
          while (q.length && (Date.now() - q[0].ts) >= PENDING_TTL) q.shift();
          if (q.length) { deliverToPhone(uuid); return; }
          phonePending.delete(uuid); // 全部过期，清空
        }
        if (Date.now() - start > maxwait) {
          try { sendJson(res, 200, { empty: true }); } catch (e) { /* 已断开，忽略 */ }
          removeFromWaiting();
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

// 周期扫描：手机超过 PHONE_TTL 无心跳即视为离线，仅记一次「已断开」（避免重复告警）
setInterval(() => {
  const now = Date.now();
  for (const [id, last] of phoneOnline) {
    if (now - last >= PHONE_TTL) {
      phoneOnline.delete(id);
      if (phoneWasOnline.has(id)) {
        phoneWasOnline.delete(id);
        logEvent(`[断开] 设备 ${id} 已断开（手机端离线超时）`);
      }
    }
  }
}, 5 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('[中继服务] v' + VERSION + ' 已启动: http://0.0.0.0:' + PORT);
});
