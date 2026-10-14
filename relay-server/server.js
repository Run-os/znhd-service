// 征纳互动 · 手机图片 → 电脑剪贴板 中继服务器
// 纯 Node 内置模块实现，无需 npm install。
// 运行： node server.js        （可选 PORT 环境变量，默认 5689）
//
// 工作流程（双向）：
//   正向（手机 → 电脑）：
//   1) 电脑端脚本生成稳定 deviceId，拼出上传链接  http(s)://<本服务>/u/<deviceId>
//   2) 手机浏览器打开该链接 → 选图（前端 canvas 压缩）/输入文本 → POST JSON 到同一路径
//      （v26.10.13-v3 起载荷带 `phoneId`：这台手机自己的持久 ID，服务端随投递回传，
//        电脑端据此把内容归到**对应那台手机**的会话，多台在线也不再全挤进聚合会话）
//   3) 服务器把图片或文本按 deviceId 暂存（TTL 内）
//   4) 电脑端脚本用 GM_xmlhttpRequest 长轮询 /recv/<deviceId> 取走条目（type 区分 image/text，
//      `from` = 发送者手机 ID；老手机页不带 phoneId 时 from 为空，电脑端按旧规则归组）
//
//   反向（电脑 → 手机）：
//   1) 手机打开 /u/<deviceId> 后**声明在线并等待内容**（P4，v26.10.15-v2 起两者合一）：
//      POST /phone/poll/<deviceId>（body `{phoneId}`）挂起 maxwait 秒 —— 有内容立刻返回，
//      没有则到期回 {empty:true}，返回后客户端立即重连。**一次请求同时完成「报活」与「收件」**，
//      手机端因此只挂一条连接（旧模型是「8s 心跳」+「长轮询」两条并行，8h 多 3600 次请求）。
//      ⚠️ 老手机页仍可走老模型：POST /phone/heartbeat/<deviceId> 报活 + GET /phone/recv/<deviceId>
//      收件，两个端点原样保留；反过来，新手机页连老中继时会收到 404 并**自动降级**回老模型。
//   2) 电脑端不再定期轮询 GET /phone/status/<deviceId>，而是在**正向长轮询的响应里捎带**
//      在线手机名单（P0-b piggyback），并在手机上下线时被服务器主动唤醒（P0-c）；
//      /phone/status 退化为「窗口打开」与「60s 兜底」时的按需查询（接口形态未变）
//   3) 电脑端 POST /phone/send/<deviceId>（图片 {data,mime,name} 或文本 {text}）
//   4) 手机端从上面那条挂起的请求里取走条目 → 全屏看图/复制文本
//
// 说明：电脑端使用长轮询而非 WebSocket，是为了绕过征纳互动页面的 CSP 对 connect-src 的限制
//       （GM_xmlhttpRequest 不受页面 CSP 约束）。手机端页面由本服务同源托管，也无 CORS 问题。
//       v26.10.14-v7：在长轮询之上加 notify()（服务器主动结束挂起请求）后，推送延迟已与
//       WebSocket 同级（亚秒级），但零依赖、零 CSP 风险、不改协议 —— 故仍不换 WebSocket。
//
// ⚠️ 长轮询是**闭环**：一次请求要么「等到消息提前返回」要么「等满 maxwait」，返回后立刻重连，
//    故请求数 ≈ 时长 / maxwait，**与期间来多少消息无关**。notify() 不是新机制（deliver()
//    早就在做同一件事），只是把「提前结束」扩展到上下线事件；它只在状态翻转时触发，
//    额外开销 = 上下线次数（一天几十次），换来的是删掉 5s 轮询省下的几千次请求。

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
// 在线表情包的「CDN → 本服务磁盘」缓存（v26.10.14-v1，客户端不再直连公网 CDN）
const emoji = require('./emoji-store');

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
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const PENDING_TTL = 60 * 1000;      // 暂存有效期 60s（手机先传、电脑后开也来得及）
const MAX_BODY = 100 * 1024 * 1024; // 单次请求体上限 100MB（v26.10.14-v6：原 12MB；含图片与任意文件）
// 每设备最多暂存条目数（内存保护上限；手机端选图张数已不限制），超出丢弃最旧。
// 队列化（FIFO）以支持多选连发（旧实现是单槽，连发会互相覆盖丢图）。
// ⚠️ 与 MAX_BODY 相乘是单设备理论内存峰值（100MB × 100 = 10GB，远超普通机器）。
//    实际受 MAX_QUEUE_BYTES 兜底：条目按体积累计，超预算就从队头丢，先丢最旧、再大也不至于爆。
const MAX_QUEUE = 100;
// 每设备队列的**字节预算**（v26.10.14-v6）：MAX_BODY 提到 100MB 后，仅靠条数上限不足以防内存，
// 故加一层体积上限；超出即从队头（最旧）丢弃，直到落回预算内。留 2 倍单条余量，
// 保证「一条 100MB 刚投递、队列里还能再放一条中等体积」的正常多选连发不被自己挤掉。
const MAX_QUEUE_BYTES = 256 * 1024 * 1024;
const BODY_TIMEOUT = 60 * 1000;     // 读取请求体超时兜底（慢客户端/卡住连接），超时回 408 并断开

// ===== 反向通道在线状态：电脑端 → 手机端 =====
const PHONE_TTL = 20 * 1000;       // 手机在线判定：超过该时长无「报活」视为离线。
                                   // 旧模型 = 8s 心跳（每 8s 刷新时间戳）；
                                   // P4（v26.10.15-v2）后 = 「**挂起中的 poll 算在线**」
                                   // （新模型一次 poll 可挂 45s，远大于本值，见 pollAliveSet），
                                   // 真离线 = 长轮询断开后 TTL + 清扫周期（≈20~25s，与改动前一致）。
// v26.10.06-v4：由「一台电脑一个布尔位」升级为**多手机注册表**。
//   deviceId(电脑) -> Map<phoneId(手机) -> lastSeen(ms)>
// 手机身份来自手机页自己生成的持久化 UUID（localStorage），心跳时带上；
// ⚠️ 不带 phoneId 的心跳一律拒收（v26.10.06-v4 起手机页必须升级，不再兼容老页面）。
const phoneOnline = new Map();
/** 取某台电脑的手机表（不存在则建） */
function phoneMap(deviceId) {
  let m = phoneOnline.get(deviceId);
  if (!m) { m = new Map(); phoneOnline.set(deviceId, m); }
  return m;
}
/** 手机上线的日志/展示用短 ID（UUID 太长，日志里只留前 8 位） */
function shortId(id) {
  const s = String(id || '');
  return s.length > 8 ? s.slice(0, 8) + '…' : s;
}

/**
 * 该电脑当前**挂起中的手机 poll** 集合（键 = `deviceId + '/' + phoneId`）。
 *
 * P4（v26.10.15-v2）为什么需要它：新模型下一次 poll 可挂满 maxwait（45s），**远大于**
 * `PHONE_TTL`（20s）⇒ 若只看「距上次报活多久」，一台正常在线的手机挂 20s 后就会被误判离线
 * （名单抖动 + 假的「已断开」日志）。故「挂起中」必须视为在线：在线判定（周期清扫）与
 * 名单构造（`listPhones`）**两处都用它**，否则会出现「sweep 认为在线、但名单里没有它」的分裂。
 *
 * ⚠️ 只认带 `__pollAlive` 的连接（`/phone/poll` 独有）。老手机页走 `/phone/recv`，不带该标记，
 *    其在线判定仍**完全由 8s 心跳**决定 —— 对老手机页的语义零变化。
 */
function pollAliveSet(deviceId) {
  const out = new Set();
  const set = reverseChannel.waiting.get(deviceId);
  if (!set) return out;
  for (const r of set) {
    if (r.__pollAlive && !r.writableEnded && !r.destroyed) out.add(deviceId + '/' + r.__pollAlive);
  }
  return out;
}

/**
 * 某台电脑的在线手机快照：`{ online, phones:[{id,lastSeen}] }`（按 lastSeen 倒序）。
 * 顺手清掉已过期的（全局 sweep 每 5s 也做，这里保证**返回值即时准确**）。
 *
 * ⚠️ 单一来源：`/phone/status`（按需查询）与正向长轮询的 piggyback（P0-b）都走这里，
 *    避免两处各写一份「过期判定」而语义漂移。
 * ⚠️ v26.10.15-v2（P4）：过期判定放宽为「超过 PHONE_TTL **且**不在挂起 poll 里」——
 *    见 `pollAliveSet` 的注释。
 */
function listPhones(deviceId) {
  const now = Date.now();
  const m = phoneOnline.get(deviceId);
  const phones = [];
  const alive = pollAliveSet(deviceId);
  if (m) {
    for (const [pid, last] of Array.from(m)) {
      if (now - last < PHONE_TTL || alive.has(deviceId + '/' + pid)) phones.push({ id: pid, lastSeen: last });
      else m.delete(pid);
    }
    if (m.size === 0) phoneOnline.delete(deviceId);
  }
  phones.sort((a, b) => b.lastSeen - a.lastSeen);
  return { online: phones.length > 0, phones: phones };
}

/**
 * 手机报活（`/phone/heartbeat` 与 `/phone/poll` 共用 —— v26.10.15-v2 起 P4 把心跳并进长轮询）：
 * 写在线表；**首次上线**时记日志并主动唤醒电脑端挂起的长轮询（P0-c）。
 * @returns {boolean} true = 本次是新上线（false = 本来就在线，只刷新了时间戳）
 */
function touchPhone(id, phoneId) {
  const now = Date.now();
  const m = phoneMap(id);
  const key = id + '/' + phoneId;
  const last = m.get(phoneId) || 0;
  const wasOnline = phoneWasOnline.has(key) && (now - last) < PHONE_TTL;
  m.set(phoneId, now);
  if (wasOnline) return false;
  phoneWasOnline.add(key);
  logEvent(`[连接] 设备 ${id} 的手机 ${phoneId} 已连接（手机端在线）`);
  // P0-c：主动唤醒电脑端挂起的长轮询 → 手机上线**秒级**可见（原来要等 5s 轮询）。
  // subscribersOnly：只唤醒声明过 `?phones=1` 的新客户端，老脚本不受打扰。
  forwardChannel.notify(id, { type: 'phones', phones: listPhones(id).phones }, { subscribersOnly: true });
  return true;
}

/**
 * 静默刷新在线时间戳（不写上线日志、不唤醒）。用于 `/phone/poll` 的请求结束：
 * 长轮询返回后客户端要重连，中间有几毫秒「不在等待集合里」的空窗（此刻挂起判定救不了它），
 * 若 sweep 恰好跑到，仅靠 PHONE_TTL 会误判离线并打出假的「已断开」日志。
 * ⚠️ **只在仍登记时刷新**（已判离线的不复活），否则一个刚被杀掉的手机页会被「僵尸复活」。
 */
function refreshPhone(id, phoneId) {
  const m = phoneOnline.get(id);
  if (m && m.has(phoneId)) m.set(phoneId, Date.now());
}

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
// 曾经在线过的「电脑/手机」组合，用于「离线」只告警一次。键 = deviceId + '/' + phoneId
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
//  - 长轮询 maxwait 钳制 [1000,60000]（默认 25000），到期返回 {empty:true}；
//    （P3，v26.10.15-v1：上限 30000 → 60000。长轮询是闭环，请求数 ≈ 时长/maxwait，
//     故放宽挂起时长**线性**减少请求数。nginx 侧无风险：1Panel openresty 在 http 级设了
//     `proxy_read_timeout 3600s` 且本站点 location 未覆盖；2026-10-14 实测线上 maxwait=30000
//     挂满 30.13s 正常回 200 {empty:true}。默认值仍 25000 —— 老客户端不带该参数时行为不变。）
//  - notify() 可让服务器**在业务条目之外**提前结束挂起的长轮询（P0-a，上下线事件推送）。
//
// 相对旧实现（每连接 400ms tick 轮询）的改进：投递本就由「POST 入队时同步 deliver」与
// 「连接注册时立即查队」两条同步路径全覆盖，tick 定时器属空转；现改为
// 「注册即查队 + 单次 maxwait 定时器」，过期清理由全局周期 sweep 承担，
// N 个等待连接不再挂 N 个 400ms 定时器。
function createChannel(labels, opts) {
  // labels: { recv, dropQ, sendImg(uuid,item,len), sendTxt(uuid,item) } —— 日志文案（正反向措辞不同）
  // opts:
  //   perRecipient   —— true 时按「接收者（手机）」定向投递（反向通道用）；默认 false = 保持原「广播」语义
  //   recipientFromUrl(u) —— 从长轮询 URL 里取接收者标识；返回 null 表示该请求缺少接收者身份
  //   decorate(uuid, obj) —— 给本通道每个 JSON 响应挂附加字段（P0-b piggyback）；返回对象则合并
  const perRecipient = !!(opts && opts.perRecipient);
  const recipientFromUrl = (opts && opts.recipientFromUrl) || null;
  // P0-b：给本通道的**每一个** JSON 响应挂附加字段（piggyback）。返回 null/非对象即不挂。
  // 正向通道用它捎带在线手机名单 —— 长轮询本来就每 ≤maxwait 秒回一次，白搭一辆车，
  // 客户端因此不必再去 5s 轮询 /phone/status。
  const decorate = (opts && opts.decorate) || null;
  const pending = new Map(); // deviceId -> Array<item> 待取走的条目队列（FIFO）
  const waiting = new Map(); // deviceId -> Set<res> 当前正在长轮询等待的连接（用于「广播」）
  // 队列内全部条目的字节数总和（v26.10.14-v6）：配合 MAX_QUEUE_BYTES 防「体积上限提到 100MB 后
  // 仅靠条数上限挡不住的内存爆」。入队加、任何出队路径（deliver 投递 / sweepExpired / dropExpired /
  // enqueue 自身丢最旧）都要减——这里集中用 queueBytes -= itemBytes(it) 记账。
  let queueBytes = 0;

  function itemBytes(it) {
    if (it && typeof it.data === 'string') return it.data.length;
    if (it && typeof it.text === 'string') return it.text.length;
    return 0;
  }

  /** 从队列中移除第 i 条并同步字节账（所有出队路径统一走它，避免漏减导致预算虚高） */
  function removeAt(q, i) {
    queueBytes -= itemBytes(q[i]);
    q.splice(i, 1);
  }

  /**
   * 本通道 JSON 响应的**统一出口**：先把 `decorate(uuid)` 的附加字段并入 obj 再写。
   * 所有「会结束一次长轮询」的回复（投递 / 超时 empty / 主动唤醒）都必须走这里，
   * 少走一处就会出现「那条长轮询没捎带名单」的缝隙。
   */
  function reply(res, uuid, code, obj) {
    if (decorate) {
      let extra = null;
      try { extra = decorate(uuid, obj); } catch (e) { extra = null; }
      if (extra && typeof extra === 'object') obj = Object.assign({}, obj, extra);
    }
    sendJson(res, code, obj);
  }

  // 清理队列中全部已过期条目，清空则移除 Map 键（内存回收；由全局周期任务调用）
  function sweepExpired() {
    const now = Date.now();
    for (const [uuid, q] of pending) {
      for (let i = q.length - 1; i >= 0; i--) {
        if (now - q[i].ts >= PENDING_TTL) removeAt(q, i);
      }
      if (q.length === 0) pending.delete(uuid);
    }
  }

  // 丢弃队列里全部已过期条目（保证绝不投递过期内容）
  function dropExpired(q) {
    const now = Date.now();
    for (let i = q.length - 1; i >= 0; i--) {
      if (now - q[i].ts >= PENDING_TTL) removeAt(q, i);
    }
  }

  /** 单条 item 是否已投完：无 targets 概念（正向）或 targets='all' 由调用方处理，这里只管定向条目 */
  function fullyDelivered(item) {
    return Array.isArray(item.targets) && item.targets.every(id => item.deliveredTo.has(id));
  }

  // 投递：无人等待则保留队列，等下个连接来取（不会漏）。直接回传整条 item
  // （含 type: 'image' | 'text'），由接收端按 type 分流处理。
  //
  // 【正向（perRecipient=false）】保持既有语义不变：取队头一条「广播」给所有在等连接
  //   （每个连接各得一份拷贝），同一设备多标签页同时接收互不抢图。
  // 【反向（perRecipient=true）】按手机定向：
  //   · `targets === 'all'` 的条目按老语义整条广播给所有在等连接，然后出队；
  //     ⚠️ 广播条目**不要求它在队头**——否则前面卡着一条「发给某台离线手机」的定向条目时，
  //     广播图会被一起拖住（离线手机最长要等 PENDING_TTL 才过期）。
  //   · 定向条目只投给 targets 里包含的、且尚未投过的手机；每个等待连接各领一条属于它的；
  //     没它份的连接**继续等待**（不结束它的长轮询）。
  //   · 定向条目在「所有目标手机都收过」时才出队 —— 目标手机离线时条目留在队列等它上线（TTL 内）。
  function deliver(uuid) {
    const q = pending.get(uuid);
    if (!q || q.length === 0) { pending.delete(uuid); return; }
    dropExpired(q);
    if (q.length === 0) { pending.delete(uuid); return; }
    const set = waiting.get(uuid);
    if (!set || set.size === 0) return; // 当前无等待连接：保留队列，等下个连接
    // 先筛出仍可写的目标连接再出队：若等待者此刻全部已结束/断开（res 'close' 尚未触发的窄窗口），
    // 直接放弃本次投递并保留队头，等下个连接来取——避免队头被 shift 后无人能收造成丢条（B6）。
    const conns = Array.from(set).filter(r => !r.writableEnded && !r.destroyed);
    if (conns.length === 0) { waiting.delete(uuid); return; }

    if (!perRecipient) {
      // 每次只投递队头一条（长轮询协议每个响应回一条）；接收端收到后会立刻重新轮询取下一条
      const p = q.shift();
      if (q.length === 0) pending.delete(uuid);
      waiting.delete(uuid);
      for (const r of conns) {
        try { reply(r, uuid, 200, p); }
        catch (e) { /* 已断开的连接，忽略 */ }
      }
      logEvent(`[投递] 设备 ${uuid} 已向 ${conns.length} 个${labels.recv}投递条目（${p.type}）${q.length ? `，队列剩余 ${q.length} 条` : ''}`);
      return;
    }

    // ===== 反向：定向投递 =====
    let sent = 0;
    // ① 优先处理广播条目
    const allIdx = q.findIndex(it => it.targets === 'all');
    if (allIdx >= 0) {
      const p = q.splice(allIdx, 1)[0];
      if (q.length === 0) pending.delete(uuid);
      waiting.delete(uuid);
      for (const r of conns) {
        try { reply(r, uuid, 200, p); sent++; }
        catch (e) { /* 已断开的连接，忽略 */ }
      }
      logEvent(`[投递] 设备 ${uuid} 已向 ${sent} 个${labels.recv}投递条目（${p.type}·发给全部手机）${q.length ? `，队列剩余 ${q.length} 条` : ''}`);
      return;
    }
    // ② 定向条目：每个等待连接各领一条属于自己的
    for (const r of conns) {
      const rid = r.__recipient;
      const idx = q.findIndex(it =>
        Array.isArray(it.targets) && it.targets.indexOf(rid) >= 0 && !it.deliveredTo.has(rid)
      );
      if (idx < 0) continue; // 没有发给它的条目：保持等待（不结束这次长轮询）
      const p = q[idx];
      try { reply(r, uuid, 200, p); sent++; }
      catch (e) { continue; }
      set.delete(r);
      p.deliveredTo.add(rid);
      if (fullyDelivered(p)) q.splice(q.indexOf(p), 1);
    }
    if (q.length === 0) pending.delete(uuid);
    else if (set.size === 0) waiting.delete(uuid);
    if (sent > 0) {
      logEvent(`[投递] 设备 ${uuid} 已向 ${sent} 个${labels.recv}投递定向条目${q.length ? `，队列剩余 ${q.length} 条` : ''}`);
    }
  }

  // 入队（FIFO）：超出 MAX_QUEUE 条或 MAX_QUEUE_BYTES 字节即丢弃最旧一条；
  // 入队后若存在等待连接立即投递。
  // v26.10.14-v6：MAX_BODY 从 12MB 提到 100MB 后，仅靠条数上限（100 条）不再能防内存爆，
  //   故补一层字节预算：按 queueBytes 累计，从队头（最旧）丢到落回预算内为止。
  //   （itemBytes / queueBytes 定义在 createChannel 顶部，见 removeAt 附近。）
  function enqueue(uuid, item) {
    if (!pending.has(uuid)) pending.set(uuid, []);
    const q = pending.get(uuid);
    q.push(item);
    queueBytes += itemBytes(item);
    while (q.length > MAX_QUEUE || (queueBytes > MAX_QUEUE_BYTES && q.length > 1)) {
      const dropped = q.shift();
      queueBytes -= itemBytes(dropped);
      logEvent(`[丢弃] 设备 ${uuid} ${labels.dropQ}已满（>${MAX_QUEUE} 条 / >${Math.round(MAX_QUEUE_BYTES / 1024 / 1024)}MB），丢弃最旧条目（${dropped.type}）`);
    }
    if (item.type === 'image') {
      logEvent(labels.sendImg(uuid, item, q.length));
    } else {
      logEvent(labels.sendTxt(uuid, item));
    }
    deliver(uuid); // 落库后若存在在等待的接收端，立即广播（避免条目留在队列无人来取）
  }

  // 长轮询：注册进等待集合 → 立即查队（有货即投递）→ 无货挂单次 maxwait 定时器到期回 empty。
  // @returns {boolean} false 表示拒绝了该请求（缺少接收者身份，已回 400），调用方不要再处理
  function handlePoll(req, res, uuid, u) {
    let maxwait = parseInt(u.searchParams.get('maxwait') || '', 10);
    if (!Number.isFinite(maxwait)) maxwait = 25000;
    // P3（v26.10.15-v1）：上限 30000 → 60000。放宽的是**上限**不是默认值，老客户端不受影响。
    // 新端（脚本 45s / 手机页 45s）保守取 45s，给反代与客户端超时留出余量。
    maxwait = Math.min(Math.max(maxwait, 1000), 60000);

    // 接收者身份（反向通道 = 手机 ID）：定向投递必须知道是谁在轮询。
    // ⚠️ 缺失即拒收（v26.10.06-v4 起手机页必须升级；服务端不再兼容不带手机 ID 的老页面）。
    // v26.10.15-v2（P4）：身份也可由**路由预先**挂在 res 上 —— /phone/poll 把 phoneId 放在
    // body 里，路由解析后已设 res.__recipient。已有就直接用，否则新端点会因 URL 上没有
    // phoneId 而被 400 拒掉。
    if (recipientFromUrl && !res.__recipient) {
      const rid = recipientFromUrl(u);
      if (!rid) {
        sendJson(res, 400, { error: 'missing phoneId：手机页版本过旧，请刷新手机页面后重试' });
        return false;
      }
      res.__recipient = rid;
    }

    if (!waiting.has(uuid)) waiting.set(uuid, new Set());
    waiting.get(uuid).add(res);
    // P0-c 协商标记：客户端带 `?phones=1` 表示「我认识 type:'phones' 这种主动唤醒」。
    // ⚠️ 老客户端不带该参数 → 服务端**绝不**主动唤醒它：它收到不认识的载荷只会 1s 后重连，
    //    被无谓唤醒反而放大请求数，与本次优化目标背道而驰。（`res.__recipient` 同款挂标记做法。）
    res.__wakeSub = u.searchParams.get('phones') === '1';

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
      if (res.writableEnded) return true; // 已投递给本连接，响应结束（res 'close' 会做清理）
    }

    // 无货/未投出：挂单次 maxwait 定时器，到期返回空响应（客户端收到后自行重连轮询）
    timer = setTimeout(() => {
      timer = null;
      if (res.writableEnded || res.destroyed) { cleanup(); return; }
      try { reply(res, uuid, 200, { empty: true }); } catch (e) { /* 已断开，忽略 */ }
      cleanup();
    }, maxwait);
    return true;
  }

  /**
   * 主动唤醒（P0-a）：立即结束该设备当前挂起的全部长轮询，并回一条 payload。
   *
   * 用途：手机**上线 / 下线**这类「没有业务条目、但接收端必须立刻知道」的事件 ——
   * 长轮询本身就挂在服务器上，服务器随时可以提前收尾，延迟上等价于 WebSocket 推送
   * （亚秒级），却零依赖、零 CSP 风险、零协议变更。
   *
   * @param {string} uuid 设备 ID
   * @param {object} payload 回给客户端的 JSON（如 `{ type:'phones', phones:[...] }`）
   * @param {{subscribersOnly?: boolean}} [o] subscribersOnly=true 时只唤醒声明过 `?phones=1` 的连接
   * @returns {number} 实际被唤醒的连接数（0 = 当时没有在等的连接，属正常情况）
   */
  function notify(uuid, payload, o) {
    const set = waiting.get(uuid);
    if (!set || set.size === 0) return 0;
    // ⚠️ 与 deliver 用**同一份**连接有效性过滤（B6 的教训：绝不向已结束/已销毁的 res 写）
    const conns = Array.from(set).filter(
      r => !r.writableEnded && !r.destroyed && (!o || !o.subscribersOnly || r.__wakeSub === true)
    );
    if (conns.length === 0) return 0;
    let n = 0;
    for (const r of conns) {
      try { reply(r, uuid, 200, payload); n++; } catch (e) { continue; }
      // 逐个摘除（不是整表 delete）——非订阅连接必须留在等待集合里继续等业务条目
      set.delete(r);
    }
    if (set.size === 0) waiting.delete(uuid);
    if (n > 0) {
      logEvent(`[唤醒] 设备 ${uuid} 已提前结束 ${n} 个${labels.recv}长轮询（${(payload && payload.type) || 'event'}）`);
    }
    return n;
  }

  return { pending, waiting, enqueue, deliver, handlePoll, sweepExpired, notify };
}

// 正向通道：手机 → 电脑（POST /u 入队，GET /recv 长轮询取走）
// v26.10.13-v3：入队时带上发送者手机 ID（item.from，见 parseItemBody 的 withPhoneId），
// 投递时随条目回传，电脑端按它把内容归到对应手机的会话（多台在线不再全进聚合会话）。
const forwardChannel = createChannel(
  {
    recv: '电脑端接收端',
    dropQ: '暂存队列',
    sendImg: (uuid, item, len) => `[发送] 设备 ${uuid} 手机端发送图片：${cleanLogName(item.name)}（${item.mime}，约 ${b64SizeKB(item.data)}KB）${fromText(item)}，队列 ${len} 条`,
    sendTxt: (uuid, item) => `[发送] 设备 ${uuid} 手机端发送文本：${previewText(item.text)}${fromText(item)}`
  },
  {
    // P0-b：正向长轮询的**每个**响应都捎带当前在线手机名单（含投递条目与 {empty:true} 超时）。
    // 电脑端因此不必再 5s 轮询 /phone/status —— 长轮询本就每 ≤25s 回一次，白搭一辆车。
    // ⚠️ 纯新增字段：老脚本 JSON.parse 后忽略未知字段；老**中继**不返回该字段时，
    //    电脑端有 60s 兜底轮询（见 src/lib/transfer/store.ts 的 startPhonesWatch），
    //    故两端可各自独立升级。⚠️ 必须走 createChannel 的**第二参数** opts（不是 labels）。
    decorate: (uuid) => ({ phones: listPhones(uuid).phones })
  }
);

// 反向通道：电脑 → 手机（POST /phone/send 入队，GET /phone/recv 长轮询取走）
// v26.10.06-v4 起开启**按手机定向投递**：条目带 targets，长轮询按 URL 上的 phoneId 过滤。
const reverseChannel = createChannel({
  recv: '手机端接收端',
  dropQ: '手机收件队列',
  sendImg: (uuid, item, len) => `[发送] 设备 ${uuid} 电脑端发送图片到手机：${cleanLogName(item.name)}（${item.mime}，约 ${b64SizeKB(item.data)}KB）${targetsText(item)}，队列 ${len} 条`,
  sendTxt: (uuid, item) => `[发送] 设备 ${uuid} 电脑端发送文本到手机：${previewText(item.text)}${targetsText(item)}`
}, {
  perRecipient: true,
  // 手机身份从长轮询 URL 的 phoneId 取；⚠️ 缺失 = 老手机页，服务端拒收（不兼容）
  recipientFromUrl: (u) => {
    const id = u.searchParams.get('phoneId') || '';
    return /^[a-zA-Z0-9_-]{8,64}$/.test(id) ? id : null;
  }
});

/** 发送日志里附上目标手机信息（供上面两个 sendImg/sendTxt 文案用） */
function targetsText(item) {
  if (!item || !item.targets || item.targets === 'all') return '（发给全部手机）';
  return `（发给 ${item.targets.length} 台手机）`;
}

/** 正向发送日志里附上发送者手机 ID（v26.10.13-v3；反向是电脑发的，用 targetsText） */
function fromText(item) {
  return item && item.from ? `（来自手机 ${shortId(item.from)}）` : '';
}

/** 归一化手机 ID（与心跳 recipientFromUrl 同一套校验）：非法/缺失一律回落空串（按「未知发送者」处理） */
function normalizePhoneId(id) {
  const s = String(id || '');
  return /^[a-zA-Z0-9_-]{8,64}$/.test(s) ? s : '';
}

// 解析 POST 正文为待投递条目（图片 {data,mime,name} 或文本 {text}）；非法时已回 4xx 并返回 null。
// /u 与 /phone/send 两个 POST 路由共用。
//   opts.withPhoneId —— 仅正向（/u 上传）为 true：把载荷里的 phoneId 归一化后写进 item.from，
//   随长轮询投递回电脑端（v26.10.13-v3）；反向（/phone/send）发送者是电脑，没有这个概念。
async function parseItemBody(req, res, opts) {
  let buf;
  try {
    buf = await readBody(req);
  } catch (e) {
    // 请求体超限（> MAX_BODY）：明确回 413（Payload Too Large）而非通用 500/静默断开。
    // 旧实现 req.destroy() 会掐断连接，客户端只见笼统的「网络错误」，无从定位是体积问题。
    if (e && e.statusCode === 413) sendJson(res, 413, { error: '内容过大，超过单次上限（约 100MB），请压缩后再发送' });
    else if (e && e.statusCode === 408) sendJson(res, 408, { error: '读取请求超时，请检查网络后重试' });
    else sendJson(res, 400, { error: '读取请求失败' });
    return null;
  }
  let payload;
  try { payload = JSON.parse(buf.toString('utf8')); }
  catch (e) { sendJson(res, 400, { error: 'invalid json' }); return null; }
  // 目标手机（仅 /phone/send 用；/u 方向没有这个概念，带了也忽略）：
  //   'all'（缺省） = 发给全部在线手机；数组 = 只发给这些手机 ID。
  // 非法值一律归一化为 'all'（宁可发多，不要因为参数写错而静默丢消息）。
  const targets = normalizeTargets(payload.targets);
  // 发送者手机 ID（仅正向 /u）：老手机页不带 → 空串（电脑端按「只有 1 台在线归那台、否则聚合」的旧规则归组）
  const from = opts && opts.withPhoneId ? normalizePhoneId(payload.phoneId) : '';
  if (typeof payload.text === 'string' && payload.text.length > 0) {
    // 文本
    return { type: 'text', text: payload.text.slice(0, MAX_BODY), ts: Date.now(), targets, deliveredTo: new Set(), from };
  }
  if (typeof payload.data === 'string') {
    // 带 data 的载荷 = 二进制（base64）。v26.10.14-v6 起按 mime 分流：
    //   image/* → type 'image'（电脑端走图片气泡/九宫格）；其它 → type 'file'（走文件卡片）。
    // 缺 mime 时按图片处理（兼容只发图片的老手机页）。
    const mime = String(payload.mime || 'image/jpeg').slice(0, 100);
    const isImage = /^image\//i.test(mime);
    return {
      type: isImage ? 'image' : 'file',
      name: String(payload.name || (isImage ? 'image.jpg' : 'file.bin')).slice(0, 200),
      mime,
      data: payload.data.slice(0, MAX_BODY),
      ts: Date.now(),
      targets,
      deliveredTo: new Set(),
      from,
      // v26.10.14-v1：表情包图片标记（手机页/脚本端发表情时带上）。
      // 电脑端「全部文件」据此过滤掉表情包，不混进正常传输的文件列表。
      emoji: payload.emoji === true
    };
  }
  sendJson(res, 400, { error: 'missing data or text' });
  return null;
}

/** 归一化 targets：'all' 或去重后的手机 ID 数组（非法一律回落到 'all'） */
function normalizeTargets(t) {
  if (t === 'all' || t === undefined || t === null) return 'all';
  if (!Array.isArray(t)) return 'all';
  const ids = t
    .map(x => String(x || ''))
    .filter(x => /^[a-zA-Z0-9_-]{8,64}$/.test(x));
  const uniq = Array.from(new Set(ids));
  return uniq.length ? uniq : 'all';
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
    // 表情图片同样跳过：开一次面板可能并发几十张，逐条记没信息量（补图/预热另有 [表情包] 日志）。
    // ⚠️ packs.json / status / refresh 不在噪声内（带点或不带斜杠，匹配不上图片形态），仍会记录。
    const ACCESS_NOISE = /^\/(recv|phone\/recv|phone\/heartbeat|phone\/status)(\/|$)|^\/emoji\/[a-zA-Z0-9_-]+\/[A-Za-z0-9._-]+$/i;
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

    // ===== 在线表情包缓存（v26.10.14-v1）：客户端不再直连公网 CDN，防限流 =====
    // 协议契约见 emoji-store.js 头部注释。图片路由放在 /assets 之后、/u 之前，
    // 与静态路由互不干扰（/emoji/ 前缀专属）。

    // /emoji/packs.json ：合并清单（脚本端与手机页的共同数据源；中继优先、CDN 兜底）
    if (method === 'GET' && path === '/emoji/packs.json') {
      emoji.loadManifestForServe().then((manifest) => {
        if (!manifest) { sendJson(res, 503, { error: '表情包清单暂不可用（预热中或 CDN 拉取失败），请稍后重试' }); return; }
        sendJson(res, 200, manifest);
      });
      return;
    }
    // /emoji/status ：缓存状态（排障 / 冒烟等待就绪）
    if (method === 'GET' && path === '/emoji/status') {
      sendJson(res, 200, emoji.status());
      return;
    }
    // /emoji/refresh ：手动强制刷新（重拉清单 + 补缺失图；60s 内只接受一次）
    if (method === 'POST' && path === '/emoji/refresh') {
      const r = emoji.requestRefresh();
      if (!r.ok) { sendJson(res, 429, { error: r.reason }); return; }
      sendJson(res, 200, { ok: true, message: '已开始刷新（清单 + 缺失图片）' });
      return;
    }
    // /emoji/<合集id>/<文件名> ：表情图片本体；本地没有 → 按需从 CDN 补一张再回（single-flight）
    const em = /^\/emoji\/([a-zA-Z0-9_-]{1,40})\/([A-Za-z0-9._-]{1,80})$/i.exec(path);
    if (em && (method === 'GET' || method === 'HEAD')) {
      const packId = em[1];
      const fileName = em[2];
      // 双重校验：emoji-store 内部也会校验（防御未来改错正则），这里先拦掉明显非法的
      if (!emoji.validPackId(packId) || !emoji.validFileName(fileName)) {
        res.writeHead(403); res.end('forbidden');
        return;
      }
      emoji.ensureImage(packId, fileName).then((r) => {
        if (!r.ok) {
          // 清单里没有 → 404；CDN 补图失败 → 502（客户端据此回退到 src 直连）
          sendJson(res, r.reason === '清单中无此图' ? 404 : 502, { error: r.reason });
          return;
        }
        const type = ASSET_MIME[nodePath.extname(fileName).toLowerCase()] || 'application/octet-stream';
        // 文件名 = 合集id + key（内容不变），可长缓存；CDN 换图会换 key，自然换 URL
        const headers = { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' };
        if (method === 'HEAD') { res.writeHead(200, headers); res.end(); return; }
        const stream = fs.createReadStream(r.file);
        stream.on('error', () => {
          if (!res.writableEnded) { res.writeHead(500); res.end('read error'); }
        });
        res.writeHead(200, headers);
        stream.pipe(res);
      });
      return;
    }
    if (em) { sendMethodNotAllowed(res, 'GET, HEAD'); return; }

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
        // withPhoneId：把手机页自报的 phoneId 写进 item.from，随 /recv 投递回电脑端（v26.10.13-v3）
        const item = await parseItemBody(req, res, { withPhoneId: true });
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
    // 语义详见 createChannel 注释。v26.10.13-v3：条目带 `from`（发送者手机 ID），电脑端按它归组到对应会话。
    const r = /^\/recv\/([a-z0-9-]{8,64})$/i.exec(path);
    if (r && method === 'GET') {
      forwardChannel.handlePoll(req, res, r[1], u);
      return;
    }
    if (r) { sendMethodNotAllowed(res, 'GET'); return; }

    // ===== 反向通道：电脑端 → 手机端 =====

    // /phone/heartbeat/<deviceId> ：手机页面向服务器报活（证明**这台手机**在线）。
    // ⚠️ v26.10.06-v4 起：body 必须带 `{ phoneId }`（手机页持久化的 UUID）。
    //    缺失即 400 —— 老手机页（心跳体是 `{}`）不再被注册，会在手机端显示连接失败，需刷新页面升级。
    const hb = /^\/phone\/heartbeat\/([a-z0-9-]{8,64})$/i.exec(path);
    if (hb && method === 'POST') {
      const id = hb[1];
      let phoneId = '';
      try {
        const buf = await readBody(req);
        let body = {};
        try { body = JSON.parse(buf.toString('utf8')) || {}; } catch (e) { body = {}; }
        phoneId = String(body.phoneId || '');
      } catch (e) {
        sendJson(res, e && e.statusCode === 413 ? 413 : 400, { error: '读取心跳请求体失败' });
        return;
      }
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(phoneId)) {
        sendJson(res, 400, { error: 'missing phoneId：手机页面版本过旧，请刷新手机页面后重试' });
        return;
      }
      // v26.10.15-v2：报活逻辑抽成 touchPhone（与 /phone/poll 共用，避免两处各写一份漂移）
      const m = phoneMap(id);
      touchPhone(id, phoneId);
      sendJson(res, 200, { ok: true, phoneId: phoneId, phoneCount: m.size });
      return;
    }
    if (hb) { sendMethodNotAllowed(res, 'POST'); return; }

    // /phone/status/<deviceId> ：电脑端查询**有哪些手机在线**（用于显示数量 + 发送时选择目标）
    // 返回 { online, phones:[{id,lastSeen}] }；`online` 保留给老脚本（= phones.length > 0）。
    // ⚠️ v26.10.14-v7 起电脑端**不再 5s 轮询这个接口**（那是 8h 里 5760 次请求的最大头）：
    //    名单改由正向长轮询 piggyback 实时捎带（见 createChannel 的 decorate）+ 上下线唤醒；
    //    这里只在「窗口打开」与「兜底 60s」时被按需调用，接口本身语义与形态完全不变。
    const st = /^\/phone\/status\/([a-z0-9-]{8,64})$/i.exec(path);
    if (st && method === 'GET') {
      sendJson(res, 200, listPhones(st[1]));
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

    // /phone/poll/<deviceId> ：手机端**报活 + 收件**合一（v26.10.15-v2 轮询优化 P4）。
    // 一次 POST 同时完成「声明我在线」与「挂起等电脑发来的内容」：有消息立刻返回，
    // 没消息则挂到 maxwait 到期回 {empty:true}。手机端因此只挂**一条**连接
    // （旧模型是 8s 心跳 + 45s 长轮询两条并行），8h 请求数再减 3600 次 —— 心跳整条消失。
    //
    // ⚠️ **在线判定语义随之改变**（这是 P4 唯一的风险点）：
    //    旧模型 = 「距上次心跳 < PHONE_TTL(20s) 算在线」；
    //    新模型下一次 poll 可挂满 maxwait(45s) ≫ TTL ⇒ 只看时间戳必然误判离线。
    //    故 sweep 增加「**挂起中的 poll 视为在线**」判定（见 res.__pollAlive 与周期清扫），
    //    再加上请求结束时 refreshPhone 补掉「返回 → 重连」的毫秒空窗。
    //    结果：手机页关闭后仍是 ~20s（TTL）+ ~5s（清扫周期）后判离线，与改动前一致。
    //
    // ⚠️ 兼容性：老中继**没有**这个端点 ⇒ 新手机页会收到 404 并**自动降级**回
    //    「心跳 + /phone/recv」老模型（见 web/src/lib/relay.ts）。老手机页完全不受影响 ——
    //    /phone/heartbeat 与 /phone/recv 两个端点都原样保留。
    const pp = /^\/phone\/poll\/([a-z0-9-]{8,64})$/i.exec(path);
    if (pp && method === 'POST') {
      const id = pp[1];
      let phoneId = '';
      try {
        const buf = await readBody(req);
        let body = {};
        try { body = JSON.parse(buf.toString('utf8')) || {}; } catch (e) { body = {}; }
        phoneId = String(body.phoneId || '');
      } catch (e) {
        sendJson(res, e && e.statusCode === 413 ? 413 : 400, { error: '读取请求体失败' });
        return;
      }
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(phoneId)) {
        sendJson(res, 400, { error: 'missing phoneId：手机页面版本过旧，请刷新手机页面后重试' });
        return;
      }
      // ① 报活（与 /phone/heartbeat 完全同一套：上线记日志 + 唤醒电脑端）
      touchPhone(id, phoneId);
      // ② 请求结束时静默刷新时间戳，补掉「长轮询返回 → 客户端重连」之间的毫秒空窗
      res.on('close', () => refreshPhone(id, phoneId));
      // ③ 身份在 body 里，路由解析后预置到 res 上（handlePoll 见 res.__recipient 就不再取 URL）
      res.__recipient = phoneId;
      // ④ 挂起取件（与 /phone/recv 共用同一份长轮询实现与定向投递语义）
      res.__pollAlive = phoneId; // sweep 据此判「挂起中 = 在线」
      reverseChannel.handlePoll(req, res, id, u);
      return;
    }
    if (pp) { sendMethodNotAllowed(res, 'POST'); return; }

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
  for (const [id, m] of Array.from(phoneOnline)) {
    // P4（v26.10.15-v2）：挂起中的手机 poll 一律视为在线（理由见 pollAliveSet 注释）。
    const alive = pollAliveSet(id);
    for (const [pid, last] of Array.from(m)) {
      const key = id + '/' + pid;
      if (alive.has(key)) {
        m.set(pid, now); // 续命 —— 让 listPhones 的即时判定与 sweep 的结论保持一致
        continue;
      }
      if (now - last >= PHONE_TTL) {
        m.delete(pid);
        if (phoneWasOnline.has(key)) {
          phoneWasOnline.delete(key);
          logEvent(`[断开] 设备 ${id} 的手机 ${pid} 已断开（离线超时）`);
          // P0-c：下线同样主动唤醒（与上线对称）。清扫周期是 5s，故「真离线」的时刻
          // 精度本就受 PHONE_TTL + 清扫周期限制；唤醒只保证「服务端判定之后」客户端秒级知道。
          forwardChannel.notify(id, { type: 'phones', phones: listPhones(id).phones }, { subscribersOnly: true });
        }
      }
    }
    if (m.size === 0) phoneOnline.delete(id);
  }
  forwardChannel.sweepExpired();
  reverseChannel.sweepExpired();
}, 5 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('[中继服务] v' + VERSION + ' 已启动: http://0.0.0.0:' + PORT);
  // 表情包后台预热（v26.10.14-v1）：拉清单 + 补全量图片到本地磁盘。不阻塞监听；
  // 失败不致命——客户端会走 CDN 兜底，后续请求也会按需补图。进度见 [表情包] 日志。
  emoji.ensureAll();
});
