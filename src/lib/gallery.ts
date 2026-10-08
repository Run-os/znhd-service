/**
 * 「历史记录」的数据与纯工具（v26.10.06-v13 建，v26.10.08-v3 起同时承载文本记录）。
 *
 * 渲染层已整体改为 React + Ant Design（见 `ui/RecvHistoryModal.tsx`），
 * 本文件**不再有任何 DOM 操作**，也**不再依赖 Viewer.js** —— 图片放大统一交给
 * antd `Image.PreviewGroup`（多图左右切换、缩放、旋转都自带），故 Viewer 的
 * `@require` / `@resource` 已从脚本元信息里移除。
 *
 * 这里只保留：图片/文本条目的类型 + 上限常量 + 文件命名工具。列表状态由主面板（React state）持有。
 */

/** 画廊中的一张图（previewUrl 是 objectURL，移除/淘汰时必须 revoke） */
export interface GalleryImage {
    blob: Blob;
    previewUrl: string;
    name?: string;
    mime?: string;
    ts?: number;
}

/**
 * 历史记录里的一条文本（v26.10.08-v3）。
 *
 * ⚠️ 与「收到文本就自动弹出的 `RecvTextModal`」是两回事：那个只保留**最新一条**（同屏替换），
 * 这里的数组才是可回看的历史；两条路径互不影响。
 */
export interface GalleryText {
    /** 文本内容（去掉尾部空白后的原文） */
    text: string;
    /** 收到时间（毫秒时间戳） */
    ts: number;
}

/** 画廊最多保留张数，超出丢最旧（并释放其 objectURL） */
export const MAX_GALLERY = 27;

/** 历史记录最多保留的文本条数，超出丢最旧（文本是小字符串，上限比图片宽松） */
export const MAX_TEXT = 100;

/**
 * 计算下载用的文件名：优先用原始名；无扩展名时按 MIME 补。
 * @param {string} name - 原始文件名（可空）
 * @param {string} mime - MIME 类型
 * @param {number} idx - 画廊序号（用于兜底命名）
 * @returns {string} 带扩展名的文件名
 */
export function downloadFileName(name?: string | null, mime?: string | null, idx = 0): string {
    const extByMime: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'image/bmp': '.bmp',
    };
    let n = String(name || '').trim();
    if (!n) n = 'znhd-image-' + (idx + 1);
    if (!/\.[a-z0-9]{2,5}$/i.test(n)) n += extByMime[(mime || '').toLowerCase()] || '.jpg';
    return n;
}
