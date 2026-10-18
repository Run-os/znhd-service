<script setup lang="ts">
import { computed } from 'vue';
import { hoursToHHmm, hhmmToHours } from '@/lib/utils';
import Dialog from '../components/ui/dialog/Dialog.vue';
import Switch from '../components/ui/switch/Switch.vue';

export interface WorkingHours {
    morningStart: number;
    morningEnd: number;
    afternoonStart: number;
    afternoonEnd: number;
}

/**
 * 设置弹窗（Vue 版，字段与 React 版 SettingsModal 一一对应）。
 *
 * ⚠️ 时间输入用原生 <input type="time">：React 版 v26.10.06-v16 已实测换掉 antd TimePicker，
 *    清空时 hhmmToHours 返回 null —— 此时必须保持原值，不能把 NaN 写进配置。
 */
const props = defineProps<{
    open: boolean;
    workingHours: WorkingHours | null;
    useCdn: boolean;
    sniffPreMeasure: boolean;
}>();

const emit = defineEmits<{
    'update:open': [boolean];
    changeWorkingHours: [WorkingHours];
    changeUseCdn: [boolean];
    changeSniffPreMeasure: [boolean];
    openChangelog: [];
}>();

const wh = computed<WorkingHours>(
    () => props.workingHours || { morningStart: 9, morningEnd: 12, afternoonStart: 13.5, afternoonEnd: 18 }
);

function updateWh(field: keyof WorkingHours, raw: string) {
    const dec = hhmmToHours(raw);
    if (dec === null || typeof dec !== 'number' || isNaN(dec)) return;
    emit('changeWorkingHours', { ...wh.value, [field]: dec });
}

const timeFields = [
    { row: '上午', from: 'morningStart', to: 'morningEnd' },
    { row: '下午', from: 'afternoonStart', to: 'afternoonEnd' },
] as const;

// 模板里不能直接写 window（Vue 模板只暴露白名单全局），统一收在脚本里
function openHomepage() {
    window.open('https://github.com/Run-os/znhd-service', '_blank');
}

function openUpdateUrl() {
    window.open((GM_info.scriptUpdateURL || GM_info.script.updateURL) as string, '_blank');
}
</script>

<template>
    <Dialog
        :open="props.open"
        title="设置菜单"
        :width="520"
        :footer="false"
        @update:open="emit('update:open', $event)">
        <div class="space-y-3 text-sm text-[#262626]">
            <div class="flex flex-wrap items-center gap-1">
                <button
                    type="button"
                    class="cursor-pointer border-0 bg-transparent p-0 text-sm text-[#1677ff] hover:text-[#4096ff]"
                    @click="openHomepage">
                    [脚本主页]
                </button>
                <button
                    type="button"
                    class="cursor-pointer border-0 bg-transparent p-0 text-sm text-[#1677ff] hover:text-[#4096ff]"
                    @click="openUpdateUrl">
                    [更新脚本]
                </button>
                <button
                    type="button"
                    class="cursor-pointer border-0 bg-transparent p-0 text-sm text-[#1677ff] hover:text-[#4096ff]"
                    @click="emit('openChangelog')">
                    [更新日志]
                </button>
            </div>

            <div class="flex items-center gap-4 text-xs text-[#8c8c8c]">
                <span class="h-px flex-1 bg-[#f0f0f0]" />
                其他设置
                <span class="h-px flex-1 bg-[#f0f0f0]" />
            </div>

            <label class="flex items-center gap-2">
                <span class="font-semibold">使用 CDN 加速（Fastly 镜像）加载资源</span>
                <Switch
                    :model-value="props.useCdn"
                    @update:model-value="emit('changeUseCdn', $event)" />
            </label>

            <label class="flex items-center gap-2">
                <span class="font-semibold">图片嗅探：先在后台预测量图片大小</span>
                <Switch
                    :model-value="props.sniffPreMeasure"
                    @update:model-value="emit('changeSniffPreMeasure', $event)" />
            </label>
            <p class="m-0 text-xs leading-5 text-[#8c8c8c]">
                开启后打开嗅探窗口即刻显示大小（不必当场等测量）。代价：页面上的图若只能靠请求测大小
                （跨域且拿不到资源表读数），脚本会在没打开窗口时就去测量 —— 关掉此项可避免这类请求。
            </p>

            <p class="m-0 font-semibold">监控时间段（点击选择时间）</p>
            <div v-for="f in timeFields" :key="f.row" class="flex flex-wrap items-center gap-2">
                <span>{{ f.row }}</span>
                <input
                    type="time"
                    step="300"
                    class="h-8 w-[110px] rounded-[6px] border border-[#d9d9d9] px-2 text-sm outline-none focus:border-[#1677ff]"
                    :value="hoursToHHmm(wh[f.from])"
                    @change="updateWh(f.from, ($event.target as HTMLInputElement).value)" />
                <span>至</span>
                <input
                    type="time"
                    step="300"
                    class="h-8 w-[110px] rounded-[6px] border border-[#d9d9d9] px-2 text-sm outline-none focus:border-[#1677ff]"
                    :value="hoursToHHmm(wh[f.to])"
                    @change="updateWh(f.to, ($event.target as HTMLInputElement).value)" />
            </div>
            <p class="m-0 text-xs leading-5 text-[#8c8c8c]">
                提示：将「下午开始」设为与「上午结束」相同（如都设为 12:00），即可午休时段也监控。
            </p>
        </div>

        <template #footer>
            <button
                type="button"
                class="h-8 cursor-pointer rounded-[8px] border border-[#d9d9d9] bg-white px-4 text-sm text-[#262626] outline-none hover:border-[#4096ff] hover:text-[#4096ff]"
                @click="emit('update:open', false)">
                取消
            </button>
            <button
                type="button"
                class="h-8 cursor-pointer rounded-[8px] border border-[#1677ff] bg-[#1677ff] px-4 text-sm text-white outline-none hover:bg-[#4096ff]"
                @click="emit('update:open', false)">
                确定
            </button>
        </template>
    </Dialog>
</template>
