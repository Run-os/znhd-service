/**
 * 会话「轮次」分组（v26.10.18-v8）：官方 BubbleGroup 的语义 ——
 * 同一方向、间隔很近的消息合并成一个轮次，共用一个头像，气泡竖排进 BubbleGroup。
 *
 * 脚本端（TransferMessage.direction）与客户端（ChatMsg.side）字段名不同，
 * 所以这里只做纯函数分组，字段访问全部由调用方以回调注入；
 * `T` 就是调用方的「行」对象（消息 + 附属下标），回调拿到的也是它。
 */

/** 同方向消息合并进同一轮次的最大间隔：超过就另起一轮（微信同款 2 分钟） */
export const TURN_GAP_MS = 2 * 60 * 1000;

export interface Turn<T> {
    /** 稳定 key（取首条消息 id） */
    key: string;
    /** true = 我方（右侧） */
    mine: boolean;
    /** 轮次上方的时间分隔条文案（空串 = 没有） */
    sepText: string;
    /** 轮次内的消息（>=1） */
    items: T[];
}

export function groupTurns<T>(
    rows: T[],
    opts: {
        keyOf: (it: T) => string;
        mineOf: (it: T) => boolean;
        tsOf: (it: T) => number;
        /** 时间分隔条文案（非空 = 强制另起一轮，文案挂在新区块头上） */
        sepOf: (it: T) => string;
    }
): Array<Turn<T>> {
    const turns: Array<Turn<T>> = [];
    for (const row of rows) {
        const last = turns[turns.length - 1];
        const mine = opts.mineOf(row);
        const ts = opts.tsOf(row);
        const prev = last?.items[last.items.length - 1];
        const canMerge = last && !opts.sepOf(row) && last.mine === mine && prev && ts - opts.tsOf(prev) <= TURN_GAP_MS;
        if (canMerge) {
            last.items.push(row);
        } else {
            turns.push({ key: opts.keyOf(row), mine, sepText: opts.sepOf(row), items: [row] });
        }
    }
    return turns;
}
