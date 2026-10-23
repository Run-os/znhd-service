<script setup lang="ts">
import { computed } from 'vue';
import { hoursToHHmm, hhmmToHours } from '@/lib/utils';
import AppDialog from './AppDialog.vue';
import FeishuAuthPanel from './FeishuAuthPanel.vue';

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
    /** v26.10.21-v5：主面板已删，「查看日志」迁到这里（打开运行日志弹窗，叠加显示） */
    openLog: [];
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
            <button class="btn btn-outline btn-sm" @click="emit('openLog')">运行日志</button>
        </div>

        <div class="divider">快捷回复</div>

        <!-- 飞书授权区块（v26.10.23）：自带状态、授权轮询与刷新，不经过本组件的 props -->
        <FeishuAuthPanel />

        <div class="divider">其他设置</div>

        <fieldset class="fieldset">
            <!-- 开关与描述文本同一行：legend 拉成 flex 行，toggle 靠右 -->
            <legend class="fieldset-legend flex w-full items-center justify-between gap-3">
                <span>使用 CDN 加速（Fastly 镜像）加载资源</span>
                <input
                    type="checkbox"
                    class="toggle"
                    :checked="props.useCdn"
                    @change="emit('changeUseCdn', ($event.target as HTMLInputElement).checked)" />
            </legend>
        </fieldset>

        <fieldset class="fieldset">
            <legend class="fieldset-legend flex w-full items-center justify-between gap-3">
                <span>图片嗅探：先在后台预测量图片大小</span>
                <input
                    type="checkbox"
                    class="toggle"
                    :checked="props.sniffPreMeasure"
                    @change="emit('changeSniffPreMeasure', ($event.target as HTMLInputElement).checked)" />
            </legend>
        </fieldset>

        <fieldset class="fieldset">
            <legend class="fieldset-legend">监控时间段（点击选择时间）</legend>
            <!-- v26.10.21-v6：上午/下午并排一行，时间控件收窄（w-[92px]） -->
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div v-for="f in timeFields" :key="f.row" class="flex items-center gap-1.5">
                    <span class="text-[13px] text-base-content/60">{{ f.row }}</span>
                    <input
                        type="time"
                        step="300"
                        class="input w-[92px] px-2"
                        :value="hoursToHHmm(wh[f.from])"
                        @input="updateWh(f.from, ($event.target as HTMLInputElement).value)" />
                    <span class="text-[13px] text-base-content/60">至</span>
                    <input
                        type="time"
                        step="300"
                        class="input w-[92px] px-2"
                        :value="hoursToHHmm(wh[f.to])"
                        @input="updateWh(f.to, ($event.target as HTMLInputElement).value)" />
                </div>
            </div>
        </fieldset>

        <!-- 技术栈脚注：daisyUI 带官方组件库链接 -->
        <p class="label whitespace-normal">
            技术栈：Vue 3 + Tailwind CSS 4 +
            <a
                class="link link-hover text-primary"
                href="https://daisyui.com/components/"
                target="_blank"
                rel="noreferrer">daisyUI 5</a>
            + vite-plugin-monkey
        </p>
    </AppDialog>
</template>
