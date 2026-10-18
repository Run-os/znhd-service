import { onScopeDispose, shallowRef, type ShallowRef } from 'vue';
import { getTransferSnapshot, subscribeTransfer, type TransferState } from '@/lib/transfer/store';

/**
 * 传输助手 store 的 Vue 订阅入口（v26.10.18-v5）。
 *
 * store 每次变更都**整体替换 state 对象**（见 `TransferState` 头注），所以用 `shallowRef`
 * 只在引用变化时触发重渲染，避免深层 reactive 包装 Blob / objectURL 这类重对象
 * （深度代理会把 Blob 也包一层，复制/下载时反而容易踩到非预期行为）。
 */
export function useTransferStore(): ShallowRef<TransferState> {
    const state = shallowRef(getTransferSnapshot());
    const off = subscribeTransfer(() => {
        state.value = getTransferSnapshot();
    });
    onScopeDispose(off);
    return state;
}
