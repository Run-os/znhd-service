<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@vue/icons';
import { getDeviceId } from '@/lib/relay';
import { safeCopyText } from '@/lib/clipboard';
import { shortPhoneId } from '@/lib/ui/transfer/deviceColors';
import { useTransferStore } from '@vue/composables/useTransferStore';
import DarkDialog from './DarkDialog.vue';

/** 企业信息（第一栏底部入口）：排查「连不上」时先确认这几项。 */
const open = defineModel<boolean>('open', { default: false });

const store = useTransferStore();
const deviceId = getDeviceId();
const version = computed(() => GM_info?.script?.version || '未知');

/** v26.10.20-v16：设备 ID 不再用彩色标签，直接纯文本（短串，多台用「、」分隔） */
const phoneIds = computed(() => store.value.phones.map((p) => shortPhoneId(p.id)).join('、'));

function openHome() {
    window.open('https://github.com/Run-os/znhd-service', '_blank');
}
</script>

<template>
    <DarkDialog v-model:open="open" title="企业信息" :width="440">
        <div class="flex gap-3 border-b border-base-300 py-[7px]">
            <span class="shrink-0 text-[13px] opacity-65" style="flex: 0 0 92px">中继服务器</span>
            <span class="min-w-0 flex-1 break-all text-[13px]">{{ store.settings.relayServer || '（未配置）' }}</span>
        </div>
        <div class="flex gap-3 border-b border-base-300 py-[7px]">
            <span class="shrink-0 text-[13px] opacity-65" style="flex: 0 0 92px">本机设备</span>
            <span class="inline-flex min-w-0 flex-1 items-center gap-1.5">
                <span class="min-w-0 break-all text-[13px]">{{ deviceId }}</span>
                <button
                    class="btn btn-ghost btn-sm btn-square shrink-0 text-base-content/60 hover:text-base-content"
                    aria-label="复制设备 ID"
                    title="复制设备 ID"
                    @click="safeCopyText(deviceId)">
                    <Icon name="copy" :size="13" />
                </button>
            </span>
        </div>
        <div class="flex gap-3 border-b border-base-300 py-[7px]">
            <span class="shrink-0 text-[13px] opacity-65" style="flex: 0 0 92px">在线手机</span>
            <span class="min-w-0 flex-1 break-all text-[13px]">
                <template v-if="store.phones.length">
                    {{ phoneIds }}
                    <span class="ml-1.5 text-[11px] opacity-65">共 {{ store.phones.length }} 台</span>
                </template>
                <span v-else class="text-[13px] text-base-content/60">暂无（手机端打开本机链接后出现）</span>
            </span>
        </div>
        <div class="flex gap-3 border-b border-base-300 py-[7px]">
            <span class="shrink-0 text-[13px] opacity-65" style="flex: 0 0 92px">脚本版本</span>
            <span class="min-w-0 flex-1 break-all text-[13px]">{{ version }}</span>
        </div>
        <div class="flex gap-3 border-b border-base-300 py-[7px]">
            <span class="shrink-0 text-[13px] opacity-65" style="flex: 0 0 92px">项目主页</span>
            <span class="min-w-0 flex-1">
                <button class="btn btn-link btn-sm h-auto px-0 text-[13px]" @click="openHome">
                    github.com/Run-os/znhd-service
                </button>
            </span>
        </div>
        <div class="mt-2.5 text-xs text-base-content/60">
            提示：排查「连不上」时先看这里 —— 中继地址是否可达、手机是否出现在在线列表里；
            会话记录保存在本机（IndexedDB），仅保留最近 7 天，超期自动清理。
        </div>

        <template #footer>
            <button class="btn btn-sm" @click="open = false">关闭</button>
        </template>
    </DarkDialog>
</template>
