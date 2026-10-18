/**
 * 「图片嗅探」已测尺寸的进程内缓存（v26.10.14-v4）。
 *
 * 为什么需要它：v26.10.14-v4 起后台会**在用户打开嗅探窗口之前**先把页面上的图量一遍
 * （见 `lib/snifferPre.ts`）。开窗那一刻 SniffModal 仍会重新收集候选 —— 页面随时在变，
 * 候选必须重扫 —— 但「这张图上次已经量过」这个结论可以复用：直接取缓存里的字节数，
 * 不再发 HEAD / Range。于是「开窗即有大小」不再受网络往返影响，后台那一遍的请求也不算白花。
 *
 * 写入口只有一处：`sniffer.ts` 的 `resolveSizes`（无论是后台预测量还是开窗扫描，测完都记进来）。
 *
 * 生命周期：**只活在本次页面会话里**（模块级 Map，不落盘）。理由同 `sniffConv` 只存映射不存 URL ——
 * 页面上的直链带签名会过期，存进 localStorage 下次打开就是一批失效地址；而尺寸本身也是跟着
 * 那一次资源加载走的，跨页复用价值低。上限 MAX_MEASURED，到顶淘汰最早一条（Map 保持插入序）。
 *
 * ⚠️ 本模块**不 import 任何运行时代码**：`SniffedImage` 是 type-only import（编译期即被擦除），
 * 否则 sniffer.ts ↔ snifferCache.ts 会成环。
 */

import type { SniffedImage } from './sniffer';

/** 缓存条数上限：防极端页面把内存吃爆（超出淘汰最早一条） */
export const MAX_MEASURED = 2000;

/** key（归一化 URL / 内联 SVG 的内容哈希）→ 已测结果 */
const measured = new Map<string, SniffedImage>();

/** 记一张已测的图（重复 key 覆盖：后测的那次更新） */
export function rememberMeasured(img: SniffedImage): void {
    if (!img || !img.key) return;
    if (!measured.has(img.key) && measured.size >= MAX_MEASURED) {
        const oldest = measured.keys().next();
        if (!oldest.done) measured.delete(oldest.value);
    }
    measured.set(img.key, img);
}

/** 查某张图是否已测过；没有返回 null（调用方走正常测量阶梯） */
export function measuredOf(key: string): SniffedImage | null {
    if (!key) return null;
    return measured.get(key) || null;
}

/** 已测条数（调试 / 冒烟用） */
export function measuredCount(): number {
    return measured.size;
}
