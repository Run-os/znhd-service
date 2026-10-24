import { formEncode, num, parseJson, str, type HttpFn, type HttpResponse } from './http';
import type { DeviceCodeChallenge, FeishuAppCredential, FeishuToken } from './types';

/**
 * 飞书 OAuth（设备授权流 + 应用动态注册）—— 纯逻辑，零宿主依赖。
 *
 * ── 为什么是设备流而不是授权码流 ──────────────────────────────────────────────
 * 授权码流必须有一个可回调的 HTTPS 地址，等于强制每个使用者自建后端（违反方案硬约束 C1/C5）。
 * 设备流（RFC 8628）把「回调」换成「用户在自己的浏览器里确认 + 客户端轮询」，
 * 天然无服务器。
 *
 * ── 两道确认（飞书这套流程的真实形态，实测 2026-10-23）───────────────────────
 *   ① 应用动态注册：`archetype=PersonalAgent` 让飞书为**这一个使用者**动态签发
 *      client_id/client_secret，使用者不必去开放平台建应用、不必填任何密钥。
 *      注册会话有效期 3600s。
 *   ② 设备授权：用 ① 的凭证申请 `scope`，换 user_access_token。
 *      设备授权会话只有 **600s**（实测，文档里写的 3600 是注册会话的值）。
 *
 * ── 实测确认的坑（写在这里避免后人重踩）─────────────────────────────────────
 *   · 刷新 token **必须同时带 client_id 与 client_secret**，只带 refresh_token 会
 *     `400 invalid_request: missing client_id`；
 *   · `refresh_token_expires_in` 是 604800（7 天）且**每次刷新重新计**，属滑动窗口；
 *   · 设备授权返回的 `verification_uri` 与注册会话的不是同一个页面，各自原样使用，
 *     不得拼接/改写（响应体里有一句明确的 message 警告）；
 *   · token_type 实测为 Bearer，纯 Bearer 可用（未强制 DPoP）。
 */

const REG_URL = 'https://accounts.feishu.cn/oauth/v1/app/registration';
const DEVICE_AUTH_URL = 'https://accounts.feishu.cn/oauth/v1/device_authorization';
const TOKEN_URL = 'https://accounts.feishu.cn/oauth/v3/token';

/**
 * 申请的权限。只读多维表格 + 只读知识库（wiki 节点解析要用）+ 云空间元数据，
 * `offline_access` 是拿 refresh_token 的前提（缺它就只能用 2 小时）。
 *
 * 注意：这里用的是 **bitable v1** 的粗粒度 scope。CLI 的 `base` 域走新版 v3 API，
 * 需要 `base:record:read` / `base:field:read` 这样一列一个的细粒度 scope（实测会报
 * 99991672 app_scope_not_applied），故本项目统一走 v1 接口，一个 scope 覆盖全部。
 *
 * `search:docs:read`（v26.10.24-v6 新增）：搜索云文档，供设置面板「从飞书选择表格」
 * 列出使用者有权访问的多维表格（含别人分享、不在自己云空间里的）。与
 * `search.ts` 的 `SEARCH_SCOPE` 必须逐字一致 —— 那边用它在本地判断有没有该权限。
 * ⚠️ 已授权的老 token 不含它 ⇒ 需要重新授权一次（UI 会主动提示）。
 */
export const FEISHU_SCOPE =
    'bitable:app:readonly wiki:wiki:readonly drive:drive:readonly search:docs:read offline_access';

/** 轮询结果：pending = 用户还没确认，继续；ok = 拿到值；error = 终止（含取消/过期） */
export type PollOutcome<T> = { status: 'pending' } | { status: 'ok'; value: T } | { status: 'error'; message: string };

/** 把 HTTP 响应体解析成 object；非 JSON 视为异常响应 */
function bodyOf(res: HttpResponse): Record<string, unknown> {
    return parseJson(res.text) ?? {};
}

/** 把飞书返回的 `error`/`error_description` 拼成一句可读的话 */
function errorText(body: Record<string, unknown>, fallback: string): string {
    const e = str(body, 'error');
    const d = str(body, 'error_description');
    if (!e && !d) return fallback;
    return (e || fallback) + (d ? '：' + d : '');
}

/** Basic 认证头。client_id/client_secret 都是 ASCII，btoa 足矣 */
function basicAuth(clientId: string, clientSecret: string): string {
    return 'Basic ' + btoa(clientId + ':' + clientSecret);
}

/**
 * 第一步：发起应用动态注册（无任何凭证）。
 * 返回 device_code（轮询用）与 user_code/授权链接（给使用者点）。
 */
export async function beginAppRegistration(http: HttpFn): Promise<DeviceCodeChallenge> {
    const res = await http({
        method: 'POST',
        url: REG_URL,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode({
            action: 'begin',
            archetype: 'PersonalAgent',
            auth_method: 'client_secret',
            request_user_info: 'open_id tenant_brand',
        }),
    });
    const body = bodyOf(res);
    const deviceCode = str(body, 'device_code');
    if (!deviceCode) {
        throw new Error(
            '发起飞书应用注册失败：' + errorText(body, '响应里没有 device_code（HTTP ' + res.status + '）')
        );
    }
    return {
        deviceCode,
        userCode: str(body, 'user_code'),
        verificationUriComplete: str(body, 'verification_uri_complete'),
        // 协议字段是 expire_in，兼容旧拼写 expires_in；缺省按 600s 兜底
        expiresIn: num(body, 'expire_in') || num(body, 'expires_in') || 600,
        interval: num(body, 'interval') || 5,
    };
}

/**
 * 第二步：轮询注册结果，拿到飞书为该使用者签发的客户端凭证。
 * 用户未确认时返回 pending（不是错误），调用方按 interval 继续轮询。
 */
export async function pollAppRegistration(http: HttpFn, deviceCode: string): Promise<PollOutcome<FeishuAppCredential>> {
    const res = await http({
        method: 'POST',
        url: REG_URL,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode({ action: 'poll', device_code: deviceCode }),
    });
    const body = bodyOf(res);

    const err = str(body, 'error');
    if (err === 'authorization_pending' || err === 'slow_down') return { status: 'pending' };
    if (err) return { status: 'error', message: errorText(body, '应用注册被拒绝') };

    const clientId = str(body, 'client_id');
    if (!clientId) {
        return { status: 'error', message: '应用注册响应里没有 client_id（HTTP ' + res.status + '）' };
    }
    const info = (body['user_info'] || {}) as Record<string, unknown>;
    return {
        status: 'ok',
        value: { clientId, clientSecret: str(body, 'client_secret'), openId: str(info, 'open_id') || undefined },
    };
}

/**
 * 第三步：用动态凭证发起设备授权，申请业务 scope。
 * 返回的 verificationUriComplete 要给使用者原样打开（有效期只有 600s）。
 */
export async function beginDeviceAuthorization(
    http: HttpFn,
    cred: FeishuAppCredential,
    scope: string = FEISHU_SCOPE
): Promise<DeviceCodeChallenge> {
    const res = await http({
        method: 'POST',
        url: DEVICE_AUTH_URL,
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization: basicAuth(cred.clientId, cred.clientSecret),
        },
        body: formEncode({ client_id: cred.clientId, scope }),
    });
    const body = bodyOf(res);
    const deviceCode = str(body, 'device_code');
    if (!deviceCode) {
        throw new Error(
            '发起飞书数据授权失败：' + errorText(body, '响应里没有 device_code（HTTP ' + res.status + '）')
        );
    }
    return {
        deviceCode,
        userCode: str(body, 'user_code'),
        verificationUriComplete: str(body, 'verification_uri_complete'),
        expiresIn: num(body, 'expires_in') || 600,
        interval: num(body, 'interval') || 5,
    };
}

/** 把 token 响应体转成本地结构（时间换算成绝对毫秒戳） */
function toToken(body: Record<string, unknown>): FeishuToken | null {
    const accessToken = str(body, 'access_token');
    if (!accessToken) return null;
    const now = Date.now();
    return {
        accessToken,
        refreshToken: str(body, 'refresh_token'),
        expiresAt: now + (num(body, 'expires_in') || 7200) * 1000,
        refreshExpiresAt: now + (num(body, 'refresh_token_expires_in') || 604800) * 1000,
        scope: str(body, 'scope'),
    };
}

/** 第四步：轮询换 user_access_token */
export async function pollDeviceToken(
    http: HttpFn,
    cred: FeishuAppCredential,
    deviceCode: string
): Promise<PollOutcome<FeishuToken>> {
    const res = await http({
        method: 'POST',
        url: TOKEN_URL,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: cred.clientId,
            client_secret: cred.clientSecret,
        }),
    });
    const body = bodyOf(res);
    const err = str(body, 'error');
    if (err === 'authorization_pending' || err === 'slow_down') return { status: 'pending' };
    if (err === 'access_denied') {
        // v26.10.23-v3：飞书把「账号类型不允许授权云文档」也归到 access_denied（实测文案
        // "These permissions are restricted by your organization's security policy"）。
        // 个人版 / 豆包等第三方登录的账号没有企业租户，云文档权限一律给不了 —— 必须翻译成人话。
        return {
            status: 'error',
            message:
                '飞书拒绝了这次授权（access_denied）：当前登录的账号类型不允许把云文档权限授予应用' +
                '（个人版 / 豆包等第三方登录的账号不支持）。请在浏览器里切换到有企业身份的飞书账号后，' +
                '重新点「授权飞书账号」再试；若确认用的是企业账号仍被拒，则是该企业管理员禁用了第三方应用授权。',
        };
    }
    if (err) return { status: 'error', message: errorText(body, '换取用户 token 失败') };

    const token = toToken(body);
    if (!token) return { status: 'error', message: 'token 响应里没有 access_token（HTTP ' + res.status + '）' };
    return { status: 'ok', value: token };
}

/**
 * 刷新 user_access_token。
 * ⚠️ 必须带 client_id/client_secret（实测漏传会 400 missing client_id）。
 * refresh_token 是一次性的：每次刷新都会换一个新的，必须整体替换本地副本。
 */
export async function refreshUserToken(
    http: HttpFn,
    cred: FeishuAppCredential,
    refreshToken: string
): Promise<FeishuToken> {
    const res = await http({
        method: 'POST',
        url: TOKEN_URL,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formEncode({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: cred.clientId,
            client_secret: cred.clientSecret,
        }),
    });
    const body = bodyOf(res);
    const token = toToken(body);
    if (!token) throw new Error('刷新飞书 token 失败：' + errorText(body, 'HTTP ' + res.status));
    return token;
}

/** 剩余有效期（毫秒）；已过期返回负数 */
export function remainingMs(token: FeishuToken): number {
    return token.expiresAt - Date.now();
}
