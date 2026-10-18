<script setup lang="ts">
import { computed } from 'vue';
import { Button } from '@vue/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@vue/components/ui/input-group';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@vue/components/ui/item';
import { Icon } from '@vue/icons';
import { RADIUS, WECHAT } from '@/lib/ui/transfer/wechatTheme';
import { listTime, previewText } from './format';
import type { DeviceEntry, TransferNav } from './types';

/**
 * 第二栏：会话列表（对齐 React 版 `TransferSessionList`）。
 *
 *  · 对话分组：搜索框（官方 **InputGroup** + 搜索图标 addon）+「＋」（配对设备）→ 会话列表；
 *  · 文件分组：没有「＋」，条目变成**筛选第三栏的文件视图**，最上面常驻「全部文件」；
 *  · 每条会话 = 官方 **Item**（ItemMedia 头像 / ItemContent 标题+摘要 / ItemActions 时间+未读）。
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
        <div class="flex items-start gap-1.5 px-2.5 pb-2 pt-2.5">
            <InputGroup class="min-w-0 flex-1">
                <InputGroupAddon>
                    <Icon name="search" :size="14" />
                </InputGroupAddon>
                <InputGroupInput
                    :model-value="search"
                    placeholder="搜索"
                    class="text-[13px]"
                    @update:model-value="(v: string | number) => emit('update:search', String(v))" />
            </InputGroup>
            <Button
                v-if="!isFiles"
                variant="secondary"
                size="icon-sm"
                aria-label="配对设备"
                title="配对设备（手机扫码 / 打开链接即完成配对）"
                class="shrink-0 text-muted-foreground hover:text-foreground"
                @click="emit('pair')">
                <Icon name="plus" :size="16" />
            </Button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2.5">
            <template v-if="filtered.length">
                <!-- 文件分组：常驻「全部文件」 -->
                <Item
                    v-if="isFiles"
                    data-all-files="1"
                    size="xs"
                    class="znhd-transfer-session-item cursor-pointer gap-2.5 px-2.5 py-[9px] hover:bg-[#2C2C2C]"
                    :style="itemStyle(filesActiveKey === '')"
                    title="全部文件"
                    @click="emit('select-files-session', '')">
                    <ItemMedia
                        class="inline-flex size-9 shrink-0 items-center justify-center rounded-[8px]"
                        :style="{ background: WECHAT.bubblePeer, color: 'rgba(255,255,255,0.8)' }">
                        <Icon name="grid" :size="18" />
                    </ItemMedia>
                    <ItemContent class="min-w-0 flex-1 gap-0">
                        <ItemTitle class="truncate text-[13px] text-foreground">全部文件</ItemTitle>
                        <ItemDescription class="mt-px truncate text-xs">所有会话的图片、文件与文本</ItemDescription>
                    </ItemContent>
                </Item>

                <Item
                    v-for="e in filtered"
                    :key="e.key"
                    size="xs"
                    class="znhd-transfer-session-item cursor-pointer gap-2.5 px-2.5 py-[9px] hover:bg-[#2C2C2C]"
                    :style="itemStyle(isActive(e))"
                    :title="e.label"
                    @click="pick(e)">
                    <ItemMedia
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
                    </ItemMedia>
                    <ItemContent class="min-w-0 flex-1 gap-0">
                        <ItemTitle class="truncate text-[13px] text-foreground">{{ e.label }}</ItemTitle>
                        <ItemDescription class="mt-px truncate text-xs">
                            {{ e.lastMsg ? previewText(e.lastMsg) : e.online ? '在线' : '离线' }}
                        </ItemDescription>
                    </ItemContent>
                    <ItemActions class="shrink-0 flex-col items-end gap-1 self-start">
                        <span class="text-[11px] text-muted-foreground/70">{{ listTime(e.lastTs || 0) }}</span>
                        <span
                            v-if="e.unread > 0"
                            class="min-w-4 rounded-[9px] bg-[#FA5151] px-1.5 text-center text-[11px] leading-4 text-white">
                            {{ e.unread > 99 ? '99+' : e.unread }}
                        </span>
                    </ItemActions>
                </Item>
            </template>
            <div v-else class="px-1 py-3 text-center text-xs text-muted-foreground/60">
                {{ keyword ? '没有匹配的会话 / 设备' : isFiles ? '暂无文件' : '暂无会话——点右上角 + 配对手机' }}
            </div>
        </div>
    </div>
</template>
