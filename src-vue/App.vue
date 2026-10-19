<script setup lang="ts">
import MainPanel from './panel/MainPanel.vue';

/**
 * 根组件：主面板。
 *
 * 迁移到 daisyUI 后不再需要 `<Toaster>` 挂载点：提示由 lib/toast.ts 直接在
 * 影子树的 #app 下拼 `toast` + `alert`（daisyUI 原生结构），不再引入 vue-sonner。
 */
defineProps<{ host: HTMLElement }>();
</script>

<template>
    <MainPanel :host="host" />
</template>
