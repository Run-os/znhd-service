import { PHONE_SESSION_KEY, PHONE_SESSION_LABEL } from '@/lib/transfer/store';
import { shortPhoneId } from '@/lib/ui/transfer/deviceColors';
import type { TransferMessage } from '@/lib/transfer/types';

/** 各处的时间 / 预览文案格式化（从 React 版逐字搬迁，别再各写一份） */

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (x: Date) => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();

/** HH:mm */
export function fmtTime(ts: number): string {
    const d = new Date(ts);
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/**
 * 时间分隔条的文案（微信规则）：今天只显示 HH:mm，昨天加「昨天」前缀，再往前 MM-DD HH:mm。
 */
export function sepTimeText(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const hm = fmtTime(ts);
    if (dayOf(d) === dayOf(now)) return hm;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayOf(d) === dayOf(yesterday)) return '昨天 ' + hm;
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
}

/** 会话列表里的时间（今天 HH:mm，昨天加「昨天」，否则 MM-DD） */
export function listTime(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const hm = fmtTime(ts);
    if (dayOf(d) === dayOf(now)) return hm;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayOf(d) === dayOf(yesterday)) return '昨天 ' + hm;
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** 文件视图里的时间：MM-DD HH:mm:ss */
export function fullTime(ts: number): string {
    const d = new Date(ts);
    return (
        pad(d.getMonth() + 1) +
        '-' +
        pad(d.getDate()) +
        ' ' +
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes()) +
        ':' +
        pad(d.getSeconds())
    );
}

/** 会话列表里对最后一条消息的预览文案 */
export function previewText(msg?: TransferMessage): string {
    if (!msg) return '';
    if (msg.type === 'image') return '[图片]';
    if (msg.type === 'file') return '[文件] ' + (msg.name || '');
    return (msg.text || '').replace(/\s+/g, ' ').slice(0, 40);
}

/** 来源设备名（聚合会话显示「手机」） */
export function sourceLabel(msg: TransferMessage): string {
    if (msg.sessionKey === PHONE_SESSION_KEY) return PHONE_SESSION_LABEL;
    return shortPhoneId(msg.sessionKey);
}

/**
 * 聊天头像：DiceBear（notionists 风格 SVG）。
 *
 * ⚠️ seed 用**设备标识**（本机 ID / 手机会话键）而不是官方示例里的 `Math.random()`：
 *    随机种子在 Vue 重渲染时会重新求值 ⇒ 同一台手机每刷新一次就换一张脸，聊天里认不出人；
 *    固定 seed 才是「一台设备 = 一张脸」，且不同设备天然不同。
 *
 * 走 <img>（AvatarImage）而不是 GM_xmlhttpRequest：DiceBear 是公开只读资源，无需 @grant；
 * 宿主页 CSP 若挡掉 api.dicebear.com，reka 的 AvatarImage 会保持未加载态，自动回落到
 * AvatarFallback 的文字头像（我方「我」/ 对方「手」），不会开天窗。
 */
export function avatarUrl(seed: string): string {
    return 'https://api.dicebear.com/10.x/notionists/svg?seed=' + encodeURIComponent(seed);
}

/** 发送状态文案（时间在分隔条上，这里只表达「发送中 / 失败」） */
export function metaOf(msg: TransferMessage): string {
    if (msg.sendState === 'sending') {
        return typeof msg.sendProgress === 'number' ? '发送中 ' + msg.sendProgress + '%' : '发送中…';
    }
    if (msg.sendState === 'failed') return '发送失败';
    return '';
}
