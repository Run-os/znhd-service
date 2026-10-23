/**
 * 飞书快捷回复（常用语快捷按钮）的数据模型。
 *
 * 数据源是使用者自己飞书账号下的一张多维表格（见 docs/常用语快捷按钮开发方案.md）：
 *   列 `标题`（文本）/ `标签`（多选，命中任一条即显示）/ `内容`（文本，点按钮后填进输入框）
 *   / `排除词`（可选，多选或文本，出现即该条不显示）。
 *
 * ⚠️ 全部为纯数据类型，不含任何宿主 API —— `GM_xmlhttpRequest` / `GM_setValue` 等只在
 *    `http.ts` / `credentials.ts` 两个适配层出现，其余模块可被冒烟页直接引用。
 */

/** 规则表一行（已归一化） */
export interface QuickReplyRule {
    /** 飞书记录 id，用于去重与日志定位 */
    id: string;
    /** 标题，即按钮上显示的文字 */
    title: string;
    /** 命中标签：对话文本**包含任意一个**即视为命中（大小写/全半角/空格已在匹配前归一化） */
    keywords: string[];
    /** 排除词：对话文本包含任意一个则该条不显示（为空表示不排除） */
    excludes: string[];
    /** 点按钮后替换进输入框的文本 */
    reply: string;
}

/** 飞书为该使用者动态签发的应用凭证（archetype=PersonalAgent） */
export interface FeishuAppCredential {
    clientId: string;
    clientSecret: string;
    /** 授权时的 open_id，仅用于界面显示「已授权哪个账号」 */
    openId?: string;
}

/** user_access_token 与 refresh_token 的本地副本（时间一律用绝对毫秒戳，避免时钟漂移叠加） */
export interface FeishuToken {
    accessToken: string;
    refreshToken: string;
    /** access_token 到期时间（ms） */
    expiresAt: number;
    /** refresh_token 到期时间（ms） */
    refreshExpiresAt: number;
    /** 服务端实际授予的 scope，空格分隔 */
    scope: string;
}

/** 一次设备授权的中间态：UI 拿它显示 user_code 给使用者 */
export interface DeviceCodeChallenge {
    deviceCode: string;
    userCode: string;
    /** 带 user_code 的完整授权链接，**必须原样展示**（飞书明确要求不得改写/拼接） */
    verificationUriComplete: string;
    /** 有效期（秒）——注册会话 3600，设备授权会话只有 600 */
    expiresIn: number;
    /** 轮询间隔（秒） */
    interval: number;
}

/** 规则缓存（落在本机，带拉取时间，便于「上次更新于 …」展示与 TTL 判断） */
export interface RulesCache {
    fetchedAt: number;
    rules: QuickReplyRule[];
}
