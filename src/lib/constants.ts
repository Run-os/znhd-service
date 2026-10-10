/**
 * 全局常量与默认配置（原 app.ts「配置」段 + 「存储管理」段的键名/DEFAULTS）。
 * 模块化 P1：逐字迁移，仅加 export。
 */

// ==========配置==========
// 配置对象，集中管理可配置项
export const CONFIG = {
    CHECK_INTERVAL: 3000,
    MAX_LOG_ENTRIES: 20,
    // 提示音地址（cnb.cool 的 raw 直链，v26.10.10-v17 起）。非 GitHub 链接 ⇒ resolveGithubUrl() 原样返回，
    // 「使用 CDN 加速」开关对它不再有影响（旧地址是 GitHub 网页链接，会转 jsDelivr/raw）。
    didaUrl: 'https://cnb.cool/bbbbaa/work-about/-/git/raw/main/znhd/dida.mp3',
    // 语音播报超时保护（毫秒），防止 onend/onerror 不触发导致队列卡死
    SPEECH_TIMEOUT: 15000,
    // 语音队列最大长度，超过时丢弃最早（最旧）的消息，防止内存堆积
    MAX_SPEECH_QUEUE: 10,
    // 语音队列消息有效期（毫秒），超过该时长的陈旧消息在入队/播放前被剔除，避免播报过时内容
    SPEECH_QUEUE_TTL: 30000,
    // Agent 会话索引最多保留多少条（v26.10.10-v12）。官方 conversation API 只开放 create/get，
    // 会话列表由脚本自己记账（见 lib/agent/sessions.ts），故给个上限防止索引无限增长。
    MAX_AGENT_CHATS: 30,
    // Agent 会话标题的截断长度，与 ScriptCat 官方的自动标题规则保持一致
    // （chat_service.ts 里 `titleText.slice(0, 30)`），这样本地记的标题和 ScriptCat 侧看到的是同一个。
    AGENT_CHAT_TITLE_LENGTH: 30,
};

// ==========存储管理==========
// 存储键名
export const STORAGE_KEY = 'scriptCat_Allvalue';
// 面板位置单独存储（与设置数据解耦，避免拖拽频繁写入设置）
export const PANEL_POINT_KEY = 'scriptCat_PanelPoint';
// 常用语缓存（2 小时内且 URL 未变则跳过网络请求，直接复用本地数据）
export const PHRASES_CACHE_KEY = 'scriptCat_PhrasesCache';
export const PHRASES_CACHE_TTL = 2 * 60 * 60 * 1000; // 缓存有效期：2 小时（毫秒）
// Agent 会话索引（v26.10.10-v12）：官方 conversation API 没有 list/delete，脚本只能自己记
// 「有哪些对话、叫什么名字、上次打开的是哪个」。只存索引，对话消息仍在 ScriptCat 的 OPFS 里。
export const AGENT_CHATS_KEY = 'scriptCat_AgentChats';
export const DEFAULTS = {
    voiceEnabled: true,
    // 监控时间段（单位：小时，可含小数，如 13.5 表示 13:30）
    workingHours: {
        morningStart: 9,
        morningEnd: 12,
        afternoonStart: 13.5,
        afternoonEnd: 18,
    },
    // 是否使用 CDN 加速（jsDelivr）加载项目内的 GitHub 资源。
    // 目前实际受它影响的只有「更新日志」changelogs/*.md（changelog.ts）；常用语 YAML 与提示音 mp3
    // 自 v26.10.10-v17 起走 cnb.cool 直链（非 GitHub 链接，resolveGithubUrl 原样返回，不受此开关影响）。
    // true=经 jsDelivr 加速；false=直接走 GitHub 原始链接（raw.githubusercontent.com）。
    useCdn: true,
    // 常用语数据源（可配置；留空时回退此默认地址）。
    // v26.10.10-v17 起默认指向 cnb.cool 的 raw 直链：非 GitHub 链接，resolveGithubUrl() 原样返回。
    // 仍要求是「raw 原始直链」——若用户把该字段误填成网页/仓库页面，请求会拉回整页 HTML
    // （如 --fontStack-monospace 的 CSS），jsyaml 解析即报「document separator expected」（v26.9.6-v5 起因）。
    commonPhrasesUrl: 'https://cnb.cool/bbbbaa/work-about/-/git/raw/main/znhd/commonPhrases.yaml',
    // 手机图片→电脑剪贴板 中继服务器地址（需为公网可访问的 http(s):// 地址，末尾不带 /）
    relayServer: 'https://znhd.122050.xyz',
    // 「运行日志」弹窗的自动刷新开关（v26.10.07-v4）。
    // 开：新日志持续进来，并自动滚到底部看最新内容；关：列表冻结在关闭那一刻的快照，便于往上翻看历史。
    // 持久化（存进 STORAGE_KEY），下次打开弹窗保持上次的选择。
    logAutoRefresh: true,
    // 「图片嗅探」面板的最小图片体积阈值（单位：KB，v26.10.10-v4）。
    // 只影响**显示与批量下载**的筛选，不影响网络请求策略（不会先探测再决定要不要请求；扫描阶段一律测量）。
    // 消费点在 SniffModal：storage.ts 只对 workingHours 做字段级校验，故那边自行兜非数字/非正数（回退 20）。
    sniffMinKB: 20,
};

// 常用语数据源的旧默认地址（v26.10.10-v17 之前）。存量用户的 localStorage 里可能冻结着它：
// saveAllvalue 存的是**整份** Allvalue，用户只要改过任何一个设置，当时的默认值就被一起写进去了，
// 光改 DEFAULTS 顶不掉它（loadAllvalue 是「已存值覆盖默认值」）。故 loadAllvalue 把「恰好等于旧默认值」
// 视为「没设置过」并迁到新默认；用户自己填的其它地址一律尊重、不迁移。
export const LEGACY_COMMON_PHRASES_URL =
    'https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/public/commonPhrases.yaml';
