/**
 * 图片嗅探「会话归属」模块（v26.10.13-v8 新增，配合 `lib/sniffer.ts` + `ui/SniffModal.tsx`）。
 *
 * 解决什么问题：征纳互动工作台里的图片是**按会话窗口（纳税人）**产生的，而嗅探是整页扫描，
 * 结果平铺在一起分不清哪张是谁的（用户 2026-10-13 提出）。这里把「文件名主干 → 会话」的映射建起来，
 * 面板据此分组展示。改之前先读下面这份页面事实与三条设计约束。
 *
 * ── 页面事实（用户 2026-10-13 提供的实测文档，页内实测） ──────────────────────────
 *   · 工作台是 Vue2 + Vuex 单页应用，根实例 `#app.__vue__`，状态 `$store.state`；
 *   · 当前会话：`state.chat.selectItem.conversationInfo`（`conversationID` + `groupProfile.name`），
 *     取不到时用 DOM 兜底 `.group-item.selected .company-name`；
 *   · 图片消息：`state.chat.messageList` 里 `type === 'TIMImageElem'` 的项，
 *     `payload.fileName` 与 `payload.imageInfoArray[].imageUrl` 的末段就是页面上的文件名，
 *     `payload.uuid` 全局唯一；
 *   · ⚠️ `messageList` **只有当前会话**，别的会话的图只能靠 `state.allChat.historyMsg`
 *     （嵌套结构官方无文档，本模块用宽容遍历兜）或**上一次扫描留下的持久记录**（见下）。
 *
 * ── 三条设计约束 ────────────────────────────────────────────────────────────
 *  1) **归属按「文件名主干」而不是 DOM 位置**：实测图片节点多数不在 `.panel-container` 里、
 *     可能挂在游离容器中，按 DOM 祖先找会话必错。文件名是同一条 CDN 路径上的稳定标识
 *     （im-cos 直链带签名会过期，但 `pathname` 末段不变），且与 Vuex 消息里的 `fileName` 同形。
 *  2) **读页面 Vuex 必须走 `unsafeWindow.document`**：ScriptCat 隔离世界里直接读
 *     `document.querySelector('#app').__vue__` 可能拿不到（脚本已声明 `@grant unsafeWindow`，
 *     本模块不新增任何 @grant）。DOM 的 `textContent` 不受此限，故会话名有 DOM 兜底。
 *  3) **绝不因为页面结构变化而丢图或抛错**：认得出就归组，认不出就落到「未归属」，
 *     `historyMsg` 那一路全靠宽容遍历（见 walkAny 的注释）——结构变了只是少归几个组，不会报错。
 *
 * ── 持久化（`scriptCat_SniffConvIndex`，见 constants.ts） ────────────────────
 * 「文件名 → 会话」按 origin 分桶存在 localStorage：30 天过期、上限 2000 条、超出按最旧丢。
 * **只存映射不存 URL**（签名会过期）。它的价值是「切走会话后 Vuex 里已经没有那条消息，
 * 但图还留在 DOM / 资源表里时仍能归回原会话」，也是「重新扫描不丢分组」的原因。
 * 本次从页面读到的映射**优先于**持久记录（页面才是最新真相）。
 *
 * ── 同一会话被拆成两组：两条解析路径的合并（v26.10.14-v5） ──────────────────
 * 用户的实测证据（读 `scriptCat_SniffConvIndex` 得到）：同一个会话窗口的图，一部分记成了真实
 * 群组 ID（`GROUP…`，来自带 `conversationID` 的消息），另一部分记成了 `name:<显示名>`
 * （解析不出 ID 时的回退键，来自不带 ID 的那条路径 —— 页面刷新 / 历史懒加载渲染出来的消息常见）。
 * 两边显示名相同时，面板上就出现「同一个会话名、两个分组」。
 *
 * 根因是**逐张图片独立解析会话**：解析不出的那些各自退化成名字键，之后就再没机会改正。
 * 现在的三层修法（都在本文件内，不改页面读取方式）：
 *   ① 别名表 `AliasTable`（显示名 → 真实 ID）：解析出真实 ID 的消息顺手把「名字 ↔ ID」记进表；
 *   ② **以会话窗口为单位解析一次**：`buildConvContext` 走两遍 —— 第一遍只认带真实 ID 的消息，
 *      学出别名与「当前会话的真实 ID」；第二遍才正式收集，此时无 ID 的消息直接复用窗口的真实 ID；
 *   ③ **回退键后置合并**：持久层里历史遗留的 `name:` 条目，一旦别名表认得这个名字就改写回真实 ID
 *      （读时纠正 + 写时迁移），面板侧 `groupByConversation` 也按别名解析分组键兜最后一道。
 * 名字匹配按「精确 → 归一化（去空白/去括号尾注，如「（个体工商户）」）→ 唯一包含」三级，
 * 因为同一个会话的名字在页面上有多个来源（群资料给简称、DOM 给全称）。
 * ⚠️ 宁可拆组也不张冠李戴：任何一级只要指向**不唯一**就放弃匹配，保持原样。
 *
 * ── 现场待确认（唯一一处） ────────────────────────────────────────────────
 * `allChat.historyMsg` 的实际嵌套结构没有实测样本（当时环境里没有历史会话）。本模块按
 * 「容器自带 `conversationID` / `conversationInfo` / `groupProfile.name`」以及
 * 「`{ [conversationID]: 节点 }` 字典用 key 当会话 ID」两种形状去认；
 * 若线上历史会话归组不对，先打印一次 `state.allChat.historyMsg` 的实际结构再改 convOfNode。
 */

import { addLog } from '@/lib/logger';
import { CONFIG, SNIFF_CONV_INDEX_KEY } from '@/lib/constants';
import { urlFileStem } from '@/lib/sniffer';

/** 一个会话（纳税人 / 群） */
export interface SniffConv {
    /** 会话唯一 ID（`conversationID`；取不到时退化成 `name:<名称>`，绝不用名称单独当 key） */
    id: string;
    /** 会话名（纳税人名 / 群名） */
    name: string;
    /** 消息发送者（单聊里即纳税人；群聊里是具体人）。仅用于卡片 hover 提示，不参与归组 */
    sender: string | null;
    /** 消息时间（用于组间排序；取不到为 null） */
    time: number | null;
}

/** 一次扫描要用的归属上下文 */
export interface ConvContext {
    /** 当前会话（Vuex / DOM 都取不到时为 null）——只用于「当前会话组置顶」 */
    current: SniffConv | null;
    /** 文件名主干（小写）→ 会话 */
    byStem: Map<string, SniffConv>;
    /** 本次**从页面新读到**的映射（写持久层用；持久记录不重复写，以免刷新它们的过期时间） */
    fresh: Array<[string, SniffConv]>;
    /** 「显示名 → 真实会话 ID」别名表（v26.10.14-v5）：分组与持久化都要用它合并回退键 */
    aliases: AliasTable;
}

/** 面板上的一个分组（渲染层只是把它画出来，排序/分桶的规则都在本模块） */
export interface ConvSection<T> {
    /** 会话 ID；'' = 未归属（面板显示「未归属会话」） */
    id: string;
    /** 会话名；'' 表示未归属 */
    name: string;
    /** 是否当前会话（面板加「当前会话」标签） */
    current: boolean;
    /** 达标（≥ 阈值）的图，组内按消息时间从新到旧（无时间的殿后，内部按体积倒序） */
    known: T[];
    /** 大小未知的图（折叠保留，不丢） */
    unknown: T[];
}

/** 未归属分组的 ID（空串；渲染时会转成 React key 的兜底串） */
export const UNNAMED_CONV_ID = '';

/** 遍历深度上限：Vue 状态里可能有循环引用（`_vm` 回指等），没有上限会栈溢出 */
const MAX_WALK_DEPTH = 7;

/** 单条消息最多登记几个匹配键（fileName / uuid / 各档 imageUrl） */
const MAX_STEMS_PER_MSG = 8;

/**
 * 看起来像 TIM 会话 ID 的对象键：`{ [conversationID]: 会话节点 }` 这种字典要靠 key 当会话 ID。
 * 只认 TIM 的两种前缀（单聊 `C2C…`、群 `GROUP…` / `@TIM#…`），不猜别的键名，避免把
 * `messageList` 这种普通字段名当成会话 ID（那会给所有消息挂上一个假会话）。
 */
const CONV_ID_KEY_RE = /^(?:C2C|GROUP|@TIM#)/i;

/** 安全取字符串（trim；非字符串一律空串） */
function str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
}

/** 安全取有限数字 */
function num(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 消息时间（v26.10.26-v6 修）：**站点把 `time` 字段去掉了**。
 *
 * 真机实测（2026-10-26，`state.chat.messageList` 11 条消息）：`typeof msg.time === 'undefined'`
 * **11/11**，而每条都带 `systemTime` / `talkTime`（形如 `2026-10-26 14:56:39`）。
 * 旧实现只认 `num(msg.time)` ⇒ 全部图片时间变成 null ⇒ 面板上**每张图都标红、组内退化成按体积排**，
 * 使用者看到的就是「所有文件名都是红的、没有按时间排」。
 *
 * 取值顺序：`time`（秒或毫秒都见）→ `systemTime` → `talkTime` → `timestamp`。
 * 字符串按**本地时间**解析（站点给的是本地时间文本，不带时区）。
 */
function msgTime(msg: Record<string, unknown>): number | null {
    const raw = num(msg.time);
    if (raw !== null && raw > 0) return raw < 1e11 ? raw * 1000 : raw;
    for (const k of ['systemTime', 'talkTime', 'timestamp']) {
        const v = msg[k];
        const n = num(v);
        if (n !== null && n > 0) return n < 1e11 ? n * 1000 : n;
        const s = str(v);
        if (!s) continue;
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/.exec(s);
        if (m) {
            const t = new Date(
                Number(m[1]),
                Number(m[2]) - 1,
                Number(m[3]),
                Number(m[4]),
                Number(m[5]),
                Number(m[6] || 0)
            ).getTime();
            if (Number.isFinite(t)) return t;
        }
    }
    return null;
}

/** ID 的短尾（给「取不到会话名」时的兜底显示用，如 `会话 aPKJKKK1`） */
function shortId(id: string): string {
    return id.length > 8 ? id.slice(-8) : id;
}

/** `name:` 回退键的判据（v26.10.14-v5）：解析不出真实会话 ID 时，用会话显示名拼的键 */
function isFallbackId(id: string): boolean {
    return id.indexOf('name:') === 0;
}

/** 从回退键里取回会话显示名（不是回退键时返回空串） */
function fallbackName(id: string): string {
    return isFallbackId(id) ? id.slice(5) : '';
}

/**
 * 会话名的归一化（只用于**匹配**，展示一律用原文）：去空白 + 去括号尾注（全/半角）+ 小写。
 * 同一个会话在页面上有多个名字来源 —— 群资料给简称（「财猫商贸店」）、DOM / 消息头给全称
 * （「衡阳市南岳区财猫商贸店（个体工商户）」）—— 不做这一步就会因为一个「（个体工商户）」
 * 而认不出是同一个会话。
 */
function normName(name: string): string {
    return str(name)
        .replace(/[（(][^（()）]*[)）]/g, '')
        .replace(/\s+/g, '')
        .toLowerCase();
}

/** 「唯一包含」匹配的最小长度：一两个字的键（「长沙」）包含关系太容易误配，直接不参与 */
const MIN_CONTAIN_LEN = 4;

/** 取集合里的唯一元素（调用方已确保 size === 1） */
function firstOf(set: Set<string>): string | null {
    for (const v of set) return v;
    return null;
}

/**
 * 会话别名表（v26.10.14-v5）：**显示名 → 真实会话 ID**。
 *
 * 存在的理由：会话 ID 是逐张图片解析的，同一条路径有时给得出 `conversationID`、有时给不出。
 * 给得出的那些顺手把「名字 ↔ ID」记下来，给不出的就能靠名字复用同一个 ID，不再退化成 `name:` 键
 * （回退键会让同一个会话在面板上分裂成两个分组，用户 2026-10-14 反馈的问题）。
 *
 * 匹配三级：精确 → 归一化（须唯一）→ 唯一「包含」（长短名混用时的兜底）。
 * 任何一级**指向不唯一就返回 null** —— 宁可拆组也不把两个不同的会话合成一个（张冠李戴比重复更糟）。
 */
export class AliasTable {
    /** 原始名 → 真实 ID（先到先得：页面顺序即「最新真相」的顺序） */
    private byExact = new Map<string, string>();
    /** 归一化名 → 真实 ID 集合（size > 1 表示这个名字指向不唯一，匹配时放弃） */
    private byNorm = new Map<string, Set<string>>();
    /** 全部（归一化名, 真实 ID）对，供「唯一包含」匹配 */
    private pairs: Array<[string, string]> = [];

    /** 表里有多少条别名（判「要不要写持久层」用） */
    get size(): number {
        return this.byExact.size;
    }

    /** 记一条「名字 → 真实 ID」；名字为空、ID 为空、或 ID 本身就是回退键时忽略 */
    add(name: string, id: string): void {
        const n = str(name);
        if (!n || !id || isFallbackId(id)) return;
        if (!this.byExact.has(n)) this.byExact.set(n, id);
        const k = normName(n);
        if (!k) return;
        let set = this.byNorm.get(k);
        if (!set) {
            set = new Set<string>();
            this.byNorm.set(k, set);
        }
        if (set.has(id)) return;
        set.add(id);
        this.pairs.push([k, id]);
    }

    /** 查一个（可能不完整的）会话名对应的真实 ID；查不到或指向不唯一返回 null */
    lookup(name: string): string | null {
        const n = str(name);
        if (!n) return null;
        const exact = this.byExact.get(n);
        if (exact) return exact;
        const k = normName(n);
        if (!k) return null;
        const hit = this.byNorm.get(k);
        if (hit && hit.size === 1) return firstOf(hit);
        if (k.length < MIN_CONTAIN_LEN) return null;
        // 唯一「包含」：`衡阳市南岳区财猫商贸店` 与别名里的 `财猫商贸店` 属于同一条时才算命中；
        // 命中的候选若指向多个不同会话（如同时有「…二部」），同样放弃。
        const ids = new Set<string>();
        for (const pair of this.pairs) {
            const k2 = pair[0];
            if (k2 === k || k2.length < MIN_CONTAIN_LEN) continue;
            if (k.indexOf(k2) >= 0 || k2.indexOf(k) >= 0) ids.add(pair[1]);
        }
        return ids.size === 1 ? firstOf(ids) : null;
    }

    /** 全部别名（原始名 → 真实 ID），持久化用 */
    entries(): Array<[string, string]> {
        return Array.from(this.byExact.entries());
    }
}

/** 页面主世界的 document（拿不到就用隔离世界的，两者指向同一棵 DOM） */
function hostDoc(): Document | null {
    try {
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow.document) return unsafeWindow.document;
    } catch (e) {
        /* 沙箱代理拦截时退回下面的 document */
    }
    try {
        return document;
    } catch (e) {
        return null;
    }
}

/** 页面 Vue2 根实例（页面未就绪 / 不是 Vue 页 / 属性被代理拦截时返回 null） */
interface VueInstance {
    $store?: { state?: Record<string, unknown> };
}

function readVueInstance(): VueInstance | null {
    const docs: Array<Document | null> = [hostDoc(), document];
    for (const d of docs) {
        if (!d) continue;
        try {
            const el = d.querySelector('#app') as (Element & { __vue__?: VueInstance }) | null;
            const vm = el && el.__vue__;
            if (vm && vm.$store && vm.$store.state) return vm;
        } catch (e) {
            /* 换下一个 document 再试 */
        }
    }
    return null;
}

/** 页面 Vuex 的 state（拿不到返回 null） */
function readChatState(): Record<string, unknown> | null {
    const vm = readVueInstance();
    const st = vm && vm.$store && vm.$store.state;
    return st && typeof st === 'object' ? st : null;
}

/** DOM 上的当前会话名（`.group-item.selected .company-name`）——不受沙箱限制的兜底来源 */
function domCurrentName(): string {
    const docs: Array<Document | null> = [hostDoc(), document];
    for (const d of docs) {
        if (!d) continue;
        try {
            const el = d.querySelector('.group-item.selected .company-name');
            const t = el && el.textContent ? el.textContent.trim() : '';
            if (t) return t;
        } catch (e) {
            /* 忽略，继续下一个来源 */
        }
    }
    return '';
}

/**
 * 当前会话（Vuex 为主、DOM 兜底）。两边都取不到返回 null —— 那说明这页面上没有「会话」这个概念
 * （或页面还没就绪），调用方按「不分组」处理。
 */
export function getCurrentConv(): SniffConv | null {
    let id = '';
    let name = '';
    const st = readChatState();
    const chat = st && (st.chat as Record<string, unknown> | undefined);
    const sel = chat && (chat.selectItem as Record<string, unknown> | undefined);
    const ci = sel && (sel.conversationInfo as Record<string, unknown> | undefined);
    if (ci) {
        id = str(ci.conversationID) || str(ci.conversationId) || str(ci.sessionID);
        const gp = ci.groupProfile as Record<string, unknown> | undefined;
        name = (gp ? str(gp.name) : '') || str(ci.name);
    }
    if (!name) name = domCurrentName();
    if (!id && !name) return null;
    return { id: id || 'name:' + name, name: name || '会话 ' + shortId(id), sender: null, time: null };
}

/** 一个候选键（可能是 URL、uuId 或纯文件名）的归一化：走 urlFileStem，失败再退成小写原串 */
function stemKey(v: unknown): string {
    const s = str(v);
    if (!s) return '';
    return urlFileStem(s) || s.toLowerCase();
}

/** 一条图片消息能提供的所有匹配键（fileName / uuid / 各档 imageUrl 的末段） */
function stemsOfPayload(p: Record<string, unknown>): string[] {
    const out: string[] = [];
    const push = (v: unknown): void => {
        const k = stemKey(v);
        if (k && out.indexOf(k) < 0) out.push(k);
    };
    push(p.fileName);
    push(p.uuid);
    const arr = p.imageInfoArray;
    if (Array.isArray(arr)) {
        for (const x of arr) {
            if (x && typeof x === 'object') push((x as Record<string, unknown>).imageUrl);
        }
    }
    return out.slice(0, MAX_STEMS_PER_MSG);
}

/** 遍历时携带的「当前所处会话」上下文 */
interface WalkCtx {
    id: string;
    name: string;
    sender: string | null;
}

/** 从容器节点自身读会话身份（`conversationInfo` / `groupProfile` / 直接的 conversationID…），读不到就沿用上层 */
function convOfNode(obj: Record<string, unknown>, ctx: WalkCtx): WalkCtx {
    let id = str(obj.conversationID) || str(obj.conversationId) || str(obj.sessionID) || ctx.id;
    let name = str(obj.conversationName) || str(obj.groupName) || ctx.name;
    const ci = (obj.conversationInfo || obj.conversation || obj.sessionInfo) as Record<string, unknown> | undefined;
    if (ci && typeof ci === 'object') {
        id = str(ci.conversationID) || str(ci.conversationId) || str(ci.sessionID) || id;
        if (!name) {
            const gp = ci.groupProfile as Record<string, unknown> | undefined;
            name = (gp ? str(gp.name) : '') || str(ci.name) || name;
        }
    }
    // ⚠️ 刻意**不认**通用的 `obj.name`：容器五花八门，随便一个 `name` 字段都可能不是会话名，
    // 认错了会给出一个看起来像真的、其实张冠李戴的组名（比「会话未命名」更糟）。
    const sender = str(obj.sendUserName) || ctx.sender;
    if (id === ctx.id && name === ctx.name && sender === ctx.sender) return ctx;
    return { id, name, sender };
}

/**
 * 宽容遍历任意嵌套结构，把每条图片消息连同「它所在容器的会话身份」交给 visit。
 *
 * 为什么不用固定路径：`allChat.historyMsg` 的嵌套结构没有文档也没有实测样本，写死路径一旦不符就全丢。
 * 这里的取舍是「**认得出来就用、认不出来退到上一层**」——结构变了最多少归几个组，绝不抛异常。
 * 三层保护：深度上限（防循环引用）、只认 `type === 'TIMImageElem'` 的叶子、容器身份只认白名单字段。
 */
function walkAny(
    node: unknown,
    ctx: WalkCtx,
    depth: number,
    visit: (msg: Record<string, unknown>, ctx: WalkCtx) => void
): void {
    if (node === null || node === undefined || depth > MAX_WALK_DEPTH) return;
    if (Array.isArray(node)) {
        for (const x of node) walkAny(x, ctx, depth + 1, visit);
        return;
    }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    // 命中一条图片消息：就地消费，不再往 payload 里钻（payload 里的字段不是消息）
    if (obj.type === 'TIMImageElem' && obj.payload) {
        visit(obj, ctx);
        return;
    }
    const next = convOfNode(obj, ctx);
    for (const k of Object.keys(obj)) {
        // `{ [conversationID]: 节点 }` 形状的字典：把 key 当这一支的会话 ID
        const childCtx: WalkCtx = CONV_ID_KEY_RE.test(k) && !next.id ? { ...next, id: k } : next;
        walkAny(obj[k], childCtx, depth + 1, visit);
    }
}

/** 把一条消息折算成会话（ID 优先取消息自身的，其次容器的，最后才是当前会话） */
function toConv(
    msg: Record<string, unknown>,
    ctx: WalkCtx,
    current: SniffConv | null,
    aliases: AliasTable | null
): SniffConv | null {
    let id = str(msg.conversationID) || str(msg.conversationId) || str(msg.sessionID) || ctx.id;
    let name = str(msg.conversationName) || str(msg.groupName) || ctx.name;
    if (!name && current && id && id === current.id) name = current.name;
    // v26.10.14-v5：拿不到真实 ID 时，先拿别名表兜一次 —— 同一个会话窗口里带 ID 的那张图
    // 已经把「名字 → ID」记进表了（见 buildConvContext 第一遍），这里复用即不再退化成 `name:` 键。
    if (!id || isFallbackId(id)) {
        const alias = aliases ? aliases.lookup(name) : null;
        if (alias) id = alias;
    }
    // 三者都拿不到就归 null：那不是「未知会话」，而是**根本不知道属于谁**，
    // 调用方会让这些图落到「未归属」分组（与页面上压根没有会话概念的图同一个去处）。
    if (!id && !name) return null;
    const key = id || 'name:' + name;
    return {
        id: key,
        name: name || '会话 ' + shortId(key),
        sender: str(msg.sendUserName) || ctx.sender,
        time: msgTime(msg),
    };
}

/** 持久层里的一条记录（`at` = 最后一次确认时间，用于过期与超限淘汰） */
interface StoredRec {
    id: string;
    name: string;
    sender: string | null;
    time: number | null;
    at: number;
}

/** 持久层的整体形状：按 origin 分桶 —— 换个站点打开脚本时，那边的陈年映射不该在本站点生效 */
interface StoredBucket {
    origin: string;
    items: Record<string, StoredRec>;
    /**
     * v26.10.14-v5：会话别名（显示名 → 真实会话 ID）。
     * 和 items 同一个桶、同一套过期规则：它解决的正是「同一次扫描里两条解析路径各给一个键」，
     * 而两份数据必须一起过期（陈年别名把新会话名指到旧 ID 上，比重名拆组更糟）。
     */
    aliases?: Record<string, { id: string; at: number }>;
}

function readBucket(): StoredBucket | null {
    try {
        const raw = localStorage.getItem(SNIFF_CONV_INDEX_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as StoredBucket;
        if (!parsed || parsed.origin !== location.origin) return null;
        if (!parsed.items || typeof parsed.items !== 'object') return null;
        return parsed;
    } catch (e) {
        return null;
    }
}

/** 载入未过期的别名（过期/坏值直接跳过，不报错） */
function loadStoredAliases(bucket: StoredBucket | null): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    if (!bucket || !bucket.aliases || typeof bucket.aliases !== 'object') return out;
    const now = Date.now();
    for (const name of Object.keys(bucket.aliases)) {
        const r = bucket.aliases[name];
        if (!r || typeof r.id !== 'string' || !r.id) continue;
        if (!Number.isFinite(r.at) || now - r.at > CONFIG.SNIFF_CONV_TTL) continue;
        out.push([name, r.id]);
    }
    return out;
}

/**
 * 载入未过期的持久映射（过期/坏值直接跳过，不报错）。
 * v26.10.14-v5：`name:` 回退条目**读时即纠正** —— 别名表里认得这个名字就用真实 ID 顶掉，
 * 于是历史遗留（本版之前写下的）双路径条目不用等它自然过期就自动收敛。
 */
function loadStoredConv(bucket: StoredBucket | null, aliases: AliasTable): Array<[string, SniffConv]> {
    const out: Array<[string, SniffConv]> = [];
    if (!bucket) return out;
    const now = Date.now();
    for (const k of Object.keys(bucket.items)) {
        const r = bucket.items[k];
        if (!r || typeof r.id !== 'string' || !r.id) continue;
        if (!Number.isFinite(r.at) || now - r.at > CONFIG.SNIFF_CONV_TTL) continue;
        const fb = fallbackName(r.id);
        // 回退键的名字可能记在 id 里（`name:X`），也可能记在 name 字段里 —— 两个都试
        const fixed = fb ? aliases.lookup(r.name) || aliases.lookup(fb) : null;
        const id = fixed || r.id;
        out.push([
            k,
            {
                id,
                name: typeof r.name === 'string' && r.name ? r.name : '会话 ' + shortId(id),
                sender: typeof r.sender === 'string' ? r.sender : null,
                time: num(r.time),
            },
        ]);
    }
    return out;
}

/** 超限时按 `at` 最旧丢（items 与 aliases 共用这一套） */
function pruneOldest<T extends { at: number }>(map: Record<string, T>, max: number): void {
    const keys = Object.keys(map);
    if (keys.length <= max) return;
    keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
    for (const k of keys.slice(0, keys.length - max)) delete map[k];
}

/**
 * 保存映射（合并 → 别名入表 → 回退键迁移 → 清过期 → 超限按最旧丢）。任何失败都只记日志，不影响扫描。
 * v26.10.14-v5 新增中间两步，就是为了让「同一会话两条解析路径」在持久层里也合成一条。
 */
function saveStoredConv(fresh: Array<[string, SniffConv]>, aliases: AliasTable): void {
    try {
        const now = Date.now();
        const bucket: StoredBucket = readBucket() || { origin: location.origin, items: {} };
        bucket.origin = location.origin;
        if (!bucket.aliases || typeof bucket.aliases !== 'object') bucket.aliases = {};
        for (const [stem, conv] of fresh) {
            bucket.items[stem] = { id: conv.id, name: conv.name, sender: conv.sender, time: conv.time, at: now };
        }
        // 别名入表（只收真实 ID；回退键进不了表）：下次扫描时同窗口的另一条路径就能直接并进来
        for (const [name, id] of aliases.entries()) {
            bucket.aliases[name] = { id, at: now };
        }
        // 回退键后置合并：别名表认得这个名字 ⇒ 把历史遗留的 `name:<名>` 条目改写到真实 ID 下。
        // （面板侧还有一道同样的兜底，见 groupByConversation —— 两边都做才不会「重扫一次又变回来」）
        let merged = 0;
        for (const k of Object.keys(bucket.items)) {
            const r = bucket.items[k];
            if (!r || !isFallbackId(r.id)) continue;
            const fb = fallbackName(r.id);
            const id = aliases.lookup(r.name) || aliases.lookup(fb);
            if (!id) continue;
            if (!r.name) r.name = fb;
            r.id = id;
            merged++;
        }
        for (const k of Object.keys(bucket.items)) {
            const r = bucket.items[k];
            if (!r || !Number.isFinite(r.at) || now - r.at > CONFIG.SNIFF_CONV_TTL) delete bucket.items[k];
        }
        for (const name of Object.keys(bucket.aliases)) {
            const a = bucket.aliases[name];
            if (!a || !Number.isFinite(a.at) || now - a.at > CONFIG.SNIFF_CONV_TTL) delete bucket.aliases[name];
        }
        pruneOldest(bucket.items, CONFIG.MAX_SNIFF_CONV_STEMS);
        pruneOldest(bucket.aliases, CONFIG.MAX_SNIFF_CONV_ALIASES);
        localStorage.setItem(SNIFF_CONV_INDEX_KEY, JSON.stringify(bucket));
        if (merged) addLog('[图片嗅探] 会话归属：合并 ' + merged + ' 条回退键到真实会话 ID', 'info');
    } catch (e) {
        addLog('[图片嗅探] 会话归属记录保存失败: ' + e.message, 'error', true);
    }
}

/**
 * 建一次扫描要用的归属上下文：**页面 Vuex（当前会话消息 → 历史会话）优先，持久记录补空缺**。
 * 每次扫描重建（页面数据是最新真相），创建阶段不发网络请求、不做 DOM 扫描，纯读。
 *
 * v26.10.14-v5 改成**走两遍**（见文件头「同一会话被拆成两组」）：
 *   第一遍只认带真实 ID 的消息，学出「显示名 → 真实 ID」别名，并顺手纠正当前会话的 ID；
 *   第二遍才正式收集归属 —— 此时同一窗口里那些不带 ID 的图会直接复用窗口的真实 ID。
 * 走两遍的代价只是一次纯对象遍历（深度有上限、消息只有几十上百条），换来的是不再分裂分组。
 */
export function buildConvContext(): ConvContext {
    let current = getCurrentConv();
    const aliases = new AliasTable();
    const bucket = readBucket();
    // 持久层的别名先入表：跨扫描复用（本次页面读到的会补充它）
    for (const [name, id] of loadStoredAliases(bucket)) aliases.add(name, id);

    const st = readChatState();
    const chat = st && (st.chat as Record<string, unknown> | undefined);
    const allChat = st && (st.allChat as Record<string, unknown> | undefined);
    /** 两条路各走一遍：① 当前会话（结构已实测，最可靠）② 历史会话（结构未实测，靠宽容遍历） */
    const walkAll = (seed: WalkCtx, visit: (msg: Record<string, unknown>, ctx: WalkCtx) => void): void => {
        if (chat) walkAny(chat.messageList, seed, 0, visit);
        if (allChat) walkAny(allChat.historyMsg, { id: '', name: '', sender: null }, 0, visit);
    };

    // ── 第一遍：只认「消息自带真实 ID」的，学出别名（此时不能信任当前会话的 ID，它可能只是回退键）──
    walkAll({ id: current ? current.id : '', name: current ? current.name : '', sender: null }, (msg, ctx) => {
        const conv = toConv(msg, ctx, current, aliases);
        if (conv && !isFallbackId(conv.id)) aliases.add(conv.name, conv.id);
    });

    // ── 纠正当前会话（窗口级解析一次）：Vuex 没给 conversationID 时它只是个 `name:` 键，
    //    不纠正的话第二遍会把「没带 ID 的图」整体挂到这个名字键上，照样分裂成两组 ──
    if (current && isFallbackId(current.id)) {
        const id = aliases.lookup(current.name) || aliases.lookup(domCurrentName());
        if (id) current = { ...current, id };
    }

    // ── 第二遍：正式收集（别名表与当前会话 ID 都已就绪）──
    const byStem = new Map<string, SniffConv>();
    const fresh: Array<[string, SniffConv]> = [];
    const out = (msg: Record<string, unknown>, ctx: WalkCtx): void => {
        const conv = toConv(msg, ctx, current, aliases);
        if (!conv) return;
        const payload = msg.payload as Record<string, unknown>;
        for (const k of stemsOfPayload(payload)) {
            // 先到先得：当前会话先遍历，故同名文件以当前会话为准；历史会话再来只补空缺
            if (byStem.has(k)) continue;
            byStem.set(k, conv);
            fresh.push([k, conv]);
        }
    };
    walkAll({ id: current ? current.id : '', name: current ? current.name : '', sender: null }, out);

    const fromPage = byStem.size;
    // ③ 持久记录只补空缺：页面读到的一定更新（会话可能改名、也可能这次不在页面上）
    for (const [k, v] of loadStoredConv(bucket, aliases)) {
        if (!byStem.has(k)) byStem.set(k, v);
    }
    if (byStem.size) {
        addLog(
            '[图片嗅探] 会话归属：本次从页面读到 ' +
                fromPage +
                ' 个文件名（含历史记录共 ' +
                byStem.size +
                ' 个；会话别名 ' +
                aliases.size +
                ' 条；' +
                (current ? '当前会话「' + current.name + '」' : '当前会话未识别') +
                '）',
            'info'
        );
    }
    return { current, byStem, fresh, aliases };
}

/** 把本次从页面读到的映射与别名写进持久层（都没有新内容时不写，避免无谓的 localStorage 写入） */
export function persistConvContext(ctx: ConvContext): void {
    if (!ctx.fresh.length && !ctx.aliases.size) return;
    saveStoredConv(ctx.fresh, ctx.aliases);
}

/** 取一张图归属的会话（未归属返回 null） */
function convOfItem(it: { stem: string }, ctx: ConvContext | null): SniffConv | null {
    if (!ctx || !it.stem) return null;
    return ctx.byStem.get(it.stem) || null;
}

/**
 * 取一张图所属消息的**时间**（v26.10.16-v3）。
 *
 * 用途只有一个：面板要能标出「这张图**没拿到时间**」——排序虽然把无时间的图殿后，
 * 但用户看不出「为什么这张跑到最后」，于是给卡片加红圈提示。属**纯展示**用途，
 * 不参与任何分桶/排序决策，故与 `convOfItem` 一样是「现取」，不往 `SniffedImage` 上挂字段。
 *
 * ⚠️ 判据是 `null` 而不是 `!time`：`time` 是毫秒时间戳，`0` 理论上只可能是坏数据，
 * 但按 null 判定与 `byTimeDesc`（`va === null`）严格同源 —— 提示要红的地方必须**恰好**是
 * 排序里被殿后的那批，两边口径一旦分叉就会出现「红圈但排在有时间的图前面」这种自相矛盾。
 * 未归属的图（`byStem` 里没有它的主干）同样返回 null ⇒ 也会被标红。
 */
export function timeOfItem(it: { stem: string }, ctx: ConvContext | null): number | null {
    const conv = convOfItem(it, ctx);
    return conv ? conv.time : null;
}

/**
 * 分组的实际键（v26.10.14-v5）：`name:` 回退键若能借别名表认出真实会话，就用真实 ID。
 * 这一层是为了**兜住持久层里还没被迁移的存量条目**（老版本写下的 `name:` 条目），
 * 与 saveStoredConv 的迁移互为保险 —— 缺任何一边，都会出现「重扫一次又分裂」。
 */
function convKey(conv: SniffConv | null, aliases: AliasTable | null): string {
    if (!conv) return UNNAMED_CONV_ID;
    if (isFallbackId(conv.id) && aliases) {
        const id = aliases.lookup(conv.name) || aliases.lookup(fallbackName(conv.id));
        if (id) return id;
    }
    return conv.id;
}

/** 分组用的最小结构约束（只要求「有 stem 与 size」——本模块不认识 SniffedImage 的其它字段） */
export interface GroupableImage {
    stem: string;
    size: number | null;
}

/**
 * 把嗅探结果按会话分组。
 *
 * 排序规则：
 *   ① 当前会话置顶；② 其余会话按最新消息时间倒序；③ 未归属永远排最后。
 * 组内（v26.10.16-v2，用户指定「最新的图片在前面」）：**按各自消息的消息时间从新到旧**，
 * 大小未知的那一档同样按时间排。取不到消息时间的图（Vuex 那条路没认出会话、或整组都是未归属）
 * 排在有时间的之后，它们之间沿用 v26.10.16-v1 之前的老口径「体积倒序」——
 * 这样「普通网页（没有会话概念）」上的观感与旧版完全一致，且顺序永远确定、不随扫描顺序抖动。
 *
 * 返回值里的 `grouped` 决定面板要不要画组头：**一个具名分组都没有时不画**
 * （普通网页上根本没有「会话」概念，硬套一个「未归属会话」标题只是噪音；
 * 而此时 sections 恰好只有一个未归属分组，渲染出来就是原来的平铺形态）。
 */
export function groupByConversation<T extends GroupableImage>(
    items: T[],
    ctx: ConvContext | null,
    minBytes: number
): { sections: Array<ConvSection<T>>; grouped: boolean } {
    interface Bucket {
        name: string;
        current: boolean;
        time: number | null;
        known: T[];
        unknown: T[];
    }
    const buckets = new Map<string, Bucket>();
    const aliases = ctx ? ctx.aliases : null;
    // 「当前会话」也按别名解析后的键比（当前会话可能只有回退键，而组里已经是真实 ID —— 那样会置顶失败）
    const curKey = ctx && ctx.current ? convKey(ctx.current, aliases) : '';

    const bucketOf = (conv: SniffConv | null): Bucket => {
        const id = convKey(conv, aliases);
        let b = buckets.get(id);
        if (!b) {
            b = {
                name: conv ? conv.name : '',
                current: !!(conv && curKey && id === curKey),
                time: conv ? conv.time : null,
                known: [],
                unknown: [],
            };
            buckets.set(id, b);
        }
        // 同一个会话的不同消息可能一条带名字一条没有：取到过名字就留着
        if (conv && conv.name && !b.name) b.name = conv.name;
        if (conv && conv.time !== null && (b.time === null || conv.time > b.time)) b.time = conv.time;
        return b;
    };

    for (const it of items) {
        const b = bucketOf(convOfItem(it, ctx));
        if (it.size === null) b.unknown.push(it);
        else if (it.size >= minBytes) b.known.push(it);
        // 其余（已知但小于阈值）只被过滤，不进入任何分组 —— 与面板的「只列出 ≥ N KB」一致
    }

    /** 体积倒序（v26.10.16-v1 之前的组内老口径）：现在只做**次级判据**——时间相同或都没有时间时用它 */
    const bySizeDesc = (a: T, b: T): number => (b.size === null ? 0 : b.size) - (a.size === null ? 0 : a.size);
    /**
     * 组内排序（v26.10.16-v2，用户要求「最新的图片在前面」）：按**该图所属消息的 `time`** 从新到旧。
     *
     * ⚠️ 时间在排序时逐张现取，而不是随分桶一起存一份：`convOfItem` 只是 `byStem` 的一次 Map 查询
     * （n ≤ MAX_SNIFF），重算不吃亏，却省掉了「T 的对象引用必须唯一」这个不成立就出错的隐含假设。
     * 取不到时间的（`null`）一律**殿后** —— 未归属组整组没有时间，于是自动退回 bySizeDesc，
     * 普通网页上的观感与旧版完全一致；有时间的图之间若时间相同也退回 bySizeDesc，保证顺序确定。
     */
    const byTimeDesc = (a: T, b: T): number => {
        const ca = convOfItem(a, ctx);
        const cb = convOfItem(b, ctx);
        const va = ca ? ca.time : null;
        const vb = cb ? cb.time : null;
        if (va !== vb) {
            if (va === null) return 1;
            if (vb === null) return -1;
            return vb - va;
        }
        return bySizeDesc(a, b);
    };
    const list: Array<{ id: string; time: number | null; current: boolean; bucket: Bucket }> = [];
    for (const [id, bucket] of buckets) {
        bucket.known.sort(byTimeDesc);
        // 大小未知那一档同样按时间排（它渲染在该组达标图之后，口径不一致会让「展开后顺序突变」）
        bucket.unknown.sort(byTimeDesc);
        list.push({ id, time: bucket.time, current: bucket.current, bucket });
    }
    list.sort((a, b) => {
        if (a.current !== b.current) return a.current ? -1 : 1;
        const au = a.id === UNNAMED_CONV_ID ? 1 : 0;
        const bu = b.id === UNNAMED_CONV_ID ? 1 : 0;
        if (au !== bu) return au - bu;
        return (b.time || 0) - (a.time || 0);
    });

    const sections: Array<ConvSection<T>> = list.map((x) => ({
        id: x.id,
        name: x.bucket.name,
        current: x.current,
        known: x.bucket.known,
        unknown: x.bucket.unknown,
    }));
    return { sections, grouped: sections.some((s) => !!s.name) };
}
