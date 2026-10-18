<script setup lang="ts">
import { Icon } from '@vue/icons';
import { RADIUS, WECHAT } from '@/lib/ui/transfer/wechatTheme';
import type { TransferNav } from './types';

/**
 * 第一栏：微信式窄图标栏（v26.10.18-v5）。
 *
 * 三态与 React 版一致：默认白描边 / 悬停加圆角底板（仅未选中）/ 选中变微信绿不叠底板。
 * 未读总数挂在「对话」右上角（微信同款位置）。
 */
const props = defineProps<{ nav: TransferNav; unreadTotal: number }>();
const emit = defineEmits<{
    (e: 'nav', v: TransferNav): void;
    (e: 'settings'): void;
    (e: 'about'): void;
}>();

const ITEMS: Array<{ key: TransferNav; label: string; icon: 'message' | 'files' }> = [
    { key: 'devices', label: '对话', icon: 'message' },
    { key: 'files', label: '文件', icon: 'files' },
];

function itemClass(active: boolean) {
    return [
        'relative mx-auto flex size-10 cursor-pointer items-center justify-center rounded-[10px] border-0 p-0 outline-none',
        active ? 'text-[#07C160]' : 'text-white/90 hover:bg-white/10 hover:shadow-[0_2px_8px_rgba(0,0,0,0.35)]',
    ];
}
</script>

<template>
    <div
        class="znhd-transfer-nav flex shrink-0 flex-col items-center pb-2 pt-2.5"
        :style="{ width: '58px', background: WECHAT.rail }">
        <!-- logo -->
        <span
            title="传输助手"
            class="mb-3.5 inline-flex size-9 shrink-0 items-center justify-center text-white"
            :style="{ background: WECHAT.primary, borderRadius: RADIUS.control + 2 + 'px' }">
            <Icon name="transfer" :size="20" color="#fff" />
        </span>

        <!-- 中部入口 -->
        <div class="flex flex-col gap-1.5">
            <button
                v-for="item in ITEMS"
                :key="item.key"
                type="button"
                :aria-label="item.label"
                :aria-current="nav === item.key ? 'page' : undefined"
                :title="item.label"
                :class="itemClass(nav === item.key)"
                @click="emit('nav', item.key)">
                <Icon :name="item.icon" :size="20" />
                <span
                    v-if="item.key === 'devices' && props.unreadTotal > 0"
                    class="absolute right-0.5 top-0.5 h-[15px] min-w-[15px] rounded-[9px] bg-[#FA5151] px-1 text-center text-[10px] font-semibold leading-[15px] text-white">
                    {{ props.unreadTotal > 99 ? '99+' : props.unreadTotal }}
                </span>
            </button>
        </div>

        <span class="flex-1" />

        <!-- 底部：设置 / 企业信息 -->
        <div class="flex flex-col gap-1.5">
            <button type="button" aria-label="设置" title="设置" :class="itemClass(false)" @click="emit('settings')">
                <Icon name="settings" :size="19" />
            </button>
            <button type="button" aria-label="企业信息" title="企业信息" :class="itemClass(false)" @click="emit('about')">
                <Icon name="info" :size="19" />
            </button>
        </div>
    </div>
</template>
