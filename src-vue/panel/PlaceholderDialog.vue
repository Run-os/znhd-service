<script setup lang="ts">
import { Button } from '@vue/components/ui/button';
import AppDialog from './AppDialog.vue';

/** 尚未迁移的模块占位弹窗：不做假功能，只说明现状（阶段 4 图片嗅探落地后即替换） */
defineProps<{ open: boolean; title: string; phase: string }>();
const emit = defineEmits<{ 'update:open': [boolean] }>();
</script>

<template>
    <AppDialog :open="open" :title="title" :width="420" @update:open="emit('update:open', $event)">
        <p class="m-0 text-sm leading-6 text-muted-foreground">
            该面板的 Vue 版正在迁移中（{{ phase }}）。当前构建用于验证
            <b class="text-foreground">Vite + Vue3 + shadcn-vue + Tailwind v4 + ShadowDOM</b>
            这条链路，业务逻辑仍以 React 版为准。
        </p>
        <template #footer>
            <Button size="sm" @click="emit('update:open', false)">知道了</Button>
        </template>
    </AppDialog>
</template>
