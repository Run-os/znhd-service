<script setup lang="ts">
import { inject } from 'vue';
import {
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogOverlay,
    DialogPortal,
    DialogRoot,
    DialogTitle,
} from 'reka-ui';
import { Icon } from '@vue/icons';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';

/**
 * 弹窗（Reka UI Dialog 封装）。
 *
 * ⚠️ P0：`DialogPortal :to="shadowRoot"` —— 不指定就会挂到 document.body，
 * 浮层脱离影子树后 Tailwind 样式全部失效（约束文档表格里的规则）。
 */
const open = defineModel<boolean>('open', { default: false });

const props = withDefaults(
    defineProps<{ title: string; description?: string; width?: number; footer?: boolean }>(),
    { width: 520, footer: true, description: '' }
);

const shadowRoot = inject(SHADOW_ROOT_KEY);
</script>

<template>
    <DialogRoot v-model:open="open">
        <DialogPortal :to="shadowRoot as unknown as HTMLElement">
            <DialogOverlay class="fixed inset-0 z-[1000000] bg-black/45" />
            <DialogContent
                :style="{ width: props.width + 'px' }"
                class="fixed left-1/2 top-1/2 z-[1000001] max-h-[calc(100vh-96px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[8px] bg-white text-left shadow-[0_6px_16px_-8px_rgba(0,0,0,0.08),0_9px_28px_8px_rgba(0,0,0,0.05)] outline-none">
                <div class="flex items-center justify-between gap-4 border-b border-[#f0f0f0] px-6 py-4">
                    <DialogTitle class="m-0 text-base font-semibold text-[#262626]">{{ title }}</DialogTitle>
                    <DialogClose
                        class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-[#8c8c8c] outline-none hover:bg-black/5 hover:text-[#262626] focus-visible:ring-2 focus-visible:ring-[#1677ff]/30"
                        aria-label="关闭">
                        <Icon name="close" :size="15" />
                    </DialogClose>
                </div>
                <DialogDescription class="sr-only">{{ props.description || props.title }}</DialogDescription>
                <div class="max-h-[calc(100vh-220px)] overflow-auto px-6 py-4">
                    <slot />
                </div>
                <!-- footer=false 表示「不要默认 footer」；但调用方给了 #footer 插槽时仍要渲染 -->
                <div
                    v-if="props.footer || $slots.footer"
                    class="flex justify-end gap-2 border-t border-[#f0f0f0] px-6 py-3">
                    <slot name="footer">
                        <button
                            type="button"
                            class="h-8 cursor-pointer rounded-[8px] border border-[#1677ff] bg-[#1677ff] px-4 text-sm text-white outline-none hover:bg-[#4096ff]"
                            @click="open = false">
                            确定
                        </button>
                    </slot>
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
