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
const fs = require('fs');
const zlib = require('zlib');
// ⚠️ 本文件的路由处理里有个局部变量叫 path（请求路径），故 path 模块改名 nodePath 以免遮蔽
const nodePath = require('path');
const PORT = process.env.PORT || 5689;
// 版本号唯一来源：package.json 的 version（格式 YY.M.D-vN，规范同 znhd.user.js）
const VERSION = (() => { try { return require('./package.json').version; } catch (e) { return 'unknown'; } })();
// 手机上传页（React + antd 构建产物）由独立模块提供，见 upload-page.js
const { uploadPageHtml, PUBLIC_DIR } = require('./upload-page');

// 前端构建产物目录（web/ 由 Vite 构建到 relay-server/public/）：/assets/* 直接静态托管。
// 文件名带内容 hash，故可长缓存；HTML 本身用 no-cache（见 /u/ 路由）。
const ASSETS_DIR = nodePath.join(PUBLIC_DIR, 'assets');
const ASSET_MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const PENDING_TTL = 60 * 1000;      // 暂存有效期 60s（手机先传、电脑后开也来得及）
const MAX_BODY = 12 * 1024 * 1024; // 单图体积上限 12MB
// 每设备最多暂存条目数（内存保护上限；手机端选图张数已不限制），超出丢弃最旧。
// 队列化（FIFO）以支持多选连发（旧实现是单槽，连发会互相覆盖丢图）。
const MAX_QUEUE = 100;
const BODY_TIMEOUT = 60 * 1000;     // 读取请求体超时兜底（慢客户端/卡住连接），超时回 408 并断开

// ===== 反向通道在线状态：电脑端 → 手机端 =====
const PHONE_TTL = 20 * 1000;       // 手机在线判定：超过该时长无心跳视为离线（心跳 8s 一次）
// deviceId -> lastSeen(ms) 手机最近一次心跳时间
const phoneOnline = new Map();

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
// 文件名清洗（仅用于日志）：剔除控制字符，防止伪造的 name 注入/干扰 docker 日志，超长截断
function cleanLogName(name) {
  return String(name || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80);
}
// 曾经在线过的手机设备集合，用于「离线」只告警一次
const phoneWasOnline = new Set();

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, code, obj) {
  if (res.destroyed || res.writableEnded) return; // 客户端已断开：不写已销毁的响应（B5，防版本相关 ERR_STREAM_DESTROYED）
  const body = JSON.stringify(obj);
  setCors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

// 405 响应：补 Allow 头（协议语义：客户端可据此知道允许的方法）
function sendMethodNotAllowed(res, allow) {
  if (res.destroyed || res.writableEnded) return;
  setCors(res);
  res.writeHead(405, { 'Allow': allow });
  res.end('method not allowed');
}

// ===================== 通道抽象（正向手机→电脑 / 反向电脑→手机 共用） =====================
// 「按设备 FIFO 队列 + 长轮询广播投递」的一套完整逻辑。正反向原本是三组近乎逐行相同的
// 镜像代码（入队、投递、长轮询），历史上 relay v26.7.29-v8 的残留行 bug 即发生在这类镜像
// 代码里。现抽成工厂，两个方向各实例化一次，修一处等于修两处。
//
// 语义（与旧实现严格一致）：
//  - 入队 FIFO，超 MAX_QUEUE 丢最旧并记 [丢弃] 日志；
//  - deliver 每次只投递队头一条，「广播」给所有正在等待的长轮询连接（每个连接各得一份拷贝），
//    同一设备多标签页同时接收互不抢图；无人等待时保留队列等下一个连接来取，不会漏；
//  - 投递前丢弃队头已过期（> PENDING_TTL）条目，绝不投递过期内容；
//  - 长轮询 maxwait 钳制 [1000,30000]（默认 25000），到期返回 {empty:true}。
//
// 相对旧实现（每连接 400ms tick 轮询）的改进：投递本就由「POST 入队时同步 deliver」与
// 「连接注册时立即查队」两条同步路径全覆盖，tick 定时器属空转；现改为
// 「注册即查队 + 单次 maxwait 定时器」，过期清理由全局周期 sweep 承担，
// N 个等待连接不再挂 N 个 400ms 定时器。
function createChannel(labels) {
  // labels: { recv, dropQ, sendImg(uuid,item,len), sendTxt(uuid,item) } —— 日志文案（正反向措辞不同）
  const pending = new Map(); // deviceId -> Array<item> 待取走的条目队列（FIFO）
  const waiting = new Map(); // deviceId -> Set<res> 当前正在长轮询等待的连接（用于「广播」）

  // 清理队列中全部已过期条目，清空则移除 Map 键（内存回收；由全局周期任务调用）
  function sweepExpired() {
    const now = Date.now();
    for (const [uuid, q] of pending) {
      for (let i = q.length - 1; i >= 0; i--) {
        if (now - q[i].ts >= PENDING_TTL) q.splice(i, 1);
      }
      if (q.length === 0) pending.delete(uuid);
    }
  }

  // 把队头条目「广播」给所有正在等待的连接；无人等待则保留队列，等下个连接来取（不会漏）。
  // 直接回传整条 item（含 type: 'image' | 'text'），由接收端按 type 分流处理。
  function deliver(uuid) {
    const q = pending.get(uuid);
    // 丢弃队头已过期的条目（保证绝不投递过期内容）
    while (q && q.length && (Date.now() - q[0].ts) >= PENDING_TTL) q.shift();
    if (!q || q.length === 0) { pending.delete(uuid); return; }
    const set = waiting.get(uuid);
    if (!set || set.size === 0) return; // 当前无等待连接：保留队列，等下个连接
    // 先筛出仍可写的目标连接再出队：若等待者此刻全部已结束/断开（res 'close' 尚未触发的窄窗口），
    // 直接放弃本次投递并保留队头，等下个连接来取——避免队头被 shift 后无人能收造成丢条（B6）。
    const targets = Array.from(set).filter(r => !r.writableEnded && !r.destroyed);
    if (targets.length === 0) { waiting.delete(uuid); return; }
    // 每次只投递队头一条（长轮询协议每个响应回一条）；接收端收到后会立刻重新轮询取下一条
    const p = q.shift();
    if (q.length === 0) pending.delete(uuid);
    waiting.delete(uuid);
    for (const r of targets) {
      try { sendJson(r, 200, p); }
      catch (e) { /* 已断开的连接，忽略 */ }
    }
    logEvent(`[投递] 设备 ${uuid} 已向 ${targets.length} 个${labels.recv}投递条目（${p.type}）${q.length ? `，队列剩余 ${q.length} 条` : ''}`);
  }

  // 入队（FIFO）：超出 MAX_QUEUE 丢弃最旧一条；入队后若存在等待连接立即投递。
  function enqueue(uuid, item) {
    if (!pending.has(uuid)) pending.set(uuid, []);
    const q = pending.get(uuid);
    q.push(item);
    if (q.length > MAX_QUEUE) {
      const dropped = q.shift();
      logEvent(`[丢弃] 设备 ${uuid} ${labels.dropQ}已满（>${MAX_QUEUE}），丢弃最旧条目（${dropped.type}）`);
    }
    if (item.type === 'image') {
      logEvent(labels.sendImg(uuid, item, q.length));
    } else {
      logEvent(labels.sendTxt(uuid, item));
    }
    deliver(uuid); // 落库后若存在在等待的接收端，立即广播（避免条目留在队列无人来取）
  }

  // 长轮询：注册进等待集合 → 立即查队（有货即投递）→ 无货挂单次 maxwait 定时器到期回 empty。
  function handlePoll(req, res, uuid, u) {
    let maxwait = parseInt(u.searchParams.get('maxwait') || '', 10);
    if (!Number.isFinite(maxwait)) maxwait = 25000;
    maxwait = Math.min(Math.max(maxwait, 1000), 30000);

    if (!waiting.has(uuid)) waiting.set(uuid, new Set());
    waiting.get(uuid).add(res);

    let timer = null;
    // 幂等清理：从等待集合移除并撤销定时器。res 'close' 在「响应已发出（投递/超时）」与
    // 「客户端断开（刷新/关页/重连）」两种情况下都会触发；req 'close' 作兼容兜底
    // （不同 Node 版本对 IncomingMessage 'close' 时机有差异，幂等所以双注册无害）。
    const cleanup = () => {
      const s = waiting.get(uuid);
      if (s) { s.delete(res); if (s.size === 0) waiting.delete(uuid); }
      if (timer) { clearTimeout(timer); timer = null; }
    };
    req.on('close', cleanup);
    res.on('close', cleanup);

    // 注册即查队：连接到来前队列里已有货，立即投递（广播给含本次在内的所有等待连接）。
    // 注意 deliver 可能因「队头全部过期」而未发出任何响应，此时须继续走 maxwait 等待，
    // 故用 writableEnded 判断本次响应是否已结束，不能无条件 return。
    const q = pending.get(uuid);
    if (q && q.length) {
      deliver(uuid);
      if (res.writableEnded) return; // 已投递给本连接，响应结束（res 'close' 会做清理）
    }

    // 无货/未投出：挂单次 maxwait 定时器，到期返回空响应（客户端收到后自行重连轮询）
    timer = setTimeout(() => {
      timer = null;
      if (res.writableEnded || res.destroyed) { cleanup(); return; }
      try { sendJson(res, 200, { empty: true }); } catch (e) { /* 已断开，忽略 */ }
      cleanup();
    }, maxwait);
  }

  return { pending, waiting, enqueue, deliver, handlePoll, sweepExpired };
}

// 正向通道：手机 → 电脑（POST /u 入队，GET /recv 长轮询取走）
const forwardChannel = createChannel({
  recv: '电脑端接收端',
  dropQ: '暂存队列',
  sendImg: (uuid, item, len) => `[发送] 设备 ${uuid} 手机端发送图片：${cleanLogName(item.name)}（${item.mime}，约 ${b64SizeKB(item.data)}KB），队列 ${len} 条`,
  sendTxt: (uuid, item) => `[发送] 设备 ${uuid} 手机端发送文本：${previewText(item.text)}`
});

// 反向通道：电脑 → 手机（POST /phone/send 入队，GET /phone/recv 长轮询取走）
const reverseChannel = createChannel({
  recv: '手机端接收端',
  dropQ: '手机收件队列',
  sendImg: (uuid, item, len) => `[发送] 设备 ${uuid} 电脑端发送图片到手机：${cleanLogName(item.name)}（${item.mime}，约 ${b64SizeKB(item.data)}KB），队列 ${len} 条`,
  sendTxt: (uuid, item) => `[发送] 设备 ${uuid} 电脑端发送文本到手机：${previewText(item.text)}`
});

// 解析 POST 正文为待投递条目（图片 {data,mime,name} 或文本 {text}）；非法时已回 4xx 并返回 null。
// /u 与 /phone/send 两个 POST 路由共用。
async function parseItemBody(req, res) {
  let buf;
  try {
    buf = await readBody(req);
  } catch (e) {
    // 请求体超限（> MAX_BODY）：明确回 413（Payload Too Large）而非通用 500/静默断开。
    // 旧实现 req.destroy() 会掐断连接，客户端只见笼统的「网络错误」，无从定位是体积问题。
    if (e && e.statusCode === 413) sendJson(res, 413, { error: '内容过大，超过单次上限（约 12MB），请压缩后再发送' });
    else if (e && e.statusCode === 408) sendJson(res, 408, { error: '读取请求超时，请检查网络后重试' });
    else sendJson(res, 400, { error: '读取请求失败' });
    return null;
  }
  let payload;
  try { payload = JSON.parse(buf.toString('utf8')); }
  catch (e) { sendJson(res, 400, { error: 'invalid json' }); return null; }
  if (typeof payload.text === 'string' && payload.text.length > 0) {
    // 文本
    return { type: 'text', text: payload.text.slice(0, MAX_BODY), ts: Date.now() };
  }
  if (typeof payload.data === 'string') {
    // 图片（base64）
    return {
      type: 'image',
      name: String(payload.name || 'image.jpg').slice(0, 200),
      mime: String(payload.mime || 'image/jpeg').slice(0, 100),
      data: payload.data.slice(0, MAX_BODY),
      ts: Date.now()
    };
  }
  sendJson(res, 400, { error: 'missing data or text' });
  return null;
}

// 读取整个请求体为 Buffer。超过 MAX_BODY 时进入「溢出」态：之后只继续计数、不再缓存，
// 一直等到 'end' 再统一以 {statusCode:413} 拒绝——保证请求被完整消费完，客户端能稳定收到明确的 413，
// 也不残留未读请求体破坏 keep-alive（旧实现中途 req.destroy() 掐断连接，客户端只见网络错误）。
// 附超时兜底：engines 声明 Node>=14，其默认 requestTimeout=0（无超时），慢/卡客户端可能永远占着连接，
// 故在本函数自管 BODY_TIMEOUT 定时器，超时以 {statusCode:408} 拒绝并断开。
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, overflow = false, settled = false;
    const chunks = [];
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('read body timeout'), { statusCode: 408 }));
      req.destroy();
    }, BODY_TIMEOUT);
    const settle = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { overflow = true; return; } // 超限后仅计数、不再累积内存
      chunks.push(c);
    });
    req.on('end', () => {
      if (overflow) { settle(reject, Object.assign(new Error('body too large'), { statusCode: 413 })); return; }
      settle(resolve, Buffer.concat(chunks));
    });
    req.on('error', e => settle(reject, e));
  });
}

// ===================== 手机上传页（内联，同源托管） =====================


// ===================== 路由 =====================
const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    // 兜底：客户端中途断开时 res 可能触发 'error'（版本相关行为），挂 noop 防未处理 error 崩进程
    res.on('error', () => { /* 已断开连接的错误由 sendJson/destroyed 守卫兜底，忽略 */ });
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
      res.end('<h2>征纳互动 · 图片中继服务</h2><p>手机请打开脚本面板「设备互联」提供的上传链接。</p>');
      return;
    }
    if (method === 'GET' && path === '/health') { sendJson(res, 200, { ok: true, version: VERSION }); return; }

    // 二维码改由电脑端脚本用 qrcodejs 客户端生成，本服务不再提供 /qr 端点。

    // /assets/* ：手机上传页（React + antd）的构建产物，同源托管，避免任何第三方请求
    // （HEAD 也照常返回头部：Node 对 HEAD 会自动不发 body，缓存/探活更友好）
    if ((method === 'GET' || method === 'HEAD') && path.indexOf('/assets/') === 0) {
      const rel = path.slice('/assets/'.length);
      const file = nodePath.join(ASSETS_DIR, rel);
      // 目录穿越防护：解析后的绝对路径必须仍在 ASSETS_DIR 内
      if (rel.indexOf('..') !== -1 || file.indexOf(ASSETS_DIR) !== 0) {
        res.writeHead(403); res.end('forbidden');
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        const type = ASSET_MIME[nodePath.extname(file).toLowerCase()] || 'application/octet-stream';
        // 文件名带内容 hash，可长缓存
        const headers = { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' };
        // gzip：前端产物 746KB→242KB。Node 内置 zlib，中继依旧零依赖；
        // 前面若还有 openresty 等反代，这里压过也不冲突（它看到 Content-Encoding 就不会再压）。
        const isText = /^(text\/|application\/(javascript|json))/.test(type);
        const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
        if (isText && acceptsGzip) {
          zlib.gzip(data, (zerr, buf) => {
            if (zerr) { res.writeHead(200, headers); res.end(data); return; }
            headers['Content-Encoding'] = 'gzip';
            headers['Vary'] = 'Accept-Encoding';
            res.writeHead(200, headers);
            res.end(buf);
          });
        } else {
          res.writeHead(200, headers);
          res.end(data);
        }
      });
      return;
    }

    // /u/<deviceId> ：手机上传页 + 接收上传
    const m = /^\/u\/([a-z0-9-]{8,64})$/i.exec(path);
    if (m) {
      const uuid = m[1];
      if (method === 'GET') {
        // no-cache：HTML 里引用的是带 hash 的静态资源，HTML 本身不能被长期缓存（否则发新版后手机仍拿旧页面）
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(uploadPageHtml());
        return;
      }
      if (method === 'POST') {
        const item = await parseItemBody(req, res);
        if (!item) return; // 解析失败已回 4xx
        forwardChannel.enqueue(uuid, item);
        sendJson(res, 200, { ok: true });
        return;
      }
      sendMethodNotAllowed(res, 'GET, POST');
      return;
    }

    // /recv/<deviceId> ：电脑端长轮询取图
    // 支持「广播」：同一 deviceId 在多个标签页/浏览器同时长轮询时，每张图会**同时发给所有在等待的接收端**，
    // 彻底消除「两个接收端抢唯一图槽、第一张被别的标签抢走」的竞态（刷新网页后第一次不弹窗的根因）。
    // 语义详见 createChannel 注释。
    const r = /^\/recv\/([a-z0-9-]{8,64})$/i.exec(path);
    if (r && method === 'GET') {
      forwardChannel.handlePoll(req, res, r[1], u);
      return;
    }
    if (r) { sendMethodNotAllowed(res, 'GET'); return; }

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
    if (hb) { sendMethodNotAllowed(res, 'POST'); return; }

    // /phone/status/<deviceId> ：电脑端查询手机是否在线（用于发送前判断是否可发）
    const st = /^\/phone\/status\/([a-z0-9-]{8,64})$/i.exec(path);
    if (st && method === 'GET') {
      const last = phoneOnline.get(st[1]) || 0;
      sendJson(res, 200, { online: (Date.now() - last) < PHONE_TTL });
      return;
    }
    if (st) { sendMethodNotAllowed(res, 'GET'); return; }

    // /phone/send/<deviceId> ：电脑端发送图片或文本到手机（镜像 /u 的 POST，方向相反）
    const ps = /^\/phone\/send\/([a-z0-9-]{8,64})$/i.exec(path);
    if (ps && method === 'POST') {
      const item = await parseItemBody(req, res);
      if (!item) return; // 解析失败已回 4xx
      reverseChannel.enqueue(ps[1], item);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (ps) { sendMethodNotAllowed(res, 'POST'); return; }

    // /phone/recv/<deviceId> ：手机端长轮询取电脑发来的条目（镜像 /recv，方向相反）
    // 语义详见 createChannel 注释。
    const pr = /^\/phone\/recv\/([a-z0-9-]{8,64})$/i.exec(path);
    if (pr && method === 'GET') {
      reverseChannel.handlePoll(req, res, pr[1], u);
      return;
    }
    if (pr) { sendMethodNotAllowed(res, 'GET'); return; }

    res.writeHead(404); res.end('not found');
  } catch (e) {
    if (res.destroyed || res.writableEnded) return; // 客户端已断开，不再尝试回 500
    if (!res.headersSent) res.writeHead(500);
    res.end('server error: ' + e.message);
  }
});

// 周期扫描（每 5s）：
//  1) 手机超过 PHONE_TTL 无心跳即视为离线，仅记一次「已断开」（避免重复告警）；
//  2) 两通道清理超过 PENDING_TTL 的暂存条目并回收空队列（承担旧实现中每连接 400ms tick
//     里的过期清理职责——投递路径自身仍会在投递前清队头过期项，保证绝不投递过期内容）。
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
  forwardChannel.sweepExpired();
  reverseChannel.sweepExpired();
}, 5 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('[中继服务] v' + VERSION + ' 已启动: http://0.0.0.0:' + PORT);
});
