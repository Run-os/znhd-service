<script setup lang="ts">
import { Icon } from '@vue/icons';
import type { PhoneInfo } from '@/lib/transfer/types';
import DarkDialog from './DarkDialog.vue';
import PairPanel from './PairPanel.vue';

/** 配对窗口（第二栏「＋」）：只负责配对与连通性验证，真正的收发在聊天区。 */
const open = defineModel<boolean>('open', { default: false });
defineProps<{ relayServer: string; phones: PhoneInfo[] }>();
</script>

<template>
    <DarkDialog v-model:open="open" title="配对设备" :width="520">
        <template #default>
            <PairPanel :relay-server="relayServer" :phones="phones" />
        </template>
        <template #footer>
            <span class="mr-auto text-xs text-white/45">手机扫码即配对</span>
            <button
                type="button"
                class="cursor-pointer rounded-[6px] border-0 bg-white/[0.12] px-3.5 py-1 text-[13px] text-white outline-none hover:bg-white/20"
                @click="open = false">
                关闭
            </button>
        </template>
    </DarkDialog>
</template>
