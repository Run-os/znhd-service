<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
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
 *   + `list/list-row`（每条话术，两行截断）+ `hero`（空态）+ `loading`（加载中）+ `btn`。
 *
 * ⚠️ 话术的长文本提示**没有用 daisyUI 的 `tooltip` + `data-tip`**：那套是靠伪元素绝对定位，
 *    挂在按钮里必然处于 `modal-box` 内部，而 `.modal-box` 带 `overflow-y: auto`（未声明 overflow-x
 *    ⇒ 计算值也是 auto），伪元素超出盒子右/左/上下的部分会被直接裁掉 —— 实测长话术只剩左侧
 *    一条残影。改成见下方 `tip*` 那套自定义浮层（dialog 直接子节点 + position: fixed）。
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
const boxEl = ref<HTMLElement | null>(null);

/**
 * 长话术悬浮提示（自定义浮层）。
 *
 * ── 为什么不能用 daisyUI 的 `tooltip` + `data-tip` ────────────────────────────
 * 那套的提示框是按钮的伪元素，一定落在 `.modal-box` 内部；`modal-box` 为了滚动列表写了
 * `overflow-y: auto`，未声明的 overflow-x 会跟着变成 `auto`（CSS 计算规则：一个方向非
 * visible 时另一方向也按 auto 处理）⇒ 提示框超出盒子的部分被裁掉，实测只剩贴在列表左边
 * 的一小条，根本读不到内容。
 *
 * ── 挂载位置的三条约束（缺一不可）─────────────────────────────────────────────
 *  ① 必须在 `modal-box` **外面** ⇒ 逃出它的 overflow 裁剪；
 *  ② 必须是 `<dialog>` 的**直接子节点** ⇒ `<dialog>.showModal()` 会把弹层提到 top layer，
 *     而 top layer 高于一切普通内容（z-index 再大也压不过）—— 消息要是挂到 `#app`/body，
 *     会被 `::backdrop` 压暗甚至整块盖住；
 *  ③ 用 `position: fixed` ⇒ `.modal` 自身没有 transform（`translate` 在 `.modal-box` 上），
 *     fixed 的包含块仍是视口，坐标取 `getBoundingClientRect()` 即可，且不受 `.modal`
 *     的 `overflow: clip` 影响（裁剪只作用于包含块在本元素内的后代）。
 *
 * 落位：优先放在弹层左侧（`modal-end` 贴右边，左边空间最大）；左边放不下退回右侧，
 * 两边都放不下就贴视口左边界；纵向与命中行顶对齐并夹在视口内。
 */
const TIP_W = 300;
const TIP_GAP = 10;

const tipText = ref('');
const tipShow = ref(false);
const tipPos = ref<{ x: number; y: number } | null>(null);
const tipEl = ref<HTMLElement | null>(null);

function hideTip(): void {
    tipShow.value = false;
    tipPos.value = null;
    tipText.value = '';
}

async function showTip(e: Event): Promise<void> {
    const hit = e.currentTarget as HTMLElement | null;
    if (!hit) return;
    const text = (hit.textContent || '').trim();
    if (!text) return;

    tipText.value = text;
    // 先以 invisible 渲染（保留布局才能量尺寸），量完再落位 —— 避免先闪在 (0,0)
    tipPos.value = null;
    tipShow.value = true;
    await nextTick();
    if (!tipShow.value) return;

    const el = tipEl.value;
    const row = hit.getBoundingClientRect();
    const box = boxEl.value?.getBoundingClientRect();
    const w = el?.offsetWidth || TIP_W;
    const h = el?.offsetHeight || 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const leftSide = (box ? box.left : row.left) - TIP_GAP - w;
    const rightSide = (box ? box.right : row.right) + TIP_GAP;
    const x = leftSide >= 8 ? leftSide : rightSide + w <= vw - 8 ? rightSide : 8;
    const y = Math.max(8, Math.min(row.top, vh - 8 - h));

    tipPos.value = { x: Math.round(x), y: Math.round(y) };
}

function sync(v: boolean): void {
    const el = dlg.value;
    if (!el) return;
    if (v && !el.open) el.showModal();
    else if (!v && el.open) el.close();
    if (!v) hideTip();
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
        <div ref="boxEl" class="modal-box w-[360px] max-w-[360px]">
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

            <ul v-else class="list" @scroll="hideTip">
                <!-- list-row 官方第一列是 minmax(0,auto)（max=max-content），长话术不换行撑破 360px 容器
                     → 覆写为 minmax(0,1fr)，让它随容器宽度换行（消灭横向滚动条） -->
                <li
                    v-for="(t, i) in rows"
                    :key="tab + i"
                    class="list-row py-0 [grid-template-columns:minmax(0,1fr)]">
                    <!-- 每条只显示前两行（leading-5 × 2 = h-10 固定高度），完整内容靠悬浮提示看 -->
                    <button
                        class="h-10 w-full text-left"
                        @mouseenter="showTip"
                        @mouseleave="hideTip"
                        @focus="showTip"
                        @blur="hideTip"
                        @click="pick(t)">
                        <span class="line-clamp-2 text-[13px] leading-5">{{ t }}</span>
                    </button>
                </li>
            </ul>
        </div>

        <!-- 长话术悬浮提示：见上方 tip* 注释（必须是 dialog 直接子节点，不能进 modal-box） -->
        <div
            v-if="tipShow"
            ref="tipEl"
            data-znhd="phrase-tip"
            class="pointer-events-none fixed z-10 max-h-[50vh] max-w-[300px] overflow-hidden rounded-box bg-neutral p-2 text-xs leading-5 break-words whitespace-pre-wrap text-neutral-content shadow-lg"
            :class="tipPos ? 'visible' : 'invisible'"
            :style="tipPos ? { left: tipPos.x + 'px', top: tipPos.y + 'px' } : undefined">
            {{ tipText }}
        </div>
        <form method="dialog" class="modal-backdrop">
            <button>close</button>
        </form>
    </dialog>
</template>
