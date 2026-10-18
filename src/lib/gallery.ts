/**
 * 收件相关的纯工具（v26.10.06-v13 建，v26.10.12-v1 起只剩文件命名）。
 *
 * 沿革：「历史记录」弹窗（图片 + 文本画廊）在「设备互联 → 传输助手」重构中被
 * 传输助手第三栏的「文件」分组（`ui/transfer/TransferFilesView.tsx`）取代，
 * 数据类型也换成了 `lib/transfer/types.ts` 的 `TransferMessage`（按会话组织），
 * 故本文件里的 GalleryImage / GalleryText / MAX_GALLERY / MAX_TEXT 已全部删除。
 *
 * 保留的只有 `downloadFileName`：下载 / 打印的命名规则（优先原始名、无扩展名按
 * MIME 补、兜底 znhd-image-N）被传输助手与图片嗅探共用，不再有「画廊序号」语义，
 * 参数 idx 仅作兜底编号。
 */

/**
 * 计算下载用的文件名：优先用原始名；无扩展名时按 MIME 补。
 * @param {string} name - 原始文件名（可空）
 * @param {string} mime - MIME 类型
 * @param {number} idx - 兜底命名用的序号
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
