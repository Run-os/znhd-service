/**
 * 「待处理留言 / 待处理预约」红色提醒（v26.10.24-v1，真机校正两轮）。
 *
 * 需求（使用者 2026-10-24 定版）：页面上存在待办时用红色呼吸提醒，醒目但不刺眼。
 *
 * ── 真机 DOM（2026-10-24 用 browser-use 在本地 Edge 实测）────────────────────
 *   <div class="message-item">        ← 工作台左侧待办卡片
 *     <div class="count">2</div>      ← 数量，零时也占位（显示 0）
 *     <div class="title">待处理留言</div>
 *   </div>
 *
 * ── 形态演进（两次都被真机校正过，别再走回头路）──────────────────────────────
 *   v1 标题旁加「待」字小红 badge → 与卡片原有红数字重复，观感多余；
 *   v2 把 `.count` 数字做成胶囊       → 只改一个小点，卡片整体还是灰的，不够显眼；
 *   v3（定版）**整张 `.message-item` 卡片**：浅红底 + 1px 红边 + 圆角 +
 *      外圈光晕呼吸（box-shadow 扩散），首次出现再叠一圈 `::after` 扩散描边。
 *      ——「0」的卡片完全不碰（待办清零就该安静）。
 *
 * ── 为什么不用 Tailwind 的 animate-pulse 类 ──────────────────────────────────
 * 注入的是**站点页面的 light DOM**，不是我们自己的 Shadow DOM —— 站点没加载
 * Tailwind，类名不生效。自带 `<style>`（keyframes 前缀 znhdTodo 防冲突）。
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
const CARD_CLASS = 'znhd-todo-card';

/** 源文字关键词：出现其一就检查对应的数量 */
const KEYWORDS = ['待处理留言', '待处理预约'];

/**
 * 卡片呼吸：1.4s 一轮光晕扩散。
 * 用 box-shadow 而不是整卡 opacity/明暗：卡片里有文字和数字，整体闪会晃眼；
 * 光晕只在卡片外围起伏，读起来像「这有个红灯」。
 * ⚠️ 站点 scoped 样式（`.message-item[data-v-xxx]`）特异性高，覆盖必须 !important。
 * ⚠️ 底色/描边强度不要再调淡（v26.10.24-v3）：v2 的 #fff1f1 + 1px 边在实机
 *   175% 缩放下几乎与素白卡片同色，使用者「没看出来」。现定版 #ffe6e6 + 2px
 *   边 + 7px 光晕——旁边未命中的卡片保持素白，一眼能分开。
 */
const CSS = [
    '@keyframes znhdTodoGlow{0%,100%{box-shadow:0 0 0 0 rgba(229,72,77,.65)}' +
        '50%{box-shadow:0 0 0 7px rgba(229,72,77,0)}}',
    '@keyframes znhdTodoPing{0%{opacity:.85;transform:scale(1)}100%{opacity:0;transform:scale(1.12)}}',
    '.' + CARD_CLASS + '{position:relative;background-color:#ffe6e6!important;' +
        'border:2px solid #e5484d!important;border-radius:8px!important;' +
        'animation:znhdTodoGlow 1.4s ease-in-out infinite!important;}',
    // 首次出现的扩散描边：伪元素跑一次就消失（fill both 停在 opacity:0），
    // 不额外加 DOM，也不与卡片的呼吸动画抢 box-shadow 属性。
    '.' + CARD_CLASS + '::after{content:"";position:absolute;inset:-3px;border-radius:11px;' +
        'border:2px solid #e5484d;pointer-events:none;' +
        'animation:znhdTodoPing 1.2s cubic-bezier(0,0,.2,1) 1 both;}',
].join('\n');

let started = false;
let observer: MutationObserver | null = null;
let scanTimer: number | null = null;

function ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    // ⚠️ head 兜底到 documentElement：脚本是 @run-at document-end，正常有 head，
    // 但站点若在某个时刻重建 head（SPA 换壳），这里不至于抛错把整条启动链带下去。
    const host = document.head || document.documentElement;
    if (!host) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    host.appendChild(style);
}

function countOf(card: Element | null): number {
    const el = card?.querySelector('.count');
    if (!el) return 0;
    return parseInt((el.textContent || '0').trim(), 10) || 0;
}

/**
 * 一次同步：
 *   ① 已命中但数量归零的撤掉；
 *   ② 新命中的标上。
 * 两件事都做，才不会出现「处理完了红框还在」。
 */
function scan(): void {
    ensureStyle();

    // ① 先回收（数量被站点就地改成 0/空 的情况）
    document.querySelectorAll('[' + MARK + ']').forEach((title) => {
        const card = title.closest('.message-item');
        if (card && countOf(card) > 0) return;
        card?.classList.remove(CARD_CLASS);
        title.removeAttribute(MARK);
    });

    // ② 再补新命中
    const root = document.body || document.documentElement;
    if (!root) return;
    for (const keyword of KEYWORDS) {
        const xpath = '//div[contains(@class,"title")][contains(., "' + keyword + '")]';
        const result = document.evaluate(xpath, root, null, XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < result.snapshotLength; i++) {
            const title = result.snapshotItem(i) as Element | null;
            if (!title || title.hasAttribute(MARK)) continue;
            const card = title.closest('.message-item');
            if (!card || countOf(card) <= 0) continue;
            card.classList.add(CARD_CLASS);
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
    // 没 root 就先不置 started，留给调用方下轮重试（置了位就再也起不来了）
    const root = document.body || document.documentElement;
    if (!root) return;
    started = true;
    // 首扫自己吞异常：观察器装不上/首扫抛错也只影响本模块，不能连累同批启动的
    // 快捷短语等（v26.10.24-v3 加固，见 app.ts 的 boot()）。
    try {
        scan();
    } catch (e) {
        console.warn('[待办提醒] 首扫失败:', e);
    }
    observer = new MutationObserver(scheduleScan);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
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
