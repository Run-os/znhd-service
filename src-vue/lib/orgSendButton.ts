import { addLog } from '@/lib/logger';
import { replaceToTinyMCE } from '@/lib/tinymce';
import { hostDoc, readOrg } from '@/lib/feishu/convText';
import { loadPrivacyRulesCache } from '@/lib/feishu/credentials';
import { matchByOrgText } from '@/lib/feishu/match';
import { expandMagicVars } from '@/lib/feishu/magicVars';
import type { QuickReplyRule } from '@/lib/feishu/types';
import { MARK, findOrgAnchor, readOrgFromDom } from './orgFieldDom';
import { toast } from './toast';

/**
 * 「主管税务机关」文本右侧的发送图标（v26.10.26-v4，使用者定版）。
 *
 * ── 需求 ──────────────────────────────────────────────────────────────────────
 * 隐私信息表格里某条规则的「必含关键词」与页面上显示的主管税务机关**文本相同**时，
 * 就在该文本右边挂一个发送图标；点击 = 把那条规则的「内容」写进 TinyMCE 输入框
 * （与快捷短语按钮同一套写入链路：`replaceToTinyMCE` + 点击时刻展开魔法变量）。
 *
 * ── 分工 ──────────────────────────────────────────────────────────────────────
 *   · `orgFieldDom.ts` —— 按文本定位「这一格值」的容器（纯 DOM 查询，无业务）；
 *   · 本文件 —— 轮询、决策、图标注入、点击写入。
 *
 * ── 为什么图标用 Shadow DOM ───────────────────────────────────────────────────
 * 注入的是站点 light DOM（站点带通配 line-height / box-sizing），20×20 会被撑歪。
 * shadow 内样式 + `:host` 钉死尺寸；颜色走 `currentColor`（跟随站点日/夜主题，**零硬编码色值**）。
 * 图标是**内联 SVG**（Heroicons `paper-airplane`，与传输助手入口同一几何数据）：Win7 没有
 * emoji 字体，禁止用 emoji 当图标；项目也只锁这一套描边图标。
 *
 * ── 节奏 ──────────────────────────────────────────────────────────────────────
 * 2s 一轮 tick。稳态（图标还挂着 + 全称没变 + 命中的规则 id 没变）**不做任何 DOM 扫描**，
 * 只读一次 Vuex 与本地规则缓存 —— 低配实机上开销可以忽略；只有切会话 / 规则表刷新才重扫。
 *
 * ── 隐私 ──────────────────────────────────────────────────────────────────────
 * 只读本地（Vuex + GM 缓存），**不发任何网络请求**；日志只记「挂了哪个标题 / 同词几条」，
 * 不记税务机关文本、不记规则内容。规则来源是隐私表磁盘缓存 —— 回源由快捷短语模块
 * （`mountQuickBar.ensurePrivacyRules`）负责，这里绝不触发 token 刷新：refresh_token 是一次性的，
 * 两个模块并发刷新会互相踢掉。
 */

/** 轮询间隔：切会话后最迟 2s 补上图标 */
const TICK_MS = 2000;

/** 图标：Heroicons 2 outline `paper-airplane`（与 src-vue/icons.ts 的 transfer 同源） */
const SVG =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' +
    'focusable="false"><path d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 ' +
    '59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5"/></svg>';

/**
 * 按钮样式（shadow 内，站点 CSS 进不来）。
 * ⚠️ 不用 `color-mix()` / `:has()`（基线 Chrome 88 / FF 85 / Safari 14 不支持）；
 *    颜色一律 `currentColor`，hover 只动透明度与位移，不引入新色值。
 */
const CSS = [
    ':host{display:inline-flex;align-items:center;justify-content:center;',
    'width:20px;height:20px;margin:0 0 0 6px;padding:0;line-height:0;vertical-align:middle;flex:none;}',
    'button{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;',
    'margin:0;padding:0;border:0;border-radius:4px;background:transparent;color:inherit;',
    'cursor:pointer;opacity:.55;transition:opacity .15s ease,transform .15s ease;}',
    'button:hover{opacity:1;transform:translateX(1px);}',
    'button:active{transform:scale(.92);}',
    'button:focus-visible{outline:2px solid currentColor;outline-offset:1px;opacity:1;}',
].join('');

let timer: number | null = null;
/** 当前挂着的图标（host）；null = 没挂 */
let host: HTMLSpanElement | null = null;
/** 挂图标时用的税务机关全称（用于判「要不要重扫」） */
let shownOrg = '';
/** 挂图标时命中的规则 id（规则表刷新后换了条 ⇒ 必须重建） */
let shownRuleId = '';

/** 把规则的「内容」写进输入框（与快捷短语按钮同一套：点击时刻展开魔法变量） */
function send(rule: QuickReplyRule): void {
    if (!rule.reply.trim()) {
        toast.error('该条没有填写「内容」列：' + rule.title);
        return;
    }
    const text = replaceToTinyMCE(expandMagicVars(rule.reply));
    if (text) toast.success('已填入：' + rule.title);
    else toast.error('输入框未就绪，请稍后重试');
}

/** 造一个图标 host（shadow 包一层，站点样式进不来） */
function buildIcon(rule: QuickReplyRule): HTMLSpanElement {
    const d = hostDoc() || document;
    const wrap = d.createElement('span');
    wrap.setAttribute(MARK, '');
    wrap.style.cssText =
        'display:inline-flex;align-items:center;margin:0 0 0 6px;padding:0;line-height:0;vertical-align:middle;';
    const shadow = wrap.attachShadow({ mode: 'open' });
    const style = d.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const btn = d.createElement('button');
    btn.type = 'button';
    btn.title = '填入：' + rule.title;
    btn.setAttribute('aria-label', '填入：' + rule.title);
    btn.innerHTML = SVG;
    btn.addEventListener('click', (ev: Event) => {
        // 站点是 Vue 单页应用，事件会冒泡到各种委托上（打开会话详情等）⇒ 必须截断
        ev.preventDefault();
        ev.stopPropagation();
        send(rule);
    });
    shadow.appendChild(btn);
    return wrap;
}

/** 撤掉图标（找不到位置、规则不匹配、税务机关为空时都走这里） */
function clearIcon(): void {
    if (host) {
        try {
            host.remove();
        } catch {
            /* 已被站点连父节点一起移除，忽略 */
        }
    }
    host = null;
    shownOrg = '';
    shownRuleId = '';
}

/** 上一轮记录的「为什么没图标」——同一原因只写一次日志（原因变化才写） */
let lastWhy = '';

/**
 * 记录「本轮为什么没挂图标」。真机排障全靠这一行：使用者在「设置 → 运行日志」里
 * 一眼看到卡在哪一步（读不到税务机关 / 隐私表没加载 / 必含词不一致 / 页面位置没识别）。
 *
 * 只记**原因**，不记税务机关文本、不记规则内容（隐私要求）。
 */
function note(why: string): void {
    if (why === lastWhy) return;
    lastWhy = why;
    addLog('税务机关发送图标：' + why, 'info');
}

/** 一轮：读税务机关 → 匹配隐私表 → （必要时）定位并挂图标 */
function tick(): void {
    // Vuex 拿不到就按 DOM 反读（详情未加载 / 字段改名时的兜底）
    const org = readOrg() || readOrgFromDom();
    if (!org) {
        clearIcon();
        note('未读到主管税务机关（页面上也没有可识别的该字段）');
        return;
    }
    const rules = loadPrivacyRulesCache()?.rules || [];
    if (!rules.length) {
        clearIcon();
        note('隐私信息表规则还没加载（去设置里选表，或点「立即刷新规则」）');
        return;
    }
    const matched = matchByOrgText(org, rules);
    if (!matched.length) {
        clearIcon();
        note('隐私信息表里没有「必含关键词」与该税务机关完全一致的条目');
        return;
    }
    const rule = matched[0];
    // 稳态早退：图标还挂着 + 全称没变 + 命中的规则没变 ⇒ 一次 DOM 扫描都不做
    if (host && host.isConnected && shownOrg === org && shownRuleId === rule.id) return;

    const anchor = findOrgAnchor(org);
    if (!anchor) {
        clearIcon();
        note('页面上找不到该字段的位置（站点结构可能变了）');
        return;
    }
    clearIcon();
    host = buildIcon(rule);
    // v26.10.26-v5 定版：**放进值块内部、跟在文本末尾**，而不是插在值块后面。
    // 真机实测：这一行是「左标签 + 右对齐值」布局，值块 div 占满整行宽度，
    // 插在它后面图标会落在行首/行尾随布局漂移；放进去（inline）就永远紧挨着文字。
    anchor.el.appendChild(host);
    shownOrg = org;
    shownRuleId = rule.id;
    if (host.isConnected) {
        lastWhy = '';
        addLog(
            '主管税务机关旁已挂发送图标：' +
                rule.title +
                (anchor.kind === 'label' ? '（挂在标签右侧：没定位到值）' : '') +
                (matched.length > 1 ? '（同词还有 ' + (matched.length - 1) + ' 条，取第一条）' : ''),
            'info'
        );
    }
}

export function startOrgSendButton(): void {
    if (timer !== null) return;
    try {
        tick();
    } catch (e) {
        // 首轮自己吞异常：本模块只是锦上添花，不能连累同批启动的其它模块（见 app.ts 的 boot）
        console.warn('[税务机关发送] 首轮失败:', e);
    }
    timer = window.setInterval(() => {
        try {
            tick();
        } catch (e) {
            console.warn('[税务机关发送] 注入失败:', e);
        }
    }, TICK_MS);
}

export function stopOrgSendButton(): void {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    clearIcon();
}
