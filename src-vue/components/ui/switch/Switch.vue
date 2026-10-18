<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui';

/**
 * 开关（底层 Reka UI Switch，无 portal，天然待在影子树里）。
 * 视觉对齐 antd Switch：轨道 36×20、滑块 16、选中蓝 #1677ff。
 */
const checked = defineModel<boolean>({ default: false });
</script>

<template>
    <SwitchRoot
        v-model="checked"
        class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full bg-black/25 p-0 outline-none transition-colors data-[state=checked]:bg-[#1677ff] focus-visible:ring-2 focus-visible:ring-[#1677ff]/30">
        <SwitchThumb
            class="block size-4 translate-x-0.5 rounded-full bg-white shadow-[0_2px_4px_rgba(0,35,11,0.2)] transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchRoot>
</template>
