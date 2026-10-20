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
 * 迁移到 daisyUI：筛选 → 官方 `filter` 组件布局（form.filter + 类型 checkbox，选中态按类型着色
 * `checked:btn-*`，圆角统一 1rem）；「全部」改普通 button（官方 reset 会被 CSS 自动隐藏），
 * 选中态 `btn-neutral` 着色，
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

/** 类型 → daisyUI 语义色类（颜色全部来自主题，不再写死 hex）；filter 按钮选中态色用 checked: 变体 */
const TYPES: Array<{ type: LogType; label: string; text: string; bar: string; btn: string }> = [
    { type: 'info', label: '信息', text: 'text-info', bar: 'border-l-info', btn: 'checked:btn-info' },
    { type: 'success', label: '成功', text: 'text-success', bar: 'border-l-success', btn: 'checked:btn-success' },
    { type: 'warning', label: '警告', text: 'text-warning', bar: 'border-l-warning', btn: 'checked:btn-warning' },
    { type: 'error', label: '错误', text: 'text-error', bar: 'border-l-error', btn: 'checked:btn-error' },
];

const metaOf = (t: LogType) => TYPES.find((m) => m.type === t) || TYPES[0];

/**
 * 四个类型的勾选状态 —— **唯一事实源**。默认全选（= 「全部」）。
 *
 * v26.10.20-v24 修正：此前是「filter 四个布尔 + allMode 独立布尔」两套状态，
 * 且 `toggleType` 里写成 `allMode = !TYPES.every(...)`（取反）——勾上任一类型后
 * allMode 反而被置 true，`shown` 直接返回全量，筛选完全不生效。
 * 现改为「全部」= 四个全选中的派生状态（computed），不可能两套状态打架：
 *   · 点「全部」：未全选 → 四个全勾上；已全选 → 四个全部取消；
 *   · 点某个类型：只翻转它自己，四类齐了「全部」自动亮、缺一个自动灭。
 */
const filter = ref<Record<LogType, boolean>>({ info: true, success: true, warning: true, error: true });
/** 「全部」选中态 = 四个类型全勾上（派生，不单独存状态） */
const allMode = computed(() => TYPES.every((m) => filter.value[m.type]));
/** 是否至少选了一个类型（全不选时给空态一句更准确的提示） */
const anyFilter = computed(() => TYPES.some((m) => filter.value[m.type]));
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
const latest = computed(() => source.value[0]);

/** 点「全部」：未全选 → 四个类型全勾上；已全选 → 全部取消。 */
function selectAll() {
    const next = !allMode.value;
    filter.value = { info: next, success: next, warning: next, error: next };
}

/** 点某个类型：只翻转它自己（「全部」由 allMode 派生，无需手工同步） */
function toggleType(type: LogType, checked: boolean) {
    filter.value = { ...filter.value, [type]: checked };
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
        :footer="false"
        @update:open="(v: boolean) => emit('update:open', v)">
        <div class="flex items-start justify-between gap-2">
            <!-- 类型筛选：**不用** daisyUI 的 `filter` 组件 —— 官方 filter 的语义是
                 「radio 组 + filter-reset（单值互斥）」，而这里是多选（可同时看多类日志）。
                 冒用组件类会误导读屏器与后续维护者，故按官方 filter 的排布自己拼：
                 flex + wrap + gap-1（= 官方 .filter 的 margin-inline-end: .25rem 视觉），
                 选中态仍是 btn-neutral / 类型色，input 仍是带 aria-label 的 checkbox。 -->
            <div data-log-filter="1" role="group" aria-label="日志类型筛选" class="flex flex-wrap gap-1">
                <button
                    type="button"
                    class="btn btn-sm"
                    :class="allMode ? 'btn-neutral' : 'btn-ghost'"
                    :aria-pressed="allMode"
                    :title="allMode ? '取消全部（四个类型一并取消）' : '选中全部类型'"
                    @click="selectAll">
                    全部
                </button>
                <input
                    v-for="m in TYPES"
                    :key="m.type"
                    class="btn btn-sm"
                    :class="m.btn"
                    type="checkbox"
                    :checked="filter[m.type]"
                    :aria-label="m.label + ' ' + (counts[m.type] || 0)"
                    :title="filter[m.type] ? '点击隐藏该类日志' : '点击显示该类日志'"
                    @change="toggleType(m.type, ($event.target as HTMLInputElement).checked)" />
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
                {{ source.length ? (anyFilter ? '没有符合当前筛选条件的日志' : '未选择任何类型') : '暂无日志' }}
            </div>
        </div>

        <!-- 状态栏：总数 · 显示数 · 最新时间 -->
        <div
            class="mt-2 flex items-center justify-between gap-2 border-t border-base-300 pt-1.5 text-[11.5px] text-base-content/60">
            <span>
                共 <b class="text-base-content">{{ source.length }}</b> 条 · 显示
                <b class="text-base-content">{{ shown.length }}</b> 条
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
    </AppDialog>
</template>
