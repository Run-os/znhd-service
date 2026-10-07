import { loadAllvalue } from '@/lib/storage';

/**
 * 运行时状态缓存（原 app.ts「状态缓存」段）。
 * 顶层一次性读取初始配置，避免重复解析 localStorage；设置变更时由主面板写回这些字段。
 * 之所以用对象而非多个导出变量：ES module 的 import 绑定只读，调用方无法赋值。
 */
const _initAllvalue = loadAllvalue();

export const runtime = {
    /** 一次性读取的初始配置（主面板 useState 惰性初始化用，避免每次渲染重读 localStorage） */
    init: _initAllvalue,
    /** 缓存语音启用状态，避免每次播报都读取 localStorage */
    voiceEnabled: _initAllvalue.voiceEnabled,
    /** 缓存监控时间段，避免每次轮询都读取 localStorage */
    workingHours: _initAllvalue.workingHours,
    /** 缓存常用语数据源地址，避免每次请求都读取 localStorage */
    commonPhrasesUrl: _initAllvalue.commonPhrasesUrl,
    /** 缓存「是否使用 CDN 加速」开关，供 resolveGithubUrl() 在调用时读取 */
    useCdn: !!_initAllvalue.useCdn,
    /** 缓存「运行日志自动刷新」开关（v26.10.07-v4），供日志弹窗读取 */
    logAutoRefresh: !!_initAllvalue.logAutoRefresh,
};
