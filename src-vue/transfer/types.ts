import type { TransferMessage } from '@/lib/transfer/types';

/** 第一栏的两个分组（key 与 React 版一致：store / 自动弹窗都按它路由） */
export type TransferNav = 'devices' | 'files';

/** 图片动作类型已迁到共用层（嗅探卡片也要用同一个类型），这里转出以兼容旧 import */
export type { ImageAction } from '@vue/components/media/types';

/** 用户点选的一张表情（blob 已就绪，调用方直接拿去构造 File） */
export interface PickedEmoji {
    /** 合集显示名 */
    pack: string;
    /** 合集内的键 */
    key: string;
    /** 原图地址 */
    url: string;
    /** 发送到手机时用的文件名 */
    name: string;
    blob: Blob;
}

/** 第二栏的一条设备会话（由传输助手主窗从 store 汇总后传入） */
export interface DeviceEntry {
    key: string;
    /** 展示名（短 ID 或「手机」） */
    label: string;
    isAggregate: boolean;
    online: boolean;
    unread: number;
    lastTs: number;
    lastMsg?: TransferMessage;
    hasMessages: boolean;
}
