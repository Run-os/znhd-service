import { runtime } from '@/lib/state';

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
export function resolveGithubUrl(githubUrl: string): string {
    const url = (githubUrl || '').trim();
    if (!url) return url;
    const useCdn = runtime.useCdn; // 读取运行时缓存（设置变更时由主面板写回）

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

// HTML 转义函数（复用单个 div 元素，避免重复创建）
const _escapeHelper = document.createElement('div');
/**
 * 对文本做 HTML 转义，防止常用语内容中的特殊字符破坏页面结构。复用单个隐藏 div 元素，避免重复创建。
 * @param {string} text - 待转义文本
 * @returns {string} 转义后的 HTML 安全字符串
 */
export function escapeHtml(text: string): string {
    _escapeHelper.textContent = text;
    return _escapeHelper.innerHTML;
}

// URL 解码的安全版：地址含游离 %（用户误填/粘贴截断的百分号编码）时 decodeURIComponent 会抛 URIError，
// 渲染路径上直接抛会崩掉整个抽屉；解码失败回退原字符串。
/**
 * 安全解码 URL（用于展示）：decodeURIComponent 失败时返回原串，绝不抛出。
 * @param {string} url - 待解码 URL
 * @returns {string} 解码后字符串；解码失败返回原串
 */
export function safeDecodeURIComponent(url: string): string {
    try {
        return decodeURIComponent(url);
    } catch (e) {
        return url;
    }
}

// 十进制小时(如 13.5) 与 "HH:mm" 字符串互转，供时间选择器使用
/**
 * 将十进制小时（如 13.5）转换为 "HH:mm" 字符串，供时间选择器显示。
 * 非法输入或越界值会被收敛到 [00:00, 24:00]。
 * @param {number} h - 十进制小时
 * @returns {string} "HH:mm" 格式字符串
 */
export function hoursToHHmm(h: number): string {
    if (typeof h !== 'number' || isNaN(h)) return '00:00';
    let total = Math.round(h * 60);
    if (total < 0) total = 0;
    if (total > 24 * 60) total = 24 * 60;
    const H = Math.floor(total / 60) % 24;
    const M = total % 60;
    return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0');
}
/**
 * 将 "HH:mm" 字符串解析为十进制小时（如 "13:30" -> 13.5），供时间选择器回写。
 * 格式非法或数值越界时返回 null。
 * @param {string} str - "HH:mm" 格式字符串
 * @returns {(number|null)} 成功返回十进制小时，失败返回 null
 */
export function hhmmToHours(str: string): number | null {
    if (typeof str !== 'string') return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
    if (!m) return null;
    const H = parseInt(m[1], 10);
    const M = parseInt(m[2], 10);
    if (H < 0 || H > 23 || M < 0 || M > 59) return null;
    return H + M / 60;
}
