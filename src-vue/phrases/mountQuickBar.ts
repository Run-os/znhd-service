import { createApp, h, ref, type App as VueApp } from 'vue';
import css from '../style.css?inline';
import { registerTailwindProperties } from '../main';
import QuickBar from './QuickBar.vue';
import { addLog } from '@/lib/logger';
import { replaceToTinyMCE } from '@/lib/tinymce';
import { getRules } from '@/lib/feishu/service';
import { loadRulesCache } from '@/lib/feishu/credentials';
import { matchRules } from '@/lib/feishu/match';
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
 * `.input-tinymce` 是 TinyMCE 的挂载点，全页仅一个（见 docs/tinymce-send-doc.md）。
 * 把 host 插到它**前面**（同一父节点内），视觉上就落在输入框正上方。
 * 不插到 TinyMCE 内部、也不插到页面底部再 fixed 定位：输入区常带滚动/贴底布局，
 * fixed 会飘到不相关的位置。
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
 */

const HOST_ID = '__znhd_quick_reply_host__';
const INPUT_SEL = '.input-tinymce';
/** 自愈轮询间隔 */
const MOUNT_POLL_MS = 1000;
/** 匹配轮询间隔 */
const MATCH_POLL_MS = 3000;

/** 命中规则（响应式，供 Vue 渲染） */
const hits = ref<QuickReplyRule[]>([]);

let app: VueApp | null = null;
let mountTimer: ReturnType<typeof setInterval> | null = null;
let matchTimer: ReturnType<typeof setInterval> | null = null;

/** 上次参与匹配的文本指纹，用于跳过无变化的重算 */
let lastFingerprint = '';
/** 规则的内存副本 + 它来自哪一份磁盘缓存（`RulesCache.fetchedAt`，0 = 从没读到过） */
let rulesCopy: QuickReplyRule[] = [];
let rulesStamp = 0;
/** 回源失败后的冷却截止时间（见 ensureRules 里的退避说明） */
let rulesRetryAt = 0;
/** 回源失败冷却时长：60s（1 次/分钟，避免掉线时每 3s 打一次接口） */
const RULES_RETRY_MS = 60 * 1000;

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
 */
function syncRulesFromCache(): void {
    const cache = loadRulesCache();
    const stamp = cache?.fetchedAt || 0;
    if (stamp === rulesStamp) return;
    rulesStamp = stamp;
    rulesCopy = cache?.rules ?? [];
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

/** 点按钮：整体替换输入框内容 */
function onPick(rule: QuickReplyRule): void {
    // 表里只填了「标题」没填「内容」时，replaceToTinyMCE 会返回空串 —— 那种情况下
    // 报「输入框未就绪」会把使用者引到错误方向，这里单独提示
    if (!rule.reply.trim()) {
        toast.error('该规则没有填写「内容」列：' + rule.title);
        return;
    }
    const finalText = replaceToTinyMCE(rule.reply);
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

function mountInto(inputEl: Element): HTMLElement {
    const host = document.createElement('div');
    host.id = HOST_ID;
    // 防御性盒样式：host 暴露在页面 CSS 下（通配规则会命中它），宽度撑满以便按钮条横滑
    host.style.cssText =
        'display:block;width:100%;box-sizing:border-box;margin:0;padding:0;' +
        'background:none;border:0;box-shadow:none;outline:none;border-radius:0;';
    inputEl.parentElement?.insertBefore(host, inputEl);

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
        render: () => h(QuickBar, { rules: hits.value, onPick }),
    });
    app.mount(container);
    return host;
}

function tryMount(): boolean {
    if (document.getElementById(HOST_ID)?.isConnected) return true;
    unmountHost();
    const inputEl = document.querySelector(INPUT_SEL);
    if (!inputEl || !inputEl.parentElement) return false;
    mountInto(inputEl);
    return true;
}

/** 读对话文本 → 匹配 → 更新按钮条 */
async function refreshMatches(): Promise<void> {
    // 先对齐规则（磁盘缓存可能刚被设置面板刷新过），再做文本指纹判断
    syncRulesFromCache();

    let selector = '';
    try {
        selector = (loadAllvalue() as Record<string, unknown>)['quickReplyConversationSelector'] as string;
    } catch {
        /* 读设置失败按未配置处理 */
    }

    const snap = readConversation(typeof selector === 'string' ? selector : '');
    if (!snap.text) {
        if (lastFingerprint) {
            lastFingerprint = '';
            hits.value = [];
        }
        return;
    }

    const fp = fingerprint(snap.text);
    if (fp === lastFingerprint) return;

    await ensureRules();
    if (!rulesCopy.length) {
        // 规则一条都没拿到（未授权 / 掉线且无缓存）：清空按钮，且**不锁指纹**，
        // 冷却期一过还能自动重试（锁住指纹的话文本不变就永远不会再试）
        lastFingerprint = '';
        if (hits.value.length) hits.value = [];
        return;
    }
    lastFingerprint = fp;

    const matched = matchRules(snap.text, rulesCopy);
    // 只有真正变化才写 ref，避免每 3 秒触发一次无意义的重渲染
    const before = hits.value.map((r) => r.id).join(',');
    const after = matched.map((r) => r.id).join(',');
    if (before !== after) {
        hits.value = matched;
        if (matched.length) addLog('常用语快捷按钮命中：' + matched.map((r) => r.title).join('、'), 'info');
    }
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
    rulesCopy = [];
    rulesStamp = 0;
    rulesRetryAt = 0;
    hits.value = [];
    unmountHost();
}
