<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { LogEntry, LogType } from '@/lib/logger';
import AppDialog from './AppDialog.vue';
import Switch from '../components/ui/switch/Switch.vue';
import { Button } from '@vue/components/ui/button';

/**
 * 运行日志弹窗（Vue 版，对应 React 的 `LogModal`）。
 *
 * 版式沿用 v26.10.07-v1 的「暗色终端风」：等宽字体 + 三栏行（时间戳 86px / 类型标签 52px / 消息）。
 *
 * ⚠️ 排序：`logger.ts` 写入顺序是「最新在前」，这里渲染前 `slice().reverse()`，
 *    于是 DOM 顺序 = 视觉顺序 = 最旧在上、最新在下。容器保持 column，
 *    **不用 column-reverse**（那会翻转滚动原点与阅读方向）。
 *
 * ⚠️ 自动刷新：
 *    · 开（默认）：新日志持续进来并滚到底部；
 *    · 关：列表冻结在关闭那一刻的快照，往上翻历史不会被打断；
 *    · 开关持久化在 Allvalue.logAutoRefresh，由父组件负责存取。
 */
const props = defineProps<{
    open: boolean;
    logEntries: LogEntry[];
    autoRefresh: boolean;
}>();

const emit = defineEmits<{
    'update:open': [boolean];
    clear: [];
    'update:autoRefresh': [boolean];
}>();

const TYPES: Array<{ type: LogType; label: string; color: string; fg: string; bg: string; bar: string }> = [
    { type: 'info', label: '信息', color: '#1677ff', fg: '#ffffff', bg: 'transparent', bar: 'transparent' },
    { type: 'success', label: '成功', color: '#52c41a', fg: '#08130c', bg: 'rgba(82,196,26,.06)', bar: '#52c41a' },
    { type: 'warning', label: '警告', color: '#faad14', fg: '#332a0a', bg: 'rgba(250,173,20,.07)', bar: '#faad14' },
    { type: 'error', label: '错误', color: '#ff4d4f', fg: '#ffffff', bg: 'rgba(255,77,79,.08)', bar: '#ff4d4f' },
];

const metaOf = (t: LogType) => TYPES.find((m) => m.type === t) || TYPES[0];

const filter = ref<Record<LogType, boolean>>({ info: true, success: true, warning: true, error: true });
/** 关闭自动刷新时冻结下来的列表快照 */
const snapshot = ref<LogEntry[]>([]);
const scroller = ref<HTMLDivElement | null>(null);

// 关掉自动刷新：先冻结「此刻」的列表，否则 source 立刻切到空快照、列表瞬间清空
watch(
    () => props.autoRefresh,
    (next, prev) => {
        if (prev && !next) snapshot.value = props.logEntries;
    }
);

const source = computed(() => (props.autoRefresh ? props.logEntries : snapshot.value));

const counts = computed(() => {
    const c: Record<string, number> = { info: 0, success: 0, warning: 0, error: 0 };
    source.value.forEach((e) => (c[e.type] = (c[e.type] || 0) + 1));
    return c;
});
const shown = computed(() => source.value.filter((e) => filter.value[e.type]));
/** 反转成「最旧在上、最新在下」——不污染原数组 */
const rows = computed(() => shown.value.slice().reverse());
const allOn = computed(() => TYPES.every((m) => filter.value[m.type]));
const latest = computed(() => source.value[0]);

function toggleAll() {
    const next = !allOn.value;
    filter.value = { info: next, success: next, warning: next, error: next };
}

// 打开 / 新日志 / 重新开启自动刷新 / 切换筛选 → 滚到底部看最新内容。
// 冻结态下 autoRefresh=false，直接不滚动（正确行为）。
async function scrollToBottom() {
    if (!props.open || !props.autoRefresh) return;
    await nextTick();
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
}

watch([() => props.open, () => props.logEntries, () => props.autoRefresh, filter], scrollToBottom);
</script>

<template>
    <AppDialog
        :open="props.open"
        title="运行日志"
        :width="560"
        :footer="true"
        @update:open="(v: boolean) => emit('update:open', v)">
        <div class="flex items-start justify-between gap-2">
            <div class="flex flex-wrap gap-1.5">
                <button
                    type="button"
                    class="cursor-pointer select-none rounded-[11px] border px-2.5 py-0 text-xs font-medium leading-5"
                    :style="{
                        borderColor: allOn ? '#6b7b8d' : '#3a4655',
                        background: allOn ? '#6b7b8d' : 'transparent',
                        color: allOn ? '#ffffff' : '#8b9aab',
                    }"
                    :title="allOn ? '点击隐藏该类日志' : '点击显示该类日志'"
                    @click="toggleAll">
                    {{ allOn ? '全部（点此全隐）' : '全部' }}
                </button>
                <button
                    v-for="m in TYPES"
                    :key="m.type"
                    type="button"
                    class="cursor-pointer select-none rounded-[11px] border px-2.5 py-0 text-xs font-medium leading-5"
                    :style="{
                        borderColor: filter[m.type] ? m.color : '#3a4655',
                        background: filter[m.type] ? m.color : 'transparent',
                        color: filter[m.type] ? m.fg : '#8b9aab',
                    }"
                    :title="filter[m.type] ? '点击隐藏该类日志' : '点击显示该类日志'"
                    @click="filter[m.type] = !filter[m.type]">
                    {{ m.label }} {{ counts[m.type] || 0 }}
                </button>
            </div>
            <Button
                variant="destructive"
                size="sm"
                class="shrink-0"
                :disabled="props.logEntries.length === 0"
                @click="emit('clear')">
                清空
            </Button>
        </div>

        <!-- 暗色终端日志区 -->
        <div
            ref="scroller"
            class="mt-2.5 flex h-[360px] flex-col overflow-y-auto rounded-[4px] border border-[#1f2733] bg-[#0f141a] py-2 font-mono text-[12.5px] leading-[1.9]">
            <template v-if="rows.length">
                <div
                    v-for="(entry, i) in rows"
                    :key="i"
                    class="flex items-start gap-2 border-l-[3px] px-[10px] py-[2px] pl-[9px] hover:bg-white/10"
                    :style="{ background: metaOf(entry.type).bg, borderLeftColor: metaOf(entry.type).bar }">
                    <span class="flex-none basis-[86px] text-[#52667a]">{{ entry.timestamp }}</span>
                    <span class="flex-none basis-[52px] font-semibold" :style="{ color: metaOf(entry.type).color }">
                        {{ metaOf(entry.type).label }}
                    </span>
                    <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-[#c3d1df]">
                        {{ entry.message }}
                    </span>
                </div>
            </template>
            <div v-else class="py-6 text-center text-[#6b7b8d]">
                {{ source.length ? '没有符合当前筛选条件的日志' : '暂无日志' }}
            </div>
        </div>

        <!-- 状态栏：总数 · 显示数 · 最新时间 -->
        <div
            class="mt-2 flex items-center justify-between gap-2 border-t border-[#1f2733] pt-1.5 text-[11.5px] text-[#6b7b8d]">
            <span>
                共 <b class="text-[#c3d1df]">{{ source.length }}</b> 条 · 显示
                <b class="text-[#c3d1df]">{{ shown.length }}</b> 条（{{ allOn ? '全类型' : '已选' }}）
                {{ props.autoRefresh ? '' : ' · 已冻结' }}
            </span>
            <span class="flex items-center gap-2.5">
                <span
                    class="flex items-center gap-1.5"
                    title="开启后新日志持续刷新并自动滚到底部；关闭后列表冻结在当前快照，便于往上翻看历史">
                    <Switch
                        :model-value="props.autoRefresh"
                        @update:model-value="(v: boolean) => emit('update:autoRefresh', v)" />
                    自动刷新
                </span>
                <span>
                    最新
                    <span class="font-mono" :style="{ color: latest ? metaOf(latest.type).color : '#6b7b8d' }">
                        {{ latest ? latest.timestamp : '--:--:--' }}
                    </span>
                </span>
            </span>
        </div>

        <template #footer>
            <Button variant="outline" size="sm" @click="emit('update:open', false)">关闭</Button>
        </template>
    </AppDialog>
</template>
