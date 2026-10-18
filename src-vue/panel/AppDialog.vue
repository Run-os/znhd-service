<script setup lang="ts">
import { Icon } from '@vue/icons';
import { Button } from '@vue/components/ui/button';
import { Card, CardContent, CardFooter } from '@vue/components/ui/card';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@vue/components/ui/dialog';

/**
 * 面板侧弹窗外壳：**官方 Dialog + 官方 Card**（不再手写弹窗骨架）。
 *
 * 结构：
 *   Dialog（reka 根）
 *     └ DialogContent（只负责定位/进出场，视觉表面交给 Card）
 *         └ Card → 标题栏 + CardContent + CardFooter
 *
 * 为什么表面交给 Card：DialogContent 官方默认自带 `bg-popover p-6 gap-6`，
 * 想要「顶栏通栏、内容区自己滚」就得一路改它的 padding；换成 Card 之后，
 * 圆角/描边/底色由 Card 统一提供，内容区滚动也不会把标题栏带跑。
 *
 * ⚠️ DialogContent 已在 vendored 源码里被改成 portal 到 shadowRoot（见其文件头注释）；
 *    宽度用内联 style 传，`sm:max-w-none` 用来压掉官方的 `sm:max-w-md`。
 */
const open = defineModel<boolean>('open', { default: false });

const props = withDefaults(defineProps<{ title: string; description?: string; width?: number; footer?: boolean }>(), {
    description: '',
    width: 520,
    footer: true,
});
</script>

<template>
    <Dialog v-model:open="open">
        <DialogContent
            :show-close-button="false"
            class="gap-0 border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
            :style="{ width: props.width + 'px', maxWidth: 'calc(100vw - 32px)' }">
            <DialogDescription class="sr-only">{{ props.description || props.title }}</DialogDescription>

            <Card class="max-h-[calc(100vh-96px)] gap-0 overflow-hidden py-0 shadow-2xl">
                <div class="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
                    <DialogTitle class="m-0 flex min-w-0 items-center gap-2 text-[15px] font-semibold leading-6 text-foreground">
                        <!-- #title 供需要「标题 + 动作按钮」的弹窗用（如图片嗅探的「重新扫描」） -->
                        <slot name="title">{{ props.title }}</slot>
                    </DialogTitle>
                    <DialogClose
                        class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        aria-label="关闭">
                        <Icon name="close" :size="15" />
                    </DialogClose>
                </div>

                <CardContent class="min-h-0 max-h-[calc(100vh-220px)] overflow-auto px-5 py-4 text-sm text-card-foreground">
                    <slot />
                </CardContent>

                <!-- footer=false 表示不要默认按钮；调用方给了 #footer 插槽时仍要渲染 -->
                <CardFooter
                    v-if="props.footer || $slots.footer"
                    class="shrink-0 justify-end gap-2 border-t border-border px-5 py-3 pt-3">
                    <slot name="footer">
                        <Button size="sm" @click="open = false">确定</Button>
                    </slot>
                </CardFooter>
            </Card>
        </DialogContent>
    </Dialog>
</template>
