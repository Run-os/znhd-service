/**
 * 传输助手 store 的 React 订阅包装（v26.10.18-v5）。
 *
 * 为什么单独一个文件：`store.ts` 被 Vue 版产物复用，里面一旦 import react，
 * Vue 侧就不得不把 react 打进 bundle。这个文件是**唯一**允许碰 react 的地方，
 * React 组件从这里 import（Vue 组件用 `@vue/composables/useTransferStore`）。
 */
import { useSyncExternalStore } from 'react';
import { getTransferSnapshot, subscribeTransfer, type TransferState } from '@/lib/transfer/store';

/** 组件里 `const s = useTransferStore()` 拿到整份 state */
export function useTransferStore(): TransferState {
    return useSyncExternalStore(subscribeTransfer, getTransferSnapshot, getTransferSnapshot);
}
