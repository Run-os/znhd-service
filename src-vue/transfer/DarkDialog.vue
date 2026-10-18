<script setup lang="ts">
import { inject } from 'vue';
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { Icon } from '@vue/icons';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';
import { TRANSFER_VARS, Z } from './theme';

/**
 * 传输助手的暗色弹窗壳（配对 / 设置 / 企业信息共用）。
 *
 * ⚠️ P0：`DialogPortal :to="shadowRoot"` —— 不指定就挂到 document.body，脱离影子树后
 * Tailwind 样式全部失效。这也意味着弹窗**不在窗口子树里**，拿不到窗口上的 CSS 变量覆盖，
 * 所以这里要再绑一次 `TRANSFER_VARS`，否则官方组件的 `bg-popover` / `text-foreground`
 * 会按主面板的浅色语义渲染（白底黑字）。
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(defineProps<{ title: string; description?: string; width?: number }>(), {
    description: '',
    width: 520,
});

const shadowRoot = inject(SHADOW_ROOT_KEY);
</script>

<template>
    <DialogRoot v-model:open="open">
        <DialogPortal :to="shadowRoot as unknown as HTMLElement">
            <DialogOverlay class="fixed inset-0 bg-black/55" :style="{ zIndex: Z.dialogMask }" />
            <DialogContent
                class="fixed left-1/2 top-1/2 flex max-h-[calc(100vh-140px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[12px] bg-[#2B2B2B] text-left text-white/90 shadow-[0_12px_40px_rgba(0,0,0,0.55)] outline-none"
                :style="[TRANSFER_VARS, { zIndex: Z.dialog, width: props.width + 'px' }]">
                <div class="flex shrink-0 items-center gap-2 border-b border-white/10 px-5 py-3">
                    <DialogTitle class="m-0 min-w-0 flex-1 truncate text-[15px] font-semibold text-white/90">
                        {{ title }}
                    </DialogTitle>
                    <DialogClose
                        class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-white/50 outline-none hover:bg-white/10 hover:text-white"
                        aria-label="关闭">
                        <Icon name="close" :size="15" />
                    </DialogClose>
                </div>
                <DialogDescription class="sr-only">{{ props.description || props.title }}</DialogDescription>
                <div class="min-h-0 flex-1 overflow-auto px-5 py-4">
                    <slot />
                </div>
                <div v-if="$slots.footer" class="flex shrink-0 items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
                    <slot name="footer" />
                </div>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
