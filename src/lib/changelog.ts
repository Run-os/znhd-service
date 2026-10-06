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

import { addLog } from '@/lib/logger';
import { resolveGithubUrl } from '@/lib/utils';

/** CHANGELOG 数据源（raw 原始直链形式；resolveGithubUrl 会按 useCdn 决定是否转 jsDelivr） */
export const CHANGELOG_RAW_URL = 'https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/CHANGELOG.md';

/** 「获取更多日志」按钮跳转的网页地址 */
export const CHANGELOG_PAGE_URL = 'https://github.com/Run-os/znhd-service/blob/main/CHANGELOG.md';

/** 弹窗默认展示的条数 */
export const CHANGELOG_DEFAULT_LIMIT = 10;

/** 弹窗根节点 id（同时作为 ESC 关闭的判定依据） */
const CHANGELOG_POPUP_ID = '__znhd_changelog_popup__';

/** 单条更新日志 */
export interface ChangelogEntry {
    /** 条目标题，如 `znhd.user.js v26.10.6-v1`（已去掉 `### ` 前缀） */
    title: string;
    /** 条目正文（原始 markdown，渲染时转为易读纯文本） */
    body: string;
}

/**
 * 把 CHANGELOG.md 文本解析成条目数组。
 * 以 `### ` 开头的行为条目分隔，文件顺序即展示顺序（约定最新在最前），`##` 级标题与前言自动忽略。
 * @param {string} md - CHANGELOG.md 全文
 * @returns {ChangelogEntry[]} 条目数组；没有任何 `### ` 标题时返回空数组
 */
export function parseChangelog(md: string): ChangelogEntry[] {
    const entries: ChangelogEntry[] = [];
    const lines = String(md || '').split(/\r?\n/);
    // 用「标题 + 正文行」两个独立变量，而不是 {title,lines}|null 对象：后者在 forEach 闭包里会被
    // TS 的控制流分析收窄成 never（闭包内对 let 变量的赋值不被追踪），改写成 for 循环更直白
    let curTitle: string | null = null;
    let curLines: string[] = [];
    for (const line of lines) {
        const m = /^###\s+(.+?)\s*$/.exec(line);
        if (m) {
            if (curTitle !== null) entries.push({ title: curTitle, body: curLines.join('\n').trim() });
            curTitle = m[1];
            curLines = [];
            continue;
        }
        if (curTitle !== null) curLines.push(line);
    }
    if (curTitle !== null) entries.push({ title: curTitle, body: curLines.join('\n').trim() });
    return entries;
}

/**
 * markdown 正文 → 易读纯文本（不引第三方渲染器，只做最小变换，避免 XSS 面）：
 * `- `/`* ` 列表项换 `• `、去掉强调与行内代码标记、规整连续空行。
 * @param {string} md - 条目正文（markdown）
 * @returns {string} 便于在弹窗里 pre-wrap 展示的纯文本
 */
function mdToPlain(md: string): string {
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
let _changelogCache: ChangelogEntry[] | null = null;
/** ESC 监听只装一次（自保护） */
let _changelogEscInstalled = false;

/** 关闭更新日志弹窗（无弹窗时静默返回） */
function closeChangelogPopup() {
    const ex = document.getElementById(CHANGELOG_POPUP_ID);
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
}

/**
 * 安装全局 ESC 关闭（只装一次）。
 * gallery.ts 的同类监听只处理图片/文本弹窗，故此处独立安装，互不干扰。
 * @returns {void}
 */
function installEscHandler() {
    if (_changelogEscInstalled) return;
    _changelogEscInstalled = true;
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' && e.keyCode !== 27) return;
        if (document.getElementById(CHANGELOG_POPUP_ID)) closeChangelogPopup();
    });
}

/**
 * 拉取并解析 CHANGELOG.md（命中会话缓存则直接回调，不发请求）。
 * @param {(entries: ChangelogEntry[]|null, errMsg?: string) => void} done - 完成回调；失败时 entries 为 null
 * @returns {void}
 */
function loadChangelog(done: (entries: ChangelogEntry[] | null, errMsg?: string) => void) {
    if (_changelogCache) {
        done(_changelogCache);
        return;
    }
    GM_xmlhttpRequest({
        method: 'GET',
        url: resolveGithubUrl(CHANGELOG_RAW_URL),
        timeout: 15000, // raw.githubusercontent 在国内常被黑洞，必须给超时，否则弹窗永远停在「读取中」
        onload: function (response) {
            if (response.status !== 200) {
                const msg = '数据源返回 HTTP ' + response.status;
                addLog('更新日志加载失败: ' + msg, 'error', true);
                done(null, msg);
                return;
            }
            const entries = parseChangelog(response.responseText);
            if (!entries.length) {
                // 404 页面/错误页也可能是合法文本，必须校验解析结果，避免把垃圾当日志渲染
                const msg = '内容为空或格式不符（缺少 ### 标题）';
                addLog('更新日志加载失败: ' + msg, 'error', true);
                done(null, msg);
                return;
            }
            _changelogCache = entries;
            addLog('更新日志加载成功，共 ' + entries.length + ' 条', 'info');
            done(entries);
        },
        onerror: function (error: any) {
            const errMsg = error && error.message ? error.message : typeof error === 'string' ? error : '网络错误';
            addLog('更新日志加载失败: ' + errMsg, 'error', true);
            done(null, errMsg);
        },
        ontimeout: function () {
            addLog('更新日志加载超时（15s），已取消', 'error', true);
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
function renderEntries(content: HTMLElement, entries: ChangelogEntry[], hint: HTMLElement) {
    const show = entries.slice(0, CHANGELOG_DEFAULT_LIMIT);
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
function showLoading(content: HTMLElement, hint: HTMLElement) {
    content.textContent = '';
    const loading = document.createElement('div');
    loading.textContent = '读取中…';
    loading.style.cssText = 'font-size:14px!important;color:#999!important;padding:20px 0!important;';
    content.appendChild(loading);
    hint.textContent = '';
}

/** 显示失败提示（仍保留「获取更多日志」按钮可用） */
function showError(content: HTMLElement, hint: HTMLElement, errMsg: string) {
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
export function showChangelogPopup() {
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
    title.textContent = '更新日志（最新 ' + CHANGELOG_DEFAULT_LIMIT + ' 条）';
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
        window.open(CHANGELOG_PAGE_URL, '_blank');
    };

    overlay.onclick = (e) => {
        if (e.target === overlay) closeChangelogPopup();
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
        (b as HTMLButtonElement).tabIndex = -1;
        b.addEventListener('mousedown', function (e) {
            e.preventDefault();
        });
    });

    showLoading(content, hint);
    loadChangelog((entries, errMsg) => {
        // 弹窗可能已被关闭（用户等得不耐烦点了 × / ESC），此时丢弃结果，避免写进游离节点
        if (!document.getElementById(CHANGELOG_POPUP_ID)) return;
        if (!entries) {
            showError(content, hint, errMsg || '未知错误');
            return;
        }
        renderEntries(content, entries, hint);
    });
}
