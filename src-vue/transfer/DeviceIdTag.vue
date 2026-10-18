<script setup lang="ts">
import { computed } from 'vue';
import { DEVICE_COLORS, hashDeviceId, shortPhoneId } from '@/lib/ui/transfer/deviceColors';

/**
 * 带边框与专属底色的设备 ID 标签（React 版 DeviceIdTag 的等价实现）。
 * 颜色下标由调用方传入（列表内已做撞色顺延）；不传则按哈希取。
 */
const props = defineProps<{ id: string; colorIndex?: number }>();

const idx = computed(() =>
    typeof props.colorIndex === 'number' ? props.colorIndex : hashDeviceId(props.id) % DEVICE_COLORS.length
);
const palette = computed(() => DEVICE_COLORS[idx.value]);
</script>

<template>
    <span
        :data-device-id="id"
        :data-color-index="idx"
        class="inline-block rounded-[6px] border px-2 py-px text-[13px] leading-5"
        :style="{ borderColor: palette.border, background: palette.bg, color: palette.color }">
        {{ shortPhoneId(id) }}
    </span>
</template>
