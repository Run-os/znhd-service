<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@vue/lib/cn';

/** shadcn-vue 风格按钮（cva 变体 + tailwind-merge），默认态对齐 antd 的 default button */
const buttonVariants = cva(
    'inline-flex shrink-0 select-none items-center justify-center gap-1 whitespace-nowrap font-normal outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#1677ff]/30',
    {
        variants: {
            variant: {
                default:
                    'border border-[#d9d9d9] bg-white text-[#262626] hover:border-[#4096ff] hover:text-[#4096ff]',
                primary: 'border border-[#1677ff] bg-[#1677ff] text-white hover:border-[#4096ff] hover:bg-[#4096ff]',
                text: 'border border-transparent bg-transparent hover:bg-black/5',
                link: 'border border-transparent bg-transparent text-[#1677ff] hover:text-[#4096ff]',
                ghost: 'border border-transparent bg-transparent hover:bg-black/5',
            },
            size: {
                sm: 'h-6 rounded-[6px] px-1.5 text-xs',
                md: 'h-8 rounded-[8px] px-3 text-sm',
                lg: 'h-10 rounded-[8px] px-4 text-sm',
            },
        },
        defaultVariants: { variant: 'default', size: 'md' },
    }
);

type Variants = VariantProps<typeof buttonVariants>;

withDefaults(defineProps<{ variant?: Variants['variant']; size?: Variants['size'] }>(), {
    variant: 'default',
    size: 'md',
});

defineOptions({ inheritAttrs: false });
</script>

<template>
    <button
        type="button"
        v-bind="$attrs"
        :class="cn(buttonVariants({ variant, size }), $attrs.class as string)">
        <slot />
    </button>
</template>
