/**
 * 长轮询重试的指数退避（轮询优化 P5，v26.10.14-v8）。
 *
 * 为什么要退避：旧实现是「出错后固定 2 秒重试」。服务器重启 / 网络抖动时，**所有**客户端会
 * 以同一节奏反复敲门，形成雪崩（thundering herd）—— 服务端刚起来就被打回原形。改成指数
 * 退避后，各客户端的重试时刻自然错开，服务恢复时压力是平缓涨上来的。
 *
 * 语义（两端一致，脚本端 `src/lib/relay.ts` 与客户端 `web/src/lib/relay.ts` 共用）：
 *  - 首次失败等 2s，此后每失败一次翻倍：2 → 4 → 8 → 16 → 32 → 60（到顶后保持，不再增长）；
 *  - 任意一次**成功**响应后立刻复位 ⇒ 下一次失败重新从 2s 起（抖一下就恢复，不会长期迟钝）；
 *  - HTTP 429（服务端明确要求「慢点」）直接跳到上限 60s，不在 2/4/8 这些档位上空磨。
 *
 * 纯函数、无状态：当前退避值由调用方自己持有，本模块只回答「下一次该等多久」。
 * 之所以做成共用模块而不是各写一份：两端原本就是同一套重试语义，分头写迟早会漂移。
 */

/** 首次失败后的等待时长（ms） */
export const RETRY_BASE_MS = 2000;
/** 退避上限（ms）—— 到顶后保持，不再翻倍 */
export const RETRY_MAX_MS = 60000;

/**
 * 计算下一次重试的等待时长。
 * @param prevMs 上一次的退避值；0 / 非有限值 / 负数一律视为「上一轮是成功的」⇒ 从基准重新起算
 * @param httpStatus HTTP 状态码（可选）。用于识别 429 这类「服务端已明说别这么快」的响应
 * @returns 下一次重试的等待毫秒数
 */
export function nextRetryDelay(prevMs: number, httpStatus?: number): number {
    // 429 Too Many Requests：服务端已经明说「别这么快」，直接从上限起退
    if (httpStatus === 429) return RETRY_MAX_MS;
    const prev = typeof prevMs === 'number' && isFinite(prevMs) && prevMs > 0 ? prevMs : 0;
    if (!prev) return RETRY_BASE_MS;
    return Math.min(prev * 2, RETRY_MAX_MS);
}
