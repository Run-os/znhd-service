/**
 * 全局常量与默认配置（原 app.ts「配置」段 + 「存储管理」段的键名/DEFAULTS）。
 * 模块化 P1：逐字迁移，仅加 export。
 */

// ==========配置==========
// 配置对象，集中管理可配置项
export const CONFIG = {
    CHECK_INTERVAL: 3000,
    MAX_LOG_ENTRIES: 20,
    // 提示音地址（GitHub 网页链接，运行时由 resolveGithubUrl() 按 useCdn 决定是否转 CDN）
    didaUrl: 'https://github.com/Run-os/znhd-service/blob/refs/heads/main/public/dida.mp3',
    // 语音播报超时保护（毫秒），防止 onend/onerror 不触发导致队列卡死
    SPEECH_TIMEOUT: 15000,
    // 语音队列最大长度，超过时丢弃最早（最旧）的消息，防止内存堆积
    MAX_SPEECH_QUEUE: 10,
    // 语音队列消息有效期（毫秒），超过该时长的陈旧消息在入队/播放前被剔除，避免播报过时内容
    SPEECH_QUEUE_TTL: 30000,
};

// ==========存储管理==========
// 存储键名
export const STORAGE_KEY = 'scriptCat_Allvalue';
// 面板位置单独存储（与设置数据解耦，避免拖拽频繁写入设置）
export const PANEL_POINT_KEY = 'scriptCat_PanelPoint';
// 常用语缓存（2 小时内且 URL 未变则跳过网络请求，直接复用本地数据）
export const PHRASES_CACHE_KEY = 'scriptCat_PhrasesCache';
export const PHRASES_CACHE_TTL = 2 * 60 * 60 * 1000; // 缓存有效期：2 小时（毫秒）
export const DEFAULTS = {
    voiceEnabled: true,
    // 监控时间段（单位：小时，可含小数，如 13.5 表示 13:30）
    workingHours: {
        morningStart: 9,
        morningEnd: 12,
        afternoonStart: 13.5,
        afternoonEnd: 18,
    },
    // 是否使用 CDN 加速（jsDelivr）加载项目内的 GitHub 资源（常用语 YAML、提示音 mp3 等）。
    // true=经 jsDelivr 加速；false=直接走 GitHub 原始链接（raw.githubusercontent.com）。
    useCdn: true,
    // 常用语数据源（可配置；留空时回退此默认地址）。
    // 存「raw 原始直链」（resolveGithubUrl 形式二）：useCdn=true 时仍会转 jsDelivr 加速，false 时直连 raw。
    // 不用「github.com/blob 网页链接」作规范值——若用户把该字段误填成网页/仓库页面，请求会拉回整页 HTML
    // （如 --fontStack-monospace 的 CSS），jsyaml 解析即报「document separator expected」（v26.9.6-v5 起因）。
    commonPhrasesUrl: 'https://raw.githubusercontent.com/Run-os/znhd-service/refs/heads/main/public/commonPhrases.yaml',
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
