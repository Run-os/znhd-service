import type { FeishuAppCredential, FeishuToken, RulesCache } from './types';

/**
 * 飞书凭证 / token / 规则缓存的本地持久化。
 *
 * 为什么用 GM_setValue 而不是 localStorage（项目其余配置都走 localStorage）：
 *   ① 凭证属于「脚本级」数据，清站点缓存 / 换域名时不应被连带清掉；
 *   ② ScriptCat / Tampermonkey 的 GM 存储按脚本隔离，不会被页面脚本读到
 *      —— 页面里跑的第三方代码（含税务页的埋点）拿不到 client_secret。
 *
 * ⚠️ 这些值都是**明文**落盘（GM 存储本身不加密）。本项目接受该风险：client_secret 是
 *    飞书为「这一台机器上的这一次注册」动态签发的、且只能读使用者自己有权看的多维表格；
 *    真正的资产（对话文本）永远不出本机。要更强隔离需自行接入系统凭据管理器。
 */

const APP_KEY = 'scriptCat_FeishuApp';
const TOKEN_KEY = 'scriptCat_FeishuToken';
const RULES_KEY = 'scriptCat_QuickReplyRules';
/** 隐私信息表格的规则缓存（v26.10.25-v1，独立于主规则表） */
export const PRIVACY_RULES_KEY = 'scriptCat_PrivacyRules';

/** 通用读取：兼容「存的是 JSON 字符串」和「存的是对象」两种历史形态 */
function read<T>(key: string): T | null {
    try {
        const raw = GM_getValue(key, '');
        if (!raw) return null;
        if (typeof raw === 'string') return JSON.parse(raw) as T;
        return raw as T;
    } catch {
        return null;
    }
}

/** 通用写入：序列化成 JSON 字符串，避免不同脚本管理器对对象存储的差异 */
function write(key: string, value: unknown): void {
    try {
        GM_setValue(key, JSON.stringify(value));
    } catch {
        /* 存储不可用（隐私模式/配额满）不阻断主流程，下次启动会重新走授权 */
    }
}

function remove(key: string): void {
    try {
        GM_setValue(key, '');
    } catch {
        /* 同上 */
    }
}

export function loadAppCred(): FeishuAppCredential | null {
    const v = read<FeishuAppCredential>(APP_KEY);
    return v && v.clientId && v.clientSecret ? v : null;
}

export function saveAppCred(cred: FeishuAppCredential): void {
    write(APP_KEY, cred);
}

export function loadToken(): FeishuToken | null {
    const v = read<FeishuToken>(TOKEN_KEY);
    return v && v.accessToken ? v : null;
}

export function saveToken(token: FeishuToken): void {
    write(TOKEN_KEY, token);
}

export function loadRulesCache(): RulesCache | null {
    const v = read<RulesCache>(RULES_KEY);
    return v && Array.isArray(v.rules) ? v : null;
}

export function saveRulesCache(cache: RulesCache): void {
    write(RULES_KEY, cache);
}

/** 隐私信息表格的规则缓存（v26.10.25-v1）：结构与主规则缓存一致，键独立 */
export function loadPrivacyRulesCache(): RulesCache | null {
    const v = read<RulesCache>(PRIVACY_RULES_KEY);
    return v && Array.isArray(v.rules) ? v : null;
}

export function savePrivacyRulesCache(cache: RulesCache): void {
    write(PRIVACY_RULES_KEY, cache);
}

/** 解除授权：四份数据一起清（只清 token 会造成「有凭证但永远换不到 token」的半残状态；
 *  隐私缓存也一并清 —— token 没了它也读不了，留着只会显示过期内容） */
export function clearAuth(): void {
    remove(TOKEN_KEY);
    remove(RULES_KEY);
    remove(PRIVACY_RULES_KEY);
}

/**
 * 作废本机应用凭证：连 client_id/secret 一起忘掉（v26.10.23-v3）。
 *
 * 场景：第 1 步「注册应用」在飞书网页里用**错账号**确认了（比如豆包账号），
 * 凭证已落盘 ⇒ 之后每次授权都跳过第 1 步、还带着错账号的上下文，回不去。
 * 只有把凭证一并忘掉，下一次授权才会重新走「动态注册」。
 * 注意：飞书侧那个动态注册的应用不会被删除（没有对应接口），只是本机不再使用它，无副作用。
 */
export function forgetApp(): void {
    remove(APP_KEY);
    remove(TOKEN_KEY);
    remove(RULES_KEY);
    remove(PRIVACY_RULES_KEY);
}
