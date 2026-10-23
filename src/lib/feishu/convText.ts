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
 * ⚠️ 隐私硬约束：本模块**只读本地**，结果只在内存里参与子串匹配，
 *    绝不写日志全文、绝不发网络请求（日志只记来源与条数）。
 *
 * ⚠️ 性能：宿主是低配实机，`messageList` 只做一层遍历（不递归、不扫组件树），
 *    单次取最近 MAX_MESSAGES 条；DOM 兜底由调用方按间隔重试而非每次输入都读。
 */

/** 参与匹配的最大消息条数（从最新往前取；再早的对话几乎不会触发话术） */
const MAX_MESSAGES = 200;

export interface ConvSnapshot {
    /** 拼好的对话文本（只用于本地子串匹配） */
    text: string;
    /** 来源标识，写日志用：vuex / dom / none */
    source: string;
    /** 参与拼接的消息条数（DOM 兜底时恒为 1，表示一整块文本） */
    count: number;
}

const EMPTY: ConvSnapshot = { text: '', source: 'none', count: 0 };

/** 页面主世界的 document（沙箱里 document 可能被代理拦截，用 unsafeWindow 的兜底） */
function hostDoc(): Document | null {
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

/** 页面 Vue2 根实例 */
function readVueInstance(): VueInstance | null {
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

/** 从 Vuex 读当前会话消息 */
function fromStore(): ConvSnapshot {
    const vm = readVueInstance();
    const st = vm?.$store?.state;
    if (!st) return EMPTY;
    const chat = st['chat'] as Record<string, unknown> | undefined;
    const list = chat ? chat['messageList'] : undefined;
    if (!Array.isArray(list) || !list.length) return EMPTY;

    const recent = list.length > MAX_MESSAGES ? list.slice(list.length - MAX_MESSAGES) : list;
    const parts: string[] = [];
    for (const msg of recent) {
        const t = textOfMessage(msg);
        if (t) parts.push(t);
    }
    if (!parts.length) return EMPTY;
    return { text: parts.join('\n'), source: 'vuex', count: parts.length };
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
            if (t) return { text: t, source: 'dom', count: 1 };
        } catch {
            /* 选择器非法或沙箱拦截：当作没配 */
        }
    }
    return EMPTY;
}

/**
 * 读取当前会话文本。
 * @param selector 可选的 DOM 兜底选择器（设置项，空串表示不用）
 */
export function readConversation(selector = ''): ConvSnapshot {
    const store = fromStore();
    if (store.text) return store;
    const dom = fromSelector(selector);
    if (dom.text) return dom;
    return EMPTY;
}
