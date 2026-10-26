import type { QuickReplyRule } from './types';

/**
 * 规则匹配引擎（纯函数，零依赖）。
 *
 * 规则（使用者 2026-10-26 定版，v26.10.26-v2）—— 顺序即优先级：
 *   ① `剔除关键词` 命中任意一个 ⇒ **整条不显示**（一票否决，先于其它条件）；
 *   ② `必含关键词` 必须**全部命中**才继续（为空 ⇒ 不约束）；
 *   ③ `标签` 命中**任意一个**即显示（不做打分、不设阈值）；
 *   ④ 没有标签的规则永远不显示（否则每个空行都会在输入框上方挂一个按钮）。
 *
 * 一句话：**必含全中 → 标签任一命中 → 剔除词一票否决**（剔除判断放在最前面）。
 *
 * ── 为什么要归一化 ────────────────────────────────────────────────────────────
 * 坐席看到的对话里混着全角标点、不同大小写、「解 非」这种中间夹空格的写法。
 * 直接用 indexOf 会漏掉大量本该命中的情况（这是方案文档第 3 节 L2 轻量容错要解决的问题）。
 * 归一化只在**比较时**做，展示与写入输入框的始终是原文。
 *
 * 归一化三步：
 *   ① 全角 ASCII（U+FF01–U+FF5E）折成半角，全角空格 U+3000 折成普通空格；
 *   ② 去掉所有空白字符 —— 中文语境下「解 非」与「解非」应视为同一关键词；
 *   ③ 转小写 —— 关键词里混英文时避免大小写漏配。
 *
 * 已知取舍：去空白会让英文短语「a b」与「ab」互相命中。关键词都是短词（2–6 字），
 * 这个误判概率极低，而它换来的容错收益明显更大。
 */

/** 归一化：全角折半角 + 去空白 + 转小写 */
export function normalize(input: string): string {
    if (!input) return '';
    let out = '';
    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        if (code >= 0xff01 && code <= 0xff5e) {
            out += String.fromCharCode(code - 0xfee0);
        } else if (code === 0x3000) {
            out += ' ';
        } else {
            out += input.charAt(i);
        }
    }
    return out.replace(/\s+/g, '').toLowerCase();
}

/** 关键词数组里是否有一个出现在已归一化的文本里 */
function anyHit(normalizedText: string, words: string[]): boolean {
    for (const w of words) {
        const k = normalize(w);
        if (k && normalizedText.indexOf(k) >= 0) return true;
    }
    return false;
}

/**
 * 关键词数组是否**全部**出现在已归一化的文本里（「必含关键词」用）。
 *
 * - 空数组 ⇒ true（视作不约束，别把没填这一列的规则全挡掉）；
 * - 归一化后为空的词（纯空格、纯标点）直接忽略，不参与判断；
 * - 任何一个没命中 ⇒ false（AND 语义）。
 */
function allHit(normalizedText: string, words: string[]): boolean {
    for (const w of words) {
        const k = normalize(w);
        if (!k) continue;
        if (normalizedText.indexOf(k) < 0) return false;
    }
    return true;
}

/**
 * 在对话文本里匹配规则。
 *
 * @param conversationText 当前会话的双方对话文本（本机拼好的长字符串，绝不上传）
 * @param rules            规则表
 * @returns 命中的规则，**保持规则表原顺序**（坐席习惯了固定位置）
 */
export function matchRules(conversationText: string, rules: QuickReplyRule[]): QuickReplyRule[] {
    const text = normalize(conversationText);
    if (!text) return [];
    const hits: QuickReplyRule[] = [];
    for (const rule of rules) {
        // 旧缓存里的规则对象可能没有 musts 字段（v26.10.26-v2 才加）⇒ 一律按空数组处理，禁止抛错
        const musts = rule.musts || [];
        const excludes = rule.excludes || [];
        const keywords = rule.keywords || [];
        // ① 剔除关键词一票否决（先于必含/标签判断）
        if (excludes.length && anyHit(text, excludes)) continue;
        // ② 必含关键词必须全部命中（空 = 不约束）
        if (!allHit(text, musts)) continue;
        // ③ 没有标签的规则永远不显示
        if (!keywords.length) continue;
        // ④ 标签任一命中即显示
        if (anyHit(text, keywords)) hits.push(rule);
    }
    return hits;
}

/**
 * 「主管税务机关」旁发送图标用的匹配（v26.10.26-v4，使用者定版）：找**必含关键词里
 * 存在与给定文本相同的一条**的规则。
 *
 * 与 `matchRules` 的三处刻意差别（别顺手合并成一套）：
 *   ① **不看标签、不看剔除词、不看是否常显** —— 使用者的语义是「这个字段值在表里登记过」
 *      就挂一个快捷入口，不是「当前对话命中了某条话术」；
 *   ② 比较的是**相等**（归一化后），不是子串包含 —— 表里写「南岳区税务局」而页面显示全称时
 *      **不该**挂图标（页面同一位置只能挂一个，靠包含匹配会挂错条）；
 *   ③ 空文本一律返回空 —— 免得未进会话时在页面别处挂一个莫名其妙的图标。
 *
 * @param orgText 主管税务机关全称（页面取值，可能为空串）
 * @param rules   隐私信息表格的规则
 * @returns 命中的规则，保持规则表原顺序（调用方取第一条）
 */
export function matchByOrgText(orgText: string, rules: QuickReplyRule[]): QuickReplyRule[] {
    const target = normalize(orgText);
    if (!target) return [];
    const hits: QuickReplyRule[] = [];
    for (const rule of rules) {
        const musts = rule.musts || [];
        for (const m of musts) {
            if (normalize(m) === target) {
                hits.push(rule);
                break;
            }
        }
    }
    return hits;
}
