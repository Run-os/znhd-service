<script setup lang="ts">
import type { DialogContentEmits, DialogContentProps } from 'reka-ui'

import { inject, type HTMLAttributes } from 'vue'
import { XIcon } from '@lucide/vue'
import { reactiveOmit } from '@vueuse/core'
import { cn } from 'cn'
import {
  DialogClose,
  DialogContent,
  DialogPortal,
  useForwardPropsEmits,
} from 'reka-ui'
import { Button } from '@vue/components/ui/button'
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow'
import DialogOverlay from './DialogOverlay.vue'

/**
 * ⚠️ 相对官方源码的三处改动（ShadowDOM 必需）：
 *  ① `DialogPortal :to="shadowRoot"` —— 官方不带容器，浮层会挂到 `document.body`，
 *     脱离影子树后 Tailwind 样式全部失效（约束文档里的 P0 规则）。
 *  ② 层级 `z-50` → `z-[1000001]`（遮罩见 DialogOverlay）—— 面板里还有 Sheet 与传输助手
 *     的窗口级层级，`z-50` 会被它们盖住。
 *  ③ 组件内 inject 影子树，所以这条改动对调用方完全透明。
 */

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<DialogContentProps & { class?: HTMLAttributes['class'], showCloseButton?: boolean }>(), {
  showCloseButton: true,
})
const emits = defineEmits<DialogContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)

const shadowRoot = inject(SHADOW_ROOT_KEY)
</script>

<template>
  <DialogPortal :to="shadowRoot as unknown as HTMLElement">
    <DialogOverlay />
    <DialogContent
      data-slot="dialog-content"
      v-bind="{ ...$attrs, ...forwarded }"
      :class="cn('bg-popover text-popover-foreground data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 grid max-w-[calc(100%-2rem)] gap-6 rounded-xl p-6 text-sm ring-1 duration-100 sm:max-w-md fixed top-1/2 left-1/2 z-[1000001] w-full -translate-x-1/2 -translate-y-1/2 outline-none', props.class)"
    >
      <slot />

      <DialogClose
        v-if="showCloseButton"
        data-slot="dialog-close"
        as-child
      >
        <Button variant="ghost" class="absolute top-4 right-4" size="icon-sm">
          <XIcon />
          <span class="sr-only">Close</span>
        </Button>
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
