<script setup lang="ts">
import { inject } from 'vue';
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';

/**
 * 轻量 Tooltip（Reka UI）。
 *
 * ⚠️ Portal 必须显式 `:to="shadowRoot"`：默认挂 document.body 会脱离影子树，
 * Tailwind 样式一条都不生效（约束文档 P0 规则）。
 */
const props = withDefaults(defineProps<{ content: string; side?: 'top' | 'right' | 'bottom' | 'left' }>(), {
    side: 'bottom',
});

const shadowRoot = inject(SHADOW_ROOT_KEY);
</script>

<template>
    <TooltipProvider :delay-duration="200">
        <TooltipRoot>
            <TooltipTrigger as-child>
                <slot />
            </TooltipTrigger>
            <TooltipPortal :to="shadowRoot as unknown as HTMLElement">
                <TooltipContent
                    :side="props.side"
                    :side-offset="6"
                    class="z-[1000002] rounded-[6px] bg-[rgba(0,0,0,0.85)] px-2 py-1 text-xs leading-5 text-white shadow-lg">
                    {{ content }}
                </TooltipContent>
            </TooltipPortal>
        </TooltipRoot>
    </TooltipProvider>
</template>
