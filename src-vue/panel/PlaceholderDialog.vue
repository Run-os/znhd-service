<script setup lang="ts">
import Dialog from '../components/ui/dialog/Dialog.vue';

/** 尚未迁移的模块占位弹窗：先证明 DialogPortal 挂 shadowRoot 可用，不做假功能 */
defineProps<{ open: boolean; title: string; phase: string }>();
const emit = defineEmits<{ 'update:open': [boolean] }>();
</script>

<template>
    <Dialog
        :open="open"
        :title="title"
        :width="380"
        :footer="true"
        @update:open="emit('update:open', $event)">
        <p class="m-0 text-sm leading-6 text-[#595959]">
            该面板的 Vue 版正在迁移中（{{ phase }}）。当前构建用于验证
            <b>Vite + Vue3 + shadcn-vue + Tailwind v4 + ShadowDOM</b> 这条链路，业务逻辑仍以 React 版为准。
        </p>
        <template #footer>
            <button
                type="button"
                class="h-8 cursor-pointer rounded-[8px] border border-[#1677ff] bg-[#1677ff] px-4 text-sm text-white outline-none hover:bg-[#4096ff]"
                @click="emit('update:open', false)">
                知道了
            </button>
        </template>
    </Dialog>
</template>
