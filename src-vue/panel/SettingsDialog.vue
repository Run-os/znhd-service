<script setup lang="ts">
import { computed } from 'vue';
import { hoursToHHmm, hhmmToHours } from '@/lib/utils';
import { Button } from '@vue/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldSeparator, FieldTitle } from '@vue/components/ui/field';
import { InputGroup, InputGroupInput } from '@vue/components/ui/input-group';
import Switch from '../components/ui/switch/Switch.vue';
import AppDialog from './AppDialog.vue';

export interface WorkingHours {
    morningStart: number;
    morningEnd: number;
    afternoonStart: number;
    afternoonEnd: number;
}

/**
 * 设置弹窗（Vue 版，字段与 React 版 SettingsModal 一一对应）。
 *
 * 组件构成（2026-10-18 组件正规化）：
 *   · 外壳 = 官方 Dialog + Card（AppDialog）；
 *   · 每个设置项 = 官方 **Field**（标题 + 说明 + 控件），横排用 orientation="horizontal"；
 *   · 时间输入 = 官方 **InputGroup**（带边框与聚焦环的输入容器）；
 *   · 顶部三个快捷入口 = 官方 **Button** 的 link 变体。
 *
 * ⚠️ 时间输入用原生 `<input type="time">`：React 版 v26.10.06-v16 已实测换掉 antd TimePicker，
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

function updateWh(field: keyof WorkingHours, raw: string | number) {
    const dec = hhmmToHours(String(raw ?? ''));
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
    <AppDialog
        :open="props.open"
        title="设置菜单"
        :width="520"
        :footer="false"
        @update:open="emit('update:open', $event)">
        <!-- 三个快捷入口：官方 Button 的 link 变体（原来是裸 <button> + 蓝色文字） -->
        <div class="flex flex-wrap items-center gap-0.5">
            <Button variant="link" size="xs" @click="openHomepage">[脚本主页]</Button>
            <Button variant="link" size="xs" @click="openUpdateUrl">[更新脚本]</Button>
            <Button variant="link" size="xs" @click="emit('openChangelog')">[更新日志]</Button>
        </div>

        <FieldSeparator class="my-4">其他设置</FieldSeparator>

        <FieldGroup class="gap-3">
            <Field
                orientation="horizontal"
                class="items-center justify-between rounded-lg border border-border px-3 py-2.5">
                <FieldContent>
                    <FieldTitle class="text-[13px]">使用 CDN 加速（Fastly 镜像）加载资源</FieldTitle>
                </FieldContent>
                <Switch :model-value="props.useCdn" @update:model-value="emit('changeUseCdn', $event)" />
            </Field>

            <Field
                orientation="horizontal"
                class="items-start justify-between rounded-lg border border-border px-3 py-2.5">
                <FieldContent>
                    <FieldTitle class="text-[13px]">图片嗅探：先在后台预测量图片大小</FieldTitle>
                    <FieldDescription class="text-xs leading-5">
                        开启后打开嗅探窗口即刻显示大小（不必当场等测量）。代价：页面上的图若只能靠请求测大小
                        （跨域且拿不到资源表读数），脚本会在没打开窗口时就去测量 —— 关掉此项可避免这类请求。
                    </FieldDescription>
                </FieldContent>
                <Switch
                    :model-value="props.sniffPreMeasure"
                    @update:model-value="emit('changeSniffPreMeasure', $event)" />
            </Field>

            <Field class="rounded-lg border border-border px-3 py-3">
                <FieldLabel class="text-[13px]">监控时间段（点击选择时间）</FieldLabel>
                <div v-for="f in timeFields" :key="f.row" class="flex flex-wrap items-center gap-2">
                    <span class="w-8 text-[13px] text-muted-foreground">{{ f.row }}</span>
                    <InputGroup class="w-[112px]">
                        <InputGroupInput
                            type="time"
                            step="300"
                            :model-value="hoursToHHmm(wh[f.from])"
                            @update:model-value="updateWh(f.from, $event)" />
                    </InputGroup>
                    <span class="text-[13px] text-muted-foreground">至</span>
                    <InputGroup class="w-[112px]">
                        <InputGroupInput
                            type="time"
                            step="300"
                            :model-value="hoursToHHmm(wh[f.to])"
                            @update:model-value="updateWh(f.to, $event)" />
                    </InputGroup>
                </div>
                <FieldDescription class="text-xs leading-5">
                    提示：将「下午开始」设为与「上午结束」相同（如都设为 12:00），即可午休时段也监控。
                </FieldDescription>
            </Field>
        </FieldGroup>
    </AppDialog>
</template>
