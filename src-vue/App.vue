<script setup lang="ts">
import DialogHost from './panel/DialogHost.vue';

/**
 * 根组件：弹窗宿主（v26.10.21-v5 起主面板已删，可见 UI 在站点导航条）。
 *
 * 迁移到 daisyUI 后不再需要 `<Toaster>` 挂载点：提示由 lib/toast.ts 直接在
 * 影子树的 #app 下拼 `toast` + `alert`（daisyUI 原生结构），不再引入 vue-sonner。
 */
</script>

<template>
    <DialogHost />
</template>
