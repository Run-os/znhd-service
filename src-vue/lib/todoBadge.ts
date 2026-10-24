/**
 * 「待处理留言 / 待处理预约」红色提醒（v26.10.24-v1）。
 *
 * 需求（使用者 2026-10-24 定版 + 真机校正）：页面上存在待办时，用**红底白字的
 * 数字胶囊 + 呼吸动画**提醒（≈ Tailwind `animate-pulse`），首次出现再叠一圈
 * `animate-ping` 式扩散（微信未读红点心智）。
 *
 * ── 真机 DOM（2026-10-24 用 browser-use 在本地 Edge 实测）────────────────────
 *   <div class="message-item">        ← 工作台左侧待办卡片
 *     <div class="count">2</div>      ← 数量，零时也占位（显示 0）
 *     <div class="title">待处理留言</div>
 *   </div>
 * 踩过的坑（第一版被真机否掉）：
 *   · 只在标题旁加「待」字 badge —— 与卡片本来就有的红色数字**重复**，观感多余；
 *   · **0 不该提醒**：待处理预约=0 时还闪，等于天天误报。
 * ⇒ 最终形态：把 `.count` 里那个数字本身胶囊化（红底白字 + 呼吸），只有 `> 0` 才加；
 *   归零后自动撤掉（坐席处理完待办就该安静下来）。
 *
 * ── 为什么不用 Tailwind 的 animate-pulse 类 ──────────────────────────────────
 * 注入的是**站点页面的 light DOM**，不是我们自己的 Shadow DOM —— 站点没加载
 * Tailwind，类名不生效。自带 `<style>`（keyframes 前缀 znhdTodo 防冲突），
 * 视觉等价 animate-pulse / animate-ping。
 *
 * ── 扫描策略（低配实机友好）──────────────────────────────────────────────────
 * · 识别靠 **XPath 原生匹配**（`document.evaluate`，C++ 实现，比 JS 全页遍历便宜）；
 * · MutationObserver + 300ms 防抖兜新渲染与数字变化（`characterData` 也要听，
 *   站点是 Vue 就地改文本，不会重建节点）；
 * · pointer-events:none 的纯展示层，绝不挡点击。
 */

const STYLE_ID = '__znhd_todo_badge_style__';
/** 命中过的标题打标记（便于归零时精确回收） */
const MARK = 'data-znhd-todo';
const HIT_CLASS = 'znhd-todo-hit';
const PING_CLASS = 'znhd-todo-ping';
const COUNT_MARK = 'data-znhd-todo-count';

/** 源文字关键词：出现其一就检查对应的数量 */
const KEYWORDS = ['待处理留言', '待处理预约'];

/** 呼吸 1s 缓慢明暗（比 animate-pulse 的 2s 更醒目，但仍不刺眼） */
const CSS = [
    '@keyframes znhdTodoPulse{0%,100%{opacity:1}50%{opacity:.5}}',
    '@keyframes znhdTodoPing{0%{transform:scale(1);opacity:.5}75%,100%{transform:scale(2.4);opacity:0}}',
    // !important 是必须的：站点的 scoped 样式（`.count[data-v-xxx]`）特异性更高，
    // 不强行覆盖就只变底色不变字色/尺寸。
    '.' + HIT_CLASS + '{position:relative;display:inline-block!important;padding:0 7px!important;' +
        'min-width:18px;height:18px!important;line-height:18px!important;border-radius:9px!important;' +
        'background-color:#e5484d!important;color:#fff!important;font-size:12px!important;' +
        'font-weight:700!important;text-align:center;' +
        'animation:znhdTodoPulse 1s ease-in-out infinite!important;}',
    '.' + PING_CLASS + '{position:absolute;inset:0;border-radius:9px;background-color:#e5484d;' +
        'pointer-events:none;animation:znhdTodoPing 1.2s cubic-bezier(0,0,.2,1) 1 both;}',
].join('\n');

let started = false;
let observer: MutationObserver | null = null;
let scanTimer: number | null = null;

function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

function countOf(card: Element | null): number {
    const el = card?.querySelector('.count');
    if (!el) return 0;
    return parseInt((el.textContent || '0').trim(), 10) || 0;
}

/** 给一个卡片的 count 套上胶囊 + 扩散圈（幂等） */
function decorate(card: Element): void {
    const count = card.querySelector('.count');
    if (!count || count.classList.contains(HIT_CLASS)) return;
    count.classList.add(HIT_CLASS);
    count.setAttribute(COUNT_MARK, '');
    const ping = document.createElement('span');
    ping.className = PING_CLASS;
    count.appendChild(ping);
}

/** 撤掉提醒（待办清空 / 卡片销毁时） */
function undecorate(count: Element | null): void {
    if (!count) return;
    count.classList.remove(HIT_CLASS);
    count.removeAttribute(COUNT_MARK);
    count.querySelectorAll('.' + PING_CLASS).forEach((p) => p.remove());
}

/**
 * 一次同步：
 *   ① 已命中但数量归零的撤掉；
 *   ② 新命中的标上。
 * 两件事都做，才不会出现「处理完了红点还在」。
 */
function scan(): void {
    ensureStyle();

    // ① 先回收（数量被站点就地改成 0/空 的情况）
    document.querySelectorAll('[' + MARK + ']').forEach((title) => {
        const card = title.closest('.message-item');
        if (card && countOf(card) > 0) return;
        undecorate(card ? card.querySelector('.count') : (title.parentElement?.querySelector('.count') ?? null));
        title.removeAttribute(MARK);
    });

    // ② 再补新命中
    for (const keyword of KEYWORDS) {
        const xpath = '//div[contains(@class,"title")][contains(., "' + keyword + '")]';
        const result = document.evaluate(xpath, document.body, null, XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) {
            const title = result.snapshotItem(i) as Element | null;
            if (!title || title.hasAttribute(MARK)) continue;
            const card = title.closest('.message-item');
            if (!card || countOf(card) <= 0) continue;
            decorate(card);
            title.setAttribute(MARK, '');
        }
    }
}

/** DOM 变化防抖后重扫（数字变化走文本节点，characterData 必须听） */
function scheduleScan(): void {
    if (scanTimer !== null) return;
    scanTimer = window.setTimeout(() => {
        scanTimer = null;
        try {
            scan();
        } catch (e) {
            console.warn('[待办提醒] 注入失败:', e);
        }
    }, 300);
}

export function startTodoBadge(): void {
    if (started) return;
    started = true;
    scan();
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function stopTodoBadge(): void {
    if (!started) return;
    started = false;
    observer?.disconnect();
    observer = null;
    if (scanTimer !== null) {
        window.clearTimeout(scanTimer);
        scanTimer = null;
    }
}
