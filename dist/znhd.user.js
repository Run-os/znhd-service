// ==UserScript==
// @name         征纳互动人数和在线监控v2
// @namespace    https://scriptcat.org/
// @version      26.10.20-v1
// @author       runos
// @description  实时监控征纳互动等待人数和在线状态，支持语音播报、自定义常用语
// @license      MIT
// @icon         https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico
// @homepage     https://scriptcat.org/zh-CN/script-show-page/3650
// @homepageURL  https://github.com/Run-os/znhd-service
// @source       https://github.com/Run-os/znhd-service.git
// @supportURL   https://github.com/Run-os/znhd-service/issues
// @downloadURL  https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/dist/znhd.user.js
// @updateURL    https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/dist/znhd.user.js
// @match        https://znhd.hunan.chinatax.gov.cn:8443/*
// @match        https://example.com/*
// @match        https://www.appinn.com/*
// @require      https://fastly.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js#md5=99f96803d123239c14d61d54de76a2bf
// @require      https://fastly.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js#md5=517b55d3688ce9ef1085a3d9632bcb97
// @require      https://fastly.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.js#md5=a2cc4c2e524eb36ffb9396800bf07719
// @require      https://fastly.jsdelivr.net/npm/vue@3.5.13/dist/vue.global.prod.js
// @connect      *
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_info
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-end
// ==/UserScript==

(function (vue) {
  'use strict';

  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  const CONFIG = {
    CHECK_INTERVAL: 3e3,
    MAX_LOG_ENTRIES: 20,

didaUrl: "https://cnb.cool/bbbbaa/work-about/-/git/raw/main/znhd/dida.mp3",
SPEECH_TIMEOUT: 15e3,
MAX_SPEECH_QUEUE: 10,
SPEECH_QUEUE_TTL: 3e4,

MAX_SNIFF_CONV_STEMS: 2e3,

MAX_SNIFF_CONV_ALIASES: 200,

SNIFF_CONV_TTL: 30 * 24 * 60 * 60 * 1e3
  };
  const STORAGE_KEY$1 = "scriptCat_Allvalue";
  const PANEL_POINT_KEY = "scriptCat_PanelPoint";
  const PHRASES_CACHE_KEY = "scriptCat_PhrasesCache";
  const SNIFF_CONV_INDEX_KEY = "scriptCat_SniffConvIndex";
  const DEFAULTS = {
    voiceEnabled: true,
workingHours: {
      morningStart: 9,
      morningEnd: 12,
      afternoonStart: 13.5,
      afternoonEnd: 18
    },


useCdn: true,










logAutoRefresh: true,


sniffMinKB: 20,





sniffPreMeasure: true
  };
  let setLogEntriesCallback = null;
  const RECENT_LOG_COUNT = 5;
  const recentLogMessages = [];
  function addLog(message, type = "info", logenabled = false) {
    const timestamp = ( new Date()).toTimeString().slice(0, 8);
    if (recentLogMessages.indexOf(message) !== -1) {
      console.log("[监控] 重复日志，已忽略:", message);
      return;
    }
    recentLogMessages.push(message);
    if (recentLogMessages.length > RECENT_LOG_COUNT) {
      recentLogMessages.shift();
    }
    const logItem = { timestamp, message, type };
    if (setLogEntriesCallback) {
      setLogEntriesCallback((prevEntries) => {
        const newEntries = [logItem, ...prevEntries];
        if (newEntries.length > CONFIG.MAX_LOG_ENTRIES) {
          newEntries.pop();
        }
        return newEntries;
      });
    }
    if (logenabled) {
      console.log(`[监控] ${timestamp} ${message}`);
    }
  }
  function setLogEntriesSink(cb) {
    setLogEntriesCallback = cb;
  }
  function clearLogs() {
    recentLogMessages.length = 0;
    if (setLogEntriesCallback) {
      setLogEntriesCallback(() => []);
    }
  }
  const scriptRel = (function detectScriptRel() {
    const relList = typeof document !== "undefined" && document.createElement("link").relList;
    return relList && relList.supports && relList.supports("modulepreload") ? "modulepreload" : "preload";
  })();
  const assetsURL = function(dep) {
    return "/" + dep;
  };
  const seen = {};
  const __vitePreload = function preload(baseModule, deps, importerUrl) {
    let promise = Promise.resolve();
    if (deps && deps.length > 0) {
      let allSettled = function(promises$2) {
        return Promise.all(promises$2.map((p) => Promise.resolve(p).then((value$1) => ({
          status: "fulfilled",
          value: value$1
        }), (reason) => ({
          status: "rejected",
          reason
        }))));
      };
      document.getElementsByTagName("link");
      const cspNonceMeta = document.querySelector("meta[property=csp-nonce]");
      const cspNonce = (cspNonceMeta == null ? void 0 : cspNonceMeta.nonce) || (cspNonceMeta == null ? void 0 : cspNonceMeta.getAttribute("nonce"));
      promise = allSettled(deps.map((dep) => {
        dep = assetsURL(dep);
        if (dep in seen) return;
        seen[dep] = true;
        const isCss = dep.endsWith(".css");
        const cssSelector = isCss ? '[rel="stylesheet"]' : "";
        if (document.querySelector(`link[href="${dep}"]${cssSelector}`)) return;
        const link = document.createElement("link");
        link.rel = isCss ? "stylesheet" : scriptRel;
        if (!isCss) link.as = "script";
        link.crossOrigin = "";
        link.href = dep;
        if (cspNonce) link.setAttribute("nonce", cspNonce);
        document.head.appendChild(link);
        if (isCss) return new Promise((res, rej) => {
          link.addEventListener("load", res);
          link.addEventListener("error", () => rej( new Error(`Unable to preload CSS for ${dep}`)));
        });
      }));
    }
    function handlePreloadError(err$2) {
      const e$1 = new Event("vite:preloadError", { cancelable: true });
      e$1.payload = err$2;
      window.dispatchEvent(e$1);
      if (!e$1.defaultPrevented) throw err$2;
    }
    return promise.then((res) => {
      for (const item of res || []) {
        if (item.status !== "rejected") continue;
        handlePreloadError(item.reason);
      }
      return baseModule().catch(handlePreloadError);
    });
  };
  function toast$2(level, content) {
    void __vitePreload(async () => {
      const { toast: t } = await Promise.resolve().then(() => toast$1);
      return { toast: t };
    }, void 0 ).then(({ toast: t }) => t[level](content));
  }
  const notify = {
    success: (msg) => toast$2("success", msg),
    error: (msg) => toast$2("error", msg),
    warning: (msg) => toast$2("warning", msg),
    info: (msg) => toast$2("info", msg)
  };
  function loadPanelPoint() {
    try {
      const saved = localStorage.getItem(PANEL_POINT_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
          return p;
        }
      }
    } catch (error) {
      addLog("读取面板位置失败: " + error.message, "error", true);
    }
    return null;
  }
  let _savePointTimer = null;
  function savePanelPoint(point) {
    if (!point || typeof point.x !== "number" || typeof point.y !== "number") return;
    if (_savePointTimer) return;
    _savePointTimer = requestAnimationFrame(() => {
      _savePointTimer = null;
      try {
        localStorage.setItem(
          PANEL_POINT_KEY,
          JSON.stringify({
            x: Math.round(point.x),
            y: Math.round(point.y)
          })
        );
      } catch (error) {
        addLog("保存面板位置失败: " + error.message, "error", true);
      }
    });
  }
  function loadPhrasesCache() {
    try {
      const saved = localStorage.getItem(PHRASES_CACHE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const d = parsed && parsed.data;
        if (parsed && typeof parsed.time === "number" && d && Array.isArray(d.all) && Array.isArray(d.mine)) {
          return parsed;
        }
      }
    } catch (error) {
      addLog("读取常用语缓存失败: " + error.message, "error", true);
    }
    return null;
  }
  function savePhrasesCache(data) {
    try {
      localStorage.setItem(
        PHRASES_CACHE_KEY,
        JSON.stringify({
          time: Date.now(),
          data
        })
      );
    } catch (error) {
      addLog("保存常用语缓存失败: " + error.message, "error", true);
    }
  }
  function loadAllvalue() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY$1);
      if (saved) {
        const parsed = JSON.parse(saved);
        const merged = { ...DEFAULTS, ...parsed };
        const wh = parsed && typeof parsed.workingHours === "object" && parsed.workingHours;
        if (wh) {
          const defWh = DEFAULTS.workingHours;
          merged.workingHours = {
            morningStart: Number.isFinite(wh.morningStart) ? wh.morningStart : defWh.morningStart,
            morningEnd: Number.isFinite(wh.morningEnd) ? wh.morningEnd : defWh.morningEnd,
            afternoonStart: Number.isFinite(wh.afternoonStart) ? wh.afternoonStart : defWh.afternoonStart,
            afternoonEnd: Number.isFinite(wh.afternoonEnd) ? wh.afternoonEnd : defWh.afternoonEnd
          };
        }
        if ("commonPhrasesUrl" in merged) {
          delete merged.commonPhrasesUrl;
        }
        return merged;
      }
    } catch (error) {
      addLog("加载存储数据失败: " + error.message, "error", true);
    }
    return { ...DEFAULTS };
  }
  let _saveAllvalueTimer = null;
  let _saveAllvaluePending = null;
  function flushSaveAllvalue() {
    if (_saveAllvalueTimer) {
      clearTimeout(_saveAllvalueTimer);
      _saveAllvalueTimer = null;
    }
    if (_saveAllvaluePending === null) return;
    const data = _saveAllvaluePending;
    _saveAllvaluePending = null;
    try {
      localStorage.setItem(STORAGE_KEY$1, JSON.stringify(data));
      addLog("数据已保存到localStorage", "success", true);
    } catch (error) {
      addLog("保存数据失败: " + error.message, "error", true);
      notify.error("保存设置失败: " + error.message);
    }
  }
  function saveAllvalue(data) {
    _saveAllvaluePending = data;
    if (!_saveAllvalueTimer) _saveAllvalueTimer = setTimeout(flushSaveAllvalue, 300);
  }
  const _initAllvalue = loadAllvalue();
  const runtime = {
init: _initAllvalue,
voiceEnabled: _initAllvalue.voiceEnabled,
workingHours: _initAllvalue.workingHours,
useCdn: !!_initAllvalue.useCdn,
logAutoRefresh: !!_initAllvalue.logAutoRefresh
  };
  const speechQueue = [];
  let isSpeaking = false;
  let speechTimer = null;
  function clearSpeechQueue() {
    speechQueue.length = 0;
    isSpeaking = false;
    if (speechTimer) {
      clearTimeout(speechTimer);
      speechTimer = null;
    }
    if ("speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
      }
    }
  }
  function pruneExpiredSpeechItems() {
    if (speechQueue.length === 0) return 0;
    const now = Date.now();
    const before = speechQueue.length;
    for (let i = speechQueue.length - 1; i >= 0; i--) {
      if (now - speechQueue[i].enqueuedAt > CONFIG.SPEECH_QUEUE_TTL) {
        speechQueue.splice(i, 1);
      }
    }
    return before - speechQueue.length;
  }
  function speak(text) {
    if (!runtime.voiceEnabled || !("speechSynthesis" in window)) {
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 1;
    speechQueue.push({ utterance, enqueuedAt: Date.now() });
    while (speechQueue.length > CONFIG.MAX_SPEECH_QUEUE) {
      speechQueue.shift();
      addLog("语音队列已满，丢弃最早的一条旧消息", "warning", true);
    }
    const expired = pruneExpiredSpeechItems();
    if (expired > 0) {
      addLog(`语音队列已清理 ${expired} 条过期消息`, "warning", true);
    }
    processSpeechQueue();
  }
  function processSpeechQueue() {
    if (isSpeaking) {
      return;
    }
    pruneExpiredSpeechItems();
    if (speechQueue.length === 0) {
      return;
    }
    isSpeaking = true;
    const item = speechQueue.shift();
    if (!item) {
      isSpeaking = false;
      return;
    }
    const utterance = item.utterance;
    if (speechTimer) {
      clearTimeout(speechTimer);
    }
    speechTimer = setTimeout(() => {
      addLog("语音播报超时，强制继续队列", "warning", true);
      isSpeaking = false;
      speechTimer = null;
      processSpeechQueue();
    }, CONFIG.SPEECH_TIMEOUT);
    const clearTimer = () => {
      if (speechTimer) {
        clearTimeout(speechTimer);
        speechTimer = null;
      }
    };
    utterance.onend = () => {
      clearTimer();
      isSpeaking = false;
      processSpeechQueue();
    };
    utterance.onerror = (event) => {
      clearTimer();
      isSpeaking = false;
      if (event.error === "not-allowed") {
        speechQueue.length = 0;
      } else {
        processSpeechQueue();
      }
    };
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.speak(utterance);
  }
  function clearSpeechTimer() {
    if (speechTimer) {
      clearTimeout(speechTimer);
      speechTimer = null;
    }
  }
  function getCurrentHour() {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
  }
  function isWorkingHours() {
    const wh = runtime.workingHours;
    if (!wh) return true;
    const currentHour = getCurrentHour();
    return currentHour >= wh.morningStart && currentHour <= wh.morningEnd || currentHour >= wh.afternoonStart && currentHour <= wh.afternoonEnd;
  }
  const domCache = {
    ocurrentElement: null
};
  let lastWaitCount = null;
  function resetWaitCountBaseline() {
    lastWaitCount = null;
  }
  let monitorState = { waiting: null, online: true, inWorkingHours: true, lastSpeak: null };
  let monitorStateSink = null;
  function getMonitorState() {
    return monitorState;
  }
  function setMonitorStateSink(cb) {
    monitorStateSink = cb;
  }
  function publishState(patch) {
    monitorState = { ...monitorState, ...patch };
    if (monitorStateSink) monitorStateSink(monitorState);
  }
  function speakAndTrack(reason, text) {
    speak(text);
    publishState({ lastSpeak: { at: Date.now(), reason } });
  }
  let lastWorkingState = null;
  let lastOfflineAnnounced = false;
  function checkCount() {
    var _a, _b;
    const inWork = isWorkingHours();
    publishState({ inWorkingHours: inWork });
    if (inWork !== lastWorkingState) {
      lastWorkingState = inWork;
      addLog(inWork ? "已进入工作时间，开始监控征纳互动" : "已离开工作时间，暂停监控", inWork ? "success" : "info");
    }
    if (!inWork) return;
    try {
      if (domCache.ocurrentElement && !domCache.ocurrentElement.isConnected) {
        domCache.ocurrentElement = null;
      }
      if (!domCache.ocurrentElement) {
        domCache.ocurrentElement = document.querySelector(".count:nth-child(2)");
      }
      const ocurrentElement = domCache.ocurrentElement;
      if (!ocurrentElement) {
        addLog("找不到人数元素", "warning");
        return;
      }
      const currentText = (ocurrentElement.textContent || "").trim();
      const currentCount = parseInt(currentText, 10);
      if (isNaN(currentCount)) {
        addLog(`无法解析等待人数: "${currentText}"`, "warning");
        return;
      }
      publishState({ waiting: currentCount });
      if (currentCount === 0) {
        if (lastWaitCount !== 0) {
          addLog("当前等待人数为0", "success");
        }
      } else {
        if (currentCount !== lastWaitCount) {
          speakAndTrack("有人进入", "征纳互动有人来了");
        }
        addLog(`当前等待人数: ${currentCount}`, "info");
      }
      lastWaitCount = currentCount;
      const offlineEl = document.querySelector(".t-dialog__body__icon:nth-child(2)") || document.querySelector(".t-dialog__body__icon:nth-of-type(2)");
      const offlineText = offlineEl ? ((_b = (_a = offlineEl == null ? void 0 : offlineEl.innerText) != null ? _a : offlineEl == null ? void 0 : offlineEl.textContent) != null ? _b : "").trim() : "";
      if (offlineText.includes("掉线")) {
        addLog(`掉线提示：${offlineText}`, "error");
        publishState({ online: false });
        if (!lastOfflineAnnounced) {
          lastOfflineAnnounced = true;
          speakAndTrack("已掉线", "征纳互动已掉线");
        }
      } else {
        lastOfflineAnnounced = false;
        publishState({ online: true });
      }
    } catch (error) {
      addLog(`检测错误: ${error.message}`, "error", true);
    }
  }
  let monitoringInterval = null;
  function startMonitoring() {
    checkCount();
    monitoringInterval = setInterval(checkCount, CONFIG.CHECK_INTERVAL);
  }
  function stopMonitoring() {
    if (monitoringInterval) {
      clearInterval(monitoringInterval);
      monitoringInterval = null;
    }
  }
  const PERF_BUFFER_SIZE = 2e4;
  const MAX_PERF_ENTRIES = 2e4;
  const IMG_EXT_RE$1 = /\.(?:jpe?g|png|gif|webp|bmp|ico|avif|tiff?|svg)(?:[?#]|$)/i;
  const VIDEO_INITIATORS$1 = ["video", "audio"];
  const perfBytes = new Map();
  let observer = null;
  let started = false;
  function entryBytes(e) {
    const decoded = Number(e.decodedBodySize || 0);
    if (decoded > 0) return decoded;
    const encoded = Number(e.encodedBodySize || 0);
    if (encoded > 0) return encoded;
    const transfer = Number(e.transferSize || 0);
    return transfer > 0 ? transfer : 0;
  }
  function remember(name, bytes) {
    if (!name || bytes <= 0) return;
    if (!IMG_EXT_RE$1.test(name)) return;
    if (!perfBytes.has(name) && perfBytes.size >= MAX_PERF_ENTRIES) {
      const oldest = perfBytes.keys().next();
      if (!oldest.done) perfBytes.delete(oldest.value);
    }
    perfBytes.set(name, bytes);
  }
  function onEntries(list) {
    try {
      const entries = list && typeof list.getEntries === "function" ? list.getEntries() : [];
      for (const e of entries) {
        const it = String(e.initiatorType || "");
        if (VIDEO_INITIATORS$1.indexOf(it) >= 0) continue;
        remember(String(e.name || ""), entryBytes(e));
      }
    } catch (err) {
    }
  }
  function startPerfCollect() {
    if (started) return;
    started = true;
    try {
      if (typeof performance !== "undefined" && typeof performance.setResourceTimingBufferSize === "function") {
        performance.setResourceTimingBufferSize(PERF_BUFFER_SIZE);
      }
    } catch (e) {
    }
    try {
      if (typeof PerformanceObserver === "undefined") return;
      observer = new PerformanceObserver(onEntries);
      observer.observe({ type: "resource", buffered: true });
    } catch (e) {
    }
  }
  function perfBytesOf(url) {
    if (!url) return null;
    const b = perfBytes.get(url);
    return b && b > 0 ? b : null;
  }
  function perfForEach(fn) {
    perfBytes.forEach((bytes, url) => fn(url, bytes));
  }
  function downloadFileName(name, mime, idx = 0) {
    const extByMime = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/webp": ".webp",
      "image/svg+xml": ".svg",
      "image/bmp": ".bmp"
    };
    let n = String(name || "").trim();
    if (!n) n = "znhd-image-" + (idx + 1);
    if (!/\.[a-z0-9]{2,5}$/i.test(n)) n += extByMime[(mime || "").toLowerCase()] || ".jpg";
    return n;
  }
  const MAX_MEASURED = 2e3;
  const measured = new Map();
  function rememberMeasured(img) {
    if (!img || !img.key) return;
    if (!measured.has(img.key) && measured.size >= MAX_MEASURED) {
      const oldest = measured.keys().next();
      if (!oldest.done) measured.delete(oldest.value);
    }
    measured.set(img.key, img);
  }
  function measuredOf(key) {
    if (!key) return null;
    return measured.get(key) || null;
  }
  const CSS_SCAN_LIMIT = 3e3;
  const MAX_SNIFF = 300;
  const EXCLUDED_NAME_PATTERNS = ["znhd-sniff", "user-woman", "user-man"];
  const EXCLUDED_NAME_SUFFIXES = [".svg"];
  function isExcludedName(name) {
    const n = String(name || "").toLowerCase();
    if (!n) return false;
    if (EXCLUDED_NAME_PATTERNS.some((p) => n.indexOf(p) >= 0)) return true;
    return EXCLUDED_NAME_SUFFIXES.some((s) => n.endsWith(s));
  }
  const LAZY_ATTRS = [
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-actual",
    "data-lazy",
    "data-defer-src",
    "data-load-src",
    "data-echo"
  ];
  const IMG_EXT_RE = /\.(?:jpe?g|png|gif|webp|bmp|ico|avif|tiff?|svg)(?:[?#]|$)/i;
  const VIDEO_EXT_RE = /\.(?:mp4|m4v|webm|ogv|ogg|avi|mov|flv|mkv|wmv|3gp|mpe?g|m3u8|mpd)(?:[?#]|$)/i;
  const VIDEO_INITIATORS = ["video", "audio"];
  const CSS_URL_RE = /url\((['"]?)([^'")]+)\1\)/g;
  const HEAD_TIMEOUT = 8e3;
  const RANGE_TIMEOUT = 15e3;
  const DOWNLOAD_TIMEOUT = 3e4;
  const LOCAL_FETCH_TIMEOUT = 5e3;
  function formatBytes(n) {
    if (n === null || !Number.isFinite(n) || n < 0) return "大小未知";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + " KB";
    return (n / 1024 / 1024).toFixed(2) + " MB";
  }
  function sanitizeFileName(name) {
    return String(name || "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 100);
  }
  function sniffFileName(url, mime, idx = 0) {
    if (/^data:image\/svg\+xml/i.test(url)) return downloadFileName("inline-svg-" + (idx + 1), "image/svg+xml", idx);
    let base = "";
    if (!/^(?:data|blob):/i.test(url)) {
      try {
        const u = new URL(url, location.href);
        const seg = u.pathname.split("/").filter(Boolean).pop() || "";
        base = sanitizeFileName(decodeURIComponent(seg));
      } catch (e) {
        base = "";
      }
    }
    return downloadFileName(base || "znhd-sniff-" + (idx + 1), mime, idx);
  }
  function urlFileStem(url) {
    const s = String(url || "");
    if (!s || /^(?:data|blob):/i.test(s)) return "";
    let seg = "";
    try {
      const u = new URL(s, location.href);
      seg = u.pathname.split("/").filter(Boolean).pop() || "";
    } catch (e) {
      seg = s.split("?")[0].split("/").pop() || "";
    }
    try {
      seg = decodeURIComponent(seg);
    } catch (e) {
    }
    return seg.trim().toLowerCase();
  }
  function normalizeUrl(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (/^data:/i.test(s)) return /^data:image\//i.test(s) ? s : null;
    if (/^blob:/i.test(s)) return s;
    try {
      const abs = new URL(s, location.href);
      return /^https?:$/i.test(abs.protocol) ? abs.href : null;
    } catch (e) {
      return null;
    }
  }
  function isVideoUrl(url) {
    return /^data:video\//i.test(url) || VIDEO_EXT_RE.test(url);
  }
  function looksLikeImageUrl(url) {
    return /^data:image\//i.test(url) || /^blob:/i.test(url) || IMG_EXT_RE.test(url);
  }
  function isClearlyNotImage(mime) {
    if (!mime) return false;
    const m = mime.toLowerCase().split(";")[0].trim();
    if (m.startsWith("image/")) return false;
    return m.startsWith("video/") || m.startsWith("audio/") || m.startsWith("text/") || m === "application/json" || m === "application/xml";
  }
  function utf8Bytes(s) {
    try {
      return new TextEncoder().encode(s).length;
    } catch (e) {
      return s.length;
    }
  }
  function dataUrlBytes(url) {
    const i = url.indexOf(",");
    if (i < 0) return null;
    const meta = url.slice(0, i);
    const payload = url.slice(i + 1);
    if (/;base64/i.test(meta)) {
      const clean = payload.replace(/\s+/g, "");
      const pad2 = (clean.match(/=+$/) || [""])[0].length;
      return Math.max(0, Math.floor(clean.length * 3 / 4) - pad2);
    }
    try {
      return utf8Bytes(decodeURIComponent(payload));
    } catch (e) {
      return utf8Bytes(payload);
    }
  }
  function dataUrlMime(url) {
    const m = /^data:([^;,]+)/i.exec(url);
    return m ? m[1].toLowerCase() : null;
  }
  function svgDims(el) {
    const num2 = (v) => {
      const n = parseFloat(String(v || ""));
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    let width = num2(el.getAttribute("width"));
    let height = num2(el.getAttribute("height"));
    if (!width || !height) {
      const vb = String(el.getAttribute("viewBox") || "").trim().split(/[\s,]+/);
      if (vb.length === 4) {
        width = width || num2(vb[2]);
        height = height || num2(vb[3]);
      }
    }
    if (!width || !height) {
      try {
        const r = el.getBoundingClientRect();
        width = width || Math.round(r.width) || null;
        height = height || Math.round(r.height) || null;
      } catch (e) {
      }
    }
    return { width, height };
  }
  function serializeSvg(el) {
    let text = "";
    try {
      text = el.outerHTML || "";
    } catch (e) {
      text = "";
    }
    if (!text) return "";
    if (!/\sxmlns=/.test(text)) text = text.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    return text;
  }
  function pickFromSrcset(srcset) {
    const parts = String(srcset || "").split(",").map((s) => s.trim()).filter(Boolean);
    let best = "";
    let bestV = -1;
    for (const p of parts) {
      const seg = p.split(/\s+/);
      const url = seg[0];
      if (!url) continue;
      const d = String(seg[1] || "");
      let v = 1;
      if (/^\d+(\.\d+)?w$/.test(d)) v = parseFloat(d);
      else if (/^\d+(\.\d+)?x$/.test(d)) v = parseFloat(d) * 1e3;
      if (v > bestV) {
        bestV = v;
        best = url;
      }
    }
    return best;
  }
  function backgroundUrls(bg) {
    const out = [];
    if (!bg || bg === "none") return out;
    CSS_URL_RE.lastIndex = 0;
    let m;
    while (m = CSS_URL_RE.exec(bg)) {
      if (m[2]) out.push(m[2]);
    }
    return out;
  }
  function collectCandidates(opts = {}) {
    const root = opts.root || document;
    const exclude = String(opts.excludeSelector || "");
    const cssLimit = opts.cssLimit && opts.cssLimit > 0 ? opts.cssLimit : CSS_SCAN_LIMIT;
    const maxItems = opts.maxItems && opts.maxItems > 0 ? opts.maxItems : MAX_SNIFF;
    const map = new Map();
    let truncated = false;
    const excludedKeys = new Set();
    const skipped = (el) => {
      if (!exclude) return false;
      try {
        return !!el.closest(exclude);
      } catch (e) {
        return false;
      }
    };
    const add = (raw, source, dims, extra) => {
      var _a, _b, _c, _d;
      const url = normalizeUrl(raw);
      if (!url) return;
      if (isVideoUrl(url)) return;
      if (isExcludedName(sniffFileName(url, (_a = extra == null ? void 0 : extra.mime) != null ? _a : null, 0))) {
        excludedKeys.add(url);
        return;
      }
      if (!(extra == null ? void 0 : extra.force) && !looksLikeImageUrl(url)) return;
      const knownPerf = extra && extra.perfBytes ? extra.perfBytes : perfBytesOf(url);
      const key = url;
      const found = map.get(key);
      if (found) {
        if (found.sources.indexOf(source) < 0) found.sources.push(source);
        if (!found.width && dims && dims.width) found.width = dims.width;
        if (!found.height && dims && dims.height) found.height = dims.height;
        if (!found.mime && (extra == null ? void 0 : extra.mime)) found.mime = extra.mime;
        if (!found.perfBytes && knownPerf) found.perfBytes = knownPerf;
        return;
      }
      if (map.size >= maxItems) {
        truncated = true;
        return;
      }
      map.set(key, {
        key,
        url,
        stem: urlFileStem(url),
        kind: /^data:/i.test(url) ? "data" : /^blob:/i.test(url) ? "blob" : "http",
        sources: [source],
        svgText: extra == null ? void 0 : extra.svgText,
        width: (_b = dims == null ? void 0 : dims.width) != null ? _b : null,
        height: (_c = dims == null ? void 0 : dims.height) != null ? _c : null,
        perfBytes: knownPerf != null ? knownPerf : null,
        mime: (_d = extra == null ? void 0 : extra.mime) != null ? _d : null
      });
    };
    let imgs = [];
    try {
      imgs = Array.from(root.querySelectorAll("img"));
    } catch (e) {
      imgs = [];
    }
    for (const el of imgs) {
      if (skipped(el)) continue;
      const img = el;
      const dims = {
        width: img.naturalWidth || img.width || null,
        height: img.naturalHeight || img.height || null
      };
      const cands = [];
      if (img.currentSrc) cands.push(img.currentSrc);
      if (img.getAttribute("src")) cands.push(img.getAttribute("src"));
      const ss = pickFromSrcset(img.getAttribute("srcset") || "");
      if (ss) cands.push(ss);
      for (const a of LAZY_ATTRS) {
        const v = img.getAttribute(a);
        if (v) cands.push(v);
      }
      for (const c of cands) add(c, "dom", dims, { force: true });
    }
    let sources = [];
    try {
      sources = Array.from(root.querySelectorAll("picture source"));
    } catch (e) {
      sources = [];
    }
    for (const el of sources) {
      if (skipped(el)) continue;
      const ss = pickFromSrcset(el.getAttribute("srcset") || "");
      if (ss) add(ss, "dom", void 0, { force: true });
      const s = el.getAttribute("src");
      if (s) add(s, "dom", void 0, { force: true });
    }
    let svgs = [];
    try {
      svgs = Array.from(root.querySelectorAll("svg"));
    } catch (e) {
      svgs = [];
    }
    for (const el of svgs) {
      if (skipped(el)) continue;
      const text = serializeSvg(el);
      if (!text) continue;
      const dims = svgDims(el);
      add("data:image/svg+xml;charset=utf-8," + encodeURIComponent(text), "svg", dims, {
        svgText: text,
        mime: "image/svg+xml",
        force: true
      });
    }
    const scanRoot = root instanceof Document ? root.body || root.documentElement : root;
    if (scanRoot) {
      let els = [];
      try {
        els = Array.from(scanRoot.querySelectorAll("*"));
      } catch (e) {
        els = [];
      }
      if (els.length > cssLimit) truncated = true;
      for (let i = 0; i < els.length && i < cssLimit; i++) {
        const el = els[i];
        const tag = el.tagName ? el.tagName.toLowerCase() : "";
        if (tag === "script" || tag === "style" || tag === "link" || tag === "meta" || tag === "noscript") continue;
        if (skipped(el)) continue;
        let bg = "";
        try {
          bg = getComputedStyle(el).backgroundImage;
        } catch (e) {
          continue;
        }
        if (!bg || bg === "none") continue;
        for (const u of backgroundUrls(bg)) add(u, "css");
      }
    }
    perfForEach((url, bytes) => {
      add(url, "perf", void 0, { perfBytes: bytes });
    });
    try {
      if (typeof performance !== "undefined" && performance.getEntriesByType) {
        const entries = performance.getEntriesByType("resource");
        for (const e of entries) {
          const it = String(e.initiatorType || "");
          if (VIDEO_INITIATORS.indexOf(it) >= 0) continue;
          const name = String(e.name || "");
          if (!looksLikeImageUrl(name)) continue;
          const bytes = Number(e.decodedBodySize || 0) || Number(e.encodedBodySize || 0) || Number(e.transferSize || 0) || 0;
          add(name, "perf", void 0, { perfBytes: bytes > 0 ? bytes : null });
        }
      }
    } catch (e) {
    }
    return { items: Array.from(map.values()), truncated, excluded: excludedKeys.size };
  }
  function gmRequest(details) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest 不可用"));
        return;
      }
      try {
        GM_xmlhttpRequest({
          ...details,
          onload: (resp) => resolve(resp),
          onerror: (resp) => reject(new Error(resp && (resp.error || resp.statusText) || "请求失败")),
          ontimeout: () => reject(new Error("请求超时")),
          onabort: () => reject(new Error("请求已取消"))
        });
      } catch (e) {
        reject(e);
      }
    });
  }
  function headerOf(rawHeaders, name) {
    const lines = String(rawHeaders || "").split(/\r?\n/);
    const want = name.toLowerCase() + ":";
    for (const line of lines) {
      const i = line.indexOf(":");
      if (i < 0) continue;
      if (line.slice(0, i + 1).toLowerCase() === want) return line.slice(i + 1).trim();
    }
    return null;
  }
  function mimeOf(headers) {
    const ct = headerOf(headers, "content-type");
    return ct ? ct.toLowerCase().split(";")[0].trim() || null : null;
  }
  async function probeHead(url) {
    try {
      const resp = await gmRequest({ method: "HEAD", url, timeout: HEAD_TIMEOUT });
      const mime = mimeOf(resp.responseHeaders);
      if (resp.status >= 400) return { size: null, mime, via: "unknown", drop: false };
      if (isClearlyNotImage(mime)) return { size: null, mime, via: "unknown", drop: true };
      const len = Number(headerOf(resp.responseHeaders, "content-length"));
      if (Number.isFinite(len) && len > 0) return { size: len, mime, via: "head", drop: false };
      return { size: null, mime, via: "unknown", drop: false };
    } catch (e) {
      return { size: null, mime: null, via: "unknown", drop: false };
    }
  }
  async function probeRange(url) {
    try {
      const resp = await gmRequest({
        method: "GET",
        url,
        headers: { Range: "bytes=0-0" },
        responseType: "blob",
        timeout: RANGE_TIMEOUT
      });
      const blob = resp.response;
      const mime = mimeOf(resp.responseHeaders) || (blob && blob.type ? blob.type.toLowerCase() : null);
      if (isClearlyNotImage(mime)) return { size: null, mime, via: "unknown", drop: true };
      const cr = headerOf(resp.responseHeaders, "content-range");
      const m = cr ? /\/(\d+)\s*$/.exec(cr) : null;
      if (m) {
        const total = Number(m[1]);
        if (Number.isFinite(total) && total > 0) return { size: total, mime, via: "range", drop: false };
      }
      if (blob && blob.size > 0) return { size: blob.size, mime, via: "range", drop: false };
      return { size: null, mime, via: "unknown", drop: false };
    } catch (e) {
      return { size: null, mime: null, via: "unknown", drop: false };
    }
  }
  async function probeBlobUrl(url) {
    const blob = await fetchBlobInPage(url);
    if (!blob) return { size: null, mime: null, via: "unknown", drop: false };
    const mime = blob.type ? blob.type.toLowerCase() : null;
    if (isClearlyNotImage(mime)) return { size: null, mime, via: "local", drop: true };
    return { size: blob.size || null, mime, via: "local", drop: false };
  }
  function fetchBlobInPage(url) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (b) => {
        if (done) return;
        done = true;
        resolve(b);
      };
      const timer2 = setTimeout(() => finish(null), LOCAL_FETCH_TIMEOUT);
      try {
        if (typeof fetch !== "function") {
          clearTimeout(timer2);
          finish(null);
          return;
        }
        fetch(url).then((r) => r.blob()).then((b) => {
          clearTimeout(timer2);
          finish(b && b.size ? b : null);
        }).catch(() => {
          clearTimeout(timer2);
          finish(null);
        });
      } catch (e) {
        clearTimeout(timer2);
        finish(null);
      }
    });
  }
  async function probeOne(it) {
    if (it.kind === "svg") {
      const bytes = it.svgText ? utf8Bytes(it.svgText) : null;
      return { size: bytes, mime: "image/svg+xml", via: bytes ? "local" : "unknown", drop: false };
    }
    if (it.kind === "data") {
      const bytes = dataUrlBytes(it.url);
      return { size: bytes, mime: dataUrlMime(it.url), via: bytes ? "local" : "unknown", drop: false };
    }
    if (it.perfBytes && it.perfBytes > 0) {
      return { size: it.perfBytes, mime: it.mime, via: "perf", drop: false };
    }
    if (it.kind === "blob") return probeBlobUrl(it.url);
    const head = await probeHead(it.url);
    if (head.drop || head.size) return head;
    const range = await probeRange(it.url);
    return { size: range.size, mime: range.mime || head.mime, via: range.via, drop: range.drop };
  }
  async function runPool(total, concurrency, worker) {
    let next = 0;
    const run = async () => {
      while (next < total) {
        const i = next;
        next++;
        await worker(i);
      }
    };
    const n = Math.max(1, Math.min(concurrency, total));
    const runners = [];
    for (let i = 0; i < n; i++) runners.push(run());
    await Promise.all(runners);
  }
  async function resolveSizes(items, opts = {}) {
    const out = [];
    const concurrency = opts.concurrency && opts.concurrency > 0 ? opts.concurrency : 5;
    const stopped = () => !!(opts.shouldStop && opts.shouldStop());
    await runPool(items.length, concurrency, async (i) => {
      const it = items[i];
      if (stopped()) return;
      const cached = measuredOf(it.key);
      let img;
      if (cached) {
        img = {
          ...it,
          size: cached.size,
          mime: cached.mime || it.mime,
          sizeVia: cached.sizeVia,
          drop: cached.drop
        };
      } else {
        let probe;
        try {
          probe = await probeOne(it);
        } catch (e) {
          probe = { size: null, mime: it.mime, via: "unknown", drop: false };
        }
        if (stopped()) return;
        img = {
          ...it,
          size: probe.size,
          mime: probe.mime || it.mime,
          sizeVia: probe.via,
          drop: probe.drop
        };
        rememberMeasured(img);
      }
      out.push(img);
      if (opts.onItem) opts.onItem(img);
    });
    return out;
  }
  function anchorDownload(href, name) {
    try {
      const a = document.createElement("a");
      a.href = href;
      a.download = name || "";
      a.rel = "noopener";
      a.style.display = "none";
      const parent = document.body || document.documentElement;
      parent.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (e) {
      return false;
    }
  }
  async function downloadImage(url, filename) {
    if (/^data:/i.test(url)) return anchorDownload(url, filename);
    if (/^blob:/i.test(url)) {
      const blob = await fetchBlobInPage(url);
      if (blob) {
        const objUrl = URL.createObjectURL(blob);
        const ok = anchorDownload(objUrl, filename);
        setTimeout(() => URL.revokeObjectURL(objUrl), 1e3);
        return ok;
      }
      return anchorDownload(url, filename);
    }
    try {
      const resp = await gmRequest({ method: "GET", url, responseType: "blob", timeout: DOWNLOAD_TIMEOUT });
      const blob = resp.response;
      if (blob && blob.size > 0) {
        const objUrl = URL.createObjectURL(blob);
        const ok = anchorDownload(objUrl, filename);
        setTimeout(() => URL.revokeObjectURL(objUrl), 1e3);
        return ok;
      }
    } catch (e) {
    }
    return anchorDownload(url, filename);
  }
  const PERMANENT_HTTP_STATUS = [401, 403, 404, 410];
  function sleep$1(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function permanentError(msg) {
    const e = new Error(msg);
    e.permanent = true;
    return e;
  }
  function isPermanent(e) {
    return !!(e && e.permanent);
  }
  async function prefetchOne(item, maxRetries) {
    const url = item.url;
    if (/^data:/i.test(url)) return { href: url, obj: false };
    if (/^blob:/i.test(url)) {
      const blob = await fetchBlobInPage(url);
      if (blob) return { href: URL.createObjectURL(blob), obj: true };
      return { href: url, obj: false };
    }
    let lastReason = "下载失败";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await gmRequest({ method: "GET", url, responseType: "blob", timeout: DOWNLOAD_TIMEOUT });
        if (resp.status && resp.status >= 400) {
          if (PERMANENT_HTTP_STATUS.indexOf(resp.status) >= 0) throw permanentError("HTTP " + resp.status);
          throw new Error("HTTP " + resp.status);
        }
        const blob = resp.response;
        if (blob && blob.size > 0) return { href: URL.createObjectURL(blob), obj: true };
        throw new Error("空响应");
      } catch (e) {
        if (isPermanent(e)) throw e;
        lastReason = e && e.message || String(e);
        if (attempt < maxRetries) await sleep$1(400 * Math.pow(2, attempt));
      }
    }
    throw new Error(lastReason);
  }
  async function downloadBatch(items, opts = {}) {
    const total = items.length;
    const result = { total, ok: 0, failed: [] };
    if (!total) return result;
    const baseConc = Math.max(1, opts.concurrency || 4);
    const gapMs = opts.gapMs === void 0 ? 400 : opts.gapMs;
    const maxRetries = Math.max(0, opts.maxRetries === void 0 ? 2 : opts.maxRetries);
    const maxReady = Math.max(1, opts.maxReady || 8);
    let nextFetch = 0;
    let doneCount = 0;
    let dynamicConc = baseConc;
    let consecutiveFails = 0;
    let fetchedAll = false;
    const ready = [];
    const failOne = (item, reason) => {
      doneCount++;
      result.failed.push({ key: item.key, filename: item.filename, reason });
      if (opts.onProgress) opts.onProgress(doneCount, total);
      if (opts.onItem) opts.onItem(item, false, reason);
    };
    const prefetchLoop = async () => {
      const inflight = new Set();
      while (nextFetch < total) {
        if (inflight.size >= dynamicConc || ready.length >= maxReady) {
          await sleep$1(20);
          continue;
        }
        const item = items[nextFetch++];
        const p = (async () => {
          try {
            const r = await prefetchOne(item, maxRetries);
            ready.push({ item, href: r.href, obj: r.obj });
            consecutiveFails = 0;
          } catch (e) {
            const reason = e && e.message || String(e);
            consecutiveFails++;
            if (consecutiveFails >= 3) {
              dynamicConc = Math.max(1, dynamicConc - 1);
              consecutiveFails = 0;
            }
            failOne(item, reason);
          }
        })().finally(() => inflight.delete(p));
        inflight.add(p);
      }
      while (inflight.size > 0) await sleep$1(20);
      fetchedAll = true;
    };
    const triggerLoop = async () => {
      for (; ; ) {
        while (!ready.length) {
          if (fetchedAll) return;
          await sleep$1(30);
        }
        const one = ready.shift();
        const ok = anchorDownload(one.href, one.item.filename);
        if (one.obj) setTimeout(() => URL.revokeObjectURL(one.href), 1e3);
        doneCount++;
        if (ok) {
          result.ok++;
        } else {
          result.failed.push({ key: one.item.key, filename: one.item.filename, reason: "触发下载失败" });
        }
        if (opts.onProgress) opts.onProgress(doneCount, total);
        if (opts.onItem) opts.onItem(one.item, ok, ok ? void 0 : "触发下载失败");
        await sleep$1(gapMs);
      }
    };
    await Promise.all([prefetchLoop(), triggerLoop()]);
    return result;
  }
  const PANEL_HOST_ID = "__znhd_panel_host__";
  const OVERLAY_HOST_ID = "__znhd_overlay_host__";
  const PANEL_WIDTH = 238;
  const SNIFF_EXCLUDE_SELECTOR = ["#" + PANEL_HOST_ID, "#" + OVERLAY_HOST_ID].join(",");
  const PRE_INITIAL_DELAY = 5e3;
  const PRE_INTERVAL = 6e4;
  const PRE_CONCURRENCY = 2;
  const PRE_MAX_NET_PER_ROUND = 60;
  const PRE_CSS_LIMIT = 1200;
  let enabled = false;
  let timer = null;
  let running = false;
  let rounds = 0;
  function schedule(delay) {
    if (!enabled || timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      void runRound();
    }, delay);
  }
  function isZeroCost(it) {
    if (it.kind !== "http") return true;
    return !!(it.perfBytes && it.perfBytes > 0);
  }
  async function runRound() {
    if (!enabled || running) return;
    running = true;
    try {
      const res = collectCandidates({ excludeSelector: SNIFF_EXCLUDE_SELECTOR, cssLimit: PRE_CSS_LIMIT });
      const fresh = res.items.filter((it) => !measuredOf(it.key));
      if (fresh.length) {
        const zero = fresh.filter(isZeroCost);
        const paid = fresh.filter((it) => !isZeroCost(it)).slice(0, PRE_MAX_NET_PER_ROUND);
        if (zero.length || paid.length) {
          await resolveSizes(zero.concat(paid), { concurrency: PRE_CONCURRENCY });
        }
      }
      rounds++;
    } catch (e) {
    } finally {
      running = false;
      if (enabled) schedule(PRE_INTERVAL);
    }
  }
  function setPreMeasureEnabled(v) {
    const next = !!v;
    if (next === enabled) return;
    enabled = next;
    if (next) {
      schedule(PRE_INITIAL_DELAY);
    } else if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }
  const DEFAULT_MAX_DIM = 1600;
  const DEFAULT_QUALITY = 0.75;
  function isHeicLike(lowerMime, lowerName) {
    return lowerMime === "image/heic" || lowerMime === "image/heif" || lowerMime === "image/heic-sequence" || lowerMime === "image/heif-sequence" || /\.(heic|heif)$/.test(lowerName);
  }
  function isSvgLike(lowerMime, lowerName) {
    return lowerMime === "image/svg+xml" || /\.svg$/.test(lowerName);
  }
  function isGifLike(lowerMime, lowerName) {
    return lowerMime === "image/gif" || /\.gif$/.test(lowerName);
  }
  function isWebpLike(lowerMime, lowerName) {
    return lowerMime === "image/webp" || /\.webp$/.test(lowerName);
  }
  function decodeToCanvasSource(blob) {
    const decodeViaImg = () => new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url)
      });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片解析失败"));
      };
      img.src = url;
    });
    if (typeof createImageBitmap !== "function") return decodeViaImg();
    return createImageBitmap(blob).then((bmp) => ({
      source: bmp,
      width: bmp.width,
      height: bmp.height,
      release: () => {
        if (bmp.close) bmp.close();
      }
    })).catch(() => decodeViaImg());
  }
  async function resizeToJpeg(blob, opt = {}) {
    const maxDim = opt.maxDim && opt.maxDim > 0 ? opt.maxDim : DEFAULT_MAX_DIM;
    const quality = typeof opt.quality === "number" ? opt.quality : DEFAULT_QUALITY;
    let dec = null;
    try {
      dec = await decodeToCanvasSource(blob);
      const w = Number(dec.width) || 0;
      const h2 = Number(dec.height) || 0;
      if (!w || !h2) return null;
      const scale = Math.min(1, maxDim / Math.max(w, h2));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h2 * scale));
      const cv = document.createElement("canvas");
      cv.width = cw;
      cv.height = ch;
      const ctx = cv.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(dec.source, 0, 0, cw, ch);
      return await new Promise((resolve) => {
        cv.toBlob((b) => resolve(b || null), "image/jpeg", quality);
      });
    } catch {
      return null;
    } finally {
      if (dec) dec.release();
    }
  }
  function makeHeicConverter(heic2any2, quality = 0.9) {
    return (blob) => {
      if (typeof heic2any2 !== "function") return Promise.reject(new Error("heic2any 未加载"));
      return Promise.resolve(
        heic2any2({
          blob,
          toType: "image/jpeg",
          quality
        })
      ).then((out) => {
        const b = Array.isArray(out) ? out[0] : out;
        if (b) return b;
        throw new Error("heic2any 未产出图片");
      });
    };
  }
  async function prepareForTransfer(file, opt = {}) {
    const name = String(file && file.name ? file.name : "image.jpg");
    const mime = String(file && file.type || "image/jpeg");
    const original = { blob: file, name, mime, compressed: false };
    const lowerName = name.toLowerCase();
    const lowerMime = mime.toLowerCase();
    if ((opt.skipSvg === void 0 ? true : opt.skipSvg) && isSvgLike(lowerMime, lowerName)) return original;
    if ((opt.skipGif === void 0 ? true : opt.skipGif) && isGifLike(lowerMime, lowerName)) return original;
    if ((opt.skipWebp === void 0 ? true : opt.skipWebp) && isWebpLike(lowerMime, lowerName)) return original;
    const heic = isHeicLike(lowerMime, lowerName);
    let source = file;
    if (heic) {
      if (!opt.loadHeic) return original;
      try {
        const jpg = await opt.loadHeic(file);
        if (!jpg) return original;
        source = jpg;
      } catch {
        return original;
      }
    }
    const out = await resizeToJpeg(source, {
      maxDim: opt.maxDim === void 0 ? DEFAULT_MAX_DIM : opt.maxDim,
      quality: opt.quality === void 0 ? DEFAULT_QUALITY : opt.quality
    });
    if (!out) return original;
    if (!heic && out.size >= (file.size || 0)) return original;
    return {
      blob: out,
      name: name.replace(/\.[a-z0-9]+$/i, "") + ".jpg",
      mime: "image/jpeg",
      compressed: true
    };
  }
  const RETRY_BASE_MS = 2e3;
  const RETRY_MAX_MS = 6e4;
  function nextRetryDelay(prevMs, httpStatus) {
    if (httpStatus === 429) return RETRY_MAX_MS;
    const prev = typeof prevMs === "number" && isFinite(prevMs) && prevMs > 0 ? prevMs : 0;
    if (!prev) return RETRY_BASE_MS;
    return Math.min(prev * 2, RETRY_MAX_MS);
  }
  const DEVICE_ID_KEY = "znhd_device_id";
  const RELAY_MAX_BODY = 100 * 1024 * 1024;
  function imagePayloadBytes(file, name, mime) {
    const b64Len = Math.ceil((file && file.size || 0) / 3) * 4;
    const enc = typeof TextEncoder === "function" ? new TextEncoder() : null;
    const byteLen = enc ? enc.encode(String(name || "") + String(mime || "")).length : (String(name || "") + String(mime || "")).length;
    return b64Len + byteLen + 120;
  }
  const PHONE_MAX_DIM = DEFAULT_MAX_DIM;
  const PHONE_JPEG_QUALITY = DEFAULT_QUALITY;
  function compressImageForPhone(file) {
    return prepareForTransfer(file, {
      maxDim: PHONE_MAX_DIM,
      quality: PHONE_JPEG_QUALITY,
      loadHeic: (blob) => makeHeicConverter(typeof heic2any === "function" ? heic2any : null)(blob)
    });
  }
  function getDeviceId() {
    let id = "";
    try {
      id = typeof GM_getValue === "function" ? GM_getValue(DEVICE_ID_KEY, "") || "" : "";
    } catch (e) {
      id = "";
    }
    if (!id) {
      try {
        id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : "d" + Date.now().toString(16) + Math.random().toString(16).slice(2);
      } catch (e) {
        id = "d" + Date.now().toString(16) + Math.random().toString(16).slice(2);
      }
      try {
        if (typeof GM_setValue === "function") GM_setValue(DEVICE_ID_KEY, id);
      } catch (e) {
      }
    }
    return id;
  }
  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function blobToPng(blob) {
    return new Promise((resolve) => {
      if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
        resolve(blob);
        return;
      }
      try {
        createImageBitmap(blob).then((bmp) => {
          const cv = document.createElement("canvas");
          cv.width = bmp.width;
          cv.height = bmp.height;
          const ctx = cv.getContext("2d");
          if (!ctx) {
            if (bmp.close) bmp.close();
            resolve(blob);
            return;
          }
          ctx.drawImage(bmp, 0, 0);
          if (bmp.close) bmp.close();
          cv.toBlob((b) => {
            resolve(b || blob);
          }, "image/png");
        }).catch(() => resolve(blob));
      } catch (e) {
        resolve(blob);
      }
    });
  }
  function errTextOf(e) {
    const err = e;
    return err && err.name ? err.name + ": " + err.message : String(err && err.message || e);
  }
  function toRealmBlob(blob, BlobCtor) {
    const type = blob && blob.type ? blob.type : "image/png";
    try {
      return BlobCtor ? new BlobCtor([blob], { type }) : blob;
    } catch (e) {
      return blob;
    }
  }
  function writeClipboardOnce(realm, pngPromise, preferPromiseForm) {
    return new Promise((resolve) => {
      const doWrite = (item) => {
        try {
          realm.nav.clipboard.write([item]).then(
            () => resolve(true),
            (e) => {
              addLog("[复制] 写入剪贴板被拒（" + realm.name + "）: " + errTextOf(e), "warning", true);
              resolve(false);
            }
          );
        } catch (e) {
          addLog("[复制] 调用 clipboard.write 异常（" + realm.name + "）: " + errTextOf(e), "error", true);
          resolve(false);
        }
      };
      if (preferPromiseForm) {
        try {
          doWrite(new realm.CI({ "image/png": pngPromise }));
          return;
        } catch (e) {
          addLog("[复制] ClipboardItem 不支持 Promise 形式，改为先转换再写入: " + errTextOf(e), "warning", true);
        }
      }
      pngPromise.then((png) => {
        try {
          doWrite(new realm.CI({ "image/png": toRealmBlob(png, realm.BlobCtor) }));
        } catch (e) {
          addLog("[复制] 构造 ClipboardItem 失败（" + realm.name + "）: " + errTextOf(e), "error", true);
          resolve(false);
        }
      });
    });
  }
  function copyImageToClipboard(blob) {
    return new Promise((resolve) => {
      if (!blob) {
        addLog("[复制] 图片数据为空", "error", true);
        resolve(false);
        return;
      }
      const pageWin = typeof unsafeWindow !== "undefined" ? unsafeWindow : null;
      const realms = [];
      if (pageWin && pageWin.navigator && pageWin.navigator.clipboard &&
typeof pageWin.navigator.clipboard.write === "function" && pageWin.ClipboardItem) {
        realms.push({
          name: "页面主世界",
          nav: pageWin.navigator,
          CI: pageWin.ClipboardItem,
          BlobCtor: pageWin.Blob,
          isPageRealm: true
        });
      }
      if (navigator.clipboard && typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
        realms.push({ name: "隔离世界", nav: navigator, CI: ClipboardItem, BlobCtor: Blob, isPageRealm: false });
      }
      if (!realms.length) {
        addLog("[复制] 当前环境不支持图片剪贴板（缺 clipboard.write 或 ClipboardItem）", "error", true);
        resolve(false);
        return;
      }
      const pngPromise = (blob.type === "image/png" ? Promise.resolve(blob) : blobToPng(blob)).then(
        (b) => {
          if (b && b.type !== "image/png") {
            addLog("[复制] 图片转 PNG 失败（内核不支持位图解码/Canvas），可能无法写入剪贴板", "warning", true);
          }
          return b;
        }
      );
      (async () => {
        for (const realm of realms) {
          const ok = await writeClipboardOnce(realm, pngPromise, realm.isPageRealm);
          if (ok) {
            addLog("[复制] 图片已复制到剪贴板（" + realm.name + "）", "success", true);
            resolve(true);
            return;
          }
        }
        addLog(
          "[复制] 图片写入剪贴板失败：常见原因是浏览器/油猴未授予剪贴板权限、页面未获得焦点，或该内核不支持图片剪贴板；可长按图片手动保存",
          "error",
          true
        );
        resolve(false);
      })();
    });
  }
  function startPhoneReceive(opt) {
    const server = (opt.server || "").trim().replace(/\/+$/, "");
    const uuid = opt.uuid;
    let stopped = false;
    let lastXhr = null;
    let connected = false;
    let loggedConnFail = false;
    let firstPoll = true;
    let retryDelay = 0;
    function markConnected() {
      if (connected) return;
      connected = true;
      loggedConnFail = false;
      if (opt.onConnected) {
        try {
          opt.onConnected();
        } catch (e) {
        }
      }
    }
    function poll() {
      if (stopped) return;
      if (opt.onStatus) opt.onStatus("正在等待手机上传…");
      const maxwait = firstPoll ? 1e3 : 45e3;
      firstPoll = false;
      const url = server + "/recv/" + encodeURIComponent(uuid) + "?maxwait=" + maxwait + "&phones=1";
      try {
        lastXhr = GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: maxwait + 5e3,
          onload: function(resp) {
            if (stopped) return;
            if (resp.status === 429 || resp.status >= 500) {
              if (opt.onStatus) opt.onStatus("服务器繁忙，稍后重试…");
              retryDelay = nextRetryDelay(retryDelay, resp.status);
              setTimeout(poll, retryDelay);
              return;
            }
            markConnected();
            retryDelay = 0;
            try {
              let data = null;
              try {
                data = JSON.parse(resp.responseText);
              } catch (e) {
                data = null;
              }
              if (data && Array.isArray(data.phones)) {
                if (opt.onPhones) {
                  try {
                    opt.onPhones(
                      data.phones.filter((p) => !!p).map((p) => ({
                        id: String(p.id || ""),
                        lastSeen: Number(p.lastSeen) || 0
                      }))
                    );
                  } catch (e) {
                  }
                }
              }
              if (data && data.type === "phones") {
                poll();
                return;
              }
              if (data && data.empty) {
                poll();
                return;
              }
              if (data && (data.type === "image" || data.type === "file") && data.data) {
                const isFile = data.type === "file";
                const blob = base64ToBlob(
                  data.data,
                  data.mime || (isFile ? "application/octet-stream" : "image/jpeg")
                );
                const previewUrl = URL.createObjectURL(blob);
                if (opt.onStatus)
                  opt.onStatus(
                    (isFile ? "收到文件：" : "收到图片：") + (data.name || (isFile ? "file" : "image"))
                  );
                if (isFile) {
                  if (opt.onFile)
                    opt.onFile({
                      blob,
                      previewUrl,
                      name: data.name,
                      mime: data.mime,
                      from: data.from
                    });
                } else if (opt.onImage) {
                  opt.onImage({
                    blob,
                    previewUrl,
                    name: data.name,
                    mime: data.mime,
                    from: data.from
                  });
                }
                poll();
                return;
              }
              if (data && data.type === "text" && typeof data.text === "string") {
                if (opt.onStatus) opt.onStatus("收到文本");
                if (opt.onText) opt.onText({ text: data.text, ts: data.ts, from: data.from });
                poll();
                return;
              }
              setTimeout(poll, 1e3);
            } catch (e) {
              addLog("[设备互联] 处理收到数据失败: " + (e && e.message ? e.message : e), "error", true);
              setTimeout(poll, 1e3);
            }
          },
          onerror: function() {
            if (stopped) return;
            if (!loggedConnFail) {
              loggedConnFail = true;
              addLog("[设备互联] 连接服务器失败，请检查中继地址/网络（" + server + "）", "error");
            }
            if (opt.onStatus) opt.onStatus("连接中断，正在重连…");
            retryDelay = nextRetryDelay(retryDelay);
            setTimeout(poll, retryDelay);
          },
          ontimeout: function() {
            if (stopped) return;
            poll();
          }
        });
      } catch (e) {
        if (stopped) return;
        if (opt.onStatus) opt.onStatus("请求异常，正在重连…");
        retryDelay = nextRetryDelay(retryDelay);
        setTimeout(poll, retryDelay);
      }
    }
    poll();
    return function stop() {
      stopped = true;
      try {
        if (lastXhr && typeof lastXhr.abort === "function") lastXhr.abort();
      } catch (e) {
      }
    };
  }
  function sendToPhone(opt) {
    const server = (opt.server || "").trim().replace(/\/+$/, "");
    const uuid = opt.uuid;
    const url = server + "/phone/send/" + encodeURIComponent(uuid);
    try {
      const body = JSON.stringify(opt.payload);
      GM_xmlhttpRequest({
        method: "POST",
        url,
        headers: { "Content-Type": "application/json" },
        data: body,

...opt.onUploadProgress ? {
          upload: {
            onprogress: function(ev) {
              if (!ev || !ev.total) return;
              if (opt.onUploadProgress) opt.onUploadProgress(Math.round(ev.loaded / ev.total * 100));
            }
          }
        } : {},
timeout: 2e4 + Math.round(body.length / 200),
onload: function(resp) {
          let j = null;
          try {
            j = JSON.parse(resp.responseText);
          } catch (e) {
            j = null;
          }
          if (j && j.ok) {
            if (opt.onOk) opt.onOk();
          } else {
            let msg = j && j.error ? String(j.error) : "";
            if (!msg && resp.status === 413) msg = "内容过大，请压缩后再发送";
            else if (!msg && resp.status >= 400) msg = "服务器错误（HTTP " + resp.status + "）";
            if (opt.onFail) opt.onFail(msg || "HTTP " + resp.status);
          }
        },
        onerror: function() {
          if (opt.onFail) opt.onFail("网络错误，请检查中继地址");
        },
        ontimeout: function() {
          if (opt.onFail) opt.onFail("发送超时");
        }
      });
    } catch (e) {
      if (opt.onFail) opt.onFail(e.message);
    }
  }
  const TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
  const DB_NAME = "znhd-transfer";
  const DB_VERSION = 1;
  const STORE = "sessions";
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }
  function pruneSessions(sessions, now = Date.now()) {
    const minTs = now - TRANSFER_TTL_MS;
    const out = [];
    sessions.forEach((s) => {
      const messages = s.messages.filter((m) => (m.ts || 0) >= minTs);
      if (messages.length) out.push({ ...s, messages, lastTs: messages[messages.length - 1].ts || s.lastTs });
    });
    return out;
  }
  async function loadPersistedSessions() {
    let rows = [];
    try {
      const db = await openDb();
      rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error || new Error("IndexedDB read failed"));
      });
      db.close();
    } catch (e) {
      return [];
    }
    const sessions = rows.map((r) => ({
      key: r.key,
      unread: 0,
lastTs: r.lastTs || 0,
      messages: (r.messages || []).map((m) => {
        const msg = { ...m };
        if (msg.sendState === "sending") {
          msg.sendState = "failed";
          msg.sendError = "上次会话中断，发送状态未知";
        }
        if (msg.blob) {
          try {
            msg.previewUrl = URL.createObjectURL(msg.blob);
          } catch (e) {
          }
        }
        return msg;
      })
    }));
    return pruneSessions(sessions);
  }
  async function writeSessions(sessions) {
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.clear();
        sessions.forEach((s) => {
          const messages = s.messages.map((m) => {
            const { previewUrl: _drop, ...rest } = m;
            return rest;
          });
          store.put({ key: s.key, messages, unread: s.unread, lastTs: s.lastTs });
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
      });
      db.close();
    } catch (e) {
    }
  }
  let persistTimer = null;
  function schedulePersist(sessions) {
    if (persistTimer) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = null;
      void writeSessions(pruneSessions(sessions));
    }, 800);
  }
  const DEFAULT_RELAY_SERVER = "https://znhd.122050.xyz";
  const TRANSFER_STORAGE_KEY = "scriptCat_TransferSettings";
  const DEFAULT_TRANSFER_SETTINGS = {
    relayServer: DEFAULT_RELAY_SERVER,
    theme: "light",
    autoOpenOnReceive: true
  };
  function loadTransferSettings(legacyRelayServer) {
    let stored = null;
    try {
      const raw = localStorage.getItem(TRANSFER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
      }
    } catch (e) {
      stored = null;
    }
    const base = stored ? { ...DEFAULT_TRANSFER_SETTINGS, ...stored } : {
      ...DEFAULT_TRANSFER_SETTINGS,
relayServer: typeof legacyRelayServer === "string" && legacyRelayServer.trim() ? legacyRelayServer.trim().replace(/\/+$/, "") : DEFAULT_TRANSFER_SETTINGS.relayServer
    };
    return normalize(base);
  }
  function saveTransferSettings(settings) {
    try {
      localStorage.setItem(TRANSFER_STORAGE_KEY, JSON.stringify(settings));
    } catch (e) {
    }
  }
  function normalizeTransferSettings(input) {
    const theme = input.theme === "dark" ? "dark" : "light";
    return {
      relayServer: String(input.relayServer || "").trim().replace(/\/+$/, ""),
      theme,
      autoOpenOnReceive: input.autoOpenOnReceive === void 0 ? true : !!input.autoOpenOnReceive
    };
  }
  function normalize(input) {
    return normalizeTransferSettings(input);
  }
  const PHONE_SESSION_KEY = "__phone__";
  const PHONE_SESSION_LABEL = "手机";
  function sessionKeyOf(phoneId) {
    return phoneId || PHONE_SESSION_KEY;
  }
  let state = {
    settings: loadTransferSettings(runtime.init.relayServer),
    phones: [],
    sessions: [],
    activeSessionKey: "",
    windowOpen: false
  };
  const listeners = new Set();
  const autoOpenListeners = new Set();
  let persistReady = false;
  function persistSoon() {
    if (persistReady) schedulePersist(state.sessions);
  }
  function emit() {
    listeners.forEach((cb) => cb());
  }
  function subscribe(cb) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }
  function subscribeTransfer(cb) {
    return subscribe(cb);
  }
  function getTransferSnapshot() {
    return state;
  }
  function updateTransferSettings(patch) {
    const prev = state.settings;
    const next = normalizeTransferSettings({ ...prev, ...patch });
    if (next.relayServer === prev.relayServer && next.theme === prev.theme && next.autoOpenOnReceive === prev.autoOpenOnReceive) {
      return;
    }
    saveTransferSettings(next);
    state = { ...state, settings: next };
    emit();
    if (next.relayServer !== prev.relayServer) restartLoops();
  }
  let phoneFallbackTimer = null;
  let phonesSeenAt = 0;
  let receiveStop = null;
  let knownPhones = new Set();
  let inited = false;
  function validServer() {
    const s = (state.settings.relayServer || "").trim().replace(/\/+$/, "");
    return /^https?:\/\//i.test(s) ? s : "";
  }
  function restartLoops() {
    stopLoops();
    const server = validServer();
    if (!server) {
      state = { ...state, phones: [] };
      knownPhones = new Set();
      emit();
      return;
    }
    startPhonesWatch();
    startReceive(server);
  }
  function stopLoops() {
    if (phoneFallbackTimer) {
      clearInterval(phoneFallbackTimer);
      phoneFallbackTimer = null;
    }
    if (receiveStop) {
      receiveStop();
      receiveStop = null;
    }
  }
  function samePhones(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].id !== b[i].id) return false;
    }
    return true;
  }
  function applyPhones(list) {
    const nowIds = new Set(list.map((p) => p.id).filter(Boolean));
    knownPhones.forEach((id) => {
      if (!nowIds.has(id)) addLog("[传输助手] 手机已断开：" + id, "warning");
    });
    nowIds.forEach((id) => {
      if (!knownPhones.has(id)) addLog("[传输助手] 手机已连接：" + id, "success");
    });
    knownPhones = nowIds;
    if (samePhones(state.phones, list)) return;
    state = { ...state, phones: list };
    emit();
    if (list.length) flushQueuedTexts();
  }
  let phoneRefreshInFlight = false;
  function refreshPhones() {
    const server = validServer();
    if (!server || phoneRefreshInFlight) return;
    phoneRefreshInFlight = true;
    try {
      GM_xmlhttpRequest({
        method: "GET",
        url: server + "/phone/status/" + encodeURIComponent(getDeviceId()),
        timeout: 8e3,
        onload: (r) => {
          phoneRefreshInFlight = false;
          let j = null;
          try {
            j = JSON.parse(r.responseText);
          } catch (e) {
            j = null;
          }
          const list = j && Array.isArray(j.phones) ? j.phones.map((p) => ({ id: String(p.id || ""), lastSeen: Number(p.lastSeen) || 0 })) : j && j.online ? [{ id: "", lastSeen: 0 }] : [];
          applyPhones(list);
        },
        onerror: () => {
          phoneRefreshInFlight = false;
          if (state.phones.length) {
            state = { ...state, phones: [] };
            emit();
          }
        }
      });
    } catch (e) {
      phoneRefreshInFlight = false;
    }
  }
  function startPhonesWatch() {
    const tick = () => {
      if (!validServer()) return;
      if (Date.now() - phonesSeenAt < 55e3) return;
      refreshPhones();
    };
    tick();
    phoneFallbackTimer = setInterval(tick, 6e4);
  }
  function startReceive(server) {
    receiveStop = startPhoneReceive({
      server,
      uuid: getDeviceId(),
      onConnected: () => addLog("[传输助手] 已自动开始接收（" + server + "）", "info"),

onPhones: (list) => {
        phonesSeenAt = Date.now();
        applyPhones(list);
      },
      onImage: (img) => {
        addLog("[传输助手] 收到图片：" + (img.name || "image") + "（" + (img.mime || "image") + "）", "success");
        const key = sessionKeyForIncoming(img.from);
        addMessage(key, {
          id: nextId(),
          type: "image",
          direction: "in",
          sessionKey: key,
          name: img.name,
          mime: img.mime,
          blob: img.blob,
          previewUrl: img.previewUrl,
          ts: Date.now()
        });
      },
      onText: (txt) => {
        const t = (txt.text || "").replace(/\s+$/, "");
        addLog("[传输助手] 收到文本：" + (t.length > 40 ? t.slice(0, 40) + "…" : t), "success");
        const key = sessionKeyForIncoming(txt.from);
        addMessage(key, {
          id: nextId(),
          type: "text",
          direction: "in",
          sessionKey: key,
          text: t,
          ts: txt.ts || Date.now()
        });
      },

onFile: (f) => {
        addLog(
          "[传输助手] 收到文件：" + (f.name || "file") + "（" + (f.mime || "application/octet-stream") + "）",
          "success"
        );
        const key = sessionKeyForIncoming(f.from);
        addMessage(key, {
          id: nextId(),
          type: "file",
          direction: "in",
          sessionKey: key,
          name: f.name,
          mime: f.mime,
          blob: f.blob,
          previewUrl: f.previewUrl,
          ts: Date.now()
        });
      }
    });
  }
  function sessionKeyForIncoming(from) {
    const sender = (from || "").trim();
    if (sender) return sessionKeyOf(sender);
    const online = state.phones.filter((p) => p.id);
    if (online.length === 1) return sessionKeyOf(online[0].id);
    return PHONE_SESSION_KEY;
  }
  function nextId() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }
  function addMessage(sessionKey, msg) {
    const sessions = state.sessions.slice();
    const at = sessions.findIndex((s) => s.key === sessionKey);
    const prev = at >= 0 ? sessions[at] : { key: sessionKey, messages: [], unread: 0, lastTs: 0 };
    const isViewing = state.windowOpen && state.activeSessionKey === sessionKey;
    const next = {
      ...prev,
      messages: prev.messages.concat(msg),
      lastTs: msg.ts || Date.now(),
      unread: isViewing ? prev.unread : prev.unread + 1
    };
    if (at >= 0) sessions[at] = next;
    else sessions.push(next);
    sessions.sort((a, b) => b.lastTs - a.lastTs);
    const nextActive = state.windowOpen ? state.activeSessionKey : sessionKey;
    state = { ...state, sessions, activeSessionKey: nextActive };
    emit();
    persistSoon();
    if (!state.windowOpen && state.settings.autoOpenOnReceive) {
      autoOpenListeners.forEach((cb) => cb(sessionKey));
    }
  }
  function patchMessage(sessionKey, msgId, patch) {
    const sessions = state.sessions.slice();
    const at = sessions.findIndex((s) => s.key === sessionKey);
    if (at < 0) return;
    const session = sessions[at];
    const messages = session.messages.map((m) => m.id === msgId ? { ...m, ...patch } : m);
    sessions[at] = { ...session, messages };
    state = { ...state, sessions };
    emit();
    persistSoon();
  }
  function removeTransferMessage(sessionKey, msgId) {
    const sessions = state.sessions.slice();
    const at = sessions.findIndex((s) => s.key === sessionKey);
    if (at < 0) return;
    const session = sessions[at];
    const removed = session.messages.find((m) => m.id === msgId);
    if (removed) revokeUrl(removed.previewUrl);
    sessions[at] = { ...session, messages: session.messages.filter((m) => m.id !== msgId) };
    state = { ...state, sessions };
    emit();
    persistSoon();
  }
  function clearTransferSession(sessionKey) {
    const sessions = state.sessions.map((s) => {
      if (s.key !== sessionKey) return s;
      s.messages.forEach((m) => revokeUrl(m.previewUrl));
      return { ...s, messages: [], unread: 0, lastTs: 0 };
    }).filter((s) => s.messages.length > 0);
    state = { ...state, sessions };
    emit();
    persistSoon();
  }
  function clearAllTransferFiles() {
    state.sessions.forEach((s) => s.messages.forEach((m) => revokeUrl(m.previewUrl)));
    state = { ...state, sessions: [] };
    emit();
    persistSoon();
  }
  function revokeUrl(url) {
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
    }
  }
  function setActiveSession(sessionKey) {
    if (state.activeSessionKey === sessionKey) return;
    state = { ...state, activeSessionKey: sessionKey };
    emit();
  }
  function setTransferWindowOpen(open) {
    if (state.windowOpen === open) return;
    state = { ...state, windowOpen: open };
    emit();
    if (open) refreshPhones();
  }
  function markSessionRead(sessionKey) {
    const at = state.sessions.findIndex((s) => s.key === sessionKey);
    if (at < 0 || state.sessions[at].unread === 0) return;
    const sessions = state.sessions.slice();
    sessions[at] = { ...sessions[at], unread: 0 };
    state = { ...state, sessions };
    emit();
  }
  function onTransferAutoOpen(cb) {
    autoOpenListeners.add(cb);
    return () => {
      autoOpenListeners.delete(cb);
    };
  }
  function sessionSendable(sessionKey) {
    return state.phones.length > 0;
  }
  function sendTargets(sessionKey) {
    if (sessionKey === PHONE_SESSION_KEY) return "all";
    return [sessionKey];
  }
  function sendTextToSession(sessionKey, text) {
    const t = (text || "").trim();
    const server = validServer();
    if (!t) {
      addLog("[传输助手] 文本为空", "error", true);
      return false;
    }
    if (!server) {
      addLog("[传输助手] 尚未配置中继服务器，无法发送", "error", true);
      return false;
    }
    const msg = {
      id: nextId(),
      type: "text",
      direction: "out",
      sessionKey,
      text: t,
      ts: Date.now()
    };
    if (!sessionSendable()) {
      msg.sendState = "queued";
      addMessage(sessionKey, msg);
      addLog("[传输助手] 当前无在线设备，消息已排队等设备上线", "warning");
      return true;
    }
    addMessage(sessionKey, msg);
    deliverText(sessionKey, msg.id, t, server);
    return true;
  }
  function deliverText(sessionKey, msgId, t, server) {
    sendToPhone({
      server,
      uuid: getDeviceId(),
      payload: { text: t, targets: sendTargets(sessionKey) },
      onOk: () => addLog("[传输助手] 文本已发送", "success"),
      onFail: (e) => {
        patchMessage(sessionKey, msgId, { sendState: "failed", sendError: e });
        addLog("[传输助手] 发送失败：" + e, "error");
      }
    });
  }
  function flushQueuedTexts() {
    const server = validServer();
    if (!server) return;
    state.sessions.forEach((s) => {
      s.messages.forEach((m) => {
        if (m.type === "text" && m.direction === "out" && m.sendState === "queued") {
          patchMessage(s.key, m.id, { sendState: void 0, sendError: void 0 });
          deliverText(s.key, m.id, m.text || "", server);
        }
      });
    });
  }
  function sendImagesToSession(sessionKey, files, onProgress) {
    const server = validServer();
    if (!files.length) return false;
    if (!server) {
      addLog("[传输助手] 尚未配置中继服务器，无法发送", "error", true);
      return false;
    }
    if (!sessionSendable()) {
      addLog("[传输助手] 当前无在线设备，无法发送", "error", true);
      return false;
    }
    const targets = sendTargets(sessionKey);
    const list = files.slice();
    const total = list.length;
    let sent = 0;
    const failAt = (reason, msgId) => {
      if (msgId) patchMessage(sessionKey, msgId, { sendState: "failed", sendError: reason, sendProgress: void 0 });
      addLog(
        "[传输助手] 第 " + (sent + 1) + " 张发送失败：" + reason + "（已发 " + sent + "/" + total + "）",
        "error"
      );
    };
    const msgIds = list.map(() => nextId());
    list.forEach((it, i) => {
      addMessage(sessionKey, {
        id: msgIds[i],
        type: "image",
        direction: "out",
        sessionKey,
        name: it.name,
        mime: it.mime,
        blob: it.file,
        previewUrl: it.url,
        ts: Date.now(),
        sendState: "sending"
      });
    });
    const sendNext = () => {
      if (sent >= total) {
        addLog("[传输助手] " + total + " 张图片已全部发送", "success");
        return;
      }
      const it = list[sent];
      const msgId = msgIds[sent];
      addLog("[传输助手] 正在处理（" + (sent + 1) + "/" + total + "）：" + (it.name || "image"), "info");
      compressImageForPhone(it.file).then((out) => {
        if (imagePayloadBytes(out.blob, out.name, out.mime) > RELAY_MAX_BODY) {
          addLog(
            "[传输助手] 第 " + (sent + 1) + " 张压缩后仍超限（单张约 100MB 上限），已停止（已发 " + sent + "/" + total + "）",
            "error",
            true
          );
          failAt("压缩后仍超过单张上限（约 100MB）", msgId);
          return;
        }
        addLog(
          "[传输助手] " + (out.compressed ? "已压缩 " + it.name + "：" + kbText(it.file.size) + " → " + kbText(out.blob.size) : "原图发送 " + out.name + "（" + kbText(out.blob.size) + "）") + "，正在发送（" + (sent + 1) + "/" + total + "）",
          "info"
        );
        patchMessage(sessionKey, msgId, { blob: out.blob, name: out.name, mime: out.mime });
        const rd = new FileReader();
        rd.onload = () => {
          const b64 = (rd.result || "").split(",")[1] || "";
          if (!b64) {
            failAt("读取图片失败", msgId);
            return;
          }
          let lastPct = -1;
          sendToPhone({
            server,
            uuid: getDeviceId(),
            payload: { name: out.name, mime: out.mime, data: b64, targets },
onUploadProgress: (pct) => {
              if (pct !== lastPct) {
                lastPct = pct;
                patchMessage(sessionKey, msgId, { sendProgress: pct });
              }
            },
            onOk: () => {
              sent++;
              patchMessage(sessionKey, msgId, {
                sendState: void 0,
                sendError: void 0,
                sendProgress: void 0
              });
              sendNext();
            },
            onFail: (e) => failAt(e, msgId)
          });
        };
        rd.onerror = () => failAt("读取图片失败", msgId);
        rd.readAsDataURL(out.blob);
      }).catch((e) => failAt(e && e.message || "图片处理失败", msgIds[sent]));
    };
    sendNext();
    return true;
  }
  function kbText(bytes) {
    return Math.max(1, Math.round((Number(bytes) || 0) / 1024)) + "KB";
  }
  function sendFilesToSession(sessionKey, files, onProgress) {
    const server = validServer();
    if (!files.length) return false;
    if (!server) {
      addLog("[传输助手] 尚未配置中继服务器，无法发送", "error", true);
      return false;
    }
    if (!sessionSendable()) {
      addLog("[传输助手] 当前无在线设备，无法发送", "error", true);
      return false;
    }
    const targets = sendTargets(sessionKey);
    const list = files.slice();
    const total = list.length;
    let sent = 0;
    const failAt = (reason, msgId) => {
      if (msgId) patchMessage(sessionKey, msgId, { sendState: "failed", sendError: reason, sendProgress: void 0 });
      addLog(
        "[传输助手] 第 " + (sent + 1) + " 个文件发送失败：" + reason + "（已发 " + sent + "/" + total + "）",
        "error"
      );
    };
    const msgIds = list.map(() => nextId());
    list.forEach((it, i) => {
      addMessage(sessionKey, {
        id: msgIds[i],
        type: "file",
        direction: "out",
        sessionKey,
        name: it.name,
        mime: it.mime,
        blob: it.file,
        previewUrl: it.url,
        ts: Date.now(),
        sendState: "sending"
      });
    });
    const sendNext = () => {
      if (sent >= total) {
        addLog("[传输助手] " + total + " 个文件已全部发送", "success");
        return;
      }
      const it = list[sent];
      const msgId = msgIds[sent];
      const est = imagePayloadBytes(it.file, it.name, it.mime);
      if (est > RELAY_MAX_BODY) {
        addLog(
          "[传输助手] 第 " + (sent + 1) + " 个文件过大（" + kbText(it.file.size) + "，编码后约 " + kbText(est) + "，超过单次上限约 100MB），已停止（已发 " + sent + "/" + total + "）",
          "error",
          true
        );
        failAt("文件过大（编码后约 " + kbText(est) + "，超过单次上限约 100MB）", msgId);
        return;
      }
      addLog(
        "[传输助手] 正在发送文件（" + (sent + 1) + "/" + total + "）：" + it.name + "（" + kbText(it.file.size) + "）",
        "info"
      );
      const rd = new FileReader();
      rd.onload = () => {
        const b64 = (rd.result || "").split(",")[1] || "";
        if (!b64) {
          failAt("读取文件失败", msgId);
          return;
        }
        let lastPct = -1;
        sendToPhone({
          server,
          uuid: getDeviceId(),
          payload: { name: it.name, mime: it.mime, data: b64, targets },
onUploadProgress: (pct) => {
            if (pct !== lastPct) {
              lastPct = pct;
              patchMessage(sessionKey, msgId, { sendProgress: pct });
            }
          },
          onOk: () => {
            sent++;
            patchMessage(sessionKey, msgId, {
              sendState: void 0,
              sendError: void 0,
              sendProgress: void 0
            });
            sendNext();
          },
          onFail: (e) => failAt(e, msgId)
        });
      };
      rd.onerror = () => failAt("读取文件失败", msgId);
      rd.readAsDataURL(it.file);
    };
    sendNext();
    return true;
  }
  let pruneTimer = null;
  function pruneExpiredNow() {
    const minTs = Date.now() - TRANSFER_TTL_MS;
    let changed = false;
    const next = [];
    state.sessions.forEach((s) => {
      const kept = s.messages.filter((m) => (m.ts || 0) >= minTs);
      if (kept.length !== s.messages.length) {
        s.messages.forEach((m) => {
          if ((m.ts || 0) < minTs) revokeUrl(m.previewUrl);
        });
        changed = true;
      }
      if (kept.length) next.push({ ...s, messages: kept, lastTs: kept[kept.length - 1].ts || s.lastTs });
    });
    if (changed) {
      state = {
        ...state,
        sessions: next,
        activeSessionKey: next.some((s) => s.key === state.activeSessionKey) ? state.activeSessionKey : ""
      };
      emit();
      persistSoon();
    }
  }
  function initTransfer() {
    if (inited) return;
    inited = true;
    restartLoops();
    void loadPersistedSessions().then((loaded) => {
      if (loaded.length) {
        const merged = state.sessions.slice();
        loaded.forEach((s) => {
          if (!merged.some((x) => x.key === s.key)) merged.push(s);
        });
        merged.sort((a, b) => b.lastTs - a.lastTs);
        state = { ...state, sessions: merged };
        emit();
      }
    }).catch(() => {
    }).finally(() => {
      persistReady = true;
    });
    pruneExpiredNow();
    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = setInterval(pruneExpiredNow, 60 * 60 * 1e3);
  }
  function stopTransfer() {
    stopLoops();
    if (pruneTimer) {
      clearInterval(pruneTimer);
      pruneTimer = null;
    }
    knownPhones = new Set();
    phonesSeenAt = 0;
    inited = false;
  }
  const POLL_INTERVAL = 300;
  const POLL_TIMEOUT = 8e3;
  const MAX_EXPAND_ROUNDS = 12;
  const EXPAND_GAP = 350;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function waitFor(what, probe) {
    return new Promise((resolve, reject) => {
      const started2 = Date.now();
      const tick = () => {
        let hit = null;
        try {
          hit = probe();
        } catch {
        }
        if (hit) return resolve(hit);
        if (Date.now() - started2 > POLL_TIMEOUT) {
          return reject(new Error("等待「" + what + "」超时（" + POLL_TIMEOUT + "ms）——是否已进入会话页面？"));
        }
        setTimeout(tick, POLL_INTERVAL);
      };
      tick();
    });
  }
  function clickEl(el) {
    const opts = { bubbles: true, cancelable: true };
    let ev;
    try {
      ev = new MouseEvent("click", opts);
    } catch {
      ev = new Event("click", opts);
    }
    el.dispatchEvent(ev);
  }
  function findTabNav(text) {
    const label = [...document.querySelectorAll(".t-tabs__nav-item-text-wrapper")].find(
      (e) => {
        var _a;
        return ((_a = e.textContent) == null ? void 0 : _a.trim()) === text;
      }
    );
    return (label == null ? void 0 : label.closest(".t-tabs__nav-item")) || null;
  }
  async function switchTab(text) {
    const nav = findTabNav(text);
    if (!nav) throw new Error("右侧栏没有「" + text + "」tab——是否已进入会话页面？");
    if (!nav.className.includes("active")) {
      clickEl(nav);
      await waitFor(text + " tab 激活", () => nav.className.includes("active") ? nav : null);
    }
  }
  async function expandAllFolders(panel) {
    let lastClosed = -1;
    for (let round = 0; round < MAX_EXPAND_ROUNDS; round++) {
      const closed = [...panel.querySelectorAll(".t-tree__item")].filter(
        (it) => !it.classList.contains("custom-rich-node") && !it.classList.contains("t-tree__item--open")
      );
      if (!closed.length) return;
      if (closed.length === lastClosed) return;
      lastClosed = closed.length;
      for (const item of closed) {
        clickEl(item.querySelector(".t-folder-icon") || item);
        await sleep(EXPAND_GAP);
      }
      await sleep(500);
    }
  }
  function extractGroups(panel) {
    const read = (sel) => [...panel.querySelectorAll(sel + " .auxiliary-item")].map((i) => {
      var _a;
      return (((_a = i.firstElementChild) == null ? void 0 : _a.textContent) || "").trim();
    }).filter(Boolean);
    return { all: read(".verbal-trink-main"), mine: read(".main") };
  }
  function readPhrasesFromZnhd() {
    const restoreHome = () => {
      try {
        const home = findTabNav("会话人信息");
        if (home && !home.className.includes("active")) clickEl(home);
      } catch {
      }
    };
    return (async () => {
      try {
        await switchTab("常用话术");
        const panel = await waitFor(
          "话术面板",
          () => [...document.querySelectorAll(".display-container")].find(
            (e) => e.querySelector(".t-tree__item")
          ) || null
        );
        await expandAllFolders(panel);
        const data = extractGroups(panel);
        if (!data.all.length && !data.mine.length) {
          throw new Error("话术面板里没有读到任何条目——可能是文件夹未展开或页面结构已变化");
        }
        return data;
      } finally {
        restoreHome();
      }
    })();
  }
  function resolveGithubUrl(githubUrl) {
    const url = (githubUrl || "").trim();
    if (!url) return url;
    const useCdn = runtime.useCdn;
    const ghBlob = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i;
    if (ghBlob.test(url)) {
      if (useCdn) {
        return url.replace(ghBlob, "https://fastly.jsdelivr.net/gh/$1/$2@$3");
      }
      return url.replace(ghBlob, "https://raw.githubusercontent.com/$1/$2/$3");
    }
    const raw = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)$/i;
    if (raw.test(url)) {
      if (useCdn) {
        return url.replace(raw, "https://fastly.jsdelivr.net/gh/$1/$2@$3");
      }
      return url;
    }
    return url;
  }
  const _escapeHelper = document.createElement("div");
  function escapeHtml(text) {
    _escapeHelper.textContent = text;
    return _escapeHelper.innerHTML;
  }
  function hoursToHHmm(h2) {
    if (typeof h2 !== "number" || isNaN(h2)) return "00:00";
    let total = Math.round(h2 * 60);
    if (total < 0) total = 0;
    if (total > 24 * 60) total = 24 * 60;
    const H = Math.floor(total / 60) % 24;
    const M = total % 60;
    return String(H).padStart(2, "0") + ":" + String(M).padStart(2, "0");
  }
  function hhmmToHours(str2) {
    if (typeof str2 !== "string") return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(str2.trim());
    if (!m) return null;
    const H = parseInt(m[1], 10);
    const M = parseInt(m[2], 10);
    if (H < 0 || H > 23 || M < 0 || M > 59) return null;
    return H + M / 60;
  }
  const SHADOW_ROOT_KEY = Symbol("znhd-shadow-root");
  let currentShadowRoot = null;
  function setShadowRoot(root) {
    currentShadowRoot = root;
  }
  function getShadowRoot() {
    return currentShadowRoot;
  }
  const KIND_CLASS = {
    success: "alert-success",
    error: "alert-error",
    warning: "alert-warning",
    info: "alert-info"
  };
  const DURATION = 3200;
  let container = null;
  function ensureContainer() {
    var _a;
    const root = getShadowRoot();
    if (!root) return null;
    if (container == null ? void 0 : container.isConnected) return container;
    const host = (_a = root.querySelector("#app")) != null ? _a : root;
    container = document.createElement("div");
    container.className = "toast toast-top toast-center";
    container.setAttribute("data-znhd", "toast");
    host.appendChild(container);
    return container;
  }
  function show(kind, msg) {
    const box = ensureContainer();
    if (!box) return;
    const el = document.createElement("div");
    el.className = `alert ${KIND_CLASS[kind]}`;
    el.setAttribute("role", "alert");
    el.textContent = msg;
    box.appendChild(el);
    window.setTimeout(() => {
      el.remove();
      if (container && container.childElementCount === 0) {
        container.remove();
        container = null;
      }
    }, DURATION);
  }
  const toast = {
    success: (msg) => show("success", msg),
    error: (msg) => show("error", msg),
    warning: (msg) => show("warning", msg),
    info: (msg) => show("info", msg)
  };
  const toast$1 = Object.freeze( Object.defineProperty({
    __proto__: null,
    toast
  }, Symbol.toStringTag, { value: "Module" }));
  const THEME_NAME = {
    light: "wireframe",
    dark: "business"
  };
  const STORAGE_KEY = "scriptCat_VueTheme";
  const mode = vue.ref("light");
  let hostEl = null;
  function systemPrefersDark() {
    try {
      return !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  }
  function readSaved() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      return v === "dark" || v === "light" ? v : null;
    } catch {
      return null;
    }
  }
  function apply(next) {
    mode.value = next;
    if (!hostEl) return;
    hostEl.dataset.theme = THEME_NAME[next];
    hostEl.classList.toggle("dark", next === "dark");
  }
  function initTheme(host) {
    var _a;
    hostEl = host;
    apply((_a = readSaved()) != null ? _a : systemPrefersDark() ? "dark" : "light");
  }
  function setTheme(next) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
    }
    apply(next);
  }
  function toggleTheme() {
    const next = mode.value === "dark" ? "light" : "dark";
    setTheme(next);
    return next;
  }
  const themeMode = vue.readonly(mode);
  const ICONS = {
    settings: [
      [
        "path",
        {
          d: "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"
        }
      ],
      ["circle", { cx: 12, cy: 12, r: 3 }]
    ],
    transfer: [
      ["path", { d: "M8 3 4 7l4 4" }],
      ["path", { d: "M4 7h16" }],
      ["path", { d: "m16 21 4-4-4-4" }],
      ["path", { d: "M20 17H4" }]
    ],
    phrases: [
      [
        "path",
        {
          d: "M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"
        }
      ]
    ],
    sniff: [
      [
        "path",
        {
          d: "M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"
        }
      ],
      ["path", { d: "m14 19 3 3v-5.5" }],
      ["path", { d: "m17 22 3-3" }],
      ["circle", { cx: 9, cy: 9, r: 2 }]
    ],
    volumeOn: [
      [
        "path",
        {
          d: "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"
        }
      ],
      ["path", { d: "M16 9a5 5 0 0 1 0 6" }],
      ["path", { d: "M19.364 18.364a9 9 0 0 0 0-12.728" }]
    ],
    volumeOff: [
      [
        "path",
        {
          d: "M11 4.702a.7.7 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.7.7 0 0 0 11 19.298z"
        }
      ],
      ["path", { d: "m16.5 14.5 5-5" }],
      ["path", { d: "m16.5 9.5 5 5" }]
    ],
    crosshair: [
      ["circle", { cx: 12, cy: 12, r: 10 }],
      ["line", { x1: 22, x2: 18, y1: 12, y2: 12 }],
      ["line", { x1: 6, x2: 2, y1: 12, y2: 12 }],
      ["line", { x1: 12, x2: 12, y1: 6, y2: 2 }],
      ["line", { x1: 12, x2: 12, y1: 22, y2: 18 }]
    ],
    close: [
      ["path", { d: "M18 6 6 18" }],
      ["path", { d: "m6 6 12 12" }]
    ],
qr: [
      ["rect", { width: 5, height: 5, x: 3, y: 3, rx: 1 }],
      ["rect", { width: 5, height: 5, x: 16, y: 3, rx: 1 }],
      ["rect", { width: 5, height: 5, x: 3, y: 16, rx: 1 }],
      ["path", { d: "M21 16h-3a2 2 0 0 0-2 2v3" }],
      ["path", { d: "M21 21v.01" }],
      ["path", { d: "M12 7v3a2 2 0 0 1-2 2H7" }],
      ["path", { d: "M3 12h.01" }],
      ["path", { d: "M12 3h.01" }],
      ["path", { d: "M12 16v.01" }],
      ["path", { d: "M16 12h1" }],
      ["path", { d: "M21 12v.01" }],
      ["path", { d: "M12 21v-1" }]
    ],
refresh: [
      ["path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
      ["path", { d: "M21 3v5h-5" }],
      ["path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
      ["path", { d: "M3 21v-5h5" }]
    ],

message: [["path", { d: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z" }]],
files: [
      [
        "path",
        {
          d: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"
        }
      ]
    ],
    info: [
      ["circle", { cx: 12, cy: 12, r: 10 }],
      ["path", { d: "M12 16v-4" }],
      ["path", { d: "M12 8h.01" }]
    ],
    grid: [
      ["rect", { width: 7, height: 7, x: 3, y: 3, rx: 1 }],
      ["rect", { width: 7, height: 7, x: 14, y: 3, rx: 1 }],
      ["rect", { width: 7, height: 7, x: 14, y: 14, rx: 1 }],
      ["rect", { width: 7, height: 7, x: 3, y: 14, rx: 1 }]
    ],
    plus: [
      ["path", { d: "M5 12h14" }],
      ["path", { d: "M12 5v14" }]
    ],
    search: [
      ["circle", { cx: 11, cy: 11, r: 8 }],
      ["path", { d: "m21 21-4.3-4.3" }]
    ],
    smartphone: [
      ["rect", { width: 14, height: 20, x: 5, y: 2, rx: 2, ry: 2 }],
      ["path", { d: "M12 18h.01" }]
    ],
    send: [
      ["path", { d: "m5 12 7-7 7 7" }],
      ["path", { d: "M12 19V5" }]
    ],
    fileText: [
      ["path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }],
      ["path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }],
      ["path", { d: "M10 9H8" }],
      ["path", { d: "M16 13H8" }],
      ["path", { d: "M16 17H8" }]
    ],
    paperclip: [
      [
        "path",
        {
          d: "m16 6-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"
        }
      ]
    ],
    image: [
      ["rect", { width: 18, height: 18, x: 3, y: 3, rx: 2, ry: 2 }],
      ["circle", { cx: 9, cy: 9, r: 2 }],
      ["path", { d: "m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" }]
    ],
    user: [
      ["path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }],
      ["circle", { cx: 12, cy: 7, r: 4 }]
    ],
    trash: [
      ["path", { d: "M3 6h18" }],
      ["path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" }],
      ["path", { d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }],
      ["line", { x1: 10, x2: 10, y1: 11, y2: 17 }],
      ["line", { x1: 14, x2: 14, y1: 11, y2: 17 }]
    ],
    copy: [
      ["rect", { width: 14, height: 14, x: 8, y: 8, rx: 2, ry: 2 }],
      ["path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }]
    ],
    download: [
      ["path", { d: "M12 15V3" }],
      ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
      ["path", { d: "m7 10 5 5 5-5" }]
    ],
    check: [["path", { d: "M20 6 9 17l-5-5" }]],
    printer: [
      ["path", { d: "M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" }],
      ["path", { d: "M6 9V3h12v6" }],
      ["rect", { width: 12, height: 8, x: 6, y: 14, rx: 1 }]
    ],
    chevronLeft: [["path", { d: "m15 18-6-6 6-6" }]],
    chevronRight: [["path", { d: "m9 18 6-6-6-6" }]],
    rotateCw: [
      ["path", { d: "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" }],
      ["path", { d: "M21 3v5h-5" }]
    ],
    zoomIn: [
      ["circle", { cx: 11, cy: 11, r: 8 }],
      ["path", { d: "m21 21-4.3-4.3" }],
      ["path", { d: "M11 8v6" }],
      ["path", { d: "M8 11h6" }]
    ],
    zoomOut: [
      ["circle", { cx: 11, cy: 11, r: 8 }],
      ["path", { d: "m21 21-4.3-4.3" }],
      ["path", { d: "M8 11h6" }]
    ],
sun: [
      ["circle", { cx: 12, cy: 12, r: 4 }],
      ["path", { d: "M12 2v2" }],
      ["path", { d: "M12 20v2" }],
      ["path", { d: "m4.93 4.93 1.41 1.41" }],
      ["path", { d: "m17.66 17.66 1.41 1.41" }],
      ["path", { d: "M2 12h2" }],
      ["path", { d: "M20 12h2" }],
      ["path", { d: "m6.34 17.66-1.41 1.41" }],
      ["path", { d: "m19.07 4.93-1.41 1.41" }]
    ],
    moon: [["path", { d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" }]],
more: [
      ["circle", { cx: 12, cy: 12, r: 1 }],
      ["circle", { cx: 19, cy: 12, r: 1 }],
      ["circle", { cx: 5, cy: 12, r: 1 }]
    ]
  };
  const Icon = (props) => {
    var _a, _b;
    return vue.h(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        width: (_a = props.size) != null ? _a : 16,
        height: (_b = props.size) != null ? _b : 16,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: props.color || "currentColor",
        "stroke-width": 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
        focusable: "false",
        style: "display:block;flex:0 0 auto"
      },
      ICONS[props.name].map(([tag, attrs]) => vue.h(tag, attrs))
    );
  };
  Icon.props = ["name", "size", "color"];
  const MIN_VISIBLE = 48;
  const HANDLE_MIN = 40;
  function clampPanelPoint(pt, size) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = (size == null ? void 0 : size.w) || 320;
    const h2 = (size == null ? void 0 : size.h) || 0;
    const keepX = Math.min(MIN_VISIBLE, w);
    const keepY = h2 ? Math.min(HANDLE_MIN, h2) : HANDLE_MIN;
    return {
      x: Math.min(Math.max(pt.x, -(w - keepX)), vw - keepX),
      y: Math.min(Math.max(pt.y, 0), vh - keepY)
    };
  }
  function clampIntoView(pt, w, h2) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return {
      x: Math.min(Math.max(pt.x, 4), Math.max(4, vw - w - 4)),
      y: Math.min(Math.max(pt.y, 4), Math.max(4, vh - h2 - 4))
    };
  }
  function clampHostIntoView(host) {
    const pt = clampIntoView(
      { x: parseFloat(host.style.left) || 0, y: parseFloat(host.style.top) || 0 },
      host.offsetWidth,
      host.offsetHeight
    );
    host.style.left = Math.round(pt.x) + "px";
    host.style.top = Math.round(pt.y) + "px";
    savePanelPoint(pt);
  }
  function initialPanelPoint() {
    const saved = loadPanelPoint();
    const pt = saved || { x: Math.round(window.innerWidth * 0.55), y: 12 };
    return clampIntoView(pt, PANEL_WIDTH, 0);
  }
  const DRAG_THRESHOLD = 4;
  function usePanelDrag(host) {
    const drag = vue.ref(null);
    const start = vue.ref(null);
    const moved = vue.ref(false);
    function onPointerDown(e) {
      var _a, _b, _c, _d;
      if (e.button !== 0 && e.pointerType === "mouse") return;
      const hit = (_b = (_a = e.target) == null ? void 0 : _a.closest) == null ? void 0 : _b.call(_a, "button, a, input, textarea, select, label");
      if (hit && hit !== e.currentTarget) return;
      const rect = host.getBoundingClientRect();
      drag.value = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      start.value = { x: e.clientX, y: e.clientY };
      moved.value = false;
      (_d = (_c = e.currentTarget).setPointerCapture) == null ? void 0 : _d.call(_c, e.pointerId);
      e.preventDefault();
    }
    function onPointerMove(e) {
      const d = drag.value;
      if (!d) return;
      const s = start.value;
      if (s && !moved.value) {
        if (Math.abs(e.clientX - s.x) > DRAG_THRESHOLD || Math.abs(e.clientY - s.y) > DRAG_THRESHOLD) {
          moved.value = true;
        }
      }
      const pt = clampPanelPoint(
        { x: e.clientX - d.dx, y: e.clientY - d.dy },
        { w: host.offsetWidth, h: host.offsetHeight }
      );
      host.style.left = Math.round(pt.x) + "px";
      host.style.top = Math.round(pt.y) + "px";
    }
    function endDrag() {
      if (!drag.value) return;
      drag.value = null;
      start.value = null;
      const pt = {
        x: parseFloat(host.style.left) || 0,
        y: parseFloat(host.style.top) || 0
      };
      const clamped = clampPanelPoint(pt, { w: host.offsetWidth, h: host.offsetHeight });
      host.style.left = Math.round(clamped.x) + "px";
      host.style.top = Math.round(clamped.y) + "px";
      savePanelPoint(clamped);
    }
    function consumeDrag() {
      const v = moved.value;
      moved.value = false;
      return v;
    }
    function clampNow(persist) {
      const pt = clampIntoView(
        { x: parseFloat(host.style.left) || 0, y: parseFloat(host.style.top) || 0 },
        host.offsetWidth,
        host.offsetHeight
      );
      host.style.left = Math.round(pt.x) + "px";
      host.style.top = Math.round(pt.y) + "px";
      if (persist) savePanelPoint(pt);
    }
    vue.onMounted(() => {
      clampNow(false);
      window.addEventListener("resize", onResize);
    });
    vue.onBeforeUnmount(() => window.removeEventListener("resize", onResize));
    function onResize() {
      clampNow(true);
    }
    return {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      consumeDrag
    };
  }
  const _hoisted_1$i = { class: "flex items-center justify-between gap-3" };
  const _hoisted_2$h = { class: "min-w-0 text-[15px] font-semibold leading-6" };
  const _hoisted_3$h = { method: "dialog" };
  const _hoisted_4$g = {
    class: "btn btn-ghost btn-sm btn-square",
    "aria-label": "关闭"
  };
  const _hoisted_5$g = {
    key: 0,
    class: "modal-action"
  };
  const _sfc_main$k = vue.defineComponent({
    __name: "AppDialog",
    props: vue.mergeModels({
      title: {},
      description: { default: "" },
      width: { default: 520 },
      footer: { type: Boolean, default: true }
    }, {
      "open": { type: Boolean, ...{ default: false } },
      "openModifiers": {}
    }),
    emits: ["update:open"],
    setup(__props) {
      const open = vue.useModel(__props, "open");
      const props = __props;
      const dlg = vue.ref(null);
      function sync(v) {
        const el = dlg.value;
        if (!el) return;
        if (v && !el.open) el.showModal();
        else if (!v && el.open) el.close();
      }
      vue.watch(open, (v) => sync(v));
      vue.onMounted(() => {
        if (open.value) sync(true);
      });
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createElementBlock("dialog", {
          ref_key: "dlg",
          ref: dlg,
          class: "modal",
          onClose: _cache[1] || (_cache[1] = ($event) => open.value = false)
        }, [
          vue.createElementVNode("div", {
            class: "modal-box",
            style: vue.normalizeStyle({ width: props.width + "px", maxWidth: "calc(100vw - 32px)" })
          }, [
            vue.createElementVNode("div", _hoisted_1$i, [
              vue.createElementVNode("h3", _hoisted_2$h, [
                vue.renderSlot(_ctx.$slots, "title", {}, () => [
                  vue.createTextVNode(vue.toDisplayString(props.title), 1)
                ])
              ]),
              vue.createElementVNode("form", _hoisted_3$h, [
                vue.createElementVNode("button", _hoisted_4$g, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "close",
                    size: 15
                  })
                ])
              ])
            ]),
            vue.renderSlot(_ctx.$slots, "default"),
            props.footer || _ctx.$slots.footer ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_5$g, [
              vue.renderSlot(_ctx.$slots, "footer", {}, () => [
                vue.createElementVNode("button", {
                  class: "btn btn-sm",
                  onClick: _cache[0] || (_cache[0] = ($event) => open.value = false)
                }, "确定")
              ])
            ])) : vue.createCommentVNode("", true)
          ], 4),
          _cache[2] || (_cache[2] = vue.createElementVNode("form", {
            method: "dialog",
            class: "modal-backdrop"
          }, [
            vue.createElementVNode("button", null, "close")
          ], -1))
        ], 544);
      };
    }
  });
  const _hoisted_1$h = { class: "flex flex-wrap items-center gap-2" };
  const _hoisted_2$g = ["href"];
  const _hoisted_3$g = { class: "fieldset" };
  const _hoisted_4$f = ["checked"];
  const _hoisted_5$f = { class: "fieldset" };
  const _hoisted_6$c = ["checked"];
  const _hoisted_7$b = { class: "fieldset" };
  const _hoisted_8$9 = { class: "w-8 text-[13px] text-base-content/60" };
  const _hoisted_9$9 = ["value", "onInput"];
  const _hoisted_10$9 = ["value", "onInput"];
  const HOMEPAGE_URL = "https://github.com/Run-os/znhd-service";
  const _sfc_main$j = vue.defineComponent({
    __name: "SettingsDialog",
    props: {
      open: { type: Boolean },
      workingHours: {},
      useCdn: { type: Boolean },
      sniffPreMeasure: { type: Boolean }
    },
    emits: ["update:open", "changeWorkingHours", "changeUseCdn", "changeSniffPreMeasure", "openChangelog"],
    setup(__props, { emit: __emit }) {
      const props = __props;
      const emit2 = __emit;
      const wh = vue.computed(
        () => props.workingHours || { morningStart: 9, morningEnd: 12, afternoonStart: 13.5, afternoonEnd: 18 }
      );
      function updateWh(field, raw) {
        const dec = hhmmToHours(String(raw != null ? raw : ""));
        if (dec === null || typeof dec !== "number" || isNaN(dec)) return;
        emit2("changeWorkingHours", { ...wh.value, [field]: dec });
      }
      const timeFields = [
        { row: "上午", from: "morningStart", to: "morningEnd" },
        { row: "下午", from: "afternoonStart", to: "afternoonEnd" }
      ];
      const UPDATE_URL = GM_info.scriptUpdateURL || GM_info.script.updateURL;
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createBlock(_sfc_main$k, {
          open: props.open,
          title: "设置菜单",
          width: 520,
          footer: false,
          "onUpdate:open": _cache[3] || (_cache[3] = ($event) => emit2("update:open", $event))
        }, {
          default: vue.withCtx(() => [
            vue.createElementVNode("div", _hoisted_1$h, [
              vue.createElementVNode("a", {
                class: "btn btn-outline btn-sm",
                href: HOMEPAGE_URL,
                target: "_blank",
                rel: "noreferrer"
              }, "脚本主页"),
              vue.createElementVNode("a", {
                class: "btn btn-outline btn-sm",
                href: vue.unref(UPDATE_URL),
                target: "_blank",
                rel: "noreferrer"
              }, "更新脚本", 8, _hoisted_2$g),
              vue.createElementVNode("button", {
                class: "btn btn-outline btn-sm",
                onClick: _cache[0] || (_cache[0] = ($event) => emit2("openChangelog"))
              }, "更新日志")
            ]),
            _cache[10] || (_cache[10] = vue.createElementVNode("div", { class: "divider" }, "其他设置", -1)),
            vue.createElementVNode("fieldset", _hoisted_3$g, [
              _cache[4] || (_cache[4] = vue.createElementVNode("legend", { class: "fieldset-legend" }, "使用 CDN 加速（Fastly 镜像）加载资源", -1)),
              vue.createElementVNode("input", {
                type: "checkbox",
                class: "toggle",
                checked: props.useCdn,
                onChange: _cache[1] || (_cache[1] = ($event) => emit2("changeUseCdn", $event.target.checked))
              }, null, 40, _hoisted_4$f)
            ]),
            vue.createElementVNode("fieldset", _hoisted_5$f, [
              _cache[5] || (_cache[5] = vue.createElementVNode("legend", { class: "fieldset-legend" }, "图片嗅探：先在后台预测量图片大小", -1)),
              vue.createElementVNode("input", {
                type: "checkbox",
                class: "toggle",
                checked: props.sniffPreMeasure,
                onChange: _cache[2] || (_cache[2] = ($event) => emit2("changeSniffPreMeasure", $event.target.checked))
              }, null, 40, _hoisted_6$c),
              _cache[6] || (_cache[6] = vue.createElementVNode("p", { class: "label" }, " 开启后打开嗅探窗口即刻显示大小（不必当场等测量）。代价：页面上的图若只能靠请求测大小 （跨域且拿不到资源表读数），脚本会在没打开窗口时就去测量 —— 关掉此项可避免这类请求。 ", -1))
            ]),
            vue.createElementVNode("fieldset", _hoisted_7$b, [
              _cache[8] || (_cache[8] = vue.createElementVNode("legend", { class: "fieldset-legend" }, "监控时间段（点击选择时间）", -1)),
              (vue.openBlock(), vue.createElementBlock(vue.Fragment, null, vue.renderList(timeFields, (f) => {
                return vue.createElementVNode("div", {
                  key: f.row,
                  class: "flex flex-wrap items-center gap-2"
                }, [
                  vue.createElementVNode("span", _hoisted_8$9, vue.toDisplayString(f.row), 1),
                  vue.createElementVNode("input", {
                    type: "time",
                    step: "300",
                    class: "input w-[112px]",
                    value: vue.unref(hoursToHHmm)(wh.value[f.from]),
                    onInput: ($event) => updateWh(f.from, $event.target.value)
                  }, null, 40, _hoisted_9$9),
                  _cache[7] || (_cache[7] = vue.createElementVNode("span", { class: "text-[13px] text-base-content/60" }, "至", -1)),
                  vue.createElementVNode("input", {
                    type: "time",
                    step: "300",
                    class: "input w-[112px]",
                    value: vue.unref(hoursToHHmm)(wh.value[f.to]),
                    onInput: ($event) => updateWh(f.to, $event.target.value)
                  }, null, 40, _hoisted_10$9)
                ]);
              }), 64)),
              _cache[9] || (_cache[9] = vue.createElementVNode("p", { class: "label" }, "提示：将「下午开始」设为与「上午结束」相同（如都设为 12:00），即可午休时段也监控。", -1))
            ])
          ]),
          _: 1
        }, 8, ["open"]);
      };
    }
  });
  function appendToTinyMCE(text2append = "") {
    var _a, _b, _c, _d, _e;
    const editors = (_b = (_a = window.tinymce) == null ? void 0 : _a.editors) != null ? _b : [];
    const ed = editors.find((e) => e.inline === false);
    const editor = ed || editors[0];
    let isInputEmpty = true;
    if (editor) {
      const body = editor.getBody();
      isInputEmpty = !body.textContent.trim();
    } else {
      const iframe = document.querySelector(".input-box iframe.tox-edit-area__iframe") || document.querySelector("iframe.tox-edit-area__iframe") || document.querySelector('iframe[class*="tox"]');
      if (iframe) {
        try {
          const doc = iframe.contentDocument;
          if (!doc) throw new Error("contentDocument 不可访问");
          const body = doc.querySelector("body#tinymce") || doc.body;
          if (!body) throw new Error("找不到 iframe body");
          isInputEmpty = !(body.textContent || "").trim();
        } catch (e) {
          addLog("无法访问iframe内容: " + e.message, "warning", true);
        }
      }
    }
    const escapedText = escapeHtml(text2append);
    let processedContent = escapedText.replace(/\n/g, "<br>");
    if (!isInputEmpty) {
      processedContent = "<br>" + processedContent;
    }
    if (editor) {
      const body = editor.getBody();
      if (isInputEmpty) {
        editor.setContent(processedContent);
      } else {
        editor.execCommand("mceInsertContent", false, processedContent);
      }
      editor.save();
      editor.setDirty(true);
      editor.selection.select(body, true);
      editor.selection.collapse(false);
    } else {
      const iframe = document.querySelector("iframe.tox-edit-area__iframe") || document.querySelector('iframe[class*="tox"]');
      if (!iframe) {
        addLog("找不到 TinyMCE iframe", "error", true);
        return "";
      }
      try {
        const doc = iframe.contentDocument;
        const body = doc ? doc.body : null;
        if (!body) {
          addLog("找不到 body", "error", true);
          return "";
        }
        if (isInputEmpty) {
          body.innerHTML = processedContent;
        } else {
          body.insertAdjacentHTML("beforeend", processedContent);
        }
        body.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (e) {
        addLog("无法访问 iframe 内容: " + e.message, "error", true);
        return "";
      }
    }
    const fallbackIframe = document.querySelector("iframe.tox-edit-area__iframe") || document.querySelector('iframe[class*="tox"]');
    const finalText = editor ? editor.getContent({ format: "text" }) : (_e = (_d = (_c = fallbackIframe == null ? void 0 : fallbackIframe.contentDocument) == null ? void 0 : _c.body) == null ? void 0 : _d.textContent) != null ? _e : "";
    addLog("已追加文本并同步: " + finalText, "success", true);
    return finalText;
  }
  let didaAudioPlayer = null;
  function playDidaSound() {
    try {
      if (!didaAudioPlayer) {
        didaAudioPlayer = new Audio();
        didaAudioPlayer.volume = 0.5;
      }
      const src = resolveGithubUrl(CONFIG.didaUrl);
      if (didaAudioPlayer.src !== src) didaAudioPlayer.src = src;
      didaAudioPlayer.currentTime = 0;
      didaAudioPlayer.play().catch(() => {
      });
    } catch (e) {
      addLog("播放提示音失败: " + e.message, "warning", true);
    }
  }
  function safeCopyText(text, onResult = null) {
    const notify2 = (v) => {
      if (typeof onResult === "function") {
        try {
          onResult(!!v);
        } catch (e) {
        }
      }
    };
    if (!text) {
      notify2(false);
      return;
    }
    if (typeof GM_setClipboard === "function") {
      try {
        GM_setClipboard(text);
        addLog("[复制] 已复制到剪贴板 (GM_setClipboard)", "success", true);
        playDidaSound();
        notify2(true);
        return;
      } catch (e) {
        addLog("[复制] GM_setClipboard 失败: " + e.message, "error", true);
      }
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(() => {
        addLog("[复制] 已复制到剪贴板 (navigator.clipboard)", "success", true);
        playDidaSound();
        notify2(true);
      }).catch((err) => {
        addLog("[复制] 复制到剪贴板失败: " + err.message, "error", true);
        notify2(false);
      });
      return;
    }
    notify2(false);
  }
  const _hoisted_1$g = { class: "modal-box w-[360px] max-w-[360px]" };
  const _hoisted_2$f = { class: "flex items-center gap-1" };
  const _hoisted_3$f = {
    class: "tooltip tooltip-bottom",
    "data-tip": "重新加载常用语"
  };
  const _hoisted_4$e = ["disabled"];
  const _hoisted_5$e = { class: "input input-sm my-3 w-full" };
  const _hoisted_6$b = ["value"];
  const _hoisted_7$a = {
    role: "tablist",
    class: "tabs tabs-box w-full"
  };
  const _hoisted_8$8 = {
    key: 0,
    class: "flex flex-col items-center gap-2 py-6"
  };
  const _hoisted_9$8 = {
    key: 1,
    class: "hero"
  };
  const _hoisted_10$8 = { class: "hero-content" };
  const _hoisted_11$8 = { class: "text-[13px] text-base-content/60" };
  const _hoisted_12$7 = {
    key: 2,
    class: "list"
  };
  const _hoisted_13$6 = ["data-tip"];
  const _hoisted_14$6 = ["onClick"];
  const _sfc_main$i = vue.defineComponent({
    __name: "PhrasesSheet",
    props: {
      open: { type: Boolean },
      phrasesData: {},
      phrasesLoading: { type: Boolean },
      searchKeyword: {}
    },
    emits: ["update:open", "update:searchKeyword", "reload"],
    setup(__props, { emit: __emit }) {
      const props = __props;
      const emit2 = __emit;
      const keyword = vue.computed(() => props.searchKeyword.trim().toLowerCase());
      const hit = (t) => !keyword.value || t.toLowerCase().includes(keyword.value);
      const all = vue.computed(() => (props.phrasesData.all || []).filter(hit));
      const mine = vue.computed(() => (props.phrasesData.mine || []).filter(hit));
      const tab = vue.ref("all");
      const rows = vue.computed(() => tab.value === "all" ? all.value : mine.value);
      const emptyText = vue.computed(
        () => tab.value === "all" ? "暂无全部话术，点右上角刷新抓取" : "暂无我的话术，点右上角刷新抓取"
      );
      const dlg = vue.ref(null);
      function sync(v) {
        const el = dlg.value;
        if (!el) return;
        if (v && !el.open) el.showModal();
        else if (!v && el.open) el.close();
      }
      vue.watch(
        () => props.open,
        (v) => sync(v)
      );
      vue.onMounted(() => {
        if (props.open) sync(true);
      });
      function pick(text) {
        safeCopyText(text);
        emit2("update:open", false);
        appendToTinyMCE(text);
        addLog(`添加文本: ${text}`, "success");
        toast.success("添加文本: " + text);
      }
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createElementBlock("dialog", {
          ref_key: "dlg",
          ref: dlg,
          class: "modal modal-end",
          onClose: _cache[4] || (_cache[4] = ($event) => emit2("update:open", false))
        }, [
          vue.createElementVNode("div", _hoisted_1$g, [
            vue.createElementVNode("div", _hoisted_2$f, [
              _cache[5] || (_cache[5] = vue.createElementVNode("h3", { class: "flex-1 text-[15px] font-semibold" }, "常用语", -1)),
              vue.createElementVNode("div", _hoisted_3$f, [
                vue.createElementVNode("button", {
                  class: "btn btn-ghost btn-xs btn-square",
                  "aria-label": "重新加载常用语",
                  disabled: props.phrasesLoading,
                  onClick: _cache[0] || (_cache[0] = ($event) => emit2("reload", true))
                }, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "refresh",
                    size: 15
                  })
                ], 8, _hoisted_4$e)
              ])
            ]),
            vue.createElementVNode("label", _hoisted_5$e, [
              vue.createVNode(vue.unref(Icon), {
                name: "search",
                size: 14
              }),
              vue.createElementVNode("input", {
                type: "text",
                placeholder: "搜索常用语(按内容)",
                value: props.searchKeyword,
                onInput: _cache[1] || (_cache[1] = ($event) => emit2("update:searchKeyword", $event.target.value))
              }, null, 40, _hoisted_6$b)
            ]),
            vue.createElementVNode("div", _hoisted_7$a, [
              vue.createElementVNode("button", {
                role: "tab",
                class: vue.normalizeClass(["tab", tab.value === "all" ? "tab-active" : ""]),
                onClick: _cache[2] || (_cache[2] = ($event) => tab.value = "all")
              }, " 全部话术 ", 2),
              vue.createElementVNode("button", {
                role: "tab",
                class: vue.normalizeClass(["tab", tab.value === "mine" ? "tab-active" : ""]),
                onClick: _cache[3] || (_cache[3] = ($event) => tab.value = "mine")
              }, " 我的话术 ", 2)
            ]),
            props.phrasesLoading ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_8$8, _cache[6] || (_cache[6] = [
              vue.createElementVNode("span", { class: "loading loading-spinner loading-md text-primary" }, null, -1),
              vue.createElementVNode("span", { class: "text-center text-xs leading-5 text-base-content/60" }, " 正在抓取常用话术…（右侧栏会自动切 tab，请勿操作） ", -1)
            ]))) : !rows.value.length ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_9$8, [
              vue.createElementVNode("div", _hoisted_10$8, [
                vue.createElementVNode("p", _hoisted_11$8, vue.toDisplayString(emptyText.value), 1)
              ])
            ])) : (vue.openBlock(), vue.createElementBlock("ul", _hoisted_12$7, [
              (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(rows.value, (t, i) => {
                return vue.openBlock(), vue.createElementBlock("li", {
                  key: tab.value + i,
                  class: "list-row py-0"
                }, [
                  vue.createElementVNode("div", {
                    class: "tooltip tooltip-left w-full",
                    "data-tip": t
                  }, [
                    vue.createElementVNode("button", {
                      class: "min-h-10 w-full text-left text-[13px] leading-5",
                      onClick: ($event) => pick(t)
                    }, vue.toDisplayString(t), 9, _hoisted_14$6)
                  ], 8, _hoisted_13$6)
                ]);
              }), 128))
            ]))
          ]),
          _cache[7] || (_cache[7] = vue.createElementVNode("form", {
            method: "dialog",
            class: "modal-backdrop"
          }, [
            vue.createElementVNode("button", null, "close")
          ], -1))
        ], 544);
      };
    }
  });
  const _hoisted_1$f = { class: "flex items-start justify-between gap-2" };
  const _hoisted_2$e = { class: "flex flex-wrap gap-1.5" };
  const _hoisted_3$e = ["title"];
  const _hoisted_4$d = ["title", "onClick"];
  const _hoisted_5$d = ["disabled"];
  const _hoisted_6$a = { class: "flex-none basis-[86px] opacity-55" };
  const _hoisted_7$9 = { class: "min-w-0 flex-1 whitespace-pre-wrap break-words" };
  const _hoisted_8$7 = {
    key: 1,
    class: "py-6 text-center opacity-55"
  };
  const _hoisted_9$7 = { class: "mt-2 flex items-center justify-between gap-2 border-t border-base-300 pt-1.5 text-[11.5px] text-base-content/60" };
  const _hoisted_10$7 = { class: "text-base-content" };
  const _hoisted_11$7 = { class: "text-base-content" };
  const _hoisted_12$6 = { class: "flex items-center gap-2.5" };
  const _hoisted_13$5 = {
    class: "flex items-center gap-1.5",
    title: "开启后新日志持续刷新并自动滚到底部；关闭后列表冻结在当前快照，便于往上翻看历史"
  };
  const _hoisted_14$5 = ["checked"];
  const _sfc_main$h = vue.defineComponent({
    __name: "LogDialog",
    props: {
      open: { type: Boolean },
      logEntries: {},
      autoRefresh: { type: Boolean }
    },
    emits: ["update:open", "clear", "update:autoRefresh"],
    setup(__props, { emit: __emit }) {
      const props = __props;
      const emit2 = __emit;
      const TYPES = [
        { type: "info", label: "信息", text: "text-info", bar: "border-l-info", btn: "btn-info" },
        { type: "success", label: "成功", text: "text-success", bar: "border-l-success", btn: "btn-success" },
        { type: "warning", label: "警告", text: "text-warning", bar: "border-l-warning", btn: "btn-warning" },
        { type: "error", label: "错误", text: "text-error", bar: "border-l-error", btn: "btn-error" }
      ];
      const metaOf = (t) => TYPES.find((m) => m.type === t) || TYPES[0];
      const filter = vue.ref({ info: true, success: true, warning: true, error: true });
      const snapshot = vue.ref([]);
      const scroller = vue.ref(null);
      vue.watch(
        () => props.autoRefresh,
        (next, prev) => {
          if (prev && !next) snapshot.value = props.logEntries;
        }
      );
      const source = vue.computed(() => props.autoRefresh ? props.logEntries : snapshot.value);
      const counts = vue.computed(() => {
        const c = { info: 0, success: 0, warning: 0, error: 0 };
        source.value.forEach((e) => c[e.type] = (c[e.type] || 0) + 1);
        return c;
      });
      const shown = vue.computed(() => source.value.filter((e) => filter.value[e.type]));
      const rows = vue.computed(() => shown.value.slice().reverse());
      const allOn = vue.computed(() => TYPES.every((m) => filter.value[m.type]));
      const latest = vue.computed(() => source.value[0]);
      function toggleAll() {
        const next = !allOn.value;
        filter.value = { info: next, success: next, warning: next, error: next };
      }
      async function scrollToBottom() {
        if (!props.open || !props.autoRefresh) return;
        await vue.nextTick();
        const el = scroller.value;
        if (el) el.scrollTop = el.scrollHeight;
      }
      vue.watch([() => props.open, () => props.logEntries, () => props.autoRefresh, filter], scrollToBottom);
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createBlock(_sfc_main$k, {
          open: props.open,
          title: "运行日志",
          width: 560,
          footer: true,
          "onUpdate:open": _cache[3] || (_cache[3] = (v) => emit2("update:open", v))
        }, {
          footer: vue.withCtx(() => [
            vue.createElementVNode("button", {
              class: "btn btn-outline btn-sm",
              onClick: _cache[2] || (_cache[2] = ($event) => emit2("update:open", false))
            }, "关闭")
          ]),
          default: vue.withCtx(() => [
            vue.createElementVNode("div", _hoisted_1$f, [
              vue.createElementVNode("div", _hoisted_2$e, [
                vue.createElementVNode("button", {
                  type: "button",
                  class: vue.normalizeClass(["btn btn-xs", allOn.value ? "btn-active" : ""]),
                  title: allOn.value ? "点击隐藏该类日志" : "点击显示该类日志",
                  onClick: toggleAll
                }, vue.toDisplayString(allOn.value ? "全部（点此全隐）" : "全部"), 11, _hoisted_3$e),
                (vue.openBlock(), vue.createElementBlock(vue.Fragment, null, vue.renderList(TYPES, (m) => {
                  return vue.createElementVNode("button", {
                    key: m.type,
                    type: "button",
                    class: vue.normalizeClass(["btn btn-xs", filter.value[m.type] ? m.btn : ""]),
                    title: filter.value[m.type] ? "点击隐藏该类日志" : "点击显示该类日志",
                    onClick: ($event) => filter.value[m.type] = !filter.value[m.type]
                  }, vue.toDisplayString(m.label) + " " + vue.toDisplayString(counts.value[m.type] || 0), 11, _hoisted_4$d);
                }), 64))
              ]),
              vue.createElementVNode("button", {
                class: "btn btn-error btn-sm shrink-0",
                disabled: props.logEntries.length === 0,
                onClick: _cache[0] || (_cache[0] = ($event) => emit2("clear"))
              }, " 清空 ", 8, _hoisted_5$d)
            ]),
            vue.createElementVNode("div", {
              ref_key: "scroller",
              ref: scroller,
              class: "mt-2.5 flex h-[360px] flex-col overflow-y-auto rounded-box border border-neutral-content/10 bg-neutral py-2 font-mono text-[12.5px] leading-[1.9] text-neutral-content"
            }, [
              rows.value.length ? (vue.openBlock(true), vue.createElementBlock(vue.Fragment, { key: 0 }, vue.renderList(rows.value, (entry, i) => {
                return vue.openBlock(), vue.createElementBlock("div", {
                  key: i,
                  class: vue.normalizeClass(["flex items-start gap-2 border-l-[3px] px-[10px] py-[2px] pl-[9px] hover:bg-neutral-content/10", metaOf(entry.type).bar])
                }, [
                  vue.createElementVNode("span", _hoisted_6$a, vue.toDisplayString(entry.timestamp), 1),
                  vue.createElementVNode("span", {
                    class: vue.normalizeClass(["flex-none basis-[52px] font-semibold", metaOf(entry.type).text])
                  }, vue.toDisplayString(metaOf(entry.type).label), 3),
                  vue.createElementVNode("span", _hoisted_7$9, vue.toDisplayString(entry.message), 1)
                ], 2);
              }), 128)) : (vue.openBlock(), vue.createElementBlock("div", _hoisted_8$7, vue.toDisplayString(source.value.length ? "没有符合当前筛选条件的日志" : "暂无日志"), 1))
            ], 512),
            vue.createElementVNode("div", _hoisted_9$7, [
              vue.createElementVNode("span", null, [
                _cache[4] || (_cache[4] = vue.createTextVNode(" 共 ")),
                vue.createElementVNode("b", _hoisted_10$7, vue.toDisplayString(source.value.length), 1),
                _cache[5] || (_cache[5] = vue.createTextVNode(" 条 · 显示 ")),
                vue.createElementVNode("b", _hoisted_11$7, vue.toDisplayString(shown.value.length), 1),
                vue.createTextVNode(" 条（" + vue.toDisplayString(allOn.value ? "全类型" : "已选") + "） " + vue.toDisplayString(props.autoRefresh ? "" : " · 已冻结"), 1)
              ]),
              vue.createElementVNode("span", _hoisted_12$6, [
                vue.createElementVNode("label", _hoisted_13$5, [
                  vue.createElementVNode("input", {
                    type: "checkbox",
                    class: "toggle toggle-sm",
                    checked: props.autoRefresh,
                    onChange: _cache[1] || (_cache[1] = ($event) => emit2("update:autoRefresh", $event.target.checked))
                  }, null, 40, _hoisted_14$5),
                  _cache[6] || (_cache[6] = vue.createTextVNode(" 自动刷新 "))
                ]),
                vue.createElementVNode("span", null, [
                  _cache[7] || (_cache[7] = vue.createTextVNode(" 最新 ")),
                  vue.createElementVNode("span", {
                    class: vue.normalizeClass(["font-mono", latest.value ? metaOf(latest.value.type).text : "opacity-55"])
                  }, vue.toDisplayString(latest.value ? latest.value.timestamp : "--:--:--"), 3)
                ])
              ])
            ])
          ]),
          _: 1
        }, 8, ["open"]);
      };
    }
  });
  function currentMonth() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return d.getFullYear() + "-" + mm;
  }
  function getChangelogRawUrl() {
    return "https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/changelogs/" + currentMonth() + ".md";
  }
  function getChangelogPageUrl() {
    return "https://github.com/Run-os/znhd-service/blob/main/changelogs/" + currentMonth() + ".md";
  }
  const CHANGELOG_DEFAULT_LIMIT = 10;
  function parseChangelog(md) {
    const entries = [];
    const lines = String(md || "").split(/\r?\n/);
    let curTitle = null;
    let curLines = [];
    for (const line of lines) {
      const m = /^###\s+(.+?)\s*$/.exec(line);
      if (m) {
        if (curTitle !== null) entries.push({ title: curTitle, body: curLines.join("\n").trim() });
        curTitle = m[1];
        curLines = [];
        continue;
      }
      if (curTitle !== null) curLines.push(line);
    }
    if (curTitle !== null) entries.push({ title: curTitle, body: curLines.join("\n").trim() });
    return entries;
  }
  function mdToPlain(md) {
    return String(md || "").split(/\r?\n/).map((line) => {
      let s = line.replace(/^(\s*)[-*]\s+/, "$1• ");
      s = s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`/g, "");
      return s.replace(/\s+$/, "");
    }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  let _changelogCache = null;
  function loadChangelog(done) {
    if (_changelogCache) {
      done(_changelogCache);
      return;
    }
    GM_xmlhttpRequest({
      method: "GET",
      url: resolveGithubUrl(getChangelogRawUrl()),
      timeout: 15e3,
onload: function(response) {
        if (response.status !== 200) {
          const msg = "数据源返回 HTTP " + response.status;
          addLog("更新日志加载失败: " + msg, "error", true);
          done(null, msg);
          return;
        }
        const entries = parseChangelog(response.responseText);
        if (!entries.length) {
          const msg = "内容为空或格式不符（缺少 ### 标题）";
          addLog("更新日志加载失败: " + msg, "error", true);
          done(null, msg);
          return;
        }
        _changelogCache = entries;
        addLog("更新日志加载成功，共 " + entries.length + " 条", "info");
        done(entries);
      },
      onerror: function(error) {
        const err = error || {};
        const errMsg = err.message ? err.message : typeof error === "string" ? error : "网络错误";
        addLog("更新日志加载失败: " + errMsg, "error", true);
        done(null, errMsg);
      },
      ontimeout: function() {
        addLog("更新日志加载超时（15s），已取消", "error", true);
        done(null, "请求超时（15s）");
      }
    });
  }
  const _hoisted_1$e = {
    key: 0,
    class: "flex items-center justify-center gap-2 py-6"
  };
  const _hoisted_2$d = { class: "text-[13px] text-error" };
  const _hoisted_3$d = {
    key: 2,
    class: "hero"
  };
  const _hoisted_4$c = { class: "max-h-[60vh] overflow-auto pr-1" };
  const _hoisted_5$c = { class: "mb-1.5 text-sm font-bold text-primary" };
  const _hoisted_6$9 = { class: "whitespace-pre-wrap break-words text-[13px] leading-[1.6]" };
  const _hoisted_7$8 = { class: "mt-2 text-center text-xs text-base-content/60" };
  const _sfc_main$g = vue.defineComponent({
    __name: "ChangelogDialog",
    props: {
      open: { type: Boolean }
    },
    emits: ["update:open"],
    setup(__props, { emit: __emit }) {
      const props = __props;
      const emit2 = __emit;
      const entries = vue.ref(null);
      const err = vue.ref("");
      const loading = vue.ref(false);
      vue.watch(
        () => props.open,
        (open, _prev, onCleanup) => {
          if (!open) return;
          let alive = true;
          loading.value = true;
          err.value = "";
          onCleanup(() => {
            alive = false;
          });
          loadChangelog((list, errMsg) => {
            if (!alive) return;
            loading.value = false;
            if (!list) {
              err.value = errMsg || "未知错误";
              return;
            }
            entries.value = list;
          });
        }
      );
      const shown = vue.computed(() => entries.value ? entries.value.slice(0, CHANGELOG_DEFAULT_LIMIT) : []);
      const title = vue.computed(() => "更新日志（最新 " + CHANGELOG_DEFAULT_LIMIT + " 条）");
      function openMore() {
        window.open(getChangelogPageUrl(), "_blank");
      }
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createBlock(_sfc_main$k, {
          open: props.open,
          title: title.value,
          width: 620,
          footer: true,
          "onUpdate:open": _cache[1] || (_cache[1] = (v) => emit2("update:open", v))
        }, {
          footer: vue.withCtx(() => [
            vue.createElementVNode("button", {
              class: "btn btn-outline btn-sm",
              onClick: openMore
            }, "获取更多日志"),
            vue.createElementVNode("button", {
              class: "btn btn-sm",
              onClick: _cache[0] || (_cache[0] = ($event) => emit2("update:open", false))
            }, "关闭")
          ]),
          default: vue.withCtx(() => [
            loading.value ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_1$e, _cache[2] || (_cache[2] = [
              vue.createElementVNode("span", { class: "loading loading-spinner loading-sm text-primary" }, null, -1),
              vue.createElementVNode("span", { class: "text-[13px] text-base-content/60" }, "读取中…", -1)
            ]))) : err.value ? (vue.openBlock(), vue.createElementBlock(vue.Fragment, { key: 1 }, [
              vue.createElementVNode("p", _hoisted_2$d, "读取失败：" + vue.toDisplayString(err.value), 1),
              _cache[3] || (_cache[3] = vue.createElementVNode("p", { class: "mt-2 text-xs text-base-content/60" }, " 可点下方「获取更多日志」在浏览器中打开当月日志文件查看。 ", -1))
            ], 64)) : !entries.value || entries.value.length === 0 ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_3$d, _cache[4] || (_cache[4] = [
              vue.createElementVNode("div", { class: "hero-content" }, [
                vue.createElementVNode("p", { class: "text-[13px] text-base-content/60" }, "暂无更新日志")
              ], -1)
            ]))) : (vue.openBlock(), vue.createElementBlock(vue.Fragment, { key: 3 }, [
              vue.createElementVNode("div", _hoisted_4$c, [
                (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(shown.value, (en) => {
                  return vue.openBlock(), vue.createElementBlock("div", {
                    key: en.title,
                    class: "mb-3.5"
                  }, [
                    vue.createElementVNode("div", _hoisted_5$c, vue.toDisplayString(en.title), 1),
                    vue.createElementVNode("div", _hoisted_6$9, vue.toDisplayString(vue.unref(mdToPlain)(en.body)), 1)
                  ]);
                }), 128))
              ]),
              vue.createElementVNode("p", _hoisted_7$8, vue.toDisplayString(entries.value.length > shown.value.length ? "共 " + entries.value.length + " 条，已显示最新 " + shown.value.length + " 条" : "共 " + entries.value.length + " 条（已全部显示）"), 1)
            ], 64))
          ]),
          _: 1
        }, 8, ["open", "title"]);
      };
    }
  });
  const UNNAMED_CONV_ID = "";
  const MAX_WALK_DEPTH = 7;
  const MAX_STEMS_PER_MSG = 8;
  const CONV_ID_KEY_RE = /^(?:C2C|GROUP|@TIM#)/i;
  function str(v) {
    return typeof v === "string" ? v.trim() : "";
  }
  function num(v) {
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  function shortId(id) {
    return id.length > 8 ? id.slice(-8) : id;
  }
  function isFallbackId(id) {
    return id.indexOf("name:") === 0;
  }
  function fallbackName(id) {
    return isFallbackId(id) ? id.slice(5) : "";
  }
  function normName(name) {
    return str(name).replace(/[（(][^（()）]*[)）]/g, "").replace(/\s+/g, "").toLowerCase();
  }
  const MIN_CONTAIN_LEN = 4;
  function firstOf(set) {
    for (const v of set) return v;
    return null;
  }
  class AliasTable {
    constructor() {
__publicField(this, "byExact", new Map());
__publicField(this, "byNorm", new Map());
__publicField(this, "pairs", []);
    }
get size() {
      return this.byExact.size;
    }
add(name, id) {
      const n = str(name);
      if (!n || !id || isFallbackId(id)) return;
      if (!this.byExact.has(n)) this.byExact.set(n, id);
      const k = normName(n);
      if (!k) return;
      let set = this.byNorm.get(k);
      if (!set) {
        set = new Set();
        this.byNorm.set(k, set);
      }
      if (set.has(id)) return;
      set.add(id);
      this.pairs.push([k, id]);
    }
lookup(name) {
      const n = str(name);
      if (!n) return null;
      const exact = this.byExact.get(n);
      if (exact) return exact;
      const k = normName(n);
      if (!k) return null;
      const hit = this.byNorm.get(k);
      if (hit && hit.size === 1) return firstOf(hit);
      if (k.length < MIN_CONTAIN_LEN) return null;
      const ids = new Set();
      for (const pair of this.pairs) {
        const k2 = pair[0];
        if (k2 === k || k2.length < MIN_CONTAIN_LEN) continue;
        if (k.indexOf(k2) >= 0 || k2.indexOf(k) >= 0) ids.add(pair[1]);
      }
      return ids.size === 1 ? firstOf(ids) : null;
    }
entries() {
      return Array.from(this.byExact.entries());
    }
  }
  function hostDoc() {
    try {
      if (typeof unsafeWindow !== "undefined" && unsafeWindow.document) return unsafeWindow.document;
    } catch (e) {
    }
    try {
      return document;
    } catch (e) {
      return null;
    }
  }
  function readVueInstance() {
    const docs = [hostDoc(), document];
    for (const d of docs) {
      if (!d) continue;
      try {
        const el = d.querySelector("#app");
        const vm = el && el.__vue__;
        if (vm && vm.$store && vm.$store.state) return vm;
      } catch (e) {
      }
    }
    return null;
  }
  function readChatState() {
    const vm = readVueInstance();
    const st = vm && vm.$store && vm.$store.state;
    return st && typeof st === "object" ? st : null;
  }
  function domCurrentName() {
    const docs = [hostDoc(), document];
    for (const d of docs) {
      if (!d) continue;
      try {
        const el = d.querySelector(".group-item.selected .company-name");
        const t = el && el.textContent ? el.textContent.trim() : "";
        if (t) return t;
      } catch (e) {
      }
    }
    return "";
  }
  function getCurrentConv() {
    let id = "";
    let name = "";
    const st = readChatState();
    const chat = st && st.chat;
    const sel = chat && chat.selectItem;
    const ci = sel && sel.conversationInfo;
    if (ci) {
      id = str(ci.conversationID) || str(ci.conversationId) || str(ci.sessionID);
      const gp = ci.groupProfile;
      name = (gp ? str(gp.name) : "") || str(ci.name);
    }
    if (!name) name = domCurrentName();
    if (!id && !name) return null;
    return { id: id || "name:" + name, name: name || "会话 " + shortId(id), sender: null, time: null };
  }
  function stemKey(v) {
    const s = str(v);
    if (!s) return "";
    return urlFileStem(s) || s.toLowerCase();
  }
  function stemsOfPayload(p) {
    const out = [];
    const push = (v) => {
      const k = stemKey(v);
      if (k && out.indexOf(k) < 0) out.push(k);
    };
    push(p.fileName);
    push(p.uuid);
    const arr = p.imageInfoArray;
    if (Array.isArray(arr)) {
      for (const x of arr) {
        if (x && typeof x === "object") push(x.imageUrl);
      }
    }
    return out.slice(0, MAX_STEMS_PER_MSG);
  }
  function convOfNode(obj, ctx) {
    let id = str(obj.conversationID) || str(obj.conversationId) || str(obj.sessionID) || ctx.id;
    let name = str(obj.conversationName) || str(obj.groupName) || ctx.name;
    const ci = obj.conversationInfo || obj.conversation || obj.sessionInfo;
    if (ci && typeof ci === "object") {
      id = str(ci.conversationID) || str(ci.conversationId) || str(ci.sessionID) || id;
      if (!name) {
        const gp = ci.groupProfile;
        name = (gp ? str(gp.name) : "") || str(ci.name) || name;
      }
    }
    const sender = str(obj.sendUserName) || ctx.sender;
    if (id === ctx.id && name === ctx.name && sender === ctx.sender) return ctx;
    return { id, name, sender };
  }
  function walkAny(node, ctx, depth, visit) {
    if (node === null || node === void 0 || depth > MAX_WALK_DEPTH) return;
    if (Array.isArray(node)) {
      for (const x of node) walkAny(x, ctx, depth + 1, visit);
      return;
    }
    if (typeof node !== "object") return;
    const obj = node;
    if (obj.type === "TIMImageElem" && obj.payload) {
      visit(obj, ctx);
      return;
    }
    const next = convOfNode(obj, ctx);
    for (const k of Object.keys(obj)) {
      const childCtx = CONV_ID_KEY_RE.test(k) && !next.id ? { ...next, id: k } : next;
      walkAny(obj[k], childCtx, depth + 1, visit);
    }
  }
  function toConv(msg, ctx, current, aliases) {
    let id = str(msg.conversationID) || str(msg.conversationId) || str(msg.sessionID) || ctx.id;
    let name = str(msg.conversationName) || str(msg.groupName) || ctx.name;
    if (!name && current && id && id === current.id) name = current.name;
    if (!id || isFallbackId(id)) {
      const alias = aliases ? aliases.lookup(name) : null;
      if (alias) id = alias;
    }
    if (!id && !name) return null;
    const key = id || "name:" + name;
    return {
      id: key,
      name: name || "会话 " + shortId(key),
      sender: str(msg.sendUserName) || ctx.sender,
      time: num(msg.time)
    };
  }
  function readBucket() {
    try {
      const raw = localStorage.getItem(SNIFF_CONV_INDEX_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.origin !== location.origin) return null;
      if (!parsed.items || typeof parsed.items !== "object") return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }
  function loadStoredAliases(bucket) {
    const out = [];
    if (!bucket || !bucket.aliases || typeof bucket.aliases !== "object") return out;
    const now = Date.now();
    for (const name of Object.keys(bucket.aliases)) {
      const r = bucket.aliases[name];
      if (!r || typeof r.id !== "string" || !r.id) continue;
      if (!Number.isFinite(r.at) || now - r.at > CONFIG.SNIFF_CONV_TTL) continue;
      out.push([name, r.id]);
    }
    return out;
  }
  function loadStoredConv(bucket, aliases) {
    const out = [];
    if (!bucket) return out;
    const now = Date.now();
    for (const k of Object.keys(bucket.items)) {
      const r = bucket.items[k];
      if (!r || typeof r.id !== "string" || !r.id) continue;
      if (!Number.isFinite(r.at) || now - r.at > CONFIG.SNIFF_CONV_TTL) continue;
      const fb = fallbackName(r.id);
      const fixed = fb ? aliases.lookup(r.name) || aliases.lookup(fb) : null;
      const id = fixed || r.id;
      out.push([
        k,
        {
          id,
          name: typeof r.name === "string" && r.name ? r.name : "会话 " + shortId(id),
          sender: typeof r.sender === "string" ? r.sender : null,
          time: num(r.time)
        }
      ]);
    }
    return out;
  }
  function pruneOldest(map, max) {
    const keys = Object.keys(map);
    if (keys.length <= max) return;
    keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
    for (const k of keys.slice(0, keys.length - max)) delete map[k];
  }
  function saveStoredConv(fresh, aliases) {
    try {
      const now = Date.now();
      const bucket = readBucket() || { origin: location.origin, items: {} };
      bucket.origin = location.origin;
      if (!bucket.aliases || typeof bucket.aliases !== "object") bucket.aliases = {};
      for (const [stem, conv] of fresh) {
        bucket.items[stem] = { id: conv.id, name: conv.name, sender: conv.sender, time: conv.time, at: now };
      }
      for (const [name, id] of aliases.entries()) {
        bucket.aliases[name] = { id, at: now };
      }
      let merged = 0;
      for (const k of Object.keys(bucket.items)) {
        const r = bucket.items[k];
        if (!r || !isFallbackId(r.id)) continue;
        const fb = fallbackName(r.id);
        const id = aliases.lookup(r.name) || aliases.lookup(fb);
        if (!id) continue;
        if (!r.name) r.name = fb;
        r.id = id;
        merged++;
      }
      for (const k of Object.keys(bucket.items)) {
        const r = bucket.items[k];
        if (!r || !Number.isFinite(r.at) || now - r.at > CONFIG.SNIFF_CONV_TTL) delete bucket.items[k];
      }
      for (const name of Object.keys(bucket.aliases)) {
        const a = bucket.aliases[name];
        if (!a || !Number.isFinite(a.at) || now - a.at > CONFIG.SNIFF_CONV_TTL) delete bucket.aliases[name];
      }
      pruneOldest(bucket.items, CONFIG.MAX_SNIFF_CONV_STEMS);
      pruneOldest(bucket.aliases, CONFIG.MAX_SNIFF_CONV_ALIASES);
      localStorage.setItem(SNIFF_CONV_INDEX_KEY, JSON.stringify(bucket));
      if (merged) addLog("[图片嗅探] 会话归属：合并 " + merged + " 条回退键到真实会话 ID", "info");
    } catch (e) {
      addLog("[图片嗅探] 会话归属记录保存失败: " + e.message, "error", true);
    }
  }
  function buildConvContext() {
    let current = getCurrentConv();
    const aliases = new AliasTable();
    const bucket = readBucket();
    for (const [name, id] of loadStoredAliases(bucket)) aliases.add(name, id);
    const st = readChatState();
    const chat = st && st.chat;
    const allChat = st && st.allChat;
    const walkAll = (seed, visit) => {
      if (chat) walkAny(chat.messageList, seed, 0, visit);
      if (allChat) walkAny(allChat.historyMsg, { id: "", name: "", sender: null }, 0, visit);
    };
    walkAll({ id: current ? current.id : "", name: current ? current.name : "", sender: null }, (msg, ctx) => {
      const conv = toConv(msg, ctx, current, aliases);
      if (conv && !isFallbackId(conv.id)) aliases.add(conv.name, conv.id);
    });
    if (current && isFallbackId(current.id)) {
      const id = aliases.lookup(current.name) || aliases.lookup(domCurrentName());
      if (id) current = { ...current, id };
    }
    const byStem = new Map();
    const fresh = [];
    const out = (msg, ctx) => {
      const conv = toConv(msg, ctx, current, aliases);
      if (!conv) return;
      const payload = msg.payload;
      for (const k of stemsOfPayload(payload)) {
        if (byStem.has(k)) continue;
        byStem.set(k, conv);
        fresh.push([k, conv]);
      }
    };
    walkAll({ id: current ? current.id : "", name: current ? current.name : "", sender: null }, out);
    const fromPage = byStem.size;
    for (const [k, v] of loadStoredConv(bucket, aliases)) {
      if (!byStem.has(k)) byStem.set(k, v);
    }
    if (byStem.size) {
      addLog(
        "[图片嗅探] 会话归属：本次从页面读到 " + fromPage + " 个文件名（含历史记录共 " + byStem.size + " 个；会话别名 " + aliases.size + " 条；" + (current ? "当前会话「" + current.name + "」" : "当前会话未识别") + "）",
        "info"
      );
    }
    return { current, byStem, fresh, aliases };
  }
  function persistConvContext(ctx) {
    if (!ctx.fresh.length && !ctx.aliases.size) return;
    saveStoredConv(ctx.fresh, ctx.aliases);
  }
  function convOfItem(it, ctx) {
    if (!ctx || !it.stem) return null;
    return ctx.byStem.get(it.stem) || null;
  }
  function timeOfItem(it, ctx) {
    const conv = convOfItem(it, ctx);
    return conv ? conv.time : null;
  }
  function convKey(conv, aliases) {
    if (!conv) return UNNAMED_CONV_ID;
    if (isFallbackId(conv.id) && aliases) {
      const id = aliases.lookup(conv.name) || aliases.lookup(fallbackName(conv.id));
      if (id) return id;
    }
    return conv.id;
  }
  function groupByConversation(items, ctx, minBytes) {
    const buckets = new Map();
    const aliases = ctx ? ctx.aliases : null;
    const curKey = ctx && ctx.current ? convKey(ctx.current, aliases) : "";
    const bucketOf = (conv) => {
      const id = convKey(conv, aliases);
      let b = buckets.get(id);
      if (!b) {
        b = {
          name: conv ? conv.name : "",
          current: !!(conv && curKey && id === curKey),
          time: conv ? conv.time : null,
          known: [],
          unknown: []
        };
        buckets.set(id, b);
      }
      if (conv && conv.name && !b.name) b.name = conv.name;
      if (conv && conv.time !== null && (b.time === null || conv.time > b.time)) b.time = conv.time;
      return b;
    };
    for (const it of items) {
      const b = bucketOf(convOfItem(it, ctx));
      if (it.size === null) b.unknown.push(it);
      else if (it.size >= minBytes) b.known.push(it);
    }
    const bySizeDesc = (a, b) => (b.size === null ? 0 : b.size) - (a.size === null ? 0 : a.size);
    const byTimeDesc = (a, b) => {
      const ca = convOfItem(a, ctx);
      const cb = convOfItem(b, ctx);
      const va = ca ? ca.time : null;
      const vb = cb ? cb.time : null;
      if (va !== vb) {
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va;
      }
      return bySizeDesc(a, b);
    };
    const list = [];
    for (const [id, bucket] of buckets) {
      bucket.known.sort(byTimeDesc);
      bucket.unknown.sort(byTimeDesc);
      list.push({ id, time: bucket.time, current: bucket.current, bucket });
    }
    list.sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      const au = a.id === UNNAMED_CONV_ID ? 1 : 0;
      const bu = b.id === UNNAMED_CONV_ID ? 1 : 0;
      if (au !== bu) return au - bu;
      return (b.time || 0) - (a.time || 0);
    });
    const sections = list.map((x) => ({
      id: x.id,
      name: x.bucket.name,
      current: x.current,
      known: x.bucket.known,
      unknown: x.bucket.unknown
    }));
    return { sections, grouped: sections.some((s) => !!s.name) };
  }
  const _hoisted_1$d = { class: "group relative w-full min-w-0" };
  const _hoisted_2$c = { class: "pointer-events-none absolute bottom-1.5 right-1.5 z-[2] flex gap-0.5 rounded-md bg-black/55 p-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100" };
  const _hoisted_3$c = ["aria-label", "title", "disabled", "onClick"];
  const _sfc_main$f = vue.defineComponent({
    __name: "ImageActions",
    props: {
      actions: {}
    },
    setup(__props) {
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createElementBlock("div", _hoisted_1$d, [
          vue.renderSlot(_ctx.$slots, "default"),
          vue.createElementVNode("div", _hoisted_2$c, [
            (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(_ctx.actions, (a) => {
              return vue.openBlock(), vue.createElementBlock("button", {
                key: a.label,
                type: "button",
                "aria-label": a.label,
                title: a.tooltip || a.label,
                disabled: a.loading,
                class: vue.normalizeClass(["inline-flex size-[22px] cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 outline-none hover:bg-white/15 disabled:cursor-default", a.danger ? "text-[#ff7875]" : "text-white"]),
                onClick: vue.withModifiers(($event) => a.onClick(), ["stop"])
              }, [
                vue.createVNode(vue.unref(Icon), {
                  name: a.icon,
                  size: 13
                }, null, 8, ["name"])
              ], 10, _hoisted_3$c);
            }), 128))
          ])
        ]);
      };
    }
  });
  const A4_W_MM = 210;
  const A4_H_MM = 297;
  const A4_PAD_MM = 10;
  const PRINT_BOX_W_MM = A4_W_MM;
  const PRINT_BOX_H_MM = A4_H_MM - 3;
  const IMG_AREA_W_MM = PRINT_BOX_W_MM - 2 * A4_PAD_MM;
  const IMG_AREA_H_MM = PRINT_BOX_H_MM - 2 * A4_PAD_MM;
  const PRINT_PAGE_STYLE = "@page { size: A4 portrait; margin: 0; } html, body { margin: 0; padding: 0; }";
  function buildA4ImageNode(src, alt, natural) {
    const node = document.createElement("div");
    node.style.cssText = `box-sizing:border-box;width:${PRINT_BOX_W_MM}mm;height:${PRINT_BOX_H_MM}mm;padding:${A4_PAD_MM}mm;overflow:hidden;`;
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    const isLandscape = !!natural && natural.width > natural.height;
    if (isLandscape) {
      node.style.display = "flex";
      node.style.alignItems = "center";
      node.style.justifyContent = "center";
      img.style.width = IMG_AREA_H_MM + "mm";
      img.style.height = IMG_AREA_W_MM + "mm";
      img.style.transform = "rotate(90deg)";
    } else {
      img.style.width = "100%";
      img.style.height = "100%";
    }
    img.style.objectFit = "contain";
    img.style.display = "block";
    node.appendChild(img);
    return node;
  }
  function printA4Image(src, title) {
    const run = (natural) => {
      const node = buildA4ImageNode(src, title, natural);
      const frame = document.createElement("iframe");
      frame.id = "printWindow";
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;";
      document.body.appendChild(frame);
      const doc = frame.contentDocument;
      if (!doc) {
        frame.remove();
        return;
      }
      const safeTitle = title.replace(
        /[<>&"]/g,
        (c) => c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : "&quot;"
      );
      doc.open();
      doc.write(
        '<!doctype html><html><head><meta charset="utf-8"><title>' + safeTitle + "</title><style>" + PRINT_PAGE_STYLE + "</style></head><body></body></html>"
      );
      doc.close();
      doc.body.appendChild(doc.importNode(node, true));
      const fire = () => {
        var _a, _b;
        try {
          (_a = frame.contentWindow) == null ? void 0 : _a.focus();
          (_b = frame.contentWindow) == null ? void 0 : _b.print();
        } catch (e) {
        }
        window.setTimeout(() => frame.remove(), 6e4);
      };
      const img = doc.body.querySelector("img");
      if (img && !img.complete) {
        img.addEventListener("load", fire, { once: true });
        img.addEventListener("error", fire, { once: true });
      } else {
        window.setTimeout(fire, 80);
      }
    };
    const probe = new Image();
    probe.onload = () => run({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => run();
    probe.src = src;
  }
  const _hoisted_1$c = { class: "flex h-screen w-screen flex-col bg-black/80" };
  const _hoisted_2$b = { class: "flex shrink-0 items-center px-4 py-3 text-[13px] text-white/80" };
  const _hoisted_3$b = { class: "min-w-0 flex-1 truncate" };
  const _hoisted_4$b = {
    key: 0,
    class: "shrink-0 px-2 text-white/55"
  };
  const _hoisted_5$b = ["src", "alt"];
  const _sfc_main$e = vue.defineComponent({
    __name: "ImagePreview",
    props: {
      open: { type: Boolean },
      items: {},
      index: { default: 0 },
      names: { default: () => [] }
    },
    emits: ["update:open"],
    setup(__props, { emit: __emit }) {
      const props = __props;
      const emit2 = __emit;
      const overlayTarget = vue.inject(SHADOW_ROOT_KEY);
      const dlg = vue.ref(null);
      function sync(v) {
        const el = dlg.value;
        if (!el) return;
        if (v && !el.open) el.showModal();
        else if (!v && el.open) el.close();
      }
      vue.watch(() => props.open, sync);
      vue.onMounted(() => {
        if (props.open) sync(true);
      });
      const current = vue.ref(0);
      const scale = vue.ref(1);
      const rotate = vue.ref(0);
      const total = vue.computed(() => props.items.length);
      const src = vue.computed(() => props.items[current.value] || "");
      const title = vue.computed(() => {
        var _a;
        return ((_a = props.names) == null ? void 0 : _a[current.value]) || "图片";
      });
      function reset() {
        scale.value = 1;
        rotate.value = 0;
      }
      function go(step) {
        if (total.value < 2) return;
        current.value = (current.value + step + total.value) % total.value;
        reset();
      }
      function onKey(e) {
        if (!props.open) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          emit2("update:open", false);
          return;
        }
        if (e.key === "ArrowLeft") go(-1);
        if (e.key === "ArrowRight") go(1);
      }
      function onPointerDown(e) {
        if (!props.open) return;
        const path = e.composedPath();
        const inPreview = path.some((n) => n instanceof Element && n.closest && n.closest('[data-znhd="image-preview"]'));
        if (inPreview) e.stopPropagation();
      }
      vue.watch(
        () => props.open,
        (open) => {
          if (open) {
            current.value = Math.min(Math.max(0, props.index || 0), Math.max(0, total.value - 1));
            reset();
            window.addEventListener("keydown", onKey, true);
            window.addEventListener("pointerdown", onPointerDown, true);
          } else {
            window.removeEventListener("keydown", onKey, true);
            window.removeEventListener("pointerdown", onPointerDown, true);
          }
        }
      );
      vue.onBeforeUnmount(() => {
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("pointerdown", onPointerDown, true);
      });
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createBlock(vue.Teleport, { to: vue.unref(overlayTarget) }, [
          vue.createElementVNode("dialog", {
            ref_key: "dlg",
            ref: dlg,
            "data-znhd": "image-preview",
            class: "modal",
            onClose: _cache[10] || (_cache[10] = ($event) => emit2("update:open", false))
          }, [
            vue.createElementVNode("div", _hoisted_1$c, [
              vue.createElementVNode("div", _hoisted_2$b, [
                vue.createElementVNode("span", _hoisted_3$b, vue.toDisplayString(title.value), 1),
                total.value > 1 ? (vue.openBlock(), vue.createElementBlock("span", _hoisted_4$b, vue.toDisplayString(current.value + 1) + " / " + vue.toDisplayString(total.value), 1)) : vue.createCommentVNode("", true),
                vue.createElementVNode("button", {
                  type: "button",
                  "aria-label": "关闭预览",
                  title: "关闭（Esc）",
                  class: "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/70 outline-none hover:bg-white/10 hover:text-white",
                  onClick: _cache[0] || (_cache[0] = ($event) => emit2("update:open", false))
                }, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "close",
                    size: 17
                  })
                ])
              ]),
              vue.createElementVNode("div", {
                class: "relative flex min-h-0 flex-1 items-center justify-center px-12",
                onClick: _cache[4] || (_cache[4] = vue.withModifiers(($event) => emit2("update:open", false), ["self"]))
              }, [
                total.value > 1 ? (vue.openBlock(), vue.createElementBlock("button", {
                  key: 0,
                  type: "button",
                  "aria-label": "上一张",
                  class: "absolute left-3 inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white/80 outline-none hover:bg-white/20 hover:text-white",
                  onClick: _cache[1] || (_cache[1] = ($event) => go(-1))
                }, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "chevronLeft",
                    size: 20
                  })
                ])) : vue.createCommentVNode("", true),
                vue.createElementVNode("img", {
                  src: src.value,
                  alt: title.value,
                  draggable: "false",
                  class: "max-h-full max-w-full select-none object-contain",
                  style: vue.normalizeStyle({
                    transform: `scale(${scale.value}) rotate(${rotate.value}deg)`,
                    transition: "transform 120ms ease-out",
                    cursor: scale.value > 1 ? "zoom-out" : "zoom-in"
                  }),
                  onClick: _cache[2] || (_cache[2] = ($event) => scale.value = scale.value > 1 ? 1 : 1.8)
                }, null, 12, _hoisted_5$b),
                total.value > 1 ? (vue.openBlock(), vue.createElementBlock("button", {
                  key: 1,
                  type: "button",
                  "aria-label": "下一张",
                  class: "absolute right-3 inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white/80 outline-none hover:bg-white/20 hover:text-white",
                  onClick: _cache[3] || (_cache[3] = ($event) => go(1))
                }, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "chevronRight",
                    size: 20
                  })
                ])) : vue.createCommentVNode("", true)
              ]),
              vue.createElementVNode("div", {
                class: "flex shrink-0 items-center justify-center gap-1 py-3",
                onClick: _cache[9] || (_cache[9] = vue.withModifiers(($event) => emit2("update:open", false), ["self"]))
              }, [
                vue.createElementVNode("button", {
                  type: "button",
                  "aria-label": "缩小",
                  title: "缩小",
                  class: "inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/70 outline-none hover:bg-white/10 hover:text-white",
                  onClick: _cache[5] || (_cache[5] = ($event) => scale.value = Math.max(0.4, +(scale.value - 0.2).toFixed(2)))
                }, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "zoomOut",
                    size: 16
                  })
                ]),
                vue.createElementVNode("button", {
                  type: "button",
                  "aria-label": "放大",
                  title: "放大",
                  class: "inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/70 outline-none hover:bg-white/10 hover:text-white",
                  onClick: _cache[6] || (_cache[6] = ($event) => scale.value = Math.min(4, +(scale.value + 0.2).toFixed(2)))
                }, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "zoomIn",
                    size: 16
                  })
                ]),
                vue.createElementVNode("button", {
                  type: "button",
                  "aria-label": "旋转",
                  title: "旋转 90°",
                  class: "inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/70 outline-none hover:bg-white/10 hover:text-white",
                  onClick: _cache[7] || (_cache[7] = ($event) => rotate.value = (rotate.value + 90) % 360)
                }, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "rotateCw",
                    size: 16
                  })
                ]),
                vue.createElementVNode("button", {
                  type: "button",
                  "aria-label": "打印",
                  title: "打印原图（A4 自适应）",
                  class: "inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/70 outline-none hover:bg-white/10 hover:text-white",
                  onClick: _cache[8] || (_cache[8] = ($event) => vue.unref(printA4Image)(src.value, title.value))
                }, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "printer",
                    size: 16
                  })
                ])
              ])
            ])
          ], 544)
        ], 8, ["to"]);
      };
    }
  });
  const _hoisted_1$b = { class: "shrink-0" };
  const _hoisted_2$a = ["disabled"];
  const _hoisted_3$a = ["data-sniff-excluded"];
  const _hoisted_4$a = { class: "input input-sm w-[132px] shrink-0" };
  const _hoisted_5$a = { class: "text-xs text-base-content/60" };
  const _hoisted_6$8 = { class: "ml-1 flex cursor-pointer items-center gap-1.5 text-xs" };
  const _hoisted_7$7 = ["checked", "disabled"];
  const _hoisted_8$6 = {
    key: 0,
    class: "mb-2 text-xs text-error"
  };
  const _hoisted_9$6 = {
    key: 1,
    class: "mb-2 text-xs text-base-content/60"
  };
  const _hoisted_10$6 = {
    key: 2,
    class: "flex h-[58vh] flex-col items-center justify-center"
  };
  const _hoisted_11$6 = ["value"];
  const _hoisted_12$5 = { class: "mt-2 text-xs text-base-content/60" };
  const _hoisted_13$4 = {
    key: 3,
    class: "hero h-[58vh]"
  };
  const _hoisted_14$4 = { class: "hero-content flex-col text-center" };
  const _hoisted_15$4 = { class: "text-xs text-base-content/60" };
  const _hoisted_16$3 = {
    key: 4,
    class: "h-[58vh] overflow-auto pr-1"
  };
  const _hoisted_17$2 = ["data-sniff-group", "data-sniff-group-name", "data-sniff-group-current"];
  const _hoisted_18$1 = {
    key: 0,
    "data-sniff-group-header": "",
    class: "mb-1.5 flex flex-wrap items-center gap-2"
  };
  const _hoisted_19 = { class: "text-xs font-semibold text-base-content" };
  const _hoisted_20 = {
    key: 0,
    class: "badge badge-secondary badge-sm"
  };
  const _hoisted_21 = ["onClick"];
  const _hoisted_22 = {
    key: 1,
    class: "grid grid-cols-5 gap-2"
  };
  const _hoisted_23 = ["data-sniff-no-time"];
  const _hoisted_24 = { class: "relative" };
  const _hoisted_25 = ["src", "alt", "onClick"];
  const _hoisted_26 = ["checked", "aria-label", "onChange"];
  const _hoisted_27 = ["title"];
  const _hoisted_28 = ["title"];
  const _hoisted_29 = {
    key: 2,
    class: "mt-2 grid grid-cols-5 gap-2"
  };
  const _hoisted_30 = ["data-sniff-no-time"];
  const _hoisted_31 = { class: "relative" };
  const _hoisted_32 = ["src", "alt", "onClick"];
  const _hoisted_33 = ["checked", "aria-label", "onChange"];
  const _hoisted_34 = ["title"];
  const _hoisted_35 = ["title"];
  const _hoisted_36 = {
    key: 3,
    class: "mt-1.5 flex flex-wrap items-center gap-1.5"
  };
  const _hoisted_37 = ["onClick"];
  const _hoisted_38 = {
    key: 0,
    class: "text-[11px] text-base-content/60"
  };
  const _hoisted_39 = ["disabled"];
  const _hoisted_40 = ["disabled"];
  const FLUSH_MS = 150;
  const BATCH_GAP_MS = 400;
  const DEFAULT_MIN_KB = 20;
  const _sfc_main$d = vue.defineComponent({
    __name: "SniffDialog",
    props: vue.mergeModels({
      minKb: {}
    }, {
      "open": { type: Boolean, ...{ default: false } },
      "openModifiers": {}
    }),
    emits: vue.mergeModels(["update:minKb"], ["update:open"]),
    setup(__props, { emit: __emit }) {
      const open = vue.useModel(__props, "open");
      const props = __props;
      const emit2 = __emit;
      const SOURCE_LABEL = {
        dom: "页面元素",
        svg: "内联 SVG",
        css: "CSS 背景",
        perf: "资源表"
      };
      const VIA_LABEL = {
        perf: "资源表读数",
        local: "本地计算",
        head: "HEAD 响应头",
        range: "Range 响应头",
        unknown: "未测到"
      };
      const phase = vue.ref("done");
      const probed = vue.ref([]);
      const total = vue.ref(0);
      const truncated = vue.ref(false);
      const excluded = vue.ref(0);
      const openUnknown = vue.ref( new Set());
      const convCtx = vue.shallowRef(null);
      const selected = vue.ref( new Set());
      const busyKey = vue.ref(null);
      const batch = vue.ref(null);
      const previewOpen = vue.ref(false);
      const previewIndex = vue.ref(0);
      let runId = 0;
      let buf = [];
      let timer2 = null;
      const minKBText = vue.ref(String(props.minKb || DEFAULT_MIN_KB));
      vue.watch(
        () => props.minKb,
        (v) => minKBText.value = String(v || DEFAULT_MIN_KB)
      );
      function commitMinKB() {
        const n = Math.round(Number(minKBText.value));
        const next = Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_KB;
        minKBText.value = String(next);
        if (next !== props.minKb) emit2("update:minKb", next);
      }
      function flush() {
        if (timer2 !== null) {
          window.clearTimeout(timer2);
          timer2 = null;
        }
        if (!buf.length) return;
        probed.value = probed.value.concat(buf);
        buf = [];
      }
      function scheduleFlush() {
        if (timer2 !== null) return;
        timer2 = window.setTimeout(() => {
          timer2 = null;
          flush();
        }, FLUSH_MS);
      }
      function startScan() {
        const id = ++runId;
        buf = [];
        probed.value = [];
        total.value = 0;
        truncated.value = false;
        excluded.value = 0;
        selected.value = new Set();
        openUnknown.value = new Set();
        busyKey.value = null;
        batch.value = null;
        phase.value = "measuring";
        const ctx = buildConvContext();
        persistConvContext(ctx);
        convCtx.value = ctx;
        addLog("[图片嗅探] 开始扫描当前页面的图片…", "info");
        const res = collectCandidates({ excludeSelector: SNIFF_EXCLUDE_SELECTOR });
        if (runId !== id) return;
        total.value = res.items.length;
        truncated.value = res.truncated;
        excluded.value = res.excluded;
        if (!res.items.length) {
          phase.value = "done";
          addLog("[图片嗅探] 本页未发现图片（可先滚动页面让懒加载的图出现）", "info");
          return;
        }
        addLog("[图片嗅探] 候选 " + res.items.length + " 张，正在测量大小…", "info");
        void resolveSizes(res.items, {
          onItem: (it) => {
            if (runId !== id) return;
            buf.push(it);
            scheduleFlush();
          },
shouldStop: () => runId !== id
        }).then(() => {
          if (runId !== id) return;
          flush();
          phase.value = "done";
          addLog("[图片嗅探] 测量完成，共 " + res.items.length + " 张候选", "success");
        });
      }
      vue.watch(open, (v) => {
        if (!v) {
          runId++;
          if (timer2 !== null) {
            window.clearTimeout(timer2);
            timer2 = null;
          }
          buf = [];
          previewOpen.value = false;
          return;
        }
        startScan();
      });
      vue.onBeforeUnmount(() => {
        runId++;
        if (timer2 !== null) window.clearTimeout(timer2);
      });
      const minBytes = vue.computed(() => {
        const kb = Number.isFinite(props.minKb) && props.minKb > 0 ? props.minKb : DEFAULT_MIN_KB;
        return kb * 1024;
      });
      const kept = vue.computed(() => probed.value.filter((i) => !i.drop));
      const sections = vue.computed(
        () => groupByConversation(kept.value, convCtx.value, minBytes.value).sections
      );
      const groupedView = vue.computed(() => sections.value.some((s) => !!s.name));
      const known = vue.computed(() => sections.value.flatMap((s) => s.known));
      const unknown = vue.computed(() => sections.value.flatMap((s) => s.unknown));
      const pickable = vue.computed(() => known.value.concat(unknown.value));
      const droppedCount = vue.computed(() => probed.value.length - kept.value.length);
      const shown = vue.computed(() => {
        const out = [];
        for (const s of sections.value) {
          for (const it of s.known) out.push(it);
          if (openUnknown.value.has(s.id)) for (const it of s.unknown) out.push(it);
        }
        return out;
      });
      const shownIndex = vue.computed(() => {
        const m = new Map();
        shown.value.forEach((it, i) => m.set(it.key, i));
        return m;
      });
      const fileNameOf = (it) => {
        const at = shownIndex.value.get(it.key);
        return sniffFileName(it.url, it.mime, at === void 0 ? 0 : at);
      };
      const allSelected = vue.computed(
        () => pickable.value.length > 0 && pickable.value.every((i) => selected.value.has(i.key))
      );
      function toggleOne(key) {
        const next = new Set(selected.value);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        selected.value = next;
      }
      function toggleAll() {
        const all = pickable.value.every((i) => selected.value.has(i.key));
        selected.value = all ? new Set() : new Set(pickable.value.map((i) => i.key));
      }
      function toggleGroup(s) {
        const keys = s.known.concat(s.unknown).map((i) => i.key);
        if (!keys.length) return;
        const next = new Set(selected.value);
        const all = keys.every((k) => next.has(k));
        for (const k of keys) {
          if (all) next.delete(k);
          else next.add(k);
        }
        selected.value = next;
      }
      function toggleUnknown(sectionId) {
        const next = new Set(openUnknown.value);
        if (next.has(sectionId)) next.delete(sectionId);
        else next.add(sectionId);
        openUnknown.value = next;
      }
      const selectedCount = vue.computed(() => pickable.value.filter((i) => selected.value.has(i.key)).length);
      function metaOf(it) {
        const conv = it.stem && convCtx.value ? convCtx.value.byStem.get(it.stem) : void 0;
        const sender = conv && conv.sender && conv.sender !== conv.name ? "；发送者：" + conv.sender : "";
        return "来源：" + it.sources.map((s) => SOURCE_LABEL[s]).join(" / ") + "；大小来源：" + VIA_LABEL[it.sizeVia] + sender;
      }
      const noTimeOf = (it) => timeOfItem(it, convCtx.value) === null;
      function sizeText(it) {
        return formatBytes(it.size) + (it.width && it.height ? " · " + it.width + "×" + it.height : "");
      }
      async function doDownloadOne(it) {
        const fname = fileNameOf(it);
        busyKey.value = it.key;
        try {
          const ok = await downloadImage(it.url, fname);
          addLog(ok ? "图片已下载: " + fname : "[图片嗅探] 下载失败: " + fname, ok ? "success" : "error");
        } finally {
          busyKey.value = null;
        }
      }
      function printOne(it) {
        const fname = fileNameOf(it);
        addLog("打印图片: " + fname, "success");
        printA4Image(it.url, fname);
      }
      function openPreview(it) {
        const at = shownIndex.value.get(it.key);
        previewIndex.value = at === void 0 ? 0 : at;
        previewOpen.value = true;
      }
      async function doDownloadSelected() {
        const list = pickable.value.filter((i) => selected.value.has(i.key));
        if (!list.length) return;
        batch.value = { done: 0, total: list.length };
        try {
          const items = list.map((it, i) => {
            const at = shownIndex.value.get(it.key);
            return {
              key: it.key,
              url: it.url,
              filename: sniffFileName(it.url, it.mime, at === void 0 ? i : at)
            };
          });
          const res = await downloadBatch(items, {
            gapMs: BATCH_GAP_MS,
            onProgress: (done) => batch.value = { done, total: list.length }
          });
          const failNote = res.failed.length ? "（失败 " + res.failed.length + "：" + res.failed.slice(0, 3).map((f) => f.filename).join("、") + (res.failed.length > 3 ? " 等" : "") + "）" : "";
          addLog(
            "[图片嗅探] 批量下载完成：" + res.ok + "/" + res.total + failNote,
            res.failed.length ? "error" : "success"
          );
        } finally {
          batch.value = null;
        }
      }
      const percent = vue.computed(
        () => total.value > 0 ? Math.min(100, Math.round(probed.value.length / total.value * 100)) : 0
      );
      const groupTitle = (s) => (s.name || "未归属会话") + "（" + (s.known.length + s.unknown.length) + " 张）";
      const explainUnknownId = vue.computed(() => {
        const s = sections.value.find((x) => x.unknown.length > 0);
        return s ? s.id : null;
      });
      const previewUrls = vue.computed(() => shown.value.map((i) => i.url));
      const previewNames = vue.computed(() => shown.value.map((i) => fileNameOf(i)));
      function actionsOf(it) {
        return [
          {
            label: "下载",
            icon: "download",
            loading: busyKey.value === it.key,
            onClick: () => void doDownloadOne(it)
          },
          { label: "打印", icon: "printer", onClick: () => printOne(it) }
        ];
      }
      const emptyText = vue.computed(() => {
        if (phase.value === "measuring") return "正在测量大小…";
        if (total.value) return "扫描到 " + total.value + " 个候选，但都被阈值或类型过滤掉了（可调低阈值再试）";
        return "未在当前页面发现图片";
      });
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createBlock(_sfc_main$k, {
          open: open.value,
          "onUpdate:open": _cache[7] || (_cache[7] = ($event) => open.value = $event),
          width: 828,
          title: "图片嗅探"
        }, {
          title: vue.withCtx(() => [
            vue.createElementVNode("span", _hoisted_1$b, "图片嗅探（共 " + vue.toDisplayString(pickable.value.length) + " 张）", 1),
            vue.createElementVNode("button", {
              class: "btn btn-outline btn-xs h-6 shrink-0 px-2 text-[11px]",
              disabled: phase.value === "measuring",
              onClick: startScan
            }, vue.toDisplayString(phase.value === "measuring" ? "扫描中…" : "重新扫描"), 9, _hoisted_2$a)
          ]),
          footer: vue.withCtx(() => [
            vue.createElementVNode("button", {
              class: "btn btn-sm",
              disabled: !selectedCount.value || !!batch.value,
              onClick: _cache[3] || (_cache[3] = ($event) => void doDownloadSelected())
            }, vue.toDisplayString(batch.value ? "下载中 " + batch.value.done + "/" + batch.value.total : "下载所选（" + selectedCount.value + "）"), 9, _hoisted_39),
            vue.createElementVNode("button", {
              class: "btn btn-outline btn-sm",
              disabled: !selected.value.size || !!batch.value,
              onClick: _cache[4] || (_cache[4] = ($event) => selected.value = new Set())
            }, " 清空选择 ", 8, _hoisted_40),
            vue.createElementVNode("button", {
              class: "btn btn-secondary btn-sm",
              onClick: _cache[5] || (_cache[5] = ($event) => open.value = false)
            }, "关闭")
          ]),
          default: vue.withCtx(() => [
            vue.createElementVNode("div", {
              class: "mb-2 flex flex-wrap items-center gap-2",
              "data-sniff-excluded": excluded.value
            }, [
              _cache[10] || (_cache[10] = vue.createElementVNode("span", { class: "text-xs text-base-content/60" }, "只列出 ≥", -1)),
              vue.createElementVNode("label", _hoisted_4$a, [
                vue.withDirectives(vue.createElementVNode("input", {
                  "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => minKBText.value = $event),
                  type: "number",
                  min: "1",
                  max: "10240",
                  step: "10",
                  class: "text-xs",
                  "aria-label": "最小体积 KB",
                  onChange: commitMinKB,
                  onBlur: commitMinKB
                }, null, 544), [
                  [vue.vModelText, minKBText.value]
                ]),
                _cache[8] || (_cache[8] = vue.createElementVNode("span", { class: "text-[11px] opacity-60" }, "KB", -1))
              ]),
              vue.createElementVNode("span", _hoisted_5$a, "的图片（显示 " + vue.toDisplayString(known.value.length) + " 张）", 1),
              vue.createElementVNode("label", _hoisted_6$8, [
                vue.createElementVNode("input", {
                  type: "checkbox",
                  class: "checkbox checkbox-sm",
                  checked: allSelected.value,
                  disabled: !kept.value.length,
                  "aria-label": "全选",
                  onChange: toggleAll
                }, null, 40, _hoisted_7$7),
                _cache[9] || (_cache[9] = vue.createTextVNode(" 全选 "))
              ])
            ], 8, _hoisted_3$a),
            truncated.value ? (vue.openBlock(), vue.createElementBlock("p", _hoisted_8$6, " 页面元素太多或图片超过 " + vue.toDisplayString(vue.unref(MAX_SNIFF)) + " 张，本次只扫描了前一部分 —— 结果可能不完整。 ", 1)) : vue.createCommentVNode("", true),
            droppedCount.value > 0 ? (vue.openBlock(), vue.createElementBlock("p", _hoisted_9$6, " 已排除 " + vue.toDisplayString(droppedCount.value) + " 个响应不是图片的地址（视频 / 网页 / JSON 等）。 ", 1)) : vue.createCommentVNode("", true),
            phase.value === "measuring" && !probed.value.length ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_10$6, [
              vue.createElementVNode("progress", {
                class: "progress progress-primary mx-auto w-full max-w-[320px]",
                value: percent.value,
                max: "100"
              }, null, 8, _hoisted_11$6),
              vue.createElementVNode("p", _hoisted_12$5, " 正在测量大小…（" + vue.toDisplayString(probed.value.length) + "/" + vue.toDisplayString(total.value) + "） ", 1)
            ])) : !kept.value.length ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_13$4, [
              vue.createElementVNode("div", _hoisted_14$4, [
                vue.createVNode(vue.unref(Icon), {
                  name: "image",
                  size: 20
                }),
                _cache[11] || (_cache[11] = vue.createElementVNode("p", { class: "text-sm" }, "没有可显示的图片", -1)),
                vue.createElementVNode("p", _hoisted_15$4, vue.toDisplayString(emptyText.value), 1)
              ])
            ])) : (vue.openBlock(), vue.createElementBlock("div", _hoisted_16$3, [
              (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(sections.value, (s, si) => {
                return vue.openBlock(), vue.createElementBlock("div", {
                  key: s.id || "__unnamed__",
                  "data-sniff-group": s.id,
                  "data-sniff-group-name": s.name,
                  "data-sniff-group-current": s.current ? "1" : void 0,
                  class: vue.normalizeClass(si === 0 ? "" : "mt-3")
                }, [
                  groupedView.value && (s.known.length || s.unknown.length) ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_18$1, [
                    vue.createElementVNode("span", _hoisted_19, vue.toDisplayString(groupTitle(s)), 1),
                    s.current ? (vue.openBlock(), vue.createElementBlock("span", _hoisted_20, "当前会话")) : vue.createCommentVNode("", true),
                    vue.createElementVNode("button", {
                      class: "btn btn-link btn-xs h-auto px-0 text-[11px]",
                      onClick: ($event) => toggleGroup(s)
                    }, " 全选本组 ", 8, _hoisted_21)
                  ])) : vue.createCommentVNode("", true),
                  s.known.length ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_22, [
                    (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(s.known, (it) => {
                      return vue.openBlock(), vue.createElementBlock("div", {
                        key: it.key,
                        "data-sniff-card": "",
                        "data-sniff-no-time": noTimeOf(it) ? "1" : void 0,
                        class: "flex min-w-0 flex-col rounded-xl border border-base-300 bg-base-100 p-1.5 transition-colors hover:border-base-content/30"
                      }, [
                        vue.createElementVNode("div", _hoisted_24, [
                          vue.createVNode(_sfc_main$f, {
                            actions: actionsOf(it)
                          }, {
                            default: vue.withCtx(() => [
                              vue.createElementVNode("img", {
                                src: it.url,
                                alt: fileNameOf(it),
                                draggable: "false",
                                class: "aspect-square w-full cursor-zoom-in rounded-lg object-cover",
                                onClick: ($event) => openPreview(it)
                              }, null, 8, _hoisted_25)
                            ]),
                            _: 2
                          }, 1032, ["actions"]),
                          vue.createElementVNode("div", {
                            class: "absolute left-1.5 top-1.5 z-[2]",
                            onClick: _cache[1] || (_cache[1] = vue.withModifiers(() => {
                            }, ["stop"]))
                          }, [
                            vue.createElementVNode("input", {
                              type: "checkbox",
                              class: "checkbox checkbox-sm",
                              checked: selected.value.has(it.key),
                              "aria-label": "选择 " + fileNameOf(it),
                              onChange: ($event) => toggleOne(it.key)
                            }, null, 40, _hoisted_26)
                          ])
                        ]),
                        vue.createElementVNode("span", {
                          "data-sniff-name": "",
                          class: vue.normalizeClass(["mt-1 truncate text-[11.5px] font-medium leading-4", noTimeOf(it) ? "text-error" : "text-base-content"]),
                          title: fileNameOf(it)
                        }, vue.toDisplayString(fileNameOf(it)), 11, _hoisted_27),
                        vue.createElementVNode("span", {
                          class: "truncate text-[11px] leading-4 text-base-content/60",
                          title: metaOf(it)
                        }, vue.toDisplayString(sizeText(it)), 9, _hoisted_28)
                      ], 8, _hoisted_23);
                    }), 128))
                  ])) : vue.createCommentVNode("", true),
                  openUnknown.value.has(s.id) && s.unknown.length ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_29, [
                    (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(s.unknown, (it) => {
                      return vue.openBlock(), vue.createElementBlock("div", {
                        key: it.key,
                        "data-sniff-card": "",
                        "data-sniff-no-time": noTimeOf(it) ? "1" : void 0,
                        class: "flex min-w-0 flex-col rounded-xl border border-base-300 bg-base-100 p-1.5 transition-colors hover:border-base-content/30"
                      }, [
                        vue.createElementVNode("div", _hoisted_31, [
                          vue.createVNode(_sfc_main$f, {
                            actions: actionsOf(it)
                          }, {
                            default: vue.withCtx(() => [
                              vue.createElementVNode("img", {
                                src: it.url,
                                alt: fileNameOf(it),
                                draggable: "false",
                                class: "aspect-square w-full cursor-zoom-in rounded-lg object-cover",
                                onClick: ($event) => openPreview(it)
                              }, null, 8, _hoisted_32)
                            ]),
                            _: 2
                          }, 1032, ["actions"]),
                          vue.createElementVNode("div", {
                            class: "absolute left-1.5 top-1.5 z-[2]",
                            onClick: _cache[2] || (_cache[2] = vue.withModifiers(() => {
                            }, ["stop"]))
                          }, [
                            vue.createElementVNode("input", {
                              type: "checkbox",
                              class: "checkbox checkbox-sm",
                              checked: selected.value.has(it.key),
                              "aria-label": "选择 " + fileNameOf(it),
                              onChange: ($event) => toggleOne(it.key)
                            }, null, 40, _hoisted_33)
                          ])
                        ]),
                        vue.createElementVNode("span", {
                          "data-sniff-name": "",
                          class: vue.normalizeClass(["mt-1 truncate text-[11.5px] font-medium leading-4", noTimeOf(it) ? "text-error" : "text-base-content"]),
                          title: fileNameOf(it)
                        }, vue.toDisplayString(fileNameOf(it)), 11, _hoisted_34),
                        vue.createElementVNode("span", {
                          class: "truncate text-[11px] leading-4 text-base-content/60",
                          title: metaOf(it)
                        }, vue.toDisplayString(sizeText(it)), 9, _hoisted_35)
                      ], 8, _hoisted_30);
                    }), 128))
                  ])) : vue.createCommentVNode("", true),
                  s.unknown.length ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_36, [
                    vue.createElementVNode("button", {
                      class: "btn btn-link btn-xs h-auto px-0 text-[11px]",
                      onClick: ($event) => toggleUnknown(s.id)
                    }, vue.toDisplayString(openUnknown.value.has(s.id) ? "▾" : "▸") + " 大小未知（" + vue.toDisplayString(s.unknown.length) + "） ", 9, _hoisted_37),
                    explainUnknownId.value === s.id ? (vue.openBlock(), vue.createElementBlock("span", _hoisted_38, " 量不出字节数（跨域响应头被拒等），可能有大图，已保留 ")) : vue.createCommentVNode("", true)
                  ])) : vue.createCommentVNode("", true)
                ], 10, _hoisted_17$2);
              }), 128))
            ])),
            vue.createElementVNode("p", {
              class: vue.normalizeClass(["mt-2 text-xs leading-5 text-base-content/60", kept.value.length ? "" : "invisible"])
            }, [
              _cache[12] || (_cache[12] = vue.createTextVNode(" 提示： ")),
              groupedView.value ? (vue.openBlock(), vue.createElementBlock(vue.Fragment, { key: 0 }, [
                vue.createTextVNode("图片已按会话（纳税人）分组，组头可直接「全选本组」；")
              ], 64)) : vue.createCommentVNode("", true),
              _cache[13] || (_cache[13] = vue.createTextVNode(" 单击缩略图可放大 / 多图切换，放大后工具栏上的「打印」按 A4 打印原图（横图自动旋转 90 度）； 勾选后可批量下载。视频已在扫描阶段排除，动图（gif）按图片保留。 "))
            ], 2),
            vue.createVNode(_sfc_main$e, {
              open: previewOpen.value,
              "onUpdate:open": _cache[6] || (_cache[6] = ($event) => previewOpen.value = $event),
              items: previewUrls.value,
              index: previewIndex.value,
              names: previewNames.value
            }, null, 8, ["open", "items", "index", "names"])
          ]),
          _: 1
        }, 8, ["open"]);
      };
    }
  });
  function useTransferStore() {
    const state2 = vue.shallowRef(getTransferSnapshot());
    const off = subscribeTransfer(() => {
      state2.value = getTransferSnapshot();
    });
    vue.onScopeDispose(off);
    return state2;
  }
  const MD_PEER = {
    codeBg: "rgba(255,255,255,0.08)",
    link: "#5FD08A",
    line: "rgba(255,255,255,0.16)",
    quote: "rgba(255,255,255,0.3)",
    text: "rgba(255,255,255,0.9)",
    strong: "#ffffff",
    head: "rgba(255,255,255,0.9)"
  };
  const MD_MINE = {
    codeBg: "rgba(0,0,0,0.12)",
    link: "#000000",
    line: "rgba(0,0,0,0.25)",
    quote: "rgba(0,0,0,0.45)",
    text: "#000000",
    strong: "#000000",
    head: "#000000"
  };
  const SAFE_URL = /^(https?:\/\/|mailto:|#|\/)/i;
  function isSafeUrl(url) {
    return SAFE_URL.test(url.trim());
  }
  const inlineRe = () => /(`+[^`]*?`+)|(\*\*[^*]+?\*\*)|(__[^_]+?__)|(\*[^*\n]+?\*)|(_[^_\n]+?_)|(~~[^~]+?~~)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]*\]\([^)\s]+\))|(https?:\/\/[^\s<>()）]+)/g;
  function renderInline(text, p, keyBase) {
    const re = inlineRe();
    const out = [];
    let last = 0;
    let m;
    let n = 0;
    const push = (node) => {
      out.push(node);
      n++;
    };
    while (m = re.exec(text)) {
      if (m.index > last) push(text.slice(last, m.index));
      const token = m[0];
      const key = keyBase + "-" + n;
      if (token.startsWith("`")) {
        const ticks = /^`+/.exec(token)[0].length;
        const inner = token.slice(ticks, token.length - ticks);
        push(
          vue.h(
            "code",
            {
              key,
              style: {
                padding: "1px 5px",
                borderRadius: "4px",
                background: p.codeBg,
                fontSize: "12px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                wordBreak: "break-all"
              }
            },
            inner
          )
        );
      } else if (token.startsWith("**") || token.startsWith("__")) {
        push(
          vue.h(
            "strong",
            { key, style: { fontWeight: 600, color: p.strong } },
            renderInline(token.slice(2, -2), p, key)
          )
        );
      } else if (token.startsWith("~~")) {
        push(vue.h("del", { key, style: { opacity: 0.7 } }, renderInline(token.slice(2, -2), p, key)));
      } else if (token.startsWith("*") || token.startsWith("_")) {
        push(vue.h("em", { key }, renderInline(token.slice(1, -1), p, key)));
      } else {
        const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
        const link = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
        if (img) {
          const src = img[2];
          push(
            isSafeUrl(src) ? vue.h("img", {
              key,
              src,
              alt: img[1],
              style: { maxWidth: "100%", borderRadius: "6px", display: "block", margin: "2px 0" }
            }) : img[0]
          );
        } else if (link) {
          const href = link[2];
          push(
            isSafeUrl(href) ? vue.h(
              "a",
              {
                key,
                href,
                target: "_blank",
                rel: "noreferrer",
                style: {
                  color: p.link,
                  textDecoration: "underline",
                  wordBreak: "break-all"
                }
              },
              renderInline(link[1] || href, p, key)
            ) : token
          );
        } else {
          push(
            vue.h(
              "a",
              {
                key,
                href: token,
                target: "_blank",
                rel: "noreferrer",
                style: { color: p.link, textDecoration: "underline", wordBreak: "break-all" }
              },
              token
            )
          );
        }
      }
      last = m.index + token.length;
    }
    if (last < text.length) push(text.slice(last));
    return out;
  }
  function renderParagraph(lines, p, key) {
    const children = [];
    lines.forEach((line, i) => {
      if (i > 0) children.push(vue.h("br", { key: key + "-br" + i }));
      children.push(...renderInline(line, p, key + "-" + i));
    });
    return vue.h("p", { key, style: { margin: "0" } }, children);
  }
  const RE_FENCE = /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/;
  const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
  const RE_HR = /^\s{0,3}((?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
  const RE_UL = /^\s{0,3}[-*+]\s+(.*)$/;
  const RE_OL = /^\s{0,3}\d+[.)]\s+(.*)$/;
  const RE_QUOTE = /^\s{0,3}>\s?(.*)$/;
  const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  }
  function renderCode(code, lang, p, key) {
    return vue.h(
      "pre",
      {
        key,
        "data-lang": lang || void 0,
        style: {
          margin: "0",
          padding: "8px 10px",
          borderRadius: "6px",
          background: p.codeBg,
          fontSize: "12px",
          lineHeight: "1.5",
          overflowX: "auto",
          minWidth: "0",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        }
      },
      [vue.h("code", code.join("\n"))]
    );
  }
  function renderTable(rows, p, key) {
    const [head, ...body] = rows;
    const cell = (text, tag, k) => vue.h(
      tag,
      {
        key: k,
        style: {
          padding: "3px 8px",
          border: "1px solid " + p.line,
          textAlign: "left",
          whiteSpace: tag === "th" ? "nowrap" : void 0,
          background: tag === "th" ? p.codeBg : void 0,
          color: tag === "th" ? p.head : void 0,
          fontWeight: tag === "th" ? 600 : void 0
        }
      },
      renderInline(text, p, k)
    );
    return vue.h("div", { key, style: { overflowX: "auto", minWidth: "0" } }, [
      vue.h("table", { style: { borderCollapse: "collapse", fontSize: "12px" } }, [
        vue.h("thead", [
          vue.h(
            "tr",
            head.map((c, i) => cell(c, "th", key + "-h" + i))
          )
        ]),
        vue.h(
          "tbody",
          body.map(
            (row, ri) => vue.h(
              "tr",
              { key: key + "-r" + ri },
              row.map((c, ci) => cell(c, "td", key + "-r" + ri + "c" + ci))
            )
          )
        )
      ])
    ]);
  }
  function renderMarkdown(content, palette) {
    const p = palette;
    const lines = (content || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;
    let seq = 0;
    while (i < lines.length) {
      const line = lines[i];
      const key = "md" + seq++;
      if (!line.trim()) {
        i++;
        continue;
      }
      const fence = RE_FENCE.exec(line);
      if (fence) {
        const marker = fence[1][0];
        const lang = fence[2] || "";
        const buf = [];
        i++;
        while (i < lines.length && !new RegExp("^\\s*" + marker + "{3,}\\s*$").test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        out.push(renderCode(buf, lang, p, key));
        continue;
      }
      const head = RE_HEADING.exec(line);
      if (head) {
        const level = head[1].length;
        out.push(
          vue.h(
            "h" + level,
            {
              key,
              style: {
                margin: "0",
                fontSize: level === 1 ? "16px" : level === 2 ? "15px" : level === 3 ? "14px" : "13px",
                fontWeight: 600,
                lineHeight: "1.5"
              }
            },
            renderInline(head[2], p, key)
          )
        );
        i++;
        continue;
      }
      if (RE_HR.test(line)) {
        out.push(vue.h("hr", { key, style: { margin: "2px 0", border: "0", borderTop: "1px solid " + p.line } }));
        i++;
        continue;
      }
      if (RE_QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) {
          buf.push(RE_QUOTE.exec(lines[i])[1]);
          i++;
        }
        out.push(
          vue.h(
            "blockquote",
            {
              key,
              style: {
                margin: "0",
                paddingLeft: "10px",
                borderLeft: "3px solid " + p.quote,
                color: p.text,
                opacity: 0.9
              }
            },
            renderMarkdown(buf.join("\n"), p)
          )
        );
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) {
        const rows = [splitRow(line)];
        i += 2;
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        out.push(renderTable(rows, p, key));
        continue;
      }
      const ul = RE_UL.exec(line);
      const ol = ul ? null : RE_OL.exec(line);
      if (ul || ol) {
        const ordered = !!ol;
        const items = [];
        while (i < lines.length) {
          const m2 = (ordered ? RE_OL : RE_UL).exec(lines[i]);
          if (!m2) break;
          items.push(m2[1]);
          i++;
        }
        out.push(
          vue.h(
            ordered ? "ol" : "ul",
            { key, style: { margin: "0", paddingLeft: "20px" } },
            items.map(
              (t, idx) => vue.h(
                "li",
                { key: key + "-i" + idx, style: { margin: "2px 0" } },
                renderInline(t, p, key + "-i" + idx)
              )
            )
          )
        );
        continue;
      }
      const para = [line];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (!next.trim() || RE_FENCE.test(next) || RE_HEADING.test(next) || RE_HR.test(next) || RE_QUOTE.test(next) || RE_UL.test(next) || RE_OL.test(next)) {
          break;
        }
        para.push(next);
        i++;
      }
      out.push(renderParagraph(para, p, key));
    }
    return out;
  }
  const _hoisted_1$a = {
    key: 0,
    class: "chat-bubble max-w-[62%]"
  };
  const _hoisted_2$9 = ["src", "alt"];
  const _hoisted_3$9 = ["src", "alt"];
  const _hoisted_4$9 = ["data-chat-progress", "value"];
  const _hoisted_5$9 = { class: "min-w-0 flex-1" };
  const _hoisted_6$7 = ["title"];
  const _hoisted_7$6 = { class: "mt-px text-[11px] opacity-75" };
  const _hoisted_8$5 = ["disabled"];
  const _hoisted_9$5 = ["value"];
  const _hoisted_10$5 = {
    key: 1,
    class: "mt-1 text-[11px]"
  };
  const _hoisted_11$5 = {
    key: 0,
    class: "mt-1 text-[11px]"
  };
  const _sfc_main$c = vue.defineComponent({
    __name: "ChatBubble",
    props: {
      type: {},
      mine: { type: Boolean },
      text: { default: "" },
      name: { default: "" },
      mime: { default: "" },
      sizeText: { default: "" },
      imageSrc: { default: "" },
      grouped: { type: Boolean, default: false },
      meta: { default: "" },
      metaDanger: { type: Boolean, default: false },
      progress: { default: null },
      error: { default: "" },
      imageActions: { default: () => [] },
      clickable: { type: Boolean, default: false },
      canDownload: { type: Boolean, default: true },
      downloadLabel: { default: "下载" },
      copyLabel: { default: "" }
    },
    emits: ["preview", "download", "copy"],
    setup(__props, { emit: __emit }) {
      const props = __props;
      const emit2 = __emit;
      const sending = vue.computed(() => props.progress !== null);
      const mdNodes = vue.computed(() => renderMarkdown(props.text || "", props.mine ? MD_MINE : MD_PEER));
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createElementBlock(vue.Fragment, null, [
          _ctx.type === "image" ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_1$a, [
            _ctx.imageActions.length ? (vue.openBlock(), vue.createBlock(_sfc_main$f, {
              key: 0,
              actions: _ctx.imageActions,
              onClick: _cache[1] || (_cache[1] = vue.withModifiers(() => {
              }, ["stop"]))
            }, {
              default: vue.withCtx(() => [
                vue.createElementVNode("img", {
                  src: _ctx.imageSrc,
                  alt: _ctx.name || "image",
                  class: vue.normalizeClass(["block h-auto w-auto max-w-[240px] rounded-box", _ctx.clickable ? "cursor-zoom-in" : ""]),
                  style: vue.normalizeStyle({
                    maxHeight: "360px",
                    opacity: sending.value ? 0.55 : 1,
                    border: _ctx.error ? "1px solid var(--color-error)" : "none"
                  }),
                  onClick: _cache[0] || (_cache[0] = ($event) => emit2("preview"))
                }, null, 14, _hoisted_2$9)
              ]),
              _: 1
            }, 8, ["actions"])) : (vue.openBlock(), vue.createElementBlock("img", {
              key: 1,
              src: _ctx.imageSrc,
              alt: _ctx.name || "image",
              class: vue.normalizeClass(["block h-auto w-auto max-w-[240px] rounded-box", _ctx.clickable ? "cursor-zoom-in" : ""]),
              style: vue.normalizeStyle({
                maxHeight: "360px",
                opacity: sending.value ? 0.55 : 1,
                border: _ctx.error ? "1px solid var(--color-error)" : "none"
              }),
              onClick: _cache[2] || (_cache[2] = ($event) => emit2("preview"))
            }, null, 14, _hoisted_3$9)),
            _ctx.progress !== null ? (vue.openBlock(), vue.createElementBlock("progress", {
              key: 2,
              "data-chat-progress": _ctx.progress,
              class: "progress progress-primary mt-1 w-full",
              value: _ctx.progress,
              max: "100"
            }, null, 8, _hoisted_4$9)) : vue.createCommentVNode("", true)
          ])) : _ctx.type === "file" ? (vue.openBlock(), vue.createElementBlock("div", {
            key: 1,
            class: vue.normalizeClass(["chat-bubble max-w-[74%]", _ctx.mine ? "chat-bubble-primary" : ""])
          }, [
            vue.createElementVNode("div", {
              "data-chat-file-bubble": "1",
              class: "flex min-w-0 items-center gap-2.5",
              style: vue.normalizeStyle(sending.value ? { opacity: 0.55 } : void 0)
            }, [
              vue.createElementVNode("span", {
                class: vue.normalizeClass(["inline-flex size-8 shrink-0 items-center justify-center rounded-box", _ctx.mine ? "bg-primary-content/15" : "bg-base-content/10"])
              }, [
                vue.createVNode(vue.unref(Icon), {
                  name: "fileText",
                  size: 18
                })
              ], 2),
              vue.createElementVNode("div", _hoisted_5$9, [
                vue.createElementVNode("div", {
                  class: "truncate text-[13px] font-medium",
                  title: _ctx.name || "file"
                }, vue.toDisplayString(_ctx.name || "file"), 9, _hoisted_6$7),
                vue.createElementVNode("div", _hoisted_7$6, [
                  vue.createTextVNode(vue.toDisplayString(_ctx.sizeText), 1),
                  _ctx.mime ? (vue.openBlock(), vue.createElementBlock(vue.Fragment, { key: 0 }, [
                    vue.createTextVNode(" · " + vue.toDisplayString(_ctx.mime), 1)
                  ], 64)) : vue.createCommentVNode("", true)
                ])
              ]),
              vue.createElementVNode("button", {
                type: "button",
                "aria-label": "下载文件",
                disabled: !_ctx.canDownload,
                class: vue.normalizeClass(["btn btn-xs shrink-0", _ctx.mine ? "btn-neutral" : "btn-outline"]),
                onClick: _cache[3] || (_cache[3] = ($event) => emit2("download"))
              }, vue.toDisplayString(_ctx.downloadLabel), 11, _hoisted_8$5)
            ], 4),
            _ctx.progress !== null ? (vue.openBlock(), vue.createElementBlock("progress", {
              key: 0,
              class: vue.normalizeClass(["progress mt-1 w-full", _ctx.mine ? "progress-neutral" : "progress-primary"]),
              value: _ctx.progress,
              max: "100"
            }, null, 10, _hoisted_9$5)) : vue.createCommentVNode("", true),
            _ctx.error ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_10$5, vue.toDisplayString(_ctx.error), 1)) : vue.createCommentVNode("", true)
          ], 2)) : (vue.openBlock(), vue.createElementBlock(vue.Fragment, { key: 2 }, [
            vue.createElementVNode("div", {
              class: vue.normalizeClass(["chat-bubble max-w-[74%] text-[13px] leading-relaxed", _ctx.mine ? "chat-bubble-primary" : ""])
            }, [
              (vue.openBlock(), vue.createBlock(vue.resolveDynamicComponent(() => mdNodes.value))),
              _ctx.error ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_11$5, vue.toDisplayString(_ctx.error), 1)) : vue.createCommentVNode("", true)
            ], 2),
            _ctx.copyLabel ? (vue.openBlock(), vue.createElementBlock("button", {
              key: 0,
              type: "button",
              class: "mt-0.5 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-base-content/60 outline-none hover:text-base-content",
              onClick: _cache[4] || (_cache[4] = ($event) => emit2("copy"))
            }, vue.toDisplayString(_ctx.copyLabel), 1)) : vue.createCommentVNode("", true)
          ], 64)),
          _ctx.meta ? (vue.openBlock(), vue.createElementBlock("div", {
            key: 3,
            class: vue.normalizeClass(["chat-footer text-[11px]", _ctx.metaDanger ? "text-error" : ""])
          }, vue.toDisplayString(_ctx.meta), 3)) : vue.createCommentVNode("", true)
        ], 64);
      };
    }
  });
  const DEVICE_COLORS = [
    { bg: "#e6f4ff", border: "#91caff", color: "#0958d9" },
{ bg: "#e6fffb", border: "#87e8de", color: "#08979c" },
{ bg: "#f6ffed", border: "#b7eb8f", color: "#389e0d" },
{ bg: "#fffbe6", border: "#ffe58f", color: "#d48806" },
{ bg: "#fff7e6", border: "#ffd591", color: "#d46b08" },
{ bg: "#fff1f0", border: "#ffa39e", color: "#cf1322" },
{ bg: "#f9f0ff", border: "#d3adf7", color: "#531dab" },
{ bg: "#fff0f6", border: "#ffadd2", color: "#c41d7f" }
];
  function hashDeviceId(id) {
    let h2 = 2166136261;
    for (let i = 0; i < id.length; i++) {
      h2 ^= id.charCodeAt(i);
      h2 = Math.imul(h2, 16777619) >>> 0;
    }
    return h2 >>> 0;
  }
  function resolveDeviceColors(ids) {
    const out = {};
    const used = new Set();
    const ordered = ids.filter(Boolean).slice().sort((a, b) => hashDeviceId(a) - hashDeviceId(b) || (a < b ? -1 : 1));
    for (const id of ordered) {
      let idx = hashDeviceId(id) % DEVICE_COLORS.length;
      for (let step = 0; step < DEVICE_COLORS.length && used.has(idx); step++) {
        idx = (idx + 1) % DEVICE_COLORS.length;
      }
      used.add(idx);
      out[id] = idx;
    }
    return out;
  }
  function shortPhoneId(id) {
    if (!id) return "未知设备（旧版中继）";
    return id.length > 8 ? id.slice(0, 8) + "…" : id;
  }
  const pad = (n) => String(n).padStart(2, "0");
  const dayOf = (x) => x.getFullYear() + "-" + x.getMonth() + "-" + x.getDate();
  function fmtTime(ts) {
    const d = new Date(ts);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function sepTimeText(ts) {
    const d = new Date(ts);
    const now = new Date();
    const hm = fmtTime(ts);
    if (dayOf(d) === dayOf(now)) return hm;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayOf(d) === dayOf(yesterday)) return "昨天 " + hm;
    return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + hm;
  }
  function fullTime(ts) {
    const d = new Date(ts);
    return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function sourceLabel(msg) {
    if (msg.sessionKey === PHONE_SESSION_KEY) return PHONE_SESSION_LABEL;
    return shortPhoneId(msg.sessionKey);
  }
  function avatarUrl(seed) {
    return "https://api.dicebear.com/10.x/notionists/svg?seed=" + encodeURIComponent(seed);
  }
  const _hoisted_1$9 = { class: "min-w-0" };
  const _hoisted_2$8 = {
    key: 0,
    class: "my-2 text-center text-[11px] text-base-content/60"
  };
  const _hoisted_3$8 = { class: "chat-image avatar" };
  const _hoisted_4$8 = { class: "w-8 rounded-full" };
  const _hoisted_5$8 = ["src", "alt"];
  const _sfc_main$b = vue.defineComponent({
    __name: "ChatTurn",
    props: {
      mine: { type: Boolean },
      sessionKey: { default: "" },
      mySeed: { default: "" },
      timeLabel: { default: "" },
      count: { default: 1 }
    },
    setup(__props) {
      const props = __props;
      const avatarSeed = vue.computed(
        () => props.mine ? props.mySeed || getDeviceId() : props.sessionKey || PHONE_SESSION_KEY
      );
      const avatarSrc = vue.computed(() => avatarUrl(avatarSeed.value));
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createElementBlock("div", _hoisted_1$9, [
          _ctx.timeLabel ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_2$8, vue.toDisplayString(_ctx.timeLabel), 1)) : vue.createCommentVNode("", true),
          vue.createElementVNode("div", {
            class: vue.normalizeClass(["chat", _ctx.mine ? "chat-end" : "chat-start"])
          }, [
            vue.createElementVNode("div", _hoisted_3$8, [
              vue.createElementVNode("div", _hoisted_4$8, [
                vue.createElementVNode("img", {
                  src: avatarSrc.value,
                  alt: _ctx.mine ? "我" : "手机"
                }, null, 8, _hoisted_5$8)
              ])
            ]),
            vue.renderSlot(_ctx.$slots, "default")
          ], 2)
        ]);
      };
    }
  });
  const _hoisted_1$8 = ["placeholder", "disabled"];
  const _hoisted_2$7 = { class: "mt-1 flex items-center gap-1" };
  const _hoisted_3$7 = {
    key: 0,
    class: "dropdown dropdown-top"
  };
  const _hoisted_4$7 = {
    class: "btn btn-outline btn-sm btn-circle",
    "aria-label": "添加图片或文件",
    title: "添加图片或文件"
  };
  const _hoisted_5$7 = { class: "menu dropdown-content z-10 w-44 rounded-box bg-base-100 p-2 shadow" };
  const _hoisted_6$6 = ["disabled", "onClick"];
  const _hoisted_7$5 = ["disabled"];
  const MIN_H = 56;
  const MAX_H = 120;
  const _sfc_main$a = vue.defineComponent({
    __name: "ChatComposer",
    props: {
      modelValue: {},
      disabled: { type: Boolean, default: false },
      placeholder: { default: "" },
      attach: { default: () => [] }
    },
    emits: ["update:modelValue", "send"],
    setup(__props, { emit: __emit }) {
      const props = __props;
      const emit2 = __emit;
      const root = vue.ref(null);
      function textareaEl() {
        var _a, _b;
        return (_b = (_a = root.value) == null ? void 0 : _a.querySelector("textarea")) != null ? _b : null;
      }
      function autoGrow() {
        const el = textareaEl();
        if (!el) return;
        el.style.height = "auto";
        const h2 = Math.min(Math.max(el.scrollHeight, MIN_H), MAX_H);
        el.style.height = h2 + "px";
        el.style.overflowY = el.scrollHeight > MAX_H ? "auto" : "hidden";
      }
      const model = vue.computed({
        get: () => props.modelValue,
        set: (v) => emit2("update:modelValue", v)
      });
      vue.watch(
        () => props.modelValue,
        () => vue.nextTick(autoGrow)
      );
      function onKeydown(e) {
        if (e.key !== "Enter" || e.shiftKey) return;
        e.preventDefault();
        if (!sendDisabled.value) emit2("send");
      }
      const sendDisabled = vue.computed(() => !!props.disabled || !props.modelValue.trim());
      function pickAttach(e, fn) {
        fn();
        const d = e.currentTarget.closest("details");
        d == null ? void 0 : d.removeAttribute("open");
      }
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createElementBlock("div", {
          ref_key: "root",
          ref: root,
          class: "w-full"
        }, [
          vue.withDirectives(vue.createElementVNode("textarea", {
            "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => model.value = $event),
            class: "textarea w-full text-sm leading-5",
            placeholder: _ctx.placeholder,
            disabled: _ctx.disabled,
            rows: "1",
            style: { "min-height": "56px", "box-shadow": "none" },
            onInput: autoGrow,
            onKeydown
          }, null, 40, _hoisted_1$8), [
            [vue.vModelText, model.value]
          ]),
          vue.createElementVNode("div", _hoisted_2$7, [
            _ctx.attach.length ? (vue.openBlock(), vue.createElementBlock("details", _hoisted_3$7, [
              vue.createElementVNode("summary", _hoisted_4$7, [
                vue.createVNode(vue.unref(Icon), {
                  name: "plus",
                  size: 14
                })
              ]),
              vue.createElementVNode("ul", _hoisted_5$7, [
                (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(_ctx.attach, (a) => {
                  return vue.openBlock(), vue.createElementBlock("li", {
                    key: a.key
                  }, [
                    vue.createElementVNode("button", {
                      disabled: a.disabled || _ctx.disabled,
                      onClick: ($event) => pickAttach($event, a.onClick)
                    }, [
                      vue.createVNode(vue.unref(Icon), {
                        name: a.icon,
                        size: 15
                      }, null, 8, ["name"]),
                      vue.createTextVNode(" " + vue.toDisplayString(a.label), 1)
                    ], 8, _hoisted_6$6)
                  ]);
                }), 128))
              ])
            ])) : vue.createCommentVNode("", true),
            vue.createElementVNode("button", {
              class: "btn btn-primary btn-sm btn-circle ml-auto",
              disabled: sendDisabled.value,
              "aria-label": "发送",
              title: "发送（Enter）",
              onClick: _cache[1] || (_cache[1] = ($event) => emit2("send"))
            }, [
              vue.createVNode(vue.unref(Icon), {
                name: "send",
                size: 14
              }),
              _cache[2] || (_cache[2] = vue.createElementVNode("span", { class: "sr-only" }, "发送", -1))
            ], 8, _hoisted_7$5)
          ])
        ], 512);
      };
    }
  });
  const _hoisted_1$7 = {
    key: 0,
    class: "hero flex-1"
  };
  const _hoisted_2$6 = { class: "hero-content" };
  const _hoisted_3$6 = { class: "text-xs text-base-content/40" };
  const _hoisted_4$6 = {
    key: 1,
    class: "znhd-transfer-files min-h-0 flex-1 overflow-y-auto px-3 py-2.5"
  };
  const _hoisted_5$6 = { class: "mb-2 flex items-baseline gap-2" };
  const _hoisted_6$5 = { class: "text-sm font-semibold text-base-content" };
  const _hoisted_7$4 = {
    key: 0,
    class: "grid gap-2",
    style: { "grid-template-columns": "repeat(auto-fill, minmax(96px, 1fr))", "align-content": "start" }
  };
  const _hoisted_8$4 = ["src", "alt", "onClick"];
  const _hoisted_9$4 = { class: "mt-0.5 truncate text-[11px] text-base-content/40" };
  const _hoisted_10$4 = { class: "mb-1.5 text-[13px] font-semibold text-base-content" };
  const _hoisted_11$4 = {
    class: "grid gap-2",
    style: { "grid-template-columns": "repeat(auto-fill, minmax(220px, 1fr))", "align-content": "start" }
  };
  const _hoisted_12$4 = { class: "inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-white/[0.08] text-base-content/60" };
  const _hoisted_13$3 = { class: "min-w-0 flex-1" };
  const _hoisted_14$3 = ["title"];
  const _hoisted_15$3 = { class: "mt-px truncate text-[11px] text-base-content/40" };
  const _hoisted_16$2 = { class: "flex shrink-0 items-center gap-1" };
  const _hoisted_17$1 = ["disabled", "onClick"];
  const _hoisted_18 = ["onClick"];
  const _sfc_main$9 = vue.defineComponent({
    __name: "FilesView",
    props: {
      messages: {},
      scopeLabel: {},
      clearScope: { type: Function }
    },
    setup(__props) {
      const props = __props;
      const imgCopy = vue.ref(null);
      const previewOpen = vue.ref(false);
      const previewIndex = vue.ref(0);
      const ordered = vue.computed(
        () => props.messages.slice().filter((m) => m.type !== "text").sort((a, b) => b.ts - a.ts)
      );
      const images = vue.computed(() => ordered.value.filter((m) => m.type === "image"));
      const files = vue.computed(() => ordered.value.filter((m) => m.type === "file"));
      const imageUrls = vue.computed(() => images.value.map((m) => m.previewUrl));
      const imageNames = vue.computed(() => images.value.map((m, i) => downloadFileName(m.name, m.mime, i)));
      function saveBlob(blob, name) {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
      }
      function doCopy(msg) {
        imgCopy.value = { id: msg.id, state: "busy" };
        copyImageToClipboard(msg.blob).then((ok) => {
          imgCopy.value = { id: msg.id, state: ok ? "ok" : "fail" };
          if (ok) addLog("图片已复制到剪贴板: " + (msg.name || ""), "success");
          window.setTimeout(() => imgCopy.value = null, 1500);
        });
      }
      function copyHint(msg) {
        const st = imgCopy.value;
        if (!st || st.id !== msg.id) return "复制";
        if (st.state === "busy") return "复制中…";
        return st.state === "ok" ? "已复制" : "复制失败";
      }
      function doDownload(msg, idx) {
        const fname = downloadFileName(msg.name, msg.mime, idx);
        saveBlob(msg.blob, fname);
        addLog("图片已下载: " + fname, "success");
      }
      function doDownloadFile(msg) {
        const fname = msg.name || "file.bin";
        saveBlob(msg.blob, fname);
        addLog("文件已下载: " + fname, "success");
      }
      function openPreview(msg) {
        const at = images.value.findIndex((m) => m.id === msg.id);
        previewIndex.value = at >= 0 ? at : 0;
        previewOpen.value = true;
      }
      function actionsOf(msg, idx) {
        return [
          {
            label: "复制",
            tooltip: copyHint(msg),
            icon: imgCopy.value && imgCopy.value.id === msg.id && imgCopy.value.state === "ok" ? "check" : "copy",
            onClick: () => doCopy(msg)
          },
          { label: "下载", icon: "download", onClick: () => doDownload(msg, idx) },
          { label: "删除", icon: "trash", danger: true, onClick: () => removeTransferMessage(msg.sessionKey, msg.id) }
        ];
      }
      function onClear() {
        if (props.clearScope) {
          props.clearScope();
          addLog("[传输助手] 已清空该会话的文件与消息", "success");
        } else {
          clearAllTransferFiles();
        }
      }
      return (_ctx, _cache) => {
        return !ordered.value.length ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_1$7, [
          vue.createElementVNode("div", _hoisted_2$6, [
            vue.createElementVNode("p", _hoisted_3$6, vue.toDisplayString(_ctx.clearScope ? "该会话暂无图片 / 文件" : "暂无文件——手机发来的图片 / 文件会汇总在这里"), 1)
          ])
        ])) : (vue.openBlock(), vue.createElementBlock("div", _hoisted_4$6, [
          vue.createElementVNode("div", _hoisted_5$6, [
            vue.createElementVNode("span", _hoisted_6$5, vue.toDisplayString(_ctx.scopeLabel) + "（图片 " + vue.toDisplayString(images.value.length) + " · 文件 " + vue.toDisplayString(files.value.length) + "） ", 1),
            _cache[1] || (_cache[1] = vue.createElementVNode("span", { class: "flex-1" }, null, -1)),
            vue.createElementVNode("button", {
              type: "button",
              class: "cursor-pointer rounded border border-[#ff7875]/50 bg-transparent px-2 py-0.5 text-xs text-[#ff7875] outline-none hover:bg-[#ff7875]/15",
              onClick: onClear
            }, vue.toDisplayString(_ctx.clearScope ? "清空本会话" : "清空全部"), 1)
          ]),
          images.value.length ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_7$4, [
            (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(images.value, (msg, idx) => {
              return vue.openBlock(), vue.createElementBlock("div", {
                key: msg.id,
                class: "flex flex-col"
              }, [
                vue.createVNode(_sfc_main$f, {
                  actions: actionsOf(msg, idx)
                }, {
                  default: vue.withCtx(() => [
                    vue.createElementVNode("img", {
                      src: msg.previewUrl,
                      alt: msg.name || "image",
                      class: "block w-full cursor-zoom-in rounded-[8px] object-cover",
                      style: { "aspect-ratio": "1 / 1" },
                      onClick: ($event) => openPreview(msg)
                    }, null, 8, _hoisted_8$4)
                  ]),
                  _: 2
                }, 1032, ["actions"]),
                vue.createElementVNode("div", _hoisted_9$4, vue.toDisplayString(vue.unref(sourceLabel)(msg)) + " · " + vue.toDisplayString(vue.unref(fullTime)(msg.ts)) + " · " + vue.toDisplayString(msg.direction === "in" ? "收到" : "发出"), 1)
              ]);
            }), 128))
          ])) : vue.createCommentVNode("", true),
          files.value.length ? (vue.openBlock(), vue.createElementBlock("div", {
            key: 1,
            class: vue.normalizeClass(images.value.length ? "mt-4" : "")
          }, [
            vue.createElementVNode("div", _hoisted_10$4, "文件（" + vue.toDisplayString(files.value.length) + "）", 1),
            vue.createElementVNode("div", _hoisted_11$4, [
              (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(files.value, (msg) => {
                return vue.openBlock(), vue.createElementBlock("div", {
                  key: msg.id,
                  "data-transfer-file-card": "1",
                  class: "flex min-w-0 items-center gap-2.5 rounded-[8px] border border-base-300 bg-white/[0.04] px-2.5 py-2"
                }, [
                  vue.createElementVNode("span", _hoisted_12$4, [
                    vue.createVNode(vue.unref(Icon), {
                      name: "fileText",
                      size: 18
                    })
                  ]),
                  vue.createElementVNode("div", _hoisted_13$3, [
                    vue.createElementVNode("div", {
                      class: "truncate text-[13px] text-base-content",
                      title: msg.name || "file"
                    }, vue.toDisplayString(msg.name || "file"), 9, _hoisted_14$3),
                    vue.createElementVNode("div", _hoisted_15$3, vue.toDisplayString(vue.unref(formatBytes)(msg.blob ? msg.blob.size : 0)) + " · " + vue.toDisplayString(vue.unref(sourceLabel)(msg)) + " · " + vue.toDisplayString(vue.unref(fullTime)(msg.ts)) + " · " + vue.toDisplayString(msg.direction === "in" ? "收到" : "发出"), 1)
                  ]),
                  vue.createElementVNode("div", _hoisted_16$2, [
                    vue.createElementVNode("button", {
                      type: "button",
                      "aria-label": "下载文件",
                      disabled: !msg.blob,
                      class: "cursor-pointer rounded border border-base-content/20 bg-base-content/5 px-2 py-0.5 text-xs text-base-content/80 outline-none hover:bg-base-content/15 disabled:cursor-not-allowed disabled:opacity-40",
                      onClick: ($event) => doDownloadFile(msg)
                    }, " 下载 ", 8, _hoisted_17$1),
                    vue.createElementVNode("button", {
                      type: "button",
                      "aria-label": "删除文件",
                      class: "inline-flex size-[22px] cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-[#ff7875] outline-none hover:bg-[#ff7875]/15",
                      onClick: ($event) => vue.unref(removeTransferMessage)(msg.sessionKey, msg.id)
                    }, [
                      vue.createVNode(vue.unref(Icon), {
                        name: "close",
                        size: 13
                      })
                    ], 8, _hoisted_18)
                  ])
                ]);
              }), 128))
            ])
          ], 2)) : vue.createCommentVNode("", true),
          vue.createVNode(_sfc_main$e, {
            open: previewOpen.value,
            "onUpdate:open": _cache[0] || (_cache[0] = ($event) => previewOpen.value = $event),
            items: imageUrls.value,
            index: previewIndex.value,
            names: imageNames.value
          }, null, 8, ["open", "items", "index", "names"])
        ]));
      };
    }
  });
  const _hoisted_1$6 = { class: "flex items-center justify-between gap-3" };
  const _hoisted_2$5 = { class: "min-w-0 truncate text-[15px] font-semibold leading-6" };
  const _hoisted_3$5 = { method: "dialog" };
  const _hoisted_4$5 = {
    class: "btn btn-ghost btn-sm btn-square",
    "aria-label": "关闭"
  };
  const _hoisted_5$5 = {
    key: 0,
    class: "modal-action"
  };
  const _sfc_main$8 = vue.defineComponent({
    __name: "DarkDialog",
    props: vue.mergeModels({
      title: {},
      description: { default: "" },
      width: { default: 520 }
    }, {
      "open": { type: Boolean, ...{ default: false } },
      "openModifiers": {}
    }),
    emits: ["update:open"],
    setup(__props) {
      const open = vue.useModel(__props, "open");
      const props = __props;
      const dlg = vue.ref(null);
      function sync(v) {
        const el = dlg.value;
        if (!el) return;
        if (v && !el.open) el.showModal();
        else if (!v && el.open) el.close();
      }
      vue.watch(open, (v) => sync(v));
      vue.onMounted(() => {
        if (open.value) sync(true);
      });
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createElementBlock("dialog", {
          ref_key: "dlg",
          ref: dlg,
          class: "modal",
          onClose: _cache[0] || (_cache[0] = ($event) => open.value = false)
        }, [
          vue.createElementVNode("div", {
            class: "modal-box",
            style: vue.normalizeStyle({ width: props.width + "px", maxWidth: "calc(100vw - 32px)" })
          }, [
            vue.createElementVNode("div", _hoisted_1$6, [
              vue.createElementVNode("h3", _hoisted_2$5, vue.toDisplayString(props.title), 1),
              vue.createElementVNode("form", _hoisted_3$5, [
                vue.createElementVNode("button", _hoisted_4$5, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "close",
                    size: 15
                  })
                ])
              ])
            ]),
            vue.renderSlot(_ctx.$slots, "default"),
            _ctx.$slots.footer ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_5$5, [
              vue.renderSlot(_ctx.$slots, "footer")
            ])) : vue.createCommentVNode("", true)
          ], 4),
          _cache[1] || (_cache[1] = vue.createElementVNode("form", {
            method: "dialog",
            class: "modal-backdrop"
          }, [
            vue.createElementVNode("button", null, "close")
          ], -1))
        ], 544);
      };
    }
  });
  function genQrDataUrl(text) {
    return new Promise((resolve) => {
      try {
        if (typeof QRCode === "undefined" || typeof QRCode !== "function") {
          addLog("[二维码] qrcodejs 未加载，请手动复制链接", "error", true);
          resolve("");
          return;
        }
        const holder = document.createElement("div");
        holder.style.position = "absolute";
        holder.style.left = "-99999px";
        holder.style.top = "-99999px";
        document.body.appendChild(holder);
        new QRCode(holder, {
          text,
          width: 240,
          height: 240,
          colorDark: "#000000",
          colorLight: "#ffffff",
          correctLevel: QRCode.CorrectLevel.M
        });
        setTimeout(() => {
          try {
            const canvas = holder.querySelector("canvas");
            const url = canvas ? canvas.toDataURL("image/png") : "";
            if (holder.parentNode) holder.parentNode.removeChild(holder);
            if (url) resolve(url);
            else {
              addLog("[二维码] 画布读取失败，请手动复制链接", "error", true);
              resolve("");
            }
          } catch (e) {
            if (holder.parentNode) holder.parentNode.removeChild(holder);
            addLog("[二维码] 读取失败: " + e.message, "error", true);
            resolve("");
          }
        }, 0);
      } catch (e) {
        addLog("[二维码] 生成异常: " + e.message, "error", true);
        resolve("");
      }
    });
  }
  const _hoisted_1$5 = ["data-device-id", "data-color-index"];
  const _sfc_main$7 = vue.defineComponent({
    __name: "DeviceIdTag",
    props: {
      id: {},
      colorIndex: {}
    },
    setup(__props) {
      const props = __props;
      const idx = vue.computed(
        () => typeof props.colorIndex === "number" ? props.colorIndex : hashDeviceId(props.id) % DEVICE_COLORS.length
      );
      const palette = vue.computed(() => DEVICE_COLORS[idx.value]);
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createElementBlock("span", {
          "data-device-id": _ctx.id,
          "data-color-index": idx.value,
          class: "inline-block rounded-[6px] border px-2 py-px text-[13px] leading-5",
          style: vue.normalizeStyle({ borderColor: palette.value.border, background: palette.value.bg, color: palette.value.color })
        }, vue.toDisplayString(vue.unref(shortPhoneId)(_ctx.id)), 13, _hoisted_1$5);
      };
    }
  });
  const _hoisted_1$4 = {
    class: "w-full overflow-auto px-4 py-4",
    style: { "max-width": "560px", "margin": "auto" }
  };
  const _hoisted_2$4 = { class: "card mb-3" };
  const _hoisted_3$4 = { class: "card-body gap-3 p-3.5" };
  const _hoisted_4$4 = {
    key: 0,
    class: "flex items-start gap-3"
  };
  const _hoisted_5$4 = { class: "shrink-0 text-center" };
  const _hoisted_6$4 = ["src"];
  const _hoisted_7$3 = {
    key: 1,
    class: "flex size-[124px] items-center justify-center rounded border border-base-300 text-xs text-base-content/40"
  };
  const _hoisted_8$3 = { class: "min-w-0 flex-1" };
  const _hoisted_9$3 = { class: "max-h-14 overflow-auto break-all rounded-box border border-base-300 bg-base-200 px-2.5 py-1.5 text-[13px] text-base-content" };
  const _hoisted_10$3 = {
    key: 1,
    class: "hero"
  };
  const _hoisted_11$3 = { class: "hero-content flex-col text-center" };
  const _hoisted_12$3 = { class: "mb-3 text-center" };
  const _hoisted_13$2 = {
    key: 0,
    class: "card mb-3"
  };
  const _hoisted_14$2 = { class: "card-body gap-2 p-3.5" };
  const _hoisted_15$2 = { class: "card-title text-[13px]" };
  const _hoisted_16$1 = { class: "list" };
  const _hoisted_17 = { class: "min-w-0" };
  const _sfc_main$6 = vue.defineComponent({
    __name: "PairPanel",
    props: {
      relayServer: {},
      phones: {}
    },
    setup(__props) {
      const props = __props;
      const deviceId = getDeviceId();
      const qrUrl = vue.ref("");
      const link = vue.ref("");
      const deviceColors = vue.computed(() => resolveDeviceColors(props.phones.map((p) => p.id)));
      const phoneOnline = vue.computed(() => props.phones.length > 0);
      function refreshLink() {
        const s = (props.relayServer || "").trim().replace(/\/+$/, "");
        if (!/^https?:\/\//i.test(s)) {
          link.value = "";
          qrUrl.value = "";
          return;
        }
        const lk = s + "/u/" + deviceId;
        link.value = lk;
        genQrDataUrl(lk).then((u) => qrUrl.value = u).catch((e) => addLog("[配对] 二维码失败: " + (e && e.message), "error", true));
      }
      vue.watch(() => props.relayServer, refreshLink);
      vue.onMounted(refreshLink);
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createElementBlock("div", _hoisted_1$4, [
          vue.createElementVNode("div", _hoisted_2$4, [
            vue.createElementVNode("div", _hoisted_3$4, [
              _cache[5] || (_cache[5] = vue.createElementVNode("div", { class: "card-title flex items-center justify-between gap-2 text-sm" }, [
                vue.createElementVNode("span", null, "电脑接收 · 本机专属链接"),
                vue.createElementVNode("span", { class: "badge badge-primary badge-sm" }, "手机扫码即上传")
              ], -1)),
              link.value ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_4$4, [
                vue.createElementVNode("div", _hoisted_5$4, [
                  qrUrl.value ? (vue.openBlock(), vue.createElementBlock("img", {
                    key: 0,
                    src: qrUrl.value,
                    alt: "上传链接二维码",
                    class: "block size-[124px] rounded border border-base-300"
                  }, null, 8, _hoisted_6$4)) : (vue.openBlock(), vue.createElementBlock("div", _hoisted_7$3, " 二维码生成中… ")),
                  _cache[1] || (_cache[1] = vue.createElementVNode("div", { class: "mt-1.5 text-xs text-base-content/60" }, "扫一扫上传", -1))
                ]),
                vue.createElementVNode("div", _hoisted_8$3, [
                  _cache[2] || (_cache[2] = vue.createElementVNode("div", { class: "mb-1.5 text-xs text-base-content/60" }, "链接（复制到手机浏览器打开）", -1)),
                  vue.createElementVNode("div", _hoisted_9$3, vue.toDisplayString(link.value), 1),
                  vue.createElementVNode("button", {
                    class: "btn btn-sm mt-2.5 w-full",
                    onClick: _cache[0] || (_cache[0] = ($event) => link.value && vue.unref(safeCopyText)(link.value))
                  }, "复制链接")
                ])
              ])) : (vue.openBlock(), vue.createElementBlock("div", _hoisted_10$3, [
                vue.createElementVNode("div", _hoisted_11$3, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "settings",
                    size: 20
                  }),
                  _cache[3] || (_cache[3] = vue.createElementVNode("p", { class: "text-sm" }, "尚未配置中继服务器", -1)),
                  _cache[4] || (_cache[4] = vue.createElementVNode("p", { class: "text-[13px] text-base-content/60" }, " 请到第一栏「设置」填写中继地址，保存后这里会自动生成扫码链接。 ", -1))
                ])
              ]))
            ])
          ]),
          vue.createElementVNode("div", _hoisted_12$3, [
            vue.createElementVNode("span", {
              class: vue.normalizeClass(["badge badge-lg", phoneOnline.value ? "badge-success" : "badge-error"])
            }, [
              vue.createElementVNode("span", {
                class: vue.normalizeClass(["mr-1.5 inline-block size-1.5 rounded-full", phoneOnline.value ? "bg-success" : "bg-error"])
              }, null, 2),
              vue.createTextVNode(" " + vue.toDisplayString(phoneOnline.value ? "已连接手机 " + _ctx.phones.length + " 台，可收发" : "当前无在线设备，暂不可收发"), 1)
            ], 2)
          ]),
          _ctx.phones.length ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_13$2, [
            vue.createElementVNode("div", _hoisted_14$2, [
              vue.createElementVNode("div", _hoisted_15$2, "已连接手机（" + vue.toDisplayString(_ctx.phones.length) + "）", 1),
              vue.createElementVNode("ul", _hoisted_16$1, [
                (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(_ctx.phones, (p) => {
                  return vue.openBlock(), vue.createElementBlock("li", {
                    key: p.id || "unknown",
                    class: "list-row"
                  }, [
                    vue.createElementVNode("div", null, [
                      vue.createVNode(vue.unref(Icon), {
                        name: "smartphone",
                        size: 16
                      })
                    ]),
                    vue.createElementVNode("div", _hoisted_17, [
                      vue.createVNode(_sfc_main$7, {
                        id: p.id,
                        "color-index": deviceColors.value[p.id]
                      }, null, 8, ["id", "color-index"]),
                      _cache[6] || (_cache[6] = vue.createElementVNode("div", { class: "text-[11px] text-base-content/60" }, "在线", -1))
                    ])
                  ]);
                }), 128))
              ]),
              _cache[7] || (_cache[7] = vue.createElementVNode("div", { class: "text-[11px] text-base-content/60" }, " 在左侧「对话」分组点对应手机即可进入会话；发给谁由所在会话决定。 ", -1))
            ])
          ])) : vue.createCommentVNode("", true)
        ]);
      };
    }
  });
  const _sfc_main$5 = vue.defineComponent({
    __name: "PairDialog",
    props: vue.mergeModels({
      relayServer: {},
      phones: {}
    }, {
      "open": { type: Boolean, ...{ default: false } },
      "openModifiers": {}
    }),
    emits: ["update:open"],
    setup(__props) {
      const open = vue.useModel(__props, "open");
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createBlock(_sfc_main$8, {
          open: open.value,
          "onUpdate:open": _cache[1] || (_cache[1] = ($event) => open.value = $event),
          title: "配对设备",
          width: 520
        }, {
          default: vue.withCtx(() => [
            vue.createVNode(_sfc_main$6, {
              "relay-server": _ctx.relayServer,
              phones: _ctx.phones
            }, null, 8, ["relay-server", "phones"])
          ]),
          footer: vue.withCtx(() => [
            _cache[2] || (_cache[2] = vue.createElementVNode("span", { class: "mr-auto text-xs text-white/45" }, "手机扫码即配对", -1)),
            vue.createElementVNode("button", {
              type: "button",
              class: "cursor-pointer rounded-[6px] border-0 bg-white/[0.12] px-3.5 py-1 text-[13px] text-white outline-none hover:bg-white/20",
              onClick: _cache[0] || (_cache[0] = ($event) => open.value = false)
            }, " 关闭 ")
          ]),
          _: 1
        }, 8, ["open"]);
      };
    }
  });
  const _hoisted_1$3 = { class: "fieldset" };
  const _hoisted_2$3 = { class: "fieldset" };
  const _hoisted_3$3 = ["checked"];
  const _hoisted_4$3 = { class: "mt-2 border-t border-base-300 pt-3" };
  const _hoisted_5$3 = {
    key: 1,
    class: "alert alert-error alert-soft alert-vertical"
  };
  const _hoisted_6$3 = { class: "flex justify-end gap-2" };
  const _sfc_main$4 = vue.defineComponent({
    __name: "SettingsDialog",
    props: {
      "open": { type: Boolean, ...{ default: false } },
      "openModifiers": {}
    },
    emits: ["update:open"],
    setup(__props) {
      const open = vue.useModel(__props, "open");
      const store = useTransferStore();
      const relayDraft = vue.ref(store.value.settings.relayServer);
      const confirmClear = vue.ref(false);
      vue.watch(open, (v) => {
        if (v) {
          relayDraft.value = store.value.settings.relayServer;
          confirmClear.value = false;
        } else {
          commitRelay(relayDraft.value);
        }
      });
      function commitRelay(val) {
        const url = (val || "").trim().replace(/\/+$/, "");
        if (url && url !== store.value.settings.relayServer) updateTransferSettings({ relayServer: url });
      }
      function closeWithCommit() {
        commitRelay(relayDraft.value);
        open.value = false;
      }
      function onBlur() {
        const url = (relayDraft.value || "").trim();
        if (!url) {
          relayDraft.value = DEFAULT_RELAY_SERVER;
          commitRelay(DEFAULT_RELAY_SERVER);
        } else {
          commitRelay(url);
        }
      }
      function doClearAll() {
        clearAllTransferFiles();
        addLog("[传输助手] 已清空全部传输记录", "success");
        confirmClear.value = false;
      }
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createBlock(_sfc_main$8, {
          open: open.value,
          "onUpdate:open": _cache[5] || (_cache[5] = ($event) => open.value = $event),
          title: "传输助手设置",
          width: 480
        }, {
          footer: vue.withCtx(() => [
            vue.createElementVNode("button", {
              class: "btn btn-sm",
              onClick: closeWithCommit
            }, "完成")
          ]),
          default: vue.withCtx(() => [
            vue.createElementVNode("fieldset", _hoisted_1$3, [
              _cache[6] || (_cache[6] = vue.createElementVNode("legend", { class: "fieldset-legend" }, "中继服务器地址", -1)),
              vue.withDirectives(vue.createElementVNode("input", {
                "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => relayDraft.value = $event),
                type: "text",
                class: "input w-full",
                placeholder: "https://你的服务器:端口",
                onBlur,
                onKeydown: _cache[1] || (_cache[1] = vue.withKeys(vue.withModifiers(($event) => commitRelay(relayDraft.value), ["prevent"]), ["enter"]))
              }, null, 544), [
                [vue.vModelText, relayDraft.value]
              ]),
              _cache[7] || (_cache[7] = vue.createElementVNode("p", { class: "label" }, " 手机上传的图片 / 文本经此服务器转发到本机。修改后点其他区域或按回车生效；留空失焦恢复默认地址。 ", -1))
            ]),
            vue.createElementVNode("fieldset", _hoisted_2$3, [
              _cache[8] || (_cache[8] = vue.createElementVNode("legend", { class: "fieldset-legend" }, "收到内容时自动打开传输助手", -1)),
              vue.createElementVNode("input", {
                type: "checkbox",
                class: "toggle",
                checked: vue.unref(store).settings.autoOpenOnReceive,
                onChange: _cache[2] || (_cache[2] = ($event) => vue.unref(updateTransferSettings)({ autoOpenOnReceive: $event.target.checked }))
              }, null, 40, _hoisted_3$3),
              _cache[9] || (_cache[9] = vue.createElementVNode("p", { class: "label" }, "关闭时仅累计未读角标，不打扰；窗口已开着则只累加，不强行切换会话。", -1))
            ]),
            vue.createElementVNode("div", _hoisted_4$3, [
              !confirmClear.value ? (vue.openBlock(), vue.createElementBlock("button", {
                key: 0,
                class: "btn btn-error btn-sm",
                onClick: _cache[3] || (_cache[3] = ($event) => confirmClear.value = true)
              }, "清空全部传输记录")) : (vue.openBlock(), vue.createElementBlock("div", _hoisted_5$3, [
                _cache[10] || (_cache[10] = vue.createElementVNode("div", null, [
                  vue.createElementVNode("div", { class: "text-[13px]" }, "清空全部传输记录"),
                  vue.createElementVNode("div", { class: "text-xs" }, " 所有会话的图片与文本都会被移除（仅清理本机内存，不影响手机上的文件） ")
                ], -1)),
                vue.createElementVNode("div", _hoisted_6$3, [
                  vue.createElementVNode("button", {
                    class: "btn btn-outline btn-xs",
                    onClick: _cache[4] || (_cache[4] = ($event) => confirmClear.value = false)
                  }, "取消"),
                  vue.createElementVNode("button", {
                    class: "btn btn-error btn-xs",
                    onClick: doClearAll
                  }, "清空")
                ])
              ]))
            ])
          ]),
          _: 1
        }, 8, ["open"]);
      };
    }
  });
  const _hoisted_1$2 = { class: "flex gap-3 border-b border-base-300 py-[7px]" };
  const _hoisted_2$2 = { class: "min-w-0 flex-1 break-all text-[13px]" };
  const _hoisted_3$2 = { class: "flex gap-3 border-b border-base-300 py-[7px]" };
  const _hoisted_4$2 = { class: "inline-flex min-w-0 flex-1 flex-wrap items-center gap-1.5" };
  const _hoisted_5$2 = { class: "text-[11px] opacity-65" };
  const _hoisted_6$2 = { class: "flex gap-3 border-b border-base-300 py-[7px]" };
  const _hoisted_7$2 = { class: "min-w-0 flex-1" };
  const _hoisted_8$2 = {
    key: 0,
    class: "inline-flex flex-wrap items-center gap-1.5"
  };
  const _hoisted_9$2 = { class: "text-[11px] opacity-65" };
  const _hoisted_10$2 = {
    key: 1,
    class: "text-[13px] text-base-content/60"
  };
  const _hoisted_11$2 = { class: "flex gap-3 border-b border-base-300 py-[7px]" };
  const _hoisted_12$2 = { class: "min-w-0 flex-1 break-all text-[13px]" };
  const _sfc_main$3 = vue.defineComponent({
    __name: "AboutDialog",
    props: {
      "open": { type: Boolean, ...{ default: false } },
      "openModifiers": {}
    },
    emits: ["update:open"],
    setup(__props) {
      const open = vue.useModel(__props, "open");
      const store = useTransferStore();
      const deviceId = getDeviceId();
      const colors = vue.computed(() => resolveDeviceColors(store.value.phones.map((p) => p.id)));
      const version = vue.computed(() => {
        var _a;
        return ((_a = GM_info == null ? void 0 : GM_info.script) == null ? void 0 : _a.version) || "未知";
      });
      function openHome() {
        window.open("https://github.com/Run-os/znhd-service", "_blank");
      }
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createBlock(_sfc_main$8, {
          open: open.value,
          "onUpdate:open": _cache[2] || (_cache[2] = ($event) => open.value = $event),
          title: "企业信息",
          width: 440
        }, {
          footer: vue.withCtx(() => [
            vue.createElementVNode("button", {
              class: "btn btn-sm",
              onClick: _cache[1] || (_cache[1] = ($event) => open.value = false)
            }, "关闭")
          ]),
          default: vue.withCtx(() => [
            vue.createElementVNode("div", _hoisted_1$2, [
              _cache[3] || (_cache[3] = vue.createElementVNode("span", {
                class: "shrink-0 text-[13px] opacity-65",
                style: { "flex": "0 0 92px" }
              }, "中继服务器", -1)),
              vue.createElementVNode("span", _hoisted_2$2, vue.toDisplayString(vue.unref(store).settings.relayServer || "（未配置）"), 1)
            ]),
            vue.createElementVNode("div", _hoisted_3$2, [
              _cache[4] || (_cache[4] = vue.createElementVNode("span", {
                class: "shrink-0 text-[13px] opacity-65",
                style: { "flex": "0 0 92px" }
              }, "本机设备", -1)),
              vue.createElementVNode("span", _hoisted_4$2, [
                vue.createVNode(_sfc_main$7, { id: vue.unref(deviceId) }, null, 8, ["id"]),
                vue.createElementVNode("span", _hoisted_5$2, vue.toDisplayString(vue.unref(deviceId)), 1),
                vue.createElementVNode("button", {
                  class: "btn btn-ghost btn-xs btn-square text-base-content/60 hover:text-base-content",
                  "aria-label": "复制设备 ID",
                  title: "复制设备 ID",
                  onClick: _cache[0] || (_cache[0] = ($event) => vue.unref(safeCopyText)(vue.unref(deviceId)))
                }, [
                  vue.createVNode(vue.unref(Icon), {
                    name: "copy",
                    size: 13
                  })
                ])
              ])
            ]),
            vue.createElementVNode("div", _hoisted_6$2, [
              _cache[5] || (_cache[5] = vue.createElementVNode("span", {
                class: "shrink-0 text-[13px] opacity-65",
                style: { "flex": "0 0 92px" }
              }, "在线手机", -1)),
              vue.createElementVNode("span", _hoisted_7$2, [
                vue.unref(store).phones.length ? (vue.openBlock(), vue.createElementBlock("span", _hoisted_8$2, [
                  (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(vue.unref(store).phones, (p) => {
                    return vue.openBlock(), vue.createBlock(_sfc_main$7, {
                      key: p.id || "unknown",
                      id: p.id,
                      "color-index": colors.value[p.id]
                    }, null, 8, ["id", "color-index"]);
                  }), 128)),
                  vue.createElementVNode("span", _hoisted_9$2, "共 " + vue.toDisplayString(vue.unref(store).phones.length) + " 台", 1)
                ])) : (vue.openBlock(), vue.createElementBlock("span", _hoisted_10$2, "暂无（手机端打开本机链接后出现）"))
              ])
            ]),
            vue.createElementVNode("div", _hoisted_11$2, [
              _cache[6] || (_cache[6] = vue.createElementVNode("span", {
                class: "shrink-0 text-[13px] opacity-65",
                style: { "flex": "0 0 92px" }
              }, "脚本版本", -1)),
              vue.createElementVNode("span", _hoisted_12$2, vue.toDisplayString(version.value), 1)
            ]),
            vue.createElementVNode("div", { class: "flex gap-3 border-b border-base-300 py-[7px]" }, [
              _cache[7] || (_cache[7] = vue.createElementVNode("span", {
                class: "shrink-0 text-[13px] opacity-65",
                style: { "flex": "0 0 92px" }
              }, "项目主页", -1)),
              vue.createElementVNode("span", { class: "min-w-0 flex-1" }, [
                vue.createElementVNode("button", {
                  class: "btn btn-link btn-xs h-auto px-0 text-[13px]",
                  onClick: openHome
                }, " github.com/Run-os/znhd-service ")
              ])
            ]),
            _cache[8] || (_cache[8] = vue.createElementVNode("div", { class: "mt-2.5 text-xs text-base-content/60" }, " 提示：排查「连不上」时先看这里 —— 中继地址是否可达、手机是否出现在在线列表里； 会话记录保存在本机（IndexedDB），仅保留最近 7 天，超期自动清理。 ", -1))
          ]),
          _: 1
        }, 8, ["open"]);
      };
    }
  });
  const TURN_GAP_MS = 2 * 60 * 1e3;
  function groupTurns(rows, opts) {
    const turns = [];
    for (const row of rows) {
      const last = turns[turns.length - 1];
      const mine = opts.mineOf(row);
      const ts = opts.tsOf(row);
      const prev = last == null ? void 0 : last.items[last.items.length - 1];
      const canMerge = last && !opts.sepOf(row) && last.mine === mine && prev && ts - opts.tsOf(prev) <= TURN_GAP_MS;
      if (canMerge) {
        last.items.push(row);
      } else {
        turns.push({ key: opts.keyOf(row), mine, sepText: opts.sepOf(row), items: [row] });
      }
    }
    return turns;
  }
  const _hoisted_1$1 = { class: "modal-box flex h-[672px] max-h-[calc(100vh-96px)] w-[768px] max-w-[94vw] flex-col gap-0 p-0" };
  const _hoisted_2$1 = { class: "flex shrink-0 items-center gap-1 border-b border-base-300 px-6 py-3" };
  const _hoisted_3$1 = { class: "flex min-w-0 items-center gap-2" };
  const _hoisted_4$1 = { class: "shrink-0 text-xs text-base-content/60" };
  const _hoisted_5$1 = { class: "ml-auto flex items-center gap-1.5" };
  const _hoisted_6$1 = {
    class: "tooltip tooltip-bottom",
    "data-tip": "清空聊天记录"
  };
  const _hoisted_7$1 = ["disabled"];
  const _hoisted_8$1 = {
    class: "tooltip tooltip-bottom",
    "data-tip": "全部文件"
  };
  const _hoisted_9$1 = {
    class: "tooltip tooltip-bottom",
    "data-tip": "扫码连接手机"
  };
  const _hoisted_10$1 = { class: "dropdown dropdown-end" };
  const _hoisted_11$1 = {
    class: "btn btn-outline btn-sm btn-circle",
    "aria-label": "更多",
    title: "更多"
  };
  const _hoisted_12$1 = { class: "menu dropdown-content z-10 w-44 rounded-box bg-base-100 p-2 shadow" };
  const _hoisted_13$1 = { method: "dialog" };
  const _hoisted_14$1 = {
    class: "btn btn-outline btn-sm btn-circle",
    "aria-label": "关闭",
    title: "关闭"
  };
  const _hoisted_15$1 = { class: "shrink-0 border-t border-base-300 px-6 py-3" };
  const _hoisted_16 = {
    key: 0,
    class: "mt-2 text-center text-xs text-base-content/60"
  };
  const TIME_GAP = 5 * 60 * 1e3;
  const _sfc_main$2 = vue.defineComponent({
    __name: "ChatWindow",
    props: {
      "open": { type: Boolean, ...{ default: false } },
      "openModifiers": {}
    },
    emits: ["update:open"],
    setup(__props) {
      const open = vue.useModel(__props, "open");
      const store = useTransferStore();
      const filesOpen = vue.ref(false);
      const pairOpen = vue.ref(false);
      const settingsOpen = vue.ref(false);
      const aboutOpen = vue.ref(false);
      const sendText = vue.ref("");
      const imgCopy = vue.ref(null);
      const previewOpen = vue.ref(false);
      const previewIndex = vue.ref(0);
      const scroller = vue.ref(null);
      const dlg = vue.ref(null);
      const messages = vue.computed(
        () => store.value.sessions.reduce((acc, s) => acc.concat(s.messages), []).sort((a, b) => a.ts - b.ts)
      );
      const sendable = vue.computed(() => sessionSendable());
      const onlineCount = vue.computed(() => store.value.phones.length);
      const sending = vue.computed(() => messages.value.some((m) => m.sendState === "sending"));
      const imageMessages = vue.computed(() => messages.value.filter((m) => m.type === "image"));
      const imageUrls = vue.computed(() => imageMessages.value.map((m) => m.previewUrl));
      const imageNames = vue.computed(() => imageMessages.value.map((m, i) => downloadFileName(m.name, m.mime, i)));
      const rows = vue.computed(
        () => messages.value.map((msg, i) => {
          const prev = i > 0 ? messages.value[i - 1] : void 0;
          return {
            msg,
            sepText: !prev || msg.ts - prev.ts > TIME_GAP ? sepTimeText(msg.ts) : "",
            imageIndex: msg.type === "image" ? imageMessages.value.findIndex((m) => m.id === msg.id) : -1
          };
        })
      );
      const turns = vue.computed(
        () => groupTurns(rows.value, {
          keyOf: (row) => row.msg.id,
          mineOf: (row) => row.msg.direction === "out",
          tsOf: (row) => row.msg.ts,
          sepOf: (row) => row.sepText
        })
      );
      function metaOf(msg) {
        if (msg.direction !== "out") return { text: "", danger: false };
        if (msg.sendState === "sending") {
          return {
            text: typeof msg.sendProgress === "number" ? "发送中 " + msg.sendProgress + "%" : "发送中…",
            danger: false
          };
        }
        if (msg.sendState === "queued") return { text: "已排队 · 等设备上线后发送", danger: false };
        if (msg.sendState === "failed") return { text: "发送失败" + (msg.sendError ? "：" + msg.sendError : ""), danger: true };
        return { text: "已发送", danger: false };
      }
      vue.watch(open, (v) => setTransferWindowOpen(v), { immediate: true });
      vue.onBeforeUnmount(() => setTransferWindowOpen(false));
      vue.watch(
        open,
        (v) => {
          if (!v) return;
          setActiveSession(PHONE_SESSION_KEY);
          store.value.sessions.forEach((s) => markSessionRead(s.key));
        },
        { immediate: true }
      );
      function syncDialog(v) {
        const el = dlg.value;
        if (!el) return;
        if (v && !el.open) el.showModal();
        else if (!v && el.open) el.close();
      }
      vue.watch(open, (v) => syncDialog(v));
      vue.onMounted(() => {
        if (open.value) syncDialog(true);
      });
      function closeMenu(e) {
        var _a;
        (_a = e.currentTarget.closest("details")) == null ? void 0 : _a.removeAttribute("open");
      }
      function scrollToEnd() {
        const el = scroller.value;
        if (el) el.scrollTop = el.scrollHeight;
      }
      function doSendText() {
        const t = sendText.value.trim();
        if (!t) return;
        if (sendTextToSession(PHONE_SESSION_KEY, t)) {
          sendText.value = "";
          scrollToEnd();
        }
      }
      function pickFilesInto(accept, apply2) {
        const inp = document.createElement("input");
        inp.type = "file";
        inp.accept = accept;
        inp.multiple = true;
        inp.style.display = "none";
        document.body.appendChild(inp);
        const cleanupFocus = () => {
          window.removeEventListener("focus", cleanupFocus);
          try {
            inp.remove();
          } catch (e) {
          }
        };
        inp.onchange = () => {
          const files = Array.prototype.slice.call(inp.files || []);
          window.removeEventListener("focus", cleanupFocus);
          inp.remove();
          if (files.length) apply2(files);
        };
        window.addEventListener("focus", cleanupFocus);
        inp.click();
      }
      function pickImages() {
        if (!sendable.value) {
          addLog("[传输助手] 当前无在线设备，无法发送", "error", true);
          return;
        }
        pickFilesInto("image/*", (files) => {
          const list = files.map((f) => ({
            file: f,
            name: f.name || "image.jpg",
            mime: f.type || "image/jpeg",
            url: URL.createObjectURL(f)
          }));
          if (sendImagesToSession(PHONE_SESSION_KEY, list)) scrollToEnd();
        });
      }
      function pickFiles() {
        if (!sendable.value) {
          addLog("[传输助手] 当前无在线设备，无法发送", "error", true);
          return;
        }
        pickFilesInto("", (files) => {
          const list = files.map((f) => ({
            file: f,
            name: f.name || "file.bin",
            mime: f.type || "application/octet-stream",
            url: URL.createObjectURL(f)
          }));
          if (sendFilesToSession(PHONE_SESSION_KEY, list)) scrollToEnd();
        });
      }
      function doCopy(msg) {
        imgCopy.value = { id: msg.id, state: "busy" };
        copyImageToClipboard(msg.blob).then((ok) => {
          imgCopy.value = { id: msg.id, state: ok ? "ok" : "fail" };
          if (ok) addLog("图片已复制到剪贴板: " + (msg.name || ""), "success");
          window.setTimeout(() => imgCopy.value = null, 1500);
        });
      }
      function saveBlob(blob, name) {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
      }
      function doDownload(msg, idx) {
        const fname = downloadFileName(msg.name, msg.mime, idx);
        saveBlob(msg.blob, fname);
        addLog("图片已下载: " + fname, "success");
      }
      function doDownloadFile(msg) {
        const fname = msg.name || "file.bin";
        saveBlob(msg.blob, fname);
        addLog("文件已下载: " + fname, "success");
      }
      function openPreview(msg) {
        const at = imageMessages.value.findIndex((m) => m.id === msg.id);
        previewIndex.value = at >= 0 ? at : 0;
        previewOpen.value = true;
      }
      function clearAll() {
        store.value.sessions.forEach((s) => clearTransferSession(s.key));
        addLog("[传输助手] 已清空聊天记录", "success");
      }
      const attachActions = vue.computed(() => [
        {
          key: "image",
          label: "图片",
          icon: "image",
          onClick: pickImages,
          disabled: !sendable.value || sending.value
        },
        {
          key: "file",
          label: "文件",
          icon: "paperclip",
          onClick: pickFiles,
          disabled: !sendable.value || sending.value
        }
      ]);
      const headerText = vue.computed(() => onlineCount.value ? "已连接 " + onlineCount.value + " 台设备" : "未连接设备");
      const footerHint = vue.computed(() => sendable.value ? "" : "当前没有在线手机，发出去的消息会在设备上线后自动送达");
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createElementBlock(vue.Fragment, null, [
          vue.createElementVNode("dialog", {
            ref_key: "dlg",
            ref: dlg,
            class: "modal",
            onClose: _cache[5] || (_cache[5] = ($event) => open.value = false)
          }, [
            vue.createElementVNode("div", _hoisted_1$1, [
              vue.createElementVNode("div", _hoisted_2$1, [
                vue.createElementVNode("div", _hoisted_3$1, [
                  _cache[11] || (_cache[11] = vue.createElementVNode("h3", { class: "truncate text-lg font-bold" }, "传输助手", -1)),
                  vue.createElementVNode("span", _hoisted_4$1, vue.toDisplayString(headerText.value), 1)
                ]),
                vue.createElementVNode("div", _hoisted_5$1, [
                  vue.createElementVNode("div", _hoisted_6$1, [
                    vue.createElementVNode("button", {
                      class: "btn btn-outline btn-sm btn-circle",
                      "aria-label": "清空聊天记录",
                      disabled: !rows.value.length,
                      onClick: clearAll
                    }, [
                      vue.createVNode(vue.unref(Icon), {
                        name: "rotateCw",
                        size: 14
                      })
                    ], 8, _hoisted_7$1)
                  ]),
                  vue.createElementVNode("div", _hoisted_8$1, [
                    vue.createElementVNode("button", {
                      class: "btn btn-outline btn-sm btn-circle",
                      "aria-label": "全部文件",
                      title: "全部文件",
                      onClick: _cache[0] || (_cache[0] = ($event) => filesOpen.value = true)
                    }, [
                      vue.createVNode(vue.unref(Icon), {
                        name: "files",
                        size: 14
                      })
                    ])
                  ]),
                  vue.createElementVNode("div", _hoisted_9$1, [
                    vue.createElementVNode("button", {
                      class: "btn btn-outline btn-sm btn-circle",
                      "aria-label": "扫码连接手机",
                      title: "扫码连接手机",
                      onClick: _cache[1] || (_cache[1] = ($event) => pairOpen.value = true)
                    }, [
                      vue.createVNode(vue.unref(Icon), {
                        name: "qr",
                        size: 14
                      })
                    ])
                  ]),
                  vue.createElementVNode("details", _hoisted_10$1, [
                    vue.createElementVNode("summary", _hoisted_11$1, [
                      vue.createVNode(vue.unref(Icon), {
                        name: "more",
                        size: 14
                      })
                    ]),
                    vue.createElementVNode("ul", _hoisted_12$1, [
                      vue.createElementVNode("li", null, [
                        vue.createElementVNode("button", {
                          onClick: _cache[2] || (_cache[2] = ($event) => {
                            settingsOpen.value = true;
                            closeMenu($event);
                          })
                        }, [
                          vue.createVNode(vue.unref(Icon), {
                            name: "settings",
                            size: 15
                          }),
                          _cache[12] || (_cache[12] = vue.createTextVNode(" 设置 "))
                        ])
                      ]),
                      vue.createElementVNode("li", null, [
                        vue.createElementVNode("button", {
                          onClick: _cache[3] || (_cache[3] = ($event) => {
                            aboutOpen.value = true;
                            closeMenu($event);
                          })
                        }, [
                          vue.createVNode(vue.unref(Icon), {
                            name: "info",
                            size: 15
                          }),
                          _cache[13] || (_cache[13] = vue.createTextVNode(" 关于 "))
                        ])
                      ])
                    ])
                  ]),
                  vue.createElementVNode("form", _hoisted_13$1, [
                    vue.createElementVNode("button", _hoisted_14$1, [
                      vue.createVNode(vue.unref(Icon), {
                        name: "close",
                        size: 14
                      })
                    ])
                  ])
                ])
              ]),
              vue.createElementVNode("div", {
                ref_key: "scroller",
                ref: scroller,
                "data-znhd": "chat-scroller",
                class: "min-h-0 flex-1 overflow-y-auto p-6"
              }, [
                (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(turns.value, (turn) => {
                  var _a;
                  return vue.openBlock(), vue.createBlock(_sfc_main$b, {
                    key: turn.key,
                    mine: turn.mine,
                    "session-key": ((_a = turn.items[0]) == null ? void 0 : _a.msg.sessionKey) || "",
                    "time-label": turn.sepText,
                    count: turn.items.length
                  }, {
                    default: vue.withCtx(() => [
                      (vue.openBlock(true), vue.createElementBlock(vue.Fragment, null, vue.renderList(turn.items, (row) => {
                        var _a2;
                        return vue.openBlock(), vue.createBlock(_sfc_main$c, {
                          key: row.msg.id,
                          grouped: "",
                          type: row.msg.type,
                          mine: row.msg.direction === "out",
                          text: row.msg.text || "",
                          name: row.msg.name || "",
                          mime: row.msg.mime || "",
                          "size-text": row.msg.blob ? Math.max(1, Math.round(row.msg.blob.size / 1024)) + " KB" : "",
                          "image-src": row.msg.previewUrl || "",
                          meta: metaOf(row.msg).text,
                          "meta-danger": metaOf(row.msg).danger,
                          progress: row.msg.sendState === "sending" ? (_a2 = row.msg.sendProgress) != null ? _a2 : null : null,
                          error: row.msg.sendState === "failed" ? row.msg.sendError || "" : "",
                          clickable: row.msg.type === "image",
                          "can-download": !!row.msg.blob,
                          "image-actions": row.msg.type === "image" ? [
                            {
                              label: "复制",
                              tooltip: "复制",
                              icon: imgCopy.value && imgCopy.value.id === row.msg.id && imgCopy.value.state === "ok" ? "check" : "copy",
                              onClick: () => doCopy(row.msg)
                            },
                            {
                              label: "下载",
                              icon: "download",
                              onClick: () => doDownload(row.msg, row.imageIndex)
                            },
                            {
                              label: "删除",
                              icon: "trash",
                              danger: true,
                              onClick: () => vue.unref(removeTransferMessage)(row.msg.sessionKey, row.msg.id)
                            }
                          ] : [],
                          onPreview: ($event) => openPreview(row.msg),
                          onDownload: ($event) => row.msg.type === "file" ? doDownloadFile(row.msg) : doDownload(row.msg, row.imageIndex)
                        }, null, 8, ["type", "mine", "text", "name", "mime", "size-text", "image-src", "meta", "meta-danger", "progress", "error", "clickable", "can-download", "image-actions", "onPreview", "onDownload"]);
                      }), 128))
                    ]),
                    _: 2
                  }, 1032, ["mine", "session-key", "time-label", "count"]);
                }), 128))
              ], 512),
              vue.createElementVNode("div", _hoisted_15$1, [
                vue.createElementVNode("form", {
                  onSubmit: vue.withModifiers(doSendText, ["prevent"])
                }, [
                  vue.createVNode(_sfc_main$a, {
                    modelValue: sendText.value,
                    "onUpdate:modelValue": _cache[4] || (_cache[4] = ($event) => sendText.value = $event),
                    placeholder: "输入要发送到手机的文本…",
                    attach: attachActions.value,
                    onSend: doSendText
                  }, null, 8, ["modelValue", "attach"])
                ], 32),
                footerHint.value ? (vue.openBlock(), vue.createElementBlock("div", _hoisted_16, vue.toDisplayString(footerHint.value), 1)) : vue.createCommentVNode("", true)
              ])
            ]),
            _cache[14] || (_cache[14] = vue.createElementVNode("form", {
              method: "dialog",
              class: "modal-backdrop"
            }, [
              vue.createElementVNode("button", null, "close")
            ], -1))
          ], 544),
          vue.createVNode(_sfc_main$8, {
            open: filesOpen.value,
            "onUpdate:open": _cache[6] || (_cache[6] = ($event) => filesOpen.value = $event),
            title: "文件",
            width: 780,
            description: "本次会话的全部图片 / 文件 / 文本"
          }, {
            default: vue.withCtx(() => [
              vue.createVNode(_sfc_main$9, {
                messages: messages.value,
                "scope-label": "全部文件",
                "clear-scope": clearAll
              }, null, 8, ["messages"])
            ]),
            _: 1
          }, 8, ["open"]),
          vue.createVNode(_sfc_main$5, {
            open: pairOpen.value,
            "onUpdate:open": _cache[7] || (_cache[7] = ($event) => pairOpen.value = $event),
            "relay-server": vue.unref(store).settings.relayServer,
            phones: vue.unref(store).phones
          }, null, 8, ["open", "relay-server", "phones"]),
          vue.createVNode(_sfc_main$4, {
            open: settingsOpen.value,
            "onUpdate:open": _cache[8] || (_cache[8] = ($event) => settingsOpen.value = $event)
          }, null, 8, ["open"]),
          vue.createVNode(_sfc_main$3, {
            open: aboutOpen.value,
            "onUpdate:open": _cache[9] || (_cache[9] = ($event) => aboutOpen.value = $event)
          }, null, 8, ["open"]),
          vue.createVNode(_sfc_main$e, {
            open: previewOpen.value,
            "onUpdate:open": _cache[10] || (_cache[10] = ($event) => previewOpen.value = $event),
            items: imageUrls.value,
            index: previewIndex.value,
            names: imageNames.value
          }, null, 8, ["open", "items", "index", "names"])
        ], 64);
      };
    }
  });
  const _hoisted_1 = {
    key: 1,
    class: "flex size-[26px] shrink-0 items-center justify-center rounded-md bg-primary text-primary-content"
  };
  const _hoisted_2 = { class: "shrink-0 rounded-lg bg-accent px-2 py-px text-[11px] font-normal leading-5 text-accent-content" };
  const _hoisted_3 = ["data-tip"];
  const _hoisted_4 = ["aria-label"];
  const _hoisted_5 = { class: "p-3" };
  const _hoisted_6 = { class: "mb-2.5 flex items-center justify-between rounded-box bg-base-200 px-3 py-2" };
  const _hoisted_7 = { class: "flex items-center gap-1.5 text-[13px]" };
  const _hoisted_8 = ["checked"];
  const _hoisted_9 = { class: "grid grid-cols-4 gap-1.5" };
  const _hoisted_10 = ["data-tip"];
  const _hoisted_11 = ["onClick"];
  const _hoisted_12 = { class: "text-primary" };
  const _hoisted_13 = { class: "znhd-panel-btn-text ml-0.5 text-[11px]" };
  const _hoisted_14 = { class: "mt-2.5 flex items-center justify-between gap-2 text-xs text-base-content/60" };
  const _hoisted_15 = { class: "truncate" };
  const BRAND_ICON = "https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico";
  const _sfc_main$1 = vue.defineComponent({
    __name: "MainPanel",
    props: {
      host: {}
    },
    setup(__props) {
      const props = __props;
      const drag = usePanelDrag(props.host);
      const brandFailed = vue.ref(false);
      const PANEL_ACTIONS = [
        { key: "settings", icon: "settings", label: "设置" },
        { key: "phrases", icon: "phrases", label: "常用语" },
        { key: "transfer", icon: "transfer", label: "传输助手" },
        { key: "sniff", icon: "sniff", label: "图片嗅探" }
      ];
      const allvalue = vue.ref(runtime.init);
      const voiceEnabled = vue.computed(() => !!allvalue.value.voiceEnabled);
      const settingsOpen = vue.ref(false);
      const phrasesOpen = vue.ref(false);
      const transferOpen = vue.ref(false);
      const sniffOpen = vue.ref(false);
      const logOpen = vue.ref(false);
      const changelogOpen = vue.ref(false);
      const collapsed = vue.ref(false);
      const mon = vue.ref(getMonitorState());
      const logEntries = vue.ref([]);
      const phrasesData = vue.ref({ all: [], mine: [] });
      const phrasesLoading = vue.ref(false);
      const searchKeyword = vue.ref("");
      let phrasesRequestSeq = 0;
      const VERSION = GM_info.script.version;
      let offAutoOpen = null;
      const isDark = vue.computed(() => themeMode.value === "dark");
      function onToggleTheme() {
        const next = toggleTheme();
        addLog("主题已切换为" + (next === "dark" ? "夜间模式（business）" : "日间模式（wireframe）"), "info");
      }
      function patchAllvalue(kv) {
        const next = { ...allvalue.value, ...kv };
        allvalue.value = next;
        saveAllvalue(next);
        runtime.voiceEnabled = next.voiceEnabled;
        runtime.workingHours = next.workingHours;
        runtime.useCdn = !!next.useCdn;
        runtime.logAutoRefresh = !!next.logAutoRefresh;
      }
      function toggleVoice(next) {
        patchAllvalue({ voiceEnabled: next });
        addLog("语音播报已" + (next ? "开启" : "静音"), "info");
        if (next && "speechSynthesis" in window) {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
          resetWaitCountBaseline();
        } else if (!next) {
          clearSpeechQueue();
        }
      }
      function lastSpeakText(last) {
        if (!last) return "暂无播报记录";
        const mins = Math.floor((Date.now() - last.at) / 6e4);
        const when = mins <= 0 ? "刚刚" : mins + " 分钟前";
        return "上次播报：" + when + " · " + last.reason;
      }
      const statusText = vue.computed(
        () => mon.value.inWorkingHours ? "当前等待人数：" + (mon.value.waiting === null ? "—" : mon.value.waiting) + " 人" : "当前非工作时段"
      );
      function openEntry(key) {
        if (key === "settings") settingsOpen.value = true;
        else if (key === "phrases") phrasesOpen.value = true;
        else if (key === "transfer") transferOpen.value = true;
        else if (key === "sniff") sniffOpen.value = true;
      }
      function loadPhrasesData(force = false) {
        if (!force) {
          const cache = loadPhrasesCache();
          if (cache && cache.data) {
            phrasesData.value = cache.data;
            const mins = Math.round((Date.now() - cache.time) / 6e4);
            addLog("常用语使用本地缓存（" + mins + " 分钟前抓取），如需更新请点侧边栏刷新按钮", "info");
            return;
          }
        }
        const seq = ++phrasesRequestSeq;
        phrasesLoading.value = true;
        readPhrasesFromZnhd().then((data) => {
          if (seq !== phrasesRequestSeq) return;
          phrasesData.value = data;
          savePhrasesCache(data);
          const total = data.all.length + data.mine.length;
          addLog(
            "常用语抓取成功：全部话术 " + data.all.length + " 条、我的话术 " + data.mine.length + " 条",
            "success"
          );
          toast.success("常用语抓取成功（共 " + total + " 条）");
        }).catch((error) => {
          if (seq !== phrasesRequestSeq) return;
          const hasOld = phrasesData.value.all.length + phrasesData.value.mine.length > 0;
          const reason = (error == null ? void 0 : error.message) || "未知错误";
          addLog("常用语抓取失败: " + reason + (hasOld ? "，仍显示上次内容" : ""), "error", true);
          toast.error("常用语抓取失败：" + reason + (hasOld ? "，仍显示上次内容" : ""));
        }).finally(() => {
          if (seq === phrasesRequestSeq) phrasesLoading.value = false;
        });
      }
      vue.watch(phrasesOpen, (open) => {
        if (open) loadPhrasesData();
      });
      vue.watch(collapsed, (now, prev) => {
        if (prev && !now) clampHostIntoView(props.host);
      });
      vue.onMounted(() => {
        setLogEntriesSink((updater) => logEntries.value = updater(logEntries.value));
        setMonitorStateSink((s) => mon.value = s);
        mon.value = getMonitorState();
        initTransfer();
        offAutoOpen = onTransferAutoOpen(() => transferOpen.value = true);
        addLog("脚本已启动，版本 v" + (VERSION || "?"), "success");
        const wh = allvalue.value.workingHours || runtime.workingHours;
        if (wh) {
          addLog(
            "监控时间段：上午 " + hoursToHHmm(wh.morningStart) + "-" + hoursToHHmm(wh.morningEnd) + "，下午 " + hoursToHHmm(wh.afternoonStart) + "-" + hoursToHHmm(wh.afternoonEnd),
            "info"
          );
        }
        addLog("语音播报：" + (runtime.voiceEnabled ? "已开启" : "已静音"), "info");
      });
      vue.onBeforeUnmount(() => {
        setLogEntriesSink(null);
        setMonitorStateSink(null);
        offAutoOpen == null ? void 0 : offAutoOpen();
        offAutoOpen = null;
        stopTransfer();
      });
      return (_ctx, _cache) => {
        var _a;
        return collapsed.value ? (vue.openBlock(), vue.createElementBlock("button", {
          key: 0,
          type: "button",
          title: "拖动可移动位置，点击展开面板",
          class: "btn btn-primary btn-circle size-9 cursor-move touch-none select-none overflow-hidden p-0",
          onPointerdown: _cache[1] || (_cache[1] =
(...args) => vue.unref(drag).onPointerDown && vue.unref(drag).onPointerDown(...args)),
          onPointermove: _cache[2] || (_cache[2] =
(...args) => vue.unref(drag).onPointerMove && vue.unref(drag).onPointerMove(...args)),
          onPointerup: _cache[3] || (_cache[3] =
(...args) => vue.unref(drag).onPointerUp && vue.unref(drag).onPointerUp(...args)),
          onPointercancel: _cache[4] || (_cache[4] =
(...args) => vue.unref(drag).onPointerCancel && vue.unref(drag).onPointerCancel(...args)),
          onClick: _cache[5] || (_cache[5] = ($event) => vue.unref(drag).consumeDrag() || (collapsed.value = false))
        }, [
          !brandFailed.value ? (vue.openBlock(), vue.createElementBlock("img", {
            key: 0,
            src: BRAND_ICON,
            alt: "",
            draggable: "false",
            class: "block size-5 rounded",
            onError: _cache[0] || (_cache[0] = ($event) => brandFailed.value = true)
          }, null, 32)) : (vue.openBlock(), vue.createBlock(vue.unref(Icon), {
            key: 1,
            name: "crosshair",
            size: 20
          }))
        ], 32)) : (vue.openBlock(), vue.createElementBlock("div", {
          key: 1,
          class: "rounded-box border border-base-300 bg-base-100 text-base-content",
          style: vue.normalizeStyle({ width: vue.unref(PANEL_WIDTH) + "px" })
        }, [
          vue.createElementVNode("div", {
            class: "flex cursor-move touch-none select-none items-center gap-1.5 border-b border-base-300 px-2.5 py-2",
            style: { "min-height": "46px" },
            title: "按住拖动面板",
            onPointerdown: _cache[8] || (_cache[8] =
(...args) => vue.unref(drag).onPointerDown && vue.unref(drag).onPointerDown(...args)),
            onPointermove: _cache[9] || (_cache[9] =
(...args) => vue.unref(drag).onPointerMove && vue.unref(drag).onPointerMove(...args)),
            onPointerup: _cache[10] || (_cache[10] =
(...args) => vue.unref(drag).onPointerUp && vue.unref(drag).onPointerUp(...args)),
            onPointercancel: _cache[11] || (_cache[11] =
(...args) => vue.unref(drag).onPointerCancel && vue.unref(drag).onPointerCancel(...args))
          }, [
            !brandFailed.value ? (vue.openBlock(), vue.createElementBlock("img", {
              key: 0,
              src: BRAND_ICON,
              alt: "",
              draggable: "false",
              class: "block size-[26px] shrink-0 rounded-md",
              onError: _cache[6] || (_cache[6] = ($event) => brandFailed.value = true)
            }, null, 32)) : (vue.openBlock(), vue.createElementBlock("span", _hoisted_1, [
              vue.createVNode(vue.unref(Icon), {
                name: "crosshair",
                size: 16
              })
            ])),
            _cache[27] || (_cache[27] = vue.createElementVNode("span", { class: "min-w-0 truncate text-[15px] font-bold leading-6" }, "征纳互动监控", -1)),
            vue.createElementVNode("span", _hoisted_2, " v" + vue.toDisplayString(vue.unref(VERSION)), 1),
            vue.createElementVNode("div", {
              class: "tooltip tooltip-bottom ml-auto",
              "data-tip": isDark.value ? "切换到日间模式（wireframe）" : "切换到夜间模式（business）"
            }, [
              vue.createElementVNode("button", {
                class: "btn btn-ghost btn-sm btn-square text-base-content/60",
                "aria-label": isDark.value ? "切换到日间模式" : "切换到夜间模式",
                onClick: onToggleTheme
              }, [
                vue.createVNode(vue.unref(Icon), {
                  name: isDark.value ? "sun" : "moon",
                  size: 15
                }, null, 8, ["name"])
              ], 8, _hoisted_4)
            ], 8, _hoisted_3),
            vue.createElementVNode("button", {
              class: "btn btn-ghost btn-sm btn-square text-base-content/60",
              title: "收起面板（点圆形按钮可展开）",
              "aria-label": "收起面板",
              onClick: _cache[7] || (_cache[7] = ($event) => collapsed.value = true)
            }, [
              vue.createVNode(vue.unref(Icon), {
                name: "close",
                size: 16
              })
            ])
          ], 32),
          vue.createElementVNode("div", _hoisted_5, [
            vue.createElementVNode("div", {
              class: vue.normalizeClass(["mb-2.5 flex items-center rounded-box bg-base-200 px-3 py-2 text-[13px]", mon.value.inWorkingHours ? "text-base-content" : "text-base-content/60"])
            }, [
              vue.createElementVNode("span", {
                class: vue.normalizeClass(["mr-1.5 inline-block size-1.5 rounded-full", mon.value.online ? "bg-success" : "bg-error"])
              }, null, 2),
              vue.createTextVNode(" " + vue.toDisplayString(statusText.value), 1)
            ], 2),
            vue.createElementVNode("div", _hoisted_6, [
              vue.createElementVNode("span", _hoisted_7, [
                vue.createElementVNode("span", {
                  class: vue.normalizeClass(voiceEnabled.value ? "text-primary" : "text-base-content/60")
                }, [
                  vue.createVNode(vue.unref(Icon), {
                    name: voiceEnabled.value ? "volumeOn" : "volumeOff",
                    size: 15
                  }, null, 8, ["name"])
                ], 2),
                _cache[28] || (_cache[28] = vue.createTextVNode(" 语音播报 "))
              ]),
              vue.createElementVNode("input", {
                type: "checkbox",
                class: "toggle",
                checked: voiceEnabled.value,
                onChange: _cache[12] || (_cache[12] = ($event) => toggleVoice($event.target.checked))
              }, null, 40, _hoisted_8)
            ]),
            vue.createElementVNode("div", _hoisted_9, [
              (vue.openBlock(), vue.createElementBlock(vue.Fragment, null, vue.renderList(PANEL_ACTIONS, (a) => {
                return vue.createElementVNode("div", {
                  key: a.key,
                  class: "tooltip tooltip-top",
                  "data-tip": a.label
                }, [
                  vue.createElementVNode("button", {
                    class: "btn btn-outline znhd-panel-btn h-10 min-w-0 gap-0.5 px-1",
                    onClick: ($event) => openEntry(a.key)
                  }, [
                    vue.createElementVNode("span", _hoisted_12, [
                      vue.createVNode(vue.unref(Icon), {
                        name: a.icon,
                        size: 15
                      }, null, 8, ["name"])
                    ]),
                    vue.createElementVNode("span", _hoisted_13, vue.toDisplayString(a.label), 1)
                  ], 8, _hoisted_11)
                ], 8, _hoisted_10);
              }), 64))
            ]),
            vue.createElementVNode("div", _hoisted_14, [
              vue.createElementVNode("span", _hoisted_15, vue.toDisplayString(lastSpeakText(mon.value.lastSpeak)), 1),
              vue.createElementVNode("button", {
                class: "btn btn-link btn-xs shrink-0 px-0 text-xs",
                onClick: _cache[13] || (_cache[13] = ($event) => logOpen.value = true)
              }, "查看日志 →")
            ])
          ]),
          vue.createVNode(_sfc_main$j, {
            open: settingsOpen.value,
            "onUpdate:open": _cache[14] || (_cache[14] = ($event) => settingsOpen.value = $event),
            "working-hours": allvalue.value.workingHours,
            "use-cdn": !!allvalue.value.useCdn,
            "sniff-pre-measure": allvalue.value.sniffPreMeasure !== false,
            onChangeWorkingHours: _cache[15] || (_cache[15] = (wh) => {
              patchAllvalue({ workingHours: wh });
              vue.unref(addLog)(
                "监控时间段已更新：上午 " + vue.unref(hoursToHHmm)(wh.morningStart) + "-" + vue.unref(hoursToHHmm)(wh.morningEnd) + "，下午 " + vue.unref(hoursToHHmm)(wh.afternoonStart) + "-" + vue.unref(hoursToHHmm)(wh.afternoonEnd),
                "info"
              );
            }),
            onChangeUseCdn: _cache[16] || (_cache[16] = (v) => {
              patchAllvalue({ useCdn: !!v });
              vue.unref(addLog)("CDN 加速已" + (v ? "开启" : "关闭"), "info");
            }),
            onChangeSniffPreMeasure: _cache[17] || (_cache[17] = (v) => {
              patchAllvalue({ sniffPreMeasure: !!v });
              vue.unref(addLog)("图片嗅探：后台预测量已" + (v ? "开启" : "关闭"), "info");
            }),
            onOpenChangelog: _cache[18] || (_cache[18] = ($event) => changelogOpen.value = true)
          }, null, 8, ["open", "working-hours", "use-cdn", "sniff-pre-measure"]),
          vue.createVNode(_sfc_main$i, {
            open: phrasesOpen.value,
            "onUpdate:open": _cache[19] || (_cache[19] = ($event) => phrasesOpen.value = $event),
            "search-keyword": searchKeyword.value,
            "onUpdate:searchKeyword": _cache[20] || (_cache[20] = ($event) => searchKeyword.value = $event),
            "phrases-data": phrasesData.value,
            "phrases-loading": phrasesLoading.value,
            onReload: loadPhrasesData
          }, null, 8, ["open", "search-keyword", "phrases-data", "phrases-loading"]),
          vue.createVNode(_sfc_main$h, {
            open: logOpen.value,
            "onUpdate:open": _cache[21] || (_cache[21] = ($event) => logOpen.value = $event),
            "log-entries": logEntries.value,
            "auto-refresh": !!allvalue.value.logAutoRefresh,
            onClear: vue.unref(clearLogs),
            "onUpdate:autoRefresh": _cache[22] || (_cache[22] = (v) => patchAllvalue({ logAutoRefresh: v }))
          }, null, 8, ["open", "log-entries", "auto-refresh", "onClear"]),
          vue.createVNode(_sfc_main$g, {
            open: changelogOpen.value,
            "onUpdate:open": _cache[23] || (_cache[23] = ($event) => changelogOpen.value = $event)
          }, null, 8, ["open"]),
          vue.createVNode(_sfc_main$2, {
            open: transferOpen.value,
            "onUpdate:open": _cache[24] || (_cache[24] = ($event) => transferOpen.value = $event)
          }, null, 8, ["open"]),
          vue.createVNode(_sfc_main$d, {
            open: sniffOpen.value,
            "onUpdate:open": _cache[25] || (_cache[25] = ($event) => sniffOpen.value = $event),
            "min-kb": (_a = allvalue.value.sniffMinKB) != null ? _a : 20,
            "onUpdate:minKb": _cache[26] || (_cache[26] = (kb) => {
              patchAllvalue({ sniffMinKB: kb });
              vue.unref(addLog)("图片嗅探：只列出 ≥ " + kb + " KB 的图片", "info");
            })
          }, null, 8, ["open", "min-kb"])
        ], 4));
      };
    }
  });
  const _sfc_main = vue.defineComponent({
    __name: "App",
    props: {
      host: {}
    },
    setup(__props) {
      return (_ctx, _cache) => {
        return vue.openBlock(), vue.createBlock(_sfc_main$1, { host: _ctx.host }, null, 8, ["host"]);
      };
    }
  });
  const css = `@layer properties{@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b)))){*,:before,:after,::backdrop{--tw-translate-x:0;--tw-translate-y:0;--tw-translate-z:0;--tw-rotate-x:initial;--tw-rotate-y:initial;--tw-rotate-z:initial;--tw-skew-x:initial;--tw-skew-y:initial;--tw-border-style:solid;--tw-leading:initial;--tw-font-weight:initial;--tw-tracking:initial;--tw-ordinal:initial;--tw-slashed-zero:initial;--tw-numeric-figure:initial;--tw-numeric-spacing:initial;--tw-numeric-fraction:initial;--tw-shadow:0 0 #0000;--tw-shadow-color:initial;--tw-shadow-alpha:100%;--tw-inset-shadow:0 0 #0000;--tw-inset-shadow-color:initial;--tw-inset-shadow-alpha:100%;--tw-ring-color:initial;--tw-ring-shadow:0 0 #0000;--tw-inset-ring-color:initial;--tw-inset-ring-shadow:0 0 #0000;--tw-ring-inset:initial;--tw-ring-offset-width:0px;--tw-ring-offset-color:#fff;--tw-ring-offset-shadow:0 0 #0000;--tw-outline-style:solid;--tw-blur:initial;--tw-brightness:initial;--tw-contrast:initial;--tw-grayscale:initial;--tw-hue-rotate:initial;--tw-invert:initial;--tw-opacity:initial;--tw-saturate:initial;--tw-sepia:initial;--tw-drop-shadow:initial;--tw-drop-shadow-color:initial;--tw-drop-shadow-alpha:100%;--tw-drop-shadow-size:initial;--tw-backdrop-blur:initial;--tw-backdrop-brightness:initial;--tw-backdrop-contrast:initial;--tw-backdrop-grayscale:initial;--tw-backdrop-hue-rotate:initial;--tw-backdrop-invert:initial;--tw-backdrop-opacity:initial;--tw-backdrop-saturate:initial;--tw-backdrop-sepia:initial;--tw-duration:initial;--tw-ease:initial;--tw-content:"";--tw-scrollbar-thumb:#0000;--tw-scrollbar-track:#0000;--tw-scale-x:1;--tw-scale-y:1;--tw-scale-z:1;--tw-animation-delay:0s;--tw-animation-direction:normal;--tw-animation-duration:initial;--tw-animation-fill-mode:none;--tw-animation-iteration-count:1;--tw-enter-blur:0;--tw-enter-opacity:1;--tw-enter-rotate:0;--tw-enter-scale:1;--tw-enter-translate-x:0;--tw-enter-translate-y:0;--tw-exit-blur:0;--tw-exit-opacity:1;--tw-exit-rotate:0;--tw-exit-scale:1;--tw-exit-translate-x:0;--tw-exit-translate-y:0}}}@layer theme{:root,:host{--font-sans:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";--font-mono:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;--color-black:#000;--color-white:#fff;--spacing:.25rem;--container-sm:24rem;--container-md:28rem;--container-lg:32rem;--text-xs:.75rem;--text-xs--line-height:calc(1 / .75);--text-sm:.875rem;--text-sm--line-height:calc(1.25 / .875);--text-base:1rem;--text-base--line-height: 1.5 ;--text-lg:1.125rem;--text-lg--line-height:calc(1.75 / 1.125);--font-weight-normal:400;--font-weight-medium:500;--font-weight-semibold:600;--font-weight-bold:700;--tracking-tight:-.025em;--tracking-widest:.1em;--leading-snug:1.375;--leading-normal:1.5;--leading-relaxed:1.625;--radius-sm:.25rem;--radius-md:.375rem;--radius-lg:.5rem;--radius-xl:.75rem;--radius-2xl:1rem;--radius-3xl:1.5rem;--radius-4xl:2rem;--ease-out:cubic-bezier(0, 0, .2, 1);--ease-in-out:cubic-bezier(.4, 0, .2, 1);--animate-spin:spin 1s linear infinite;--blur-xs:4px;--default-transition-duration:.15s;--default-transition-timing-function:cubic-bezier(.4, 0, .2, 1);--default-font-family:var(--font-sans);--default-mono-font-family:var(--font-mono)}}@layer base{*,:after,:before,::backdrop{box-sizing:border-box;border:0 solid;margin:0;padding:0}::file-selector-button{box-sizing:border-box;border:0 solid;margin:0;padding:0}html,:host{-webkit-text-size-adjust:100%;tab-size:4;line-height:1.5;font-family:var(--default-font-family,-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji");font-feature-settings:var(--default-font-feature-settings,normal);font-variation-settings:var(--default-font-variation-settings,normal);-webkit-tap-highlight-color:transparent}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;-webkit-text-decoration:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,samp,pre{font-family:var(--default-mono-font-family,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);font-feature-settings:var(--default-mono-font-feature-settings,normal);font-variation-settings:var(--default-mono-font-variation-settings,normal);font-size:1em}small{font-size:80%}sub,sup{vertical-align:baseline;font-size:75%;line-height:0;position:relative}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}:-moz-focusring:where(:not(iframe)){outline:auto}progress{vertical-align:baseline}summary{display:list-item}ol,ul,menu{list-style:none}img,svg,video,canvas,audio,iframe,embed,object{vertical-align:middle;display:block}img,video{max-width:100%;height:auto}button,input,select,optgroup,textarea{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}::file-selector-button{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}:where(select:is([multiple],[size])) optgroup{font-weight:bolder}:where(select:is([multiple],[size])) optgroup option{padding-inline-start:20px}::file-selector-button{margin-inline-end:4px}::placeholder{opacity:1}@supports (not ((-webkit-appearance:-apple-pay-button))) or (contain-intrinsic-size:1px){::placeholder{color:currentColor}@supports (color:color-mix(in lab,red,red)){::placeholder{color:color-mix(in oklab,currentcolor 50%,transparent)}}}textarea{resize:vertical}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-date-and-time-value{min-height:1lh;text-align:inherit}::-webkit-datetime-edit{display:inline-flex}::-webkit-datetime-edit-fields-wrapper{padding:0}::-webkit-datetime-edit{padding-block:0}::-webkit-datetime-edit-year-field{padding-block:0}::-webkit-datetime-edit-month-field{padding-block:0}::-webkit-datetime-edit-day-field{padding-block:0}::-webkit-datetime-edit-hour-field{padding-block:0}::-webkit-datetime-edit-minute-field{padding-block:0}::-webkit-datetime-edit-second-field{padding-block:0}::-webkit-datetime-edit-millisecond-field{padding-block:0}::-webkit-datetime-edit-meridiem-field{padding-block:0}::-webkit-calendar-picker-indicator{line-height:1}:-moz-ui-invalid{box-shadow:none}button,input:where([type=button],[type=reset],[type=submit]){appearance:button}::file-selector-button{appearance:button}::-webkit-inner-spin-button{height:auto}::-webkit-outer-spin-button{height:auto}[hidden]:where(:not([hidden=until-found])){display:none!important}:where(:host),:host:has(input.theme-controller[value=wireframe]:checked),[data-theme=wireframe]{color-scheme:light;--color-base-100:oklch(100% 0 0);--color-base-200:oklch(97% 0 0);--color-base-300:oklch(94% 0 0);--color-base-content:oklch(20% 0 0);--color-primary:oklch(87% 0 0);--color-primary-content:oklch(26% 0 0);--color-secondary:oklch(87% 0 0);--color-secondary-content:oklch(26% 0 0);--color-accent:oklch(87% 0 0);--color-accent-content:oklch(26% 0 0);--color-neutral:oklch(87% 0 0);--color-neutral-content:oklch(26% 0 0);--color-info:oklch(44% .11 240.79);--color-info-content:oklch(90% .058 230.902);--color-success:oklch(43% .095 166.913);--color-success-content:oklch(90% .093 164.15);--color-warning:oklch(47% .137 46.201);--color-warning-content:oklch(92% .12 95.746);--color-error:oklch(44% .177 26.899);--color-error-content:oklch(88% .062 18.334);--radius-selector:0rem;--radius-field:.25rem;--radius-box:.25rem;--size-selector:.25rem;--size-field:.25rem;--border:1px;--depth:0;--noise:0}@media(prefers-color-scheme:dark){:host:not([data-theme]){color-scheme:dark;--color-base-100:oklch(24.353% 0 0);--color-base-200:oklch(22.648% 0 0);--color-base-300:oklch(20.944% 0 0);--color-base-content:oklch(84.87% 0 0);--color-primary:oklch(41.703% .099 251.473);--color-primary-content:oklch(88.34% .019 251.473);--color-secondary:oklch(64.092% .027 229.389);--color-secondary-content:oklch(12.818% .005 229.389);--color-accent:oklch(67.271% .167 35.791);--color-accent-content:oklch(13.454% .033 35.791);--color-neutral:oklch(27.441% .013 253.041);--color-neutral-content:oklch(85.488% .002 253.041);--color-info:oklch(62.616% .143 240.033);--color-info-content:oklch(12.523% .028 240.033);--color-success:oklch(70.226% .094 156.596);--color-success-content:oklch(14.045% .018 156.596);--color-warning:oklch(77.482% .115 81.519);--color-warning-content:oklch(15.496% .023 81.519);--color-error:oklch(51.61% .146 29.674);--color-error-content:oklch(90.322% .029 29.674);--radius-selector:0rem;--radius-field:.25rem;--radius-box:.25rem;--size-selector:.25rem;--size-field:.25rem;--border:1px;--depth:0;--noise:0}}:host:has(input.theme-controller[value=wireframe]:checked),[data-theme=wireframe]{color-scheme:light;--color-base-100:oklch(100% 0 0);--color-base-200:oklch(97% 0 0);--color-base-300:oklch(94% 0 0);--color-base-content:oklch(20% 0 0);--color-primary:oklch(87% 0 0);--color-primary-content:oklch(26% 0 0);--color-secondary:oklch(87% 0 0);--color-secondary-content:oklch(26% 0 0);--color-accent:oklch(87% 0 0);--color-accent-content:oklch(26% 0 0);--color-neutral:oklch(87% 0 0);--color-neutral-content:oklch(26% 0 0);--color-info:oklch(44% .11 240.79);--color-info-content:oklch(90% .058 230.902);--color-success:oklch(43% .095 166.913);--color-success-content:oklch(90% .093 164.15);--color-warning:oklch(47% .137 46.201);--color-warning-content:oklch(92% .12 95.746);--color-error:oklch(44% .177 26.899);--color-error-content:oklch(88% .062 18.334);--radius-selector:0rem;--radius-field:.25rem;--radius-box:.25rem;--size-selector:.25rem;--size-field:.25rem;--border:1px;--depth:0;--noise:0}:host:has(input.theme-controller[value=business]:checked),[data-theme=business]{color-scheme:dark;--color-base-100:oklch(24.353% 0 0);--color-base-200:oklch(22.648% 0 0);--color-base-300:oklch(20.944% 0 0);--color-base-content:oklch(84.87% 0 0);--color-primary:oklch(41.703% .099 251.473);--color-primary-content:oklch(88.34% .019 251.473);--color-secondary:oklch(64.092% .027 229.389);--color-secondary-content:oklch(12.818% .005 229.389);--color-accent:oklch(67.271% .167 35.791);--color-accent-content:oklch(13.454% .033 35.791);--color-neutral:oklch(27.441% .013 253.041);--color-neutral-content:oklch(85.488% .002 253.041);--color-info:oklch(62.616% .143 240.033);--color-info-content:oklch(12.523% .028 240.033);--color-success:oklch(70.226% .094 156.596);--color-success-content:oklch(14.045% .018 156.596);--color-warning:oklch(77.482% .115 81.519);--color-warning-content:oklch(15.496% .023 81.519);--color-error:oklch(51.61% .146 29.674);--color-error-content:oklch(90.322% .029 29.674);--radius-selector:0rem;--radius-field:.25rem;--radius-box:.25rem;--size-selector:.25rem;--size-field:.25rem;--border:1px;--depth:0;--noise:0}:root,[data-theme]{background-color:var(--root-bg);color:var(--color-base-content)}:root{background-color:var(--page-scroll-bg,var(--root-bg))}:where(:root,[data-theme]){--root-bg:var(--color-base-100)}:root{--fx-noise:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Cfilter id='a'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.34' numOctaves='4' stitchTiles='stitch'%3E%3C/feTurbulence%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23a)' opacity='0.2'%3E%3C/rect%3E%3C/svg%3E")}@property --radialprogress{syntax:"<percentage>";inherits:true;initial-value:0%}@property --aura-angle{syntax:"<angle>";inherits:false;initial-value:0deg}:root{scrollbar-color:currentColor #0000}@supports (color:color-mix(in lab,red,red)){:root{scrollbar-color:color-mix(in oklch,currentColor 35%,#0000) #0000}}:root{--page-scroll-lock:initial;--page-overflow:var(--page-scroll-lock) hidden}:root:not(span){overflow:var(--page-overflow)}}@layer components;@layer utilities{@layer daisyui.l1.l2.l3{.range{appearance:none;webkit-appearance:none;--range-thumb:var(--color-base-100);--range-thumb-size:calc(var(--size-selector,.25rem) * 6);--range-progress:currentColor;--range-fill:1;--range-p:.25rem;--range-bg:currentColor}@supports (color:color-mix(in lab,red,red)){.range{--range-bg:color-mix(in oklab, currentColor 10%, #0000)}}.range{--range-fill-x:calc((var(--range-dir,1) * -100cqw) - (var(--range-dir,1) * var(--range-thumb-size) / 2));--range-fill-y:0;--range-fill-spread:calc(100cqw * var(--range-fill));cursor:pointer;vertical-align:middle;--radius-selector-max:calc(var(--radius-selector) + var(--radius-selector) + var(--radius-selector));border-radius:calc(var(--radius-selector) + min(var(--range-p),var(--radius-selector-max)));width:clamp(3rem,20rem,100%);height:var(--range-thumb-size);background-color:#0000;border:none;overflow:hidden;container-type:inline-size}[dir=rtl] .range{--range-dir:-1}.range:focus{outline:none}.range:focus-visible{outline-offset:2px;outline:2px solid}.range::-webkit-slider-runnable-track{background-color:var(--range-bg);border-radius:var(--radius-selector);width:100%;height:calc(var(--range-thumb-size) * .5)}@media(forced-colors:active){.range::-webkit-slider-runnable-track{border:1px solid}.range::-moz-range-track{border:1px solid}}.range::-moz-range-track{background-color:var(--range-bg);border-radius:var(--radius-selector);width:100%;height:calc(var(--range-thumb-size) * .5)}.range::-webkit-slider-thumb{box-sizing:border-box;border-radius:calc(var(--radius-selector) + min(var(--range-p),var(--radius-selector-max)));background-color:var(--range-thumb);height:var(--range-thumb-size);width:var(--range-thumb-size);border:var(--range-p) solid;appearance:none;webkit-appearance:none;color:var(--range-progress);box-shadow:0 -1px oklch(0% 0 0 / calc(var(--depth) * .1)) inset,0 8px 0 -4px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px currentColor,0 0 0 2rem var(--range-thumb) inset,var(--range-fill-x) var(--range-fill-y) 0 var(--range-fill-spread);position:relative;inset-block-start:50%;transform:translateY(-50%)}@supports (color:color-mix(in lab,red,red)){.range::-webkit-slider-thumb{box-shadow:0 -1px oklch(0% 0 0 / calc(var(--depth) * .1)) inset,0 8px 0 -4px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px color-mix(in oklab,currentColor calc(var(--depth) * 10%),#0000),0 0 0 2rem var(--range-thumb) inset,var(--range-fill-x) var(--range-fill-y) 0 var(--range-fill-spread)}}.range::-moz-range-thumb{box-sizing:border-box;border-radius:calc(var(--radius-selector) + min(var(--range-p),var(--radius-selector-max)));height:var(--range-thumb-size);width:var(--range-thumb-size);border:var(--range-p) solid;color:var(--range-progress);box-shadow:0 -1px oklch(0% 0 0 / calc(var(--depth) * .1)) inset,0 8px 0 -4px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px currentColor,0 0 0 2rem var(--range-thumb) inset,var(--range-fill-x) var(--range-fill-y) 0 var(--range-fill-spread);background-color:currentColor;position:relative}@supports (color:color-mix(in lab,red,red)){.range::-moz-range-thumb{box-shadow:0 -1px oklch(0% 0 0 / calc(var(--depth) * .1)) inset,0 8px 0 -4px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px color-mix(in oklab,currentColor calc(var(--depth) * 10%),#0000),0 0 0 2rem var(--range-thumb) inset,var(--range-fill-x) var(--range-fill-y) 0 var(--range-fill-spread)}}.range:disabled{cursor:not-allowed;opacity:.3}.modal{pointer-events:none;visibility:hidden;width:100%;max-width:none;height:100%;max-height:none;color:inherit;transition:overlay .3s allow-discrete,visibility .3s allow-discrete,background-color .3s ease-out,opacity .1s ease-out;overscroll-behavior:contain;z-index:999;scrollbar-gutter:auto;background-color:#0000;place-items:center;margin:0;padding:0;display:grid;position:fixed;inset:0;overflow:clip}.modal::backdrop{display:none}.modal[popover]{color:inherit;background:0 0;border:0;max-width:none;max-height:none;margin:0;padding:0;inset:0}.modal[popover]::backdrop{background-color:#0006;transition:background-color .3s ease-out}:where(.drawer-side){overflow:hidden}.drawer-side{pointer-events:none;visibility:hidden;z-index:10;overscroll-behavior:contain;opacity:0;width:100%;transition:opacity .2s ease-out .1s allow-discrete,visibility .3s ease-out .1s allow-discrete;inset-inline-start:0;background-color:#0000;grid-template-rows:repeat(1,minmax(0,1fr));grid-template-columns:repeat(1,minmax(0,1fr));grid-row-start:1;grid-column-start:1;place-items:flex-start start;height:100dvh;display:grid;position:fixed;top:0}.drawer-side>*{grid-row-start:1;grid-column-start:1}.drawer-side>:not(.drawer-overlay){will-change:transform;transition:translate .3s ease-out,width .2s ease-out;translate:-100%}[dir=rtl] :is(.drawer-side>:not(.drawer-overlay)){translate:100%}:where(.drawer-toggle:checked~.drawer-side){scrollbar-color:currentColor oklch(0 0 0 / calc(var(--page-has-backdrop,0) * .4))}@supports (color:color-mix(in lab,red,red)){:where(.drawer-toggle:checked~.drawer-side){scrollbar-color:color-mix(in oklch,currentColor 35%,#0000) oklch(0 0 0 / calc(var(--page-has-backdrop,0) * .4))}}:where(.drawer-toggle:checked~.drawer-side)>:not(.drawer-overlay){will-change:auto;transform:none}.drawer-open>.drawer-toggle:checked~.drawer-side{scrollbar-color:revert-layer}@media(prefers-reduced-motion:no-preference){.tooltip>.tooltip-content{transition:opacity .2s cubic-bezier(.4,0,.2,1) 75ms,transform .2s cubic-bezier(.4,0,.2,1) 75ms}:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible))>.tooltip-content,:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible))[data-tip]:before,:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible)):after{transition:opacity .2s cubic-bezier(.4,0,.2,1),transform .2s cubic-bezier(.4,0,.2,1)}}.tooltip{--tt-bg:var(--color-neutral);--tt-off: calc(100% + .5rem) ;--tt-radius:min(var(--radius-field), .8rem);--tt-overlap:clamp(1px, calc(var(--radius-field) / 8), 2px);--tt-tail:calc(100% + var(--tt-overlap) + .25rem);--tt-tail-off:max(.5rem, var(--tt-radius));display:inline-block;position:relative}.tooltip>.tooltip-content,.tooltip[data-tip]:before{border-radius:var(--radius-field);text-align:center;white-space:normal;max-width:20rem;color:var(--color-neutral-content);opacity:0;background-color:var(--tt-bg);pointer-events:none;z-index:2;--tw-content:attr(data-tip);content:var(--tw-content);width:max-content;transform:translate(var(--tt-trans,-50%)) translateY(var(--tt-pos,.25rem));inset:auto auto var(--tt-off) 50%;padding-block:.25rem;padding-inline:.5rem;font-size:.875rem;font-weight:400;line-height:1.25;position:absolute}.tooltip:after{opacity:0;background-color:var(--tt-bg);content:"";pointer-events:none;--mask-tooltip:url("data:image/svg+xml,%3Csvg width='10' height='4' viewBox='0 0 8 4' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0.500009 1C3.5 1 3.00001 4 5.00001 4C7 4 6.5 1 9.5 1C10 1 10 0.499897 10 0H0C-1.99338e-08 0.5 0 1 0.500009 1Z' fill='black'/%3E%3C/svg%3E%0A");width:.625rem;height:.25rem;-webkit-mask-position:-1px 0;mask-position:-1px 0;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-image:var(--mask-tooltip);mask-image:var(--mask-tooltip);transform:translate(var(--tt-trans,-50%)) translateY(var(--tt-pos,.25rem));inset:auto auto var(--tt-tail) 50%;display:block;position:absolute}@media(prefers-reduced-motion:no-preference){.tooltip>.tooltip-content,.tooltip[data-tip]:before,.tooltip:after{transition:opacity .2s cubic-bezier(.4,0,.2,1) 75ms,transform .2s cubic-bezier(.4,0,.2,1) 75ms}:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible))>.tooltip-content{transition:opacity .2s cubic-bezier(.4,0,.2,1),transform .2s cubic-bezier(.4,0,.2,1)}}:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible))>.tooltip-content{opacity:1;--tt-pos:0rem}@media(prefers-reduced-motion:no-preference){:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible))>.tooltip-content,:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible))[data-tip]:before{transition:opacity .2s cubic-bezier(.4,0,.2,1),transform .2s cubic-bezier(.4,0,.2,1)}}:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible))[data-tip]:before{opacity:1;--tt-pos:0rem}@media(prefers-reduced-motion:no-preference){:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible))[data-tip]:before,:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible)):after{transition:opacity .2s cubic-bezier(.4,0,.2,1),transform .2s cubic-bezier(.4,0,.2,1)}}:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible)):after{opacity:1;--tt-pos:0rem}@media(prefers-reduced-motion:no-preference){:is(.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))).tooltip-open,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):hover,.tooltip:is([data-tip]:not([data-tip=""]),:has(.tooltip-content:not(:empty))):has(:focus-visible)):after{transition:opacity .2s cubic-bezier(.4,0,.2,1),transform .2s cubic-bezier(.4,0,.2,1)}}.tabs{--tabs-height:auto;--tabs-direction:row;--tab-height:calc(var(--size-field,.25rem) * 10);height:var(--tabs-height);flex-wrap:wrap;flex-direction:var(--tabs-direction);display:flex}.tab:is(.tabs>.tab){cursor:pointer;appearance:none;text-align:center;webkit-user-select:none;-webkit-user-select:none;user-select:none;flex-wrap:wrap;justify-content:center;align-items:center;display:inline-flex;position:relative}@media(hover:hover){.tab:is(.tabs>.tab):hover{color:var(--color-base-content)}}.tab:is(.tabs>.tab){--tab-p:.75rem;--tab-bg:var(--color-base-100);--tab-border-color:var(--color-base-300);--tab-radius-ss:0;--tab-radius-se:0;--tab-radius-es:0;--tab-radius-ee:0;--tab-order:0;--tab-radius-min:calc(.75rem - var(--border));--tab-radius-limit:min(var(--radius-field), var(--tab-radius-min));--tab-radius-grad:#0000 calc(69% - var(--border)), var(--tab-border-color) calc(69% - var(--border) + .25px), var(--tab-border-color) 69%, var(--tab-bg) calc(69% + .25px) ;order:var(--tab-order);height:var(--tab-height);padding-inline:var(--tab-p);border-color:#0000;font-size:.875rem}.tab:is(.tabs>.tab):is(input[type=radio]){min-width:fit-content}.tab:is(.tabs>.tab):is(input[type=radio]):after{--tw-content:attr(aria-label);content:var(--tw-content)}.tab:is(.tabs>.tab):is(label){position:relative}.tab:is(.tabs>.tab):is(label) input{cursor:pointer;appearance:none;opacity:0;position:absolute;inset:0}:is(.tab:is(.tabs>.tab):checked,.tab:is(.tabs>.tab):is(label:has(:checked)),.tab:is(.tabs>.tab):is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]))+.tab-content{display:block}.tab:is(.tabs>.tab):not(:checked,label:has(:checked),:hover,.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]){color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.tab:is(.tabs>.tab):not(:checked,label:has(:checked),:hover,.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]){color:color-mix(in oklab,var(--color-base-content) 50%,transparent)}}.tab:is(.tabs>.tab):not(input):empty{cursor:default;flex-grow:1}.tab:is(.tabs>.tab):focus{--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.tab:is(.tabs>.tab):focus{outline-offset:2px;outline:2px solid #0000}}.tab:is(.tabs>.tab):focus-visible,.tab:is(.tabs>.tab):is(label:has(:checked:focus-visible)){outline-offset:-5px;outline:2px solid}.tab:is(.tabs>.tab)[disabled]{pointer-events:none;opacity:.4}.menu{--menu-active-fg:var(--color-neutral-content);--menu-active-bg:var(--color-neutral);flex-flow:column wrap;width:fit-content;padding:.5rem;font-size:.875rem;display:flex}.menu :where(li ul,li menu){white-space:nowrap;margin-inline-start:1rem;padding-inline-start:.5rem;position:relative}.menu :where(li ul,li menu):before{background-color:var(--color-base-content);opacity:.1;width:var(--border);content:"";inset-inline-start:0;position:absolute;top:.75rem;bottom:.75rem}.menu :where(li>.menu-dropdown:not(.menu-dropdown-show)){display:none}.menu :where(li:not(.menu-title)>:not(ul,menu,details,.menu-title,.btn)),.menu :where(li:not(.menu-title)>details>summary:not(.menu-title)){border-radius:var(--radius-field);text-align:start;-webkit-user-select:none;user-select:none;grid-auto-columns:minmax(auto,max-content) auto max-content;grid-auto-flow:column;align-content:flex-start;align-items:center;gap:.5rem;padding-block:.375rem;padding-inline:.75rem;transition-property:color,background-color,box-shadow;transition-duration:.2s;transition-timing-function:cubic-bezier(0,0,.2,1);display:grid}.menu :where(li>details>summary){--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.menu :where(li>details>summary){outline-offset:2px;outline:2px solid #0000}}.menu :where(li>details>summary)::-webkit-details-marker{display:none}:is(.menu :where(li>details>summary),.menu :where(li>.menu-dropdown-toggle)):after{content:"";transform-origin:50%;pointer-events:none;justify-self:flex-end;width:.375rem;height:.375rem;transition-property:rotate,translate;transition-duration:.2s;display:block;translate:0 -1px;rotate:-135deg;box-shadow:inset 2px 2px}.menu details{interpolate-size:allow-keywords;overflow:hidden}.menu details::details-content{block-size:0}@media(prefers-reduced-motion:no-preference){.menu details::details-content{transition-behavior:allow-discrete;transition-property:block-size,content-visibility;transition-duration:.2s;transition-timing-function:cubic-bezier(0,0,.2,1)}}.menu details[open]::details-content{block-size:auto}.menu :where(li>details[open]>summary):after,.menu :where(li>.menu-dropdown-toggle.menu-dropdown-show):after{translate:0 1px;rotate:45deg}.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title),li:not(.menu-title,.disabled)>details>summary:not(.menu-title)):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):focus-visible{cursor:pointer;background-color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title),li:not(.menu-title,.disabled)>details>summary:not(.menu-title)):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):focus-visible{background-color:color-mix(in oklab,var(--color-base-content) 10%,transparent)}}.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title),li:not(.menu-title,.disabled)>details>summary:not(.menu-title)):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):focus-visible{color:var(--color-base-content);--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title),li:not(.menu-title,.disabled)>details>summary:not(.menu-title)):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):focus-visible{outline-offset:2px;outline:2px solid #0000}}.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):hover,li:not(.menu-title,.disabled)>details>summary:not(.menu-title):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):hover){cursor:pointer;background-color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):hover,li:not(.menu-title,.disabled)>details>summary:not(.menu-title):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):hover){background-color:color-mix(in oklab,var(--color-base-content) 10%,transparent)}}.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):hover,li:not(.menu-title,.disabled)>details>summary:not(.menu-title):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):hover){--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):hover,li:not(.menu-title,.disabled)>details>summary:not(.menu-title):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):hover){outline-offset:2px;outline:2px solid #0000}}.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):hover,li:not(.menu-title,.disabled)>details>summary:not(.menu-title):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])):hover){box-shadow:inset 0 1px #00000003,inset 0 -1px #ffffff03}.menu :where(li:empty){background-color:var(--color-base-content);opacity:.1;height:1px;margin:.5rem 1rem}.menu :where(li){flex-flow:column wrap;flex-shrink:0;align-items:stretch;display:flex;position:relative}.menu :where(li) .badge{justify-self:flex-end}.menu :where(li)>:not(ul,menu,.menu-title,details,.btn):active,.menu :where(li)>:not(ul,menu,.menu-title,details,.btn).menu-active,.menu :where(li)>:not(ul,menu,.menu-title,details,.btn)[aria-current]:not([aria-current=false],[aria-current=""]),.menu :where(li)>details>summary:active{--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.menu :where(li)>:not(ul,menu,.menu-title,details,.btn):active,.menu :where(li)>:not(ul,menu,.menu-title,details,.btn).menu-active,.menu :where(li)>:not(ul,menu,.menu-title,details,.btn)[aria-current]:not([aria-current=false],[aria-current=""]),.menu :where(li)>details>summary:active{outline-offset:2px;outline:2px solid #0000}}.menu :where(li)>:not(ul,menu,.menu-title,details,.btn):active,.menu :where(li)>:not(ul,menu,.menu-title,details,.btn).menu-active,.menu :where(li)>:not(ul,menu,.menu-title,details,.btn)[aria-current]:not([aria-current=false],[aria-current=""]),.menu :where(li)>details>summary:active{color:var(--menu-active-fg);background-color:var(--menu-active-bg);background-size:auto,calc(var(--noise) * 100%);background-image:none,var(--fx-noise)}:is(.menu :where(li)>:not(ul,menu,.menu-title,details,.btn):active,.menu :where(li)>:not(ul,menu,.menu-title,details,.btn).menu-active,.menu :where(li)>:not(ul,menu,.menu-title,details,.btn)[aria-current]:not([aria-current=false],[aria-current=""]),.menu :where(li)>details>summary:active):not(:is(.menu :where(li)>:not(ul,menu,.menu-title,details,.btn):active,.menu :where(li)>:not(ul,menu,.menu-title,details,.btn).menu-active,.menu :where(li)>:not(ul,menu,.menu-title,details,.btn)[aria-current]:not([aria-current=false],[aria-current=""]),.menu :where(li)>details>summary:active):active){box-shadow:0 2px calc(var(--depth) * 3px) -2px var(--menu-active-bg)}.menu :where(li).menu-disabled,.menu :where(li) [disabled]{pointer-events:none;color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.menu :where(li).menu-disabled,.menu :where(li) [disabled]{color:color-mix(in oklab,var(--color-base-content) 20%,transparent)}}.collapse-title{grid-row-start:1;grid-column-start:1;width:100%;min-height:1lh;padding:1rem;padding-inline-end:3rem;transition:background-color .2s ease-out;position:relative}.dropdown{position-area:var(--anchor-v,block-end) var(--anchor-h,span-inline-end);display:inline-block;position:relative}.dropdown>:not(:has(~[class*=dropdown-content])):focus{--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.dropdown>:not(:has(~[class*=dropdown-content])):focus{outline-offset:2px;outline:2px solid #0000}}.dropdown[popover]{z-index:999}@media(prefers-reduced-motion:no-preference){.dropdown[popover]{transition-behavior:allow-discrete;transition-property:opacity,scale,display,overlay;transition-duration:.2s;transition-timing-function:cubic-bezier(.4,0,.2,1);animation:.2s dropdown}}@starting-style{.dropdown[popover]{opacity:0;scale:.95}}:is(.dropdown:not(.dropdown-close).dropdown-open,.dropdown:not(.dropdown-close):not(.dropdown-hover):focus,.dropdown:not(.dropdown-close):focus-within)>[tabindex]:first-child{pointer-events:none}.dropdown:is(details){overflow:revert-layer}.dropdown:is(details) summary::-webkit-details-marker{display:none}.dropdown:where([popover]){background:0 0}.dropdown[popover]{color:inherit;position:fixed}@supports not (position-area:bottom){.dropdown[popover]{margin:auto}.dropdown[popover].dropdown-close{transform-origin:top;opacity:0;display:none;scale:.95}.dropdown[popover].dropdown-open:not(:popover-open){transform-origin:top;opacity:0;display:none;scale:.95}.dropdown[popover]::backdrop{background-color:oklab(0% none none/.3)}}:is(.dropdown[popover].dropdown-close,.dropdown[popover]:not(.dropdown-open,:popover-open)){transform-origin:top;opacity:0;display:none;scale:.95}:where(.btn){width:unset}.btn{--size:calc(var(--size-field,.25rem) * 10);--btn-p:1rem;--btn-fg:var(--color-base-content);cursor:pointer;text-align:center;vertical-align:middle;outline-offset:2px;webkit-user-select:none;-webkit-user-select:none;user-select:none;border-width:var(--border);touch-action:manipulation;--btn-bg:var(--btn-color,var(--color-base-200));--btn-border:var(--btn-color,var(--color-base-200));border-start-start-radius:var(--join-ss,var(--radius-field));border-start-end-radius:var(--join-se,var(--radius-field));border-end-end-radius:var(--join-ee,var(--radius-field));border-end-start-radius:var(--join-es,var(--radius-field));flex-wrap:nowrap;flex-shrink:0;justify-content:center;align-items:center;gap:.375rem;font-weight:600;transition-property:color,background-color,border-color,box-shadow,transform;transition-duration:.2s;transition-timing-function:cubic-bezier(0,0,.2,1);display:inline-flex}@supports (color:color-mix(in lab,red,red)){.btn{--btn-border:color-mix(in oklab, var(--btn-color,var(--color-base-200)), #000 calc(var(--depth) * 5%))}}.btn{--btn-soft-bg:initial;--btn-shadow:0 3px 2px -2px var(--btn-bg), 0 4px 3px -2px var(--btn-bg)}@supports (color:color-mix(in lab,red,red)){.btn{--btn-shadow:0 3px 2px -2px color-mix(in oklab, var(--btn-bg) calc(var(--depth) * 30%), #0000), 0 4px 3px -2px color-mix(in oklab, var(--btn-bg) calc(var(--depth) * 30%), #0000)}}.btn{--btn-inset:0 .5px 0 .5px oklch(100% 0 0 / calc(var(--depth) * 6%));height:var(--size);padding-inline:var(--btn-p);font-size:var(--fontsize,.875rem);background-color:var(--btn-bg);color:var(--btn-fg);border-color:var(--btn-border);border-style:var(--btn-border-style,solid);outline-color:var(--btn-color,var(--color-base-content));--tw-prose-links:var(--btn-fg);background-image:none,var(--fx-noise);background-size:auto,calc(var(--noise,0) * 100%);text-shadow:0 .5px oklch(100% 0 0 / calc(var(--depth) * .15));box-shadow:var(--btn-inset) inset,var(--btn-shadow)}.btn:is([type=checkbox],[type=radio]){appearance:none}.btn:is([type=checkbox],[type=radio])[aria-label]:after{--tw-content:attr(aria-label);content:var(--tw-content)}.btn:where(:checked:not(.filter [type=radio].btn)){--btn-color:var(--color-primary);--btn-fg:var(--color-primary-content)}.loading{pointer-events:none;aspect-ratio:1;vertical-align:middle;width:calc(var(--size-selector,.25rem) * 6);background-color:currentColor;flex-shrink:0;display:inline-block;-webkit-mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='8s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='8s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E");-webkit-mask-position:50%;mask-position:50%;-webkit-mask-size:100%;mask-size:100%;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}@media(forced-colors:active){.loading{background-color:canvastext}}@media(prefers-reduced-motion:no-preference){.loading{-webkit-mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='2s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='2s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E")}}.loading\\!{pointer-events:none!important;aspect-ratio:1!important;vertical-align:middle!important;width:calc(var(--size-selector,.25rem) * 6)!important;background-color:currentColor!important;flex-shrink:0!important;display:inline-block!important;-webkit-mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='8s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E")!important;mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='8s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E")!important;-webkit-mask-position:50%!important;mask-position:50%!important;-webkit-mask-size:100%!important;mask-size:100%!important;-webkit-mask-repeat:no-repeat!important;mask-repeat:no-repeat!important}@media(forced-colors:active){.loading\\!{background-color:canvastext!important}}@media(prefers-reduced-motion:no-preference){.loading\\!{-webkit-mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='2s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E")!important;mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='2s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E")!important}}.filter{flex-wrap:wrap;display:flex}.filter [type=radio]{width:auto}.filter input{opacity:1;transition:visibility .1s allow-discrete,margin .1s,opacity .3s,padding .3s,border-width .1s;overflow:hidden;scale:1}.filter input.filter-reset{aspect-ratio:1}.filter input.filter-reset:after{--tw-content:"×";content:var(--tw-content)}.filter>input:not(:last-child),.filter>:not(:last-child) input{margin-inline-end:.25rem}.validator-hint{visibility:hidden;margin-top:.5rem;font-size:.75rem}.list{flex-direction:column;font-size:.875rem;display:flex}.list .list-row{--list-grid-cols:minmax(0, auto) 1fr;border-radius:var(--radius-box);word-break:break-word;grid-auto-flow:column;grid-template-columns:var(--list-grid-cols);gap:1rem;padding:1rem;display:grid;position:relative}:is(.list>:not(:last-child).list-row,.list>:not(:last-child) .list-row):after{content:"";border-bottom:var(--border) solid;inset-inline:var(--radius-box);border-color:var(--color-base-content);position:absolute;bottom:0}@supports (color:color-mix(in lab,red,red)){:is(.list>:not(:last-child).list-row,.list>:not(:last-child) .list-row):after{border-color:color-mix(in oklab,var(--color-base-content) 5%,transparent)}}.dropdown .dropdown-content{position:absolute}.dropdown.dropdown-close .dropdown-content,.dropdown:not(details,.dropdown-open,.dropdown-hover:hover,:focus-within) .dropdown-content,.dropdown.dropdown-hover:not(:hover) [tabindex]:first-child:focus:not(:focus-visible)~.dropdown-content{transform-origin:top;opacity:0;display:none;scale:.95}.dropdown .dropdown-content{z-index:999}@media(prefers-reduced-motion:no-preference){.dropdown .dropdown-content{transition-behavior:allow-discrete;transition-property:opacity,scale,display,overlay;transition-duration:.2s;transition-timing-function:cubic-bezier(.4,0,.2,1);animation:.2s dropdown}}@starting-style{.dropdown .dropdown-content{opacity:0;scale:.95}}:is(.dropdown:not(.dropdown-close).dropdown-open,.dropdown:not(.dropdown-close):not(.dropdown-hover):focus,.dropdown:not(.dropdown-close):focus-within) .dropdown-content,.dropdown:not(.dropdown-close).dropdown-hover:hover .dropdown-content{opacity:1;scale:1}.toast{translate:var(--toast-x,0) var(--toast-y,0);inset-inline:auto 1rem;background-color:#0000;flex-direction:column;gap:.5rem;width:max-content;max-width:calc(100vw - 2rem);display:flex;position:fixed;top:auto;bottom:1rem}@media(prefers-reduced-motion:no-preference){.toast>*{animation:.25s ease-out toast}}.chat-bubble{border-radius:var(--radius-field);background-color:var(--color-base-300);width:fit-content;color:var(--color-base-content);grid-row-end:3;min-width:2.5rem;max-width:90%;min-height:2rem;padding-block:.5rem;padding-inline:1rem;display:block;position:relative}.chat-bubble:before{background-color:inherit;content:"";width:.75rem;height:.75rem;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-image:var(--mask-chat);mask-image:var(--mask-chat);position:absolute;bottom:0;-webkit-mask-position:0 -1px;mask-position:0 -1px;-webkit-mask-size:.8125rem;mask-size:.8125rem}.toggle{border:var(--border) solid currentColor;color:var(--input-color);cursor:pointer;appearance:none;vertical-align:middle;webkit-user-select:none;-webkit-user-select:none;user-select:none;--radius-selector-max:calc(var(--radius-selector) + var(--radius-selector) + var(--radius-selector));border-radius:calc(var(--radius-selector) + min(var(--toggle-p),var(--radius-selector-max)) + min(var(--border),var(--radius-selector-max)));padding:var(--toggle-p);flex-shrink:0;grid-template-columns:0fr 1fr 1fr;place-content:center;display:inline-grid;position:relative;box-shadow:inset 0 1px}@supports (color:color-mix(in lab,red,red)){.toggle{box-shadow:0 1px color-mix(in oklab,currentColor calc(var(--depth) * 10%),#0000) inset}}.toggle{--input-color:var(--color-base-content);transition:color .3s,grid-template-columns .2s}@supports (color:color-mix(in lab,red,red)){.toggle{--input-color:color-mix(in oklab, var(--color-base-content) 50%, #0000)}}.toggle{--toggle-p:calc(var(--size) * .125);--size:calc(var(--size-selector,.25rem) * 6);width:calc((var(--size) * 2) - (var(--border) + var(--toggle-p)) * 2);height:var(--size)}.toggle>*{z-index:1;cursor:pointer;appearance:none;background-color:#0000;border:none;grid-column:2/span 1;grid-row-start:1;height:100%;padding:.125rem;transition:opacity .2s,rotate .4s}.toggle>:focus{--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.toggle>:focus{outline-offset:2px;outline:2px solid #0000}}.toggle>:nth-child(2){color:var(--color-base-100);rotate:0deg}.toggle>:nth-child(3){color:var(--color-base-100);opacity:0;rotate:-15deg}.toggle:has(:checked)>:nth-child(2){opacity:0;rotate:15deg}.toggle:has(:checked)>:nth-child(3){opacity:1;rotate:0deg}.toggle:before{aspect-ratio:1;border-radius:var(--radius-selector);--tw-content:"";content:var(--tw-content);width:100%;height:100%;box-shadow:0 -1px oklch(0% 0 0 / calc(var(--depth) * .1)) inset,0 8px 0 -4px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px currentColor;background-color:currentColor;grid-row-start:1;grid-column-start:2;transition:background-color .1s,translate .2s,inset-inline-start .2s;position:relative;inset-inline-start:0;translate:0}@supports (color:color-mix(in lab,red,red)){.toggle:before{box-shadow:0 -1px oklch(0% 0 0 / calc(var(--depth) * .1)) inset,0 8px 0 -4px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px color-mix(in oklab,currentColor calc(var(--depth) * 10%),#0000)}}.toggle:before{background-size:auto,calc(var(--noise) * 100%);background-image:none,var(--fx-noise)}@media(forced-colors:active){.toggle:before{outline-style:var(--tw-outline-style);outline-offset:-1px;outline-width:1px}}@media print{.toggle:before{outline-offset:-1rem;outline:.25rem solid}}.toggle:focus-visible,.toggle:has(:focus-visible){outline-offset:2px;outline:2px solid}.toggle:checked{background-color:var(--color-base-100);--input-color:var(--color-base-content);grid-template-columns:1fr 1fr 0fr}.toggle:checked:before{background-color:currentColor}@starting-style{.toggle:checked:before{opacity:0}}.toggle[aria-checked=true]{background-color:var(--color-base-100);--input-color:var(--color-base-content);grid-template-columns:1fr 1fr 0fr}.toggle[aria-checked=true]:before{background-color:currentColor}@starting-style{.toggle[aria-checked=true]:before{opacity:0}}.toggle:has(>input:checked){background-color:var(--color-base-100);--input-color:var(--color-base-content);grid-template-columns:1fr 1fr 0fr}.toggle:has(>input:checked):before{background-color:currentColor}@starting-style{.toggle:has(>input:checked):before{opacity:0}}.toggle:indeterminate{grid-template-columns:.5fr 1fr .5fr}.toggle:disabled{cursor:not-allowed;opacity:.3}.toggle:disabled:before{border:var(--border) solid currentColor;background-color:#0000}.input{appearance:none;background-color:var(--color-base-100);vertical-align:middle;white-space:nowrap;--size:calc(var(--size-field,.25rem) * var(--in-size-mul,10));--input-color:var(--color-base-content);flex-shrink:1;align-items:center;gap:.5rem;padding-inline:.75rem;display:inline-flex;position:relative}@supports (color:color-mix(in lab,red,red)){.input{--input-color:color-mix(in oklab, var(--color-base-content) 20%, #0000)}}.input{cursor:text;width:clamp(3rem,20rem,100%);height:var(--size);font-size:max(var(--font-size,0rem),var(--font-size-min,.875rem));touch-action:manipulation;border:var(--border) solid var(--input-color,#0000);box-shadow:0 1px var(--input-color) inset,0 -1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset;border-start-start-radius:var(--join-ss,var(--radius-field));border-start-end-radius:var(--join-se,var(--radius-field));border-end-end-radius:var(--join-ee,var(--radius-field));border-end-start-radius:var(--join-es,var(--radius-field))}@supports (color:color-mix(in lab,red,red)){.input{box-shadow:0 1px color-mix(in oklab,var(--input-color) calc(var(--depth) * 10%),#0000) inset,0 -1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset}}.input input{appearance:none;background-color:#0000;border:none;width:100%;height:100%}.input input::placeholder{color:var(--color-base-content);opacity:.5}.input input:focus,.input input:focus-within{--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.input input:focus,.input input:focus-within{outline-offset:2px;outline:2px solid #0000}}.input input::-webkit-calendar-picker-indicator{inset-inline-end:-.15em}.input::-webkit-inner-spin-button{margin-inline-end:-10px}.input::-webkit-calendar-picker-indicator{inset-inline-end:.75em}input.input{text-align:start;display:inline-flex;position:relative}input.input[type=url],input.input[type=tel],input.input[type=email],input.input[type=number]{direction:ltr}input.input::-webkit-datetime-edit{min-height:100%;text-align:inherit;align-items:center;display:grid}input.input::-webkit-date-and-time-value{min-height:100%;text-align:inherit;align-items:center;display:grid}input.input::-webkit-inner-spin-button{margin-block:calc(.25rem * var(--spin-my,-3))}input.input::-webkit-calendar-picker-indicator{cursor:pointer;width:1em;height:1em;position:absolute}input.input::-webkit-color-swatch-wrapper{padding-block:.25rem}.input input{text-align:start;display:inline-flex;position:relative}.input input[type=url],.input input[type=tel],.input input[type=email],.input input[type=number]{direction:ltr}.input input::-webkit-datetime-edit{min-height:100%;text-align:inherit;align-items:center;display:grid}.input input::-webkit-date-and-time-value{min-height:100%;text-align:inherit;align-items:center;display:grid}.input input::-webkit-inner-spin-button{margin-block:calc(.25rem * var(--spin-my,-3))}.input input::-webkit-calendar-picker-indicator{cursor:pointer;width:1em;height:1em;position:absolute}.input input::-webkit-color-swatch-wrapper{padding-block:.25rem}.input:focus{--input-color:var(--color-base-content);box-shadow:0 1px var(--input-color)}@supports (color:color-mix(in lab,red,red)){.input:focus{box-shadow:0 1px color-mix(in oklab,var(--input-color) calc(var(--depth) * 10%),#0000)}}.input:focus{outline:2px solid var(--input-color);outline-offset:2px}@media(pointer:coarse){@supports (-webkit-touch-callout:none){.input:focus{--font-size:1rem}}}.input:focus-within{--input-color:var(--color-base-content);box-shadow:0 1px var(--input-color)}@supports (color:color-mix(in lab,red,red)){.input:focus-within{box-shadow:0 1px color-mix(in oklab,var(--input-color) calc(var(--depth) * 10%),#0000)}}.input:focus-within{outline:2px solid var(--input-color);outline-offset:2px}@media(pointer:coarse){@supports (-webkit-touch-callout:none){.input:focus-within{--font-size:1rem}}}.table{border-collapse:separate;--tw-border-spacing-x:0px;--tw-border-spacing-y:0px;width:100%;border-spacing:var(--tw-border-spacing-x) var(--tw-border-spacing-y);border-radius:var(--radius-box);text-align:left;font-size:.875rem;position:relative}.table:where(:dir(rtl),[dir=rtl],[dir=rtl] *){text-align:right}@media(hover:hover){:is(:is(.table tr.row-hover),.table tr.row-hover:nth-child(2n)):hover{background-color:var(--color-base-200)}}.table :where(th,td){vertical-align:middle;padding-block:.75rem;padding-inline:1rem}.table :where(thead,tfoot){white-space:nowrap;color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.table :where(thead,tfoot){color:color-mix(in oklab,var(--color-base-content) 60%,transparent)}}.table :where(thead,tfoot){font-size:.875rem;font-weight:600}.table :where(tfoot tr:first-child :is(td,th)){border-top:var(--border) solid var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.table :where(tfoot tr:first-child :is(td,th)){border-top:var(--border) solid color-mix(in oklch,var(--color-base-content) 5%,#0000)}}.table :where(thead tr :is(td,th),tbody tr:not(:last-child) :is(td,th)){border-bottom:var(--border) solid var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.table :where(thead tr :is(td,th),tbody tr:not(:last-child) :is(td,th)){border-bottom:var(--border) solid color-mix(in oklch,var(--color-base-content) 5%,#0000)}}.table :where(.table-pin-rows thead){z-index:1;position:sticky;top:0}.table :where(.table-pin-rows tfoot){z-index:1;position:sticky;bottom:0}.table :where(.table-pin-rows :is(thead,tfoot) tr){background-color:var(--color-base-100)}.aura{--aura-padding:.125rem;padding:var(--aura-padding);border-radius:calc(var(--aura-padding) + var(--aura-radius,var(--radius-box)));animation:aura var(--tw-duration,6s) linear infinite;background-image:conic-gradient(from var(--aura-angle),transparent 225deg,currentColor);display:inline-block;position:relative}@media(prefers-reduced-motion:reduce){.aura{animation-duration:calc(var(--tw-duration,6s) * 4)}}.aura:before{animation:inherit;background-color:inherit;background-image:inherit;border-radius:inherit;z-index:0;opacity:.7;filter:blur(.25rem);content:"";width:100%;height:100%;display:block;position:absolute;top:50%;left:50%;translate:-50% -50%}.aura:after{animation:inherit;background-color:inherit;background-image:inherit;border-radius:inherit;z-index:0;opacity:.7;filter:blur(1rem);content:"";opacity:.3;width:100%;height:100%;display:block;position:absolute;top:50%;left:50%;translate:-50% -50%}.aura>*{z-index:1;position:relative}.steps{counter-reset:step;grid-auto-columns:1fr;grid-auto-flow:column;display:inline-grid;overflow:auto hidden}.steps .step{text-align:center;--step-bg:var(--color-base-300);--step-fg:var(--color-base-content);grid-template-rows:40px 1fr;grid-template-columns:auto;place-items:center;min-width:4rem;display:grid}.steps .step:before{width:100%;height:.5rem;color:var(--step-bg);background-color:var(--step-bg);content:"";border:1px solid;grid-row-start:1;grid-column-start:1;margin-inline-start:-100%;top:0}.steps .step>.step-icon,.steps .step:not(:has(.step-icon)):after{--tw-content:counter(step);content:var(--tw-content);counter-increment:step;z-index:1;color:var(--step-fg);background-color:var(--step-bg);border:1px solid var(--step-bg);border-radius:3.40282e38px;grid-row-start:1;grid-column-start:1;place-self:center;place-items:center;width:2rem;height:2rem;display:grid;position:relative}.steps .step:first-child:before{--tw-content:none;content:var(--tw-content)}.steps .step[data-content]:after{--tw-content:attr(data-content);content:var(--tw-content)}.drawer-side>.drawer-overlay{cursor:pointer;background-color:#0006;place-self:stretch stretch;position:sticky;top:0}.table :where(.table-pin-cols tr th){background-color:var(--color-base-100);position:sticky;left:0;right:0}.diff-resizer{isolation:isolate;z-index:2;resize:horizontal;opacity:0;cursor:ew-resize;transform-origin:100% 100%;clip-path:inset(calc(100% - .75rem) 0 0 calc(100% - .75rem));grid-row-start:2;grid-column-start:1;width:50cqi;min-width:1rem;max-width:calc(100cqi - 1rem);height:.75rem;transition:min-width .3s ease-out,max-width .3s ease-out;position:relative;overflow:hidden;transform:scaleY(5)translate(.32rem,50%)}.select{appearance:none;background-color:var(--color-base-100);vertical-align:middle;--size:calc(var(--size-field,.25rem) * var(--sl-size-mul,10));--input-color:var(--color-base-content);flex-shrink:1;align-items:center;gap:.375rem;padding-inline:.75rem 1.75rem;display:inline-flex;position:relative}@supports (color:color-mix(in lab,red,red)){.select{--input-color:color-mix(in oklab, var(--color-base-content) 20%, #0000)}}.select{width:clamp(3rem,20rem,100%);height:var(--size);font-size:max(var(--font-size,0rem),var(--font-size-min,.875rem));touch-action:manipulation;white-space:nowrap;text-overflow:ellipsis;border:var(--border) solid var(--input-color,#0000);box-shadow:0 1px var(--input-color) inset,0 -1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset;background-image:linear-gradient(45deg,#0000 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,#0000 50%);background-position:calc(100% - 20px) calc(1px + 50%),calc(100% - 16.1px) calc(1px + 50%);background-repeat:no-repeat;background-size:4px 4px,4px 4px;border-start-start-radius:var(--join-ss,var(--radius-field));border-start-end-radius:var(--join-se,var(--radius-field));border-end-end-radius:var(--join-ee,var(--radius-field));border-end-start-radius:var(--join-es,var(--radius-field));overflow:hidden}@supports (color:color-mix(in lab,red,red)){.select{box-shadow:0 1px color-mix(in oklab,var(--input-color) calc(var(--depth) * 10%),#0000) inset,0 -1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset}}[dir=rtl] .select{background-position:12px calc(1px + 50%),16px calc(1px + 50%)}.select[multiple]{background-image:none;height:auto;padding-block:.75rem;padding-inline-end:.75rem;overflow:auto}.select select{appearance:none;width:calc(100% + 2.75rem);height:calc(100% - calc(var(--border) * 2));background:inherit;border-radius:inherit;border-style:none;align-items:center;margin-inline:-.75rem -1.75rem;padding-inline:.75rem 1.75rem}.select select::placeholder{color:var(--color-base-content);opacity:.5}.select select:focus,.select select:focus-within{--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.select select:focus,.select select:focus-within{outline-offset:2px;outline:2px solid #0000}}.select select:not(:last-child){background-image:none;margin-inline-end:-1.375rem}.select:focus{--input-color:var(--color-base-content);box-shadow:0 1px var(--input-color)}@supports (color:color-mix(in lab,red,red)){.select:focus{box-shadow:0 1px color-mix(in oklab,var(--input-color) calc(var(--depth) * 10%),#0000)}}.select:focus{outline:2px solid var(--input-color);outline-offset:2px}.select:focus-within{--input-color:var(--color-base-content);box-shadow:0 1px var(--input-color)}@supports (color:color-mix(in lab,red,red)){.select:focus-within{box-shadow:0 1px color-mix(in oklab,var(--input-color) calc(var(--depth) * 10%),#0000)}}.select:focus-within{outline:2px solid var(--input-color);outline-offset:2px}.select:open{--input-color:var(--color-base-content);box-shadow:0 1px var(--input-color)}@supports (color:color-mix(in lab,red,red)){.select:open{box-shadow:0 1px color-mix(in oklab,var(--input-color) calc(var(--depth) * 10%),#0000)}}.select:open{outline:2px solid var(--input-color);outline-offset:2px;background-image:linear-gradient(135deg,#0000 50%,currentColor 50%),linear-gradient(45deg,currentColor 50%,#0000 50%)}@supports (appearance:base-select){:is(.select,.select select){appearance:base-select}:is(.select,.select select)::picker(select){appearance:base-select}}:is(.select,.select select)::picker(select){color:inherit;border:var(--border) solid var(--color-base-200);border-radius:var(--radius-box);background-color:inherit;max-height:min(24rem,70dvh);box-shadow:0 2px calc(var(--depth) * 3px) -2px #0003;box-shadow:0 20px 25px -5px rgb(0 0 0/calc(var(--depth) * .1)),0 8px 10px -6px rgb(0 0 0/calc(var(--depth) * .1));margin-block:.5rem;margin-inline:.5rem;padding:.5rem;translate:-.5rem}:is(.select,.select select)::picker-icon{display:none}:is(.select,.select select) selectedcontent{text-overflow:ellipsis;white-space:nowrap;width:100%;overflow:hidden}:is(.select,.select select) optgroup{padding-top:.5em}:is(.select,.select select) optgroup option:first-child{margin-top:.5em}:is(.select,.select select) option{border-radius:var(--radius-field);padding-block:.375rem;padding-inline:calc(.25rem * var(--option-px,3));white-space:normal;transition-property:color,background-color;transition-duration:.2s;transition-timing-function:cubic-bezier(0,0,.2,1)}:is(.select,.select select) option:not(:disabled):hover,:is(.select,.select select) option:not(:disabled):focus-visible{cursor:pointer;background-color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:is(.select,.select select) option:not(:disabled):hover,:is(.select,.select select) option:not(:disabled):focus-visible{background-color:color-mix(in oklab,var(--color-base-content) 10%,transparent)}}:is(.select,.select select) option:not(:disabled):hover,:is(.select,.select select) option:not(:disabled):focus-visible{--tw-outline-style:none;outline-style:none}@media(forced-colors:active){:is(.select,.select select) option:not(:disabled):hover,:is(.select,.select select) option:not(:disabled):focus-visible{outline-offset:2px;outline:2px solid #0000}}:is(.select,.select select) option:not(:disabled):active{background-color:var(--color-neutral);color:var(--color-neutral-content);box-shadow:0 2px calc(var(--depth) * 3px) -2px var(--color-neutral)}[dir=rtl] .select::picker(select){translate:.5rem}[dir=rtl] .select select::picker(select){translate:.5rem}.avatar{vertical-align:middle;align-self:center;display:inline-flex;position:relative}.avatar>div{aspect-ratio:1;display:block;overflow:hidden}.avatar img{object-fit:cover;width:100%;height:100%}.checkbox{border:var(--border) solid var(--input-color,var(--color-base-content))}@supports (color:color-mix(in lab,red,red)){.checkbox{border:var(--border) solid var(--input-color,color-mix(in oklab, var(--color-base-content) 20%, #0000))}}.checkbox{cursor:pointer;appearance:none;border-radius:var(--radius-selector);vertical-align:middle;color:var(--color-base-content);box-shadow:0 1px oklch(0% 0 0 / calc(var(--depth) * .1)) inset,0 0 #0000 inset,0 0 #0000;--size:calc(var(--size-selector,.25rem) * 6);width:var(--size);height:var(--size);background-size:auto,calc(var(--noise) * 100%);background-image:none,var(--fx-noise);flex-shrink:0;padding:.25rem;transition:background-color .2s,box-shadow .2s;display:inline-block;position:relative}.checkbox:before{--tw-content:"";content:var(--tw-content);opacity:0;clip-path:polygon(20% 100%,20% 80%,50% 80%,50% 80%,70% 80%,70% 100%);width:100%;height:100%;box-shadow:0 3px oklch(100% 0 0 / calc(var(--depth) * .1)) inset;background-color:currentColor;font-size:1rem;line-height:.75;transition:clip-path .3s .1s,opacity .1s .1s,rotate .3s .1s,translate .3s .1s;display:block;rotate:45deg}.checkbox:focus-visible{outline:2px solid var(--input-color,currentColor);outline-offset:2px}.checkbox:checked{background-color:var(--input-color,#0000);box-shadow:0 0 #0000 inset,0 8px 0 -4px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px oklch(0% 0 0 / calc(var(--depth) * .1))}.checkbox:checked:before{clip-path:polygon(20% 100%,20% 80%,50% 80%,50% 0%,70% 0%,70% 100%);opacity:1;translate:3.5% -7%}@media(forced-colors:active){.checkbox:checked:before{--tw-content:"✔︎";clip-path:none;background-color:#0000;rotate:0deg}}@media print{.checkbox:checked:before{--tw-content:"✔︎";clip-path:none;background-color:#0000;rotate:0deg}}.checkbox[aria-checked=true]{background-color:var(--input-color,#0000);box-shadow:0 0 #0000 inset,0 8px 0 -4px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px oklch(0% 0 0 / calc(var(--depth) * .1))}.checkbox[aria-checked=true]:before{clip-path:polygon(20% 100%,20% 80%,50% 80%,50% 0%,70% 0%,70% 100%);opacity:1;translate:3.5% -7%}@media(forced-colors:active){.checkbox[aria-checked=true]:before{--tw-content:"✔︎";clip-path:none;background-color:#0000;rotate:0deg}}@media print{.checkbox[aria-checked=true]:before{--tw-content:"✔︎";clip-path:none;background-color:#0000;rotate:0deg}}.checkbox:indeterminate{background-color:var(--input-color,var(--color-base-content))}@supports (color:color-mix(in lab,red,red)){.checkbox:indeterminate{background-color:var(--input-color,color-mix(in oklab, var(--color-base-content) 20%, #0000))}}.checkbox:indeterminate:before{opacity:1;clip-path:polygon(20% 100%,20% 80%,50% 80%,50% 80%,80% 80%,80% 100%);translate:0 -40%;rotate:0deg}@media(forced-colors:active){.checkbox:indeterminate:before{--tw-content:"−";clip-path:none;background-color:#0000;translate:0;rotate:0deg}}.checkbox[aria-checked=mixed]{background-color:var(--input-color,var(--color-base-content))}@supports (color:color-mix(in lab,red,red)){.checkbox[aria-checked=mixed]{background-color:var(--input-color,color-mix(in oklab, var(--color-base-content) 20%, #0000))}}.checkbox[aria-checked=mixed]:before{opacity:1;clip-path:polygon(20% 100%,20% 80%,50% 80%,50% 80%,80% 80%,80% 100%);translate:0 -40%;rotate:0deg}@media(forced-colors:active){.checkbox[aria-checked=mixed]:before{--tw-content:"−";clip-path:none;background-color:#0000;translate:0;rotate:0deg}}.radio{cursor:pointer;appearance:none;vertical-align:middle;border:var(--border) solid var(--input-color,currentColor);border-radius:3.40282e38px;flex-shrink:0;padding:.25rem;display:inline-block;position:relative}@supports (color:color-mix(in lab,red,red)){.radio{border:var(--border) solid var(--input-color,color-mix(in srgb, currentColor 20%, #0000))}}.radio{box-shadow:0 1px oklch(0% 0 0 / calc(var(--depth) * .1)) inset;--size:calc(var(--size-selector,.25rem) * 6);width:var(--size);height:var(--size);color:var(--input-color,currentColor)}.radio:before{--tw-content:"";content:var(--tw-content);background-size:auto,calc(var(--noise) * 100%);background-image:none,var(--fx-noise);border-radius:3.40282e38px;width:100%;height:100%;display:block}.radio:focus-visible{outline:2px solid}.radio:checked{background-color:var(--color-base-100);border-color:currentColor}@media(prefers-reduced-motion:no-preference){.radio:checked{animation:.2s ease-out radio}}.radio:checked:before{box-shadow:0 -1px oklch(0% 0 0 / calc(var(--depth) * .1)) inset,0 8px 0 -4px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px oklch(0% 0 0 / calc(var(--depth) * .1));background-color:currentColor}@media(forced-colors:active){.radio:checked:before{outline-style:var(--tw-outline-style);outline-offset:-1px;outline-width:1px}}@media print{.radio:checked:before{outline-offset:-1rem;outline:.25rem solid}}.radio[aria-checked=true]{background-color:var(--color-base-100);border-color:currentColor}@media(prefers-reduced-motion:no-preference){.radio[aria-checked=true]{animation:.2s ease-out radio}}.radio[aria-checked=true]:before{box-shadow:0 -1px oklch(0% 0 0 / calc(var(--depth) * .1)) inset,0 8px 0 -4px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px oklch(0% 0 0 / calc(var(--depth) * .1));background-color:currentColor}@media(forced-colors:active){.radio[aria-checked=true]:before{outline-style:var(--tw-outline-style);outline-offset:-1px;outline-width:1px}}@media print{.radio[aria-checked=true]:before{outline-offset:-1rem;outline:.25rem solid}}.rating{vertical-align:middle;--size:var(--size-selector,.25rem) * 6;display:inline-flex;position:relative}.rating input{cursor:pointer;appearance:none}.rating *{background-color:var(--color-base-content);opacity:.2;width:calc(var(--size) * 1);height:calc(var(--size));border-radius:0}@media(forced-colors:active){.rating *{forced-color-adjust:none;background-color:canvastext}}@media(prefers-reduced-motion:no-preference){.rating *{animation:.25s ease-out rating}}.rating :checked,.rating [aria-checked=true],.rating [aria-current=true],.rating :has(~:checked,~[aria-checked=true],~[aria-current=true]){opacity:1}.rating :focus-visible{scale:1.1}@media(prefers-reduced-motion:no-preference){.rating :focus-visible{transition:scale .2s ease-out}}.rating :active:focus{animation:none;scale:1.1}.drawer{grid-auto-columns:max-content auto;width:100%;display:grid;position:relative}.card-body{padding:var(--card-p,1.5rem);font-size:var(--card-fs,.875rem);flex-direction:column;flex:auto;gap:.5rem;display:flex}.card{border-radius:var(--radius-box);outline-offset:2px;outline:2px solid #0000;flex-direction:column;transition:outline .2s ease-in-out;display:flex;position:relative}.card:focus-visible,.card[aria-checked=true],.card:has(>:checked,>:is([type=checkbox],[type=radio]):focus-visible){outline-color:currentColor}.card:has(>:checked:focus-visible),.card[aria-checked=true]:focus-visible,.card[aria-checked=true]:has(>:is([type=checkbox],[type=radio]):focus-visible){outline-width:4px}.card:has(>:is([type=checkbox],[type=radio])){cursor:pointer;-webkit-user-select:none;user-select:none}.card>:is([type=checkbox],[type=radio]){appearance:none}.progress{appearance:none;border-radius:var(--radius-box);background-color:currentColor;width:100%;height:.5rem;position:relative;overflow:hidden}@supports (color:color-mix(in lab,red,red)){.progress{background-color:color-mix(in oklab,currentcolor 20%,transparent)}}.progress{color:var(--color-base-content)}@media(forced-colors:active){.progress{border:1px solid}}.progress:indeterminate{background-image:repeating-linear-gradient(90deg,currentColor -1% 10%,#0000 10% 90%);background-position-x:15%;background-size:200%}@media(prefers-reduced-motion:no-preference){.progress:indeterminate{animation:5s ease-in-out infinite progress}}@supports ((-moz-appearance:none)){.progress:indeterminate::-moz-progress-bar{background-color:#0000}@media(prefers-reduced-motion:no-preference){.progress:indeterminate::-moz-progress-bar{background-image:repeating-linear-gradient(90deg,currentColor -1% 10%,#0000 10% 90%);background-position-x:15%;background-size:200%;animation:5s ease-in-out infinite progress}}.progress::-moz-progress-bar{border-radius:var(--radius-box);background-color:currentColor}@media(forced-colors:active){.progress::-moz-progress-bar{background-color:canvastext}}@media(prefers-reduced-motion:no-preference){.progress::-moz-progress-bar{transition:inline-size .3s}}}@supports ((-webkit-appearance:none)){.progress::-webkit-progress-bar{border-radius:var(--radius-box);background-color:#0000}.progress::-webkit-progress-value{border-radius:var(--radius-box);background-color:currentColor}@media(forced-colors:active){.progress::-webkit-progress-value{background-color:canvastext}}@media(prefers-reduced-motion:no-preference){.progress::-webkit-progress-value{transition:inline-size .3s}}}.progress\\!{appearance:none!important;border-radius:var(--radius-box)!important;background-color:currentColor!important;width:100%!important;height:.5rem!important;position:relative!important;overflow:hidden!important}@supports (color:color-mix(in lab,red,red)){.progress\\!{background-color:color-mix(in oklab,currentcolor 20%,transparent)!important}}.progress\\!{color:var(--color-base-content)!important}@media(forced-colors:active){.progress\\!{border:1px solid!important}}.progress\\!:indeterminate{background-image:repeating-linear-gradient(90deg,currentColor -1% 10%,#0000 10% 90%)!important;background-position-x:15%!important;background-size:200%!important}@media(prefers-reduced-motion:no-preference){.progress\\!:indeterminate{animation:5s ease-in-out infinite progress!important}}@supports ((-moz-appearance:none)){.progress\\!:indeterminate::-moz-progress-bar{background-color:#0000!important}@media(prefers-reduced-motion:no-preference){.progress\\!:indeterminate::-moz-progress-bar{background-image:repeating-linear-gradient(90deg,currentColor -1% 10%,#0000 10% 90%)!important;background-position-x:15%!important;background-size:200%!important;animation:5s ease-in-out infinite progress!important}}.progress\\!::-moz-progress-bar{border-radius:var(--radius-box)!important;background-color:currentColor!important}@media(forced-colors:active){.progress\\!::-moz-progress-bar{background-color:canvastext!important}}@media(prefers-reduced-motion:no-preference){.progress\\!::-moz-progress-bar{transition:inline-size .3s!important}}}@supports ((-webkit-appearance:none)){.progress\\!::-webkit-progress-bar{border-radius:var(--radius-box)!important;background-color:#0000!important}.progress\\!::-webkit-progress-value{border-radius:var(--radius-box)!important;background-color:currentColor!important}@media(forced-colors:active){.progress\\!::-webkit-progress-value{background-color:canvastext!important}}@media(prefers-reduced-motion:no-preference){.progress\\!::-webkit-progress-value{transition:inline-size .3s!important}}}.hero-content{isolation:isolate;justify-content:center;align-items:center;gap:1rem;max-width:80rem;padding:1rem;display:flex}.textarea{appearance:none;border-radius:var(--radius-field);background-color:var(--color-base-100);vertical-align:middle;--input-color:var(--color-base-content);flex-shrink:1;min-height:5rem;padding-block:.5rem;padding-inline:.75rem}@supports (color:color-mix(in lab,red,red)){.textarea{--input-color:color-mix(in oklab, var(--color-base-content) 20%, #0000)}}.textarea{width:clamp(3rem,20rem,100%);font-size:max(var(--font-size,0rem),var(--font-size-min,.875rem));touch-action:manipulation;border:var(--border) solid var(--input-color,#0000);box-shadow:0 1px var(--input-color) inset,0 -1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset}@supports (color:color-mix(in lab,red,red)){.textarea{box-shadow:0 1px color-mix(in oklab,var(--input-color) calc(var(--depth) * 10%),#0000) inset,0 -1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset}}.textarea textarea{appearance:none;background-color:#0000;border:none}.textarea textarea::placeholder{color:var(--color-base-content);opacity:.5}.textarea textarea:focus,.textarea textarea:focus-within{--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.textarea textarea:focus,.textarea textarea:focus-within{outline-offset:2px;outline:2px solid #0000}}.textarea:focus{--input-color:var(--color-base-content);box-shadow:0 1px var(--input-color)}@supports (color:color-mix(in lab,red,red)){.textarea:focus{box-shadow:0 1px color-mix(in oklab,var(--input-color) calc(var(--depth) * 10%),#0000)}}.textarea:focus{outline:2px solid var(--input-color);outline-offset:2px;isolation:isolate}@media(pointer:coarse){@supports (-webkit-touch-callout:none){.textarea:focus{--font-size:1rem}}}.textarea:focus-within{--input-color:var(--color-base-content);box-shadow:0 1px var(--input-color)}@supports (color:color-mix(in lab,red,red)){.textarea:focus-within{box-shadow:0 1px color-mix(in oklab,var(--input-color) calc(var(--depth) * 10%),#0000)}}.textarea:focus-within{outline:2px solid var(--input-color);outline-offset:2px;isolation:isolate}@media(pointer:coarse){@supports (-webkit-touch-callout:none){.textarea:focus-within{--font-size:1rem}}}.stack{grid-template-rows:3px 4px 1fr 4px 3px;grid-template-columns:3px 4px 1fr 4px 3px;display:inline-grid}.stack>*{width:100%;height:100%}.stack>:nth-child(n+2){opacity:.7;width:100%}.stack>:nth-child(2){z-index:2;opacity:.9}.stack>:first-child{z-index:3;width:100%}.modal-backdrop{color:#0000;z-index:-1;grid-row-start:1;grid-column-start:1;place-self:stretch stretch;display:grid}.modal-backdrop button{cursor:pointer}.tab-content{order:var(--tabcontent-order);--tabcontent-radius-ss:var(--radius-box);--tabcontent-radius-se:var(--radius-box);--tabcontent-radius-es:var(--radius-box);--tabcontent-radius-ee:var(--radius-box);--tabcontent-order:1;width:100%;height:calc(100% - var(--tab-height) + var(--border));margin:var(--tabcontent-margin);border-color:#0000;border-width:var(--border);border-start-start-radius:var(--tabcontent-radius-ss);border-start-end-radius:var(--tabcontent-radius-se);border-end-end-radius:var(--tabcontent-radius-ee);border-end-start-radius:var(--tabcontent-radius-es);display:none}.chat-image{grid-row:span 2/span 2;align-self:flex-end}.hero{background-position:50%;background-size:cover;place-items:center;width:100%;display:grid}.hero>*{grid-row-start:1;grid-column-start:1}.chat-footer{grid-row-start:3;gap:.25rem;font-size:.6875rem;display:flex}.modal-box{background-color:var(--color-base-100);border-top-left-radius:var(--modal-tl,var(--radius-box));border-top-right-radius:var(--modal-tr,var(--radius-box));border-bottom-left-radius:var(--modal-bl,var(--radius-box));border-bottom-right-radius:var(--modal-br,var(--radius-box));opacity:0;overscroll-behavior:contain;grid-row-start:1;grid-column-start:1;width:91.6667%;max-width:32rem;max-height:100vh;padding:1.5rem;transition:translate .3s ease-out,scale .3s ease-out,opacity .2s ease-out 50ms,box-shadow .3s ease-out;overflow-y:auto;scale:.95;box-shadow:0 25px 50px -12px #00000040}.drawer-content{grid-row-start:1;grid-column-start:2;min-width:0}.divider{white-space:nowrap;height:1rem;margin:var(--divider-m,1rem 0);--divider-color:var(--color-base-content);flex-direction:row;align-self:stretch;align-items:center;display:flex}@supports (color:color-mix(in lab,red,red)){.divider{--divider-color:color-mix(in oklab, var(--color-base-content) 10%, transparent)}}.divider:before{content:"";background-color:var(--divider-color);flex-grow:1;width:100%;height:.125rem}@media print,(forced-colors:active){.divider:before{border:.5px solid}}.divider:after{content:"";background-color:var(--divider-color);flex-grow:1;width:100%;height:.125rem}@media print,(forced-colors:active){.divider:after{border:.5px solid}}.divider:not(:empty){gap:1rem}.label{white-space:nowrap;color:currentColor;align-items:center;gap:.375rem;display:inline-flex}@supports (color:color-mix(in lab,red,red)){.label{color:color-mix(in oklab,currentcolor 60%,transparent)}}.label:has(input){cursor:pointer}.label\\!{white-space:nowrap!important;color:currentColor!important;align-items:center!important;gap:.375rem!important;display:inline-flex!important}@supports (color:color-mix(in lab,red,red)){.label\\!{color:color-mix(in oklab,currentcolor 60%,transparent)!important}}.label\\!:has(input){cursor:pointer!important}.label\\!:is(.input>*,.select>*){white-space:nowrap!important;height:calc(100% - .5rem)!important;font-size:inherit!important;align-items:center!important;padding-inline:.75rem!important;display:flex!important}.label\\!:is(.input>*,.select>*):first-child{border-inline-end:var(--border) solid currentColor!important;margin-inline:-.75rem .75rem!important}@supports (color:color-mix(in lab,red,red)){.label\\!:is(.input>*,.select>*):first-child{border-inline-end:var(--border) solid color-mix(in oklab,currentColor 10%,#0000)!important}}.label\\!:is(.input>*,.select>*):last-child{border-inline-start:var(--border) solid currentColor!important;margin-inline:.75rem -.75rem!important}@supports (color:color-mix(in lab,red,red)){.label\\!:is(.input>*,.select>*):last-child{border-inline-start:var(--border) solid color-mix(in oklab,currentColor 10%,#0000)!important}}.label:is(.input>*,.select>*){white-space:nowrap;height:calc(100% - .5rem);font-size:inherit;align-items:center;padding-inline:.75rem;display:flex}.label:is(.input>*,.select>*):first-child{border-inline-end:var(--border) solid currentColor;margin-inline:-.75rem .75rem}@supports (color:color-mix(in lab,red,red)){.label:is(.input>*,.select>*):first-child{border-inline-end:var(--border) solid color-mix(in oklab,currentColor 10%,#0000)}}.label:is(.input>*,.select>*):last-child{border-inline-start:var(--border) solid currentColor;margin-inline:.75rem -.75rem}@supports (color:color-mix(in lab,red,red)){.label:is(.input>*,.select>*):last-child{border-inline-start:var(--border) solid color-mix(in oklab,currentColor 10%,#0000)}}.fieldset-legend{color:var(--color-base-content);margin-bottom:-.25rem;justify-content:space-between;align-items:center;gap:.5rem;margin-inline-end:auto;padding-block:.5rem;font-weight:600;display:flex}.modal-action{justify-content:flex-end;gap:.5rem;margin-top:1.5rem;display:flex}.menu .dropdown-content{margin-top:.5rem;padding:.5rem}.menu .dropdown-content:before{display:none}.status{aspect-ratio:1;border-radius:var(--radius-selector);background-color:var(--color-base-content);display:inline-block}@supports (color:color-mix(in lab,red,red)){.status{background-color:color-mix(in oklab,var(--color-base-content) 20%,transparent)}}.status{vertical-align:middle;color:#0000004d;background-position:50%;background-repeat:no-repeat}@supports (color:color-mix(in lab,red,red)){.status{color:color-mix(in oklab,var(--color-black) 30%,transparent)}}.status{--size:calc(var(--size-selector,.25rem) * 2);width:var(--size);height:var(--size);background-image:radial-gradient(circle at 35% 30%,oklch(1 0 0 / calc(var(--depth) * .5)),#0000);box-shadow:0 2px 3px -1px}@supports (color:color-mix(in lab,red,red)){.status{box-shadow:0 2px 3px -1px color-mix(in oklab,currentColor calc(var(--depth) * 100%),#0000)}}.badge{border-radius:var(--radius-selector);vertical-align:middle;color:var(--badge-fg);border:var(--border) solid var(--badge-color,var(--color-base-200));background-size:auto,calc(var(--noise) * 100%);background-image:none,var(--fx-noise);background-color:var(--badge-bg);--badge-bg:var(--badge-color,var(--color-base-100));--badge-fg:var(--color-base-content);--size:calc(var(--size-selector,.25rem) * 6);width:fit-content;height:var(--size);padding-inline:calc(var(--size) / 2 - var(--border));flex-shrink:0;justify-content:center;align-items:center;gap:.5rem;font-size:.875rem;display:inline-flex}.footer{grid-auto-flow:row;place-items:start;gap:2.5rem 1rem;width:100%;font-size:.875rem;line-height:1.25rem;display:grid}.footer>:not(script,style,template){place-items:start;gap:.5rem;display:grid}.stat{grid-template-columns:repeat(1,1fr);column-gap:1rem;width:100%;padding-block:1rem;padding-inline:1.5rem;display:inline-grid}.stat:not(:last-child){border-inline-end:var(--border) dashed currentColor}@supports (color:color-mix(in lab,red,red)){.stat:not(:last-child){border-inline-end:var(--border) dashed color-mix(in oklab,currentColor 10%,#0000)}}.stat:not(:last-child){border-block-end:none}.dropdown.dropdown-close .dropdown-content{transform-origin:top;opacity:0;display:none;scale:.95}.fieldset{grid-template-columns:1fr;grid-auto-rows:max-content;gap:.375rem;padding-block:.25rem;font-size:.75rem;display:grid}.chat{--mask-chat:url("data:image/svg+xml,%3csvg width='13' height='13' xmlns='http://www.w3.org/2000/svg'%3e%3cpath fill='black' d='M0 11.5004C0 13.0004 2 13.0004 2 13.0004H12H13V0.00036329L12.5 0C12.5 0 11.977 2.09572 11.8581 2.50033C11.6075 3.35237 10.9149 4.22374 9 5.50036C6 7.50036 0 10.0004 0 11.5004Z'/%3e%3c/svg%3e");grid-auto-rows:min-content;column-gap:.75rem;padding-block:.25rem;display:grid}.card-title{font-size:var(--cardtitle-fs,1.125rem);align-items:center;gap:.5rem;font-weight:600;display:flex}.avatar-group{display:flex;overflow:hidden}.avatar-group .avatar{border:4px solid var(--color-base-100);border-radius:3.40282e38px;overflow:hidden}.mask{vertical-align:middle;display:inline-block;-webkit-mask-position:50%;mask-position:50%;-webkit-mask-size:contain;mask-size:contain;-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat}.rating .rating-hidden{background-color:#0000;width:.5rem}.menu .dropdown:focus-within .menu-dropdown-toggle:after{translate:0 1px;rotate:45deg}.skeleton{border-radius:var(--radius-box);background-color:var(--color-base-300);will-change:background-position;background-image:linear-gradient(105deg,#0000 0% 40%,var(--color-base-100) 50%,#0000 60% 100%);background-position-x:-50%;background-size:200%}@media(prefers-reduced-motion:reduce){.skeleton{transition-duration:15s}}@media(prefers-reduced-motion:no-preference){.skeleton{animation:1.8s ease-in-out infinite skeleton}.skeleton:dir(rtl){animation-direction:reverse}}.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title),li:not(.menu-title,.disabled)>details>summary:not(.menu-title)):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])).menu-focus{cursor:pointer;background-color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title),li:not(.menu-title,.disabled)>details>summary:not(.menu-title)):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])).menu-focus{background-color:color-mix(in oklab,var(--color-base-content) 10%,transparent)}}.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title),li:not(.menu-title,.disabled)>details>summary:not(.menu-title)):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])).menu-focus{color:var(--color-base-content);--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.menu :where(li:not(.menu-title,.disabled)>:not(ul,menu,details,.menu-title),li:not(.menu-title,.disabled)>details>summary:not(.menu-title)):not(.menu-active,:active,.btn,[aria-current]:not([aria-current=false],[aria-current=""])).menu-focus{outline-offset:2px;outline:2px solid #0000}}.link{cursor:pointer;text-decoration-line:underline}.link:focus{--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.link:focus{outline-offset:2px;outline:2px solid #0000}}.link:focus-visible{outline-offset:2px;outline:2px solid}.btn-outline{--btn-bg:#0000;color:var(--btn-rest-fg,var(--btn-color,var(--color-base-content)));--btn-border:var(--btn-color,var(--color-base-content));--btn-border-style:solid;--btn-inset:0 0 0 0 oklch(0% 0 0/0);--btn-shadow:0 0 0 0 oklch(0% 0 0/0);background-image:none}.btn-ghost{--btn-bg:#0000;color:var(--btn-rest-fg,var(--btn-color,var(--color-base-content,currentColor)));--btn-border:#0000;--btn-inset:0 0 0 0 oklch(0% 0 0/0);--btn-shadow:0 0 0 0 oklch(0% 0 0/0);background-image:none}.aura:has(>.card,>.alert){--aura-radius:var(--radius-box)}.aura:has(>.btn,>.input,>.select){--aura-radius:var(--radius-field)}.aura:has(>.checkbox,>.toggle,>.badge){--aura-radius:var(--radius-selector)}.collapse:not(td,tr,colgroup){border-radius:var(--radius-box,1rem);isolation:isolate;grid-template-rows:max-content 0fr;grid-template-columns:minmax(0,1fr);width:100%;display:grid;position:relative}@media(prefers-reduced-motion:no-preference){.collapse:not(td,tr,colgroup){transition:grid-template-rows .2s}}.collapse:not(td,tr,colgroup)>input:is([type=checkbox],[type=radio]){appearance:none;opacity:0;z-index:1;grid-row-start:1;grid-column-start:1;width:100%;min-height:1lh;padding:1rem;padding-inline-end:3rem;transition:background-color .2s ease-out}.collapse:not(td,tr,colgroup):is([open],[tabindex]:focus:not(.collapse-close),[tabindex]:focus-within:not(.collapse-close)),.collapse:not(td,tr,colgroup):not(.collapse-close):has(>input:is([type=checkbox],[type=radio]):checked){grid-template-rows:max-content 1fr}.collapse:not(td,tr,colgroup):is([open],[tabindex]:focus:not(.collapse-close),[tabindex]:focus-within:not(.collapse-close))>.collapse-content,.collapse:not(td,tr,colgroup):not(.collapse-close)>:where(input:is([type=checkbox],[type=radio]):checked~.collapse-content){--overflow-delay:.2s;overflow:revert-layer;content-visibility:visible;min-height:fit-content}@supports not (content-visibility:visible){.collapse:not(td,tr,colgroup):is([open],[tabindex]:focus:not(.collapse-close),[tabindex]:focus-within:not(.collapse-close))>.collapse-content,.collapse:not(td,tr,colgroup):not(.collapse-close)>:where(input:is([type=checkbox],[type=radio]):checked~.collapse-content){visibility:visible}}.collapse:not(td,tr,colgroup):focus-visible,.collapse:not(td,tr,colgroup):has(>input:is([type=checkbox],[type=radio]):focus-visible),.collapse:not(td,tr,colgroup):has(summary:focus-visible){outline-color:var(--color-base-content);outline-offset:2px;outline-width:2px;outline-style:solid}.collapse:not(td,tr,colgroup):not(.collapse-close)>input[type=checkbox],.collapse:not(td,tr,colgroup):not(.collapse-close)>input[type=radio]:not(:checked),.collapse:not(td,tr,colgroup):not(.collapse-close)>.collapse-title{cursor:pointer}:is(.collapse:not(td,tr,colgroup)[tabindex]:focus:not(.collapse-close,.collapse[open]),.collapse:not(td,tr,colgroup)[tabindex]:focus-within:not(.collapse-close,.collapse[open]))>.collapse-title{cursor:unset}.collapse:not(td,tr,colgroup):is([open],[tabindex]:focus:not(.collapse-close),[tabindex]:focus-within:not(.collapse-close))>:where(.collapse-content),.collapse:not(td,tr,colgroup):not(.collapse-close)>:where(input:is([type=checkbox],[type=radio]):checked~.collapse-content){padding-bottom:1rem}.collapse:not(td,tr,colgroup):is(details){width:100%}.collapse:not(td,tr,colgroup):is(details)::details-content{--overflow-delay:0s;height:0;overflow:clip}.collapse:not(td,tr,colgroup):is(details):where([open])::details-content{overflow:revert-layer;height:auto}@media(prefers-reduced-motion:no-preference){.collapse:not(td,tr,colgroup):is(details)::details-content{transition:overflow .2s allow-discrete var(--overflow-delay),content-visibility .2s allow-discrete,visibility .2s allow-discrete,min-height .2s ease-out allow-discrete,padding .1s ease-out 20ms,background-color .2s ease-out,height .2s;interpolate-size:allow-keywords}.collapse:not(td,tr,colgroup):is(details):where([open])::details-content{--overflow-delay:.2s}}.collapse:not(td,tr,colgroup):is(details)>summary{outline:none;display:block;position:relative}.collapse:not(td,tr,colgroup):is(details)>summary::-webkit-details-marker{display:none}.kbd{border-radius:var(--radius-field);background-color:var(--color-base-200);vertical-align:middle;color:var(--color-base-content);border:var(--border) solid var(--color-base-content);flex-shrink:0;justify-content:center;align-items:center;padding-inline:.5em;display:inline-flex}@supports (color:color-mix(in lab,red,red)){.kbd{border:var(--border) solid color-mix(in srgb,var(--color-base-content) 20%,#0000)}}.kbd{border-bottom:calc(var(--border) + 1px) solid var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.kbd{border-bottom:calc(var(--border) + 1px) solid color-mix(in srgb,var(--color-base-content) 20%,#0000)}}.kbd{--size:calc(var(--size-selector,.25rem) * 6);height:var(--size);min-width:var(--size);font-size:.875rem}.alert{--alert-border-color:var(--color-base-200);border-radius:var(--radius-box);color:var(--color-base-content);background-color:var(--alert-color,var(--color-base-200));text-align:start;background-size:auto,calc(var(--noise) * 33%);background-image:none,var(--fx-noise);box-shadow:0 3px 0 -2px oklch(100% 0 0 / calc(var(--depth) * .08)) inset,0 1px #000,0 4px 3px -2px oklch(0% 0 0 / calc(var(--depth) * .08));border-style:solid;grid-template-columns:auto;grid-auto-flow:column;justify-content:start;place-items:center start;gap:1rem;padding-block:.75rem;padding-inline:1rem;font-size:.875rem;line-height:1.25rem;display:grid}@supports (color:color-mix(in lab,red,red)){.alert{box-shadow:0 3px 0 -2px oklch(100% 0 0 / calc(var(--depth) * .08)) inset,0 1px color-mix(in oklab,color-mix(in oklab,#000 20%,var(--alert-color,var(--color-base-200))) calc(var(--depth) * 20%),#0000),0 4px 3px -2px oklch(0% 0 0 / calc(var(--depth) * .08))}}.alert:has(>:nth-child(2)){grid-template-columns:auto minmax(auto,1fr)}}@layer daisyui.l1.l2{.diff{webkit-user-select:none;-webkit-user-select:none;user-select:none;direction:ltr;grid-template-rows:1fr 1.8rem 1fr;grid-template-columns:auto 1fr;align-items:normal;width:100%;display:grid;position:relative;overflow:hidden;container-type:inline-size}.diff:focus-visible,.diff:has(.diff-item-1:focus-visible){outline-style:var(--tw-outline-style);outline-offset:1px;outline-width:2px;outline-color:var(--color-base-content)}.diff:focus-visible .diff-resizer{min-width:95cqi;max-width:95cqi}.diff:has(.diff-item-1:focus-visible){outline-style:var(--tw-outline-style);outline-offset:1px;outline-width:2px}.diff:has(.diff-item-1:focus-visible) .diff-resizer{min-width:5cqi;max-width:5cqi}.diff:hover .diff-item-2:after{height:2.4rem}.modal[open]{pointer-events:auto;visibility:visible;opacity:1;transition:visibility 0s allow-discrete,background-color .3s ease-out,opacity .1s ease-out;background-color:#0006}.modal[open]>.modal-box{opacity:1;translate:0;scale:1}:root:has(.modal[open]){--page-scroll-lock: }@starting-style{.modal[open]{opacity:0}}.modal:popover-open{pointer-events:auto;visibility:visible;opacity:1;transition:visibility 0s allow-discrete,background-color .3s ease-out,opacity .1s ease-out;background-color:#0006}.modal:popover-open>.modal-box{opacity:1;translate:0;scale:1}:root:has(.modal:popover-open){--page-scroll-lock: }@starting-style{.modal:popover-open{opacity:0}}.modal:target{pointer-events:auto;visibility:visible;opacity:1;transition:visibility 0s allow-discrete,background-color .3s ease-out,opacity .1s ease-out;background-color:#0006}.modal:target>.modal-box{opacity:1;translate:0;scale:1}:root:has(.modal:target){--page-scroll-lock: }@starting-style{.modal:target{opacity:0}}.modal-toggle:checked+.modal{pointer-events:auto;visibility:visible;opacity:1;transition:visibility 0s allow-discrete,background-color .3s ease-out,opacity .1s ease-out;background-color:#0006}.modal-toggle:checked+.modal>.modal-box{opacity:1;translate:0;scale:1}:root:has(.modal-toggle:checked+.modal){--page-scroll-lock: }@starting-style{.modal-toggle:checked+.modal{opacity:0}}:where(.drawer-toggle:checked~.drawer-side){pointer-events:auto;visibility:visible;opacity:1;overflow-y:auto}:where(.drawer-toggle:checked~.drawer-side)>:not(.drawer-overlay){translate:0%}.drawer-end>.drawer-toggle~.drawer-side{grid-column-start:2;justify-items:end}.drawer-end>.drawer-toggle~.drawer-side>:not(.drawer-overlay){translate:100%}[dir=rtl] :is(.drawer-end>.drawer-toggle~.drawer-side>:not(.drawer-overlay)){translate:-100%}.drawer-end>.drawer-toggle:checked~.drawer-side>:not(.drawer-overlay){translate:0%}.drawer-open>.drawer-side{overflow-y:auto}.modal.modal-open{pointer-events:auto;visibility:visible;opacity:1;transition:visibility 0s allow-discrete,background-color .3s ease-out,opacity .1s ease-out;background-color:#0006}.modal.modal-open>.modal-box{opacity:1;translate:0;scale:1}:root:has(.modal.modal-open){--page-scroll-lock: }@starting-style{.modal.modal-open{opacity:0}}.tooltip-start>.tooltip-content{left:auto;right:auto;inset-inline:0 auto}.tooltip-center>.tooltip-content{inset-inline:auto;left:50%;right:auto}.tooltip-end>.tooltip-content{left:auto;right:auto;inset-inline:auto 0}.tooltip-right>.tooltip-content{transform:translate(calc(var(--tt-pos,-.25rem) + .25rem)) translateY(var(--tt-trans,-50%));left:var(--tt-off);right:auto;inset-block:var(--tt-inset,50% auto)}.tooltip-primary>.tooltip-content{color:var(--color-primary-content)}.tooltip-secondary>.tooltip-content{color:var(--color-secondary-content)}.tooltip-accent>.tooltip-content{color:var(--color-accent-content)}.tooltip-info>.tooltip-content{color:var(--color-info-content)}.tooltip-success>.tooltip-content{color:var(--color-success-content)}.tooltip-warning>.tooltip-content{color:var(--color-warning-content)}.tooltip-error>.tooltip-content{color:var(--color-error-content)}.tabs-border>.tab{--tab-border-color:#0000 #0000 var(--tab-border-color) #0000;border-radius:var(--radius-field);position:relative}.tabs-border>.tab:before{content:"";background-color:var(--tab-border-color);width:calc(100% - var(--tab-p) * 2);border-radius:var(--radius-field);height:3px;bottom:0;left:var(--tab-p);transition:background-color .2s;position:absolute}:is(.tabs-border>.tab:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]),.tabs-border>.tab:is(input:checked),.tabs-border>.tab:is(label:has(:checked))):before{--tab-border-color:currentColor;border-top:3px solid}.tabs-bottom>.tab{--tab-order:1;--tab-border:var(--border) 0 0 0;--tab-radius-ss:0;--tab-radius-se:0;--tab-radius-es:var(--tab-radius-limit);--tab-radius-ee:var(--tab-radius-limit);--tab-border-colors:var(--tab-border-color) #0000 #0000 #0000;--tab-paddings:0 var(--tab-p) var(--border) var(--tab-p);--tab-corner-width:calc(100% + var(--tab-radius-limit) * 2);--tab-corner-height:var(--tab-radius-limit);--tab-corner-position:top left, top right}.tabs-bottom>.tab:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]),.tabs-bottom>.tab:is(input:checked),.tabs-bottom>.tab:is(label:has(:checked)){--tab-border:0 var(--border) var(--border) var(--border);--tab-border-colors:#0000 var(--tab-border-color) var(--tab-border-color) var(--tab-border-color);--tab-paddings:var(--border) calc(var(--tab-p) - var(--border)) 0 calc(var(--tab-p) - var(--border));--tab-inset:0 auto auto auto;--radius-start:radial-gradient(circle at bottom left, var(--tab-radius-grad));--radius-end:radial-gradient(circle at bottom right, var(--tab-radius-grad))}.tabs-xs>.tab{--tab-p:.375rem;--tab-radius-min:calc(.5rem - var(--border));font-size:.75rem}.tabs-sm>.tab{--tab-p:.5rem;--tab-radius-min:calc(.5rem - var(--border));font-size:.875rem}.tabs-md>.tab{--tab-p:.75rem;--tab-radius-min:calc(.75rem - var(--border));font-size:.875rem}.tabs-lg>.tab{--tab-p:1rem;--tab-radius-min:calc(1.5rem - var(--border));font-size:1.125rem}.tabs-xl>.tab{--tab-p:1.25rem;--tab-radius-min:calc(2rem - var(--border));font-size:1.125rem}.collapse-arrow>.collapse-title:after{width:.5rem;height:.5rem;display:block;position:absolute;transform:translateY(-100%)rotate(45deg)}@media(prefers-reduced-motion:no-preference){.collapse-arrow>.collapse-title:after{transition-property:all;transition-duration:.2s;transition-timing-function:cubic-bezier(.4,0,.2,1)}}.collapse-arrow>.collapse-title:after{content:"";transform-origin:75% 75%;pointer-events:none;top:50%;inset-inline-end:1.4rem;box-shadow:2px 2px}.collapse-plus>.collapse-title:after{width:.5rem;height:.5rem;display:block;position:absolute}@media(prefers-reduced-motion:no-preference){.collapse-plus>.collapse-title:after{transition-property:all;transition-duration:.3s;transition-timing-function:cubic-bezier(.4,0,.2,1)}}.collapse-plus>.collapse-title:after{--tw-content:"+";content:var(--tw-content);pointer-events:none;top:.9rem;inset-inline-end:1.4rem}.btn:is([aria-pressed=true],[aria-checked=true],[aria-current]:not([aria-current=false],[aria-current=""])){--btn-bg:var(--btn-color,var(--color-base-200))}@supports (color:color-mix(in lab,red,red)){.btn:is([aria-pressed=true],[aria-checked=true],[aria-current]:not([aria-current=false],[aria-current=""])){--btn-bg:color-mix(in oklab, var(--btn-color,var(--color-base-200)), #000 5%)}}.btn:is([aria-pressed=true],[aria-checked=true],[aria-current]:not([aria-current=false],[aria-current=""])){color:var(--btn-fg,var(--color-base-content));--btn-border:var(--btn-color,var(--color-base-200))}@supports (color:color-mix(in lab,red,red)){.btn:is([aria-pressed=true],[aria-checked=true],[aria-current]:not([aria-current=false],[aria-current=""])){--btn-border:color-mix(in oklab, var(--btn-color,var(--color-base-200)), #000 7%)}}.btn:is([aria-pressed=true],[aria-checked=true],[aria-current]:not([aria-current=false],[aria-current=""])){--btn-border-style:solid;--btn-inset:0 0 0 0 oklch(0% 0 0/0);--btn-shadow:0 0 0 0 oklch(0% 0 0/0);isolation:isolate}:is(.validator:user-valid,.validator:has(:user-valid)),:is(.validator:user-valid,.validator:has(:user-valid)):focus,:is(.validator:user-valid,.validator:has(:user-valid)):checked,:is(.validator:user-valid,.validator:has(:user-valid))[aria-checked=true],:is(.validator:user-valid,.validator:has(:user-valid)):focus-within{--input-color:var(--color-success)}:is(.validator:user-invalid,.validator:has(:user-invalid),.validator[aria-invalid]:not([aria-invalid=false]),.validator:has([aria-invalid]:not([aria-invalid=false]))),:is(.validator:user-invalid,.validator:has(:user-invalid),.validator[aria-invalid]:not([aria-invalid=false]),.validator:has([aria-invalid]:not([aria-invalid=false]))):focus,:is(.validator:user-invalid,.validator:has(:user-invalid),.validator[aria-invalid]:not([aria-invalid=false]),.validator:has([aria-invalid]:not([aria-invalid=false]))):checked,:is(.validator:user-invalid,.validator:has(:user-invalid),.validator[aria-invalid]:not([aria-invalid=false]),.validator:has([aria-invalid]:not([aria-invalid=false])))[aria-checked=true],:is(.validator:user-invalid,.validator:has(:user-invalid),.validator[aria-invalid]:not([aria-invalid=false]),.validator:has([aria-invalid]:not([aria-invalid=false]))):focus-within{--input-color:var(--color-error)}.tabs-lift{--tabs-height:auto;--tabs-direction:row}.tabs-lift>.tab{--tab-border:0 0 var(--border) 0;--tab-radius-ss:var(--tab-radius-limit);--tab-radius-se:var(--tab-radius-limit);--tab-radius-es:0;--tab-radius-ee:0;--tab-paddings:var(--border) var(--tab-p) 0 var(--tab-p);--tab-border-colors:#0000 #0000 var(--tab-border-color) #0000;--tab-corner-width:calc(100% + var(--tab-radius-limit) * 2);--tab-corner-height:var(--tab-radius-limit);--tab-corner-position:top left, top right;border-width:var(--tab-border);padding:var(--tab-paddings);border-color:var(--tab-border-colors);border-start-start-radius:var(--tab-radius-ss);border-start-end-radius:var(--tab-radius-se);border-end-end-radius:var(--tab-radius-ee);border-end-start-radius:var(--tab-radius-es)}.tabs-lift>.tab:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]),.tabs-lift>.tab:is(input:checked,label:has(:checked)){--tab-border:var(--border) var(--border) 0 var(--border);--tab-border-colors:var(--tab-border-color) var(--tab-border-color) #0000 var(--tab-border-color);--tab-paddings:0 calc(var(--tab-p) - var(--border)) var(--border) calc(var(--tab-p) - var(--border));--tab-inset:auto auto 0 auto;--radius-start:radial-gradient(circle at top left, var(--tab-radius-grad));--radius-end:radial-gradient(circle at top right, var(--tab-radius-grad));background-color:var(--tab-bg)}:is(.tabs-lift>.tab:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]),.tabs-lift>.tab:is(input:checked,label:has(:checked))):before{z-index:1;content:"";width:var(--tab-corner-width);height:var(--tab-corner-height);background-position:var(--tab-corner-position);background-image:var(--radius-start),var(--radius-end);background-size:var(--tab-radius-limit) var(--tab-radius-limit);inset:var(--tab-inset);background-repeat:no-repeat;display:block;position:absolute}:is(.tabs-lift>.tab:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]),.tabs-lift>.tab:is(input:checked,label:has(:checked))):first-child:before{--radius-start:none}[dir=rtl] :is(.tabs-lift>.tab:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]),.tabs-lift>.tab:is(input:checked,label:has(:checked))):first-child:before{transform:rotateY(180deg)}:is(.tabs-lift>.tab:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]),.tabs-lift>.tab:is(input:checked,label:has(:checked))):last-child:before{--radius-end:none}[dir=rtl] :is(.tabs-lift>.tab:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]),.tabs-lift>.tab:is(input:checked,label:has(:checked))):last-child:before{transform:rotateY(180deg)}.list .list-row:has(>.list-col-grow:first-child){--list-grid-cols:1fr}.list .list-row:has(>.list-col-grow:nth-child(2)){--list-grid-cols:minmax(0, auto) 1fr}.list .list-row:has(>.list-col-grow:nth-child(3)){--list-grid-cols:minmax(0, auto) minmax(0, auto) 1fr}.list .list-row:has(>.list-col-grow:nth-child(4)){--list-grid-cols:minmax(0, auto) minmax(0, auto) minmax(0, auto) 1fr}.list .list-row:has(>.list-col-grow:nth-child(5)){--list-grid-cols:minmax(0, auto) minmax(0, auto) minmax(0, auto) minmax(0, auto) 1fr}.list .list-row:has(>.list-col-grow:nth-child(6)){--list-grid-cols:minmax(0, auto) minmax(0, auto) minmax(0, auto) minmax(0, auto) minmax(0, auto) 1fr}.list .list-row>*{grid-row-start:1}.input:has(>input[disabled]){cursor:not-allowed;border-color:var(--color-base-200);background-color:var(--color-base-200)}.input:has(>input[disabled]):is(input),.input:has(>input[disabled]) :is(input){color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.input:has(>input[disabled]):is(input),.input:has(>input[disabled]) :is(input){color:color-mix(in oklab,var(--color-base-content) 40%,transparent)}}.input:has(>input[disabled]){box-shadow:none}.input:has(>input[disabled])::placeholder,.input:has(>input[disabled]) ::placeholder{color:var(--color-base-content);opacity:.2}.input:is(:disabled,[disabled]){cursor:not-allowed;border-color:var(--color-base-200);background-color:var(--color-base-200)}.input:is(:disabled,[disabled]):is(input),.input:is(:disabled,[disabled]) :is(input){color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.input:is(:disabled,[disabled]):is(input),.input:is(:disabled,[disabled]) :is(input){color:color-mix(in oklab,var(--color-base-content) 40%,transparent)}}.input:is(:disabled,[disabled]){box-shadow:none}.input:is(:disabled,[disabled])::placeholder,.input:is(:disabled,[disabled]) ::placeholder{color:var(--color-base-content);opacity:.2}fieldset:disabled .input{cursor:not-allowed;border-color:var(--color-base-200);background-color:var(--color-base-200)}fieldset:disabled .input:is(input),fieldset:disabled .input :is(input){color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){fieldset:disabled .input:is(input),fieldset:disabled .input :is(input){color:color-mix(in oklab,var(--color-base-content) 40%,transparent)}}fieldset:disabled .input{box-shadow:none}fieldset:disabled .input::placeholder,fieldset:disabled .input ::placeholder{color:var(--color-base-content);opacity:.2}.input:has(>input[disabled])>input[disabled]{cursor:not-allowed}.steps .step-neutral+.step-neutral:before,.steps .step-neutral:after,.steps .step-neutral>.step-icon{--step-bg:var(--color-neutral);--step-fg:var(--color-neutral-content)}.steps .step-primary+.step-primary:before,.steps .step-primary:after,.steps .step-primary>.step-icon{--step-bg:var(--color-primary);--step-fg:var(--color-primary-content)}.steps .step-secondary+.step-secondary:before,.steps .step-secondary:after,.steps .step-secondary>.step-icon{--step-bg:var(--color-secondary);--step-fg:var(--color-secondary-content)}.steps .step-accent+.step-accent:before,.steps .step-accent:after,.steps .step-accent>.step-icon{--step-bg:var(--color-accent);--step-fg:var(--color-accent-content)}.steps .step-info+.step-info:before,.steps .step-info:after,.steps .step-info>.step-icon{--step-bg:var(--color-info);--step-fg:var(--color-info-content)}.steps .step-success+.step-success:before,.steps .step-success:after,.steps .step-success>.step-icon{--step-bg:var(--color-success);--step-fg:var(--color-success-content)}.steps .step-warning+.step-warning:before,.steps .step-warning:after,.steps .step-warning>.step-icon{--step-bg:var(--color-warning);--step-fg:var(--color-warning-content)}.steps .step-error+.step-error:before,.steps .step-error:after,.steps .step-error>.step-icon{--step-bg:var(--color-error);--step-fg:var(--color-error-content)}@supports (-webkit-overflow-scrolling:touch) and (overflow:-webkit-paged-x){.diff:focus .diff-resizer{min-width:5cqi;max-width:5cqi}}@supports ((-moz-appearance:none)){@media(hover:none)and (pointer:coarse){.diff:focus .diff-resizer{min-width:5cqi;max-width:5cqi}}}@supports (-webkit-overflow-scrolling:touch) and (overflow:-webkit-paged-x){.diff:has(.diff-item-1:focus) .diff-resizer{min-width:95cqi;max-width:95cqi}}@supports ((-moz-appearance:none)){@media(hover:none)and (pointer:coarse){.diff:has(.diff-item-1:focus) .diff-resizer{min-width:95cqi;max-width:95cqi}}}.swap{cursor:pointer;vertical-align:middle;webkit-user-select:none;-webkit-user-select:none;user-select:none;place-content:center;display:inline-grid;position:relative}.swap input{appearance:none;border:none}.swap>*{grid-row-start:1;grid-column-start:1}@media(prefers-reduced-motion:no-preference){.swap>*{transition-property:transform,rotate,opacity;transition-duration:.2s;transition-timing-function:cubic-bezier(0,0,.2,1)}}.swap .swap-on,.swap .swap-indeterminate,.swap input:indeterminate~.swap-on,.swap input:is(:checked,:indeterminate)~.swap-off{opacity:0}.swap input:checked~.swap-on,.swap input:indeterminate~.swap-indeterminate{opacity:1;backface-visibility:visible}.select:has(>select[disabled]){cursor:not-allowed;border-color:var(--color-base-200);background-color:var(--color-base-200)}.select:has(>select[disabled]):is(select),.select:has(>select[disabled]) :is(select){color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.select:has(>select[disabled]):is(select),.select:has(>select[disabled]) :is(select){color:color-mix(in oklab,var(--color-base-content) 40%,transparent)}}.select:has(>select[disabled]){box-shadow:none}.select:has(>select[disabled])::placeholder,.select:has(>select[disabled]) ::placeholder{color:var(--color-base-content);opacity:.2}.select:is(:disabled,[disabled]){cursor:not-allowed;border-color:var(--color-base-200);background-color:var(--color-base-200)}.select:is(:disabled,[disabled]):is(select),.select:is(:disabled,[disabled]) :is(select){color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.select:is(:disabled,[disabled]):is(select),.select:is(:disabled,[disabled]) :is(select){color:color-mix(in oklab,var(--color-base-content) 40%,transparent)}}.select:is(:disabled,[disabled]){box-shadow:none}.select:is(:disabled,[disabled])::placeholder,.select:is(:disabled,[disabled]) ::placeholder{color:var(--color-base-content);opacity:.2}fieldset:disabled .select{cursor:not-allowed;border-color:var(--color-base-200);background-color:var(--color-base-200)}fieldset:disabled .select:is(select),fieldset:disabled .select :is(select){color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){fieldset:disabled .select:is(select),fieldset:disabled .select :is(select){color:color-mix(in oklab,var(--color-base-content) 40%,transparent)}}fieldset:disabled .select{box-shadow:none}fieldset:disabled .select::placeholder,fieldset:disabled .select ::placeholder{color:var(--color-base-content);opacity:.2}.select:has(>select[disabled])>select[disabled]{cursor:not-allowed}.checkbox:disabled,.radio:disabled{cursor:not-allowed;opacity:.2}.image-full>.card-body{color:var(--color-neutral-content);position:relative}.tooltip-bottom>.tooltip-content,.tooltip-bottom[data-tip]:before{transform:translate(var(--tt-trans,-50%)) translateY(var(--tt-pos,-.25rem));inset:var(--tt-off) auto auto 50%}.tooltip-bottom:after{transform:translate(var(--tt-trans,-50%)) translateY(var(--tt-pos,-.25rem)) rotate(180deg);inset:var(--tt-tail) auto auto 50%}.tooltip-top>.tooltip-content,.tooltip-top[data-tip]:before{transform:translate(var(--tt-trans,-50%)) translateY(var(--tt-pos,.25rem));inset:auto auto var(--tt-off) 50%}.tooltip-top:after{transform:translate(var(--tt-trans,-50%)) translateY(var(--tt-pos,.25rem));inset:auto auto var(--tt-tail) 50%}.tooltip-left{--tt-tail-off:clamp(.5rem, var(--tt-radius) + 3px, .8rem - 2px)}.tooltip-left>.tooltip-content,.tooltip-left[data-tip]:before{transform:translate(calc(var(--tt-pos,.25rem) - .25rem)) translateY(var(--tt-trans,-50%));left:auto;right:var(--tt-off);inset-block:var(--tt-inset,50% auto)}.tooltip-left:after{transform:translate(var(--tt-pos,.25rem)) translateY(var(--tt-trans,-50%)) rotate(-90deg);left:auto;right:calc(var(--tt-tail) + 1px);inset-block:var(--tt-tail-inset,50% auto)}.toast-center{--toast-x:-50%;inset-inline:50%}.toast-center:dir(rtl){--toast-x:50%}.dropdown-right{--anchor-h:right;--anchor-v:span-bottom}.dropdown-right .dropdown-content{transform-origin:0;inset-inline-start:100%;top:0;bottom:auto}.chat-end{grid-template-columns:1fr auto;place-items:end}.chat-end .chat-header,.chat-end .chat-footer{grid-column-start:1}.chat-end .chat-bubble{border-end-end-radius:0;grid-column-start:1}.chat-end .chat-bubble:before{inset-inline-start:100%;transform:rotateY(180deg)}[dir=rtl] :is(.chat-end .chat-bubble):before{transform:rotateY(0)}.chat-start{grid-template-columns:auto 1fr;place-items:start}.chat-start .chat-header,.chat-start .chat-footer{grid-column-start:2}.chat-start .chat-bubble{border-end-start-radius:0;grid-column-start:2}.chat-start .chat-bubble:before{inset-inline-start:-.75rem;transform:rotateY(0)}[dir=rtl] :is(.chat-start .chat-bubble):before{transform:rotateY(180deg)}.dropdown-left{--anchor-h:left;--anchor-v:span-bottom}.dropdown-left .dropdown-content{transform-origin:100%;inset-inline-end:100%;top:0;bottom:auto}.dropdown-center{--anchor-h:center}.dropdown-center :where(.dropdown-content){inset-inline-end:50%;translate:50%}[dir=rtl] :is(.dropdown-center :where(.dropdown-content)){translate:-50%}.dropdown-center.dropdown-left{--anchor-h:left;--anchor-v:center}.dropdown-center.dropdown-left .dropdown-content{top:auto;bottom:50%;translate:0 50%}.dropdown-center.dropdown-right{--anchor-h:right;--anchor-v:center}.dropdown-center.dropdown-right .dropdown-content{top:auto;bottom:50%;translate:0 50%}.dropdown-end{--anchor-h:span-inline-start}.dropdown-end :where(.dropdown-content){inset-inline-end:0;translate:0}[dir=rtl] :is(.dropdown-end :where(.dropdown-content)){translate:0}.dropdown-end.dropdown-left{--anchor-h:left;--anchor-v:span-top}.dropdown-end.dropdown-left .dropdown-content{top:auto;bottom:0}.dropdown-end.dropdown-right{--anchor-h:right;--anchor-v:span-top}.dropdown-end.dropdown-right .dropdown-content{top:auto;bottom:0}.dropdown-start{--anchor-h:span-inline-end}.dropdown-start :where(.dropdown-content){inset-inline-end:auto;translate:0}[dir=rtl] :is(.dropdown-start :where(.dropdown-content)){translate:0}.dropdown-start.dropdown-left{--anchor-h:left;--anchor-v:span-bottom}.dropdown-start.dropdown-left .dropdown-content{top:0;bottom:auto}.dropdown-start.dropdown-right{--anchor-h:right;--anchor-v:span-bottom}.dropdown-start.dropdown-right .dropdown-content{top:0;bottom:auto}.dropdown-bottom{--anchor-v:block-end}.dropdown-bottom .dropdown-content{transform-origin:top;top:100%;bottom:auto}.dropdown-top{--anchor-v:block-start}.dropdown-top .dropdown-content{transform-origin:bottom;top:auto;bottom:100%}.toast-top{--toast-y:0;top:1rem;bottom:auto}.textarea:has(>textarea[disabled]){cursor:not-allowed;border-color:var(--color-base-200);background-color:var(--color-base-200);color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.textarea:has(>textarea[disabled]){color:color-mix(in oklab,var(--color-base-content) 40%,transparent)}}.textarea:has(>textarea[disabled]){box-shadow:none}.textarea:has(>textarea[disabled])::placeholder,.textarea:has(>textarea[disabled]) ::placeholder{color:var(--color-base-content);opacity:.2}.textarea:is(:disabled,[disabled]){cursor:not-allowed;border-color:var(--color-base-200);background-color:var(--color-base-200);color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.textarea:is(:disabled,[disabled]){color:color-mix(in oklab,var(--color-base-content) 40%,transparent)}}.textarea:is(:disabled,[disabled]){box-shadow:none}.textarea:is(:disabled,[disabled])::placeholder,.textarea:is(:disabled,[disabled]) ::placeholder{color:var(--color-base-content);opacity:.2}.textarea:has(>textarea[disabled])>textarea[disabled]{cursor:not-allowed}.btn-active{--btn-bg:var(--btn-color,var(--color-base-200))}@supports (color:color-mix(in lab,red,red)){.btn-active{--btn-bg:color-mix(in oklab, var(--btn-color,var(--color-base-200)), #000 5%)}}.btn-active{color:var(--btn-fg,var(--color-base-content));--btn-border:var(--btn-color,var(--color-base-200))}@supports (color:color-mix(in lab,red,red)){.btn-active{--btn-border:color-mix(in oklab, var(--btn-color,var(--color-base-200)), #000 7%)}}.btn-active{--btn-border-style:solid;--btn-inset:0 0 0 0 oklch(0% 0 0/0);--btn-shadow:0 0 0 0 oklch(0% 0 0/0);isolation:isolate}:is(.stack,.stack.stack-bottom)>*{grid-area:3/3/6/4}:is(.stack,.stack.stack-bottom)>:nth-child(2){grid-area:2/2/5/5}:is(.stack,.stack.stack-bottom)>:first-child{grid-area:1/1/4/6}.stack.stack-top>*{grid-area:1/3/4/4}.stack.stack-top>:nth-child(2){grid-area:2/2/5/5}.stack.stack-top>:first-child{grid-area:3/1/6/6}.stack.stack-start>*{grid-area:3/1/4/4}.stack.stack-start>:nth-child(2){grid-area:2/2/5/5}.stack.stack-start>:first-child{grid-area:1/3/6/6}.stack.stack-end>*{grid-area:3/3/4/6}.stack.stack-end>:nth-child(2){grid-area:2/2/5/5}.stack.stack-end>:first-child{grid-area:1/1/6/4}.tabs-box{background-color:var(--color-base-200);--tabs-box-radius:calc(3 * var(--radius-field));border-radius:calc(min(var(--tab-height) / 2,var(--radius-field)) + min(.25rem,var(--tabs-box-radius)));box-shadow:0 -.5px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 .5px oklch(0% 0 0 / calc(var(--depth) * .05)) inset;padding:.25rem}.tabs-box>.tab{border-radius:var(--radius-field);border-style:none}.tabs-box>.tab:focus-visible,.tabs-box>.tab:is(label:has(:checked:focus-visible)){outline-offset:2px}.tabs-box>.tab:focus-visible{z-index:1}.tabs-box>:is(input:checked){background-color:var(--tab-bg,var(--color-base-100));box-shadow:0 1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px 1px -1px var(--color-neutral),0 1px 6px -4px var(--color-neutral)}@supports (color:color-mix(in lab,red,red)){.tabs-box>:is(input:checked){box-shadow:0 1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px 1px -1px color-mix(in oklab,var(--color-neutral) calc(var(--depth) * 50%),#0000),0 1px 6px -4px color-mix(in oklab,var(--color-neutral) calc(var(--depth) * 100%),#0000)}}@media(forced-colors:active){.tabs-box>:is(input:checked){border:1px solid}}.tabs-box>:is(label:has(:checked)){background-color:var(--tab-bg,var(--color-base-100));box-shadow:0 1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px 1px -1px var(--color-neutral),0 1px 6px -4px var(--color-neutral)}@supports (color:color-mix(in lab,red,red)){.tabs-box>:is(label:has(:checked)){box-shadow:0 1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px 1px -1px color-mix(in oklab,var(--color-neutral) calc(var(--depth) * 50%),#0000),0 1px 6px -4px color-mix(in oklab,var(--color-neutral) calc(var(--depth) * 100%),#0000)}}@media(forced-colors:active){.tabs-box>:is(label:has(:checked)){border:1px solid}}.tabs-lift:has(>.tab-content)>.tab:first-child:not(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]){--tab-border-colors:var(--tab-border-color) var(--tab-border-color) #0000 var(--tab-border-color)}.tabs-lift>.tab-content{--tabcontent-margin:calc(-1 * var(--border)) 0 0 0;--tabcontent-radius-ss:0;--tabcontent-radius-se:var(--radius-box);--tabcontent-radius-es:var(--radius-box);--tabcontent-radius-ee:var(--radius-box)}.tabs-bottom:has(>.tab-content)>.tab:first-child:not(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]){--tab-border-colors:#0000 var(--tab-border-color) var(--tab-border-color) var(--tab-border-color)}.tabs-bottom>.tab-content{--tabcontent-order:0;--tabcontent-margin:0 0 calc(-1 * var(--border)) 0;--tabcontent-radius-ss:var(--radius-box);--tabcontent-radius-se:var(--radius-box);--tabcontent-radius-es:0;--tabcontent-radius-ee:var(--radius-box)}.tabs-box>.tab-content{height:calc(100% - var(--tab-height) + var(--border) - .5rem);border-radius:calc(min(var(--tab-height) / 2,var(--radius-field)) + min(.25rem,var(--tabs-box-radius)) - var(--border));margin-top:.25rem}.chat-start .chat-image{grid-column-start:1}.chat-end .chat-image,.chat-start .chat-footer{grid-column-start:2}.chat-end .chat-footer{grid-column-start:1}.modal-top>.modal-box{--modal-tl:0;--modal-tr:0;--modal-bl:var(--radius-box);--modal-br:var(--radius-box);width:100%;max-width:none;height:auto;max-height:calc(100vh - 5em);translate:0 -100%;scale:1}.modal-middle>.modal-box{--modal-tl:var(--radius-box);--modal-tr:var(--radius-box);--modal-bl:var(--radius-box);--modal-br:var(--radius-box);width:91.6667%;max-width:32rem;height:auto;max-height:calc(100vh - 5em);translate:0 2%;scale:.98}.modal-start>.modal-box{--modal-tl:0;--modal-tr:var(--radius-box);--modal-bl:0;--modal-br:var(--radius-box);width:auto;max-width:none;height:100vh;max-height:none;translate:-100%;scale:1}[dir=rtl] :is(.modal-start>.modal-box){--modal-tl:var(--radius-box);--modal-tr:0;--modal-bl:var(--radius-box);--modal-br:0;translate:100%}.drawer-end>.drawer-toggle~.drawer-content{grid-column-start:1}.divider-vertical.divider{flex-direction:row;width:auto;height:1rem}.divider-vertical.divider:before,.divider-vertical.divider:after{width:100%;height:.125rem}.steps-vertical{grid-auto-rows:1fr;grid-auto-flow:row}.steps-vertical .step{grid-template-rows:auto;grid-template-columns:40px 1fr;justify-items:start;gap:.5rem;min-height:4rem;display:grid}.steps-vertical .step:before{width:.5rem;height:100%;margin-inline-start:50%;translate:-50% -50%}[dir=rtl] :is(.steps-vertical .step):before{translate:50% -50%}.steps-horizontal{grid-auto-columns:1fr;grid-auto-flow:column;display:inline-grid;overflow:auto hidden}.steps-horizontal .step{text-align:center;grid-template-rows:40px 1fr;grid-template-columns:auto;place-items:center;min-width:4rem;display:grid}.steps-horizontal .step:before{width:100%;height:.5rem;margin-inline-start:-100%;translate:0}[dir=rtl] :is(.steps-horizontal .step):before{translate:0}@supports (color:color-mix(in lab,red,red)){.stats-horizontal .stat:not(:last-child){border-inline-end:var(--border) dashed color-mix(in oklab,currentColor 10%,#0000)}.stats-vertical .stat:not(:last-child){border-block-end:var(--border) dashed color-mix(in oklab,currentColor 10%,#0000)}}.modal-end{place-items:end}.modal-end>.modal-box{--modal-tl:var(--radius-box);--modal-tr:0;--modal-bl:var(--radius-box);--modal-br:0;width:auto;max-width:none;height:100vh;max-height:none;translate:100%;scale:1}[dir=rtl] :is(.modal-end>.modal-box){--modal-tl:0;--modal-tr:var(--radius-box);--modal-bl:0;--modal-br:var(--radius-box);translate:-100%}.modal-bottom{place-items:end}.modal-bottom>.modal-box{--modal-tl:var(--radius-box);--modal-tr:var(--radius-box);--modal-bl:0;--modal-br:0;width:100%;max-width:none;height:auto;max-height:calc(100vh - 5em);translate:0 100%;scale:1}.divider-horizontal{--divider-m:0 1rem}.divider-horizontal.divider{flex-direction:column;width:1rem;height:auto}.divider-horizontal.divider:before,.divider-horizontal.divider:after{width:.125rem;height:100%}.btn-circle{width:var(--size);height:var(--size);border-radius:3.40282e38px;padding-inline:0}.btn-square{width:var(--size);height:var(--size);padding-inline:0}.loading-md{width:calc(var(--size-selector,.25rem) * 6)}.loading-sm{width:calc(var(--size-selector,.25rem) * 5)}.swap .swap-on,.swap input:indeterminate~.swap-on{opacity:0}.swap input:checked~.swap-on{opacity:1;backface-visibility:visible}.swap input:is(:checked,:indeterminate)~.swap-off,.swap .swap-indeterminate{opacity:0}.swap input:indeterminate~.swap-indeterminate{opacity:1;backface-visibility:visible}.aura-glow{background-image:radial-gradient(closest-corner,currentColor 0%,#0000 90%);animation:none}.aura-glow:before{animation:aura-glow var(--tw-duration,6s) ease-out infinite}@media(prefers-reduced-motion:reduce){.aura-glow:before{animation-duration:calc(var(--tw-duration,6s) * 4)}}.aura-glow:after{animation:aura-glow-after var(--tw-duration,6s) ease-out infinite}@media(prefers-reduced-motion:reduce){.aura-glow:after{animation-duration:calc(var(--tw-duration,6s) * 4)}}.alert-vertical{text-align:center;grid-template-columns:auto;grid-auto-flow:row;justify-content:center;justify-items:center}.alert-vertical:has(>:nth-child(2)){grid-template-columns:auto}.stats-horizontal{grid-auto-flow:column;overflow-x:auto}.stats-horizontal .stat:not(:last-child){border-inline-end:var(--border) dashed currentColor}@supports (color:color-mix(in lab,red,red)){.stats-horizontal .stat:not(:last-child){border-inline-end:var(--border) dashed color-mix(in oklab,currentColor 10%,#0000)}}.stats-horizontal .stat:not(:last-child){border-block-end:none}.stats-vertical{grid-auto-flow:row;overflow-y:auto}.stats-vertical .stat:not(:last-child){border-inline-end:none;border-block-end:var(--border) dashed currentColor}@supports (color:color-mix(in lab,red,red)){.stats-vertical .stat:not(:last-child){border-block-end:var(--border) dashed color-mix(in oklab,currentColor 10%,#0000)}}.chat-bubble-primary{background-color:var(--color-primary);color:var(--color-primary-content)}:is(.tabs-lift :checked,.tabs-lift label:has(:checked),.tabs-lift :is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]))+.tab-content:first-child,:is(.tabs-lift :checked,.tabs-lift label:has(:checked),.tabs-lift :is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]))+.tab-content:nth-child(n+3),:is(.tabs-top :checked,.tabs-top label:has(:checked),.tabs-top :is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]))+.tab-content:first-child,:is(.tabs-top :checked,.tabs-top label:has(:checked),.tabs-top :is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]))+.tab-content:nth-child(n+3){--tabcontent-radius-ss:var(--radius-box)}:is(.tabs-bottom>:checked,.tabs-bottom>:is(label:has(:checked)),.tabs-bottom>:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]))+.tab-content:not(:nth-child(2)){--tabcontent-radius-es:var(--radius-box)}.tabs-box>:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]){background-color:var(--tab-bg,var(--color-base-100));box-shadow:0 1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px 1px -1px var(--color-neutral),0 1px 6px -4px var(--color-neutral)}@supports (color:color-mix(in lab,red,red)){.tabs-box>:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]){box-shadow:0 1px oklch(100% 0 0 / calc(var(--depth) * .1)) inset,0 1px 1px -1px color-mix(in oklab,var(--color-neutral) calc(var(--depth) * 50%),#0000),0 1px 6px -4px color-mix(in oklab,var(--color-neutral) calc(var(--depth) * 100%),#0000)}}@media(forced-colors:active){.tabs-box>:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]){border:1px solid}}.loading-spinner{-webkit-mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='8s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='8s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='6s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E")}@media(prefers-reduced-motion:no-preference){.loading-spinner{-webkit-mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='2s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg width='24' height='24' stroke='black' viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cg transform-origin='center'%3E%3Ccircle cx='12' cy='12' r='9.5' fill='none' stroke-width='3' stroke-linecap='round'%3E%3CanimateTransform attributeName='transform' type='rotate' from='0 12 12' to='360 12 12' dur='2s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dasharray' values='0,150;42,150;42,150' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3Canimate attributeName='stroke-dashoffset' values='0;-16;-59' keyTimes='0;0.475;1' dur='1.5s' repeatCount='indefinite'/%3E%3C/circle%3E%3C/g%3E%3C/svg%3E")}}.checkbox-sm{--size:calc(var(--size-selector,.25rem) * 5);padding:.1875rem}.badge-lg{--size:calc(var(--size-selector,.25rem) * 7);font-size:1rem}.badge-sm{--size:calc(var(--size-selector,.25rem) * 5);font-size:.75rem}.alert-error{color:var(--color-error-content);--alert-border-color:var(--color-error);--alert-color:var(--color-error)}.alert-info{color:var(--color-info-content);--alert-border-color:var(--color-info);--alert-color:var(--color-info)}.alert-success{color:var(--color-success-content);--alert-border-color:var(--color-success);--alert-color:var(--color-success)}.alert-warning{color:var(--color-warning-content);--alert-border-color:var(--color-warning);--alert-color:var(--color-warning)}.checkbox-primary{color:var(--color-primary-content);--input-color:var(--color-primary)}.progress-neutral{color:var(--color-neutral)}.progress-primary{color:var(--color-primary)}.drawer-toggle:focus-visible~.drawer-content label.drawer-button{outline-offset:2px;outline:2px solid}.tabs-top{--tabs-height:auto;--tabs-direction:row}.tabs-top>.tab{--tab-order:0;--tab-border:0 0 var(--border) 0;--tab-radius-ss:var(--tab-radius-limit);--tab-radius-se:var(--tab-radius-limit);--tab-radius-es:0;--tab-radius-ee:0;--tab-paddings:var(--border) var(--tab-p) 0 var(--tab-p);--tab-border-colors:#0000 #0000 var(--tab-border-color) #0000;--tab-corner-width:calc(100% + var(--tab-radius-limit) * 2);--tab-corner-height:var(--tab-radius-limit);--tab-corner-position:top left, top right}.tabs-top>.tab:is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]):not(.tab-disabled,[disabled]),.tabs-top>.tab:is(input:checked),.tabs-top>.tab:is(label:has(:checked)){--tab-border:var(--border) var(--border) 0 var(--border);--tab-border-colors:var(--tab-border-color) var(--tab-border-color) #0000 var(--tab-border-color);--tab-paddings:0 calc(var(--tab-p) - var(--border)) var(--border) calc(var(--tab-p) - var(--border));--tab-inset:auto auto 0 auto;--radius-start:radial-gradient(circle at top left, var(--tab-radius-grad));--radius-end:radial-gradient(circle at top right, var(--tab-radius-grad))}.tabs-top:has(>.tab-content)>.tab:first-child:not(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]){--tab-border-colors:var(--tab-border-color) var(--tab-border-color) #0000 var(--tab-border-color)}.tabs-top>.tab-content{--tabcontent-order:1;--tabcontent-margin:calc(-1 * var(--border)) 0 0 0;--tabcontent-radius-ss:0;--tabcontent-radius-se:var(--radius-box);--tabcontent-radius-es:var(--radius-box);--tabcontent-radius-ee:var(--radius-box)}:is(.tabs-top :checked,.tabs-top label:has(:checked),.tabs-top :is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]))+.tab-content:first-child,:is(.tabs-top :checked,.tabs-top label:has(:checked),.tabs-top :is(.tab-active,[aria-selected=true],[aria-current=true],[aria-current=page]))+.tab-content:nth-child(n+3){--tabcontent-radius-ss:var(--radius-box)}.steps .step-neutral>.step-icon{--step-bg:var(--color-neutral);--step-fg:var(--color-neutral-content)}.steps .step-primary>.step-icon{--step-bg:var(--color-primary);--step-fg:var(--color-primary-content)}.steps .step-secondary>.step-icon{--step-bg:var(--color-secondary);--step-fg:var(--color-secondary-content)}.steps .step-accent>.step-icon{--step-bg:var(--color-accent);--step-fg:var(--color-accent-content)}.steps .step-info>.step-icon{--step-bg:var(--color-info);--step-fg:var(--color-info-content)}.steps .step-success>.step-icon{--step-bg:var(--color-success);--step-fg:var(--color-success-content)}.steps .step-warning>.step-icon{--step-bg:var(--color-warning);--step-fg:var(--color-warning-content)}.steps .step-error>.step-icon{--step-bg:var(--color-error);--step-fg:var(--color-error-content)}.input-sm{--in-size-mul:8;--font-size-min:.75rem;--spin-my:-2}.floating-label:has(.input-sm){--top-mul:4;--font-size:.75rem}.btn-neutral{--btn-color:var(--color-neutral);--btn-fg:var(--color-neutral-content);--btn-soft-bg:var(--color-neutral-content) 80%;--btn-rest-fg:initial}.btn-error{--btn-color:var(--color-error);--btn-fg:var(--color-error-content);--btn-soft-bg:initial}.btn-info{--btn-color:var(--color-info);--btn-fg:var(--color-info-content);--btn-soft-bg:initial}.btn-primary{--btn-color:var(--color-primary);--btn-fg:var(--color-primary-content);--btn-soft-bg:initial}.btn-secondary{--btn-color:var(--color-secondary);--btn-fg:var(--color-secondary-content);--btn-soft-bg:initial}.btn-sm{--fontsize:.75rem;--btn-p:.75rem;--size:calc(var(--size-field,.25rem) * 8)}.btn-success{--btn-color:var(--color-success);--btn-fg:var(--color-success-content);--btn-soft-bg:initial}.btn-warning{--btn-color:var(--color-warning);--btn-fg:var(--color-warning-content);--btn-soft-bg:initial}.btn-xs{--fontsize:.6875rem;--btn-p:.5rem;--size:calc(var(--size-field,.25rem) * 6)}.card-lg .card-body{--card-p:2rem;--card-fs:1rem}.card-lg .card-title{--cardtitle-fs:1.25rem}.card-md .card-body{--card-p:1.5rem;--card-fs:.875rem}.card-md .card-title{--cardtitle-fs:1.125rem}.card-sm .card-body{--card-p:1rem;--card-fs:.75rem}.card-sm .card-title{--cardtitle-fs:1rem}.card-xl .card-body{--card-p:2.5rem;--card-fs:1.125rem}.card-xl .card-title{--cardtitle-fs:1.375rem}.card-xs .card-body{--card-p:.5rem;--card-fs:.6875rem}.card-xs .card-title{--cardtitle-fs:.875rem}.badge-error{--badge-color:var(--color-error);--badge-fg:var(--color-error-content)}.badge-primary{--badge-color:var(--color-primary);--badge-fg:var(--color-primary-content)}.badge-secondary{--badge-color:var(--color-secondary);--badge-fg:var(--color-secondary-content)}.badge-success{--badge-color:var(--color-success);--badge-fg:var(--color-success-content)}.toggle-sm[type=checkbox],.toggle-sm:has([type=checkbox]){--size:calc(var(--size-selector,.25rem) * 5)}@media(prefers-reduced-motion:no-preference){.collapse:not(td,tr,colgroup)[open].collapse-arrow>.collapse-title:after,.collapse:not(td,tr,colgroup).collapse-open.collapse-arrow>.collapse-title:after{transform:translateY(-50%)rotate(225deg)}}.collapse:not(td,tr,colgroup).collapse-open.collapse-plus>.collapse-title:after{--tw-content:"−";content:var(--tw-content)}:is(.collapse:not(td,tr,colgroup)[tabindex].collapse-arrow:focus:not(.collapse-close),.collapse:not(td,tr,colgroup).collapse-arrow[tabindex]:focus-within:not(.collapse-close))>.collapse-title:after,.collapse:not(td,tr,colgroup).collapse-arrow:not(.collapse-close)>input:is([type=checkbox],[type=radio]):checked~.collapse-title:after{transform:translateY(-50%)rotate(225deg)}.collapse:not(td,tr,colgroup)[open].collapse-plus>.collapse-title:after,.collapse:not(td,tr,colgroup)[tabindex].collapse-plus:focus:not(.collapse-close)>.collapse-title:after,.collapse:not(td,tr,colgroup).collapse-plus:not(.collapse-close)>input:is([type=checkbox],[type=radio]):checked~.collapse-title:after{--tw-content:"−";content:var(--tw-content)}:is(.validator:user-invalid,.validator:has(:user-invalid),.validator[aria-invalid]:not([aria-invalid=false]),.validator:has([aria-invalid]:not([aria-invalid=false])))~.validator-hint{color:var(--color-error);visibility:visible}}.\\@container\\/card-header{container:card-header/inline-size}.\\@container{container-type:inline-size}@layer daisyui.l1{.drawer-open>.drawer-toggle~.drawer-side>:not(.drawer-overlay),[dir=rtl] :is(.drawer-open>.drawer-toggle~.drawer-side>:not(.drawer-overlay)){translate:0%}@media(hover:hover){.btn:hover{--btn-bg:var(--btn-color,var(--color-base-200))}@supports (color:color-mix(in lab,red,red)){.btn:hover{--btn-bg:color-mix(in oklab, var(--btn-color,var(--color-base-200)), #000 7%)}}.btn:hover{color:var(--btn-fg);--btn-border:var(--btn-bg)}@supports (color:color-mix(in lab,red,red)){.btn:hover{--btn-border:color-mix(in oklab, var(--btn-bg), #000 calc(var(--depth) * 5%))}}.btn:hover{--btn-border-style:solid;--btn-inset:0 .5px 0 .5px oklch(100% 0 0 / calc(var(--depth) * 6%));--btn-shadow:0 3px 2px -2px var(--btn-bg), 0 4px 3px -2px var(--btn-bg)}@supports (color:color-mix(in lab,red,red)){.btn:hover{--btn-shadow:0 3px 2px -2px color-mix(in oklab, var(--btn-bg) calc(var(--depth) * 30%), #0000), 0 4px 3px -2px color-mix(in oklab, var(--btn-bg) calc(var(--depth) * 30%), #0000)}}}.btn:active:not(.btn-active,[aria-pressed=true],[aria-checked=true],[aria-current]:not([aria-current=false],[aria-current=""])){--btn-bg:var(--btn-color,var(--color-base-200));translate:0 .5px}@supports (color:color-mix(in lab,red,red)){.btn:active:not(.btn-active,[aria-pressed=true],[aria-checked=true],[aria-current]:not([aria-current=false],[aria-current=""])){--btn-bg:color-mix(in oklab, var(--btn-color,var(--color-base-200)), #000 5%)}}.btn:active:not(.btn-active,[aria-pressed=true],[aria-checked=true],[aria-current]:not([aria-current=false],[aria-current=""])){color:var(--btn-fg,var(--color-base-content));--btn-border:var(--btn-color,var(--color-base-200))}@supports (color:color-mix(in lab,red,red)){.btn:active:not(.btn-active,[aria-pressed=true],[aria-checked=true],[aria-current]:not([aria-current=false],[aria-current=""])){--btn-border:color-mix(in oklab, var(--btn-color,var(--color-base-200)), #000 7%)}}.btn:active:not(.btn-active,[aria-pressed=true],[aria-checked=true],[aria-current]:not([aria-current=false],[aria-current=""])){--btn-border-style:solid;--btn-inset:0 0 0 0 oklch(0% 0 0/0);--btn-shadow:0 0 0 0 oklch(0% 0 0/0)}.btn:where(:checked:not(.filter [type=radio].btn),:not([type=radio],[type=checkbox]):focus-visible){--btn-bg:var(--btn-color,var(--color-base-200));color:var(--btn-fg,var(--color-base-content));--btn-border:var(--btn-bg)}@supports (color:color-mix(in lab,red,red)){.btn:where(:checked:not(.filter [type=radio].btn),:not([type=radio],[type=checkbox]):focus-visible){--btn-border:color-mix(in oklab, var(--btn-bg), #000 calc(var(--depth) * 5%))}}.btn:where(:checked:not(.filter [type=radio].btn),:not([type=radio],[type=checkbox]):focus-visible){--btn-border-style:solid;--btn-inset:0 .5px 0 .5px oklch(100% 0 0 / calc(var(--depth) * 6%));--btn-shadow:0 3px 2px -2px var(--btn-bg), 0 4px 3px -2px var(--btn-bg)}@supports (color:color-mix(in lab,red,red)){.btn:where(:checked:not(.filter [type=radio].btn),:not([type=radio],[type=checkbox]):focus-visible){--btn-shadow:0 3px 2px -2px color-mix(in oklab, var(--btn-bg) calc(var(--depth) * 30%), #0000), 0 4px 3px -2px color-mix(in oklab, var(--btn-bg) calc(var(--depth) * 30%), #0000)}}.btn:where(:checked:not(.filter [type=radio].btn),:not([type=radio],[type=checkbox]):focus-visible){isolation:isolate}.btn:focus-visible,.btn:has(:focus-visible){isolation:isolate;outline-width:2px;outline-style:solid}.filter:not(:has(:focus-visible)):has(:checked:not(.filter-reset,[type=checkbox])) :is(input,button):not(:checked,.filter-reset,[type=reset]){opacity:0;border-width:0;width:0;margin-inline:0;padding-inline:0;scale:0}.filter:not(:has(:checked:not(.filter-reset))) :is(.filter-reset,[type=reset]):not(:focus-visible){visibility:hidden;opacity:0;border-width:0;width:0;margin-inline:0;padding-inline:0;scale:0}.swap-flip .swap-on,.swap-flip input:indeterminate~.swap-on{backface-visibility:hidden;transform:rotateY(180deg)}.swap-active .swap-on{opacity:1}.swap-rotate.swap-active .swap-on{rotate:0deg}.swap-rotate.swap-active .swap-off{rotate:-45deg}.swap-flip.swap-active .swap-on{transform:rotateY(0)}.swap-flip.swap-active .swap-off{backface-visibility:hidden;opacity:1;transform:rotateY(-180deg)}.swap-active .swap-off{opacity:0}.swap-active.swap-rotate .swap-on{rotate:0deg}.swap-active.swap-rotate .swap-off{rotate:-45deg}.swap-rotate .swap-on,.swap-rotate input:indeterminate~.swap-on{rotate:45deg}.swap-rotate input:is(:checked,:indeterminate)~.swap-on,.swap-rotate.swap-active .swap-on{rotate:0deg}.swap-rotate input:is(:checked,:indeterminate)~.swap-off,.swap-rotate.swap-active .swap-off{rotate:-45deg}.swap-active.swap-flip .swap-on{transform:rotateY(0)}.swap-active.swap-flip .swap-off{backface-visibility:hidden;opacity:1;transform:rotateY(-180deg)}.swap-flip{transform-style:preserve-3d;perspective:20rem}.swap-flip .swap-on,.swap-flip .swap-indeterminate,.swap-flip input:indeterminate~.swap-on{backface-visibility:hidden;transform:rotateY(180deg)}.swap-flip input:is(:checked,:indeterminate)~.swap-on,.swap-flip.swap-active .swap-on{transform:rotateY(0)}.swap-flip input:is(:checked,:indeterminate)~.swap-off,.swap-flip.swap-active .swap-off{backface-visibility:hidden;opacity:1;transform:rotateY(-180deg)}.swap-flip .swap-indeterminate{backface-visibility:hidden;transform:rotateY(180deg)}.alert-soft{color:var(--alert-color,var(--color-base-content));background:var(--alert-color,var(--color-base-content))}@supports (color:color-mix(in lab,red,red)){.alert-soft{background:color-mix(in oklab,var(--alert-color,var(--color-base-content)) 8%,var(--color-base-100))}}.alert-soft{--alert-border-color:var(--alert-color,var(--color-base-content))}@supports (color:color-mix(in lab,red,red)){.alert-soft{--alert-border-color:color-mix(in oklab, var(--alert-color,var(--color-base-content)) 10%, var(--color-base-100))}}.alert-soft{box-shadow:none;background-image:none}}.prose :where(a.btn:not(.btn-link)):not(:where([class~=not-prose],[class~=not-prose] *)){text-decoration-line:none}@layer daisyui{.btn:is(.btn-disabled,:disabled,[disabled],[aria-disabled=true]){pointer-events:none;color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.btn:is(.btn-disabled,:disabled,[disabled],[aria-disabled=true]){color:color-mix(in oklch,var(--color-base-content) 20%,#0000)}}.btn:is(.btn-disabled,:disabled,[disabled],[aria-disabled=true]){--btn-bg:#0000;--btn-border:#0000;--btn-inset:0 0 0 0 oklch(0% 0 0/0);--btn-shadow:0 0 0 0 oklch(0% 0 0/0);background-image:none}.btn:is(.btn-disabled,:disabled,[disabled],[aria-disabled=true]):not(.btn-link,.btn-ghost){background-color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.btn:is(.btn-disabled,:disabled,[disabled],[aria-disabled=true]):not(.btn-link,.btn-ghost){background-color:color-mix(in oklab,var(--color-base-content) 10%,transparent)}}.btn-link{--btn-bg:#0000;color:var(--btn-color,var(--color-primary));--btn-border:#0000;--btn-inset:0 0 0 0 oklch(0% 0 0/0);--btn-shadow:0 0 0 0 oklch(0% 0 0/0);background-image:none;text-decoration-line:underline}}.pointer-events-none{pointer-events:none}.collapse:not(td,tr,colgroup){visibility:revert-layer}:is(.validator:user-invalid,.validator:has(:user-invalid),.validator[aria-invalid]:not([aria-invalid=false]),.validator:has([aria-invalid]:not([aria-invalid=false])))~.validator-hint{display:revert-layer}.collapse{visibility:collapse}.invisible{visibility:hidden}.visible{visibility:visible}:is(.input[type=url],.input[type=tel],.input[type=email],.input[type=number]):dir(rtl){border-start-start-radius:var(--join-se,var(--radius-field));border-start-end-radius:var(--join-ss,var(--radius-field));border-end-end-radius:var(--join-es,var(--radius-field));border-end-start-radius:var(--join-ee,var(--radius-field))}.sr-only{clip-path:inset(50%);white-space:nowrap;border-width:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.not-sr-only{clip-path:none;white-space:normal;width:auto;height:auto;margin:0;padding:0;position:static;overflow:visible}@layer daisyui.l1.l2.l3.l4{.card-body p{flex-grow:1}.card figure:first-child{border-start-start-radius:inherit;border-start-end-radius:inherit;border-end-end-radius:unset;border-end-start-radius:unset;overflow:hidden}.card figure:last-child{border-start-start-radius:unset;border-start-end-radius:unset;border-end-end-radius:inherit;border-end-start-radius:inherit;overflow:hidden}.card figure{justify-content:center;align-items:center;display:flex}}.absolute{position:absolute}.fixed{position:fixed}.relative{position:relative}.static{position:static}.sticky{position:sticky}.inset-0{inset:0}.inset-y-0{inset-block:0}.inset-s-1{inset-inline-start:var(--spacing)}.inset-s-1\\/2{inset-inline-start:50%}.top-0{top:0}.top-1{top:var(--spacing)}.top-1\\.5{top:calc(var(--spacing) * 1.5)}.top-4{top:calc(var(--spacing) * 4)}.top-full{top:100%}.right-0{right:0}.right-1{right:var(--spacing)}.right-1\\.5{right:calc(var(--spacing) * 1.5)}.right-2{right:calc(var(--spacing) * 2)}.right-3{right:calc(var(--spacing) * 3)}.right-4{right:calc(var(--spacing) * 4)}.bottom-0{bottom:0}.bottom-1{bottom:var(--spacing)}.bottom-1\\.5{bottom:calc(var(--spacing) * 1.5)}.bottom-full{bottom:100%}.left-0{left:0}.left-1{left:var(--spacing)}.left-1\\.5{left:calc(var(--spacing) * 1.5)}.left-3{left:calc(var(--spacing) * 3)}.isolate{isolation:isolate}.join{--join-ss:0;--join-se:0;--join-es:0;--join-ee:0;--join-ml:0;--join-mt:0;--join-v:0;--join-h:1;align-items:stretch;display:inline-flex}@scope(.join){:scope>:where(:focus,:has(:focus)){z-index:2}@media(hover:hover){:scope>:where(.btn:hover,:has(.btn:hover)){z-index:1}}:scope :where(:scope>:first-child){--join-ss:var(--radius-field);--join-se:calc(var(--radius-field) * var(--join-v));--join-es:calc(var(--radius-field) * var(--join-h));--join-ee:0}:scope :where(:scope>:last-child){--join-ss:0;--join-se:calc(var(--radius-field) * var(--join-h));--join-es:calc(var(--radius-field) * var(--join-v));--join-ee:var(--radius-field)}:scope :where(:scope>:only-child){--join-ss:var(--radius-field);--join-se:var(--radius-field);--join-es:var(--radius-field);--join-ee:var(--radius-field)}:scope :where(:scope>:not(:first-child)){--join-ml:calc(var(--border,1px) * -1 * var(--join-h));--join-mt:calc(var(--border,1px) * -1 * var(--join-v))}}.z-10{z-index:10}.z-20{z-index:20}.z-30{z-index:30}.z-50{z-index:50}.z-\\[2\\]{z-index:2}.z-\\[1000012\\]{z-index:1000012}.order-first{order:-9999}.order-last{order:9999}.col-start-2{grid-column-start:2}.row-span-2{grid-row:span 2/span 2}.row-start-1{grid-row-start:1}.container{width:100%}@media(min-width:40rem){.container{max-width:40rem}}@media(min-width:48rem){.container{max-width:48rem}}@media(min-width:64rem){.container{max-width:64rem}}@media(min-width:80rem){.container{max-width:80rem}}@media(min-width:96rem){.container{max-width:96rem}}.m-0{margin:0}.-mx-1{margin-inline:calc(var(--spacing) * -1)}.mx-3{margin-inline:calc(var(--spacing) * 3)}.mx-auto{margin-inline:auto}.-my-2{margin-block:calc(var(--spacing) * -2)}.my-1{margin-block:var(--spacing)}.my-2{margin-block:calc(var(--spacing) * 2)}.my-3{margin-block:calc(var(--spacing) * 3)}.my-4{margin-block:calc(var(--spacing) * 4)}.my-8{margin-block:calc(var(--spacing) * 8)}.mt-0{margin-top:0}.mt-0\\.5{margin-top:calc(var(--spacing) * .5)}.mt-1{margin-top:var(--spacing)}.mt-1\\.5{margin-top:calc(var(--spacing) * 1.5)}.mt-2{margin-top:calc(var(--spacing) * 2)}.mt-2\\.5{margin-top:calc(var(--spacing) * 2.5)}.mt-3{margin-top:calc(var(--spacing) * 3)}.mt-4{margin-top:calc(var(--spacing) * 4)}.mt-auto{margin-top:auto}.mt-px{margin-top:1px}.mr-1{margin-right:var(--spacing)}.mr-1\\.5{margin-right:calc(var(--spacing) * 1.5)}.mr-auto{margin-right:auto}.mb-1{margin-bottom:var(--spacing)}.mb-1\\.5{margin-bottom:calc(var(--spacing) * 1.5)}.mb-2{margin-bottom:calc(var(--spacing) * 2)}.mb-2\\.5{margin-bottom:calc(var(--spacing) * 2.5)}.mb-3{margin-bottom:calc(var(--spacing) * 3)}.mb-3\\.5{margin-bottom:calc(var(--spacing) * 3.5)}.ml-0{margin-left:0}.ml-0\\.5{margin-left:calc(var(--spacing) * .5)}.ml-1{margin-left:var(--spacing)}.ml-2{margin-left:calc(var(--spacing) * 2)}.ml-4{margin-left:calc(var(--spacing) * 4)}.ml-auto{margin-left:auto}.kbd{box-shadow:none}.alert{border-width:var(--border);border-color:var(--alert-border-color,var(--color-base-200))}.line-clamp-1{-webkit-line-clamp:1;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}.line-clamp-2{-webkit-line-clamp:2;-webkit-box-orient:vertical;display:-webkit-box;overflow:hidden}:root .prose{--tw-prose-body:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:root .prose{--tw-prose-body:color-mix(in oklab, var(--color-base-content) 80%, #0000)}}:root .prose{--tw-prose-headings:var(--color-base-content);--tw-prose-lead:var(--color-base-content);--tw-prose-links:var(--color-base-content);--tw-prose-bold:var(--color-base-content);--tw-prose-counters:var(--color-base-content);--tw-prose-bullets:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:root .prose{--tw-prose-bullets:color-mix(in oklab, var(--color-base-content) 50%, #0000)}}:root .prose{--tw-prose-hr:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:root .prose{--tw-prose-hr:color-mix(in oklab, var(--color-base-content) 20%, #0000)}}:root .prose{--tw-prose-quotes:var(--color-base-content);--tw-prose-quote-borders:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:root .prose{--tw-prose-quote-borders:color-mix(in oklab, var(--color-base-content) 20%, #0000)}}:root .prose{--tw-prose-captions:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:root .prose{--tw-prose-captions:color-mix(in oklab, var(--color-base-content) 50%, #0000)}}:root .prose{--tw-prose-code:var(--color-base-content);--tw-prose-pre-code:var(--color-neutral-content);--tw-prose-pre-bg:var(--color-neutral);--tw-prose-th-borders:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:root .prose{--tw-prose-th-borders:color-mix(in oklab, var(--color-base-content) 50%, #0000)}}:root .prose{--tw-prose-td-borders:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:root .prose{--tw-prose-td-borders:color-mix(in oklab, var(--color-base-content) 20%, #0000)}}:root .prose{--tw-prose-kbd:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:root .prose{--tw-prose-kbd:color-mix(in oklab, var(--color-base-content) 80%, #0000)}}:root .prose :where(code):not(pre>code){background-color:var(--color-base-200);border-radius:var(--radius-selector);border:var(--border) solid var(--color-base-300);font-weight:inherit;padding-block:.2em;padding-inline:.5em}:root .prose :where(code):not(pre>code):before,:root .prose :where(code):not(pre>code):after{display:none}.block{display:block}.contents{display:contents}.flex{display:flex}.flow-root{display:flow-root}.grid{display:grid}.hidden{display:none}.inline{display:inline}.inline-block{display:inline-block}.inline-flex{display:inline-flex}.table{display:table}.table-caption{display:table-caption}.table-cell{display:table-cell}.table-column{display:table-column}.table-column-group{display:table-column-group}.table-footer-group{display:table-footer-group}.table-header-group{display:table-header-group}.table-row{display:table-row}.field-sizing-content{field-sizing:content}.aspect-square{aspect-ratio:1}.\\!size-7{width:calc(var(--spacing) * 7)!important;height:calc(var(--spacing) * 7)!important}.size-1{width:var(--spacing);height:var(--spacing)}.size-1\\.5{width:calc(var(--spacing) * 1.5);height:calc(var(--spacing) * 1.5)}.size-4{width:calc(var(--spacing) * 4);height:calc(var(--spacing) * 4)}.size-5{width:calc(var(--spacing) * 5);height:calc(var(--spacing) * 5)}.size-6{width:calc(var(--spacing) * 6);height:calc(var(--spacing) * 6)}.size-7{width:calc(var(--spacing) * 7);height:calc(var(--spacing) * 7)}.size-8{width:calc(var(--spacing) * 8);height:calc(var(--spacing) * 8)}.size-9{width:calc(var(--spacing) * 9);height:calc(var(--spacing) * 9)}.size-10{width:calc(var(--spacing) * 10);height:calc(var(--spacing) * 10)}.size-\\[22px\\]{width:22px;height:22px}.size-\\[26px\\]{width:26px;height:26px}.size-\\[124px\\]{width:124px;height:124px}.size-full{width:100%;height:100%}.h-1{height:var(--spacing)}.h-4{height:calc(var(--spacing) * 4)}.h-5{height:calc(var(--spacing) * 5)}.h-6{height:calc(var(--spacing) * 6)}.h-7{height:calc(var(--spacing) * 7)}.h-8{height:calc(var(--spacing) * 8)}.h-9{height:calc(var(--spacing) * 9)}.h-10{height:calc(var(--spacing) * 10)}.h-14{height:calc(var(--spacing) * 14)}.h-140{height:calc(var(--spacing) * 140)}.h-168{height:calc(var(--spacing) * 168)}.h-\\[58vh\\]{height:58vh}.h-\\[360px\\]{height:360px}.h-\\[672px\\]{height:672px}.h-auto{height:auto}.h-full{height:100%}.h-max{height:max-content}.h-px{height:1px}.h-screen{height:100vh}.max-h-\\(--reka-dropdown-menu-content-available-height\\){max-height:var(--reka-dropdown-menu-content-available-height)}.max-h-14{max-height:calc(var(--spacing) * 14)}.max-h-\\[60vh\\]{max-height:60vh}.max-h-\\[120px\\]{max-height:120px}.max-h-\\[calc\\(100vh-96px\\)\\]{max-height:calc(100vh - 96px)}.max-h-full{max-height:100%}.min-h-0{min-height:0}.min-h-4{min-height:calc(var(--spacing) * 4)}.min-h-10{min-height:calc(var(--spacing) * 10)}.min-h-16{min-height:calc(var(--spacing) * 16)}.min-h-full{min-height:100%}.w-\\(--reka-dropdown-menu-trigger-width\\){width:var(--reka-dropdown-menu-trigger-width)}.w-4{width:calc(var(--spacing) * 4)}.w-8{width:calc(var(--spacing) * 8)}.w-11{width:calc(var(--spacing) * 11)}.w-44{width:calc(var(--spacing) * 44)}.w-\\[112px\\]{width:112px}.w-\\[132px\\]{width:132px}.w-\\[360px\\]{width:360px}.w-\\[768px\\]{width:768px}.w-auto{width:auto}.w-fit{width:fit-content}.w-full{width:100%}.w-screen{width:100vw}.\\!max-w-\\[62\\%\\]{max-width:62%!important}.\\!max-w-\\[74\\%\\]{max-width:74%!important}.max-w-\\[62\\%\\]{max-width:62%}.max-w-\\[74\\%\\]{max-width:74%}.max-w-\\[80\\%\\]{max-width:80%}.max-w-\\[94vw\\]{max-width:94vw}.max-w-\\[240px\\]{max-width:240px}.max-w-\\[320px\\]{max-width:320px}.max-w-\\[360px\\]{max-width:360px}.max-w-full{max-width:100%}.max-w-lg{max-width:var(--container-lg)}.max-w-none{max-width:none}.max-w-sm{max-width:var(--container-sm)}.min-w-0{min-width:0}.min-w-4{min-width:calc(var(--spacing) * 4)}.min-w-8{min-width:calc(var(--spacing) * 8)}.min-w-32{min-width:calc(var(--spacing) * 32)}.flex-1{flex:1}.flex-none{flex:none}.shrink{flex-shrink:1}.shrink-0{flex-shrink:0}.grow{flex-grow:1}.basis-\\[52px\\]{flex-basis:52px}.basis-\\[86px\\]{flex-basis:86px}.basis-full{flex-basis:100%}.origin-\\(--reka-dropdown-menu-content-transform-origin\\){transform-origin:var(--reka-dropdown-menu-content-transform-origin)}.-translate-x-1{--tw-translate-x:calc(var(--spacing) * -1);translate:var(--tw-translate-x) var(--tw-translate-y)}.-translate-x-1\\/2{--tw-translate-x: -50% ;translate:var(--tw-translate-x) var(--tw-translate-y)}.-translate-y-1{--tw-translate-y:calc(var(--spacing) * -1);translate:var(--tw-translate-x) var(--tw-translate-y)}.-translate-y-3{--tw-translate-y:calc(var(--spacing) * -3);translate:var(--tw-translate-x) var(--tw-translate-y)}.translate-y-3{--tw-translate-y:calc(var(--spacing) * 3);translate:var(--tw-translate-x) var(--tw-translate-y)}.transform{transform:var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)}.animate-spin{animation:var(--animate-spin)}.cursor-default{cursor:default}.cursor-move{cursor:move}.cursor-not-allowed{cursor:not-allowed}.cursor-pointer{cursor:pointer}.cursor-text{cursor:text}.cursor-zoom-in{cursor:zoom-in}.touch-none{touch-action:none}.resize{resize:both}.resize-none{resize:none}.scrollbar-thin{scrollbar-width:thin}.scrollbar-gutter-stable{scrollbar-gutter:stable}.list-disc{list-style-type:disc}.auto-rows-min{grid-auto-rows:min-content}.grid-cols-4{grid-template-columns:repeat(4,minmax(0,1fr))}.grid-cols-5{grid-template-columns:repeat(5,minmax(0,1fr))}.grid-cols-6{grid-template-columns:repeat(6,minmax(0,1fr))}.grid-cols-8{grid-template-columns:repeat(8,minmax(0,1fr))}.flex-col{flex-direction:column}.flex-col-reverse{flex-direction:column-reverse}.flex-row{flex-direction:row}.flex-wrap{flex-wrap:wrap}.place-content-center{place-content:center}.place-items-center{place-items:center}.items-baseline{align-items:baseline}.items-center{align-items:center}.items-end{align-items:flex-end}.items-start{align-items:flex-start}.justify-between{justify-content:space-between}.justify-center{justify-content:center}.justify-end{justify-content:flex-end}.justify-start{justify-content:flex-start}.gap-0{gap:0}.gap-0\\.5{gap:calc(var(--spacing) * .5)}.gap-1{gap:var(--spacing)}.gap-1\\.5{gap:calc(var(--spacing) * 1.5)}.gap-2{gap:calc(var(--spacing) * 2)}.gap-2\\.5{gap:calc(var(--spacing) * 2.5)}.gap-3{gap:calc(var(--spacing) * 3)}.gap-4{gap:calc(var(--spacing) * 4)}.gap-6{gap:calc(var(--spacing) * 6)}.gap-7{gap:calc(var(--spacing) * 7)}.gap-8{gap:calc(var(--spacing) * 8)}.self-center{align-self:center}.self-end{align-self:flex-end}.self-start{align-self:flex-start}.justify-self-end{justify-self:flex-end}.truncate{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.overflow-auto{overflow:auto}.overflow-hidden{overflow:hidden}.overflow-x-auto{overflow-x:auto}.overflow-x-hidden{overflow-x:hidden}.overflow-y-auto{overflow-y:auto}.overscroll-contain{overscroll-behavior:contain}.\\!rounded-3xl{border-radius:var(--radius-3xl)!important}.\\!rounded-\\[8px\\]{border-radius:8px!important}.\\!rounded-full{border-radius:3.40282e38px!important}.rounded{border-radius:.25rem}.rounded-2xl{border-radius:var(--radius-2xl)}.rounded-4xl{border-radius:var(--radius-4xl)}.rounded-\\[2px\\]{border-radius:2px}.rounded-\\[4px\\]{border-radius:4px}.rounded-\\[6px\\]{border-radius:6px}.rounded-\\[8px\\]{border-radius:8px}.rounded-\\[calc\\(var\\(--radius\\)-5px\\)\\]{border-radius:calc(var(--radius) - 5px)}.rounded-\\[min\\(var\\(--radius-md\\)\\,8px\\)\\]{border-radius:min(var(--radius-md),8px)}.rounded-\\[min\\(var\\(--radius-md\\)\\,10px\\)\\]{border-radius:min(var(--radius-md),10px)}.rounded-box{border-radius:var(--radius-box)}.rounded-full{border-radius:3.40282e38px}.rounded-lg{border-radius:var(--radius-lg)}.rounded-md{border-radius:var(--radius-md)}.rounded-none{border-radius:0}.rounded-sm{border-radius:var(--radius-sm)}.rounded-xl{border-radius:var(--radius-xl)}.rounded-t-xl{border-top-left-radius:var(--radius-xl);border-top-right-radius:var(--radius-xl)}.rounded-b-xl{border-bottom-right-radius:var(--radius-xl);border-bottom-left-radius:var(--radius-xl)}.\\!border-0{border-style:var(--tw-border-style)!important;border-width:0!important}.border{border-style:var(--tw-border-style);border-width:1px}.border-0{border-style:var(--tw-border-style);border-width:0}.border-t{border-top-style:var(--tw-border-style);border-top-width:1px}.border-b{border-bottom-style:var(--tw-border-style);border-bottom-width:1px}.border-l{border-left-style:var(--tw-border-style);border-left-width:1px}.border-l-\\[3px\\]{border-left-style:var(--tw-border-style);border-left-width:3px}.border-dashed{--tw-border-style:dashed;border-style:dashed}.border-none{--tw-border-style:none;border-style:none}.\\!border-\\[var\\(--tw-btn-border\\)\\]{border-color:var(--tw-btn-border)!important}.\\!border-\\[var\\(--tw-composer-border\\)\\]{border-color:var(--tw-composer-border)!important}.border-\\[\\#ff7875\\]\\/50{border-color:#ff787580}.border-base-300{border-color:var(--color-base-300)}.border-base-content,.border-base-content\\/20{border-color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.border-base-content\\/20{border-color:color-mix(in oklab,var(--color-base-content) 20%,transparent)}}.border-black{border-color:var(--color-black)}.border-black\\/30{border-color:#0000004d}@supports (color:color-mix(in lab,red,red)){.border-black\\/30{border-color:color-mix(in oklab,var(--color-black) 30%,transparent)}}.border-neutral-content,.border-neutral-content\\/10{border-color:var(--color-neutral-content)}@supports (color:color-mix(in lab,red,red)){.border-neutral-content\\/10{border-color:color-mix(in oklab,var(--color-neutral-content) 10%,transparent)}}.border-primary{border-color:var(--color-primary)}.border-success{border-color:var(--color-success)}.border-transparent{border-color:#0000}.border-white{border-color:var(--color-white)}.border-white\\/20{border-color:#fff3}@supports (color:color-mix(in lab,red,red)){.border-white\\/20{border-color:color-mix(in oklab,var(--color-white) 20%,transparent)}}.border-l-error{border-left-color:var(--color-error)}.border-l-info{border-left-color:var(--color-info)}.border-l-success{border-left-color:var(--color-success)}.border-l-warning{border-left-color:var(--color-warning)}.\\!bg-\\[var\\(--tw-composer-bg\\)\\]{background-color:var(--tw-composer-bg)!important}.\\!bg-black{background-color:var(--color-black)!important}.\\!bg-transparent{background-color:#0000!important}.bg-\\[\\#07c160\\]{background-color:#07c160}.bg-\\[\\#e86c6c\\]{background-color:#e86c6c}.bg-accent{background-color:var(--color-accent)}.bg-base-100{background-color:var(--color-base-100)}.bg-base-200{background-color:var(--color-base-200)}.bg-base-content,.bg-base-content\\/5{background-color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.bg-base-content\\/5{background-color:color-mix(in oklab,var(--color-base-content) 5%,transparent)}}.bg-base-content\\/10{background-color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.bg-base-content\\/10{background-color:color-mix(in oklab,var(--color-base-content) 10%,transparent)}}.bg-black{background-color:var(--color-black)}.bg-black\\/10{background-color:#0000001a}@supports (color:color-mix(in lab,red,red)){.bg-black\\/10{background-color:color-mix(in oklab,var(--color-black) 10%,transparent)}}.bg-black\\/55{background-color:#0000008c}@supports (color:color-mix(in lab,red,red)){.bg-black\\/55{background-color:color-mix(in oklab,var(--color-black) 55%,transparent)}}.bg-black\\/80{background-color:#000c}@supports (color:color-mix(in lab,red,red)){.bg-black\\/80{background-color:color-mix(in oklab,var(--color-black) 80%,transparent)}}.bg-error{background-color:var(--color-error)}.bg-neutral{background-color:var(--color-neutral)}.bg-primary{background-color:var(--color-primary)}.bg-primary-content,.bg-primary-content\\/15{background-color:var(--color-primary-content)}@supports (color:color-mix(in lab,red,red)){.bg-primary-content\\/15{background-color:color-mix(in oklab,var(--color-primary-content) 15%,transparent)}}.bg-primary\\/15{background-color:var(--color-primary)}@supports (color:color-mix(in lab,red,red)){.bg-primary\\/15{background-color:color-mix(in oklab,var(--color-primary) 15%,transparent)}}.bg-secondary{background-color:var(--color-secondary)}.bg-success{background-color:var(--color-success)}.bg-transparent{background-color:#0000}.bg-white{background-color:var(--color-white)}.bg-white\\/10{background-color:#ffffff1a}@supports (color:color-mix(in lab,red,red)){.bg-white\\/10{background-color:color-mix(in oklab,var(--color-white) 10%,transparent)}}.bg-white\\/35{background-color:#ffffff59}@supports (color:color-mix(in lab,red,red)){.bg-white\\/35{background-color:color-mix(in oklab,var(--color-white) 35%,transparent)}}.bg-white\\/\\[0\\.04\\]{background-color:#ffffff0a}@supports (color:color-mix(in lab,red,red)){.bg-white\\/\\[0\\.04\\]{background-color:color-mix(in oklab,var(--color-white) 4%,transparent)}}.bg-white\\/\\[0\\.08\\]{background-color:#ffffff14}@supports (color:color-mix(in lab,red,red)){.bg-white\\/\\[0\\.08\\]{background-color:color-mix(in oklab,var(--color-white) 8%,transparent)}}.bg-white\\/\\[0\\.12\\]{background-color:#ffffff1f}@supports (color:color-mix(in lab,red,red)){.bg-white\\/\\[0\\.12\\]{background-color:color-mix(in oklab,var(--color-white) 12%,transparent)}}.bg-clip-padding{background-clip:padding-box}.object-contain{object-fit:contain}.object-cover{object-fit:cover}.\\!p-0{padding:0!important}.p-0{padding:0}.p-0\\.5{padding:calc(var(--spacing) * .5)}.p-1{padding:var(--spacing)}.p-1\\.5{padding:calc(var(--spacing) * 1.5)}.p-2{padding:calc(var(--spacing) * 2)}.p-3{padding:calc(var(--spacing) * 3)}.p-3\\.5{padding:calc(var(--spacing) * 3.5)}.p-4{padding:calc(var(--spacing) * 4)}.p-6{padding:calc(var(--spacing) * 6)}.p-12{padding:calc(var(--spacing) * 12)}.\\!px-0{padding-inline:0!important}.\\!px-3{padding-inline:calc(var(--spacing) * 3)!important}.\\!px-4{padding-inline:calc(var(--spacing) * 4)!important}.px-0{padding-inline:0}.px-0\\.5{padding-inline:calc(var(--spacing) * .5)}.px-1{padding-inline:var(--spacing)}.px-1\\.5{padding-inline:calc(var(--spacing) * 1.5)}.px-2{padding-inline:calc(var(--spacing) * 2)}.px-2\\.5{padding-inline:calc(var(--spacing) * 2.5)}.px-3{padding-inline:calc(var(--spacing) * 3)}.px-3\\.5{padding-inline:calc(var(--spacing) * 3.5)}.px-4{padding-inline:calc(var(--spacing) * 4)}.px-5{padding-inline:calc(var(--spacing) * 5)}.px-6{padding-inline:calc(var(--spacing) * 6)}.px-12{padding-inline:calc(var(--spacing) * 12)}.px-\\[10px\\]{padding-inline:10px}.\\!py-2{padding-block:calc(var(--spacing) * 2)!important}.py-0{padding-block:0}.py-0\\.5{padding-block:calc(var(--spacing) * .5)}.py-1{padding-block:var(--spacing)}.py-1\\.5{padding-block:calc(var(--spacing) * 1.5)}.py-2{padding-block:calc(var(--spacing) * 2)}.py-2\\.5{padding-block:calc(var(--spacing) * 2.5)}.py-3{padding-block:calc(var(--spacing) * 3)}.py-4{padding-block:calc(var(--spacing) * 4)}.py-5{padding-block:calc(var(--spacing) * 5)}.py-6{padding-block:calc(var(--spacing) * 6)}.py-8{padding-block:calc(var(--spacing) * 8)}.py-\\[2px\\]{padding-block:2px}.py-\\[7px\\]{padding-block:7px}.py-px{padding-block:1px}.\\!pt-1{padding-top:var(--spacing)!important}.\\!pt-3{padding-top:calc(var(--spacing) * 3)!important}.pt-0{padding-top:0}.pt-1{padding-top:var(--spacing)}.pt-1\\.5{padding-top:calc(var(--spacing) * 1.5)}.pt-2{padding-top:calc(var(--spacing) * 2)}.pt-3{padding-top:calc(var(--spacing) * 3)}.pr-1{padding-right:var(--spacing)}.pr-2{padding-right:calc(var(--spacing) * 2)}.pr-8{padding-right:calc(var(--spacing) * 8)}.pr-9{padding-right:calc(var(--spacing) * 9)}.pr-12{padding-right:calc(var(--spacing) * 12)}.\\!pb-3{padding-bottom:calc(var(--spacing) * 3)!important}.pb-0{padding-bottom:0}.pb-1{padding-bottom:var(--spacing)}.pb-2{padding-bottom:calc(var(--spacing) * 2)}.pb-6{padding-bottom:calc(var(--spacing) * 6)}.pl-2{padding-left:calc(var(--spacing) * 2)}.pl-\\[9px\\]{padding-left:9px}.text-center{text-align:center}.text-left{text-align:left}.align-middle{vertical-align:middle}.font-mono{font-family:var(--font-mono)}.text-base{font-size:var(--text-base);line-height:var(--tw-leading,var(--text-base--line-height))}.text-lg{font-size:var(--text-lg);line-height:var(--tw-leading,var(--text-lg--line-height))}.text-sm{font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height))}.text-xs{font-size:var(--text-xs);line-height:var(--tw-leading,var(--text-xs--line-height))}.\\!text-\\[11px\\]{font-size:11px!important}.\\!text-\\[13px\\]{font-size:13px!important}.text-\\[11\\.5px\\]{font-size:11.5px}.text-\\[11px\\]{font-size:11px}.text-\\[12\\.5px\\]{font-size:12.5px}.text-\\[13px\\]{font-size:13px}.text-\\[15px\\]{font-size:15px}.\\!leading-relaxed{--tw-leading:var(--leading-relaxed)!important;line-height:var(--leading-relaxed)!important}.leading-4{--tw-leading:calc(var(--spacing) * 4);line-height:calc(var(--spacing) * 4)}.leading-5{--tw-leading:calc(var(--spacing) * 5);line-height:calc(var(--spacing) * 5)}.leading-6{--tw-leading:calc(var(--spacing) * 6);line-height:calc(var(--spacing) * 6)}.leading-\\[1\\.6\\]{--tw-leading:1.6;line-height:1.6}.leading-\\[1\\.9\\]{--tw-leading:1.9;line-height:1.9}.leading-none{--tw-leading:1;line-height:1}.leading-normal{--tw-leading:var(--leading-normal);line-height:var(--leading-normal)}.leading-relaxed{--tw-leading:var(--leading-relaxed);line-height:var(--leading-relaxed)}.leading-snug{--tw-leading:var(--leading-snug);line-height:var(--leading-snug)}.font-bold{--tw-font-weight:var(--font-weight-bold);font-weight:var(--font-weight-bold)}.font-medium{--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium)}.font-normal{--tw-font-weight:var(--font-weight-normal);font-weight:var(--font-weight-normal)}.font-semibold{--tw-font-weight:var(--font-weight-semibold);font-weight:var(--font-weight-semibold)}.tracking-tight{--tw-tracking:var(--tracking-tight);letter-spacing:var(--tracking-tight)}.tracking-widest{--tw-tracking:var(--tracking-widest);letter-spacing:var(--tracking-widest)}.text-balance{text-wrap:balance}.break-words{overflow-wrap:break-word}.wrap-anywhere{overflow-wrap:anywhere}.wrap-break-word{overflow-wrap:break-word}.break-all{word-break:break-all}.whitespace-normal{white-space:normal}.whitespace-nowrap{white-space:nowrap}.whitespace-pre-wrap{white-space:pre-wrap}.\\!text-black{color:var(--color-black)!important}.\\!text-white{color:var(--color-white)!important}.text-\\[\\#ff7875\\]{color:#ff7875}.text-accent-content{color:var(--color-accent-content)}.text-base-content,.text-base-content\\/40{color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.text-base-content\\/40{color:color-mix(in oklab,var(--color-base-content) 40%,transparent)}}.text-base-content\\/60{color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.text-base-content\\/60{color:color-mix(in oklab,var(--color-base-content) 60%,transparent)}}.text-base-content\\/80{color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.text-base-content\\/80{color:color-mix(in oklab,var(--color-base-content) 80%,transparent)}}.text-black{color:var(--color-black)}.text-current{color:currentColor}.text-error{color:var(--color-error)}.text-info{color:var(--color-info)}.text-neutral-content{color:var(--color-neutral-content)}.text-primary{color:var(--color-primary)}.text-primary-content{color:var(--color-primary-content)}.text-success{color:var(--color-success)}.text-warning{color:var(--color-warning)}.text-white{color:var(--color-white)}.text-white\\/45{color:#ffffff73}@supports (color:color-mix(in lab,red,red)){.text-white\\/45{color:color-mix(in oklab,var(--color-white) 45%,transparent)}}.text-white\\/55{color:#ffffff8c}@supports (color:color-mix(in lab,red,red)){.text-white\\/55{color:color-mix(in oklab,var(--color-white) 55%,transparent)}}.text-white\\/70{color:#ffffffb3}@supports (color:color-mix(in lab,red,red)){.text-white\\/70{color:color-mix(in oklab,var(--color-white) 70%,transparent)}}.text-white\\/80{color:#fffc}@supports (color:color-mix(in lab,red,red)){.text-white\\/80{color:color-mix(in oklab,var(--color-white) 80%,transparent)}}.capitalize{text-transform:capitalize}.lowercase{text-transform:lowercase}.normal-case{text-transform:none}.uppercase{text-transform:uppercase}.italic{font-style:italic}.diagonal-fractions{--tw-numeric-fraction:diagonal-fractions;font-variant-numeric:var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,)}.lining-nums{--tw-numeric-figure:lining-nums;font-variant-numeric:var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,)}.proportional-nums{--tw-numeric-spacing:proportional-nums;font-variant-numeric:var(--tw-ordinal,) var(--tw-slashed-zero,) var(--tw-numeric-figure,) var(--tw-numeric-spacing,) var(--tw-numeric-fraction,)}.line-through{text-decoration-line:line-through}.no-underline,.prose :where(a.btn:not(.btn-link)):not(:where([class~=not-prose],[class~=not-prose] *)){text-decoration-line:none}.underline{text-decoration-line:underline}.underline-offset-4{text-underline-offset:4px}.antialiased{-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}.opacity-0{opacity:0}.opacity-55{opacity:.55}.opacity-60{opacity:.6}.opacity-65{opacity:.65}.opacity-75{opacity:.75}.bg-blend-color{background-blend-mode:color}.\\!shadow-none{--tw-shadow:0 0 #0000!important;box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)!important}.shadow{--tw-shadow:0 1px 3px 0 var(--tw-shadow-color,#0000001a), 0 1px 2px -1px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.shadow-2xl{--tw-shadow:0 25px 50px -12px var(--tw-shadow-color,#00000040);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.shadow-lg{--tw-shadow:0 10px 15px -3px var(--tw-shadow-color,#0000001a), 0 4px 6px -4px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.shadow-md{--tw-shadow:0 4px 6px -1px var(--tw-shadow-color,#0000001a), 0 2px 4px -2px var(--tw-shadow-color,#0000001a);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.shadow-none{--tw-shadow:0 0 #0000;box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.shadow-xs{--tw-shadow:0 1px 2px 0 var(--tw-shadow-color,#0000000d);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.ring{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.ring-0{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(0px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.ring-1{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.ring-2{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.ring-3{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.\\!ring-\\[rgb\\(34\\,34\\,34\\)\\]{--tw-ring-color:#222!important}.outline-hidden{--tw-outline-style:none;outline-style:none}@media(forced-colors:active){.outline-hidden{outline-offset:2px;outline:2px solid #0000}}.outline{outline-style:var(--tw-outline-style);outline-width:1px}.blur{--tw-blur:blur(8px);filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.grayscale{--tw-grayscale:grayscale(100%);filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.invert{--tw-invert:invert(100%);filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.filter{filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.backdrop-filter{-webkit-backdrop-filter:var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,);backdrop-filter:var(--tw-backdrop-blur,) var(--tw-backdrop-brightness,) var(--tw-backdrop-contrast,) var(--tw-backdrop-grayscale,) var(--tw-backdrop-hue-rotate,) var(--tw-backdrop-invert,) var(--tw-backdrop-opacity,) var(--tw-backdrop-saturate,) var(--tw-backdrop-sepia,)}.transition{transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to,opacity,box-shadow,transform,translate,scale,rotate,filter,-webkit-backdrop-filter,backdrop-filter,display,content-visibility,overlay,pointer-events;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-\\[color\\,box-shadow\\]{transition-property:color,box-shadow;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-\\[translate\\,scale\\,opacity\\]{transition-property:translate,scale,opacity;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-\\[width\\]{transition-property:width;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-all{transition-property:all;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-colors{transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-opacity{transition-property:opacity;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-shadow{transition-property:box-shadow;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-transform{transition-property:transform,translate,scale,rotate;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.transition-none{transition-property:none}.duration-100{--tw-duration:.1s;transition-duration:.1s}.duration-150{--tw-duration:.15s;transition-duration:.15s}.duration-200{--tw-duration:.2s;transition-duration:.2s}.ease-in-out{--tw-ease:var(--ease-in-out);transition-timing-function:var(--ease-in-out)}.ease-out{--tw-ease:var(--ease-out);transition-timing-function:var(--ease-out)}.contain-content{contain:content}.outline-none{--tw-outline-style:none;outline-style:none}.select-none{-webkit-user-select:none;user-select:none}.\\[border-bottom\\:1px_solid_rgb\\(34\\,34\\,34\\)\\]{border-bottom:1px solid #222}.\\[contain-intrinsic-size\\:auto_10rem\\]{contain-intrinsic-size:auto 10rem}.\\[content-visibility\\:auto\\]{content-visibility:auto}.paused{animation-play-state:paused}.running{animation-play-state:running}.zoom-in{--tw-enter-scale:0}.zoom-out{--tw-exit-scale:0}@media(hover:hover){.group-hover\\:pointer-events-auto:is(:where(.group):hover *){pointer-events:auto}.group-hover\\:opacity-100:is(:where(.group):hover *){opacity:1}}.group-has-data-\\[slot\\=message-footer\\]\\/message\\:-translate-y-8:is(:where(.group\\/message):has([data-slot=message-footer]) *){--tw-translate-y:calc(var(--spacing) * -8);translate:var(--tw-translate-x) var(--tw-translate-y)}.group-has-data-\\[variant\\=ghost\\]\\/message\\:px-0:is(:where(.group\\/message):has([data-variant=ghost]) *){padding-inline:0}.group-has-\\[\\>input\\]\\/input-group\\:pt-2:is(:where(.group\\/input-group):has(>input) *){padding-top:calc(var(--spacing) * 2)}.group-has-\\[\\>input\\]\\/input-group\\:pb-2:is(:where(.group\\/input-group):has(>input) *){padding-bottom:calc(var(--spacing) * 2)}.group-data-\\[align\\=end\\]\\/bubble\\:self-end:is(:where(.group\\/bubble)[data-align=end] *){align-self:flex-end}.group-data-\\[align\\=end\\]\\/message\\:justify-end:is(:where(.group\\/message)[data-align=end] *){justify-content:flex-end}.group-data-\\[align\\=end\\]\\/message\\:self-end:is(:where(.group\\/message)[data-align=end] *){align-self:flex-end}.group-data-\\[disabled\\=true\\]\\/input-group\\:opacity-50:is(:where(.group\\/input-group)[data-disabled=true] *){opacity:.5}.group-data-\\[size\\=sm\\]\\/avatar\\:text-xs:is(:where(.group\\/avatar)[data-size=sm] *){font-size:var(--text-xs);line-height:var(--tw-leading,var(--text-xs--line-height))}.group-data-\\[size\\=sm\\]\\/card\\:px-4:is(:where(.group\\/card)[data-size=sm] *){padding-inline:calc(var(--spacing) * 4)}.group-data-\\[size\\=sm\\]\\/card\\:text-sm:is(:where(.group\\/card)[data-size=sm] *){font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height))}.group-data-\\[variant\\=separator\\]\\/marker\\:flex-none:is(:where(.group\\/marker)[data-variant=separator] *){flex:none}.group-data-\\[variant\\=separator\\]\\/marker\\:text-center:is(:where(.group\\/marker)[data-variant=separator] *){text-align:center}.before\\:mr-1:before{content:var(--tw-content);margin-right:var(--spacing)}.before\\:h-px:before{content:var(--tw-content);height:1px}.before\\:min-w-0:before{content:var(--tw-content);min-width:0}.before\\:flex-1:before{content:var(--tw-content);flex:1}.after\\:absolute:after{content:var(--tw-content);position:absolute}.after\\:inset-0:after{content:var(--tw-content);inset:0}.after\\:ml-1:after{content:var(--tw-content);margin-left:var(--spacing)}.after\\:h-px:after{content:var(--tw-content);height:1px}.after\\:min-w-0:after{content:var(--tw-content);min-width:0}.after\\:flex-1:after{content:var(--tw-content);flex:1}.after\\:rounded-full:after{content:var(--tw-content);border-radius:3.40282e38px}.after\\:border:after{content:var(--tw-content);border-style:var(--tw-border-style);border-width:1px}.after\\:mix-blend-darken:after{content:var(--tw-content);mix-blend-mode:darken}@media(hover:hover){.hover\\:border-base-content\\/30:hover{border-color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.hover\\:border-base-content\\/30:hover{border-color:color-mix(in oklab,var(--color-base-content) 30%,transparent)}}.hover\\:bg-\\[\\#ff7875\\]\\/15:hover{background-color:#ff787526}.hover\\:bg-base-content\\/15:hover{background-color:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-base-content\\/15:hover{background-color:color-mix(in oklab,var(--color-base-content) 15%,transparent)}}.hover\\:bg-black\\/20:hover{background-color:#0003}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-black\\/20:hover{background-color:color-mix(in oklab,var(--color-black) 20%,transparent)}}.hover\\:bg-neutral-content\\/10:hover{background-color:var(--color-neutral-content)}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-neutral-content\\/10:hover{background-color:color-mix(in oklab,var(--color-neutral-content) 10%,transparent)}}.hover\\:bg-primary\\/80:hover{background-color:var(--color-primary)}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-primary\\/80:hover{background-color:color-mix(in oklab,var(--color-primary) 80%,transparent)}}.hover\\:bg-secondary\\/80:hover{background-color:var(--color-secondary)}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-secondary\\/80:hover{background-color:color-mix(in oklab,var(--color-secondary) 80%,transparent)}}.hover\\:bg-white\\/10:hover{background-color:#ffffff1a}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-white\\/10:hover{background-color:color-mix(in oklab,var(--color-white) 10%,transparent)}}.hover\\:bg-white\\/15:hover{background-color:#ffffff26}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-white\\/15:hover{background-color:color-mix(in oklab,var(--color-white) 15%,transparent)}}.hover\\:bg-white\\/20:hover{background-color:#fff3}@supports (color:color-mix(in lab,red,red)){.hover\\:bg-white\\/20:hover{background-color:color-mix(in oklab,var(--color-white) 20%,transparent)}}.hover\\:text-base-content:hover{color:var(--color-base-content)}.hover\\:text-white:hover{color:var(--color-white)}.hover\\:underline:hover{text-decoration-line:underline}}.focus\\:bg-accent:focus{background-color:var(--color-accent)}.focus-visible\\:ring-0:focus-visible{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(0px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.focus-visible\\:ring-3:focus-visible{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.active\\:not-aria-\\[haspopup\\]\\:translate-y-px:active:not([aria-haspopup]){--tw-translate-y:1px;translate:var(--tw-translate-x) var(--tw-translate-y)}.disabled\\:pointer-events-none:disabled{pointer-events:none}.disabled\\:cursor-default:disabled{cursor:default}.disabled\\:cursor-not-allowed:disabled{cursor:not-allowed}.disabled\\:opacity-40:disabled{opacity:.4}.disabled\\:opacity-50:disabled{opacity:.5}:where([data-slot=button-group]) .in-data-\\[slot\\=button-group\\]\\:rounded-md{border-radius:var(--radius-md)}:where([data-slot=combobox-content]) .in-data-\\[slot\\=combobox-content\\]\\:focus-within\\:border-inherit:focus-within{border-color:inherit}:where([data-slot=combobox-content]) .in-data-\\[slot\\=combobox-content\\]\\:focus-within\\:ring-0:focus-within{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(0px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.has-data-\\[icon\\=inline-end\\]\\:pr-1\\.5:has([data-icon=inline-end]){padding-right:calc(var(--spacing) * 1.5)}.has-data-\\[icon\\=inline-end\\]\\:pr-2:has([data-icon=inline-end]){padding-right:calc(var(--spacing) * 2)}.has-data-\\[icon\\=inline-start\\]\\:pl-1\\.5:has([data-icon=inline-start]){padding-left:calc(var(--spacing) * 1.5)}.has-data-\\[icon\\=inline-start\\]\\:pl-2:has([data-icon=inline-start]){padding-left:calc(var(--spacing) * 2)}.has-data-\\[slot\\=card-action\\]\\:grid-cols-\\[1fr_auto\\]:has([data-slot=card-action]){grid-template-columns:1fr auto}.has-data-\\[slot\\=card-description\\]\\:grid-rows-\\[auto_auto\\]:has([data-slot=card-description]){grid-template-rows:auto auto}.has-\\[\\[data-slot\\=input-group-control\\]\\:focus-visible\\]\\:ring-3:has([data-slot=input-group-control]:focus-visible),.has-\\[\\[data-slot\\]\\[aria-invalid\\=true\\]\\]\\:ring-3:has([data-slot][aria-invalid=true]){--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.has-\\[\\>\\[data-align\\=block-end\\]\\]\\:h-auto:has(>[data-align=block-end]){height:auto}.has-\\[\\>\\[data-align\\=block-end\\]\\]\\:flex-col:has(>[data-align=block-end]){flex-direction:column}.has-\\[\\>\\[data-align\\=block-start\\]\\]\\:h-auto:has(>[data-align=block-start]){height:auto}.has-\\[\\>\\[data-align\\=block-start\\]\\]\\:flex-col:has(>[data-align=block-start]){flex-direction:column}.has-\\[\\>button\\]\\:-mr-1:has(>button){margin-right:calc(var(--spacing) * -1)}.has-\\[\\>button\\]\\:-ml-1:has(>button){margin-left:calc(var(--spacing) * -1)}.has-\\[\\>img\\:first-child\\]\\:pt-0:has(>img:first-child){padding-top:0}.has-\\[\\>kbd\\]\\:mr-\\[-0\\.15rem\\]:has(>kbd){margin-right:-.15rem}.has-\\[\\>kbd\\]\\:ml-\\[-0\\.15rem\\]:has(>kbd){margin-left:-.15rem}.has-\\[\\>svg\\]\\:p-0:has(>svg){padding:0}.has-\\[\\>textarea\\]\\:h-auto:has(>textarea){height:auto}.aria-expanded\\:bg-secondary[aria-expanded=true]{background-color:var(--color-secondary)}.aria-invalid\\:ring-0[aria-invalid=true]{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(0px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.aria-invalid\\:ring-3[aria-invalid=true]{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}.data-autoscrolling\\:scrollbar-thumb-transparent[data-autoscrolling]{--tw-scrollbar-thumb:transparent;scrollbar-color:var(--tw-scrollbar-thumb) var(--tw-scrollbar-track)}.data-autoscrolling\\:scrollbar-track-transparent[data-autoscrolling]{--tw-scrollbar-track:transparent;scrollbar-color:var(--tw-scrollbar-thumb) var(--tw-scrollbar-track)}.data-closed\\:animate-out[data-closed]{animation:exit var(--tw-animation-duration,var(--tw-duration,.15s))var(--tw-ease,ease)var(--tw-animation-delay,0s)var(--tw-animation-iteration-count,1)var(--tw-animation-direction,normal)var(--tw-animation-fill-mode,none)}.data-closed\\:fade-out-0[data-closed]{--tw-exit-opacity:0}.data-closed\\:zoom-out-95[data-closed]{--tw-exit-scale:.95}.data-disabled\\:pointer-events-none[data-disabled]{pointer-events:none}.data-disabled\\:opacity-50[data-disabled]{opacity:.5}.data-inset\\:pl-8[data-inset]{padding-left:calc(var(--spacing) * 8)}.data-open\\:animate-in[data-open]{animation:enter var(--tw-animation-duration,var(--tw-duration,.15s))var(--tw-ease,ease)var(--tw-animation-delay,0s)var(--tw-animation-iteration-count,1)var(--tw-animation-direction,normal)var(--tw-animation-fill-mode,none)}.data-open\\:fade-in-0[data-open]{--tw-enter-opacity:0}.data-open\\:zoom-in-95[data-open]{--tw-enter-scale:.95}:is(.group-data-\\[align\\=end\\]\\/message\\:\\*\\:data-slot\\:self-end:is(:where(.group\\/message)[data-align=end] *)>*)[data-slot]{align-self:flex-end}.data-\\[active\\=false\\]\\:pointer-events-none[data-active=false]{pointer-events:none}.data-\\[active\\=false\\]\\:scale-95[data-active=false]{--tw-scale-x:95%;--tw-scale-y:95%;--tw-scale-z:95%;scale:var(--tw-scale-x) var(--tw-scale-y)}.data-\\[active\\=false\\]\\:opacity-0[data-active=false]{opacity:0}.data-\\[active\\=false\\]\\:duration-400[data-active=false]{--tw-duration:.4s;transition-duration:.4s}.data-\\[active\\=false\\]\\:ease-\\[cubic-bezier\\(0\\.7\\,0\\,0\\.84\\,0\\)\\][data-active=false]{--tw-ease:cubic-bezier(.7,0,.84,0);transition-timing-function:cubic-bezier(.7,0,.84,0)}.data-\\[active\\=true\\]\\:translate-y-0[data-active=true]{--tw-translate-y:0px;translate:var(--tw-translate-x) var(--tw-translate-y)}.data-\\[active\\=true\\]\\:scale-100[data-active=true]{--tw-scale-x:100%;--tw-scale-y:100%;--tw-scale-z:100%;scale:var(--tw-scale-x) var(--tw-scale-y)}.data-\\[active\\=true\\]\\:opacity-100[data-active=true]{opacity:1}.data-\\[active\\=true\\]\\:ease-\\[cubic-bezier\\(0\\.23\\,1\\,0\\.32\\,1\\)\\][data-active=true]{--tw-ease:cubic-bezier(.23,1,.32,1);transition-timing-function:cubic-bezier(.23,1,.32,1)}.data-\\[align\\=end\\]\\:flex-row-reverse[data-align=end]{flex-direction:row-reverse}.data-\\[align\\=end\\]\\:self-end[data-align=end]{align-self:flex-end}.data-\\[direction\\=end\\]\\:bottom-4[data-direction=end]{bottom:calc(var(--spacing) * 4)}.data-\\[direction\\=end\\]\\:data-\\[active\\=false\\]\\:translate-y-full[data-direction=end][data-active=false]{--tw-translate-y:100%;translate:var(--tw-translate-x) var(--tw-translate-y)}.data-\\[direction\\=start\\]\\:top-4[data-direction=start]{top:calc(var(--spacing) * 4)}.data-\\[direction\\=start\\]\\:data-\\[active\\=false\\]\\:-translate-y-full[data-direction=start][data-active=false]{--tw-translate-y:-100%;translate:var(--tw-translate-x) var(--tw-translate-y)}.data-\\[side\\=bottom\\]\\:slide-in-from-top-2[data-side=bottom]{--tw-enter-translate-y:calc(2*var(--spacing)*-1)}.data-\\[side\\=left\\]\\:slide-in-from-right-2[data-side=left]{--tw-enter-translate-x:calc(2*var(--spacing))}.data-\\[side\\=right\\]\\:slide-in-from-left-2[data-side=right]{--tw-enter-translate-x:calc(2*var(--spacing)*-1)}.data-\\[side\\=top\\]\\:slide-in-from-bottom-2[data-side=top]{--tw-enter-translate-y:calc(2*var(--spacing))}.data-\\[size\\=lg\\]\\:size-10[data-size=lg]{width:calc(var(--spacing) * 10);height:calc(var(--spacing) * 10)}.data-\\[size\\=sm\\]\\:size-6[data-size=sm]{width:calc(var(--spacing) * 6);height:calc(var(--spacing) * 6)}.data-\\[size\\=sm\\]\\:gap-4[data-size=sm]{gap:calc(var(--spacing) * 4)}.data-\\[size\\=sm\\]\\:py-4[data-size=sm]{padding-block:calc(var(--spacing) * 4)}:is(.\\*\\:data-\\[slot\\=bubble-content\\]\\:rounded-none>*)[data-slot=bubble-content]{border-radius:0}:is(.\\*\\:data-\\[slot\\=bubble-content\\]\\:bg-\\[oklch\\(from_var\\(--primary\\)_0\\.93_calc\\(c\\*0\\.4\\)_h\\)\\]>*)[data-slot=bubble-content]{background-color:oklch(from var(--primary) .93 calc(c*.4) h)}:is(.\\*\\:data-\\[slot\\=bubble-content\\]\\:bg-primary>*)[data-slot=bubble-content]{background-color:var(--color-primary)}:is(.\\*\\:data-\\[slot\\=bubble-content\\]\\:bg-secondary>*)[data-slot=bubble-content]{background-color:var(--color-secondary)}:is(.\\*\\:data-\\[slot\\=bubble-content\\]\\:bg-transparent>*)[data-slot=bubble-content]{background-color:#0000}:is(.\\*\\:data-\\[slot\\=bubble-content\\]\\:p-0>*)[data-slot=bubble-content]{padding:0}.data-\\[state\\=closed\\]\\:overflow-hidden[data-state=closed]{overflow:hidden}.data-\\[variant\\=ghost\\]\\:max-w-full[data-variant=ghost]{max-width:100%}@media(min-width:48rem){.md\\:text-sm{font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height))}}.rtl\\:translate-x-1\\/2:where(:dir(rtl),[dir=rtl],[dir=rtl] *){--tw-translate-x: 50% ;translate:var(--tw-translate-x) var(--tw-translate-y)}.dark\\:bg-transparent:where([data-theme=business],[data-theme=business] *){background-color:#0000}.dark\\:after\\:mix-blend-lighten:where([data-theme=business],[data-theme=business] *):after{content:var(--tw-content);mix-blend-mode:lighten}:is(.dark\\:\\*\\:data-\\[slot\\=bubble-content\\]\\:bg-\\[oklch\\(from_var\\(--primary\\)_0\\.3_calc\\(c\\*0\\.4\\)_h\\)\\]:where([data-theme=business],[data-theme=business] *)>*)[data-slot=bubble-content]{background-color:oklch(from var(--primary) .3 calc(c*.4) h)}.\\[\\&_svg\\]\\:pointer-events-none svg{pointer-events:none}.\\[\\&_svg\\]\\:size-3\\.5 svg{width:calc(var(--spacing) * 3.5);height:calc(var(--spacing) * 3.5)}.\\[\\&_svg\\]\\:shrink-0 svg{flex-shrink:0}.data-\\[direction\\=start\\]\\:\\[\\&_svg\\]\\:rotate-180[data-direction=start] svg{rotate:180deg}.\\[\\&_svg\\:not\\(\\[class\\*\\=\\'size-\\'\\]\\)\\]\\:size-4 svg:not([class*=size-]){width:calc(var(--spacing) * 4);height:calc(var(--spacing) * 4)}.\\[\\&_svg\\:not\\(\\[class\\*\\=size-\\]\\)\\]\\:size-3 svg:not([class*=size-]){width:calc(var(--spacing) * 3);height:calc(var(--spacing) * 3)}.\\[\\&_svg\\:not\\(\\[class\\*\\=size-\\]\\)\\]\\:size-4 svg:not([class*=size-]){width:calc(var(--spacing) * 4);height:calc(var(--spacing) * 4)}.\\[\\.border-b\\]\\:pb-2.border-b{padding-bottom:calc(var(--spacing) * 2)}.\\[\\.border-b\\]\\:pb-6.border-b{padding-bottom:calc(var(--spacing) * 6)}.group-data-\\[size\\=sm\\]\\/card\\:\\[\\.border-b\\]\\:pb-4:is(:where(.group\\/card)[data-size=sm] *).border-b{padding-bottom:calc(var(--spacing) * 4)}.\\[\\.border-t\\]\\:pt-2.border-t{padding-top:calc(var(--spacing) * 2)}.\\[\\.border-t\\]\\:pt-6.border-t{padding-top:calc(var(--spacing) * 6)}.group-data-\\[size\\=sm\\]\\/card\\:\\[\\.border-t\\]\\:pt-4:is(:where(.group\\/card)[data-size=sm] *).border-t{padding-top:calc(var(--spacing) * 4)}.\\[a\\]\\:underline:is(a){text-decoration-line:underline}.\\[a\\]\\:underline-offset-3:is(a){text-underline-offset:3px}:is(.\\*\\:\\[a\\]\\:underline>*):is(a){text-decoration-line:underline}:is(.\\*\\:\\[a\\]\\:underline-offset-3>*):is(a){text-underline-offset:3px}.\\[button\\]\\:text-left:is(button){text-align:left}.\\[button\\,a\\]\\:transition-colors:is(button,a){transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}.\\[button\\,a\\]\\:outline-none:is(button,a){--tw-outline-style:none;outline-style:none}.\\[button\\,a\\]\\:focus-visible\\:ring-3:is(button,a):focus-visible{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 calc(3px + var(--tw-ring-offset-width)) var(--tw-ring-color,currentcolor);box-shadow:var(--tw-inset-shadow),var(--tw-inset-ring-shadow),var(--tw-ring-offset-shadow),var(--tw-ring-shadow),var(--tw-shadow)}:is(.\\*\\:\\[img\\:first-child\\]\\:rounded-t-xl>*):is(img:first-child){border-top-left-radius:var(--radius-xl);border-top-right-radius:var(--radius-xl)}:is(.\\*\\:\\[img\\:last-child\\]\\:rounded-b-xl>*):is(img:last-child){border-bottom-right-radius:var(--radius-xl);border-bottom-left-radius:var(--radius-xl)}.\\[\\&\\>\\[data-slot\\=bubble-content\\]\\:is\\(button\\,a\\)\\:hover\\]\\:bg-\\[color-mix\\(in_oklch\\,var\\(--muted\\)\\,var\\(--foreground\\)_5\\%\\)\\]>[data-slot=bubble-content]:is(button,a):hover{background-color:var(--muted)}@supports (color:color-mix(in lab,red,red)){.\\[\\&\\>\\[data-slot\\=bubble-content\\]\\:is\\(button\\,a\\)\\:hover\\]\\:bg-\\[color-mix\\(in_oklch\\,var\\(--muted\\)\\,var\\(--foreground\\)_5\\%\\)\\]>[data-slot=bubble-content]:is(button,a):hover{background-color:color-mix(in oklch,var(--muted),var(--foreground) 5%)}}.\\[\\&\\>\\[data-slot\\=bubble-content\\]\\:is\\(button\\,a\\)\\:hover\\]\\:bg-\\[color-mix\\(in_oklch\\,var\\(--secondary\\)\\,var\\(--foreground\\)_5\\%\\)\\]>[data-slot=bubble-content]:is(button,a):hover{background-color:var(--secondary)}@supports (color:color-mix(in lab,red,red)){.\\[\\&\\>\\[data-slot\\=bubble-content\\]\\:is\\(button\\,a\\)\\:hover\\]\\:bg-\\[color-mix\\(in_oklch\\,var\\(--secondary\\)\\,var\\(--foreground\\)_5\\%\\)\\]>[data-slot=bubble-content]:is(button,a):hover{background-color:color-mix(in oklch,var(--secondary),var(--foreground) 5%)}}.\\[\\&\\>\\[data-slot\\=bubble-content\\]\\:is\\(button\\,a\\)\\:hover\\]\\:bg-\\[oklch\\(from_var\\(--primary\\)_0\\.88_calc\\(c\\*0\\.5\\)_h\\)\\]>[data-slot=bubble-content]:is(button,a):hover{background-color:oklch(from var(--primary) .88 calc(c/2) h)}.\\[\\&\\>\\[data-slot\\=bubble-content\\]\\:is\\(button\\,a\\)\\:hover\\]\\:bg-primary\\/80>[data-slot=bubble-content]:is(button,a):hover{background-color:var(--color-primary)}@supports (color:color-mix(in lab,red,red)){.\\[\\&\\>\\[data-slot\\=bubble-content\\]\\:is\\(button\\,a\\)\\:hover\\]\\:bg-primary\\/80>[data-slot=bubble-content]:is(button,a):hover{background-color:color-mix(in oklab,var(--color-primary) 80%,transparent)}}.dark\\:\\[\\&\\>\\[data-slot\\=bubble-content\\]\\:is\\(button\\,a\\)\\:hover\\]\\:bg-\\[oklch\\(from_var\\(--primary\\)_0\\.35_calc\\(c\\*0\\.5\\)_h\\)\\]:where([data-theme=business],[data-theme=business] *)>[data-slot=bubble-content]:is(button,a):hover{background-color:oklch(from var(--primary) .35 calc(c/2) h)}.has-\\[\\>\\[data-align\\=block-end\\]\\]\\:\\[\\&\\>input\\]\\:pt-3:has(>[data-align=block-end])>input{padding-top:calc(var(--spacing) * 3)}.has-\\[\\>\\[data-align\\=block-start\\]\\]\\:\\[\\&\\>input\\]\\:pb-3:has(>[data-align=block-start])>input{padding-bottom:calc(var(--spacing) * 3)}.has-\\[\\>\\[data-align\\=inline-end\\]\\]\\:\\[\\&\\>input\\]\\:pr-1\\.5:has(>[data-align=inline-end])>input{padding-right:calc(var(--spacing) * 1.5)}.has-\\[\\>\\[data-align\\=inline-start\\]\\]\\:\\[\\&\\>input\\]\\:pl-1\\.5:has(>[data-align=inline-start])>input{padding-left:calc(var(--spacing) * 1.5)}.\\[\\&\\>kbd\\]\\:rounded-\\[calc\\(var\\(--radius\\)-5px\\)\\]>kbd{border-radius:calc(var(--radius) - 5px)}.\\[\\&\\>svg\\:not\\(\\[class\\*\\=size-\\]\\)\\]\\:size-3\\.5>svg:not([class*=size-]){width:calc(var(--spacing) * 3.5);height:calc(var(--spacing) * 3.5)}.\\[\\&\\>svg\\:not\\(\\[class\\*\\=size-\\]\\)\\]\\:size-4>svg:not([class*=size-]){width:calc(var(--spacing) * 4);height:calc(var(--spacing) * 4)}}@property --tw-animation-delay{syntax:"*";inherits:false;initial-value:0s}@property --tw-animation-direction{syntax:"*";inherits:false;initial-value:normal}@property --tw-animation-duration{syntax:"*";inherits:false}@property --tw-animation-fill-mode{syntax:"*";inherits:false;initial-value:none}@property --tw-animation-iteration-count{syntax:"*";inherits:false;initial-value:1}@property --tw-enter-blur{syntax:"*";inherits:false;initial-value:0}@property --tw-enter-opacity{syntax:"*";inherits:false;initial-value:1}@property --tw-enter-rotate{syntax:"*";inherits:false;initial-value:0}@property --tw-enter-scale{syntax:"*";inherits:false;initial-value:1}@property --tw-enter-translate-x{syntax:"*";inherits:false;initial-value:0}@property --tw-enter-translate-y{syntax:"*";inherits:false;initial-value:0}@property --tw-exit-blur{syntax:"*";inherits:false;initial-value:0}@property --tw-exit-opacity{syntax:"*";inherits:false;initial-value:1}@property --tw-exit-rotate{syntax:"*";inherits:false;initial-value:0}@property --tw-exit-scale{syntax:"*";inherits:false;initial-value:1}@property --tw-exit-translate-x{syntax:"*";inherits:false;initial-value:0}@property --tw-exit-translate-y{syntax:"*";inherits:false;initial-value:0}:host{color:var(--color-base-content);text-align:left;-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,PingFang SC,Hiragino Sans GB,Microsoft YaHei,sans-serif;font-size:14px;line-height:1.5715}*,:before,:after{box-sizing:border-box}.znhd-panel-btn{container-type:inline-size}.znhd-panel-btn-text{display:none}@container (min-width:65px){.znhd-panel-btn-text{display:inline}}:host{--znhd-scrollbar-thumb:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:host{--znhd-scrollbar-thumb:color-mix(in oklab, var(--color-base-content) 24%, transparent)}}:host{--znhd-scrollbar-thumb-hover:var(--color-base-content)}@supports (color:color-mix(in lab,red,red)){:host{--znhd-scrollbar-thumb-hover:color-mix(in oklab, var(--color-base-content) 40%, transparent)}}*{scrollbar-width:thin;scrollbar-color:var(--znhd-scrollbar-thumb) transparent}::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:var(--znhd-scrollbar-thumb);background-clip:padding-box;border:3px solid #0000;border-radius:8px}::-webkit-scrollbar-thumb:hover{background:var(--znhd-scrollbar-thumb-hover);background-clip:padding-box}::-webkit-scrollbar-track{background:0 0}::-webkit-scrollbar-corner{background:0 0}svg{vertical-align:middle}@keyframes rotator{89.9999%,to{--first-item-position:0 0%}90%,99.9999%{--first-item-position:0 calc(var(--items) * 100%)}to{translate:0 -100%}}@keyframes skeleton{0%{background-position:150%}to{background-position:-50%}}@keyframes menu{0%{opacity:0}}@keyframes dropdown{0%{opacity:0}}@keyframes toast{0%{opacity:0;scale:.9}to{opacity:1;scale:1}}@keyframes radio{0%{padding:5px}50%{padding:3px}}@keyframes rating{0%,40%{filter:brightness(1.05)contrast(1.05);scale:1.1}}@keyframes progress{50%{background-position-x:-115%}}@keyframes aura{to{--aura-angle:360deg;transform:translateZ(1px)}}@keyframes aura-glow{20%,80%{opacity:.7;filter:blur(.25rem)}50%{opacity:1;filter:blur(.75rem)}}@keyframes aura-glow-after{20%,80%{opacity:.3;filter:blur(1rem)}50%{opacity:.6;filter:blur(1.5rem)}}@property --tw-translate-x{syntax:"*";inherits:false;initial-value:0}@property --tw-translate-y{syntax:"*";inherits:false;initial-value:0}@property --tw-translate-z{syntax:"*";inherits:false;initial-value:0}@property --tw-rotate-x{syntax:"*";inherits:false}@property --tw-rotate-y{syntax:"*";inherits:false}@property --tw-rotate-z{syntax:"*";inherits:false}@property --tw-skew-x{syntax:"*";inherits:false}@property --tw-skew-y{syntax:"*";inherits:false}@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-leading{syntax:"*";inherits:false}@property --tw-font-weight{syntax:"*";inherits:false}@property --tw-tracking{syntax:"*";inherits:false}@property --tw-ordinal{syntax:"*";inherits:false}@property --tw-slashed-zero{syntax:"*";inherits:false}@property --tw-numeric-figure{syntax:"*";inherits:false}@property --tw-numeric-spacing{syntax:"*";inherits:false}@property --tw-numeric-fraction{syntax:"*";inherits:false}@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-shadow-color{syntax:"*";inherits:false}@property --tw-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-inset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-shadow-color{syntax:"*";inherits:false}@property --tw-inset-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-ring-color{syntax:"*";inherits:false}@property --tw-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-inset-ring-color{syntax:"*";inherits:false}@property --tw-inset-ring-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-ring-inset{syntax:"*";inherits:false}@property --tw-ring-offset-width{syntax:"<length>";inherits:false;initial-value:0}@property --tw-ring-offset-color{syntax:"*";inherits:false;initial-value:#fff}@property --tw-ring-offset-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-outline-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-blur{syntax:"*";inherits:false}@property --tw-brightness{syntax:"*";inherits:false}@property --tw-contrast{syntax:"*";inherits:false}@property --tw-grayscale{syntax:"*";inherits:false}@property --tw-hue-rotate{syntax:"*";inherits:false}@property --tw-invert{syntax:"*";inherits:false}@property --tw-opacity{syntax:"*";inherits:false}@property --tw-saturate{syntax:"*";inherits:false}@property --tw-sepia{syntax:"*";inherits:false}@property --tw-drop-shadow{syntax:"*";inherits:false}@property --tw-drop-shadow-color{syntax:"*";inherits:false}@property --tw-drop-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-drop-shadow-size{syntax:"*";inherits:false}@property --tw-backdrop-blur{syntax:"*";inherits:false}@property --tw-backdrop-brightness{syntax:"*";inherits:false}@property --tw-backdrop-contrast{syntax:"*";inherits:false}@property --tw-backdrop-grayscale{syntax:"*";inherits:false}@property --tw-backdrop-hue-rotate{syntax:"*";inherits:false}@property --tw-backdrop-invert{syntax:"*";inherits:false}@property --tw-backdrop-opacity{syntax:"*";inherits:false}@property --tw-backdrop-saturate{syntax:"*";inherits:false}@property --tw-backdrop-sepia{syntax:"*";inherits:false}@property --tw-duration{syntax:"*";inherits:false}@property --tw-ease{syntax:"*";inherits:false}@property --tw-content{syntax:"*";inherits:false;initial-value:""}@property --tw-scrollbar-thumb{syntax:"<color>";inherits:false;initial-value:#0000}@property --tw-scrollbar-track{syntax:"<color>";inherits:false;initial-value:#0000}@property --tw-scale-x{syntax:"*";inherits:false;initial-value:1}@property --tw-scale-y{syntax:"*";inherits:false;initial-value:1}@property --tw-scale-z{syntax:"*";inherits:false;initial-value:1}@keyframes spin{to{transform:rotate(360deg)}}@keyframes enter{0%{opacity:var(--tw-enter-opacity,1);transform:translate3d(var(--tw-enter-translate-x,0),var(--tw-enter-translate-y,0),0)scale3d(var(--tw-enter-scale,1),var(--tw-enter-scale,1),var(--tw-enter-scale,1))rotate(var(--tw-enter-rotate,0));filter:blur(var(--tw-enter-blur,0))}}@keyframes exit{to{opacity:var(--tw-exit-opacity,1);transform:translate3d(var(--tw-exit-translate-x,0),var(--tw-exit-translate-y,0),0)scale3d(var(--tw-exit-scale,1),var(--tw-exit-scale,1),var(--tw-exit-scale,1))rotate(var(--tw-exit-rotate,0));filter:blur(var(--tw-exit-blur,0))}}`;
  function registerTailwindProperties(styleEl) {
    var _a, _b;
    const re = /@property\s+(--[\w-]+)\s*\{([^}]*)\}/g;
    let m;
    while ((m = re.exec((_a = styleEl.textContent) != null ? _a : "")) !== null) {
      const [, name, body] = m;
      const pick = (key) => {
        const hit = new RegExp(key + "\\s*:\\s*([^;}]+)").exec(body);
        return hit ? hit[1].trim() : void 0;
      };
      try {
        CSS.registerProperty({
          name,
syntax: ((_b = pick("syntax")) != null ? _b : "*").replace(/^["']+|["']+$/g, ""),
          inherits: pick("inherits") === "true",
          initialValue: pick("initial-value")
        });
      } catch {
      }
    }
  }
  let app$1 = null;
  function mountPanel() {
    const existing = document.getElementById(PANEL_HOST_ID);
    if (existing) return existing;
    const host = document.createElement("div");
    host.id = PANEL_HOST_ID;
    host.style.cssText = "position:fixed;z-index:999999;left:0;top:0;";
    const pt = initialPanelPoint();
    host.style.left = Math.round(pt.x) + "px";
    host.style.top = Math.round(pt.y) + "px";
    document.documentElement.appendChild(host);
    const shadowRoot = host.attachShadow({ mode: "open" });
    setShadowRoot(shadowRoot);
    const style = document.createElement("style");
    style.textContent = css;
    registerTailwindProperties(style);
    shadowRoot.appendChild(style);
    const appContainer = document.createElement("div");
    appContainer.id = "app";
    shadowRoot.appendChild(appContainer);
    initTheme(appContainer);
    app$1 = vue.createApp({ render: () => vue.h(_sfc_main, { host }) });
    app$1.provide(SHADOW_ROOT_KEY, shadowRoot);
    app$1.mount(appContainer);
    return host;
  }
  function unmountPanel() {
    var _a;
    try {
      app$1 == null ? void 0 : app$1.unmount();
    } catch {
    }
    app$1 = null;
    setShadowRoot(null);
    (_a = document.getElementById(PANEL_HOST_ID)) == null ? void 0 : _a.remove();
  }
  let watcher = null;
  function watchPanelHost() {
    if (watcher) return;
    let pending = false;
    watcher = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
        var _a;
        pending = false;
        if (!((_a = document.getElementById(PANEL_HOST_ID)) == null ? void 0 : _a.isConnected)) {
          unmountPanel();
          mountPanel();
        }
      });
    });
    watcher.observe(document.documentElement, { childList: true });
  }
  function unwatchPanelHost() {
    watcher == null ? void 0 : watcher.disconnect();
    watcher = null;
  }
  const app = () => {
    startPerfCollect();
    try {
      setPreMeasureEnabled(loadAllvalue().sniffPreMeasure !== false);
    } catch {
    }
    try {
      mountPanel();
      watchPanelHost();
    } catch (error) {
      console.error("[监控] 面板挂载失败:", error);
      addLog("面板挂载失败: " + (error == null ? void 0 : error.message), "error", true);
    }
    window.addEventListener("beforeunload", () => {
      flushSaveAllvalue();
      stopMonitoring();
      clearSpeechTimer();
      unwatchPanelHost();
    });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", startMonitoring);
    } else {
      startMonitoring();
    }
  };
  app();

})(Vue);