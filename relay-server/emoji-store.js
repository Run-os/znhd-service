// 在线表情包的「一次性下载 → 本地磁盘托管」存储（v26.10.14-v1，需求：不要每次都请求公网 CDN，怕限流）。
//
// ── 解决什么问题 ──────────────────────────────────────────────────────────────
// 8 个合集（cdn.klyang.com）此前由**每个客户端**各自直连：脚本端走 GM_xmlhttpRequest、
// 手机页走 fetch。每个客户端每次开面板都要打 8 个清单请求 + N 个图片请求，
// 既慢（跨网 + 排队）又有被 CDN 限流的风险。本模块把整套表情包**拉到中继自己磁盘上**，
// 之后所有客户端只打中继（同源、内网、可并发）：
//   · 启动时后台预热一次（清单 + 全部图片，缺什么补什么，自带重试）；
//   · 请求到来时本地没有 → 按需补一张（single-flight，不重复下载）；
//   · 清单 24 小时过期重拉；POST /emoji/refresh 可手动强制刷新（60s 限流）。
//
// ── 客户端契约（脚本端 / 手机页共用）──────────────────────────────────────────
//   · GET  /emoji/packs.json      合并清单 {version,ts,packs:[{id,name,items:[{key,name,path,src}]}]}
//                                 path = 本服务上的图片路径，src = CDN 原址（客户端兜底用）
//   · GET  /emoji/<合集id>/<文件>  图片本体（MIME 按扩展名；缺失按需补图后再回）
//   · GET  /emoji/status          缓存状态（排障/冒烟等待就绪用）
//   · POST /emoji/refresh         强制重拉清单 + 补缺失图片（60s 内只接受一次）
// 客户端**必须**保留 CDN 兜底：中继未部署 / 该图中转失败时直接取 src，功能不回退。
//
// ── 数据位置与部署 ────────────────────────────────────────────────────────────
// 默认 <relay-server>/data/emoji（可用 ZNHD_EMOJI_DIR 覆盖，冒烟用）。
// 该目录已写进 .gitignore：部署工作流的 `git clean -fd` 不清 ignored 文件，缓存跨部署保留；
// 万一丢失（容器重建等）也无妨 —— 启动预热与按需补图会自己补回来。
//
// ── 安全约束 ────────────────────────────────────────────────────────────────
//   · 合集 id / 文件名白名单字符校验 + 扩展名白名单 + join 后前缀校验（目录穿越防护）；
//   · 只从 https 拉取；http 仅放行回环地址（冒烟 fixture 用）——防 src 被塞内网地址打 SSRF；
//   · 单图体积上限 5MB、超时 15/20s、最多 3 次尝试（表情图实测 2–6KB，上限很宽松）。

const http = require('http');
const https = require('https');
const fs = require('fs');
const nodePath = require('path');

/** 合集清单来源（单一来源：脚本端与手机页的兜底清单也引这一份）。ZNHD_EMOJI_SOURCES 可覆盖（冒烟） */
const SOURCES_FILE = process.env.ZNHD_EMOJI_SOURCES || nodePath.join(__dirname, 'emoji-sources.json');
/** 缓存根目录。ZNHD_EMOJI_DIR 可覆盖（冒烟用临时目录，不碰真数据） */
const DATA_DIR = process.env.ZNHD_EMOJI_DIR || nodePath.join(__dirname, 'data', 'emoji');

const MANIFEST_FILE = nodePath.join(DATA_DIR, 'packs.json');
/** 清单过期时间：表情包基本不变，给 24h（过期只影响「新合集可见性」，不影响已缓存图片） */
const MANIFEST_TTL = 24 * 60 * 60 * 1000;
/** 手动刷新最小间隔（防刷新接口被当成 CDN 放大器） */
const REFRESH_MIN_GAP = 60 * 1000;
/** 拉图片并发（清单只有 8 个，直接 Promise.all 全拉，不需要池） */
const IMAGE_CONCURRENCY = 6;
/** 单次下载尝试次数（间隔 500ms/1500ms 退避） */
const ATTEMPTS = 3;
/** 单图体积上限（表情图 2–6KB；上限防「CDN 被塞大文件」打满磁盘） */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MANIFEST_TIMEOUT = 15000;
const IMAGE_TIMEOUT = 20000;

const IMAGE_EXT = { '.webp': 1, '.png': 1, '.jpg': 1, '.jpeg': 1, '.gif': 1, '.svg': 1, '.bmp': 1 };
const PACK_ID_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const FILE_NAME_RE = /^[A-Za-z0-9._-]{1,80}$/;

/* ============================ 日志 ============================ */

function tsNow() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} `;
}
function logEvent(msg) {
    console.log(tsNow() + '[表情包] ' + msg);
}

/* ============================ 名称清洗 ============================ */

/** 文件名净化：与客户端 sanitizeName 同一套规则（保证服务端算出的文件名与客户端一致） */
function sanitizeName(s) {
    return String(s || '')
        .replace(/[\\/:*?"<>|\s]+/g, '_')
        .slice(0, 60) || 'emoji';
}

/** 从图片 URL 取扩展名（小写，不带点）；取不到按 webp（CDN 上表情图以 webp 为主） */
function extOf(url) {
    const m = String(url || '').match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
    return m ? m[1].toLowerCase() : 'webp';
}

/** 合集 id 合法性（URL 上直接来的，必须先校验再碰磁盘） */
function validPackId(id) {
    return PACK_ID_RE.test(String(id || ''));
}

/** 文件名合法性：字符白名单 + 扩展名白名单（目录穿越/任意文件读取都靠它拦） */
function validFileName(name) {
    const s = String(name || '');
    if (!FILE_NAME_RE.test(s)) return false;
    const ext = nodePath.extname(s).toLowerCase();
    return !!IMAGE_EXT[ext];
}

/* ============================ HTTP 拉取（零依赖） ============================ */

/** 是否允许访问该 URL：https 一律放行；http 仅放行回环（冒烟 fixture 用，防 SSRF 打内网） */
function urlAllowed(u) {
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') {
        const h = u.hostname;
        return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
    }
    return false;
}

/**
 * GET 一个 URL 为 Buffer（跟随跳转，最多 5 次；跳转目标同样过 urlAllowed）。
 * @returns {Promise<{status:number, buffer:Buffer}>} 非 2xx 也 resolve（由调用方判 status）
 */
function httpGetBuffer(url, timeoutMs, maxRedirects) {
    return new Promise((resolve, reject) => {
        let u;
        try {
            u = new URL(String(url || ''));
        } catch (e) {
            reject(new Error('非法 URL'));
            return;
        }
        if (!urlAllowed(u)) {
            reject(new Error('仅支持 https（或回环 http）地址: ' + u.protocol));
            return;
        }
        const mod = u.protocol === 'https:' ? https : http;
        const req = mod.request(
            {
                protocol: u.protocol,
                hostname: u.hostname,
                port: u.port || (u.protocol === 'https:' ? 443 : 80),
                path: u.pathname + u.search,
                method: 'GET',
                headers: { 'User-Agent': 'znhd-emoji-store/1', Accept: '*/*' },
            },
            (res) => {
                // 跟随跳转（CDN 常见 301/302/307/308）
                if ([301, 302, 307, 308].indexOf(res.statusCode) >= 0 && res.headers.location && maxRedirects > 0) {
                    res.resume(); // 丢完跳转响应体，别占连接
                    let next;
                    try {
                        next = new URL(res.headers.location, u);
                    } catch (e) {
                        reject(new Error('跳转地址非法'));
                        return;
                    }
                    httpGetBuffer(next.toString(), timeoutMs, maxRedirects - 1).then(resolve, reject);
                    return;
                }
                const chunks = [];
                let size = 0;
                let tooBig = false;
                res.on('data', (c) => {
                    size += c.length;
                    if (size > MAX_IMAGE_BYTES) {
                        tooBig = true;
                        req.destroy();
                        return;
                    }
                    chunks.push(c);
                });
                res.on('end', () => {
                    if (tooBig) {
                        reject(new Error('响应超过单图上限（' + MAX_IMAGE_BYTES + 'B）'));
                        return;
                    }
                    resolve({ status: res.statusCode || 0, buffer: Buffer.concat(chunks) });
                });
                res.on('error', reject);
            }
        );
        req.setTimeout(timeoutMs, () => req.destroy(new Error('请求超时')));
        req.on('error', reject);
        req.end();
    });
}

/** 拉文本（清单 JSON 用；体积同样受 MAX_IMAGE_BYTES 约束，JSON 不可能超过） */
function httpGetText(url, timeoutMs) {
    return httpGetBuffer(url, timeoutMs, 5).then((r) => {
        if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
        return r.buffer.toString('utf8');
    });
}

/* ============================ 清单 ============================ */

function readSources() {
    const raw = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
    const list = Array.isArray(raw) ? raw : [];
    return list
        .map((s) => ({ id: String((s && s.id) || ''), url: String((s && s.url) || '') }))
        .filter((s) => PACK_ID_RE.test(s.id) && /^https?:\/\//i.test(s.url));
}

/** 把一份合集 JSON 规范成 {id,name,items:[{key,name,path,src}]}；结构坏了返回 null */
function normalizePack(id, text) {
    let raw;
    try {
        raw = JSON.parse(text);
    } catch (e) {
        return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    // type 存在且不是 image 时跳过（清单格式约定，防御性保留）
    if (raw.type !== undefined && raw.type !== 'image') return null;
    const list = Array.isArray(raw.items) ? raw.items : [];
    const items = [];
    list.forEach((it) => {
        const rec = it || {};
        const key = String(rec.key || '').trim();
        const src = String(rec.val || '').trim();
        if (!key || !/^https?:\/\//i.test(src)) return; // 脏数据跳过，别让一条坏记录毁掉整个合集
        const ext = extOf(src);
        if (!IMAGE_EXT['.' + ext]) return; // 非图片扩展名不要
        const name = sanitizeName(id + '-' + key) + '.' + ext;
        items.push({ key, name, path: '/emoji/' + id + '/' + name, src });
    });
    if (!items.length) return null;
    return { id, name: String(raw.name || id), items };
}

/** 读磁盘上的合并清单（不存在/损坏返回 null） */
function readManifest() {
    try {
        const m = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
        if (m && Array.isArray(m.packs)) return m;
    } catch (e) {
        /* 不存在或损坏：当作没有 */
    }
    return null;
}

function isFresh(m) {
    return !!m && typeof m.ts === 'number' && Date.now() - m.ts < MANIFEST_TTL;
}

/** 原子写：先写临时文件再 rename，避免进程被杀留下半个 JSON */
function writeJsonAtomic(file, obj) {
    fs.mkdirSync(nodePath.dirname(file), { recursive: true });
    const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
}

/* ============================ 下载执行 ============================ */

/** 简易并发池：limit 个 worker 消化任务数组 */
function runPool(items, limit, worker) {
    let idx = 0;
    let failed = 0;
    const next = () => {
        if (idx >= items.length) return Promise.resolve();
        const it = items[idx++];
        return Promise.resolve()
            .then(() => worker(it))
            .catch(() => {
                failed++;
            })
            .then(next);
    };
    const workers = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(next());
    return Promise.all(workers).then(() => ({ total: items.length, failed }));
}

/** 带重试地拉一个 Buffer（间隔 500ms/1500ms 退避） */
function getWithRetry(url, timeoutMs) {
    let attempt = 0;
    const run = () => {
        attempt++;
        return httpGetBuffer(url, timeoutMs, 5).then((r) => {
            if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
            return r.buffer;
        }).catch((e) => {
            if (attempt >= ATTEMPTS) throw e;
            return new Promise((r) => setTimeout(r, attempt * 1000 - 500)).then(run);
        });
    };
    return run();
}

/** 下载一张图落盘（原子写）；调用方保证 file 已过 validFileName */
function downloadImage(packId, fileName, src) {
    return getWithRetry(src, IMAGE_TIMEOUT).then((buf) => {
        if (!buf || !buf.length) throw new Error('空响应');
        const file = nodePath.join(DATA_DIR, packId, fileName);
        fs.mkdirSync(nodePath.dirname(file), { recursive: true });
        const tmp = file + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, file);
        return file;
    });
}

/* ============================ 预热 / 刷新 ============================ */

let ensureRunning = null; // 进行中的预热（并发调用共享同一个 promise）
let lastEnsure = { ok: false, at: 0, error: '尚未预热' };
let lastRefreshAt = 0;

/**
 * 预热：拉清单（过期/缺失/force 才拉）→ 补全部缺失图片。永不 reject（内部记状态）。
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
function ensureAll(opts) {
    const force = !!(opts && opts.force);
    if (ensureRunning) return ensureRunning; // 已有预热在跑：搭车（force 也搭，见 requestRefresh 的补偿）
    ensureRunning = (async () => {
        try {
            let manifest = readManifest();
            if (force || !isFresh(manifest)) {
                const sources = readSources();
                if (!sources.length) throw new Error('合集清单来源为空（' + SOURCES_FILE + '）');
                logEvent('开始拉取 ' + sources.length + ' 个合集清单…');
                // 单个合集失败就跳过（其余照常显示）；全部失败才让预热失败
                const collected = await collectPacks(sources);
                if (!collected.length) throw new Error('全部合集拉取失败');
                manifest = { version: 1, ts: Date.now(), dir: DATA_DIR, packs: collected };
                writeJsonAtomic(MANIFEST_FILE, manifest);
                logEvent('清单已更新：' + collected.length + ' 个合集 / ' + countItems(collected) + ' 张');
            }
            // 补缺失图片
            const missing = [];
            manifest.packs.forEach((p) => {
                p.items.forEach((it) => {
                    if (!fs.existsSync(nodePath.join(DATA_DIR, p.id, it.name))) missing.push({ packId: p.id, item: it });
                });
            });
            if (missing.length) {
                logEvent('开始补图：缺失 ' + missing.length + ' 张（并发 ' + IMAGE_CONCURRENCY + '）…');
                const r = await runPool(missing, IMAGE_CONCURRENCY, (m) =>
                    downloadImage(m.packId, m.item.name, m.item.src).then((file) => {
                        logEvent('已缓存 ' + nodePath.relative(DATA_DIR, file) + '（' + m.packId + '/' + m.item.key + '）');
                    })
                );
                if (r.failed) logEvent('补图结束：失败 ' + r.failed + ' 张（按需请求仍会重试）');
            }
            lastEnsure = { ok: true, at: Date.now(), error: '' };
            logEvent('预热完成：' + countItems(manifest.packs) + ' 张已缓存（' + manifest.packs.length + ' 个合集）');
            return { ok: true };
        } catch (e) {
            lastEnsure = { ok: false, at: Date.now(), error: String((e && e.message) || e) };
            logEvent('预热失败：' + lastEnsure.error + '（按需请求仍会尝试补图）');
            return { ok: false, error: lastEnsure.error };
        } finally {
            ensureRunning = null;
        }
    })();
    return ensureRunning;
}

/** 并发拉全部合集清单，按 sources 顺序收集成功者（runPool 只报失败数，拿不到逐条结果） */
function collectPacks(sources) {
    return Promise.all(
        sources.map((src) =>
            httpGetText(src.url, MANIFEST_TIMEOUT)
                .then((text) => normalizePack(src.id, text))
                .catch(() => null)
        )
    ).then((list) => list.filter((p) => !!p));
}

function countItems(packs) {
    let n = 0;
    (packs || []).forEach((p) => n += (p.items || []).length);
    return n;
}

/** 手动刷新：等当前预热结束后强制重跑（60s 限流） */
function requestRefresh() {
    const now = Date.now();
    if (now - lastRefreshAt < REFRESH_MIN_GAP) {
        return { ok: false, reason: '刷新太频繁（' + Math.ceil((REFRESH_MIN_GAP - (now - lastRefreshAt)) / 1000) + 's 后再试）' };
    }
    lastRefreshAt = now;
    (ensureRunning || Promise.resolve()).then(() => ensureAll({ force: true }));
    return { ok: true };
}

/* ============================ 查询 / 按需补图 ============================ */

/** 图片在磁盘上的路径（已过校验）；不存在返回 null */
function existingFile(packId, fileName) {
    const file = nodePath.join(DATA_DIR, String(packId), String(fileName));
    // 双保险：join 之后必须仍在 DATA_DIR 内（字符白名单理论上已足够，这里防未来改错正则）
    if (file !== DATA_DIR && file.indexOf(DATA_DIR + nodePath.sep) !== 0) return null;
    return fs.existsSync(file) ? file : null;
}

const imageInflight = new Map(); // pack/file -> Promise，按需补图 single-flight

/**
 * 取一张图：本地有直接回；没有按需从 CDN 补（single-flight）。
 * @returns {Promise<{ok:true, file:string} | {ok:false, reason:string}>}
 */
function ensureImage(packId, fileName) {
    const pid = String(packId || '');
    const fn = String(fileName || '');
    if (!validPackId(pid) || !validFileName(fn)) return Promise.resolve({ ok: false, reason: '非法名称' });
    const hit = existingFile(pid, fn);
    if (hit) return Promise.resolve({ ok: true, file: hit });
    const key = pid + '/' + fn;
    const running = imageInflight.get(key);
    if (running) return running;
    const task = (async () => {
        // 清单里没有这张图 → 补不了（冷启动时先确保清单就绪）
        let manifest = readManifest();
        if (!manifest) {
            await ensureAll();
            manifest = readManifest();
        }
        const item = findItem(manifest, pid, fn);
        if (!item) return { ok: false, reason: '清单中无此图' };
        try {
            const file = await downloadImage(pid, fn, item.src);
            logEvent('按需补图 ' + pid + '/' + fn);
            return { ok: true, file };
        } catch (e) {
            return { ok: false, reason: String((e && e.message) || e) };
        }
    })().finally(() => {
        imageInflight.delete(key);
    });
    imageInflight.set(key, task);
    return task;
}

function findItem(manifest, packId, fileName) {
    if (!manifest || !Array.isArray(manifest.packs)) return null;
    const pack = manifest.packs.find((p) => p.id === packId);
    if (!pack) return null;
    return (pack.items || []).find((it) => it.name === fileName) || null;
}

/**
 * 给 /emoji/packs.json 用的清单：新鲜就直接读盘；否则先跑一次预热再读
 * （预热失败也会退回旧清单——旧清单比没有强）。
 */
function loadManifestForServe() {
    const m = readManifest();
    if (isFresh(m)) return Promise.resolve(m);
    return ensureAll().then(() => readManifest());
}

/** 缓存状态（排障 / 冒烟等待就绪） */
function status() {
    const m = readManifest();
    let items = 0;
    let cached = 0;
    (m && m.packs ? m.packs : []).forEach((p) => {
        (p.items || []).forEach((it) => {
            items++;
            if (existingFile(p.id, it.name)) cached++;
        });
    });
    return {
        ready: !!m && cached > 0,
        dir: DATA_DIR,
        sources: SOURCES_FILE,
        packs: m && m.packs ? m.packs.length : 0,
        items,
        cached,
        missing: items - cached,
        fetching: imageInflight.size,
        manifestTs: m && m.ts ? m.ts : 0,
        lastEnsureAt: lastEnsure.at,
        lastEnsureOk: lastEnsure.ok,
        lastEnsureError: lastEnsure.error,
    };
}

module.exports = {
    DATA_DIR,
    ensureAll,
    ensureImage,
    existingFile,
    loadManifestForServe,
    requestRefresh,
    status,
    validFileName,
    validPackId,
};
