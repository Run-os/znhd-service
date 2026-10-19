<script setup lang="ts">
import type { PhoneInfo } from '@/lib/transfer/types';
import DarkDialog from './DarkDialog.vue';
import PairPanel from './PairPanel.vue';

/** 配对窗口（第二栏「＋」）：只负责配对与连通性验证，真正的收发在聊天区。 */
const open = defineModel<boolean>('open', { default: false });
defineProps<{ relayServer: string; phones: PhoneInfo[] }>();
</script>

<template>
    <DarkDialog v-model:open="open" title="配对设备" :width="520">
        <PairPanel :relay-server="relayServer" :phones="phones" />
    </DarkDialog>
</template>
