/**
 * 读取「当前会话的双方对话文本」（快捷回复匹配的输入）。
 *
 * ── 数据来源的优先级 ──────────────────────────────────────────────────────────
 *   ① **Vuex**：`$store.state.chat.messageList` —— 工作台是 Vue2 + Vuex 单页应用，
 *      当前会话的完整消息列表就在这里（`sniffConv.ts` 已用它做过图片归属，结论可靠）。
 *      这是首选：不经 DOM、不受虚拟滚动影响、切会话自动跟着换。
 *   ② **DOM 兜底**：使用者可在设置里填一个 CSS 选择器（如某个消息列表容器），
 *      用它取 innerText。留这个口子是因为宿主改版时 Vuex 路径可能失效，
 *      而选择器由使用者提供不需要我们猜。
 *   ③ 两者都拿不到 → 返回空文本，快捷按钮条自然不显示（不报错、不阻塞输入）。
 *
 * ── 主管税务机关（v26.10.26-v2）────────────────────────────────────────────────
 * 页面右侧栏「会话人信息 → 基础信息 → 企业信息 → 主管税务机关」是**会话属性**而不是
 * 一条消息，坐席常常要靠它（例如「南岳区税务局」→ 出对应话术）。真机实测（2026-10-26，
 * Edge + 征纳互动页）取值链：`$store.state.chat.selectItem.taxguideRecord.swjgMc`
 * （小写 `swjgmc` 同值，实测值 `国家税务总局衡阳市南岳区税务局税源管理股`）。
 * 它**追加**到匹配文本末尾，且**不占**「最近 6 条消息」的配额（它不是消息）。
 *
 * ⚠️ 隐私硬约束：本模块**只读本地**，结果只在内存里参与子串匹配，
 *    绝不写日志全文、绝不发网络请求（日志只记来源、条数与「有没有税务机关」布尔值）。
 *
 * ⚠️ 性能：宿主是低配实机，`messageList` 只做一层遍历（不递归、不扫组件树），
 *    单次取最近 MAX_MESSAGES 条；DOM 兜底由调用方按间隔重试而非每次输入都读。
 */

/**
 * 参与匹配的消息条数上限（使用者 2026-10-23 定版：**只看最新 6 条**）。
 *
 * 为什么是 6 而不是更多：坐席的回复只跟最近几句话有关，把整场对话都拼进来反而
 * 会命中过时的关键词（半小时前聊过「注销」，现在聊「解非」，不该同时出两个按钮）。
 * 从最新往回数，**只数有文本的消息**（图片/文件/撤回提示等不占槽，见 fromStore）。
 * 主管税务机关不是消息，**不占**这个配额（单独追加在末尾）。
 */
const MAX_MESSAGES = 6;

export interface ConvSnapshot {
    /** 拼好的对话文本（已含主管税务机关；只用于本地子串匹配） */
    text: string;
    /** 来源标识，写日志用：vuex / dom / none */
    source: string;
    /** 参与拼接的消息条数（DOM 兜底时恒为 1，表示一整块文本） */
    count: number;
    /** 主管税务机关全称，已并入 text（取不到时为空串） */
    org: string;
}

const EMPTY: ConvSnapshot = { text: '', source: 'none', count: 0, org: '' };

/** 页面主世界的 document（沙箱里 document 可能被代理拦截，用 unsafeWindow 的兜底）。
 *  导出供 `magicVars.ts` 等同链路模块复用，别复制第二份。 */
export function hostDoc(): Document | null {
    try {
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow?.document) return unsafeWindow.document;
    } catch {
        /* 沙箱代理拒绝时退回下面的 document */
    }
    return typeof document !== 'undefined' ? document : null;
}

interface VueInstance {
    $store?: { state?: Record<string, unknown> };
}

/** 页面 Vue2 根实例。导出供 `magicVars.ts` 复用（正在对话人数也走这条取值链）。 */
export function readVueInstance(): VueInstance | null {
    const docs: Array<Document | null> = [hostDoc(), typeof document !== 'undefined' ? document : null];
    for (const d of docs) {
        if (!d) continue;
        try {
            const el = d.querySelector('#app') as (Element & { __vue__?: VueInstance }) | null;
            const vm = el && el.__vue__;
            if (vm && vm.$store && vm.$store.state) return vm;
        } catch {
            /* 换下一个 document 再试 */
        }
    }
    return null;
}

/** 从一条消息对象里尽力取出文本（腾讯 IM 的 TIMTextElem 在 payload.text） */
function textOfMessage(msg: unknown): string {
    if (!msg || typeof msg !== 'object') return '';
    const m = msg as Record<string, unknown>;
    const payload = (m['payload'] || {}) as Record<string, unknown>;
    for (const v of [payload['text'], m['text'], m['content'], m['msg'], payload['content'], payload['msg']]) {
        if (typeof v === 'string' && v.trim()) return v;
    }
    return '';
}

/**
 * 从 Vuex 读「主管税务机关」全称；取不到返回空串。
 *
 * 取值链（2026-10-26 真机实测）：`chat.selectItem.taxguideRecord.swjgMc`，
 * 空则回退同值的全小写 `swjgmc`；结果 trim。**永不抛错**（未进会话 / 宿主改版都只是空串）。
 */
export function readOrg(): string {
    try {
        const vm = readVueInstance();
        const st = vm?.$store?.state;
        if (!st) return '';
        const chat = st['chat'] as Record<string, unknown> | undefined;
        const selectItem = chat ? chat['selectItem'] : undefined;
        const guide = selectItem ? (selectItem as Record<string, unknown>)['taxguideRecord'] : undefined;
        if (!guide || typeof guide !== 'object') return '';
        const rec = guide as Record<string, unknown>;
        for (const key of ['swjgMc', 'swjgmc']) {
            const v = rec[key];
            if (typeof v === 'string' && v.trim()) return v.trim();
        }
        return '';
    } catch {
        return '';
    }
}

/** 从 Vuex 读当前会话消息：从最新往回收集有文本的，最多 MAX_MESSAGES 条 */
function fromStore(): ConvSnapshot {
    const vm = readVueInstance();
    const st = vm?.$store?.state;
    if (!st) return EMPTY;
    const chat = st['chat'] as Record<string, unknown> | undefined;
    const list = chat ? chat['messageList'] : undefined;
    if (!Array.isArray(list) || !list.length) return EMPTY;

    // ⚠️ 从尾部往回数（最新在前），**无文本的消息直接跳过不占槽** ——
    //    使用者定版「图片不计算」：连发 5 张图 + 1 句话，参与匹配的仍是那 1 句话
    const parts: string[] = [];
    for (let i = list.length - 1; i >= 0 && parts.length < MAX_MESSAGES; i--) {
        const t = textOfMessage(list[i]);
        if (t) parts.unshift(t);
    }
    if (!parts.length) return EMPTY;
    return { text: parts.join('\n'), source: 'vuex', count: parts.length, org: '' };
}

/** DOM 兜底：用使用者提供的选择器取整块文本 */
function fromSelector(selector: string): ConvSnapshot {
    if (!selector) return EMPTY;
    const docs: Array<Document | null> = [hostDoc(), typeof document !== 'undefined' ? document : null];
    for (const d of docs) {
        if (!d) continue;
        try {
            const el = d.querySelector(selector);
            const t = el && el.textContent ? el.textContent.trim() : '';
            if (t) return { text: t, source: 'dom', count: 1, org: '' };
        } catch {
            /* 选择器非法或沙箱拦截：当作没配 */
        }
    }
    return EMPTY;
}

/** 把税务机关追加到对话文本末尾（任一侧为空时另一侧原样）。 */
function joinOrg(text: string, org: string): string {
    if (!org) return text;
    return text ? text + '\n' + org : org;
}

/**
 * 读取当前会话文本。
 *
 * 税务机关**总是**并入结果：对话文本为空、但取到了税务机关时，返回的 text 也非空 ——
 * 这样「只靠税务机关关键词」的规则在对话为空时也能命中（使用者 2026-10-26 选 C 的语义）。
 *
 * @param selector 可选的 DOM 兜底选择器（设置项，空串表示不用）
 */
export function readConversation(selector = ''): ConvSnapshot {
    const org = readOrg();
    const store = fromStore();
    const base = store.text ? store : fromSelector(selector);
    const text = joinOrg(base.text, org);
    // 对话与税务机关都没取到 ⇒ 才是真的空
    if (!text) return EMPTY;
    // 只有税务机关有内容时来源记 'org'（写日志用，不涉及文本内容）
    const source = base.text ? base.source : 'org';
    return { text, source, count: base.count, org };
}
