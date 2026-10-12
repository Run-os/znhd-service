/**
 * 传输助手模块的类型契约（v26.10.12-v1，「设备互联」重构为「传输助手」时新建）。
 *
 * 与 App 主面板设置（`Allvalue`）的关系：**互不共用**。
 * 传输助手有自己的设置存储（`scriptCat_TransferSettings`，见 settings.ts），
 * 主面板设置里不再保留「中继服务器地址」——首次启动时会从旧存储里迁移一次（见 loadTransferSettings）。
 */

/** 传输助手的外观主题（与 App 主面板的主题完全独立，只影响传输助手窗口） */
export type TransferTheme = 'light' | 'dark';

/** 传输助手的自有设置（localStorage `scriptCat_TransferSettings`） */
export interface TransferSettings {
    /** 中继服务器公网地址（末尾不带 /）；留空则配对/收发全部不可用 */
    relayServer: string;
    /** 窗口外观：浅色 / 深色（企业微信桌面端双风格） */
    theme: TransferTheme;
    /** 收到手机内容时是否自动打开传输助手窗口（默认开） */
    autoOpenOnReceive: boolean;
}

/** 一条传输记录（收 / 发共用；图片带 blob 与 objectURL，文本带 text） */
export interface TransferMessage {
    /** 模块内唯一 id（`ts-随机后缀`） */
    id: string;
    type: 'image' | 'text';
    /** in = 手机发来；out = 本机发出 */
    direction: 'in' | 'out';
    /** 对方手机 ID（老版中继无法归组时为聚合会话键，见 store.ts 的 PHONE_SESSION_KEY） */
    sessionKey: string;
    /** 图片文件名 */
    name?: string;
    /** 图片 MIME */
    mime?: string;
    /** 图片本体（复制 / 下载 / 打印都用它；注意移除时要 revoke previewUrl） */
    blob?: Blob;
    /** 图片预览 objectURL（缩略图与放大预览都用它） */
    previewUrl?: string;
    /** 文本内容 */
    text?: string;
    /** 发生时间（毫秒） */
    ts: number;
    /** 发送中的图片：投递状态（发送中 / 失败；成功后移除该字段） */
    sendState?: 'sending' | 'failed';
    /** 发送失败原因（sendState === 'failed' 时） */
    sendError?: string;
}

/** 一个会话 = 一台手机（或「手机」聚合会话）；消息按时间正序（旧 → 新） */
export interface DeviceSession {
    /** 手机 ID；聚合会话为 PHONE_SESSION_KEY */
    key: string;
    messages: TransferMessage[];
    /** 未读数（窗口关闭或该会话不是当前会话时累计） */
    unread: number;
    /** 最后一条消息的时间（列表排序用） */
    lastTs: number;
}

/** 一台在线手机（中继 /phone/status 返回；id 为空表示老版中继只回了 online） */
export interface PhoneInfo {
    id: string;
    lastSeen: number;
}
