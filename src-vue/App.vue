<script setup lang="ts">
import MainPanel from './panel/MainPanel.vue';
import { Toaster } from './components/ui/sonner';
import { themeMode } from './lib/theme';

/**
 * 根组件：主面板 + 全局提示容器。
 *
 * `<Sonner>` 是官方 sonner 组件（原地渲染 `<section data-sonner-toaster>`，不 portal），
 * 它的样式表已在 main.ts 注入影子树 —— 所以面板任意位置 `toast.success(...)` 都有样式。
 * `:theme` 跟着宿主 class 走，日间是浅色提示条、夜间是深色提示条。
 */
defineProps<{ host: HTMLElement }>();
</script>

<template>
    <MainPanel :host="host" />
    <Toaster position="top-center" :theme="themeMode" :duration="3200" :visible-toasts="3" />
</template>
