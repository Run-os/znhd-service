<script setup lang="ts">
import { inject, ref } from 'vue';
import { TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';

/**
 * 轻量 Tooltip（Reka UI）。
 *
 * ⚠️ Portal 必须显式 `:to="shadowRoot"`：默认挂 document.body 会脱离影子树，
 * Tailwind 样式一条都不生效（约束文档 P0 规则）。
 *
 * ⚠️ 受控开合（v26.10.19-v10）：reka 非受控模式有个「hover 卡死」窗口期——悬停后
 * 200ms 延迟内点下按钮，弹窗盖上来后触发器的 pointerleave 不再补发，tooltip 保持
 * 打开；弹窗关掉后它还悬在原地（用户实录：不碰鼠标就一直显示）。改为受控 + 三条
 * 关闭路径（pointerleave / pointerdown / blur）兜死，pointerdown 同时取消未到时的
 * 打开定时器；打开仍走 200ms 延迟，与原观感一致。
 */
const props = withDefaults(defineProps<{ content: string; side?: 'top' | 'right' | 'bottom' | 'left' }>(), {
    side: 'bottom',
});

const shadowRoot = inject(SHADOW_ROOT_KEY);

const open = ref(false);
let timer: number | null = null;

function enter() {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
        timer = null;
        open.value = true;
    }, 200);
}

function leave() {
    if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
    }
    open.value = false;
}
</script>

<template>
    <TooltipProvider :delay-duration="200">
        <TooltipRoot v-model:open="open">
            <TooltipTrigger
                as-child
                @pointerenter="enter"
                @pointerleave="leave"
                @pointerdown="leave"
                @focus="enter"
                @blur="leave">
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
