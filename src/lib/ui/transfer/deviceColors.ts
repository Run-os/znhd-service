/**
 * 设备 ID 的专属配色（v26.10.08-v12 随 PhoneModal 建立；v26.10.12-v1 随「设备互联」
 * 重构为「传输助手」搬到本文件，逻辑逐字不变）。
 *
 * 按用户要求：给设备 ID 加边框和彩色底色，不同设备不同色。
 *
 * ⚠️ 用**固定色板 + 哈希取模**，而不是「由 ID 算 HSL」：后者在哈希相邻时会算出几乎一样的色相，
 *    多台手机并排时反而分不清。色板取 antd 预设色阶的「浅底 / 中边框 / 深字」三档（1 / 3 / 7 号色），
 *    保证浅色主题下文字对比度足够，也与面板整体配色语言一致。
 */

/** 同一 ID 恒定取到同一个颜色（跨会话稳定）；不同 ID 尽量落到不同颜色 */
export const DEVICE_COLORS = [
    { bg: '#e6f4ff', border: '#91caff', color: '#0958d9' }, // 蓝
    { bg: '#e6fffb', border: '#87e8de', color: '#08979c' }, // 青
    { bg: '#f6ffed', border: '#b7eb8f', color: '#389e0d' }, // 绿
    { bg: '#fffbe6', border: '#ffe58f', color: '#d48806' }, // 黄
    { bg: '#fff7e6', border: '#ffd591', color: '#d46b08' }, // 橙
    { bg: '#fff1f0', border: '#ffa39e', color: '#cf1322' }, // 红
    { bg: '#f9f0ff', border: '#d3adf7', color: '#531dab' }, // 紫
    { bg: '#fff0f6', border: '#ffadd2', color: '#c41d7f' }, // 洋红
];

export function hashDeviceId(id: string): number {
    // FNV-1a（32 位）：对「只差一个字符」的 ID 也敏感。
    // ⚠️ 别退回 `h = h * 31 + c`：实测两个只差首字符的 ID 会被 `>>>0` 截断成同一个下标，
    //    导致「不同设备不同底色」失效（本功能第一版就踩了）。
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/**
 * 为一个**列表**解析「ID → 色板下标」，并把撞色的往后顺延。
 *
 * 为什么不能只用哈希：哈希再好也可能撞（实测「前缀重复字符」的 ID 会整批落到同一色），
 * 而用户要的是「不同设备 ID 不同底色」。故在列表内做贪心分配 ——
 * 设备数 ≤ 色板数（8）时**一定能拿到互不相同的颜色**。
 * 先按哈希排序再分配：谁拿哪个色只取决于 ID 集合，与数组顺序无关。
 */
export function resolveDeviceColors(ids: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    const used = new Set<number>();
    const ordered = ids
        .filter(Boolean)
        .slice()
        .sort((a, b) => hashDeviceId(a) - hashDeviceId(b) || (a < b ? -1 : 1));
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

/** 手机 ID 的展示用短串（UUID 太长，取前 8 位） */
export function shortPhoneId(id: string): string {
    if (!id) return '未知设备（旧版中继）';
    return id.length > 8 ? id.slice(0, 8) + '…' : id;
}
