<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { Icon } from '@vue/icons';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';
import { printA4Image } from '@vue/lib/print';

/**
 * 图片放大预览（v26.10.18-v5 随传输助手落地，v26.10.18-v6 上移到共用层给「图片嗅探」复用）。
 * 替代 React 版的 antd `Image.PreviewGroup`。
 *
 * ── 为什么不直接引 antd ────────────────────────────────────────────────────
 * 迁移目标就是把 antd 从产物里去掉；预览层的交互其实很小：遮罩 / 缩放 / 旋转 /
 * 左右切换 / 打印 / Esc 关闭。自己实现约 150 行，换来的是「样式完全在影子树内」，
 * 不必再为 antd 的 `getContainer`、遮罩叠加、`.ant-image-preview-*` 类名做适配。
 *
 * ⚠️ 必须 Teleport 到 shadowRoot，**不能留在传输助手窗口里**：窗口内容有
 * `translate(-50%,-50%)` 的 transform，会成为 `position:fixed` 的包含块，
 * 预览会缩在窗口内而不是铺满视口（这正是 React 版必须传 `getPreviewHost()` 的同源问题）。
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
        /** 层级（默认 1000020：压在传输助手窗口与面板之上，低于暗色子弹窗） */
        zIndex?: number;
    }>(),
    { index: 0, names: () => [], zIndex: 1000020 }
);

const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>();

const overlayTarget = inject(SHADOW_ROOT_KEY) as unknown as string;

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
        emit('update:open', false);
        return;
    }
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
}

watch(
    () => props.open,
    (open) => {
        if (open) {
            current.value = Math.min(Math.max(0, props.index || 0), Math.max(0, total.value - 1));
            reset();
            window.addEventListener('keydown', onKey, true);
        } else {
            window.removeEventListener('keydown', onKey, true);
        }
    }
);

onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
    <Teleport :to="overlayTarget">
        <div
            v-if="open"
            data-image-preview="1"
            class="fixed inset-0 flex flex-col bg-black/80"
            :style="{ zIndex: props.zIndex }"
            @click.self="emit('update:open', false)">
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

            <!-- 图片区：左右箭头 + 图片本体 -->
            <div class="relative flex min-h-0 flex-1 items-center justify-center px-12">
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

            <!-- 底部工具栏：与 antd 预览的能力对齐（缩放 / 旋转 / 打印） -->
            <div class="flex shrink-0 items-center justify-center gap-1 py-3">
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
    </Teleport>
</template>
