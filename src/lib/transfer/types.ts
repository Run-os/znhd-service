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

/** 一条传输记录（收 / 发共用；图片/文件带 blob 与 objectURL，文本带 text） */
export interface TransferMessage {
    /** 模块内唯一 id（`ts-随机后缀`） */
    id: string;
    /**
     * 消息类型（v26.10.14-v6 起新增 'file'）：
     *  · 'image' —— 图片（走缩略图/九宫格 + 放大预览 + 复制/打印）；
     *  · 'file'  —— 任意非图片文件（走文件卡片：图标 + 文件名 + 大小 + 下载）；
     *  · 'text'  —— 纯文本。
     * 由中继按 mime 判定（`image/*` → image，其余 → file），两端据此分流渲染。
     */
    type: 'image' | 'file' | 'text';
    /** in = 手机发来；out = 本机发出 */
    direction: 'in' | 'out';
    /** 对方手机 ID（老版中继无法归组时为聚合会话键，见 store.ts 的 PHONE_SESSION_KEY） */
    sessionKey: string;
    /** 文件名（图片与文件共用） */
    name?: string;
    /** MIME（图片与文件共用；文件卡片按它选图标） */
    mime?: string;
    /** 二进制本体（图片 / 文件共用；复制 / 下载 / 打印都用它；注意移除时要 revoke previewUrl） */
    blob?: Blob;
    /** 预览 objectURL（图片缩略图用它；文件卡片不用但一并保留，便于「点击下载」复用同一 blob 源） */
    previewUrl?: string;
    /** 文本内容 */
    text?: string;
    /** 发生时间（毫秒） */
    ts: number;
    /** 发送中的图片：投递状态（发送中 / 失败；成功后移除该字段） */
    sendState?: 'sending' | 'failed';
    /** 发送失败原因（sendState === 'failed' 时） */
    sendError?: string;
    /**
     * v26.10.18-v1：发送进度（0–100，仅 sendState === 'sending' 时有意义）。
     * 上传阶段由 `GM_xmlhttpRequest` 的 `upload.onprogress` 逐事件回写；
     * **首个进度事件到达前是 undefined**（脚本宿主可能不支持 upload.onprogress，
     * 此时气泡保持「发送中…」不画进度条 —— 静默降级，不假装 0%）。成功后清掉。
     */
    sendProgress?: number;
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
