<script setup lang="ts">
import type { PhoneInfo } from '@/lib/transfer/types';
import AppDialog from '@vue/panel/AppDialog.vue';
import PairPanel from './PairPanel.vue';

/** 配对窗口（第二栏「＋」）：只负责配对与连通性验证，真正的收发在聊天区。 */
const open = defineModel<boolean>('open', { default: false });
defineProps<{ relayServer: string; phones: PhoneInfo[] }>();
</script>

<template>
    <!-- variant="plain"：原 DarkDialog 壳（v26.10.25-v8 并入 AppDialog），无默认确定钮 -->
    <AppDialog v-model:open="open" variant="plain" title="配对设备" :width="520">
        <PairPanel :relay-server="relayServer" :phones="phones" />
    </AppDialog>
</template>
