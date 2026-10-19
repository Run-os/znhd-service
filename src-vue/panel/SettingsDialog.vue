<script setup lang="ts">
import { computed } from 'vue';
import { hoursToHHmm, hhmmToHours } from '@/lib/utils';
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
 * 迁移到 daisyUI 后的组件构成（全部官方原生）：
 *   · 外壳 = `AppDialog`（`<dialog class="modal">`）
 *   · 每个设置项 = `fieldset` + `fieldset-legend` + `label`（skill/components/fieldset.md）
 *   · 开关 = `toggle`
 *   · 时间输入 = `input`（原生 `<input type="time">`）
 *   · 快捷入口 = `btn btn-outline btn-sm`
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

/** 脚本主页（外链，交给 <a target="_blank"> 原生开新标签，不写 window.open） */
const HOMEPAGE_URL = 'https://github.com/Run-os/znhd-service';

/** 更新脚本地址：优先用脚本管理器给出的更新地址，回退到 @updateURL */
const UPDATE_URL = (GM_info.scriptUpdateURL || GM_info.script.updateURL) as string;
</script>

<template>
    <AppDialog
        :open="props.open"
        title="设置菜单"
        :width="520"
        :footer="false"
        @update:open="emit('update:open', $event)">
        <div class="flex flex-wrap items-center gap-2">
            <a class="btn btn-outline btn-sm" :href="HOMEPAGE_URL" target="_blank" rel="noreferrer">脚本主页</a>
            <a class="btn btn-outline btn-sm" :href="UPDATE_URL" target="_blank" rel="noreferrer">更新脚本</a>
            <button class="btn btn-outline btn-sm" @click="emit('openChangelog')">更新日志</button>
        </div>

        <div class="divider">其他设置</div>

        <fieldset class="fieldset">
            <legend class="fieldset-legend">使用 CDN 加速（Fastly 镜像）加载资源</legend>
            <input
                type="checkbox"
                class="toggle"
                :checked="props.useCdn"
                @change="emit('changeUseCdn', ($event.target as HTMLInputElement).checked)" />
        </fieldset>

        <fieldset class="fieldset">
            <legend class="fieldset-legend">图片嗅探：先在后台预测量图片大小</legend>
            <input
                type="checkbox"
                class="toggle"
                :checked="props.sniffPreMeasure"
                @change="emit('changeSniffPreMeasure', ($event.target as HTMLInputElement).checked)" />
            <p class="label">
                开启后打开嗅探窗口即刻显示大小（不必当场等测量）。代价：页面上的图若只能靠请求测大小
                （跨域且拿不到资源表读数），脚本会在没打开窗口时就去测量 —— 关掉此项可避免这类请求。
            </p>
        </fieldset>

        <fieldset class="fieldset">
            <legend class="fieldset-legend">监控时间段（点击选择时间）</legend>
            <div v-for="f in timeFields" :key="f.row" class="flex flex-wrap items-center gap-2">
                <span class="w-8 text-[13px] text-base-content/60">{{ f.row }}</span>
                <input
                    type="time"
                    step="300"
                    class="input w-[112px]"
                    :value="hoursToHHmm(wh[f.from])"
                    @input="updateWh(f.from, ($event.target as HTMLInputElement).value)" />
                <span class="text-[13px] text-base-content/60">至</span>
                <input
                    type="time"
                    step="300"
                    class="input w-[112px]"
                    :value="hoursToHHmm(wh[f.to])"
                    @input="updateWh(f.to, ($event.target as HTMLInputElement).value)" />
            </div>
            <p class="label">提示：将「下午开始」设为与「上午结束」相同（如都设为 12:00），即可午休时段也监控。</p>
        </fieldset>
    </AppDialog>
</template>
