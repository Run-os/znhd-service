<script setup lang="ts">
import { inject } from 'vue';
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { Icon } from '@vue/icons';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';
import { Card, CardContent, CardFooter, CardHeader } from '@vue/components/ui/card';
import { TRANSFER_VARS, Z } from './theme';

/**
 * 传输助手的暗色弹窗壳（配对 / 设置 / 企业信息共用）：**Dialog + Card**。
 *
 * 用的是官方 Dialog 的底层 primitive（reka-ui），但没走 vendored 的 `DialogContent.vue`
 * 包装 —— 因为那一层的遮罩层级写死成 1000000（主面板量级），而传输助手的窗口本身在
 * 1000011，需要遮罩/弹窗分别是 1000030 / 1000031 才能盖住。这里的 z 由 `Z` 统一给。
 *
 * ⚠️ P0：`DialogPortal :to="shadowRoot"` —— 不指定就挂到 document.body，脱离影子树后
 * Tailwind 样式全部失效。这也意味着弹窗**不在窗口子树里**，拿不到窗口上的 CSS 变量覆盖，
 * 所以这里要再绑一次 `TRANSFER_VARS`，否则 Card / Button 会按主面板的主题渲染。
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
                class="fixed left-1/2 top-1/2 max-h-[calc(100vh-140px)] -translate-x-1/2 -translate-y-1/2 border-0 bg-transparent p-0 shadow-none outline-none"
                :style="[TRANSFER_VARS, { zIndex: Z.dialog, width: props.width + 'px' }]">
                <DialogDescription class="sr-only">{{ props.description || props.title }}</DialogDescription>

                <Card
                    class="max-h-[calc(100vh-140px)] gap-0 overflow-hidden rounded-xl bg-popover py-0 text-popover-foreground shadow-[0_12px_40px_rgba(0,0,0,0.55)] ring-1 ring-border">
                    <CardHeader class="flex shrink-0 flex-row items-center gap-2 border-b border-border px-5 py-3">
                        <DialogTitle class="m-0 min-w-0 flex-1 truncate text-[15px] font-semibold leading-6 text-foreground">
                            {{ title }}
                        </DialogTitle>
                        <DialogClose
                            class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground outline-none hover:bg-muted hover:text-foreground"
                            aria-label="关闭">
                            <Icon name="close" :size="15" />
                        </DialogClose>
                    </CardHeader>

                    <CardContent class="min-h-0 flex-1 overflow-auto px-5 py-4 text-sm">
                        <slot />
                    </CardContent>

                    <CardFooter
                        v-if="$slots.footer"
                        class="flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3">
                        <slot name="footer" />
                    </CardFooter>
                </Card>
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
