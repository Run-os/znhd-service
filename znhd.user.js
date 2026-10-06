// ==UserScript==
// @name                征纳互动人数和在线监控v2
// @namespace           https://scriptcat.org/
// @version             26.10.06-v3
// @description         实时监控征纳互动等待人数和在线状态，支持语音播报、自定义常用语
// @author              runos
// @match               https://znhd.hunan.chinatax.gov.cn:8443/*
// @match               https://example.com/*
// @icon                https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico
// @grant               GM_addStyle
// @grant               unsafeWindow
// @grant               GM_xmlhttpRequest
// @grant               GM_setClipboard
// @grant               GM_getValue
// @grant               GM_setValue
// @grant               GM_getResourceText
// @connect             *
// @connect             znhd-service.zeabur.app
// @homepageURL         https://scriptcat.org/zh-CN/script-show-page/3650
// @updateURL           https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/dist/znhd.user.js
// @downloadURL         https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/dist/znhd.user.js
// @require             https://scriptcat.org/lib/1167/1.0.0/%E8%84%9A%E6%9C%AC%E7%8C%ABUI%E5%BA%93.js?sha384-jXdR3hCwnDJf53Ue6XHAi6tApeudgS/wXnMYBD/ZJcgge8Xnzu/s7bkEf2tPi2KS
// @require             https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js
// @require             https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js
// @require             https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.js
// @resource            VIEWER_CSS https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.css
// ==/UserScript==
/* eslint-disable */ /* spell-checker: disable */
// @[ 本文件是构建产物，源码与构建方式见 GitHub 仓库 Run-os/znhd-service，请勿直接编辑 ]
// 元信息说明（勿随意改动，均为有意为之）：
//  - @match https://example.com/* ：本脚本面板/弹窗的调试宿主，本地验证用，发布版保留以便排查问题。
//  - @connect * ：中继服务器地址由用户在设置面板自定义（域名不固定），必须通配，无法收窄为固定域名。
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 859
(__unused_webpack_module, exports, __webpack_require__) {


Object.defineProperty(exports, "__esModule", ({ value: true }));
// ========== 依赖（模块化抽出的 lib / ui 模块） ==========
const MainPanel_1 = __webpack_require__(570);
const panelPosition_1 = __webpack_require__(650);
const storage_1 = __webpack_require__(113);
const logger_1 = __webpack_require__(514);
const monitor_1 = __webpack_require__(98);
const speech_1 = __webpack_require__(988);
/**
 * 脚本入口：本文件只做「装配」，业务实现全部在 src/lib/ 与 src/lib/ui/。
 * 顺序：创建主面板 → 跟踪面板位置 → 注册卸载清理 → 启动监控。
 * @returns {void}
 */
const app = () => {
    // ========== 创建主面板 ==========
    // 面板初始位置：优先使用上次保存的位置，否则用默认坐标
    try {
        CAT_UI.createPanel({
            header: {
                title: CAT_UI.Space([
                    CAT_UI.createElement('div', {
                        style: {
                            width: '24px',
                            height: '24px',
                            verticalAlign: 'middle',
                            borderRadius: '4px',
                            display: 'inline-block',
                            backgroundImage: 'url("https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico")',
                            backgroundSize: 'contain',
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'center',
                        },
                    }),
                    CAT_UI.Text('征纳互动监控', {
                        style: { fontSize: '16px' },
                    }),
                    // 获取并显示版本号
                    CAT_UI.Text(`v${GM_info.script.version}`, {
                        style: {
                            fontSize: '12px',
                            color: '#999',
                            marginLeft: '8px',
                        },
                    }),
                ], { style: { marginLeft: '5px' } }),
                style: {
                    borderBottom: '1px solid var(--color-neutral-3)',
                },
            },
            render: MainPanel_1.MainPanel,
            point: (0, storage_1.loadPanelPoint)() || {
                x: window.screen.width * 0.55,
                y: window.screen.height * 0.01,
            },
        });
    }
    catch (error) {
        // UI 面板创建失败时，至少不连累监控逻辑
        console.error('[监控] 面板创建失败:', error);
        if (typeof logger_1.addLog === 'function') {
            (0, logger_1.addLog)('面板创建失败: ' + (error && error.message), 'error', true);
        }
    }
    // ========== 面板位置保存 ==========
    (0, panelPosition_1.setupPanelPositionTracking)();
    // ========== 页面关闭时清理定时器 ==========
    window.addEventListener('beforeunload', () => {
        (0, storage_1.flushSaveAllvalue)(); // 落盘防抖窗口内的最后一笔设置，避免关页丢改动
        (0, monitor_1.stopMonitoring)();
        (0, speech_1.clearSpeechTimer)();
    });
    // ========== 页面启动 ==========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', monitor_1.startMonitoring);
    }
    else {
        (0, monitor_1.startMonitoring)();
    }
};
exports["default"] = app;


/***/ },

/***/ 156
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
const app_1 = __importDefault(__webpack_require__(859));
if (true) {
    (0, app_1.default)();
}
else // removed by dead control flow
{}


/***/ },

/***/ 462
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

/**
 * 更新日志：拉取仓库根的 CHANGELOG.md → 解析成条目 → 弹窗展示（默认最新 10 条）。
 *
 * 设计要点：
 * - 数据源用 CHANGELOG.md 的 raw 原始直链，经 resolveGithubUrl() 按设置里的「使用 CDN 加速」
 *   开关决定走 jsDelivr 还是 raw —— 与常用语 YAML、提示音 mp3 同一套规则，用户无需理解网络细节。
 * - 弹窗默认只渲染最新 CHANGELOG_DEFAULT_LIMIT 条（文件已 300+ 行，全量渲染没必要）；
 *   底部「获取更多日志」跳 CHANGELOG_PAGE_URL（GitHub 网页）看全部历史。
 * - 弹窗样式沿用 gallery.ts 那套「fixed 全屏 overlay + 白盒 + × 关闭 + ESC + z-index 拉满 + 全部
 *   !important」：税务页面 body 常被加 transform，页面/扩展 CSS 也会污染，必须强隔离。
 *   ⚠️ 这里刻意**不**把 gallery 的两个弹窗抽成公共组件：它们与 Viewer.js 的生命周期耦合
 *   （v26.7.29-v9/v10 反复调过），为省几十行样式去动已实测可行的代码不划算（见 AGENT.md）。
 * - 全程走 addLog，便于用户从「设置 → 日志内容」自查失败原因。
 */
__webpack_unused_export__ = ({ value: true });
exports.showChangelogPopup = __webpack_unused_export__ = exports.vU = exports.LI = exports.CJ = void 0;
const logger_1 = __webpack_require__(514);
const utils_1 = __webpack_require__(973);
/** CHANGELOG 数据源（raw 原始直链形式；resolveGithubUrl 会按 useCdn 决定是否转 jsDelivr） */
exports.CJ = 'https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/CHANGELOG.md';
/** 「获取更多日志」按钮跳转的网页地址 */
exports.LI = 'https://github.com/Run-os/znhd-service/blob/main/CHANGELOG.md';
/** 弹窗默认展示的条数 */
exports.vU = 10;
/** 弹窗根节点 id（同时作为 ESC 关闭的判定依据） */
const CHANGELOG_POPUP_ID = '__znhd_changelog_popup__';
/**
 * 把 CHANGELOG.md 文本解析成条目数组。
 * 以 `### ` 开头的行为条目分隔，文件顺序即展示顺序（约定最新在最前），`##` 级标题与前言自动忽略。
 * @param {string} md - CHANGELOG.md 全文
 * @returns {ChangelogEntry[]} 条目数组；没有任何 `### ` 标题时返回空数组
 */
function parseChangelog(md) {
    const entries = [];
    const lines = String(md || '').split(/\r?\n/);
    // 用「标题 + 正文行」两个独立变量，而不是 {title,lines}|null 对象：后者在 forEach 闭包里会被
    // TS 的控制流分析收窄成 never（闭包内对 let 变量的赋值不被追踪），改写成 for 循环更直白
    let curTitle = null;
    let curLines = [];
    for (const line of lines) {
        const m = /^###\s+(.+?)\s*$/.exec(line);
        if (m) {
            if (curTitle !== null)
                entries.push({ title: curTitle, body: curLines.join('\n').trim() });
            curTitle = m[1];
            curLines = [];
            continue;
        }
        if (curTitle !== null)
            curLines.push(line);
    }
    if (curTitle !== null)
        entries.push({ title: curTitle, body: curLines.join('\n').trim() });
    return entries;
}
__webpack_unused_export__ = parseChangelog;
/**
 * markdown 正文 → 易读纯文本（不引第三方渲染器，只做最小变换，避免 XSS 面）：
 * `- `/`* ` 列表项换 `• `、去掉强调与行内代码标记、规整连续空行。
 * @param {string} md - 条目正文（markdown）
 * @returns {string} 便于在弹窗里 pre-wrap 展示的纯文本
 */
function mdToPlain(md) {
    return String(md || '')
        .split(/\r?\n/)
        .map((line) => {
        let s = line.replace(/^(\s*)[-*]\s+/, '$1• ');
        s = s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`/g, '');
        return s.replace(/\s+$/, '');
    })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/** 本次会话内的日志缓存（同一次浏览里重复点按钮不再发请求） */
let _changelogCache = null;
/** ESC 监听只装一次（自保护） */
let _changelogEscInstalled = false;
/** 关闭更新日志弹窗（无弹窗时静默返回） */
function closeChangelogPopup() {
    const ex = document.getElementById(CHANGELOG_POPUP_ID);
    if (ex && ex.parentNode)
        ex.parentNode.removeChild(ex);
}
/**
 * 安装全局 ESC 关闭（只装一次）。
 * gallery.ts 的同类监听只处理图片/文本弹窗，故此处独立安装，互不干扰。
 * @returns {void}
 */
function installEscHandler() {
    if (_changelogEscInstalled)
        return;
    _changelogEscInstalled = true;
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' && e.keyCode !== 27)
            return;
        if (document.getElementById(CHANGELOG_POPUP_ID))
            closeChangelogPopup();
    });
}
/**
 * 拉取并解析 CHANGELOG.md（命中会话缓存则直接回调，不发请求）。
 * @param {(entries: ChangelogEntry[]|null, errMsg?: string) => void} done - 完成回调；失败时 entries 为 null
 * @returns {void}
 */
function loadChangelog(done) {
    if (_changelogCache) {
        done(_changelogCache);
        return;
    }
    GM_xmlhttpRequest({
        method: 'GET',
        url: (0, utils_1.resolveGithubUrl)(exports.CJ),
        timeout: 15000,
        onload: function (response) {
            if (response.status !== 200) {
                const msg = '数据源返回 HTTP ' + response.status;
                (0, logger_1.addLog)('更新日志加载失败: ' + msg, 'error', true);
                done(null, msg);
                return;
            }
            const entries = parseChangelog(response.responseText);
            if (!entries.length) {
                // 404 页面/错误页也可能是合法文本，必须校验解析结果，避免把垃圾当日志渲染
                const msg = '内容为空或格式不符（缺少 ### 标题）';
                (0, logger_1.addLog)('更新日志加载失败: ' + msg, 'error', true);
                done(null, msg);
                return;
            }
            _changelogCache = entries;
            (0, logger_1.addLog)('更新日志加载成功，共 ' + entries.length + ' 条', 'info');
            done(entries);
        },
        onerror: function (error) {
            const errMsg = error && error.message ? error.message : typeof error === 'string' ? error : '网络错误';
            (0, logger_1.addLog)('更新日志加载失败: ' + errMsg, 'error', true);
            done(null, errMsg);
        },
        ontimeout: function () {
            (0, logger_1.addLog)('更新日志加载超时（15s），已取消', 'error', true);
            done(null, '请求超时（15s）');
        },
    });
}
/**
 * 把条目渲染进弹窗内容区。
 * @param {HTMLElement} content - 内容容器
 * @param {ChangelogEntry[]} entries - 全部条目
 * @param {HTMLElement} hint - 底部条数提示节点
 * @returns {void}
 */
function renderEntries(content, entries, hint) {
    const show = entries.slice(0, exports.vU);
    content.textContent = '';
    show.forEach((en) => {
        const item = document.createElement('div');
        item.style.cssText = 'margin:0 0 14px!important;';
        const h = document.createElement('div');
        h.textContent = en.title;
        h.style.cssText =
            'font-size:14px!important;font-weight:bold!important;color:#1890ff!important;margin:0 0 6px!important;';
        const b = document.createElement('div');
        b.textContent = mdToPlain(en.body);
        b.style.cssText =
            'font-size:13px!important;line-height:1.6!important;color:#333!important;white-space:pre-wrap!important;word-break:break-word!important;';
        item.appendChild(h);
        item.appendChild(b);
        content.appendChild(item);
    });
    hint.textContent =
        entries.length > show.length
            ? '共 ' + entries.length + ' 条，已显示最新 ' + show.length + ' 条'
            : '共 ' + entries.length + ' 条（已全部显示）';
}
/** 显示「读取中…」占位 */
function showLoading(content, hint) {
    content.textContent = '';
    const loading = document.createElement('div');
    loading.textContent = '读取中…';
    loading.style.cssText = 'font-size:14px!important;color:#999!important;padding:20px 0!important;';
    content.appendChild(loading);
    hint.textContent = '';
}
/** 显示失败提示（仍保留「获取更多日志」按钮可用） */
function showError(content, hint, errMsg) {
    content.textContent = '';
    const err = document.createElement('div');
    err.textContent = '读取失败：' + errMsg;
    err.style.cssText = 'font-size:13px!important;color:#e4393c!important;line-height:1.6!important;';
    const tip = document.createElement('div');
    tip.textContent = '可点下方「获取更多日志」在浏览器中打开 CHANGELOG.md 查看。';
    tip.style.cssText =
        'font-size:13px!important;color:#999!important;line-height:1.6!important;margin-top:8px!important;';
    content.appendChild(err);
    content.appendChild(tip);
    hint.textContent = '';
}
/**
 * 弹出更新日志窗口（默认最新 10 条 + 「获取更多日志」跳转）。
 * 重复点击先关闭旧弹窗再重建；加载完成时若弹窗已被关闭则丢弃结果。
 * @returns {void}
 */
function showChangelogPopup() {
    closeChangelogPopup();
    installEscHandler();
    const overlay = document.createElement('div');
    overlay.id = CHANGELOG_POPUP_ID;
    // 同 gallery 弹窗：全屏 fixed + 全部 !important，隔绝页面/扩展 CSS 污染
    overlay.style.cssText =
        'position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,0.55)!important;opacity:1!important;font-family:sans-serif!important;';
    const box = document.createElement('div');
    box.style.cssText =
        'position:relative!important;z-index:1!important;width:min(620px,92vw)!important;max-height:88vh!important;background:#fff!important;opacity:1!important;border-radius:12px!important;padding:16px!important;box-shadow:0 8px 30px rgba(0,0,0,0.35)!important;display:flex!important;flex-direction:column!important;filter:none!important;backdrop-filter:none!important;isolation:isolate!important;';
    const title = document.createElement('div');
    title.textContent = '更新日志（最新 ' + exports.vU + ' 条）';
    title.style.cssText =
        'font-size:15px!important;font-weight:bold!important;color:#333!important;margin:0 0 10px 2px!important;';
    // 右上角关闭：box 是 flex 容器，标题作为 flex item 在层叠里等同 z-index:0，
    // 关闭按钮需显式抬到 z-index:2，否则标题的隐形盒子会吃掉点击（同 gallery 弹窗的实测结论）
    const close = document.createElement('div');
    close.textContent = '×';
    close.title = '关闭';
    close.style.cssText =
        'position:absolute!important;top:8px!important;right:10px!important;width:30px!important;height:30px!important;line-height:28px!important;text-align:center!important;font-size:22px!important;color:#fff!important;cursor:pointer!important;border-radius:50%!important;background:#e4393c!important;opacity:1!important;box-shadow:0 1px 4px rgba(0,0,0,0.3)!important;font-weight:bold!important;z-index:2!important;';
    close.onmouseenter = () => {
        close.style.background = '#c9302c';
    };
    close.onmouseleave = () => {
        close.style.background = '#e4393c';
    };
    close.onclick = () => closeChangelogPopup();
    const content = document.createElement('div');
    content.id = '__znhd_changelog_content__';
    content.style.cssText =
        'overflow-y:auto!important;padding:2px!important;max-height:62vh!important;border:1px solid #eee!important;border-radius:8px!important;background:#fafafa!important;padding:12px!important;filter:none!important;opacity:1!important;';
    const hint = document.createElement('div');
    hint.style.cssText =
        'font-size:12px!important;color:#999!important;margin-top:8px!important;text-align:center!important;';
    const moreBtn = document.createElement('button');
    moreBtn.textContent = '获取更多日志';
    moreBtn.style.cssText =
        'margin-top:10px!important;padding:8px 18px!important;border:none!important;border-radius:8px!important;background:#1890ff!important;color:#fff!important;font-size:14px!important;opacity:1!important;cursor:pointer!important;align-self:center!important;';
    moreBtn.onmouseenter = () => {
        moreBtn.style.background = '#096dd9';
    };
    moreBtn.onmouseleave = () => {
        moreBtn.style.background = '#1890ff';
    };
    moreBtn.onclick = () => {
        window.open(exports.LI, '_blank');
    };
    overlay.onclick = (e) => {
        if (e.target === overlay)
            closeChangelogPopup();
    };
    box.appendChild(close);
    box.appendChild(title);
    box.appendChild(content);
    box.appendChild(hint);
    box.appendChild(moreBtn);
    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);
    // 焦点隔离（同 gallery/文本弹窗）：避免与 arco 抽屉/弹窗的焦点锁冲突刷 focus-fighting 警告；
    // 按钮仍可鼠标点击触发 onClick
    overlay.querySelectorAll('button').forEach(function (b) {
        b.tabIndex = -1;
        b.addEventListener('mousedown', function (e) {
            e.preventDefault();
        });
    });
    showLoading(content, hint);
    loadChangelog((entries, errMsg) => {
        // 弹窗可能已被关闭（用户等得不耐烦点了 × / ESC），此时丢弃结果，避免写进游离节点
        if (!document.getElementById(CHANGELOG_POPUP_ID))
            return;
        if (!entries) {
            showError(content, hint, errMsg || '未知错误');
            return;
        }
        renderEntries(content, entries, hint);
    });
}
exports.showChangelogPopup = showChangelogPopup;


/***/ },

/***/ 170
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.safeCopyText = void 0;
const constants_1 = __webpack_require__(149);
const logger_1 = __webpack_require__(514);
const utils_1 = __webpack_require__(973);
/**
 * 剪贴板与提示音（原 app.ts 的 playDidaSound / safeCopyText）。
 * 模块化 P3：逐字迁移，仅加 export（playDidaSound 仅内部使用，不导出）。
 */
// 复用的音频播放器实例（避免每次创建新对象）
let didaAudioPlayer = null;
// 播放提示音函数
/**
 * 播放提示音（dida.mp3）。复用 Audio 实例，避免重复解码。
 * @returns {void}
 */
function playDidaSound() {
    if (!constants_1.CONFIG.didaUrl)
        return;
    try {
        // 复用 Audio 实例，避免重复解码
        if (!didaAudioPlayer) {
            didaAudioPlayer = new Audio();
            didaAudioPlayer.volume = 0.5;
        }
        // src 每次按当前 useCdn 状态解析并比对重设：切换 CDN 开关后提示音即刻走新选择，无需刷新
        const src = (0, utils_1.resolveGithubUrl)(constants_1.CONFIG.didaUrl);
        if (didaAudioPlayer.src !== src)
            didaAudioPlayer.src = src;
        // 重置播放位置并播放
        didaAudioPlayer.currentTime = 0;
        // play() 的 rejection 多来自浏览器自动播放策略（预期行为），静默忽略避免干扰
        didaAudioPlayer.play().catch(() => {
            // 预期行为：被浏览器自动播放策略拒绝，静默忽略避免干扰
        });
    }
    catch (e) {
        // 结构性异常（如 Audio 构造/赋值失败）需留痕，便于排查
        (0, logger_1.addLog)('播放提示音失败: ' + e.message, 'warning', true);
    }
}
// 安全复制工具：仅在页面聚焦且支持 clipboard 时尝试复制
/**
 * 安全复制文本到剪贴板：优先 GM_setClipboard（无需焦点），降级到 navigator.clipboard；
 * 成功复制后播放提示音。失败时记录日志，不抛出。
 * @param {string} text - 待复制文本（空值直接返回并回调 false）
 * @param {Function} [onResult] - 可选结果回调 (ok:boolean)，供调用方据实更新 UI（如复制按钮文案）
 * @returns {void}
 */
function safeCopyText(text, onResult = null) {
    const notify = (v) => {
        if (typeof onResult === 'function') {
            try {
                onResult(!!v);
            }
            catch (e) {
                /* 忽略回调异常 */
            }
        }
    };
    if (!text) {
        notify(false);
        return;
    }
    // 1) 优先使用 GM_setClipboard（无需焦点）
    if (typeof GM_setClipboard === 'function') {
        try {
            GM_setClipboard(text);
            (0, logger_1.addLog)('[复制] 已复制到剪贴板 (GM_setClipboard)', 'success', true);
            playDidaSound();
            notify(true);
            return;
        }
        catch (e) {
            (0, logger_1.addLog)('[复制] GM_setClipboard 失败: ' + e.message, 'error', true);
        }
    }
    // 2) 浏览器异步 clipboard API
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard
            .writeText(text)
            .then(() => {
            (0, logger_1.addLog)('[复制] 已复制到剪贴板 (navigator.clipboard)', 'success', true);
            playDidaSound();
            notify(true);
        })
            .catch((err) => {
            (0, logger_1.addLog)('[复制] 复制到剪贴板失败: ' + err.message, 'error', true);
            notify(false);
        });
        return;
    }
    notify(false); // 无任何可用复制途径
}
exports.safeCopyText = safeCopyText;


/***/ },

/***/ 149
(__unused_webpack_module, exports) {

var __webpack_unused_export__;

/**
 * 全局常量与默认配置（原 app.ts「配置」段 + 「存储管理」段的键名/DEFAULTS）。
 * 模块化 P1：逐字迁移，仅加 export。
 */
__webpack_unused_export__ = ({ value: true });
exports.DEFAULTS = exports.PHRASES_CACHE_TTL = exports.PHRASES_CACHE_KEY = exports.PANEL_POINT_KEY = exports.STORAGE_KEY = exports.CONFIG = void 0;
// ==========配置==========
// 配置对象，集中管理可配置项
exports.CONFIG = {
    CHECK_INTERVAL: 3000,
    MAX_LOG_ENTRIES: 20,
    // 提示音地址（GitHub 网页链接，运行时由 resolveGithubUrl() 按 useCdn 决定是否转 CDN）
    didaUrl: 'https://github.com/Run-os/znhd-service/blob/refs/heads/main/public/dida.mp3',
    // 语音播报超时保护（毫秒），防止 onend/onerror 不触发导致队列卡死
    SPEECH_TIMEOUT: 15000,
    // 语音队列最大长度，超过时丢弃最早（最旧）的消息，防止内存堆积
    MAX_SPEECH_QUEUE: 10,
    // 语音队列消息有效期（毫秒），超过该时长的陈旧消息在入队/播放前被剔除，避免播报过时内容
    SPEECH_QUEUE_TTL: 30000,
};
// ==========存储管理==========
// 存储键名
exports.STORAGE_KEY = 'scriptCat_Allvalue';
// 面板位置单独存储（与设置数据解耦，避免拖拽频繁写入设置）
exports.PANEL_POINT_KEY = 'scriptCat_PanelPoint';
// 常用语缓存（2 小时内且 URL 未变则跳过网络请求，直接复用本地数据）
exports.PHRASES_CACHE_KEY = 'scriptCat_PhrasesCache';
exports.PHRASES_CACHE_TTL = 2 * 60 * 60 * 1000; // 缓存有效期：2 小时（毫秒）
exports.DEFAULTS = {
    voiceEnabled: true,
    // 监控时间段（单位：小时，可含小数，如 13.5 表示 13:30）
    workingHours: {
        morningStart: 9,
        morningEnd: 12,
        afternoonStart: 13.5,
        afternoonEnd: 18,
    },
    // 是否使用 CDN 加速（jsDelivr）加载项目内的 GitHub 资源（常用语 YAML、提示音 mp3 等）。
    // true=经 jsDelivr 加速；false=直接走 GitHub 原始链接（raw.githubusercontent.com）。
    useCdn: true,
    // 常用语数据源（可配置；留空时回退此默认地址）。
    // 存「raw 原始直链」（resolveGithubUrl 形式二）：useCdn=true 时仍会转 jsDelivr 加速，false 时直连 raw。
    // 不用「github.com/blob 网页链接」作规范值——若用户把该字段误填成网页/仓库页面，请求会拉回整页 HTML
    // （如 --fontStack-monospace 的 CSS），jsyaml 解析即报「document separator expected」（v26.9.6-v5 起因）。
    commonPhrasesUrl: 'https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/public/commonPhrases.yaml',
    // 手机图片→电脑剪贴板 中继服务器地址（需为公网可访问的 http(s):// 地址，末尾不带 /）
    relayServer: 'https://znhd.122050.xyz',
};


/***/ },

/***/ 406
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.showTextPopup = exports.renderImageGallery = exports.showImagePopup = exports.receivedImages = void 0;
const logger_1 = __webpack_require__(514);
const relay_1 = __webpack_require__(289);
const clipboard_1 = __webpack_require__(170);
/**
 * 收到图片的九宫格画廊 + 文本弹窗（原 app.ts「收到图片」段）。
 * 模块化 P4：逐字迁移，仅加 export。
 * ⚠️ 弹窗 CSS / z-index / Viewer 接管逻辑是真实页面实测结论，禁止「顺手重构」。
 */
// ========== 收到图片：九宫格画廊弹窗（Viewer.js 放大查看） ==========
// 收到的图片累积进 receivedImages 列表，以 3 列九宫格缩略图展示（直接挂 document.documentElement，
// 不受 CAT_UI 面板 transform 影响）。单击缩略图用 Viewer.js 放大（缩放/旋转/多图左右切换），
// 每张图下方有「复制」按钮（点击手势触发，满足浏览器剪贴板策略）和右上角 × 移除。
const MAX_GALLERY = 27; // 画廊最多保留张数，超出丢最旧（释放其 objectURL）
exports.receivedImages = [];
let galleryViewer = null; // Viewer.js 实例（重建画廊时先销毁）
let galleryViewerObserver = null; // 监听 Viewer 全屏容器出现并移入画廊遮罩的 MutationObserver
let viewerCssInjected = false;
// 注入 Viewer.js 的 CSS：优先 @resource（GM_getResourceText），失败回退 CDN <link>
function ensureViewerCss() {
    if (viewerCssInjected)
        return;
    let baseInjected = false;
    try {
        const css = typeof GM_getResourceText === 'function' ? GM_getResourceText('VIEWER_CSS') : '';
        if (css) {
            GM_addStyle(css);
            baseInjected = true;
        }
    }
    catch (e) {
        /* 继续走 link 回退 */
    }
    if (!baseInjected) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.css';
        (document.head || document.documentElement).appendChild(link);
    }
    // 覆盖样式：Viewer.js 默认遮罩是半透明黑（rgba(0,0,0,0.5)），放大时会透出后面的画廊弹窗；
    // 改为纯黑不透明，彻底遮住背景（!important 保证无论加载顺序都生效）
    GM_addStyle('.viewer-backdrop{background-color:#000 !important;}' + '.viewer-container{background-color:#000 !important;}');
    viewerCssInjected = true;
}
/**
 * 生成下载文件名：优先原始文件名；无名或无扩展名时按 mime 补扩展名。
 * @param {string} name - 原始文件名（可空）
 * @param {string} mime - MIME 类型
 * @param {number} idx - 画廊序号（用于兜底命名）
 * @returns {string} 带扩展名的文件名
 */
function downloadFileName(name, mime, idx) {
    const extByMime = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'image/bmp': '.bmp',
    };
    let n = String(name || '').trim();
    if (!n)
        n = 'znhd-image-' + (idx + 1);
    if (!/\.[a-z0-9]{2,5}$/i.test(n))
        n += extByMime[(mime || '').toLowerCase()] || '.jpg';
    return n;
}
// 对外入口（poll 回调调用）：新图入列并打开/刷新画廊弹窗
function showImagePopup(img) {
    img.ts = Date.now();
    exports.receivedImages.push(img);
    while (exports.receivedImages.length > MAX_GALLERY) {
        const old = exports.receivedImages.shift(); // 上面 while 已保证长度 > MAX_GALLERY，不会取空
        try {
            URL.revokeObjectURL(old.previewUrl);
        }
        catch (e) {
            /* 忽略 */
        }
    }
    renderImageGallery();
}
exports.showImagePopup = showImagePopup;
function removeGalleryImage(idx) {
    const it = exports.receivedImages.splice(idx, 1)[0];
    if (it) {
        try {
            URL.revokeObjectURL(it.previewUrl);
        }
        catch (e) {
            /* 忽略 */
        }
    }
    if (exports.receivedImages.length === 0)
        closeImagePopup();
    else
        renderImageGallery();
}
function renderImageGallery() {
    closeImagePopup(); // 重建（销毁旧 Viewer 实例与旧 DOM）
    installPopupKeyHandler(); // 安装全局 ESC 关闭（预览态→退出预览；画廊态→关弹窗）
    ensureViewerCss();
    const overlay = document.createElement('div');
    overlay.id = '__znhd_img_popup__';
    // 所有样式加 !important + 铺满 100vw/vh，隔绝任何外部 CSS（含扩展/页面）对弹窗的覆盖
    overlay.style.cssText =
        'position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,0.55)!important;opacity:1!important;font-family:sans-serif!important;';
    const box = document.createElement('div');
    box.style.cssText =
        'position:relative!important;z-index:1!important;width:min(560px,92vw)!important;max-height:88vh!important;background:#fff!important;opacity:1!important;border-radius:12px!important;padding:16px!important;box-shadow:0 8px 30px rgba(0,0,0,0.35)!important;display:flex!important;flex-direction:column!important;filter:none!important;backdrop-filter:none!important;isolation:isolate!important;';
    // 标题
    const title = document.createElement('div');
    title.textContent = '收到的图片（' + exports.receivedImages.length + '）· 单击放大，最新图片在最后';
    title.style.cssText =
        'font-size:15px!important;font-weight:bold!important;color:#333!important;margin:0 0 10px 2px!important;';
    // 右上角关闭
    const close = document.createElement('div');
    close.textContent = '×';
    close.title = '关闭（图片保留，收到新图会再次弹出）';
    // 注意：box 是 display:flex 容器，标题作为 flex item 在层叠里等同 z-index:0 层；
    // 关闭按钮是 position:absolute（同属 z-index:auto 层），同层按 DOM 顺序——标题在关闭按钮之后 append，
    // 会画到关闭按钮之上并吃掉点击（视觉无重叠，但标题隐形盒子铺满整行）。故显式抬到 z-index:2 确保可点。
    close.style.cssText =
        'position:absolute!important;top:8px!important;right:10px!important;width:30px!important;height:30px!important;line-height:28px!important;text-align:center!important;font-size:22px!important;color:#fff!important;cursor:pointer!important;border-radius:50%!important;background:#e4393c!important;opacity:1!important;box-shadow:0 1px 4px rgba(0,0,0,0.3)!important;font-weight:bold!important;z-index:2!important;';
    close.onmouseenter = () => {
        close.style.background = '#c9302c';
    };
    close.onmouseleave = () => {
        close.style.background = '#e4393c';
    };
    close.onclick = () => closeImagePopup();
    // 九宫格容器（3 列，可滚动）
    const grid = document.createElement('div');
    grid.id = '__znhd_img_grid__';
    grid.style.cssText =
        'display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:10px!important;overflow-y:auto!important;padding:2px!important;max-height:60vh!important;filter:none!important;backdrop-filter:none!important;opacity:1!important;';
    exports.receivedImages.forEach((it, idx) => {
        const cell = document.createElement('div');
        cell.style.cssText = 'position:relative!important;display:flex!important;flex-direction:column!important;';
        const thumbWrap = document.createElement('div');
        thumbWrap.style.cssText =
            'position:relative!important;width:100%!important;aspect-ratio:1/1!important;border-radius:8px!important;overflow:hidden!important;background:#f2f2f2!important;cursor:zoom-in!important;filter:none!important;backdrop-filter:none!important;opacity:1!important;';
        const imgEl = document.createElement('img');
        imgEl.src = it.previewUrl;
        imgEl.alt = it.name || 'image-' + (idx + 1);
        imgEl.style.cssText =
            'width:100%!important;height:100%!important;object-fit:cover!important;display:block!important;filter:none!important;opacity:1!important;';
        thumbWrap.appendChild(imgEl);
        // 单张移除 ×
        const del = document.createElement('div');
        del.textContent = '×';
        del.title = '移除这张';
        del.style.cssText =
            'position:absolute!important;top:4px!important;right:4px!important;width:20px!important;height:20px!important;line-height:18px!important;text-align:center!important;font-size:14px!important;color:#fff!important;cursor:pointer!important;border-radius:50%!important;background:rgba(0,0,0,0.55)!important;font-weight:bold!important;z-index:2!important;';
        del.onclick = (e) => {
            e.stopPropagation();
            removeGalleryImage(idx);
        };
        thumbWrap.appendChild(del);
        // 按钮行：复制（写剪贴板）+ 下载（存为文件）
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex!important;gap:4px!important;margin-top:6px!important;';
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '复制';
        copyBtn.style.cssText =
            'flex:1!important;padding:4px 0!important;border:none!important;border-radius:6px!important;background:#1890ff!important;color:#fff!important;font-size:12px!important;opacity:1!important;cursor:pointer!important;filter:none!important;backdrop-filter:none!important;';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyBtn.textContent = '复制中…';
            copyBtn.disabled = true;
            (0, relay_1.copyImageToClipboard)(it.blob).then((ok) => {
                copyBtn.disabled = false;
                if (ok) {
                    copyBtn.textContent = '✓ 已复制';
                    copyBtn.style.background = '#52c41a';
                    (0, logger_1.addLog)('图片已复制到剪贴板: ' + (it.name || ''), 'success');
                }
                else {
                    copyBtn.textContent = '复制失败';
                    copyBtn.style.background = '#e4393c';
                }
            });
        };
        const dlBtn = document.createElement('button');
        dlBtn.textContent = '下载';
        dlBtn.style.cssText =
            'flex:1!important;padding:4px 0!important;border:none!important;border-radius:6px!important;background:#722ed1!important;color:#fff!important;font-size:12px!important;opacity:1!important;cursor:pointer!important;filter:none!important;backdrop-filter:none!important;';
        dlBtn.onclick = (e) => {
            e.stopPropagation();
            try {
                const fname = downloadFileName(it.name, it.mime, idx);
                const a = document.createElement('a');
                const url = URL.createObjectURL(it.blob);
                a.href = url;
                a.download = fname;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => {
                    try {
                        URL.revokeObjectURL(url);
                    }
                    catch (e2) {
                        /* 忽略 */
                    }
                }, 3000);
                dlBtn.textContent = '✓ 已下载';
                dlBtn.style.background = '#52c41a';
                (0, logger_1.addLog)('图片已下载: ' + fname, 'success');
            }
            catch (err) {
                dlBtn.textContent = '下载失败';
                dlBtn.style.background = '#e4393c';
                (0, logger_1.addLog)('[下载] 失败：' + err.message, 'error', true);
            }
        };
        btnRow.appendChild(copyBtn);
        btnRow.appendChild(dlBtn);
        cell.appendChild(thumbWrap);
        cell.appendChild(btnRow);
        grid.appendChild(cell);
    });
    // 底部操作条
    const bar = document.createElement('div');
    bar.style.cssText =
        'display:flex!important;justify-content:center!important;gap:12px!important;margin-top:12px!important;';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空全部';
    clearBtn.style.cssText =
        'padding:7px 18px!important;border:none!important;border-radius:8px!important;background:#999!important;color:#fff!important;font-size:13px!important;cursor:pointer!important;filter:none!important;backdrop-filter:none!important;';
    clearBtn.onclick = () => {
        exports.receivedImages.forEach((it) => {
            try {
                URL.revokeObjectURL(it.previewUrl);
            }
            catch (e) {
                /* 忽略 */
            }
        });
        exports.receivedImages.length = 0;
        closeImagePopup();
    };
    bar.appendChild(clearBtn);
    box.appendChild(close);
    box.appendChild(title);
    box.appendChild(grid);
    box.appendChild(bar);
    overlay.appendChild(box);
    overlay.onclick = (e) => {
        if (e.target === overlay)
            closeImagePopup();
    };
    document.documentElement.appendChild(overlay); // 挂到 <html> 而非 <body>：避开 body 级 transform/filter 改写 fixed 包含块
    // 焦点隔离：弹窗内的 <button> 设为不可 Tab 聚焦，且点击时不抢占焦点。
    // 否则当脚本面板或税务页面自身的 arco 抽屉/弹窗（带 focus-lock 焦点锁）同时开着时，
    // 焦点在抽屉与弹窗按钮间来回“打架”，控制台会刷出 "FocusLock: focus-fighting detected"。
    // 鼠标点击仍正常触发 onClick，不影响复制/下载/清空功能。
    overlay.querySelectorAll('button').forEach(function (b) {
        b.tabIndex = -1;
        b.addEventListener('mousedown', function (e) {
            e.preventDefault();
        });
    });
    // 用 Viewer.js 绑定画廊：单击缩略图放大，多图可左右切换
    if (typeof Viewer === 'function') {
        try {
            galleryViewer = new Viewer(grid, {
                zIndex: 2147483647,
                zoomRatio: 0.4,
                // ⚠️ 必须关掉过渡（v26.10.8-v1 修「点缩略图放大后有时长时间不出图 / 只有黑罩」）：
                // Viewer.js 的 shown()（设置 isShown=true、创建主图、执行 render()+bind()）**只由容器的
                // transitionend 触发**（viewer.js 的 show()：addListener(viewer,'transitionend',shown)）。
                // 而本文件下方那段 MutationObserver 会在容器刚出现时把它 appendChild 移进画廊 overlay，
                // **移动 DOM 节点会打断正在进行的 CSS 过渡** → transitionend 不再触发 → shown() 永不执行
                // → isShown 永远 false → 之后每次 view() 都在 `!this.isShown` 处提前 return，主图从不被创建；
                // 且 this.showing 卡在 true（只在 shown() 里清），反复点击同样无效。
                // 实测：默认过渡下 4 秒内 .viewer-canvas 始终为空；transition:false 后 22~29ms 出图。
                // 原理：transition:false 时 show() 走 else 分支**同步调用 shown()**，彻底不依赖过渡事件；
                // hide() 亦因未加 CLASS_TRANSITION 而走 hideImmediately() 同步收尾，连带消掉关闭侧残留容器风险。
                // 代价：失去放大/关闭的淡入淡出（换确定性，值得）。改前请读 AGENT.md 约束 3。
                transition: false,
                title: (image) => image.alt || '',
                toolbar: {
                    zoomIn: 1,
                    zoomOut: 1,
                    oneToOne: 1,
                    reset: 1,
                    prev: 1,
                    next: 1,
                    rotateLeft: 1,
                    rotateRight: 1,
                    flipHorizontal: 1,
                    flipVertical: 1,
                },
                filter(image) {
                    return true;
                },
            });
            // 关键：把 Viewer 全屏预览容器移入画廊遮罩内部，使其处于本弹窗的层叠上下文之上（高于白盒），
            // 避免与画廊遮罩（同为 2147483647）互相压制导致「预览跑到弹窗后面」或「关闭按钮被盖住」。
            // 否则在真实税务页面里 body 常被加 transform/filter 形成独立层叠上下文，把挂在 body 下的 Viewer
            // 困住，永远被画廊压在后面；且全屏 Viewer 容器与画廊遮罩等 z-index 时会盖住画廊右上角的 ×。
            // 移入后：全屏预览盖在白盒之上，由 Viewer 自带 × 关闭回到画廊（标准模态交互）。
            // 用 MutationObserver 监听 .viewer-container 出现即移入（Viewer.js 该构建的事件 API 不可靠，不依赖之）。
            if (window.MutationObserver) {
                if (galleryViewerObserver) {
                    try {
                        galleryViewerObserver.disconnect();
                    }
                    catch (e) {
                        /* 忽略 */
                    }
                }
                // 移动成功后不再重复查询：本观察器监听整个 documentElement 的 subtree，
                // 税务页每次 DOM 变更都会触发回调，而真正要干的「移入 overlay」一辈子只成功一次。
                // 保留观察器（不断开）是为兼容可能重建容器的 Viewer 构建，代价只剩一次布尔判断。
                let viewerMoved = false;
                galleryViewerObserver = new MutationObserver(function () {
                    if (viewerMoved)
                        return;
                    const vc = document.querySelector('.viewer-container');
                    if (vc && vc.parentNode !== overlay) {
                        overlay.appendChild(vc);
                        viewerMoved = true;
                        vc.style.zIndex = '2'; // 在画廊遮罩上下文内，高于白盒(z-index:1)
                        // 安全网：监听 Viewer 显隐（viewer-in 类的增删，不依赖其事件 API）。
                        // 显示时允许交互；隐藏后置 pointer-events:none，避免残留容器遮挡画廊关闭按钮/缩略图。
                        if (!vc.__znhdWatched) {
                            vc.__znhdWatched = true;
                            vc.style.pointerEvents = vc.className.indexOf('viewer-in') >= 0 ? 'auto' : 'none';
                            new MutationObserver(function () {
                                vc.style.pointerEvents = vc.className.indexOf('viewer-in') >= 0 ? 'auto' : 'none';
                            }).observe(vc, { attributes: true, attributeFilter: ['class'] });
                        }
                    }
                });
                galleryViewerObserver.observe(document.documentElement, { childList: true, subtree: true });
            }
        }
        catch (e) {
            (0, logger_1.addLog)('[设备互联] Viewer 初始化失败：' + e.message, 'error', true);
        }
    }
    else {
        (0, logger_1.addLog)('[设备互联] Viewer.js 未加载，单击放大不可用（缩略图仍可复制）', 'warning', true);
    }
}
exports.renderImageGallery = renderImageGallery;
function closeImagePopup() {
    if (galleryViewerObserver) {
        try {
            galleryViewerObserver.disconnect();
        }
        catch (e) {
            /* 忽略 */
        }
        galleryViewerObserver = null;
    }
    if (galleryViewer) {
        try {
            galleryViewer.destroy();
        }
        catch (e) {
            /* 忽略 */
        }
        galleryViewer = null;
    }
    const ex = document.getElementById('__znhd_img_popup__');
    if (ex && ex.parentNode)
        ex.parentNode.removeChild(ex);
}
// 全局 ESC 关闭：图片预览（Viewer）可见时先退出预览回画廊；画廊态时关闭整个弹窗；
// 文本弹窗则直接关闭。Viewer.js 自带键盘监听在本脚本「把 .viewer-container 移入 overlay」的
// 特殊处理 + 真实税务页面 body 常被加 transform 的环境下常常失效，这里用独立监听兜底，确保 ESC 一定可用。
// 仅安装一次（自保护），内部按当前弹窗状态分支处理。
let _znhdPopupKeyInstalled = false;
function installPopupKeyHandler() {
    if (_znhdPopupKeyInstalled)
        return;
    _znhdPopupKeyInstalled = true;
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' && e.keyCode !== 27)
            return;
        // 图片画廊弹窗优先
        const gallery = document.getElementById('__znhd_img_popup__');
        if (gallery) {
            const vc = document.querySelector('.viewer-container');
            const viewerVisible = vc && vc.className.indexOf('viewer-in') >= 0;
            if (viewerVisible && galleryViewer) {
                try {
                    galleryViewer.hide();
                }
                catch (err) {
                    /* 忽略 */
                }
            }
            else {
                closeImagePopup();
            }
            return;
        }
        const textPopup = document.getElementById('__znhd_text_popup__');
        if (textPopup) {
            closeTextPopup();
        }
    });
}
// 收到手机文本时，在网页正中弹出预览弹窗（与图片弹窗同一挂法：document.documentElement），
// 含文本展示区、复制到剪贴板按钮（复用 safeCopyText，满足浏览器剪贴板策略并记日志/提示音）、关闭按钮。
function showTextPopup(txt) {
    closeTextPopup();
    installPopupKeyHandler(); // 安装全局 ESC 关闭（文本弹窗直接关闭）
    const overlay = document.createElement('div');
    overlay.id = '__znhd_text_popup__';
    overlay.style.cssText =
        'position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,0.55)!important;opacity:1!important;font-family:sans-serif!important;';
    const box = document.createElement('div');
    box.style.cssText =
        'position:relative!important;min-width:360px!important;min-height:200px!important;max-width:90vw!important;max-height:90vh!important;background:#fff!important;opacity:1!important;border-radius:12px!important;padding:16px!important;box-shadow:0 8px 30px rgba(0,0,0,0.35)!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;';
    const textEl = document.createElement('div');
    textEl.textContent = txt.text || '';
    textEl.style.cssText =
        'min-width:320px!important;min-height:120px!important;max-width:80vw!important;max-height:55vh!important;overflow:auto!important;white-space:pre-wrap!important;word-break:break-word!important;font-size:15px!important;line-height:1.6!important;color:#222!important;background:#f7f7f7!important;opacity:1!important;border:1px solid #eee!important;border-radius:8px!important;padding:12px!important;';
    const close = document.createElement('div');
    close.textContent = '×';
    close.title = '关闭';
    // 同上：box 为 display:flex 容器，标题/正文为 flex item（等同 z-index:0 层），需把关闭按钮抬到 z-index:2 才能被点中。
    close.style.cssText =
        'position:absolute!important;top:8px!important;right:10px!important;width:30px!important;height:30px!important;line-height:28px!important;text-align:center!important;font-size:22px!important;color:#fff!important;cursor:pointer!important;border-radius:50%!important;background:#e4393c!important;opacity:1!important;box-shadow:0 1px 4px rgba(0,0,0,0.3)!important;font-weight:bold!important;z-index:2!important;';
    close.onmouseenter = () => {
        close.style.background = '#c9302c';
    };
    close.onmouseleave = () => {
        close.style.background = '#e4393c';
    };
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制到剪贴板';
    copyBtn.style.cssText =
        'margin-top:14px!important;padding:8px 18px!important;border:none!important;border-radius:8px!important;background:#1890ff!important;color:#fff!important;font-size:14px!important;opacity:1!important;cursor:pointer!important;align-self:center!important;';
    copyBtn.onclick = () => {
        copyBtn.textContent = '复制中…';
        copyBtn.disabled = true;
        // 用 safeCopyText 的真实结果更新按钮文案：无可用复制途径/被拒绝时不再假显示「已复制」
        (0, clipboard_1.safeCopyText)(txt.text || '', (ok) => {
            copyBtn.disabled = false;
            copyBtn.textContent = ok ? '✓ 已复制' : '复制失败，请长按文本手动复制';
            copyBtn.style.background = ok ? '#52c41a' : '#e4393c';
        });
    };
    close.onclick = () => closeTextPopup();
    overlay.onclick = (e) => {
        if (e.target === overlay)
            closeTextPopup();
    };
    box.appendChild(close);
    box.appendChild(textEl);
    box.appendChild(copyBtn);
    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);
    // 焦点隔离（同图片弹窗）：避免与 arco 抽屉/弹窗的焦点锁冲突刷出 focus-fighting 警告。
    // 按钮仍可鼠标点击触发 onClick。
    overlay.querySelectorAll('button').forEach(function (b) {
        b.tabIndex = -1;
        b.addEventListener('mousedown', function (e) {
            e.preventDefault();
        });
    });
}
exports.showTextPopup = showTextPopup;
function closeTextPopup() {
    const ex = document.getElementById('__znhd_text_popup__');
    if (ex && ex.parentNode)
        ex.parentNode.removeChild(ex);
}


/***/ },

/***/ 514
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.setLogEntriesSink = exports.addLogDebounced = exports.addLog = void 0;
const constants_1 = __webpack_require__(149);
// ==========日志管理==========
// 全局日志状态管理
let setLogEntriesCallback = null;
// 日志去重窗口：保留最近若干条日志文本，同文本重复出现即忽略
// （避免「每 3 秒一条」的间隔性重复刷屏，比只比对上一条更可靠）
const RECENT_LOG_COUNT = 5;
const recentLogMessages = [];
// 添加日志条目函数
/**
 * 添加一条日志条目，输出到设置面板的日志窗口（通过回调写入 React 状态）。
 * 内置重复内容过滤：最近 RECENT_LOG_COUNT（5）条内出现过相同文本则忽略，避免刷屏。
 * @param {string} message - 日志正文
 * @param {('info'|'warning'|'success'|'error')} [type='info'] - 日志类型，决定着色
 * @param {boolean} [logenabled=false] - 是否同时输出到浏览器控制台（console.log）
 * @returns {void}
 */
function addLog(message, type = 'info', logenabled = false) {
    const timestamp = new Date().toTimeString().slice(0, 8);
    // 检查是否为重复内容（最近 RECENT_LOG_COUNT 条内出现过相同文本即忽略）
    if (recentLogMessages.indexOf(message) !== -1) {
        // 如果内容相同，不输出本次内容
        console.log('[监控] 重复日志，已忽略:', message);
        return;
    }
    // 更新日志去重窗口（滚动保留最近 RECENT_LOG_COUNT 条）
    recentLogMessages.push(message);
    if (recentLogMessages.length > RECENT_LOG_COUNT) {
        recentLogMessages.shift();
    }
    const logItem = { timestamp, message, type };
    // 更新React状态
    if (setLogEntriesCallback) {
        setLogEntriesCallback((prevEntries) => {
            const newEntries = [logItem, ...prevEntries];
            if (newEntries.length > constants_1.CONFIG.MAX_LOG_ENTRIES) {
                newEntries.pop();
            }
            return newEntries;
        });
    }
    if (logenabled) {
        console.log(`[监控] ${timestamp} ${message}`);
    }
}
exports.addLog = addLog;
// 逐字输入类设置项的日志防抖：同一 key 的连续变化只在停顿后记一条「最终值」。
// 输入/粘贴一个地址若每键都记日志，一次输入就能把 20 条上限的日志面板刷满（只剩中间态）。
const _logDebounceTimers = {};
/**
 * 防抖写日志：同一 key 在 400ms 内的多次调用只保留最后一次。
 * @param {string} key - 防抖分组键（同一设置项用同一 key）
 * @param {string} message - 日志正文（取最后一次调用的值）
 * @param {('info'|'warning'|'success'|'error')} [type='info'] - 日志类型
 * @returns {void}
 */
function addLogDebounced(key, message, type = 'info') {
    clearTimeout(_logDebounceTimers[key]);
    _logDebounceTimers[key] = setTimeout(() => {
        delete _logDebounceTimers[key];
        addLog(message, type);
    }, 400);
}
exports.addLogDebounced = addLogDebounced;
/**
 * 注入/清除「日志写入」回调（主面板的 setLogEntries）。
 * 之所以用函数而不是直接导出变量：ES module 的 import 绑定是只读的，调用方无法赋值。
 * @param {Function|null} cb - 接收 setState 风格更新函数的回调；传 null 表示解除
 * @returns {void}
 */
function setLogEntriesSink(cb) {
    setLogEntriesCallback = cb;
}
exports.setLogEntriesSink = setLogEntriesSink;


/***/ },

/***/ 98
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.stopMonitoring = exports.startMonitoring = void 0;
const constants_1 = __webpack_require__(149);
const logger_1 = __webpack_require__(514);
const state_1 = __webpack_require__(989);
const speech_1 = __webpack_require__(988);
/**
 * 人数监控 / 掉线检测 / 工作时间判断（原 app.ts「监控部分」段）。
 * 模块化 P2：逐字迁移，仅加 export；新增 stopMonitoring() 供页面卸载时清理定时器。
 */
// ==========监控部分==========
// 工具函数：获取当前小时（支持小数）
/**
 * 获取当前时间的十进制小时（如 13:30 -> 13.5），供工作时间判断。
 * @returns {number} 当前十进制小时
 */
function getCurrentHour() {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
}
// 检查是否在工作时间内（读取用户可配置的时间段缓存）
/**
 * 判断当前是否处于用户配置的监控工作时间段内（读取缓存，无配置则视为工作时间内）。
 * @returns {boolean} 在工作时间内返回 true，否则 false
 */
function isWorkingHours() {
    const wh = state_1.runtime.workingHours;
    // 兜底：若未配置则视为工作时间内，避免完全停止监控
    if (!wh)
        return true;
    const currentHour = getCurrentHour();
    return ((currentHour >= wh.morningStart && currentHour <= wh.morningEnd) ||
        (currentHour >= wh.afternoonStart && currentHour <= wh.afternoonEnd));
}
// 缓存DOM元素引用（只缓存稳定元素）
const domCache = {
    ocurrentElement: null,
    // 注意：offlineElement 不缓存，每次重新查询
};
// 记录上一次的等待人数，用于检测状态变化
let lastWaitCount = null;
// 记录上一次的工作时间状态，用于检测「进入/离开工作时间」的变化（仅在翻转时记日志）
let lastWorkingState = null;
// 掉线语音已在播报标记：只在「掉线弹窗新出现」的上升沿播报一次，
// 弹窗停留期间每 3s 轮询不再重复（避免循环报警占满语音队列）；弹窗消失后复位可再次提醒。
let lastOfflineAnnounced = false;
// 修改主要检测函数
/**
 * 主检测函数：每次轮询执行。判断工作时间、读取等待人数（状态变化时记录/播报），
 * 并检测掉线弹窗（发现时记录并语音告警）。
 * @returns {void}
 */
function checkCount() {
    // 工作时间状态变化时记录日志（进入/离开），仅在翻转时输出，避免刷屏
    const inWork = isWorkingHours();
    if (inWork !== lastWorkingState) {
        lastWorkingState = inWork;
        (0, logger_1.addLog)(inWork ? '已进入工作时间，开始监控征纳互动' : '已离开工作时间，暂停监控', inWork ? 'success' : 'info');
    }
    if (!inWork)
        return;
    try {
        // 清理缓存中已失效的人数元素（isConnected 为假即已脱离文档）
        if (domCache.ocurrentElement && !domCache.ocurrentElement.isConnected) {
            domCache.ocurrentElement = null;
        }
        // 重新查找人数元素（相对稳定，可以缓存）
        if (!domCache.ocurrentElement) {
            domCache.ocurrentElement = document.querySelector('.count:nth-child(2)');
        }
        const ocurrentElement = domCache.ocurrentElement;
        if (!ocurrentElement) {
            (0, logger_1.addLog)('找不到人数元素', 'warning');
            return;
        }
        const currentCount = parseInt(ocurrentElement.textContent.trim(), 10);
        if (isNaN(currentCount)) {
            (0, logger_1.addLog)(`无法解析等待人数: "${ocurrentElement.textContent.trim()}"`, 'warning');
            return;
        }
        // 人数状态处理：仅在状态变化时记录日志，避免日志被重复内容填满
        if (currentCount === 0) {
            // 仅在从 >0 变为 0 时记录
            if (lastWaitCount !== 0) {
                (0, logger_1.addLog)('当前等待人数为0', 'success');
            }
        }
        else {
            (0, speech_1.speak)('征纳互动有人来了');
            (0, logger_1.addLog)(`当前等待人数: ${currentCount}`, 'info');
        }
        lastWaitCount = currentCount;
        // ========== 离线检测 ==========
        // 每次重新查询，不缓存（弹窗元素动态创建/销毁）
        // 掉线弹窗图标：两个选择器是「互补兜底」关系而非冗余——
        // :nth-child(2) 按父元素下所有子元素的序号匹配，:nth-of-type(2) 按同标签类型序号匹配；
        // 不同版本页面在图标前可能插入额外节点（导致两者命中不同元素），故保留双写法。
        const offlineEl = document.querySelector('.t-dialog__body__icon:nth-child(2)') ||
            document.querySelector('.t-dialog__body__icon:nth-of-type(2)');
        // 使用可选链安全读取文本
        const offlineText = offlineEl ? (offlineEl?.innerText ?? offlineEl?.textContent ?? '').trim() : '';
        if (offlineText.includes('掉线')) {
            (0, logger_1.addLog)(`掉线提示：${offlineText}`, 'error');
            if (!lastOfflineAnnounced) {
                lastOfflineAnnounced = true; // 仅弹窗新出现时播报一次，避免停留期间每 3s 循环报警
                (0, speech_1.speak)('征纳互动已掉线');
            }
        }
        else {
            // 掉线弹窗消失/尚未出现：复位标记，下次真正掉线仍会提醒
            lastOfflineAnnounced = false;
        }
    }
    catch (error) {
        (0, logger_1.addLog)(`检测错误: ${error.message}`, 'error', true);
    }
}
// 全局定时器引用，用于清理
let monitoringInterval = null;
// 页面加载完成后启动监控
/**
 * 启动监控：立即执行一次检测，并按 CHECK_INTERVAL 定时轮询 checkCount。
 * @returns {void}
 */
function startMonitoring() {
    // 立即执行一次检查
    checkCount();
    // 启动定时检查
    monitoringInterval = setInterval(checkCount, constants_1.CONFIG.CHECK_INTERVAL);
}
exports.startMonitoring = startMonitoring;
/**
 * 停止监控轮询（对应原 beforeunload 中的 monitoringInterval 清理）。
 * @returns {void}
 */
function stopMonitoring() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
}
exports.stopMonitoring = stopMonitoring;


/***/ },

/***/ 888
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.genQrDataUrl = void 0;
const logger_1 = __webpack_require__(514);
/**
 * 用客户端 qrcodejs 生成二维码 dataURL（原 app.ts 的 genQrDataUrl）。
 * 模块化 P4：逐字迁移，仅加 export。
 */
/**
 * 用客户端 qrcodejs 库把文本（即上传链接）即时生成为 PNG dataURL，无需服务器参与。
 * qrcodejs 暴露全局 QRCode：new QRCode(div,{text,width,height}) 同步把二维码绘入 div 内的 canvas；
 * 读取其内部 canvas.toDataURL('image/png') 即得图片 dataURL。
 * CAT_UI 的 React 渲染器白名单不放行 <img>/<canvas>，故此处只产出 dataURL 字符串，
 * 由调用方用 backgroundImage div 显示（与收到图片预览同一招）。
 * 库未就绪（QRCode 未定义）时回退为空串（此时仍可手动复制链接文本）。
 * @param {string} text - 待编码文本（上传链接）
 * @returns {Promise<string>} PNG dataURL，失败返回 ''
 */
function genQrDataUrl(text) {
    return new Promise((resolve) => {
        try {
            if (typeof QRCode === 'undefined' || typeof QRCode !== 'function') {
                (0, logger_1.addLog)('[二维码] qrcodejs 未加载，请手动复制链接', 'error', true);
                resolve('');
                return;
            }
            const holder = document.createElement('div');
            holder.style.position = 'absolute';
            holder.style.left = '-99999px';
            holder.style.top = '-99999px';
            document.body.appendChild(holder);
            new QRCode(holder, {
                text: text,
                width: 240,
                height: 240,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M,
            });
            // qrcodejs 同步把二维码绘入 canvas；延迟一拍确保绘制完成再读取
            setTimeout(() => {
                try {
                    const canvas = holder.querySelector('canvas');
                    const url = canvas ? canvas.toDataURL('image/png') : '';
                    if (holder.parentNode)
                        holder.parentNode.removeChild(holder);
                    if (url)
                        resolve(url);
                    else {
                        (0, logger_1.addLog)('[二维码] 画布读取失败，请手动复制链接', 'error', true);
                        resolve('');
                    }
                }
                catch (e) {
                    if (holder.parentNode)
                        holder.parentNode.removeChild(holder);
                    (0, logger_1.addLog)('[二维码] 读取失败: ' + e.message, 'error', true);
                    resolve('');
                }
            }, 0);
        }
        catch (e) {
            (0, logger_1.addLog)('[二维码] 生成异常: ' + e.message, 'error', true);
            resolve('');
        }
    });
}
exports.genQrDataUrl = genQrDataUrl;


/***/ },

/***/ 289
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.sendToPhone = exports.startPhoneReceive = exports.copyImageToClipboard = exports.getDeviceId = exports.imagePayloadBytes = exports.RELAY_MAX_BODY = void 0;
const logger_1 = __webpack_require__(514);
/**
 * 设备互联中继客户端（手机 → 电脑）与图片剪贴板工具。
 * 模块化 P4：逐字迁移，仅加 export（内部使用的不导出）。
 * 说明：长轮询而非 WebSocket 是为了绕过税务页 CSP 对 connect-src 的限制。
 */
// ========== 手机图片 → 电脑剪贴板 ==========
// 每台电脑/每个脚本安装实例一个稳定 deviceId（持久化，刷新不变），
// 拼出上传链接 <relayServer>/u/<deviceId>；手机打开该链接上传，电脑端长轮询取走。
const DEVICE_ID_KEY = 'znhd_device_id';
// 单请求体上限，须与 relay-server 的 MAX_BODY 保持一致（服务端按「整段 JSON 体积」掐断）。
// 发图前据此预检体积，避免 base64 膨胀后超过上限，被服务端拒绝时只见笼统的网络/服务器错误。
exports.RELAY_MAX_BODY = 12 * 1024 * 1024;
/**
 * 估算把该文件作为一条 POST body（含 name+mime+base64(data) 与 JSON 结构开销）的体积。
 * 仅用于「发送到手机」发前预检，与服务端 MAX_BODY 对齐（约 12MB）。
 * @param {File} file - 待发图片文件
 * @param {string} [name] - 文件名
 * @param {string} [mime] - MIME 类型
 * @returns {number} 估算的 body 字节数
 */
function imagePayloadBytes(file, name, mime) {
    const b64Len = Math.ceil(((file && file.size) || 0) / 3) * 4; // base64 膨胀 ≈ 4/3
    // name/mime 按 UTF-8 字节数计（服务端 readBody 按字节累加；String.length 是 UTF-16 码元，
    // 中文文件名会低估约 3 倍，接近上限时预检可能误放行）
    const enc = typeof TextEncoder === 'function' ? new TextEncoder() : null;
    const byteLen = enc
        ? enc.encode(String(name || '') + String(mime || '')).length
        : (String(name || '') + String(mime || '')).length;
    return b64Len + byteLen + 120;
}
exports.imagePayloadBytes = imagePayloadBytes;
/**
 * 取得本机稳定设备 ID：首次运行用 crypto.randomUUID() 生成并持久化（GM_setValue），
 * 之后刷新/重开都读同一值。用于区分不同电脑（A、B 各自不同链接）。
 * @returns {string} 设备 UUID 字符串
 */
function getDeviceId() {
    let id = '';
    try {
        id = typeof GM_getValue === 'function' ? GM_getValue(DEVICE_ID_KEY, '') || '' : '';
    }
    catch (e) {
        id = '';
    }
    if (!id) {
        try {
            id =
                window.crypto && crypto.randomUUID
                    ? crypto.randomUUID()
                    : 'd' + Date.now().toString(16) + Math.random().toString(16).slice(2);
        }
        catch (e) {
            id = 'd' + Date.now().toString(16) + Math.random().toString(16).slice(2);
        }
        try {
            if (typeof GM_setValue === 'function')
                GM_setValue(DEVICE_ID_KEY, id);
        }
        catch (e) {
            /* 忽略 */
        }
    }
    return id;
}
exports.getDeviceId = getDeviceId;
/**
 * 将 base64 字符串还原为 Blob（用于把中继返回的图片字节写剪贴板）。
 * @param {string} b64 - base64 文本
 * @param {string} mime - MIME 类型
 * @returns {Blob} 图片 Blob
 */
function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for (let i = 0; i < len; i++)
        arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'image/jpeg' });
}
/**
 * 将图片 Blob 转成 PNG Blob（best-effort）。
 * 原因：异步 Clipboard API（navigator.clipboard.write + ClipboardItem）在部分
 * Chromium 内核里只可靠支持 image/png；手机传来的图多为 image/jpeg，
 * 直接以 image/jpeg 写入可能失败。统一转 PNG 可规避该限制。
 * 若环境不支持位图解码 / Canvas，则返回原 blob。
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
function blobToPng(blob) {
    return new Promise((resolve) => {
        if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
            resolve(blob);
            return;
        }
        try {
            createImageBitmap(blob)
                .then((bmp) => {
                const cv = document.createElement('canvas');
                cv.width = bmp.width;
                cv.height = bmp.height;
                const ctx = cv.getContext('2d');
                if (!ctx) {
                    if (bmp.close)
                        bmp.close();
                    resolve(blob);
                    return;
                }
                ctx.drawImage(bmp, 0, 0);
                if (bmp.close)
                    bmp.close();
                cv.toBlob((b) => {
                    resolve(b || blob);
                }, 'image/png');
            })
                .catch(() => resolve(blob));
        }
        catch (e) {
            resolve(blob);
        }
    });
}
/**
 * 尝试把图片写入剪贴板：优先「页面主世界(unsafeWindow)」的 navigator.clipboard.write，
 * 失败再退回「隔离世界」的同名 API。两者都不行则返回 false。
 * 页面主世界路径是文档确认的、唯一能把图片真正写进系统剪贴板的可靠方式
 * （ScriptCat 隔离世界里 ClipboardItem 常缺失，且 ScriptCat 的 GM_setClipboard 仅支持文本，
 *  传 Blob 会静默无效——故图片复制不再依赖 GM_setClipboard）。
 * @param {Blob} data
 * @param {string} type
 * @returns {Promise<boolean>}
 */
function attemptWriteImage(data, type) {
    const doWrite = (nav, CI) => new Promise((r) => {
        try {
            if (nav && nav.clipboard && nav.clipboard.write && typeof CI !== 'undefined') {
                nav.clipboard
                    .write([new CI({ [type]: data })])
                    .then(() => r(true))
                    .catch(() => r(false));
                return;
            }
        }
        catch (e) {
            /* 忽略，走降级 */
        }
        r(false);
    });
    const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    return doWrite(w && w.navigator, w && w.ClipboardItem).then((ok) => {
        if (ok)
            return true;
        return doWrite(navigator, ClipboardItem);
    });
}
/**
 * 将图片 Blob 写入系统剪贴板（由一次「用户点击」触发，以保留浏览器要求的用户手势）。
 * 流程：
 *   1) 先用「原始 blob」直接写（此时点击手势最新鲜、无任何异步转换，成功率最高）；
 *   2) 若失败（多半因内核仅支持 image/png 而原图为 jpeg），再统一转 PNG 后重试；
 *   3) 写入一律走页面主世界的 navigator.clipboard.write（见 attemptWriteImage），
 *      不再依赖 GM_setClipboard（ScriptCat 该 API 仅支持文本，传 Blob 会静默无效导致"假成功"）。
 * @param {Blob} blob - 图片 Blob
 * @returns {Promise<boolean>} 成功返回 true，失败返回 false
 */
function copyImageToClipboard(blob) {
    return new Promise((resolve) => {
        if (!blob) {
            (0, logger_1.addLog)('[复制] 图片数据为空', 'error', true);
            resolve(false);
            return;
        }
        const type0 = blob.type ? blob.type : 'image/png';
        // 1) 原始 blob 直接写（手势最新鲜）
        attemptWriteImage(blob, type0).then((ok) => {
            if (ok) {
                (0, logger_1.addLog)('[复制] 图片已复制到剪贴板', 'success', true);
                resolve(true);
                return;
            }
            // 2) 转 PNG 后重试（规避内核仅支持 image/png 的限制）
            blobToPng(blob)
                .then((png) => {
                const data = png || blob;
                const type = data.type ? data.type : 'image/png';
                attemptWriteImage(data, type).then((ok2) => {
                    if (ok2) {
                        (0, logger_1.addLog)('[复制] 图片已复制到剪贴板 (转PNG)', 'success', true);
                        resolve(true);
                    }
                    else {
                        (0, logger_1.addLog)('[复制] 所有复制方式均失败，请长按图片手动保存', 'error', true);
                        resolve(false);
                    }
                });
            })
                .catch(() => {
                (0, logger_1.addLog)('[复制] PNG 转换失败', 'error', true);
                resolve(false);
            });
        });
    });
}
exports.copyImageToClipboard = copyImageToClipboard;
/**
 * 启动「设备互联」长轮询接收循环（直到 stop() 调用）。
 * 通过 GM_xmlhttpRequest 轮询中继服务器 /recv/<uuid>（绕过税务页面 CSP 对 connect-src 的限制）。
 * 收到图片时回调 onImage；状态变化回调 onStatus；网络异常自动重连。
 * @param {object} opt - { server, uuid, onStatus, onImage }
 * @returns {Function} stop() 停止接收
 */
function startPhoneReceive(opt) {
    const server = (opt.server || '').trim().replace(/\/+$/, '');
    const uuid = opt.uuid;
    let stopped = false;
    let lastXhr = null;
    let connected = false;
    let loggedConnFail = false;
    let firstPoll = true;
    function markConnected() {
        if (connected)
            return;
        connected = true;
        loggedConnFail = false; // 恢复连接后复位失败标记，后续再次断线仍会记日志（旧实现不复位，之后断连静默）
        if (opt.onConnected) {
            try {
                opt.onConnected();
            }
            catch (e) {
                /* 忽略 */
            }
        }
    }
    // 说明：不单独探测 /health。旧版中继可能没有该端点，会导致请求挂起并误报
    // 「连接服务器超时」，而真正的 /recv 接收始终正常（与用户报告的现象一致）。
    // 改用「首次 /recv 轮询用极短 maxwait」来快速确认已连上：服务器会很快返回空响应，
    // 从而 markConnected → onConnected 触发「已自动开始接收」日志（约 1 秒内）。
    function poll() {
        if (stopped)
            return;
        if (opt.onStatus)
            opt.onStatus('正在等待手机上传…');
        // 首次轮询用极短 maxwait 仅用于快速确认「已连上服务器」（服务器会很快返回空），
        // 让「已自动开始接收」日志尽快出现；后续轮询用长 maxwait 实时等待图片。
        const maxwait = firstPoll ? 1000 : 25000;
        firstPoll = false;
        const url = server + '/recv/' + encodeURIComponent(uuid) + '?maxwait=' + maxwait;
        try {
            lastXhr = GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                timeout: maxwait + 5000,
                onload: function (resp) {
                    if (stopped)
                        return;
                    markConnected(); // 首次成功收到服务器响应即视为已连上
                    try {
                        let data = null;
                        try {
                            data = JSON.parse(resp.responseText);
                        }
                        catch (e) {
                            data = null;
                        }
                        if (data && data.empty) {
                            poll();
                            return;
                        }
                        if (data && data.type === 'image' && data.data) {
                            const blob = base64ToBlob(data.data, data.mime || 'image/jpeg');
                            // 预览统一用 objectURL（与「发送到手机」待发列表一致）：
                            // ① 画廊上限淘汰/单张移除/清空全部时的 URL.revokeObjectURL 真正生效
                            //   （data:URL 字符串无法 revoke，旧写法实为无效空操作）；
                            // ② 避免最多 27 张图的 base64 dataURL 长字符串常驻 JS 堆（可达几十 MB）。
                            const previewUrl = URL.createObjectURL(blob);
                            if (opt.onStatus)
                                opt.onStatus('收到图片：' + (data.name || 'image'));
                            if (opt.onImage)
                                opt.onImage({ blob: blob, previewUrl: previewUrl, name: data.name, mime: data.mime });
                            poll(); // 继续接收下一张
                            return;
                        }
                        if (data && data.type === 'text' && typeof data.text === 'string') {
                            if (opt.onStatus)
                                opt.onStatus('收到文本');
                            if (opt.onText)
                                opt.onText({ text: data.text, ts: data.ts });
                            poll(); // 继续接收下一条
                            return;
                        }
                        setTimeout(poll, 1000); // 解析失败稍后重试
                    }
                    catch (e) {
                        // 单条数据异常（base64 损坏 atob 抛错、回调抛错等）不得杀死接收循环：
                        // 记录一次后继续下一次轮询（旧实现无兜底，异常会让 poll 链永久中断、收图静默失效）
                        (0, logger_1.addLog)('[设备互联] 处理收到数据失败: ' + (e && e.message ? e.message : e), 'error', true);
                        setTimeout(poll, 1000);
                    }
                },
                onerror: function () {
                    if (stopped)
                        return;
                    if (!loggedConnFail) {
                        loggedConnFail = true;
                        (0, logger_1.addLog)('[设备互联] 连接服务器失败，请检查中继地址/网络（' + server + '）', 'error');
                    }
                    if (opt.onStatus)
                        opt.onStatus('连接中断，正在重连…');
                    setTimeout(poll, 2000);
                },
                ontimeout: function () {
                    if (stopped)
                        return;
                    poll(); // 超时继续轮询
                },
            });
        }
        catch (e) {
            if (stopped)
                return;
            if (opt.onStatus)
                opt.onStatus('请求异常，正在重连…');
            setTimeout(poll, 2000);
        }
    }
    poll();
    return function stop() {
        stopped = true;
        try {
            if (lastXhr && typeof lastXhr.abort === 'function')
                lastXhr.abort();
        }
        catch (e) {
            /* 忽略 */
        }
    };
}
exports.startPhoneReceive = startPhoneReceive;
/**
 * 电脑端 → 手机端 发送（图片或文本）。POST 到中继 /phone/send/<deviceId>。
 * 仅负责投递；手机是否在线由调用方先查 /phone/status 决定（离线时调用方直接拦截）。
 * @param {object} opt - { server, uuid, payload, onOk, onFail }
 *   payload: { text } 或 { name, mime, data(base64) }
 */
function sendToPhone(opt) {
    const server = (opt.server || '').trim().replace(/\/+$/, '');
    const uuid = opt.uuid;
    const url = server + '/phone/send/' + encodeURIComponent(uuid);
    try {
        const body = JSON.stringify(opt.payload);
        GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: { 'Content-Type': 'application/json' },
            data: body,
            // 超时随载荷缩放：放行的最大单请求约 16MB（base64 膨胀后），固定 20s 在慢上行时会把合法大图误杀
            timeout: 20000 + Math.round(body.length / 200),
            onload: function (resp) {
                let j = null;
                try {
                    j = JSON.parse(resp.responseText);
                }
                catch (e) {
                    j = null;
                }
                if (j && j.ok) {
                    if (opt.onOk)
                        opt.onOk();
                }
                else {
                    // 优先用服务端 JSON 里的中文错误（如 413「内容过大」）；否则按状态码给可读提示，避免笼统报错。
                    let msg = j && j.error ? String(j.error) : '';
                    if (!msg && resp.status === 413)
                        msg = '内容过大，请压缩后再发送';
                    else if (!msg && resp.status >= 400)
                        msg = '服务器错误（HTTP ' + resp.status + '）';
                    if (opt.onFail)
                        opt.onFail(msg || 'HTTP ' + resp.status);
                }
            },
            onerror: function () {
                if (opt.onFail)
                    opt.onFail('网络错误，请检查中继地址');
            },
            ontimeout: function () {
                if (opt.onFail)
                    opt.onFail('发送超时');
            },
        });
    }
    catch (e) {
        if (opt.onFail)
            opt.onFail(e.message);
    }
}
exports.sendToPhone = sendToPhone;


/***/ },

/***/ 988
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.clearSpeechTimer = exports.speak = exports.clearSpeechQueue = void 0;
const constants_1 = __webpack_require__(149);
const logger_1 = __webpack_require__(514);
const state_1 = __webpack_require__(989);
const speechQueue = [];
let isSpeaking = false;
let speechTimer = null;
/**
 * 清空语音队列并中止当前播报，重置播放状态与超时定时器。
 * 主要用于语音开关关闭时，避免旧消息堆积、再次开启时集中涌出。
 * @returns {void}
 */
function clearSpeechQueue() {
    speechQueue.length = 0;
    isSpeaking = false;
    if (speechTimer) {
        clearTimeout(speechTimer);
        speechTimer = null;
    }
    if ('speechSynthesis' in window) {
        try {
            window.speechSynthesis.cancel();
        }
        catch (e) {
            /* 忽略中止异常 */
        }
    }
}
exports.clearSpeechQueue = clearSpeechQueue;
/**
 * 移除队列中已过期的语音消息（入队时间距今超过 CONFIG.SPEECH_QUEUE_TTL）。
 * @returns {number} 被移除的过期消息条数
 */
function pruneExpiredSpeechItems() {
    if (speechQueue.length === 0)
        return 0;
    const now = Date.now();
    const before = speechQueue.length;
    for (let i = speechQueue.length - 1; i >= 0; i--) {
        if (now - speechQueue[i].enqueuedAt > constants_1.CONFIG.SPEECH_QUEUE_TTL) {
            speechQueue.splice(i, 1);
        }
    }
    return before - speechQueue.length;
}
/**
 * 语音播报：将文本加入语音队列并触发播放（受语音开关与浏览器能力限制）。
 * 入队时执行长度上限与过期清理：队列超过 CONFIG.MAX_SPEECH_QUEUE 时丢弃最早（最旧）消息，
 * 超过 CONFIG.SPEECH_QUEUE_TTL 的过期消息也会被剔除，避免播报过时内容。
 * @param {string} text - 要播报的文本
 * @returns {void}
 */
function speak(text) {
    // 直接读取缓存的语音状态，避免每次读取 localStorage
    if (!state_1.runtime.voiceEnabled || !('speechSynthesis' in window)) {
        return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.0;
    // 添加到队列，记录入队时间用于过期判断
    speechQueue.push({ utterance, enqueuedAt: Date.now() });
    // 长度上限：超过则丢弃最早（最旧）的消息，保留最新内容
    while (speechQueue.length > constants_1.CONFIG.MAX_SPEECH_QUEUE) {
        speechQueue.shift();
        (0, logger_1.addLog)('语音队列已满，丢弃最早的一条旧消息', 'warning', true);
    }
    // 过期清理：剔除超过有效期的陈旧消息
    const expired = pruneExpiredSpeechItems();
    if (expired > 0) {
        (0, logger_1.addLog)(`语音队列已清理 ${expired} 条过期消息`, 'warning', true);
    }
    processSpeechQueue();
}
exports.speak = speak;
// 处理语音队列
/**
 * 从语音队列中取出一条依次播放，带超时保护（防止 onend/onerror 不触发导致队列卡死）；
 * 播放前先剔除过期消息，避免播报过时内容。
 * @returns {void}
 */
function processSpeechQueue() {
    if (isSpeaking) {
        return;
    }
    // 先清理过期消息，避免播报过时内容
    pruneExpiredSpeechItems();
    if (speechQueue.length === 0) {
        return;
    }
    isSpeaking = true;
    const item = speechQueue.shift();
    const utterance = item.utterance;
    // 清理上一次的超时定时器
    if (speechTimer) {
        clearTimeout(speechTimer);
    }
    // 超时保护：防止 onend/onerror 不触发导致队列卡死（Chrome 已知 bug）
    speechTimer = setTimeout(() => {
        (0, logger_1.addLog)('语音播报超时，强制继续队列', 'warning', true);
        isSpeaking = false;
        speechTimer = null;
        processSpeechQueue();
    }, constants_1.CONFIG.SPEECH_TIMEOUT);
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
        // 如果是not-allowed错误，清空队列避免堆积
        if (event.error === 'not-allowed') {
            speechQueue.length = 0;
        }
        else {
            processSpeechQueue();
        }
    };
    // 在播放前确保语音合成已恢复（某些浏览器会暂停）
    if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
    }
    window.speechSynthesis.speak(utterance);
}
/**
 * 仅清理语音超时定时器（不清队列、不取消合成）。
 * 对应原 beforeunload 中的 speechTimer 清理，页面卸载时调用。
 * @returns {void}
 */
function clearSpeechTimer() {
    if (speechTimer) {
        clearTimeout(speechTimer);
        speechTimer = null;
    }
}
exports.clearSpeechTimer = clearSpeechTimer;


/***/ },

/***/ 989
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.runtime = void 0;
const storage_1 = __webpack_require__(113);
/**
 * 运行时状态缓存（原 app.ts「状态缓存」段）。
 * 顶层一次性读取初始配置，避免重复解析 localStorage；设置变更时由主面板写回这些字段。
 * 之所以用对象而非多个导出变量：ES module 的 import 绑定只读，调用方无法赋值。
 */
const _initAllvalue = (0, storage_1.loadAllvalue)();
exports.runtime = {
    /** 一次性读取的初始配置（主面板 useState 惰性初始化用，避免每次渲染重读 localStorage） */
    init: _initAllvalue,
    /** 缓存语音启用状态，避免每次播报都读取 localStorage */
    voiceEnabled: _initAllvalue.voiceEnabled,
    /** 缓存监控时间段，避免每次轮询都读取 localStorage */
    workingHours: _initAllvalue.workingHours,
    /** 缓存常用语数据源地址，避免每次请求都读取 localStorage */
    commonPhrasesUrl: _initAllvalue.commonPhrasesUrl,
    /** 缓存「是否使用 CDN 加速」开关，供 resolveGithubUrl() 在调用时读取 */
    useCdn: !!_initAllvalue.useCdn,
};


/***/ },

/***/ 113
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.saveAllvalue = exports.flushSaveAllvalue = exports.loadAllvalue = exports.savePhrasesCache = exports.loadPhrasesCache = exports.savePanelPoint = exports.loadPanelPoint = void 0;
const logger_1 = __webpack_require__(514);
const constants_1 = __webpack_require__(149);
/**
 * 本地存储读写：面板位置 / 常用语缓存 / 全部用户配置（原 app.ts「存储管理」段）。
 * 模块化 P1：逐字迁移，仅加 export。注意 saveAllvalue 是 300ms 尾防抖，
 * 返回时尚未落盘——需要写完立刻读时先调 flushSaveAllvalue()。
 */
// 读取面板保存的位置（无记录返回 null，由调用方兜底默认坐标）
/**
 * 从 localStorage 读取上次保存的面板位置。
 * @returns {({x:number,y:number}|null)} 命中且坐标合法时返回 {x,y}，否则返回 null（由调用方兜底默认坐标）
 */
function loadPanelPoint() {
    try {
        const saved = localStorage.getItem(constants_1.PANEL_POINT_KEY);
        if (saved) {
            const p = JSON.parse(saved);
            if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
                // isFinite 同时排除 NaN/±Infinity（typeof NaN==='number' 会漏）
                return p;
            }
        }
    }
    catch (error) {
        (0, logger_1.addLog)('读取面板位置失败: ' + error.message, 'error', true);
    }
    return null;
}
exports.loadPanelPoint = loadPanelPoint;
// 保存面板位置（带防抖，避免拖拽过程中高频写 localStorage）
let _savePointTimer = null;
/**
 * 保存面板位置到 localStorage（带 requestAnimationFrame 防抖，避免拖拽中高频写入）。
 * @param {{x:number,y:number}} point - 面板视口坐标
 * @returns {void}
 */
function savePanelPoint(point) {
    if (!point || typeof point.x !== 'number' || typeof point.y !== 'number')
        return;
    if (_savePointTimer)
        return; // 已计划在下一帧保存，跳过重复
    _savePointTimer = requestAnimationFrame(() => {
        _savePointTimer = null;
        try {
            localStorage.setItem(constants_1.PANEL_POINT_KEY, JSON.stringify({
                x: Math.round(point.x),
                y: Math.round(point.y),
            }));
        }
        catch (error) {
            (0, logger_1.addLog)('保存面板位置失败: ' + error.message, 'error', true);
        }
    });
}
exports.savePanelPoint = savePanelPoint;
// 读取常用语本地缓存（2 小时有效期内且 URL 一致则命中）
/**
 * 从 localStorage 读取常用语本地缓存（含加载时间戳、数据源 URL 与数据本体）。
 * @returns {({time:number,url:string,data:object}|null)} 命中且结构合法时返回缓存对象，否则返回 null
 */
function loadPhrasesCache() {
    try {
        const saved = localStorage.getItem(constants_1.PHRASES_CACHE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed.time === 'number' && typeof parsed.url === 'string' && parsed.data) {
                return parsed;
            }
        }
    }
    catch (error) {
        (0, logger_1.addLog)('读取常用语缓存失败: ' + error.message, 'error', true);
    }
    return null;
}
exports.loadPhrasesCache = loadPhrasesCache;
// 保存常用语本地缓存（记录加载时间戳、数据源 URL 与数据本体）
/**
 * 将常用语数据连同加载时间戳与数据源 URL 写入 localStorage 缓存。
 * @param {string} url - 数据源地址（用于后续判断缓存是否仍有效）
 * @param {object} data - 解析后的常用语数据（键值对）
 * @returns {void}
 */
function savePhrasesCache(url, data) {
    try {
        localStorage.setItem(constants_1.PHRASES_CACHE_KEY, JSON.stringify({
            time: Date.now(),
            url: url,
            data: data,
        }));
    }
    catch (error) {
        (0, logger_1.addLog)('保存常用语缓存失败: ' + error.message, 'error', true);
    }
}
exports.savePhrasesCache = savePhrasesCache;
// 从localStorage加载Allvalue数据
/**
 * 从 localStorage 加载全部用户配置，并与 DEFAULTS 合并（已存储值覆盖默认值）。
 * 解析失败时回退到 DEFAULTS，保证调用方始终拿到完整配置对象。
 * @returns {object} 合并后的配置对象（含 voiceEnabled / workingHours / commonPhrasesUrl 等）
 */
function loadAllvalue() {
    try {
        const saved = localStorage.getItem(constants_1.STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            const merged = { ...constants_1.DEFAULTS, ...parsed };
            // 对嵌套 workingHours 做字段级合并 + 数值校验：残缺/损坏的存量 workingHours
            // （如只存了 morningStart）不得整体顶掉 DEFAULTS 其余字段——否则缺字段变 undefined，
            // isWorkingHours 恒判「非工作时间」导致监控静默停摆（v26.9.6-v7 起因）。
            const wh = parsed && typeof parsed.workingHours === 'object' && parsed.workingHours;
            if (wh) {
                const defWh = constants_1.DEFAULTS.workingHours;
                merged.workingHours = {
                    morningStart: Number.isFinite(wh.morningStart) ? wh.morningStart : defWh.morningStart,
                    morningEnd: Number.isFinite(wh.morningEnd) ? wh.morningEnd : defWh.morningEnd,
                    afternoonStart: Number.isFinite(wh.afternoonStart) ? wh.afternoonStart : defWh.afternoonStart,
                    afternoonEnd: Number.isFinite(wh.afternoonEnd) ? wh.afternoonEnd : defWh.afternoonEnd,
                };
            }
            return merged;
        }
    }
    catch (error) {
        (0, logger_1.addLog)('加载存储数据失败: ' + error.message, 'error', true);
    }
    // 返回默认值
    return { ...constants_1.DEFAULTS };
}
exports.loadAllvalue = loadAllvalue;
// 保存Allvalue数据到localStorage（300ms 尾防抖）
// 设置项是逐字提交的（见 SettingsDrawer 的 onChange）：每键都落盘即每次按键一次同步
// JSON.stringify + localStorage.setItem，并顺带刷一条日志（面板位置保存早已用 rAF 防抖）。
// 这里只把「持久化」推迟到停顿后——状态仍逐字更新，最终写入的必然是最新值；
// 关页由 beforeunload 调 flushSaveAllvalue() 兜底，不会丢最后一笔。
let _saveAllvalueTimer = null;
let _saveAllvaluePending = null;
/**
 * 立即落盘待保存的配置并取消未到期的防抖定时器。幂等：无待写值时直接返回。
 * @returns {void}
 */
function flushSaveAllvalue() {
    if (_saveAllvalueTimer) {
        clearTimeout(_saveAllvalueTimer);
        _saveAllvalueTimer = null;
    }
    if (_saveAllvaluePending === null)
        return;
    const data = _saveAllvaluePending;
    _saveAllvaluePending = null;
    try {
        localStorage.setItem(constants_1.STORAGE_KEY, JSON.stringify(data));
        (0, logger_1.addLog)('数据已保存到localStorage', 'success', true);
    }
    catch (error) {
        (0, logger_1.addLog)('保存数据失败: ' + error.message, 'error', true);
        CAT_UI.Message.error('保存设置失败: ' + error.message);
    }
}
exports.flushSaveAllvalue = flushSaveAllvalue;
/**
 * 将全部用户配置写入 localStorage（300ms 尾防抖，语义见上方注释）。
 * 注意：返回时尚未落盘，需要立刻读到最新值时先调 flushSaveAllvalue()。
 * @param {object} data - 待保存的配置对象
 * @returns {void}
 */
function saveAllvalue(data) {
    _saveAllvaluePending = data;
    if (!_saveAllvalueTimer)
        _saveAllvalueTimer = setTimeout(flushSaveAllvalue, 300);
}
exports.saveAllvalue = saveAllvalue;


/***/ },

/***/ 717
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.appendToTinyMCE = void 0;
const logger_1 = __webpack_require__(514);
const utils_1 = __webpack_require__(973);
/**
 * TinyMCE 编辑器写入（原 app.ts 中的 appendToTinyMCE）。
 * 模块化 P3：逐字迁移，仅加 export。
 */
/**
 * 向页面中第一个 TinyMCE 编辑器追加文本并立即生效。
 * 优先使用 TinyMCE API，失败时降级为直接操作 iframe DOM 并派发 input 事件；
 * 输入框非空时在内容前补 <br> 实现换行。
 * @param {string} [text2append=''] - 要追加的文本（默认空串，避免掩盖漏传参数的 bug）
 * @returns {string} 成功返回追加后的编辑器完整纯文本；找不到编辑器/iframe 等失败场景返回空字符串
 */
function appendToTinyMCE(text2append = '') {
    /* 1. 拿到编辑器实例（动态匹配，不依赖 id） */
    const editors = window.tinymce?.editors ?? []; // 所有 TinyMCE 实例
    const ed = editors.find((e) => e.inline === false); // 先拿第一个非 inline 的
    // 如果上面没拿到，再随便拿一个
    const editor = ed || editors[0];
    // 检查输入框是否为空
    let isInputEmpty = true;
    if (editor) {
        const body = editor.getBody();
        isInputEmpty = !body.textContent.trim();
    }
    else {
        const iframe = document.querySelector('.input-box iframe.tox-edit-area__iframe') ||
            document.querySelector('iframe.tox-edit-area__iframe') ||
            document.querySelector('iframe[class*="tox"]');
        if (iframe) {
            try {
                const body = iframe.contentDocument.querySelector('body#tinymce') || iframe.contentDocument.body;
                isInputEmpty = !body.textContent.trim();
            }
            catch (e) {
                (0, logger_1.addLog)('无法访问iframe内容: ' + e.message, 'warning', true);
            }
        }
    }
    /* 2. 使用<br>换行处理 */
    // 转义文本并将换行符替换为<br>
    const escapedText = (0, utils_1.escapeHtml)(text2append);
    let processedContent = escapedText.replace(/\n/g, '<br>');
    // 如果输入框不为空，在内容前添加<br>实现换行
    if (!isInputEmpty) {
        processedContent = '<br>' + processedContent;
    }
    /* 3. 真正干活 */
    if (editor) {
        const body = editor.getBody(); // 等同于 iframe.body
        if (isInputEmpty) {
            // 输入框为空时直接设置内容（不加额外换行）
            editor.setContent(processedContent);
        }
        else {
            // 输入框不为空时使用处理后的内容
            editor.execCommand('mceInsertContent', false, processedContent);
        }
        editor.save(); // 同步回 textarea
        editor.setDirty(true); // 标记脏
        editor.selection.select(body, true); // 把光标放末尾
        editor.selection.collapse(false);
    }
    else {
        /* 4. 兜底：直接改 DOM + 触发事件 */
        const iframe = document.querySelector('iframe.tox-edit-area__iframe') || document.querySelector('iframe[class*="tox"]');
        if (!iframe) {
            (0, logger_1.addLog)('找不到 TinyMCE iframe', 'error', true);
            return '';
        }
        try {
            const body = iframe.contentDocument.body;
            if (!body) {
                (0, logger_1.addLog)('找不到 body', 'error', true);
                return '';
            }
            if (isInputEmpty) {
                body.innerHTML = processedContent;
            }
            else {
                body.insertAdjacentHTML('beforeend', processedContent);
            }
            // 触发单个 input 事件即可
            body.dispatchEvent(new Event('input', { bubbles: true }));
        }
        catch (e) {
            (0, logger_1.addLog)('无法访问 iframe 内容: ' + e.message, 'error', true);
            return '';
        }
    }
    // 兜底路径：body#tinymce 位于 iframe 内部，主 document 查询永远为 null，
    // 须先定位 iframe 再读其 contentDocument 的 body 文本（与上面 DOM 兜底写入的是同一个 body）
    const fallbackIframe = document.querySelector('iframe.tox-edit-area__iframe') || document.querySelector('iframe[class*="tox"]');
    const finalText = editor
        ? editor.getContent({ format: 'text' })
        : fallbackIframe?.contentDocument?.body?.textContent ?? '';
    (0, logger_1.addLog)('已追加文本并同步: ' + finalText, 'success', true);
    return finalText;
}
exports.appendToTinyMCE = appendToTinyMCE;


/***/ },

/***/ 703
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

/**
 * 常用语抽屉（原 app.ts 的 CommonPhrasesDrawer）。
 * 模块化 P5：逐字迁移，仅加 export。
 */
__webpack_unused_export__ = ({ value: true });
exports.CommonPhrasesDrawer = void 0;
const constants_1 = __webpack_require__(149);
const logger_1 = __webpack_require__(514);
const utils_1 = __webpack_require__(973);
const tinymce_1 = __webpack_require__(717);
const clipboard_1 = __webpack_require__(170);
function CommonPhrasesDrawer({ visible, setVisible, phrasesData, setPhrasesData, phrasesLoading, setPhrasesLoading, searchKeyword, setSearchKeyword, loadPhrasesData, commonPhrasesUrl, }) {
    return CAT_UI.Drawer(CAT_UI.createElement('div', { style: { textAlign: 'left' } }, [
        // 显示当前数据源
        CAT_UI.createElement('div', {
            style: {
                marginBottom: '16px',
                color: '#666',
                fontSize: '12px',
                wordBreak: 'break-all',
            },
        }, `数据源: ${(0, utils_1.safeDecodeURIComponent)((0, utils_1.resolveGithubUrl)(commonPhrasesUrl || constants_1.DEFAULTS.commonPhrasesUrl))}`),
        // 重新加载按钮
        CAT_UI.Button('重新加载常用语', {
            type: 'primary',
            loading: phrasesLoading,
            onClick: () => loadPhrasesData(true),
            style: { marginBottom: '16px', width: '100%' },
        }),
        // 搜索框（onChange 与兄弟输入框同款解包：兼容 CAT_UI 回传字符串或事件对象两种形态）
        CAT_UI.Input({
            placeholder: '搜索常用语(按键名称或内容)',
            value: searchKeyword,
            onChange: (val) => {
                setSearchKeyword(typeof val === 'string' ? val : val && val.target ? val.target.value : '');
            },
            allowClear: true,
            style: { marginBottom: '16px', width: '100%' },
        }),
        // 动态生成常用语按钮
        phrasesLoading
            ? CAT_UI.createElement('div', { style: { textAlign: 'center', padding: '20px' } }, '加载中...')
            : Object.keys(phrasesData).length === 0
                ? CAT_UI.createElement('div', { style: { textAlign: 'center', padding: '20px', color: '#999' } }, '暂无常用语数据，请点击上方按钮加载')
                : (() => {
                    // 根据搜索关键字过滤常用语
                    const keyword = searchKeyword.trim().toLowerCase();
                    const filteredEntries = keyword
                        ? Object.entries(phrasesData).filter(([key, value]) => String(key).toLowerCase().includes(keyword) ||
                            String(value).toLowerCase().includes(keyword))
                        : Object.entries(phrasesData);
                    return filteredEntries.length === 0
                        ? CAT_UI.createElement('div', { style: { textAlign: 'center', padding: '20px', color: '#999' } }, '没有匹配的常用语')
                        : CAT_UI.Space(filteredEntries.map(([key, value]) => CAT_UI.Button(key, {
                            key: key,
                            type: 'default',
                            onClick() {
                                (0, clipboard_1.safeCopyText)(value);
                                setVisible(false);
                                (0, tinymce_1.appendToTinyMCE)(value);
                                (0, logger_1.addLog)(`添加文本: ${value}`, 'success');
                                CAT_UI.Message.success('添加文本: ' + value);
                            },
                            style: { marginBottom: '8px', width: '100%' },
                        })), { direction: 'vertical', style: { width: '100%' } });
                })(),
        CAT_UI.Divider(''),
    ]), {
        title: '常用语',
        visible,
        width: 400,
        focusLock: true,
        autoFocus: false,
        zIndex: 10001,
        onOk: () => {
            setVisible(false);
        },
        onCancel: () => {
            setVisible(false);
        },
    });
}
exports.CommonPhrasesDrawer = CommonPhrasesDrawer;


/***/ },

/***/ 295
(__unused_webpack_module, exports) {

var __webpack_unused_export__;

/**
 * 日志面板组件（原 app.ts「UI部分」内的 LogPanel）。
 * 模块化 P5：逐字迁移，仅加 export。
 */
__webpack_unused_export__ = ({ value: true });
exports.LogPanel = void 0;
function LogPanel({ logEntries }) {
    // 根据日志类型定义颜色
    const colorMap = {
        info: '#1890ff',
        warning: '#faad14',
        success: '#52c41a',
        error: '#ff4d4f', // 红色
    };
    return CAT_UI.createElement('div', {
        style: {
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '500px',
            overflowY: 'auto',
            backgroundColor: '#f5f5f5',
            padding: '10px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '12px',
        },
    }, logEntries.map((entry, index) => {
        const color = colorMap[entry.type] || '#333333';
        return CAT_UI.createElement('div', {
            key: index,
            style: {
                color: color,
                marginBottom: '4px',
                borderLeft: `3px solid ${color}`,
                paddingLeft: '8px',
                fontWeight: 'bold',
            },
        }, `${entry.timestamp} - ${entry.message}`);
    }));
}
exports.LogPanel = LogPanel;


/***/ },

/***/ 570
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

/**
 * 主面板组件（原 app.ts 的 MainPanel）：语音开关、设置/常用语/历史文件/设备互联入口与各抽屉装配。
 * 模块化 P5：逐字迁移，仅加 export；phrasesRequestSeq 随 loadPhrasesData 一并搬来。
 */
__webpack_unused_export__ = ({ value: true });
exports.MainPanel = void 0;
const constants_1 = __webpack_require__(149);
const logger_1 = __webpack_require__(514);
const storage_1 = __webpack_require__(113);
const state_1 = __webpack_require__(989);
const utils_1 = __webpack_require__(973);
const relay_1 = __webpack_require__(289);
const gallery_1 = __webpack_require__(406);
const speech_1 = __webpack_require__(988);
const SettingsDrawer_1 = __webpack_require__(919);
const CommonPhrasesDrawer_1 = __webpack_require__(703);
const PhoneImageDrawer_1 = __webpack_require__(63);
// 常用语请求序号（loadPhrasesData 用）：仅最新一次请求可落地结果，防慢的旧响应后到覆盖新数据
let phrasesRequestSeq = 0;
function MainPanel() {
    // 使用加载的数据初始化Allvalue
    // 惰性初始化：useState(loadAllvalue()) 的实参每次渲染都会求值，而本组件因 logEntries
    // 每 3 秒+ 就重渲染一次，等于反复白读 localStorage + JSON.parse。顶层 runtime.init
    // 已是启动时读好的同一份数据（本会话内设置改动都会同步写回它）。
    const [Allvalue, setAllvalue] = CAT_UI.useState(() => state_1.runtime.init);
    // 包装setAllvalue函数，实现自动保存
    const updateAllvalue = (newValue) => {
        setAllvalue(newValue);
        // 自动保存到localStorage
        (0, storage_1.saveAllvalue)(newValue);
        // 同步更新语音状态缓存
        state_1.runtime.voiceEnabled = newValue.voiceEnabled;
        // 同步更新监控时间段缓存
        state_1.runtime.workingHours = newValue.workingHours;
        // 同步更新常用语数据源缓存
        state_1.runtime.commonPhrasesUrl = newValue.commonPhrasesUrl;
        // 同步更新 CDN 加速开关缓存
        state_1.runtime.useCdn = !!newValue.useCdn;
    };
    const patchAllvalue = (kv) => updateAllvalue({ ...Allvalue, ...kv });
    // 解构状态变量，方便后续使用
    const { voiceEnabled } = Allvalue;
    const voiceEnabledText = voiceEnabled ? '🔊 语音' : '🔇 静音';
    // 设置抽屉显示状态管理
    const [visible, setVisible] = CAT_UI.useState(false);
    // 常用语抽屉显示状态管理
    const [commonPhrasesVisible, setCommonPhrasesVisible] = CAT_UI.useState(false);
    // 设备互联抽屉显示状态
    const [phoneVisible, setPhoneVisible] = CAT_UI.useState(false);
    // 设备互联自动接收的停止函数（用 ref 避免重复启动）
    const receiveStopRef = CAT_UI.useRef(null);
    // 日志条目状态管理
    const [logEntries, setLogEntries] = CAT_UI.useState([]);
    // 常用语数据状态管理
    const [phrasesData, setPhrasesData] = CAT_UI.useState({});
    // 常用语加载状态
    const [phrasesLoading, setPhrasesLoading] = CAT_UI.useState(false);
    // 常用语搜索关键字状态管理
    const [searchKeyword, setSearchKeyword] = CAT_UI.useState('');
    // 设置日志回调函数
    CAT_UI.useEffect(() => {
        (0, logger_1.setLogEntriesSink)(setLogEntries);
        return () => {
            (0, logger_1.setLogEntriesSink)(null);
        };
    }, []);
    // 脚本启动日志：首次挂载时输出一次到设置面板日志窗口
    CAT_UI.useEffect(() => {
        (0, logger_1.addLog)('脚本已启动，版本 v' + (GM_info.script.version || '?'), 'success');
        const wh = Allvalue.workingHours || state_1.runtime.workingHours;
        if (wh) {
            (0, logger_1.addLog)('监控时间段：上午 ' +
                (0, utils_1.hoursToHHmm)(wh.morningStart) +
                '-' +
                (0, utils_1.hoursToHHmm)(wh.morningEnd) +
                '，下午 ' +
                (0, utils_1.hoursToHHmm)(wh.afternoonStart) +
                '-' +
                (0, utils_1.hoursToHHmm)(wh.afternoonEnd), 'info');
        }
        (0, logger_1.addLog)('语音播报：' + (state_1.runtime.voiceEnabled ? '已开启' : '已静音'), 'info');
        const savedPoint = (0, storage_1.loadPanelPoint)();
        (0, logger_1.addLog)(savedPoint
            ? '面板位置：已恢复上次位置 (' + Math.round(savedPoint.x) + ', ' + Math.round(savedPoint.y) + ')'
            : '面板位置：使用默认位置', 'info');
    }, []);
    // 加载常用语数据的函数
    // force=true 时强制刷新（忽略缓存），如点击「重新加载」按钮；否则命中有效缓存则跳过网络请求
    const loadPhrasesData = (force = false) => {
        // 非强制刷新：命中 2 小时内的有效缓存（URL 一致）则直接复用本地数据，不发请求
        if (!force) {
            const cache = (0, storage_1.loadPhrasesCache)();
            if (cache && cache.url === state_1.runtime.commonPhrasesUrl && Date.now() - cache.time < constants_1.PHRASES_CACHE_TTL) {
                setPhrasesData(cache.data || {}); // 防 cache.data 为 undefined/null（历史上可能存过空值）
                const mins = Math.round((Date.now() - cache.time) / 60000);
                (0, logger_1.addLog)('常用语使用本地缓存（' + mins + ' 分钟前加载），已跳过网络请求', 'info');
                // 缓存命中不弹成功 toast（每次开抽屉都弹会打扰；日志已说明，仅新加载时提示）
                return;
            }
        }
        const seq = ++phrasesRequestSeq; // 请求序号：仅最新一次请求可落地结果，防旧响应后到覆盖新数据
        setPhrasesLoading(true);
        GM_xmlhttpRequest({
            method: 'GET',
            // 存值被清空时回退 DEFAULTS 默认直链，避免「空地址」静默失败（旧逻辑此处直接用可能为空的缓存值）
            url: (0, utils_1.resolveGithubUrl)(state_1.runtime.commonPhrasesUrl || constants_1.DEFAULTS.commonPhrasesUrl),
            timeout: 15000,
            onload: function (response) {
                if (seq !== phrasesRequestSeq)
                    return; // 已过期请求（期间又发起了新加载），丢弃
                try {
                    // HTTP 状态 + 类型双重校验：404/错误页的纯文本可能是「合法 YAML」（标量/键值对），
                    // 直接 setPhrasesData 会渲染垃圾按钮并把垃圾写进 2h 缓存（v26.9.6-v7 起因）；
                    // 必须 200 且解析结果是「纯键值对象」才算成功。
                    if (response.status !== 200)
                        throw new Error('数据源返回 HTTP ' + response.status);
                    const data = jsyaml.load(response.responseText);
                    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                        throw new Error('数据源不是有效的键值对象（可能返回了网页/错误页）');
                    }
                    setPhrasesData(data);
                    (0, storage_1.savePhrasesCache)(state_1.runtime.commonPhrasesUrl, data);
                    (0, logger_1.addLog)('常用语加载成功，共 ' + Object.keys(data).length + ' 条', 'success');
                    CAT_UI.Message.success('常用语加载成功');
                }
                catch (error) {
                    // 失败时保留已加载的旧数据（若有），用户仍可用；仅提示失败原因
                    const hasOld = Object.keys(phrasesData).length > 0;
                    (0, logger_1.addLog)('常用语加载失败: ' + error.message + (hasOld ? '，仍显示上次加载的内容' : ''), 'error', true);
                    CAT_UI.Message.error('常用语加载失败' + (hasOld ? '，仍显示上次内容' : ''));
                }
                finally {
                    setPhrasesLoading(false);
                }
            },
            onerror: function (error) {
                if (seq !== phrasesRequestSeq)
                    return;
                // 统一处理 error 参数（可能是 Error 对象、字符串或事件）
                const errMsg = error && error.message ? error.message : typeof error === 'string' ? error : '网络错误';
                // 网络失败时保留已加载的旧数据（若有），断网/服务器故障期间仍可使用上次的常用语
                const hasOld = Object.keys(phrasesData).length > 0;
                (0, logger_1.addLog)('加载常用语失败: ' + errMsg + (hasOld ? '，仍显示上次加载的内容' : ''), 'error', true);
                CAT_UI.Message.error('加载常用语失败' + (hasOld ? '，仍显示上次内容' : ''));
                setPhrasesLoading(false);
            },
            ontimeout: function () {
                if (seq !== phrasesRequestSeq)
                    return;
                // 请求挂起超时（如数据源被墙/无响应）：同样复位 loading、保留旧数据，抽屉可再次点重载
                const hasOld = Object.keys(phrasesData).length > 0;
                (0, logger_1.addLog)('加载常用语超时（15s），已取消' + (hasOld ? '，仍显示上次加载的内容' : ''), 'error', true);
                CAT_UI.Message.error('常用语加载超时' + (hasOld ? '，仍显示上次内容' : ''));
                setPhrasesLoading(false);
            },
        });
    };
    // 常用语抽屉打开时自动加载数据
    CAT_UI.useEffect(() => {
        if (commonPhrasesVisible) {
            loadPhrasesData();
        }
    }, [commonPhrasesVisible]);
    // 设备互联：中继服务器地址填好后，默认自动开始接收（无需点击按钮）
    // 收到图片即弹出网页居中的预览弹窗（含复制 / 关闭按钮，见 showImagePopup）
    CAT_UI.useEffect(() => {
        const s = (Allvalue.relayServer || '').trim().replace(/\/+$/, '');
        // 门控 + 防抖：设置里逐字输入时 relayServer 连续变化，立即启停会造成无效轮询抖动；
        // 仅当地址以 http(s):// 开头且停顿 800ms 未再变化时才（重新）开始接收。
        if (!s || !/^https?:\/\//i.test(s))
            return;
        const timer = setTimeout(() => {
            if (receiveStopRef.current)
                return; // 已在接收，避免重复启动
            // 「已自动开始接收」日志在脚本**连上服务器时立即**显示（见 startPhoneReceive 的 onConnected，
            // 由首次 /recv 短轮询确认触发，约 1 秒内），不等待手机端发送图片。地址末尾的 / 已在上面归一。
            const stop = (0, relay_1.startPhoneReceive)({
                server: s,
                uuid: (0, relay_1.getDeviceId)(),
                onConnected: () => {
                    (0, logger_1.addLog)('[设备互联] 已自动开始接收（' + s + '）', 'info');
                },
                onImage: (img) => {
                    (0, logger_1.addLog)('[设备互联] 收到图片：' + (img.name || 'image') + '（' + (img.mime || 'image') + '）', 'success');
                    (0, gallery_1.showImagePopup)(img);
                },
                onText: (txt) => {
                    const t = (txt.text || '').replace(/\s+$/, '');
                    (0, logger_1.addLog)('[设备互联] 收到文本：' + (t.length > 40 ? t.slice(0, 40) + '…' : t), 'success');
                    (0, gallery_1.showTextPopup)(txt);
                },
            });
            receiveStopRef.current = stop;
        }, 800);
        return () => {
            clearTimeout(timer);
            if (receiveStopRef.current) {
                receiveStopRef.current();
                receiveStopRef.current = null;
            }
        };
    }, [Allvalue.relayServer]);
    // =========主UI布局==========
    return CAT_UI.Space([
        CAT_UI.Space([
            CAT_UI.Text('语音播报状态: '),
            CAT_UI.Button(voiceEnabledText, {
                type: 'primary',
                onClick: () => {
                    const newVoiceEnabled = !voiceEnabled;
                    patchAllvalue({ voiceEnabled: newVoiceEnabled });
                    (0, logger_1.addLog)('语音播报已' + (newVoiceEnabled ? '开启' : '静音'), 'info');
                    // 启用语音时，初始化语音合成（解决浏览器not-allowed限制）
                    if (newVoiceEnabled && 'speechSynthesis' in window) {
                        // 播放一个静默语音来激活语音功能
                        const testUtterance = new SpeechSynthesisUtterance('');
                        window.speechSynthesis.speak(testUtterance);
                        CAT_UI.Message.success('语音功能已启用');
                    }
                    else if (!newVoiceEnabled) {
                        // 关闭语音：立即清空队列，防止旧消息堆积、再次开启时集中涌出
                        (0, speech_1.clearSpeechQueue)();
                    }
                },
                // 动态样式：根据静音状态切换颜色
                style: {
                    fontWeight: 'bold',
                    backgroundColor: !voiceEnabled ? '#990018' : '#007e44',
                    borderColor: !voiceEnabled ? '#990018' : '#007e44',
                },
            }),
        ], {
            direction: 'horizontal',
            size: 'middle',
            style: { marginBottom: '8px' },
        }),
        CAT_UI.Space([
            CAT_UI.Space([
                CAT_UI.Button('设置', {
                    type: 'primary',
                    onClick: () => setVisible(true),
                }),
                CAT_UI.Button('常用语', {
                    type: 'primary',
                    onClick() {
                        setCommonPhrasesVisible(true);
                    },
                }),
            ], {
                direction: 'horizontal',
                size: 'middle',
            }),
            CAT_UI.Space([
                CAT_UI.Button('历史文件', {
                    type: 'primary',
                    onClick: () => {
                        if (!gallery_1.receivedImages.length) {
                            CAT_UI.Message.info('暂无待存文件');
                            return;
                        }
                        (0, gallery_1.renderImageGallery)();
                    },
                }),
                CAT_UI.Button('设备互联', {
                    type: 'primary',
                    onClick: () => setPhoneVisible(true),
                }),
            ], {
                direction: 'horizontal',
                size: 'middle',
            }),
        ], {
            direction: 'vertical',
            size: 'small',
        }),
        //抽屉
        CAT_UI.Space([
            CAT_UI.createElement(SettingsDrawer_1.SettingsDrawer, {
                visible,
                setVisible,
                logEntries,
                workingHours: Allvalue.workingHours,
                onChangeWorkingHours: (wh) => {
                    patchAllvalue({ workingHours: wh });
                    (0, logger_1.addLog)('监控时间段已更新：上午 ' +
                        (0, utils_1.hoursToHHmm)(wh.morningStart) +
                        '-' +
                        (0, utils_1.hoursToHHmm)(wh.morningEnd) +
                        '，下午 ' +
                        (0, utils_1.hoursToHHmm)(wh.afternoonStart) +
                        '-' +
                        (0, utils_1.hoursToHHmm)(wh.afternoonEnd), 'info');
                },
                commonPhrasesUrl: Allvalue.commonPhrasesUrl,
                onChangeCommonPhrasesUrl: (url) => {
                    patchAllvalue({ commonPhrasesUrl: url });
                    (0, logger_1.addLogDebounced)('commonPhrasesUrl', '常用语数据源已更新: ' + url, 'info');
                },
                relayServer: Allvalue.relayServer || '',
                onChangeRelayServer: (url) => {
                    patchAllvalue({ relayServer: url });
                    (0, logger_1.addLogDebounced)('relayServer', '中继服务器已更新: ' + (url || '（空）'), 'info');
                },
                useCdn: Allvalue.useCdn,
                onChangeUseCdn: (v) => {
                    patchAllvalue({ useCdn: !!v });
                    (0, logger_1.addLog)('CDN 加速已' + (v ? '开启' : '关闭'), 'info');
                },
            }),
            CAT_UI.createElement(CommonPhrasesDrawer_1.CommonPhrasesDrawer, {
                visible: commonPhrasesVisible,
                setVisible: setCommonPhrasesVisible,
                phrasesData,
                setPhrasesData,
                phrasesLoading,
                setPhrasesLoading,
                searchKeyword,
                setSearchKeyword,
                loadPhrasesData,
                commonPhrasesUrl: Allvalue.commonPhrasesUrl,
            }),
            CAT_UI.createElement(PhoneImageDrawer_1.PhoneImageDrawer, {
                visible: phoneVisible,
                setVisible: setPhoneVisible,
                relayServer: Allvalue.relayServer || '',
                onChangeRelayServer: (url) => {
                    patchAllvalue({ relayServer: url });
                    (0, logger_1.addLogDebounced)('relayServer', '中继服务器已更新: ' + (url || '（空）'), 'info');
                },
            }),
        ], {
            direction: 'horizontal',
            size: 'middle',
        }),
    ], { direction: 'vertical' });
}
exports.MainPanel = MainPanel;


/***/ },

/***/ 63
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

/**
 * 设备互联抽屉（原 app.ts 的 PhoneImageDrawer）：本机上传链接 + 二维码 + 发送到手机。
 * 模块化 P5：逐字迁移，仅加 export。
 */
__webpack_unused_export__ = ({ value: true });
exports.PhoneImageDrawer = void 0;
const logger_1 = __webpack_require__(514);
const clipboard_1 = __webpack_require__(170);
const relay_1 = __webpack_require__(289);
const qrcode_1 = __webpack_require__(888);
function PhoneImageDrawer({ visible, setVisible, relayServer, onChangeRelayServer }) {
    const deviceId = (0, relay_1.getDeviceId)();
    const [qrUrl, setQrUrl] = CAT_UI.useState('');
    const [link, setLink] = CAT_UI.useState('');
    const [phoneOnline, setPhoneOnline] = CAT_UI.useState(false);
    const [sending, setSending] = CAT_UI.useState(false);
    const [sendText, setSendText] = CAT_UI.useState('');
    const copyLink = () => {
        if (link)
            (0, clipboard_1.safeCopyText)(link);
    };
    // 计算链接 + 二维码（仅在打开抽屉或地址变化时；非 http(s) 前缀即设置输入中途，不生成）
    CAT_UI.useEffect(() => {
        const s = (relayServer || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(s)) {
            setLink('');
            setQrUrl('');
            return;
        }
        const lk = s + '/u/' + deviceId;
        setLink(lk);
        (0, qrcode_1.genQrDataUrl)(lk)
            .then((u) => setQrUrl(u))
            .catch((e) => {
            (0, logger_1.addLog)('[二维码] 失败: ' + e.message, 'error', true);
        });
    }, [relayServer, visible]);
    // 轮询手机在线状态（每 5s），用于发送前判断是否可发
    CAT_UI.useEffect(() => {
        const server = (relayServer || '').trim().replace(/\/+$/, '');
        if (!visible || !/^https?:\/\//i.test(server))
            return; // 非法前缀（设置里逐字输入中）不发起请求
        let alive = true;
        const check = () => {
            if (!alive)
                return;
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: server + '/phone/status/' + encodeURIComponent(deviceId),
                    timeout: 8000,
                    onload: (r) => {
                        if (!alive)
                            return;
                        let j = null;
                        try {
                            j = JSON.parse(r.responseText);
                        }
                        catch (e) {
                            j = null;
                        }
                        setPhoneOnline(!!(j && j.online));
                    },
                    onerror: () => {
                        if (alive)
                            setPhoneOnline(false);
                    },
                });
            }
            catch (e) {
                if (alive)
                    setPhoneOnline(false);
            }
        };
        check();
        const t = setInterval(check, 5000);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, [visible, relayServer, deviceId]);
    // 发送文本到手机
    const doSendText = () => {
        const t = (sendText || '').trim();
        if (!t) {
            (0, logger_1.addLog)('[发送到手机] 文本为空', 'error', true);
            return;
        }
        if (!phoneOnline) {
            (0, logger_1.addLog)('[发送到手机] 当前无在线设备，无法发送', 'error', true);
            return;
        }
        setSending(true);
        (0, relay_1.sendToPhone)({
            server: relayServer,
            uuid: deviceId,
            payload: { text: t },
            onOk: () => {
                (0, logger_1.addLog)('[发送到手机] 文本已发送', 'success');
                setSendText('');
                setSending(false);
            },
            onFail: (e) => {
                (0, logger_1.addLog)('[发送到手机] 发送失败：' + e, 'error');
                setSending(false);
            },
        });
    };
    // 选择图片到手机：选完仅加入「待发送」预览列表，不立即上传；点「发送」才真正发送。
    // 与手机端上传页（选图 → 下方预览 → 点发送）行为一致，避免误选即发的冲动操作。
    const [pendingImages, setPendingImages] = CAT_UI.useState([]);
    const pickImages = () => {
        if (!phoneOnline) {
            (0, logger_1.addLog)('[发送到手机] 当前无在线设备，无法发送', 'error', true);
            return;
        }
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.multiple = true;
        inp.style.display = 'none';
        document.body.appendChild(inp);
        // 取消选择（对话框关闭但未选文件）也要移除隐藏 input：'cancel' 事件非标准，
        // 用「对话框关闭后 window 恢复焦点」兜底清理，避免反复取消在 body 累积 input
        const cleanupFocus = () => {
            window.removeEventListener('focus', cleanupFocus);
            try {
                inp.remove();
            }
            catch (e) {
                /* 已移除 */
            }
        };
        inp.onchange = () => {
            const files = Array.prototype.slice.call(inp.files || []);
            window.removeEventListener('focus', cleanupFocus);
            inp.remove();
            if (!files.length)
                return;
            const arr = files.map((f) => ({
                file: f,
                name: f.name || 'image.jpg',
                mime: f.type || 'image/jpeg',
                url: URL.createObjectURL(f),
            }));
            setPendingImages((prev) => prev.concat(arr));
        };
        window.addEventListener('focus', cleanupFocus);
        inp.click();
    };
    const removePendingImage = (i) => {
        if (sending)
            return; // 发送中禁止移除：发送按快照进行，移除会导致界面与实际发送不一致
        const arr = pendingImages.slice();
        const removed = arr.splice(i, 1)[0];
        try {
            URL.revokeObjectURL(removed.url);
        }
        catch (e) {
            /* 忽略 */
        }
        setPendingImages(arr);
    };
    // 真正发送：逐张顺序发送（一张成功再发下一张，保证到达顺序；失败即停并提示进度）。
    // 中继服务端手机收件通道已队列化（phonePending FIFO），连发不会互相覆盖。
    const confirmSendImage = () => {
        if (!pendingImages.length)
            return;
        if (!phoneOnline) {
            (0, logger_1.addLog)('[发送到手机] 当前无在线设备，无法发送', 'error', true);
            return;
        }
        setSending(true);
        const list = pendingImages.slice();
        const total = list.length;
        let sent = 0;
        const sendNext = () => {
            if (sent >= total) {
                // 发送成功后释放所有待发送图片的 objectURL，防止 blob URL 累积泄漏
                list.forEach((it) => {
                    try {
                        URL.revokeObjectURL(it.url);
                    }
                    catch (e) {
                        /* 忽略 */
                    }
                });
                (0, logger_1.addLog)('[发送到手机] ' + total + ' 张图片已全部发送', 'success');
                setSending(false);
                setPendingImages([]);
                return;
            }
            const it = list[sent];
            // 体积预检：base64 膨胀后若超服务端单请求上限，直接友好报错停止（不盲目传一半再被 413）
            if ((0, relay_1.imagePayloadBytes)(it.file, it.name, it.mime) > relay_1.RELAY_MAX_BODY) {
                (0, logger_1.addLog)('[发送到手机] 第 ' +
                    (sent + 1) +
                    ' 张过大（单张约 12MB 上限），已停止，请压缩后再试（已发 ' +
                    sent +
                    '/' +
                    total +
                    '）', 'error', true);
                setSending(false);
                return;
            }
            (0, logger_1.addLog)('[发送到手机] 正在发送（' + (sent + 1) + '/' + total + '）：' + (it.name || 'image'), 'info');
            const rd = new FileReader();
            rd.onload = () => {
                const b64 = (rd.result || '').split(',')[1] || '';
                if (!b64) {
                    (0, logger_1.addLog)('[发送到手机] 第 ' + (sent + 1) + ' 张读取失败，已停止（已发 ' + sent + '/' + total + '）', 'error', true);
                    setSending(false);
                    return;
                }
                (0, relay_1.sendToPhone)({
                    server: relayServer,
                    uuid: deviceId,
                    payload: { name: it.name, mime: it.mime, data: b64 },
                    onOk: () => {
                        sent++;
                        sendNext();
                    },
                    onFail: (e) => {
                        (0, logger_1.addLog)('[发送到手机] 第 ' +
                            (sent + 1) +
                            ' 张发送失败：' +
                            e +
                            '（已发 ' +
                            sent +
                            '/' +
                            total +
                            '）', 'error');
                        setSending(false);
                    },
                });
            };
            rd.onerror = () => {
                (0, logger_1.addLog)('[发送到手机] 第 ' + (sent + 1) + ' 张读取失败，已停止（已发 ' + sent + '/' + total + '）', 'error', true);
                setSending(false);
            };
            rd.readAsDataURL(it.file);
        };
        sendNext();
    };
    return CAT_UI.Drawer(CAT_UI.createElement('div', { style: { textAlign: 'left' } }, [
        link
            ? CAT_UI.createElement('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' } }, [
                // 左侧：二维码
                CAT_UI.createElement('div', { style: { flexShrink: '0' } }, [
                    qrUrl
                        ? CAT_UI.createElement('div', {
                            style: {
                                width: '140px',
                                height: '140px',
                                backgroundImage: 'url("' + qrUrl + '")',
                                backgroundSize: 'contain',
                                backgroundRepeat: 'no-repeat',
                                backgroundPosition: 'center',
                                border: '1px solid #eee',
                                borderRadius: '8px',
                            },
                        })
                        : CAT_UI.createElement('div', {
                            style: {
                                color: '#999',
                                fontSize: '12px',
                                width: '140px',
                                textAlign: 'center',
                            },
                        }, '二维码生成中…（若长时间不出，请手动复制右侧链接）'),
                ]),
                // 右侧：链接文本 + 复制按钮
                CAT_UI.createElement('div', { style: { flex: '1', minWidth: '180px' } }, [
                    CAT_UI.createElement('div', {
                        style: {
                            fontSize: '12px',
                            color: '#999',
                            wordBreak: 'break-all',
                            marginBottom: '8px',
                        },
                    }, link),
                    CAT_UI.Button('复制链接', {
                        type: 'link',
                        onClick: copyLink,
                        style: { padding: '0 8px', color: '#1890ff', fontWeight: 'bold' },
                    }),
                ]),
            ])
            : CAT_UI.createElement('p', { style: { color: '#e4393c', fontSize: '13px', margin: '0' } }, '尚未配置中继服务器，请到「设置」填写。'),
        CAT_UI.Divider('发送到手机'),
        CAT_UI.createElement('p', {
            style: {
                color: phoneOnline ? '#007e44' : '#e4393c',
                fontSize: '13px',
                margin: '0 0 10px',
                lineHeight: '1.5',
            },
        }, phoneOnline ? '🟢 手机已连接，可发送' : '⚪ 当前无在线设备，无法发送'),
        CAT_UI.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px' } }, [
            CAT_UI.Input({
                placeholder: '输入要发送到手机的文本…',
                value: sendText,
                onChange: (val) => {
                    const v = typeof val === 'string' ? val : val && val.target ? val.target.value : '';
                    setSendText(v);
                },
                style: { flex: '1', marginBottom: '0' },
            }),
            CAT_UI.Button('发送', {
                type: 'primary',
                disabled: !phoneOnline || sending,
                onClick: doSendText,
                style: { whiteSpace: 'nowrap' },
            }),
        ]),
        CAT_UI.Button('选择 / 添加图片（可多选）', {
            disabled: !phoneOnline || sending,
            onClick: pickImages,
            style: { width: '100%', marginBottom: pendingImages.length ? '10px' : '0' },
        }),
        pendingImages.length > 0
            ? CAT_UI.createElement('div', { style: { marginBottom: '10px' } }, [
                CAT_UI.createElement('div', {
                    style: {
                        display: 'grid',
                        gridTemplateColumns: 'repeat(3,1fr)',
                        gap: '6px',
                        marginBottom: '10px',
                    },
                }, pendingImages.map((img, i) => CAT_UI.createElement('div', {
                    style: {
                        position: 'relative',
                        width: '100%',
                        paddingBottom: '100%',
                        backgroundImage: 'url("' + img.url + '")',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        borderRadius: '8px',
                    },
                }, [
                    CAT_UI.Button('×', {
                        type: 'link',
                        disabled: sending,
                        onClick: () => removePendingImage(i),
                        style: {
                            position: 'absolute',
                            top: '2px',
                            right: '2px',
                            padding: '0 6px',
                            minWidth: '22px',
                            height: '22px',
                            lineHeight: '20px',
                            fontSize: '16px',
                            color: '#fff',
                            background: 'rgba(0,0,0,0.55)',
                            borderRadius: '50%',
                        },
                    }),
                ]))),
                CAT_UI.Button(pendingImages.length > 1
                    ? '发送 ' + pendingImages.length + ' 张图片到手机'
                    : '发送图片到手机', {
                    type: 'primary',
                    disabled: !phoneOnline || sending,
                    onClick: confirmSendImage,
                    style: { width: '100%' },
                }),
            ])
            : null,
    ]), {
        title: '手机互传',
        visible,
        width: 420,
        focusLock: true,
        autoFocus: false,
        zIndex: 10002,
        onOk: () => {
            setVisible(false);
        },
        onCancel: () => {
            setVisible(false);
        },
    });
}
exports.PhoneImageDrawer = PhoneImageDrawer;


/***/ },

/***/ 919
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

/**
 * 设置抽屉（原 app.ts 的 SettingsDrawer）：脚本链接、CDN 开关、监控时间段、常用语地址、中继地址、日志。
 * 模块化 P5：逐字迁移，仅加 export。
 * ⚠️ 时间输入与地址草稿的处理是真实页面实测结论（见块内注释），禁止顺手重构。
 */
__webpack_unused_export__ = ({ value: true });
exports.SettingsDrawer = void 0;
const constants_1 = __webpack_require__(149);
const changelog_1 = __webpack_require__(462);
const utils_1 = __webpack_require__(973);
const LogPanel_1 = __webpack_require__(295);
function SettingsDrawer({ visible, setVisible, logEntries, workingHours, onChangeWorkingHours, commonPhrasesUrl, onChangeCommonPhrasesUrl, relayServer, onChangeRelayServer, useCdn, onChangeUseCdn, }) {
    // 当前监控时间段（兜底默认值，避免未配置时报错）
    const wh = workingHours || { morningStart: 9, morningEnd: 12, afternoonStart: 13.5, afternoonEnd: 18 };
    // 更新单个时间段字段（入参为十进制小时）
    const updateWh = (field, dec) => {
        if (typeof dec !== 'number' || isNaN(dec))
            return;
        onChangeWorkingHours({ ...wh, [field]: dec });
    };
    // 时间选择器 onChange 兼容：CAT_UI 未导出 TimePicker，此处用原生 <input type="time">，
    // 其 onChange 回传原生事件（val.target.value 为 "HH:mm"）；同时兼容 arco 的 (val, str) 形式
    const onTimeChange = (field) => (val, str) => {
        let s;
        if (val && val.target && typeof val.target.value === 'string') {
            s = val.target.value; // 原生 <input type="time">
        }
        else if (typeof str === 'string') {
            s = str; // arco (dayjsValue, timeString)
        }
        else if (val && typeof val.format === 'function') {
            s = val.format('HH:mm');
        }
        else if (typeof val === 'string') {
            s = val;
        }
        else {
            s = '';
        }
        const dec = (0, utils_1.hhmmToHours)(s);
        if (dec !== null)
            updateWh(field, dec);
    };
    // 常用语数据源地址：草稿 + 失焦回填默认。
    // 旧逻辑 onChange 空串时立即提交默认地址，受控 Input 的 value 随之变回默认——
    // 用户清空后还没来得及输入/粘贴新地址，输入框就被自动填上默认值，体验很糟。
    // 现改为：输入框显示独立的 urlDraft 草稿（清空后保持为空），非空时逐字提交保存；
    // 仅当**失焦且草稿为空**时才把默认地址回填并提交（符合「点别处才恢复默认」的直觉）。
    // 地址可用性仍由使用时的加载校验兜底（loadPhrasesData 的 status/类型校验）。
    const DEFAULT_PHRASES_URL = constants_1.DEFAULTS.commonPhrasesUrl;
    const [urlDraft, setUrlDraft] = CAT_UI.useState(commonPhrasesUrl || DEFAULT_PHRASES_URL);
    // 外部已保存值变化（提交、重开设置）时同步草稿；输入中不会触发（外部值未变），不打断打字
    CAT_UI.useEffect(() => {
        setUrlDraft(commonPhrasesUrl || DEFAULT_PHRASES_URL);
    }, [commonPhrasesUrl]);
    // 重开设置抽屉时丢弃上次未完成/未失焦的草稿，按已保存值展示
    CAT_UI.useEffect(() => {
        if (visible)
            setUrlDraft(commonPhrasesUrl || DEFAULT_PHRASES_URL);
    }, [visible]);
    const onUrlChange = (val) => {
        let url = typeof val === 'string' ? val : val && val.target ? val.target.value : '';
        url = (url || '').trim();
        setUrlDraft(url); // 草稿始终跟随输入（含清空），输入框保持为空，不回填默认
        if (url)
            onChangeCommonPhrasesUrl(url); // 非空逐字提交；空串延迟到失焦处理
    };
    // 失焦时从事件目标读最新 DOM 值（不依赖闭包快照）；为空则回填默认地址并提交
    const onUrlBlur = (e) => {
        const url = ((e && e.target && typeof e.target.value === 'string' ? e.target.value : urlDraft) || '').trim();
        if (!url) {
            onChangeCommonPhrasesUrl(DEFAULT_PHRASES_URL);
            setUrlDraft(DEFAULT_PHRASES_URL);
        }
    };
    return CAT_UI.Drawer(CAT_UI.createElement('div', { style: { textAlign: 'left' } }, [
        CAT_UI.Space([
            CAT_UI.Button('[脚本主页]', {
                type: 'link',
                onClick: () => {
                    window.open('https://scriptcat.org/zh-CN/script-show-page/3650', '_blank');
                },
                style: {
                    padding: '0 8px',
                    color: '#1890ff',
                    fontWeight: 'bold',
                },
            }),
            CAT_UI.Button('[更新脚本]', {
                type: 'link',
                onClick: () => {
                    window.open((GM_info.scriptUpdateURL || GM_info.script.updateURL), '_blank');
                },
                style: {
                    padding: '0 8px',
                    color: '#1890ff',
                    fontWeight: 'bold',
                },
            }),
            // 更新日志：读仓库根 CHANGELOG.md，弹窗展示最新 10 条（见 lib/changelog.ts）
            CAT_UI.Button('[更新日志]', {
                type: 'link',
                onClick: () => {
                    (0, changelog_1.showChangelogPopup)();
                },
                style: {
                    padding: '0 8px',
                    color: '#1890ff',
                    fontWeight: 'bold',
                },
            }),
        ], { direction: 'horizontal', size: 'small' }),
        CAT_UI.Divider('其他设置'),
        // CDN 加速开关：控制项目内 GitHub 资源（常用语 YAML、提示音）是否经 jsDelivr 加速
        // 注意：① CAT_UI.Switch 运行时为 undefined；② 裸 createElement('input') 不在 CAT_UI 的
        // React 渲染器白名单内，会触发 React error #137（与 img 同类）。
        // 改用白名单内的 div 模拟勾选框（受控：样式随 useCdn 变化，点击触发 onChangeUseCdn 取反）。
        CAT_UI.Space([
            CAT_UI.Text('使用 CDN 加速（jsDelivr）加载资源', {
                style: { display: 'block', fontWeight: 'bold' },
            }),
            CAT_UI.createElement('div', {
                onClick: () => {
                    if (typeof onChangeUseCdn === 'function')
                        onChangeUseCdn(!useCdn);
                },
                style: {
                    width: '18px',
                    height: '18px',
                    cursor: 'pointer',
                    marginLeft: '8px',
                    boxSizing: 'border-box',
                    userSelect: 'none',
                    border: '1px solid ' + (useCdn ? '#1890ff' : '#d9d9d9'),
                    borderRadius: '3px',
                    background: useCdn ? '#1890ff' : '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: '12px',
                    lineHeight: '1',
                },
            }, useCdn ? '✓' : ''),
        ], { direction: 'horizontal', size: 'small', style: { marginBottom: '8px' } }),
        // 监控时间段配置（使用时间选择器）
        CAT_UI.Text('监控时间段（点击选择时间）', {
            style: { display: 'block', marginBottom: '8px', fontWeight: 'bold' },
        }),
        CAT_UI.Space([
            CAT_UI.Text('上午'),
            CAT_UI.Input({
                type: 'time',
                value: (0, utils_1.hoursToHHmm)(wh.morningStart),
                onChange: onTimeChange('morningStart'),
                style: { width: '110px' },
            }),
            CAT_UI.Text('至'),
            CAT_UI.Input({
                type: 'time',
                value: (0, utils_1.hoursToHHmm)(wh.morningEnd),
                onChange: onTimeChange('morningEnd'),
                style: { width: '110px' },
            }),
        ], { direction: 'horizontal', size: 'small', style: { marginBottom: '8px', flexWrap: 'wrap' } }),
        CAT_UI.Space([
            CAT_UI.Text('下午'),
            CAT_UI.Input({
                type: 'time',
                value: (0, utils_1.hoursToHHmm)(wh.afternoonStart),
                onChange: onTimeChange('afternoonStart'),
                style: { width: '110px' },
            }),
            CAT_UI.Text('至'),
            CAT_UI.Input({
                type: 'time',
                value: (0, utils_1.hoursToHHmm)(wh.afternoonEnd),
                onChange: onTimeChange('afternoonEnd'),
                style: { width: '110px' },
            }),
        ], { direction: 'horizontal', size: 'small', style: { marginBottom: '8px', flexWrap: 'wrap' } }),
        CAT_UI.createElement('p', { style: { margin: '0 0 8px', color: '#999', fontSize: '12px', lineHeight: '1.5' } }, '提示：将「下午开始」设为与「上午结束」相同（如都设为 12:00），即可午休时段也监控。'),
        CAT_UI.Text('常用语数据地址（可自定义远程 YAML）', {
            style: { display: 'block', marginBottom: '8px', fontWeight: 'bold' },
        }),
        CAT_UI.Input({
            placeholder: 'https://.../commonPhrases.yaml',
            value: urlDraft,
            onChange: onUrlChange,
            onBlur: onUrlBlur,
            allowClear: true,
            style: { marginBottom: '8px', width: '100%' },
        }),
        CAT_UI.createElement('p', { style: { margin: '0 0 8px', color: '#999', fontSize: '12px', lineHeight: '1.5' } }, '修改后请在「常用语」面板点「重新加载常用语」生效；留空并点击其他区域（失焦）后恢复默认地址。'),
        CAT_UI.Text('中继服务器地址', {
            style: { display: 'block', marginBottom: '8px', fontWeight: 'bold' },
        }),
        CAT_UI.Input({
            placeholder: 'https://你的服务器:端口',
            value: relayServer || '',
            onChange: (val) => {
                let url = typeof val === 'string' ? val : val && val.target ? val.target.value : '';
                url = (url || '').trim().replace(/\/+$/, ''); // 去掉末尾多余的 /（如用户粘贴 http://x:5689/ ）
                // 逐字提交（不再逐键拦截非 http 前缀导致无法输入）；
                // 「设备互联」自动接收侧另有 http(s) 前缀门控 + 800ms 防抖，避免输入过程中无效启停
                onChangeRelayServer(url);
            },
            allowClear: true,
            style: { marginBottom: '8px', width: '100%' },
        }),
        CAT_UI.createElement('p', { style: { margin: '0 0 8px', color: '#999', fontSize: '12px', lineHeight: '1.5' } }, '用于「设备互联到电脑」：手机上传的图片经此服务器转发到本机剪贴板。需自行部署配套 relay-server（见项目说明）。'),
        CAT_UI.Divider('日志内容'),
        CAT_UI.createElement(LogPanel_1.LogPanel, { logEntries }),
    ]), {
        title: '设置菜单',
        visible,
        width: 400,
        focusLock: true,
        autoFocus: false,
        zIndex: 10000,
        onOk: () => {
            setVisible(false);
        },
        onCancel: () => {
            setVisible(false);
        },
    });
}
exports.SettingsDrawer = SettingsDrawer;


/***/ },

/***/ 650
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

/**
 * 面板位置保存（原 app.ts 中 setupPanelPositionTracking 的具名 IIFE）。
 * 模块化 P5：逐字迁移，仅把 IIFE 改为导出函数，调用点移回 app()。
 * 关键事实与踩坑见块内注释（Shadow DOM、react-draggable transform）。
 */
__webpack_unused_export__ = ({ value: true });
exports.setupPanelPositionTracking = void 0;
const storage_1 = __webpack_require__(113);
// ==========面板位置保存==========
// 关键事实（已核对 CAT_UI 源码）：
//  1) createPanel 不提供 onDrag 回调，位置恢复只能靠 point 选项（已在上面用 loadPanelPoint 实现）。
//  2) 面板渲染在 Shadow DOM 内（attachShadow open），普通 document 选择器穿不透，必须走 shadowRoot。
//  3) 面板由 react-draggable 实现拖拽，拖拽时改写内部层的 transform: translate(x,y)。
// 本模块只负责「保存」：定位 shadow 内的面板 → 监听拖拽 → 用 getBoundingClientRect 存真实视口坐标。
// 下次加载时 createPanel 的 point 即读取该存档，形成闭环。
function setupPanelPositionTracking() {
    const PDBG = false; // 诊断开关：验证通过后可改 false
    // resize 监听句柄（保存引用，供页面卸载时移除，避免监听器残留）
    let resizeHandler = null;
    // 缓存已扫描到的 shadow 宿主（面板宿主由 ScriptCat 插入，扫描到后结构不再变化）
    let shadowHostsCache = null;
    // 收集页面上所有带 open shadowRoot 的宿主元素
    /**
     * 收集页面上所有带有 open shadowRoot 的宿主元素（用于穿透 Shadow DOM 定位面板）。
     * 结果做缓存：首次扫描到非空结果后直接复用，避免定时器里反复全树遍历 `querySelectorAll('*')`；
     * 空结果不缓存（面板可能尚未插入 DOM），下次仍会重新扫描。
     * @returns {Array<Element>} 带有 shadowRoot 的 DOM 元素数组
     */
    function getShadowHosts() {
        if (shadowHostsCache)
            return shadowHostsCache;
        const hosts = [];
        document.querySelectorAll('*').forEach((el) => {
            if (el.shadowRoot)
                hosts.push(el);
        });
        if (hosts.length)
            shadowHostsCache = hosts;
        return hosts;
    }
    // 穿透 Shadow DOM 定位面板主体（shadow 内含本脚本标题、且带内联 left/top 的 div）
    /**
     * 穿透 Shadow DOM 定位面板主体：在带 shadowRoot 的宿主中查找含本脚本标题、且带内联 left/top 的 div。
     * @returns {(Element|null)} 找到返回面板主体元素，否则返回 null
     */
    function findPanelRoot() {
        for (const host of getShadowHosts()) {
            const sr = host.shadowRoot;
            if (!sr || !sr.textContent || !sr.textContent.includes('征纳互动监控'))
                continue;
            const divs = sr.querySelectorAll('div');
            for (const el of divs) {
                if (el.style && el.style.left && el.style.top)
                    return el;
            }
            const container = sr.querySelector('.container');
            if (container)
                return container;
        }
        return null;
    }
    // 在面板内找当前带 transform: translate 的拖拽层（react-draggable 施加）
    /**
     * 在面板子树中查找当前被 react-draggable 施加 transform: translate 的拖拽层。
     * @param {Element} root - 面板根元素
     * @returns {(Element|null)} 找到返回拖拽层元素，否则返回 null
     */
    function findDraggableNode(root) {
        const all = root.querySelectorAll('*');
        for (const el of all) {
            const t = (el.style && el.style.transform) || '';
            if (t.indexOf('translate') !== -1)
                return el;
        }
        return null;
    }
    // 读取面板当前真实视口坐标：优先取被拖拽的层（transform 后位置随之变化），
    // 否则取面板主体本身。getBoundingClientRect 与 createPanel 的 point 同坐标系。
    /**
     * 读取面板当前真实视口坐标：优先取被拖拽层（transform 后位置随之变化），否则取面板主体本身。
     * @param {Element} root - 面板根元素
     * @returns {{x:number,y:number}} 面板左上角的视口坐标（四舍五入）
     */
    function getCurrentPoint(root) {
        const el = findDraggableNode(root) || root;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top) };
    }
    // 边界约束：面板只有顶部标题栏可拖动，必须保证该「可抓取区域」始终可见，
    // 否则拖出后就无法再抓回来。
    //  - 水平方向：至少保留 MIN_VISIBLE 像素在视口内（标题栏为整条宽度，露出一段即可抓取）。
    //  - 垂直方向：顶边不允许移出视口上方(minY=0)；且至少保留 HANDLE_MIN 高的标题栏在视口内(maxY)。
    const MIN_VISIBLE = 48;
    const HANDLE_MIN = 40; // 标题栏（可抓取区）至少保留的高度
    /**
     * 将面板坐标约束在视口内，保证顶部标题栏（唯一可抓取区）始终可见、水平方向至少保留部分在视口内。
     * @param {{x:number,y:number}} pt - 待约束的坐标
     * @param {{w?:number,h?:number}} [size] - 面板尺寸（缺省按 320 宽估算）
     * @returns {{x:number,y:number}} 约束后的安全坐标
     */
    function clampPoint(pt, size) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = size && size.w ? size.w : 320;
        const minX = -(w - MIN_VISIBLE);
        const maxX = vw - MIN_VISIBLE;
        const minY = 0; // 顶边不超出视口上方，标题栏始终可见
        const maxY = vh - HANDLE_MIN; // 至少保留一条标题栏高度在视口内，可抓取
        return {
            x: Math.min(Math.max(pt.x, minX), maxX),
            y: Math.min(Math.max(pt.y, minY), maxY),
        };
    }
    // 读取面板当前尺寸与可见矩形（用于精确计算边界）
    /**
     * 读取面板当前尺寸与可见矩形（用于精确计算边界）。
     * @param {Element} root - 面板根元素
     * @returns {{el:Element,rect:DOMRect,w:number,h:number}} 拖拽层元素、视口矩形及宽高
     */
    function getPanelRect(root) {
        const el = findDraggableNode(root) || root;
        const r = el.getBoundingClientRect();
        return { el: el, rect: r, w: r.width, h: r.height };
    }
    // 计算当前点 -> 裁剪到视口内 -> 保存；若越界则同时把拖拽层 transform 拉回边界，
    // 确保「视觉上」也始终留在可视范围（不止是存档安全）。
    /**
     * 计算当前面板坐标，裁剪到视口内后保存；若越界则同步把拖拽层 transform 拉回边界。
     * @param {Element} root - 面板根元素
     * @returns {{x:number,y:number}} 约束并保存后的坐标
     */
    function persistAndClamp(root) {
        const info = getPanelRect(root);
        const pt = { x: info.rect.left, y: info.rect.top };
        const clamped = clampPoint(pt, { w: info.w, h: info.h });
        if (clamped.x !== pt.x || clamped.y !== pt.y) {
            const dx = clamped.x - pt.x;
            const dy = clamped.y - pt.y;
            const el = info.el;
            const t = el.style.transform || '';
            const m = /translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/.exec(t);
            if (m) {
                const nx = (parseFloat(m[1]) + dx).toFixed(1);
                const ny = (parseFloat(m[2]) + dy).toFixed(1);
                el.style.transform = t.replace(/translate\([^)]*\)/, 'translate(' + nx + 'px, ' + ny + 'px)');
            }
            else if (t.indexOf('translate') === -1) {
                el.style.transform = (t ? t + ' ' : '') + 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
            }
        }
        (0, storage_1.savePanelPoint)(clamped);
        return clamped;
    }
    /**
     * 对面板根元素安装位置跟踪：用 MutationObserver 监听 style 变化 + mousedown/move/up 双保险，实时裁剪并保存位置。
     * @param {Element} root - 面板根元素
     * @returns {void}
     */
    function applyTracking(root) {
        // 监听整棵子树的 style 变化（transform 可能加在任意内部层）
        const observer = new MutationObserver(() => {
            const pt = persistAndClamp(root);
            if (PDBG)
                console.log('[面板位置] 检测到移动，保存坐标:', pt);
        });
        observer.observe(root, { attributes: true, attributeFilter: ['style'], subtree: true });
        // 双保险：拖拽过程（mousedown→mousemove→mouseup）中实时裁剪并保存最终位置
        root.addEventListener('mousedown', () => {
            const onMove = () => persistAndClamp(root);
            // mouseup 以 once 注册：无论鼠标是否在面板内释放都会自动解绑，避免监听器残留
            const onUp = () => {
                persistAndClamp(root);
                document.removeEventListener('mousemove', onMove);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp, { once: true });
        });
        // 页面卸载时统一清理：断开 MutationObserver、移除 resize 监听，避免监听器残留
        window.addEventListener('beforeunload', () => {
            try {
                observer.disconnect();
            }
            catch (e) {
                /* 忽略已断开的情况 */
            }
            if (resizeHandler) {
                window.removeEventListener('resize', resizeHandler);
                resizeHandler = null;
            }
        }, { once: true });
    }
    let tries = 0;
    const timer = setInterval(() => {
        tries++;
        const root = findPanelRoot();
        if (root) {
            clearInterval(timer);
            // 加载即裁剪：若存档位置（或默认位置）已越界，立即拉回并写回根容器 left/top
            const info = getPanelRect(root);
            const clamped = clampPoint({ x: info.rect.left, y: info.rect.top }, { w: info.w, h: info.h });
            root.style.left = Math.round(clamped.x) + 'px';
            root.style.top = Math.round(clamped.y) + 'px';
            (0, storage_1.savePanelPoint)(clamped);
            if (PDBG)
                console.log('[面板位置] 已定位面板(Shadow DOM)，初始坐标:', clamped);
            applyTracking(root);
            // 视口尺寸变化时重新裁剪，防止面板被挤出可视范围（保存句柄以便卸载时移除）
            resizeHandler = () => persistAndClamp(root);
            window.addEventListener('resize', resizeHandler);
        }
        else if (tries > 80) {
            clearInterval(timer);
            if (PDBG)
                console.warn('[面板位置] 未找到面板(已尝试穿透 Shadow DOM)，放弃位置跟踪');
        }
    }, 150);
}
exports.setupPanelPositionTracking = setupPanelPositionTracking;


/***/ },

/***/ 973
(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;

__webpack_unused_export__ = ({ value: true });
exports.hhmmToHours = exports.hoursToHHmm = exports.safeDecodeURIComponent = exports.escapeHtml = exports.resolveGithubUrl = void 0;
const state_1 = __webpack_require__(989);
/**
 * 工具函数：GitHub 链接解析 / HTML 转义 / URL 安全解码 / 十进制小时与 HH:mm 互转。
 * 模块化 P1：逐字迁移，仅加 export。
 */
// ==========工具函数==========
/**
 * 将 GitHub 文件链接按需转换为 jsDelivr CDN 链接（或原始 GitHub 链接）。
 *
 * 转换规则：
 * - 开启 CDN（useCdn=true）：输出 `https://cdn.jsdelivr.net/gh/用户名/仓库名@分支/文件路径`
 *   （分支可含斜杠，如 `refs/heads/main`，通过字符串变换直接把 `/blob/` 或仓库后的 `/` 替换为 `@`，
 *   无需拆分分支/路径，故天然支持多段分支）。
 * - 关闭 CDN（useCdn=false）：输出可直接访问的 GitHub 原始链接 `https://raw.githubusercontent.com/...`。
 * - 输入非 GitHub 链接（如已是 jsDelivr / npm CDN / 其他域名）：原样返回，不做转换。
 *
 * 支持的输入形式：
 *   1. `https://github.com/用户名/仓库名/blob/分支/文件路径`
 *   2. `https://raw.githubusercontent.com/用户名/仓库名/分支/文件路径`
 *
 * @param {string} githubUrl - GitHub 文件链接（函数唯一输入变量）
 * @returns {string} 解析后的资源链接（CDN 或原始 GitHub）
 */
function resolveGithubUrl(githubUrl) {
    const url = (githubUrl || '').trim();
    if (!url)
        return url;
    const useCdn = state_1.runtime.useCdn; // 读取运行时缓存（设置变更时由主面板写回）
    // 形式一：github.com 网页链接  https://github.com/用户/仓库/blob/分支/路径
    // （分支可含斜杠，如 refs/heads/main；用单次捕获 $3 兜住「分支/路径」整段，@ 插在仓库后）
    const ghBlob = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i;
    if (ghBlob.test(url)) {
        if (useCdn) {
            return url.replace(ghBlob, 'https://cdn.jsdelivr.net/gh/$1/$2@$3');
        }
        // 关闭 CDN：转为可直接访问的原始链接
        return url.replace(ghBlob, 'https://raw.githubusercontent.com/$1/$2/$3');
    }
    // 形式二：raw.githubusercontent.com 原始链接  https://raw.githubusercontent.com/用户/仓库/分支/路径
    const raw = /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(.+)$/i;
    if (raw.test(url)) {
        if (useCdn) {
            return url.replace(raw, 'https://cdn.jsdelivr.net/gh/$1/$2@$3');
        }
        return url; // 已是原始链接，原样返回
    }
    // 非 GitHub 链接（如已是 jsDelivr / npm CDN / 其他域名）：原样返回，不做转换
    return url;
}
exports.resolveGithubUrl = resolveGithubUrl;
// HTML 转义函数（复用单个 div 元素，避免重复创建）
const _escapeHelper = document.createElement('div');
/**
 * 对文本做 HTML 转义，防止常用语内容中的特殊字符破坏页面结构。复用单个隐藏 div 元素，避免重复创建。
 * @param {string} text - 待转义文本
 * @returns {string} 转义后的 HTML 安全字符串
 */
function escapeHtml(text) {
    _escapeHelper.textContent = text;
    return _escapeHelper.innerHTML;
}
exports.escapeHtml = escapeHtml;
// URL 解码的安全版：地址含游离 %（用户误填/粘贴截断的百分号编码）时 decodeURIComponent 会抛 URIError，
// 渲染路径上直接抛会崩掉整个抽屉；解码失败回退原字符串。
/**
 * 安全解码 URL（用于展示）：decodeURIComponent 失败时返回原串，绝不抛出。
 * @param {string} url - 待解码 URL
 * @returns {string} 解码后字符串；解码失败返回原串
 */
function safeDecodeURIComponent(url) {
    try {
        return decodeURIComponent(url);
    }
    catch (e) {
        return url;
    }
}
exports.safeDecodeURIComponent = safeDecodeURIComponent;
// 十进制小时(如 13.5) 与 "HH:mm" 字符串互转，供时间选择器使用
/**
 * 将十进制小时（如 13.5）转换为 "HH:mm" 字符串，供时间选择器显示。
 * 非法输入或越界值会被收敛到 [00:00, 24:00]。
 * @param {number} h - 十进制小时
 * @returns {string} "HH:mm" 格式字符串
 */
function hoursToHHmm(h) {
    if (typeof h !== 'number' || isNaN(h))
        return '00:00';
    let total = Math.round(h * 60);
    if (total < 0)
        total = 0;
    if (total > 24 * 60)
        total = 24 * 60;
    const H = Math.floor(total / 60) % 24;
    const M = total % 60;
    return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0');
}
exports.hoursToHHmm = hoursToHHmm;
/**
 * 将 "HH:mm" 字符串解析为十进制小时（如 "13:30" -> 13.5），供时间选择器回写。
 * 格式非法或数值越界时返回 null。
 * @param {string} str - "HH:mm" 格式字符串
 * @returns {(number|null)} 成功返回十进制小时，失败返回 null
 */
function hhmmToHours(str) {
    if (typeof str !== 'string')
        return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
    if (!m)
        return null;
    const H = parseInt(m[1], 10);
    const M = parseInt(m[2], 10);
    if (H < 0 || H > 23 || M < 0 || M > 59)
        return null;
    return H + M / 60;
}
exports.hhmmToHours = hhmmToHours;


/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	const __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		const cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		const module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	let __webpack_exports__ = __webpack_require__(156);
/******/ 	
/******/ })()
;