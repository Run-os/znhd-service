<script setup lang="ts">
import { Icon } from '@vue/icons';
import type { ImageAction } from './types';

/**
 * 图片右下角的悬浮按钮条（对齐 React 版 `ImageOverlayActions`）。
 *
 * 与 React 版的差别：那边用 state + 内联 opacity 是因为不想往宿主页注入全局 CSS；
 * 这里整套样式本来就在影子树里，用 `group-hover` 纯 CSS 即可 —— 少一份状态，
 * 也不会出现「鼠标移出后 state 没更新」这类边界问题。
 * 隐藏时同样保留 DOM（`opacity-0` 而非卸载），读屏/键盘仍可达。
 */
defineProps<{ actions: ImageAction[] }>();
</script>

<template>
    <div class="group relative w-full min-w-0">
        <slot />
        <div
            class="pointer-events-none absolute bottom-1.5 right-1.5 z-[2] flex gap-0.5 rounded-md bg-black/55 p-0.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
            <button
                v-for="a in actions"
                :key="a.label"
                type="button"
                :aria-label="a.label"
                :title="a.tooltip || a.label"
                :disabled="a.loading"
                class="inline-flex size-[22px] cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 outline-none hover:bg-white/15 disabled:cursor-default"
                :class="a.danger ? 'text-[#ff7875]' : 'text-white'"
                @click.stop="a.onClick()">
                <Icon :name="a.icon" :size="13" />
            </button>
        </div>
    </div>
</template>
