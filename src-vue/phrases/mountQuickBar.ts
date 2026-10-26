import { createApp, h, ref, type App as VueApp } from 'vue';
import css from '../style.css?inline';
import { registerTailwindProperties } from '../main';
import { applyThemeVars } from '../../shared/ui/theme';
import QuickBar from './QuickBar.vue';
import { addLog } from '@/lib/logger';
import { replaceToTinyMCE } from '@/lib/tinymce';
import { getPrivacyRules, getPrivacyTableUrl, getRules } from '@/lib/feishu/service';
import { loadPrivacyRulesCache, loadRulesCache } from '@/lib/feishu/credentials';
import { matchRules } from '@/lib/feishu/match';
import { expandMagicVars } from '@/lib/feishu/magicVars';
import { readConversation } from '@/lib/feishu/convText';
import type { QuickReplyRule } from '@/lib/feishu/types';
import { loadAllvalue } from '@/lib/storage';
import { toast } from '../lib/toast';

/**
 * 把快捷回复按钮条挂到会话输入框**上方**（v26.10.23）。
 *
 * ── 挂载范式 ──────────────────────────────────────────────────────────────────
 * 与 `panel/navBarMount.ts` 完全一致：host（普通 div）→ shadowRoot(open) → <style> → #app。
 * 用 shadow DOM 隔离税务页的全局 CSS（通配 line-height / box-sizing），
 * 同时直接复用自家 Tailwind 产物，样式零额外维护。
 *
 * ── 锚点 ──────────────────────────────────────────────────────────────────────
 * 锚点 = **Inputbox 组件的根元素**（`.input-tinymce.__vue__.$parent.$el`，v26.10.23-v2 起）。
 * znhd 的输入区 = 工具栏（表情/截图那一排）+ TinyMCE 编辑器，同属 Inputbox 组件；
 * v1 曾直接插在 `.input-tinymce` 之前，按钮条卡在工具栏和编辑器中间、像长在输入框里。
 * 现在插在 Inputbox 根元素之前 = 整个输入区（含工具栏）的外面上方。
 * 不插到 TinyMCE 内部、也不用 fixed 定位：输入区常带滚动/贴底布局，fixed 会飘走。
 *
 * ── 自愈 ──────────────────────────────────────────────────────────────────────
 * 宿主是 SPA：切会话 / 路由切换会整块替换输入区 DOM，我们的 host 会跟着消失。
 * 每秒一次 `querySelector` + `isConnected` 判断即可（比监听整个 subtree 便宜得多），
 * 与导航条注入采用同一策略。
 *
 * ── 匹配节奏 ──────────────────────────────────────────────────────────────────
 * 每 3 秒读一次当前会话文本并重算命中规则。为什么不是每次输入都算：
 * 对话由**对方**推进，跟坐席打字无关；3 秒足够及时，又不会在低配实机上造成抖动。
 * 文本没变（长度与首尾字符都相同）时直接跳过重算。
 *
 * ── 规则副本怎么同步（v26.10.23 定稿） ────────────────────────────────────────
 * 不用模块间事件/回调，而是每次 tick **比对磁盘缓存的 `fetchedAt` 戳**：
 *   · 单一时钟：能不能回源由 `service.getRules()` 的 TTL 决定，这里不再自己算一份 TTL；
 *   · 设置面板点「立即刷新规则」/ 刚授权完，写的就是同一份缓存 ⇒ 下一个 tick（≤3s）自动生效，
 *     不会出现「点了刷新但按钮条还是老规则，得等 5 分钟」；
 *   · 也不需要 `panel → phrases` 的 import（那会把 `main.ts` 拉进循环 import，见 AGENT.md 的 TDZ 坑）。
 *
 * ── 三段内容（v26.10.25-v1，v26.10.26-v2 起隐私表也参与匹配）─────────────────────
 *   · `pinned`：规则表「是否常显」= true 的条目 —— 无视一切匹配条件（标签 / 必含关键词 /
 *     剔除关键词）、**对话文本为空也显示**，随规则副本（fetchedAt 戳）同步；
 *   · `rules`：普通命中（matchRules 结果里按 id 去掉 pinned，避免与常显段重复显示）；
 *   · `privacyPinned` + `privacy`：独立「隐私信息」表格的条目，**与主表同一套匹配**
 *     （标签 + 必含关键词 + 剔除关键词）；只有「是否常显」勾了的才常显 ——
 *     速查项请勾「是否常显」，否则它会像主表一样只在命中时出现。
 */

const HOST_ID = '__znhd_quick_reply_host__';
const INPUT_SEL = '.input-tinymce';
/** 自愈轮询间隔 */
const MOUNT_POLL_MS = 1000;
/** 匹配轮询间隔 */
const MATCH_POLL_MS = 3000;

/** 普通命中规则（响应式，供 Vue 渲染） */
const hits = ref<QuickReplyRule[]>([]);
/** 常显规则（pinned：无视一切匹配条件，对话为空也显示） */
const pinnedHits = ref<QuickReplyRule[]>([]);
/** 隐私信息里「是否常显」勾了的条目（无视一切匹配条件，对话为空也显示） */
const privacyPinnedHits = ref<QuickReplyRule[]>([]);
/** 隐私信息里匹配命中的条目（已按 id 去掉 pinned） */
const privacyHits = ref<QuickReplyRule[]>([]);

let app: VueApp | null = null;
let mountTimer: ReturnType<typeof setInterval> | null = null;
let matchTimer: ReturnType<typeof setInterval> | null = null;

/** 上次参与匹配的文本指纹，用于跳过无变化的重算 */
let lastFingerprint = '';
/** 上次渲染的 pinned id 序列（pinned 不吃文本指纹，只随规则副本同步） */
let pinnedFingerprint = '';
/** 上次渲染的隐私 pinned id 序列 */
let privacyPinnedFingerprint = '';
/** 规则的内存副本 + 它来自哪一份磁盘缓存（`RulesCache.fetchedAt`，0 = 从没读到过） */
let rulesCopy: QuickReplyRule[] = [];
let rulesStamp = 0;
/** 回源失败后的冷却截止时间（见 ensureRules 里的退避说明） */
let rulesRetryAt = 0;
/** 回源失败冷却时长：60s（1 次/分钟，避免掉线时每 3s 打一次接口） */
const RULES_RETRY_MS = 60 * 1000;
/** 隐私表格的内存副本 + 磁盘缓存戳 + 回源冷却（与主规则同一套节奏） */
let privacyRulesCopy: QuickReplyRule[] = [];
let privacyStamp = 0;
let privacyRetryAt = 0;

/** 文本指纹：长度 + 首尾字符。对话变了几乎必然改变其中之一，比整串比较便宜 */
function fingerprint(text: string): string {
    return text.length + '|' + text.slice(0, 8) + '|' + text.slice(-8);
}

/**
 * 磁盘缓存变了就把内存副本换掉。
 *
 * 判据是 `fetchedAt` 戳（不是 mtime、也不是「距上次读多久」）：
 * 设置面板的「立即刷新规则」「授权完成自动拉一次」写的都是这份缓存，
 * 所以只要戳变了就说明规则确实更新过 —— 此时必须把指纹清空，否则文本没变会跳过重算。
 * pinned 随同一份副本走（syncRulesFromCache 清指纹即可让下个 tick 重算 pinned 序列）。
 */
function syncRulesFromCache(): void {
    const cache = loadRulesCache();
    const stamp = cache?.fetchedAt || 0;
    if (stamp === rulesStamp) return;
    rulesStamp = stamp;
    rulesCopy = cache?.rules ?? [];
    lastFingerprint = '';
    pinnedFingerprint = '';
}

/** 隐私缓存戳变了就换隐私内存副本（未配置链接时磁盘缓存恒为空，天然 no-op） */
function syncPrivacyFromCache(): void {
    const cache = loadPrivacyRulesCache();
    const stamp = cache?.fetchedAt || 0;
    if (stamp === privacyStamp) return;
    privacyStamp = stamp;
    privacyRulesCopy = cache?.rules ?? [];
    privacyPinnedFingerprint = '';
    // 隐私副本换了 ⇒ 命中结果要重算：指纹里带了 privacyStamp，值变了自然重算；
    // 这里再清一次是为了「戳相同但副本被换」的极端情况也不留旧命中
    lastFingerprint = '';
}

/**
 * 需要回源时把规则补上；**永不抛错**（未授权 / token 失效 / 网络故障都不该影响打字）。
 *
 * 回源失败时：① 退回磁盘上的旧规则（哪怕已过期）——总比一条按钮都不显示强；
 * ② 把 `rulesStamp` 对齐当前磁盘状态 ⇒ 磁盘没变就不重复回源；
 * ③ 再设 60s 冷却（`rulesRetryAt`），掉线期间最多 1 次/分钟，不会变成请求风暴。
 */
async function ensureRules(): Promise<void> {
    if (rulesCopy.length) return;
    if (Date.now() < rulesRetryAt) return;
    try {
        rulesCopy = await getRules(false);
        rulesRetryAt = 0;
    } catch (e) {
        rulesCopy = loadRulesCache()?.rules ?? [];
        rulesRetryAt = Date.now() + RULES_RETRY_MS;
        if (!rulesCopy.length) addLog('快捷回复规则不可用：' + (e as Error)?.message, 'warning');
    }
    rulesStamp = loadRulesCache()?.fetchedAt || 0;
}

/**
 * 需要回源时把隐私条目补上；**永不抛错**。
 * 未配置链接时是静默 no-op（不设冷却 —— 配置后下个 tick 立即拉）；
 * 回源失败 60s 冷却同 ensureRules。
 */
async function ensurePrivacyRules(): Promise<void> {
    syncPrivacyFromCache();
    if (privacyRulesCopy.length) return;
    if (Date.now() < privacyRetryAt) return;
    if (!getPrivacyTableUrl()) return;
    try {
        privacyRulesCopy = await getPrivacyRules(false);
        privacyRetryAt = 0;
    } catch (e) {
        privacyRulesCopy = loadPrivacyRulesCache()?.rules ?? [];
        privacyRetryAt = Date.now() + RULES_RETRY_MS;
        if (!privacyRulesCopy.length) addLog('隐私信息读取失败：' + (e as Error)?.message, 'warning');
    }
    privacyStamp = loadPrivacyRulesCache()?.fetchedAt || 0;
}

/** 点按钮：整体替换输入框内容 */
function onPick(rule: QuickReplyRule): void {
    // 表里只填了「标题」没填「内容」时，replaceToTinyMCE 会返回空串 —— 那种情况下
    // 报「输入框未就绪」会把使用者引到错误方向，这里单独提示
    if (!rule.reply.trim()) {
        toast.error('该规则没有填写「内容」列：' + rule.title);
        return;
    }
    // 魔法变量（v26.10.25-v1）在**点击时刻**展开：人数等取值必须新鲜，不能提前算好缓存
    const finalText = replaceToTinyMCE(expandMagicVars(rule.reply));
    if (finalText) toast.success('已填入：' + rule.title);
    else toast.error('输入框未就绪，请稍后重试');
}

function unmountHost(): void {
    try {
        app?.unmount();
    } catch {
        /* 重复卸载忽略 */
    }
    app = null;
    document.getElementById(HOST_ID)?.remove();
}

function mountInto(anchorEl: HTMLElement): HTMLElement {
    const host = document.createElement('div');
    host.id = HOST_ID;
    // 防御性盒样式：host 暴露在页面 CSS 下（通配规则会命中它），宽度撑满以便按钮条横滑
    host.style.cssText =
        'display:block;width:100%;box-sizing:border-box;margin:0;padding:0;' +
        'background:none;border:0;box-shadow:none;outline:none;border-radius:0;';
    anchorEl.parentElement!.insertBefore(host, anchorEl);

    // 品牌色注入（v26.10.25-v8 单一事实源 = shared/ui/theme.ts）：与 main.ts / navBarMount
    // 同理，独立 shadow 树各自注入一次，首帧前生效。
    applyThemeVars(host);

    const shadowRoot = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = css;
    registerTailwindProperties(style);
    shadowRoot.appendChild(style);

    const container = document.createElement('div');
    container.id = 'app';
    // 同 main.ts：daisyUI 的 [data-theme] 会给挂载点刷底色，必须钉死透明，否则出现白块
    container.style.setProperty('background-color', 'transparent', 'important');
    shadowRoot.appendChild(container);

    app = createApp({
        render: () =>
            h(QuickBar, {
                pinned: pinnedHits.value,
                rules: hits.value,
                privacyPinned: privacyPinnedHits.value,
                privacy: privacyHits.value,
                onPick,
            }),
    });
    app.mount(container);
    return host;
}

function tryMount(): boolean {
    if (document.getElementById(HOST_ID)?.isConnected) return true;
    unmountHost();
    const anchor = findAnchor();
    if (!anchor) return false;
    mountInto(anchor);
    return true;
}

/**
 * 找挂载锚点：**输入组件（Inputbox）根元素**，按钮条插在它外面、正上方。
 *
 * v26.10.23-v1 直接插在 `.input-tinymce` 之前，视觉上卡在工具栏和编辑器之间，
 * 看着像长在输入框里面；v2 改成走 Vue 组件树：`.input-tinymce.__vue__.$parent`
 * 就是 Inputbox 组件（docs/tinymce-send-doc.md §1 实测），它的 `$el` 把工具栏 +
 * 编辑器整块包住 —— 插在 `$el` 之前 = 整个输入区（含工具栏）的上方。
 * 找不到组件树时回退旧行为（插在 `.input-tinymce` 之前），至少保证功能可用。
 */
function findAnchor(): HTMLElement | null {
    const inputEl = document.querySelector(INPUT_SEL);
    if (!inputEl) return null;
    const vm = (inputEl as Element & { __vue__?: { $parent?: { $el?: unknown } } }).__vue__;
    const root = vm?.$parent?.$el;
    if (root instanceof HTMLElement && root.parentElement) return root;
    return inputEl.parentElement ? (inputEl as HTMLElement) : null;
}

/** 读对话文本 → 匹配 → 更新按钮条 */
async function refreshMatches(): Promise<void> {
    // 先对齐规则（磁盘缓存可能刚被设置面板刷新过），再做文本指纹判断
    syncRulesFromCache();

    // 规则与隐私条目的回源不依赖对话内容：对话为空时 pinned / 隐私栏仍要能显示，
    // 所以 ensure* 放在指纹判断之前（内部都有「已有副本直接返回」的早退，稳态零开销）
    await ensureRules();
    await ensurePrivacyRules();

    // pinned 只随规则副本同步：副本变了（syncRulesFromCache 已清指纹）就重算序列
    const pinnedNow = rulesCopy.filter((r) => r.pinned);
    const pinnedIds = pinnedNow.map((r) => r.id).join(',');
    if (pinnedIds !== pinnedFingerprint) {
        pinnedFingerprint = pinnedIds;
        pinnedHits.value = pinnedNow;
    }

    // 隐私表的 pinned 同样只随隐私缓存副本同步（不吃文本指纹）
    const privacyPinnedNow = privacyRulesCopy.filter((r) => r.pinned);
    const privacyPinnedIds = privacyPinnedNow.map((r) => r.id).join(',');
    if (privacyPinnedIds !== privacyPinnedFingerprint) {
        privacyPinnedFingerprint = privacyPinnedIds;
        privacyPinnedHits.value = privacyPinnedNow;
    }

    let selector = '';
    try {
        selector = (loadAllvalue() as Record<string, unknown>)['quickReplyConversationSelector'] as string;
    } catch {
        /* 读设置失败按未配置处理 */
    }

    const snap = readConversation(typeof selector === 'string' ? selector : '');
    if (!snap.text) {
        // 对话文本为空（且没取到税务机关）：只清普通命中 —— pinned 两段照常显示
        if (lastFingerprint) lastFingerprint = '';
        if (hits.value.length) hits.value = [];
        if (privacyHits.value.length) privacyHits.value = [];
        return;
    }

    // 指纹 = 文本指纹 + 隐私缓存戳：snap.text 已含主管税务机关，所以税务机关变化会重算；
    // 隐私表是异步回源的，戳变了必须重算一次隐私命中（否则首次拉取成功也永远不显示）
    const fp = fingerprint(snap.text) + '#' + privacyStamp;
    if (fp === lastFingerprint) return;
    lastFingerprint = fp;

    // 主表普通命中里按 id 去掉 pinned：pinned 已单独显示，不能在这里再出现一遍
    if (!rulesCopy.length) {
        // 规则一条都没拿到（未授权 / 掉线且无缓存）：清空普通命中，且**不锁指纹**，
        // 冷却期一过还能自动重试（锁住指纹的话文本不变就永远不会再试）
        if (hits.value.length) hits.value = [];
        lastFingerprint = '';
    } else {
        const matched = matchRules(snap.text, rulesCopy).filter((r) => !r.pinned);
        // 只有真正变化才写 ref，避免每 3 秒触发一次无意义的重渲染
        const before = hits.value.map((r) => r.id).join(',');
        const after = matched.map((r) => r.id).join(',');
        if (before !== after) {
            hits.value = matched;
            // 日志只记命中的标题（不含对话正文），符合隐私约束
            if (matched.length) addLog('快捷短语命中：' + matched.map((r) => r.title).join('、'), 'info');
        }
    }

    // 隐私表：与主表同一套匹配，按 id 去掉 pinned（pinned 已在上面单独显示）
    const privacyMatched = privacyRulesCopy.length
        ? matchRules(snap.text, privacyRulesCopy).filter((r) => !r.pinned)
        : [];
    const pBefore = privacyHits.value.map((r) => r.id).join(',');
    const pAfter = privacyMatched.map((r) => r.id).join(',');
    if (pBefore !== pAfter) privacyHits.value = privacyMatched;
}

export function startQuickReplyBar(): void {
    if (mountTimer !== null) return;
    tryMount();
    mountTimer = setInterval(tryMount, MOUNT_POLL_MS);
    // 首轮稍等，避免和页面初始化抢资源
    setTimeout(() => void refreshMatches(), 2000);
    matchTimer = setInterval(() => void refreshMatches(), MATCH_POLL_MS);
}

export function stopQuickReplyBar(): void {
    if (mountTimer !== null) clearInterval(mountTimer);
    if (matchTimer !== null) clearInterval(matchTimer);
    mountTimer = null;
    matchTimer = null;
    lastFingerprint = '';
    pinnedFingerprint = '';
    privacyPinnedFingerprint = '';
    rulesCopy = [];
    rulesStamp = 0;
    rulesRetryAt = 0;
    privacyRulesCopy = [];
    privacyStamp = 0;
    privacyRetryAt = 0;
    hits.value = [];
    pinnedHits.value = [];
    privacyPinnedHits.value = [];
    privacyHits.value = [];
    unmountHost();
}
