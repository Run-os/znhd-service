<script setup lang="ts">
import type { LogEntry, LogType } from '@/lib/logger';
import { computed, nextTick, ref, watch } from 'vue';
import AppDialog from './AppDialog.vue';

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
 *
 * 迁移到 daisyUI：筛选按钮 → `btn btn-sm`（选中态 `btn-active`），
 * 日志区底色 → `bg-neutral text-neutral-content`，类型色 → `text-info/success/warning/error`，
 * 「自动刷新」→ `toggle`。
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

/** 类型 → daisyUI 语义色类（颜色全部来自主题，不再写死 hex） */
const TYPES: Array<{ type: LogType; label: string; text: string; bar: string; btn: string }> = [
    { type: 'info', label: '信息', text: 'text-info', bar: 'border-l-info', btn: 'btn-info' },
    { type: 'success', label: '成功', text: 'text-success', bar: 'border-l-success', btn: 'btn-success' },
    { type: 'warning', label: '警告', text: 'text-warning', bar: 'border-l-warning', btn: 'btn-warning' },
    { type: 'error', label: '错误', text: 'text-error', bar: 'border-l-error', btn: 'btn-error' },
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
                    class="btn btn-sm"
                    :class="allOn ? 'btn-active' : ''"
                    :title="allOn ? '点击隐藏该类日志' : '点击显示该类日志'"
                    @click="toggleAll">
                    {{ allOn ? '全部' : '全部' }}
                </button>
                <button
                    v-for="m in TYPES"
                    :key="m.type"
                    type="button"
                    class="btn btn-sm"
                    :class="filter[m.type] ? m.btn : ''"
                    :title="filter[m.type] ? '点击隐藏该类日志' : '点击显示该类日志'"
                    @click="filter[m.type] = !filter[m.type]">
                    {{ m.label }} {{ counts[m.type] || 0 }}
                </button>
            </div>
            <button
                class="btn btn-error btn-sm shrink-0"
                :disabled="props.logEntries.length === 0"
                @click="emit('clear')">
                清空
            </button>
        </div>

        <!-- 终端风日志区：颜色全部取自当前主题的 neutral -->
        <div
            ref="scroller"
            class="mt-2.5 flex h-[360px] flex-col overflow-y-auto rounded-box border border-neutral-content/10 bg-neutral py-2 font-mono text-[12.5px] leading-[1.9] text-neutral-content">
            <template v-if="rows.length">
                <div
                    v-for="(entry, i) in rows"
                    :key="i"
                    class="flex items-start gap-2 border-l-[3px] px-[10px] py-[2px] pl-[9px] hover:bg-neutral-content/10"
                    :class="metaOf(entry.type).bar">
                    <span class="flex-none basis-[86px] opacity-55">{{ entry.timestamp }}</span>
                    <span class="flex-none basis-[52px] font-semibold" :class="metaOf(entry.type).text">
                        {{ metaOf(entry.type).label }}
                    </span>
                    <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        {{ entry.message }}
                    </span>
                </div>
            </template>
            <div v-else class="py-6 text-center opacity-55">
                {{ source.length ? '没有符合当前筛选条件的日志' : '暂无日志' }}
            </div>
        </div>

        <!-- 状态栏：总数 · 显示数 · 最新时间 -->
        <div
            class="mt-2 flex items-center justify-between gap-2 border-t border-base-300 pt-1.5 text-[11.5px] text-base-content/60">
            <span>
                共 <b class="text-base-content">{{ source.length }}</b> 条 · 显示
                <b class="text-base-content">{{ shown.length }}</b> 条（{{ allOn ? '全类型' : '已选' }}）
                {{ props.autoRefresh ? '' : ' · 已冻结' }}
            </span>
            <span class="flex items-center gap-2.5">
                <label
                    class="flex items-center gap-1.5"
                    title="开启后新日志持续刷新并自动滚到底部；关闭后列表冻结在当前快照，便于往上翻看历史">
                    <input
                        type="checkbox"
                        class="toggle toggle-sm"
                        :checked="props.autoRefresh"
                        @change="emit('update:autoRefresh', ($event.target as HTMLInputElement).checked)" />
                    自动刷新
                </label>
                <span>
                    最新
                    <span class="font-mono" :class="latest ? metaOf(latest.type).text : 'opacity-55'">
                        {{ latest ? latest.timestamp : '--:--:--' }}
                    </span>
                </span>
            </span>
        </div>

        <template #footer>
            <button class="btn btn-outline btn-sm" @click="emit('update:open', false)">关闭</button>
        </template>
    </AppDialog>
</template>
