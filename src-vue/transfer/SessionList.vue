<script setup lang="ts">
import { computed } from 'vue';
import { Input } from '@vue/components/ui/input';
import { Icon } from '@vue/icons';
import { RADIUS, WECHAT } from '@/lib/ui/transfer/wechatTheme';
import { listTime, previewText } from './format';
import type { DeviceEntry, TransferNav } from './types';

/**
 * 第二栏：会话列表（v26.10.18-v5，对齐 React 版 `TransferSessionList`）。
 *
 *  · 对话分组：搜索框 +「＋」（配对设备）→ 会话列表；
 *  · 文件分组：没有「＋」，条目变成**筛选第三栏的文件视图**，最上面常驻「全部文件」。
 */
const props = defineProps<{
    nav: TransferNav;
    search: string;
    deviceEntries: DeviceEntry[];
    activeSessionKey: string;
    filesActiveKey: string;
}>();
const emit = defineEmits<{
    (e: 'update:search', v: string): void;
    (e: 'pair'): void;
    (e: 'select', key: string): void;
    (e: 'select-files-session', key: string): void;
}>();

const isFiles = computed(() => props.nav === 'files');
const keyword = computed(() => props.search.trim().toLowerCase());

const filtered = computed(() =>
    keyword.value
        ? props.deviceEntries.filter(
              (e) =>
                  e.label.toLowerCase().includes(keyword.value) ||
                  previewText(e.lastMsg).toLowerCase().includes(keyword.value)
          )
        : props.deviceEntries
);

function pick(e: DeviceEntry) {
    if (isFiles.value) emit('select-files-session', e.key);
    else emit('select', e.key);
}

function isActive(e: DeviceEntry): boolean {
    return isFiles.value ? e.key === props.filesActiveKey : e.key === props.activeSessionKey;
}

/** 会话条目的公共外观（选中比栏底浅一档，悬停中间档） */
function itemStyle(active: boolean) {
    return {
        borderRadius: RADIUS.control + 'px',
        background: active ? WECHAT.selected : 'transparent',
    };
}
</script>

<template>
    <div class="znhd-transfer-sessions flex min-w-0 shrink-0 flex-col" :style="{ width: '250px', background: WECHAT.list }">
        <!-- 搜索框 +「＋」（文件分组没有「＋」） -->
        <div class="flex gap-1.5 px-2.5 pb-2 pt-2.5">
            <div class="relative min-w-0 flex-1">
                <Icon name="search" :size="14" color="rgba(255,255,255,0.35)" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" />
                <Input
                    :model-value="search"
                    placeholder="搜索"
                    class="!h-8 !rounded-[8px] !border-white/10 !bg-[#1E1E1E] !pl-7 !text-[13px] !text-white/85 placeholder:!text-white/30"
                    @update:model-value="(v: string | number) => emit('update:search', String(v))" />
            </div>
            <button
                v-if="!isFiles"
                type="button"
                aria-label="配对设备"
                title="配对设备（手机扫码 / 打开链接即完成配对）"
                class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-[#1E1E1E] p-0 text-white/65 outline-none hover:text-white"
                @click="emit('pair')">
                <Icon name="plus" :size="16" />
            </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2.5">
            <template v-if="filtered.length">
                <!-- 文件分组：常驻「全部文件」 -->
                <div
                    v-if="isFiles"
                    data-all-files="1"
                    class="znhd-transfer-session-item flex cursor-pointer items-center gap-2.5 px-2.5 py-[9px]"
                    :style="itemStyle(filesActiveKey === '')"
                    title="全部文件"
                    @click="emit('select-files-session', '')">
                    <span
                        class="inline-flex size-9 shrink-0 items-center justify-center rounded-[8px]"
                        :style="{ background: WECHAT.bubblePeer, color: 'rgba(255,255,255,0.8)' }">
                        <Icon name="grid" :size="18" />
                    </span>
                    <div class="min-w-0 flex-1">
                        <div class="truncate text-[13px] text-white/90">全部文件</div>
                        <div class="mt-px truncate text-xs text-white/40">所有会话的图片、文件与文本</div>
                    </div>
                </div>

                <div
                    v-for="e in filtered"
                    :key="e.key"
                    class="znhd-transfer-session-item flex cursor-pointer items-center gap-2.5 px-2.5 py-[9px] hover:bg-[#2C2C2C]"
                    :style="itemStyle(isActive(e))"
                    :title="e.label"
                    @click="pick(e)">
                    <span
                        class="relative inline-flex size-9 shrink-0 items-center justify-center rounded-[8px] text-sm font-semibold"
                        :style="{
                            background: e.isAggregate ? WECHAT.bubblePeer : 'rgba(7,193,96,0.16)',
                            color: e.isAggregate ? 'rgba(255,255,255,0.8)' : WECHAT.primary,
                        }">
                        <Icon v-if="e.isAggregate" name="smartphone" :size="18" />
                        <template v-else>{{ e.label.slice(0, 1).toUpperCase() }}</template>
                        <span
                            v-if="e.online"
                            class="absolute -bottom-0.5 -right-0.5 size-[9px] rounded-full border-[1.5px]"
                            :style="{ background: '#52c41a', borderColor: WECHAT.list }" />
                    </span>
                    <div class="min-w-0 flex-1">
                        <div class="truncate text-[13px] text-white/90">{{ e.label }}</div>
                        <div class="mt-px truncate text-xs text-white/40">
                            {{ e.lastMsg ? previewText(e.lastMsg) : e.online ? '在线' : '离线' }}
                        </div>
                    </div>
                    <div class="shrink-0 text-right">
                        <div class="text-[11px] text-white/35">{{ listTime(e.lastTs || 0) }}</div>
                        <div
                            v-if="e.unread > 0"
                            class="ml-auto mt-1 min-w-4 rounded-[9px] bg-[#FA5151] px-1.5 text-center text-[11px] leading-4 text-white">
                            {{ e.unread > 99 ? '99+' : e.unread }}
                        </div>
                    </div>
                </div>
            </template>
            <div v-else class="px-1 py-3 text-center text-xs text-white/35">
                {{ keyword ? '没有匹配的会话 / 设备' : isFiles ? '暂无文件' : '暂无会话——点右上角 + 配对手机' }}
            </div>
        </div>
    </div>
</template>
