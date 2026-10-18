/**
 * 更新日志：按当前年月动态定位 changelogs/ 目录下的当月日志文件 → 解析成条目。
 * （v26.10.06-v13 起渲染层交给 antd Modal；自日志迁移到「changelogs/ 按月分文件」后，
 *  数据源从固定的根 CHANGELOG.md 改为运行时按当前年月拼 `changelogs/YYYY-MM.md`。）
 *
 * 变化：原实现自己拼 DOM 弹窗（fixed 全屏 overlay + 白盒 + × + ESC + z-index 拉满，为对抗
 * 税务页的 CSS/transform 污染）。现在统一用 antd（见 `ui/ChangelogModal.tsx`）：
 * 弹窗挂在 `documentElement` 下、主题与其余弹窗一致，隔离问题由 `ui/uiReset.ts` 统一兜。
 * 本文件只保留**纯逻辑**（解析 / 拉取 / 会话缓存），无任何 DOM 操作。
 */

import { addLog } from '@/lib/logger';
import { resolveGithubUrl } from '@/lib/utils';

/** 当前年月的 `YYYY-MM`（changelogs/ 目录下当月日志文件的命名） */
function currentMonth(): string {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return d.getFullYear() + '-' + mm;
}

/** 当月日志文件数据源（raw 原始直链形式；resolveGithubUrl 会按 useCdn 决定是否走 CDN 镜像） */
export function getChangelogRawUrl(): string {
    return 'https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/changelogs/' + currentMonth() + '.md';
}

/** 「获取更多日志」按钮跳转的当月日志文件网页地址 */
export function getChangelogPageUrl(): string {
    return 'https://github.com/Run-os/znhd-service/blob/main/changelogs/' + currentMonth() + '.md';
}

/** 弹窗默认展示的条数 */
export const CHANGELOG_DEFAULT_LIMIT = 10;

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
    // 用「标题 + 正文行」两个独立变量，而不是 {title,lines}|null 对象：后者在闭包里会被
    // TS 的控制流分析收窄成 never，改写成 for 循环更直白
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
export function mdToPlain(md: string): string {
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

/** 本次会话内的日志缓存（同一次浏览里重复打开弹窗不再发请求） */
let _changelogCache: ChangelogEntry[] | null = null;

/**
 * 拉取并解析当月的日志文件（changelogs/YYYY-MM.md；命中会话缓存则直接回调，不发请求）。
 * @param {(entries: ChangelogEntry[]|null, errMsg?: string) => void} done - 完成回调；失败时 entries 为 null
 * @returns {void}
 */
export function loadChangelog(done: (entries: ChangelogEntry[] | null, errMsg?: string) => void): void {
    if (_changelogCache) {
        done(_changelogCache);
        return;
    }
    GM_xmlhttpRequest({
        method: 'GET',
        url: resolveGithubUrl(getChangelogRawUrl()),
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
        onerror: function (error: unknown) {
            // GM_xmlhttpRequest 的错误参数形态不定（对象 / 字符串），故按需取值而非断言类型
            const err = (error || {}) as { message?: string };
            const errMsg = err.message ? err.message : typeof error === 'string' ? error : '网络错误';
            addLog('更新日志加载失败: ' + errMsg, 'error', true);
            done(null, errMsg);
        },
        ontimeout: function () {
            addLog('更新日志加载超时（15s），已取消', 'error', true);
            done(null, '请求超时（15s）');
        },
    });
}
