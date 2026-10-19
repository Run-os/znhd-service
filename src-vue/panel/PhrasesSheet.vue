<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { addLog } from '@/lib/logger';
import { appendToTinyMCE } from '@/lib/tinymce';
import { safeCopyText } from '@/lib/clipboard';
import type { ZnhdPhrases } from '@/lib/phrasesZnhd';
import { Icon } from '@vue/icons';
import { toast } from '@vue/lib/toast';

/**
 * 常用语侧边栏（Vue 版，对应 React 的 `PhrasesDrawer`）。
 *
 * 迁移到 daisyUI 后的组件构成（全部官方原生）：
 *   `modal modal-end`（右侧弹层）+ `tabs tabs-box`（radio input 式，全部/我的）+ `input`（带图标，label 包裹）
 *   + `list/list-row`（每条话术）+ `hero`（空态）+ `loading`（加载中）+ `btn` + `tooltip`。
 *
 * ⚠️ 为什么用 `modal-end` 而不是 `drawer`：
 *    daisyUI 的 `drawer` 是**整页 grid 布局**（drawer-toggle + drawer-content + drawer-side 三件套，
 *    要求父容器有确定高度），套在面板里的一个局部面板上会把主面板布局撑开、并多出一层空的
 *    drawer-content 占位。`modal-end` 是 modal 组件的官方 placement，同样实现"右侧贴边"，
 *    且由 `<dialog>` 的 top layer 负责层级，对现有布局零副作用。如需改用 drawer 请告知。
 */
const props = defineProps<{
    open: boolean;
    phrasesData: ZnhdPhrases;
    phrasesLoading: boolean;
    searchKeyword: string;
}>();

const emit = defineEmits<{
    'update:open': [boolean];
    'update:searchKeyword': [string];
    /** force=true 无视缓存重新抓取 */
    reload: [boolean];
}>();

const keyword = computed(() => props.searchKeyword.trim().toLowerCase());
const hit = (t: string) => !keyword.value || t.toLowerCase().includes(keyword.value);
const all = computed(() => (props.phrasesData.all || []).filter(hit));
const mine = computed(() => (props.phrasesData.mine || []).filter(hit));

/** 当前 tab（官方 radio input 式 tabs，状态由 Vue 受控） */
const tab = ref<'all' | 'mine'>('all');

const rows = computed(() => (tab.value === 'all' ? all.value : mine.value));
const emptyText = computed(() =>
    tab.value === 'all' ? '暂无全部话术，点右上角刷新抓取' : '暂无我的话术，点右上角刷新抓取'
);

const dlg = ref<HTMLDialogElement | null>(null);

function sync(v: boolean): void {
    const el = dlg.value;
    if (!el) return;
    if (v && !el.open) el.showModal();
    else if (!v && el.open) el.close();
}

watch(
    () => props.open,
    (v) => sync(v)
);
onMounted(() => {
    if (props.open) sync(true);
});

/** 点一条：复制 + 关抽屉 + 追加到 TinyMCE（与 React 版顺序一致） */
function pick(text: string) {
    safeCopyText(text);
    emit('update:open', false);
    appendToTinyMCE(text);
    addLog(`添加文本: ${text}`, 'success');
    toast.success('添加文本: ' + text);
}
</script>

<template>
    <dialog ref="dlg" class="modal modal-end" @close="emit('update:open', false)">
        <div class="modal-box w-[360px] max-w-[360px]">
            <div class="flex items-center gap-1">
                <h3 class="flex-1 text-[15px] font-semibold">常用语</h3>
                <!-- 标题旁刷新：无文字图标 + aria-label（读屏/冒烟都靠它定位） -->
                <div class="tooltip tooltip-bottom" data-tip="重新加载常用语">
                    <button
                        class="btn btn-ghost btn-sm btn-square"
                        aria-label="重新加载常用语"
                        :disabled="props.phrasesLoading"
                        @click="emit('reload', true)">
                        <Icon name="refresh" :size="15" />
                    </button>
                </div>
            </div>

            <!-- 带图标的输入框：skill/components/input.md —— 输入框内有多个元素时，class 放在父元素 -->
            <label class="input input-sm my-3 w-full">
                <Icon name="search" :size="14" />
                <input
                    type="text"
                    placeholder="搜索常用语(按内容)"
                    :value="props.searchKeyword"
                    @input="emit('update:searchKeyword', ($event.target as HTMLInputElement).value)" />
            </label>

            <!-- 官方 radio 式 tabs（tabs-box using radio inputs）：受控由 Vue 驱动 -->
            <div role="tablist" class="tabs tabs-box w-full">
                <input
                    type="radio"
                    name="phrases_tab"
                    role="tab"
                    class="tab"
                    aria-label="全部话术"
                    :checked="tab === 'all'"
                    @change="tab = 'all'" />
                <input
                    type="radio"
                    name="phrases_tab"
                    role="tab"
                    class="tab"
                    aria-label="我的话术"
                    :checked="tab === 'mine'"
                    @change="tab = 'mine'" />
            </div>

            <div v-if="props.phrasesLoading" class="flex flex-col items-center gap-2 py-6">
                <span class="loading loading-spinner loading-md text-primary"></span>
                <span class="text-center text-xs leading-5 text-base-content/60">
                    正在抓取常用话术…（右侧栏会自动切 tab，请勿操作）
                </span>
            </div>

            <div v-else-if="!rows.length" class="hero">
                <div class="hero-content">
                    <p class="text-[13px] text-base-content/60">{{ emptyText }}</p>
                </div>
            </div>

            <ul v-else class="list">
                <!-- list-row 官方第一列是 minmax(0,auto)（max=max-content），长话术不换行撑破 360px 容器
                     → 覆写为 minmax(0,1fr)，让它随容器宽度换行（消灭横向滚动条） -->
                <li
                    v-for="(t, i) in rows"
                    :key="tab + i"
                    class="list-row py-0 [grid-template-columns:minmax(0,1fr)]">
                    <div class="tooltip tooltip-left w-full" :data-tip="t">
                        <button class="min-h-10 w-full text-left text-[13px] leading-5" @click="pick(t)">
                            {{ t }}
                        </button>
                    </div>
                </li>
            </ul>
        </div>
        <form method="dialog" class="modal-backdrop">
            <button>close</button>
        </form>
    </dialog>
</template>
