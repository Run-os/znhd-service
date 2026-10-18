<script setup lang="ts">
import MainPanel from './panel/MainPanel.vue';

/** 根组件：目前只有主面板；后续阶段在这里挂 ToastProvider 等全局容器 */
defineProps<{ host: HTMLElement }>();
</script>

<template>
    <MainPanel :host="host" />
</template>
