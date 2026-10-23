import { addLog } from '@/lib/logger';
import { gmHttp, type HttpFn } from './http';
import {
    beginAppRegistration,
    beginDeviceAuthorization,
    pollAppRegistration,
    pollDeviceToken,
    refreshUserToken,
    remainingMs,
} from './oauth';
import {
    clearAuth,
    forgetApp,
    loadAppCred,
    loadRulesCache,
    loadToken,
    saveAppCred,
    saveRulesCache,
    saveToken,
} from './credentials';
import { loadAllvalue, saveAllvalue, flushSaveAllvalue } from '@/lib/storage';
import { DEFAULTS } from '@/lib/constants';
import { parseTableLink, resolveTableLink } from './tableLink';
import { fetchRules, type RulesTableConfig } from './rules';
import type { DeviceCodeChallenge, FeishuAppCredential, FeishuToken, QuickReplyRule } from './types';

/**
 * 飞书快捷回复的编排层：把 oauth / rules / credentials 串起来，给 UI 一个简单入口。
 *
 * 设计要点：
 *   · **凭证只注册一次**。`client_id/client_secret` 与具体授权无关，一旦拿到就长期复用；
 *     token 过期时只需重走「设备授权」这一步（使用者点一次确认），不必重新注册应用。
 *   · 所有网络调用都走注入的 `http`（真机是 gmHttp），逻辑层不碰 GM_*。
 *   · 日志只记状态与条数，**绝不记 token、凭证、对话文本**。
 */

/** 规则缓存的 TTL：5 分钟。满足「改表后不用等太久」，又不至于每次切会话都打接口 */
const RULES_TTL_MS = 5 * 60 * 1000;
/** access_token 提前 5 分钟视为过期，避免边界上刚好失效 */
const TOKEN_SKEW_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface QuickReplyStatus {
    /** 是否已完成授权（本机有可用 token） */
    authorized: boolean;
    /** 本机是否存有应用凭证（v26.10.23-v3）：有凭证时点授权会跳过第 1 步直接进第 2 步 */
    hasCredential: boolean;
    /** 已授权账号的 open_id（飞书只给这个，不给我们昵称） */
    openId: string;
    /** token 到期时间戳（ms），0 = 没有 */
    expiresAt: number;
    /** 缓存里的规则条数 */
    ruleCount: number;
    /** 规则上次拉取时间戳（ms），0 = 从未拉过 */
    rulesFetchedAt: number;
}

/** 当前授权 / 缓存状态（纯本地读，无网络） */
export function getStatus(): QuickReplyStatus {
    const cred = loadAppCred();
    const token = loadToken();
    const cache = loadRulesCache();
    return {
        authorized: !!(cred && token),
        hasCredential: !!cred,
        openId: cred?.openId || '',
        expiresAt: token?.expiresAt || 0,
        ruleCount: cache?.rules.length || 0,
        rulesFetchedAt: cache?.fetchedAt || 0,
    };
}

/**
 * 取一个可用的 access_token：本地还有效就直接用，快过期就刷新，刷新失败抛错
 * （调用方据此提示「需要重新授权」）。
 */
export async function getValidToken(http: HttpFn = gmHttp): Promise<string> {
    const cred = loadAppCred();
    if (!cred) throw new Error('尚未授权飞书账号');
    const token = loadToken();
    if (!token) throw new Error('尚未授权飞书账号');

    if (remainingMs(token) > TOKEN_SKEW_MS) return token.accessToken;

    // refresh_token 一次性：刷新后必须整体替换
    const fresh = await refreshUserToken(http, cred, token.refreshToken);
    saveToken(fresh);
    addLog('飞书 token 已自动刷新', 'success');
    return fresh.accessToken;
}

/** 授权过程中的阶段，UI 据此显示不同文案 */
export type AuthPhase = 'register' | 'data';

export interface AuthorizeHandlers {
    /** 拿到需要使用者确认的授权码（register = 注册应用，data = 授权读表） */
    onChallenge: (phase: AuthPhase, challenge: DeviceCodeChallenge) => void;
    /** 返回 true 表示使用者取消了（每轮轮询检查一次） */
    isCancelled: () => boolean;
}

/**
 * 跑完整授权流程。
 *
 * 分两种情形：
 *   · 本机还没有 client_id/secret → 先注册（使用者确认一次），再设备授权（再确认一次）；
 *   · 已经有凭证（token 过期 / 换账号）→ 只走设备授权，只需确认一次。
 *
 * @returns 新的 token（已落盘）
 */
export async function authorize(handlers: AuthorizeHandlers, http: HttpFn = gmHttp): Promise<FeishuToken> {
    let cred = loadAppCred();

    if (!cred) {
        const reg = await beginAppRegistration(http);
        handlers.onChallenge('register', reg);
        const regResult = await pollUntil(
            () => pollAppRegistration(http, reg.deviceCode),
            reg.interval,
            reg.expiresIn,
            handlers.isCancelled
        );
        cred = regResult;
        saveAppCred(cred);
        addLog('飞书应用注册完成（动态签发凭证）', 'success');
    }

    const dev = await beginDeviceAuthorization(http, cred);
    handlers.onChallenge('data', dev);
    const token = await pollUntil(
        () => pollDeviceToken(http, cred as FeishuAppCredential, dev.deviceCode),
        dev.interval,
        dev.expiresIn,
        handlers.isCancelled
    );
    saveToken(token);
    addLog('飞书账号授权完成，已获得表格读取权限', 'success');
    return token;
}

/** 轮询直到 ok / error / 超时 / 取消 */
async function pollUntil<T>(
    step: () => Promise<{ status: 'pending' } | { status: 'ok'; value: T } | { status: 'error'; message: string }>,
    intervalSec: number,
    expiresInSec: number,
    isCancelled: () => boolean
): Promise<T> {
    const deadline = Date.now() + expiresInSec * 1000;
    const gap = Math.max(2, intervalSec) * 1000;
    while (Date.now() < deadline) {
        if (isCancelled()) throw new Error('已取消授权');
        const r = await step();
        if (r.status === 'ok') return r.value;
        if (r.status === 'error') throw new Error(r.message);
        await sleep(gap);
    }
    throw new Error('授权超时（' + Math.round(expiresInSec / 60) + ' 分钟内未完成确认）');
}

/**
 * 取规则：命中缓存且未过期就直接返回，否则回源。
 *
 * @param force true = 无视缓存（设置面板的「立即刷新」）
 */
export async function getRules(force = false, http: HttpFn = gmHttp): Promise<QuickReplyRule[]> {
    const cache = loadRulesCache();
    if (!force && cache && Date.now() - cache.fetchedAt < RULES_TTL_MS) return cache.rules;

    const token = await getValidToken(http);
    const cfg = await rulesTableConfig(http, token);
    const rules = await fetchRules(http, token, cfg);
    saveRulesCache({ fetchedAt: Date.now(), rules });
    addLog('飞书快捷回复规则已更新：' + rules.length + ' 条', 'success');
    return rules;
}

/**
 * 链接 → 可读表的定位信息（v26.10.23-v2 起表链接可在设置面板配置）。
 * 链接无法识别时抛错（设置面板会把错误显示出来），**不静默回落**：
 * 使用者改坏了链接却还在读旧表，比直接报错更难排查。
 */
async function rulesTableConfig(http: HttpFn, token: string): Promise<RulesTableConfig> {
    const url = getTableUrl();
    const link = parseTableLink(url);
    if (!link) throw new Error('规则表链接无法识别：' + url);
    return resolveTableLink(http, token, link);
}

/** 解除授权（保留应用凭证：token 过期重授权时不必重新注册） */
export function revoke(): void {
    clearAuth();
    addLog('已解除飞书授权', 'success');
}

/**
 * 作废本机应用凭证（v26.10.23-v3）：连第 1 步注册的 client_id/secret 一起忘掉。
 * 用于「第 1 步用错账号确认了」的场景 —— 凭证不清掉，永远跳过第 1 步回不去。
 */
export function forgetCredential(): void {
    forgetApp();
    addLog('已作废本机飞书应用凭证，下次授权将重新注册', 'success');
}

/**
 * 当前设置的「规则表链接」。存在 localStorage 的 Allvalue（`quickReplyTableUrl`），
 * 没配/清空时回落到默认表（`constants.ts` 的 `DEFAULTS.quickReplyTableUrl`）。
 */
export function getTableUrl(): string {
    try {
        const v = (loadAllvalue() as Record<string, unknown>)['quickReplyTableUrl'];
        if (typeof v === 'string' && v.trim()) return v.trim();
    } catch {
        /* 读设置失败按未配置处理 */
    }
    return DEFAULTS.quickReplyTableUrl;
}

/** 保存规则表链接（同步落盘不走防抖 —— 保存后马上要回源拉规则） */
export function setTableUrl(url: string): void {
    const merged = { ...(loadAllvalue() as Record<string, unknown>), quickReplyTableUrl: (url || '').trim() };
    saveAllvalue(merged);
    flushSaveAllvalue();
    addLog('快捷回复规则表链接已更新', 'success');
}
