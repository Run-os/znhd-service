/**
 * 飞书快捷回复（输出框上方的快捷短语）的数据模型。
 *
 * 数据源是使用者自己飞书账号下的一张多维表格（见 docs/quick-reply.md），
 * 表里**只认这 6 个列名**（v26.10.26-v2，使用者定版，不做任何旧列名兼容）：
 *   `标题` / `是否常显` / `标签` / `剔除关键词` / `必含关键词` / `内容`。
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
    /** 必含关键词：**全部命中**才进入下一步（为空表示不约束） */
    musts: string[];
    /** 剔除关键词：对话文本包含任意一个则该条不显示（为空表示不剔除；一票否决，优先于命中） */
    excludes: string[];
    /** 点按钮后替换进输入框的文本 */
    reply: string;
    /**
     * 是否常显（v26.10.25-v1，规则表「是否常显」复选框列）。
     * true = 无视一切匹配条件（标签 / 必含关键词 / 剔除关键词）、始终显示，
     * 且排在快捷短语栏最前方；false / undefined = 普通规则（走匹配）。
     */
    pinned?: boolean;
    /**
     * 标题是否来自「内容前 12 字」的回退（v26.10.26-v1）。
     * true = 表里没有「标题」列 —— 按钮能显示，但文字是内容截断；上层据此记日志提示补列。
     */
    titleFallback?: boolean;
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
