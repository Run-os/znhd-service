import { hostDoc } from '@/lib/feishu/convText';
import { normalize } from '@/lib/feishu/match';

/**
 * 「主管税务机关」字段的值块定位（v26.10.26-v4，纯 DOM 查询，无业务逻辑）。
 *
 * ── 为什么按文本定位，不按类名 ────────────────────────────────────────────────
 * 右侧栏「会话人信息 → 基础信息 → 企业信息 → 主管税务机关」的类名是站点内部实现，
 * 改版就崩（todoBadge 的经验：`title` / `count` 这种语义类名稳，结构类名不稳）。
 * 而税务机关全称（实测 `国家税务总局衡阳市南岳区税务局税源管理股`）在页面上几乎唯一，
 * 所以做法是：拿全称在 DOM 里找**文本落在全称内**的节点 → 向上扩展到「整体仍被全称包含」
 * 的最外层元素（值块）→ 图标插在它后面。全程不依赖任何类名。
 *
 * 两层匹配（严格优先，宽松兜底）：
 *   ① 严格：某个文本节点归一化后**就是**全称 ⇒ 值块 = 这一格值；
 *   ② 宽松：页面把全称拆成多段渲染（富文本分段 / 换行）时，按「片段 ≥ 6 字且是全称子串」
 *      找值块 —— 向上扩展到仍被全称包含的最外层元素，图标落在整段之后而不是插在中间。
 *
 * ⚠️ 本模块只在 `tick` 里被调用，且调用方在稳态（图标还挂着 + 全称没变）会早退 ——
 *    低配实机上不允许每 2s 全页扫一遍文本节点。
 */

/** 图标 host 的标记：既是选择器钩子（冒烟断言用），也让扫描跳过自家节点 */
export const MARK = 'data-znhd-org-send';

/** 值所在字段的标签文本（只用于消歧，不参与取值） */
const LABEL = '主管税务机关';
/** 宽松层的片段最短长度：太短（如「税务局」）在页面上到处都是，会误挂 */
const MIN_FRAGMENT = 6;

/** 页面 document（沙箱里优先主世界的，DOM 与事件同一上下文最稳） */
function doc(): Document | null {
    return hostDoc();
}

/** 元素是否真的可见（隐藏的侧栏副本、`display:none` 的模板节点都不该被标记） */
function isVisible(el: Element): boolean {
    try {
        return el.getClientRects().length > 0;
    } catch {
        return false;
    }
}

/**
 * 向上扩展到「整体仍被全称包含」的最外层元素 = 这一格值的容器。
 *
 * 例：`<span>国家税务总局衡阳市南岳区税务局</span><span>税源管理股</span>` 的父元素
 * 文本仍等于全称 ⇒ 值块 = 父元素，图标落在两段之后。
 */
function blockOf(start: HTMLElement, target: string): HTMLElement {
    let el = start;
    const body = doc()?.body;
    while (el.parentElement && el.parentElement !== body) {
        const pt = normalize(el.parentElement.textContent || '');
        if (!pt || target.indexOf(pt) < 0) break;
        el = el.parentElement;
    }
    return el;
}

/**
 * 收集页面里「就是字段标签本身」的元素（文本以 `主管税务机关` 开头，尾部最多再带 3 个字，
 * 兼容「主管税务机关：」这种写法）。
 *
 * 为什么后续要取 textContent **最短**的：标签常写成
 * `<div class="row"><span>主管税务机关</span><span>值</span></div>`，文本节点的父元素
 * 可能正好是标签 span（对），也可能是整行（错）—— 长度最短的才最贴近标签自身。
 */
function findLabelEls(): HTMLElement[] {
    const d = doc();
    const root = d?.body;
    const target = normalize(LABEL);
    if (!d || !root || !target) return [];
    const out: HTMLElement[] = [];
    const walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node: Node): number {
            const t = normalize(node.nodeValue || '');
            if (!t || t.indexOf(target) !== 0 || t.length > target.length + 3) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const p = (n as Text).parentElement;
        if (!p || out.indexOf(p) >= 0 || !isVisible(p)) continue;
        out.push(p);
    }
    return out;
}

/** 最低公共祖先（判断「标签」与「值」是不是同一行的两块） */
function lca(a: Node, b: Node): Node | null {
    let cur: Node | null = a;
    while (cur) {
        if (cur.contains(b)) return cur;
        cur = cur.parentNode;
    }
    return null;
}

/**
 * 多候选择优。**整条链路最容易出错的一步**：v26.10.26-v4 首版按「向上 5 层内出现标签」判断，
 * 结果面板根容器也含「主管税务机关」字样，页面上另一处同名文本（会话列表/详情副标题）
 * 被误判成字段值 —— 冒烟 `orgSendIconOk` 就是这么打红的（`afterCopy: true` 而非 `afterValue`）。
 *
 * 现判据三条：
 *   ① 值必须**在标签之后**（文档序）—— 位于标签之前的同名文本不可能是这个字段的值；
 *   ② 标签与值的**最低公共祖先**要足够小（≤ 全称 + 标签 + 40 字）⇒ 两者确实在同一行；
 *   ③ 满足 ①② 的候选中取公共祖先**最短**的（最贴近这一格），同长取文档序第一个。
 * 有标签但没有任何候选合格 ⇒ null（位置不可信，宁可不挂也不错挂）；
 * 页面上压根找不到标签（站点改版 / 标签文案变了）才退化为「第一个可见候选」。
 */
function pickCandidate(list: HTMLElement[], target: string): HTMLElement | null {
    if (!list.length) return null;
    const labels = findLabelEls();
    if (labels.length) {
        const limit = target.length + normalize(LABEL).length + 40;
        const scored: Array<{ el: HTMLElement; len: number }> = [];
        for (const el of list) {
            if (!isVisible(el)) continue;
            let best = Infinity;
            for (const label of labels) {
                if (!(label.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
                const box = lca(label, el);
                if (!box) continue;
                const len = normalize(box.textContent || '').length;
                if (len <= limit && len < best) best = len;
            }
            if (best !== Infinity) scored.push({ el, len: best });
        }
        if (!scored.length) return null;
        scored.sort((a, b) => a.len - b.len);
        return scored[0].el;
    }
    const seen = list.filter(isVisible);
    return seen[0] || list[0] || null;
}

/**
 * 找「主管税务机关」这一格值的容器。找不到返回 null（不报错、不阻塞）。
 *
 * 走 TreeWalker 扫文本节点（原生实现，比 JS 递归组件树便宜；只扫一层、不进 shadow）。
 */
export function findOrgValueBlock(org: string): HTMLElement | null {
    const d = doc();
    const root = d?.body;
    const target = normalize(org);
    if (!d || !root || !target) return null;

    const strict: HTMLElement[] = [];
    const loose: HTMLElement[] = [];
    const walker = d.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node: Node): number {
            const t = normalize(node.nodeValue || '');
            if (t.length < MIN_FRAGMENT || target.indexOf(t) < 0) return NodeFilter.FILTER_REJECT;
            const el = (node as Text).parentElement;
            // 跳过自家节点（图标 host 内没有文本，这里只是纵深防御）
            if (el && el.closest('[' + MARK + ']')) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const p = (n as Text).parentElement;
        if (!p) continue;
        const block = blockOf(p, target);
        const text = normalize(block.textContent || '');
        const bucket = text === target ? strict : loose;
        if (bucket.indexOf(block) < 0) bucket.push(block);
    }
    return pickCandidate(strict, target) || pickCandidate(loose, target);
}
