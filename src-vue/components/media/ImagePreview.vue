<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { Icon } from '@vue/icons';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';
import { printA4Image } from '@vue/lib/print';
import { useNativeDialog } from '@vue/composables/useNativeDialog';

/**
 * 图片放大预览（v26.10.18-v5 随传输助手落地，v26.10.18-v6 上移到共用层给「图片嗅探」复用）。
 * 替代 React 版的 antd `Image.PreviewGroup`。
 *
 * ── 为什么不直接引 antd ────────────────────────────────────────────────────
 * 迁移目标就是把 antd 从产物里去掉；预览层的交互其实很小：遮罩 / 缩放 / 旋转 /
 * 左右切换 / 打印 / Esc 关闭。自己实现约 150 行，换来的是「样式完全在影子树内」，
 * 不必再为 antd 的 `getContainer`、遮罩叠加、`.ant-image-preview-*` 类名做适配。
 *
 * ── v26.10.19：外壳改用 daisyUI `modal`（原生 <dialog>）─────────────────
 * daisyUI 迁移后宿主弹窗全部走 `showModal()`（浏览器 top layer），
 * top layer 永远画在普通元素之上 ⇒ 原先的 `position:fixed` 遮罩会被底层弹窗盖住。
 * 预览层自身也改成 `<dialog class="modal">`，后 show 的 dialog 在 top layer 里
 * 排在前面的弹窗之上，层级问题随之消失（不再需要 zIndex prop）。
 *
 * ⚠️ 必须 Teleport 到 shadowRoot，**不能留在传输助手窗口里**：窗口内容有
 * `translate(-50%,-50%)` 的 transform，会成为 `position:fixed` 的包含块。
 * `.modal` 内容不用 `modal-box`（预览要满屏出血，modal-box 的底色/圆角/内边距
 * 全要反向覆盖，不如直接放内容），点击空白关闭沿用各区块的 `@click.self`。
 */
const props = withDefaults(
    defineProps<{
        open: boolean;
        /** 图片地址列表（objectURL 或普通 URL） */
        items: string[];
        /** 打开时的起始下标 */
        index?: number;
        /** 打印对话框标题（与 items 同序） */
        names?: string[];
    }>(),
    { index: 0, names: () => [] }
);

const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>();

const overlayTarget = inject(SHADOW_ROOT_KEY) as unknown as string;

const dlg = ref<HTMLDialogElement | null>(null);

// 开/关同步（showModal / close / 挂载即开）收敛在 useNativeDialog（v26.10.25-v8）；
// Esc / 左右键 / 背板拦截的差异逻辑留在本壳（下方 watch + onKey）。
useNativeDialog(computed(() => props.open), dlg);

const current = ref(0);
const scale = ref(1);
const rotate = ref(0);

const total = computed(() => props.items.length);
const src = computed(() => props.items[current.value] || '');
const title = computed(() => props.names?.[current.value] || '图片');

function reset() {
    scale.value = 1;
    rotate.value = 0;
}

function go(step: number) {
    if (total.value < 2) return;
    current.value = (current.value + step + total.value) % total.value;
    reset();
}

function onKey(e: KeyboardEvent) {
    if (!props.open) return;
    if (e.key === 'Escape') {
        // ⚠️ 必须 preventDefault + stopPropagation（v26.10.19-v3）：本监听挂在 window **捕获段**，
        // 先于 reka Dialog 的 Esc 监听（window 冒泡段）执行；不拦的话底层弹窗（嗅探窗等）
        // 会跟着预览一起被 Esc 关掉。reka DismissableLayer 明确「defaultPrevented 则不 dismiss」，
        // preventDefault 即够，stopPropagation 双保险（独立页面无 Dialog 时也无副作用）。
        e.preventDefault();
        e.stopPropagation();
        emit('update:open', false);
        return;
    }
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
}

/**
 * ⚠️ 点击拦截（v26.10.19-v10）：Esc 之外还有第二条「连坐关闭」路径——
 * 预览层是自绘 overlay（非 reka layer），点它的空白区关预览的同时，这次 pointerdown
 * 会被 reka DismissableLayer 判成「点在 layer 外面」⇒ 底层弹窗（嗅探窗等）一起被
 * dismiss。同 Esc 思路：预览开着期间在 window 捕获段先拦 pointerdown，目标落在
 * 预览层内就 stopPropagation，reka 的 document 级监听根本看不到这次按下；
 * 预览自己的 `@click.self` 关闭走的是 click 事件（另一条事件流），不受影响。
 *
 * ⚠️ 目标判定必须用 `composedPath()`：window 级监听器在影子树**外**，event.target
 * 已被重定向成影子宿主元素（实测 = DIV.dark），`closest('[data-znhd="image-preview"]')`
 * 永远匹配不上；composedPath()[0] 才是影子树内的真实落点（open 影子树不裁剪路径）。
 */
function onPointerDown(e: PointerEvent) {
    if (!props.open) return;
    const path = e.composedPath();
    const inPreview = path.some((n) => n instanceof Element && n.closest && n.closest('[data-znhd="image-preview"]'));
    if (inPreview) e.stopPropagation();
}

watch(
    () => props.open,
    (open) => {
        if (open) {
            current.value = Math.min(Math.max(0, props.index || 0), Math.max(0, total.value - 1));
            reset();
            window.addEventListener('keydown', onKey, true);
            window.addEventListener('pointerdown', onPointerDown, true);
        } else {
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('pointerdown', onPointerDown, true);
        }
    }
);

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
});
</script>

<template>
    <Teleport :to="overlayTarget">
        <dialog ref="dlg" data-znhd="image-preview" class="modal" @close="emit('update:open', false)">
            <div class="flex h-screen w-screen flex-col bg-black/80">
            <!-- 顶部：序号 + 关闭（不挡图片点击） -->
            <div class="flex shrink-0 items-center px-4 py-3 text-[13px] text-white/80">
                <span class="min-w-0 flex-1 truncate">{{ title }}</span>
                <span v-if="total > 1" class="shrink-0 px-2 text-white/55">{{ current + 1 }} / {{ total }}</span>
                <button
                    type="button"
                    aria-label="关闭预览"
                    title="关闭（Esc）"
                    class="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/70 outline-none hover:bg-white/10 hover:text-white"
                    @click="emit('update:open', false)">
                    <Icon name="close" :size="17" />
                </button>
            </div>

            <!-- 图片区：左右箭头 + 图片本体
                 v26.10.19-v10：click.self 同时挂在图片区容器上——旧版只有根 overlay 有 self 关闭，
                 而图片区是满宽子容器，点图片周围空白命中的是它 ⇒ 「点空白关预览」实际从未生效
                 （用户看到的预览关闭其实是底层弹窗被连坐关掉时的级联）。 -->
            <div class="relative flex min-h-0 flex-1 items-center justify-center px-12" @click.self="emit('update:open', false)">
                <button
                    v-if="total > 1"
                    type="button"
                    aria-label="上一张"
                    class="absolute left-3 inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white/80 outline-none hover:bg-white/20 hover:text-white"
                    @click="go(-1)">
                    <Icon name="chevronLeft" :size="20" />
                </button>
                <img
                    :src="src"
                    :alt="title"
                    draggable="false"
                    class="max-h-full max-w-full select-none object-contain"
                    :style="{
                        transform: `scale(${scale}) rotate(${rotate}deg)`,
                        transition: 'transform 120ms ease-out',
                        cursor: scale > 1 ? 'zoom-out' : 'zoom-in',
                    }"
                    @click="scale = scale > 1 ? 1 : 1.8" />
                <button
                    v-if="total > 1"
                    type="button"
                    aria-label="下一张"
                    class="absolute right-3 inline-flex size-9 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white/80 outline-none hover:bg-white/20 hover:text-white"
                    @click="go(1)">
                    <Icon name="chevronRight" :size="20" />
                </button>
            </div>

            <!-- 底部工具栏：与 antd 预览的能力对齐（缩放 / 旋转 / 打印）；按钮之间的空隙点了也关预览 -->
            <div class="flex shrink-0 items-center justify-center gap-1 py-3" @click.self="emit('update:open', false)">
                <button
                    type="button"
                    aria-label="缩小"
                    title="缩小"
                    class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/70 outline-none hover:bg-white/10 hover:text-white"
                    @click="scale = Math.max(0.4, +(scale - 0.2).toFixed(2))">
                    <Icon name="zoomOut" :size="16" />
                </button>
                <button
                    type="button"
                    aria-label="放大"
                    title="放大"
                    class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/70 outline-none hover:bg-white/10 hover:text-white"
                    @click="scale = Math.min(4, +(scale + 0.2).toFixed(2))">
                    <Icon name="zoomIn" :size="16" />
                </button>
                <button
                    type="button"
                    aria-label="旋转"
                    title="旋转 90°"
                    class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/70 outline-none hover:bg-white/10 hover:text-white"
                    @click="rotate = (rotate + 90) % 360">
                    <Icon name="rotateCw" :size="16" />
                </button>
                <button
                    type="button"
                    aria-label="打印"
                    title="打印原图（A4 自适应）"
                    class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/70 outline-none hover:bg-white/10 hover:text-white"
                    @click="printA4Image(src, title)">
                    <Icon name="printer" :size="16" />
                </button>
            </div>
            </div>
        </dialog>
    </Teleport>
</template>
