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
}

/** 面板上的一个分组（渲染层只是把它画出来，排序/分桶的规则都在本模块） */
export interface ConvSection<T> {
    /** 会话 ID；'' = 未归属（面板显示「未归属会话」） */
    id: string;
    /** 会话名；'' 表示未归属 */
    name: string;
    /** 是否当前会话（面板加「当前会话」标签） */
    current: boolean;
    /** 达标（≥ 阈值）的图，组内按体积从大到小 */
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

/** ID 的短尾（给「取不到会话名」时的兜底显示用，如 `会话 aPKJKKK1`） */
function shortId(id: string): string {
    return id.length > 8 ? id.slice(-8) : id;
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
function toConv(msg: Record<string, unknown>, ctx: WalkCtx, current: SniffConv | null): SniffConv | null {
    const id = str(msg.conversationID) || str(msg.conversationId) || str(msg.sessionID) || ctx.id;
    let name = str(msg.conversationName) || str(msg.groupName) || ctx.name;
    if (!name && current && id && id === current.id) name = current.name;
    // 三者都拿不到就归 null：那不是「未知会话」，而是**根本不知道属于谁**，
    // 调用方会让这些图落到「未归属」分组（与页面上压根没有会话概念的图同一个去处）。
    if (!id && !name) return null;
    const key = id || 'name:' + name;
    return {
        id: key,
        name: name || '会话 ' + shortId(key),
        sender: str(msg.sendUserName) || ctx.sender,
        time: num(msg.time),
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

/** 载入未过期的持久映射（过期/坏值直接跳过，不报错） */
function loadStoredConv(): Array<[string, SniffConv]> {
    const out: Array<[string, SniffConv]> = [];
    const bucket = readBucket();
    if (!bucket) return out;
    const now = Date.now();
    for (const k of Object.keys(bucket.items)) {
        const r = bucket.items[k];
        if (!r || typeof r.id !== 'string' || !r.id) continue;
        if (!Number.isFinite(r.at) || now - r.at > CONFIG.SNIFF_CONV_TTL) continue;
        out.push([
            k,
            {
                id: r.id,
                name: typeof r.name === 'string' && r.name ? r.name : '会话 ' + shortId(r.id),
                sender: typeof r.sender === 'string' ? r.sender : null,
                time: num(r.time),
            },
        ]);
    }
    return out;
}

/** 保存映射（合并 → 清过期 → 超限按最旧丢）。任何失败都只记日志，不影响扫描 */
function saveStoredConv(fresh: Array<[string, SniffConv]>): void {
    try {
        const now = Date.now();
        const bucket: StoredBucket = readBucket() || { origin: location.origin, items: {} };
        bucket.origin = location.origin;
        for (const [stem, conv] of fresh) {
            bucket.items[stem] = { id: conv.id, name: conv.name, sender: conv.sender, time: conv.time, at: now };
        }
        for (const k of Object.keys(bucket.items)) {
            const r = bucket.items[k];
            if (!r || !Number.isFinite(r.at) || now - r.at > CONFIG.SNIFF_CONV_TTL) delete bucket.items[k];
        }
        const keys = Object.keys(bucket.items);
        const max = CONFIG.MAX_SNIFF_CONV_STEMS;
        if (keys.length > max) {
            keys.sort((a, b) => (bucket.items[a].at || 0) - (bucket.items[b].at || 0));
            for (const k of keys.slice(0, keys.length - max)) delete bucket.items[k];
        }
        localStorage.setItem(SNIFF_CONV_INDEX_KEY, JSON.stringify(bucket));
    } catch (e) {
        addLog('[图片嗅探] 会话归属记录保存失败: ' + e.message, 'error', true);
    }
}

/**
 * 建一次扫描要用的归属上下文：**页面 Vuex（当前会话消息 → 历史会话）优先，持久记录补空缺**。
 * 每次扫描重建（页面数据是最新真相），创建阶段不发网络请求、不做 DOM 扫描，纯读。
 */
export function buildConvContext(): ConvContext {
    const current = getCurrentConv();
    const byStem = new Map<string, SniffConv>();
    const fresh: Array<[string, SniffConv]> = [];

    const out = (msg: Record<string, unknown>, ctx: WalkCtx): void => {
        const conv = toConv(msg, ctx, current);
        if (!conv) return;
        const payload = msg.payload as Record<string, unknown>;
        for (const k of stemsOfPayload(payload)) {
            // 先到先得：当前会话先遍历，故同名文件以当前会话为准；历史会话再来只补空缺
            if (byStem.has(k)) continue;
            byStem.set(k, conv);
            fresh.push([k, conv]);
        }
    };

    const st = readChatState();
    const chat = st && (st.chat as Record<string, unknown> | undefined);
    if (chat) {
        // ① 当前会话：结构已实测，最可靠的一路
        const seed: WalkCtx = { id: current ? current.id : '', name: current ? current.name : '', sender: null };
        walkAny(chat.messageList, seed, 0, out);
    }
    const allChat = st && (st.allChat as Record<string, unknown> | undefined);
    if (allChat) {
        // ② 历史会话：嵌套结构未实测（见文件头「现场待确认」），靠宽容遍历
        walkAny(allChat.historyMsg, { id: '', name: '', sender: null }, 0, out);
    }

    const fromPage = byStem.size;
    // ③ 持久记录只补空缺：页面读到的一定更新（会话可能改名、也可能这次不在页面上）
    for (const [k, v] of loadStoredConv()) {
        if (!byStem.has(k)) byStem.set(k, v);
    }
    if (byStem.size) {
        addLog(
            '[图片嗅探] 会话归属：本次从页面读到 ' +
                fromPage +
                ' 个文件名（含历史记录共 ' +
                byStem.size +
                ' 个；' +
                (current ? '当前会话「' + current.name + '」' : '当前会话未识别') +
                '）',
            'info'
        );
    }
    return { current, byStem, fresh };
}

/** 把本次从页面读到的映射写进持久层（没有新映射时不写，避免无谓的 localStorage 写入） */
export function persistConvContext(ctx: ConvContext): void {
    if (!ctx.fresh.length) return;
    saveStoredConv(ctx.fresh);
}

/** 取一张图归属的会话（未归属返回 null） */
function convOfItem(it: { stem: string }, ctx: ConvContext | null): SniffConv | null {
    if (!ctx || !it.stem) return null;
    return ctx.byStem.get(it.stem) || null;
}

/** 分组用的最小结构约束（只要求「有 stem 与 size」——本模块不认识 SniffedImage 的其它字段） */
export interface GroupableImage {
    stem: string;
    size: number | null;
}

/**
 * 把嗅探结果按会话分组。
 *
 * 排序规则（用户没指定，按「最可能想看的排最前」定）：
 *   ① 当前会话置顶；② 其余会话按最新消息时间倒序；③ 未归属永远排最后。
 * 组内：达标图按体积从大到小（沿用原有的展示习惯），大小未知的单独一档。
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

    const bucketOf = (conv: SniffConv | null): Bucket => {
        const id = conv ? conv.id : UNNAMED_CONV_ID;
        let b = buckets.get(id);
        if (!b) {
            b = {
                name: conv ? conv.name : '',
                current: !!(conv && ctx && ctx.current && ctx.current.id === conv.id),
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

    const bySizeDesc = (a: T, b: T): number => (b.size === null ? 0 : b.size) - (a.size === null ? 0 : a.size);
    const list: Array<{ id: string; time: number | null; current: boolean; bucket: Bucket }> = [];
    for (const [id, bucket] of buckets) {
        bucket.known.sort(bySizeDesc);
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
