/**
 * 「图片嗅探」后台预测量（v26.10.14-v4，用户指定：测量也要在开窗之前跑）。
 *
 * 解决什么问题：嗅探一直坚持「开窗才测量」（先零成本列出候选，再对没进过资源表的图发 HEAD/Range）。
 * v26.10.14-v2 的 perf 预收把**同源 / 可读资源表**的图变成了零成本，但**跨域且响应没有
 * Timing-Allow-Origin 的图**仍要等开窗后才逐张 HEAD —— 用户开窗后看到的「正在测量大小…」
 * 进度条就是这么来的。本模块把那一遍测量**提前到后台**：脚本启动后先等首屏稳定，再按固定
 * 间隔把页面上的图量一遍，结论记进 `snifferCache`；用户开窗时 SniffModal 照旧重扫（候选必须重收，
 * 页面随时在变），但每张图只要上次量过就直接用缓存 ⇒ 开窗即时出大小，不再等网络。
 *
 * ⚠️ 代价（用户已知情拍板）：**不开窗也会向页面图片服务器发请求**。故下面四个安全阀不可删：
 *   ① 零成本项优先：资源表已给字节数的图 / `data:` / 内联 svg / `blob:`（页面内 fetch，不出网）
 *      —— 这批一个请求都不发，绝大多数同源图都落在这里；
 *   ② 单轮**网络测量**张数上限 PRE_MAX_NET_PER_ROUND，超出的顺延到下一轮（把请求摊到时间上，
 *      绝不瞬间打爆）；
 *   ③ 并发只有 PRE_CONCURRENCY，远低于开窗时的 5：后台任务不许抢用户的带宽；
 *   ④ 后台收集的 CSS 遍历上限收到 PRE_CSS_LIMIT（开窗时是 3000）：getComputedStyle 是主线程开销，
 *      后台每轮都全量扫会给页面添卡顿；扫不到的图开窗那次照扫不误，不会丢。
 *   另有总开关：设置项 `sniffPreMeasure`（默认开），关掉即彻底不跑（见 setPreMeasureEnabled）。
 *
 * 与 perf 预收的分工（两者互补，别混）：`snifferPerf.ts` **只读 performance、零请求**，从脚本
 * 第一行就在收，负责「本来就免费的字节数」；本模块专治**perf 拿不到**的那部分图，是唯一会发
 * 后台请求的地方。两者最终写进同一个缓存，开窗时一视同仁。
 *
 * 失败不重试：测量失败的图也会带 `size: null` 进缓存（见 snifferCache），于是同一个 URL
 * 在本次页面会话里只会被后台尝试一次 —— 这是防「每轮 60s 反复捶一个挂掉的地址」的关键。
 *
 * 幂等 / 不可重入：`setPreMeasureEnabled` 重复调用无副作用；单轮用 running 标志挡住重入。
 */

import { collectCandidates, resolveSizes, type SniffCandidate } from './sniffer';
import { measuredOf } from './snifferCache';
import { SNIFF_EXCLUDE_SELECTOR } from './ui/sniffSelector';

/** 首次测量延时（毫秒）：等首屏图片先加载完，别在页面最忙的时候抢带宽 */
export const PRE_INITIAL_DELAY = 5000;
/** 之后每轮间隔（毫秒）：页面会陆续长出新图，低频兜住即可 */
export const PRE_INTERVAL = 60000;
/** 后台测量并发：远低于开窗时的 5 */
export const PRE_CONCURRENCY = 2;
/** 单轮「要发网络请求」的张数上限，超出的留到下一轮 */
export const PRE_MAX_NET_PER_ROUND = 60;
/** 后台收集时 getComputedStyle 的遍历元素数上限（开窗那次仍是 CSS_SCAN_LIMIT=3000） */
export const PRE_CSS_LIMIT = 1200;

/** 是否启用（由设置项驱动） */
let enabled = false;
/** 下一轮的定时器句柄 */
let timer: number | null = null;
/** 单轮不可重入 */
let running = false;
/** 已跑轮数（调试 / 冒烟用） */
let rounds = 0;

/** 排下一轮（已在排队 / 未启用时不重排） */
function schedule(delay: number): void {
    if (!enabled || timer !== null) return;
    timer = window.setTimeout(() => {
        timer = null;
        void runRound();
    }, delay);
}

/** 这张图测量要不要发网络请求？false = 纯本地 / 资源表读数，零成本 */
function isZeroCost(it: SniffCandidate): boolean {
    if (it.kind !== 'http') return true; // data: / svg / blob:（blob 走页面上下文 fetch，不出网）
    return !!(it.perfBytes && it.perfBytes > 0);
}

/** 跑一轮：收集（零网络）→ 只测没测过的 → 结论自动进缓存（由 resolveSizes 写） */
async function runRound(): Promise<void> {
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
        /* 静默：后台任务绝不许把异常抛进主流程，也不写日志刷屏 */
    } finally {
        running = false;
        if (enabled) schedule(PRE_INTERVAL);
    }
}

/**
 * 开关后台预测量。开 ⇒ 5 秒后跑第一轮，之后每 60 秒一轮；关 ⇒ 清掉待跑的定时器
 * （**已经在飞的那一轮不打断**：请求已经发出去了，拦下来也不会省下什么，让它跑完即可）。
 */
export function setPreMeasureEnabled(v: boolean): void {
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

/** 当前状态（调试 / 冒烟用） */
export function preMeasureStatus(): { enabled: boolean; running: boolean; rounds: number } {
    return { enabled: enabled, running: running, rounds: rounds };
}
