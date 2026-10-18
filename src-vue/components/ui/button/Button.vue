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
                // 以下三项为「与官方 registry 组件对齐」而补：sheet/dialog 等官方源码会传 outline/secondary/destructive
                outline: 'border border-[#d9d9d9] bg-transparent text-[#262626] hover:bg-black/5',
                secondary: 'border border-transparent bg-[#f5f5f5] text-[#262626] hover:bg-[#e8e8e8]',
                destructive: 'border border-[#ff4d4f] bg-[#ff4d4f] text-white hover:bg-[#ff7875]',
            },
            size: {
                sm: 'h-6 rounded-[6px] px-1.5 text-xs',
                md: 'h-8 rounded-[8px] px-3 text-sm',
                lg: 'h-10 rounded-[8px] px-4 text-sm',
                // 官方组件用的方形图标按钮
                icon: 'size-8 rounded-[8px] p-0',
                'icon-sm': 'size-6 rounded-[6px] p-0',
                'icon-lg': 'size-10 rounded-[8px] p-0',
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
