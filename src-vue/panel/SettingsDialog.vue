<script setup lang="ts">
import { computed, ref } from 'vue';
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
 * 设置弹窗（v26.10.25-v1 改版：左右两栏）。
 *
 * 布局：弹窗**固定 680×560**（AppDialog 的 height 参数：内容区内部滚动，切页不改变窗口大小），
 * 左侧固定侧边栏（daisyUI 5 `menu`，选中类 `menu-active`），
 * 右侧内容区随选择切换，**默认选中「飞书快捷短语」**：
 *   · 飞书快捷短语 = `<FeishuAuthPanel />`（含隐私信息表格区块）；
 *   · 其他设置 = CDN 开关 / 嗅探预测量开关 / 监控时间段选择器；
 *   · 关于 = 技术栈脚注 + 脚本版本 + 作者/主页链接。
 *
 * 标题栏（AppDialog `#title` 插槽，h3 是 flex 容器）：左「设置菜单」文字 +
 * `ml-auto` 横排「脚本主页 / 更新脚本」（外链）+「运行日志」（按钮）。
 * ⚠️ v26.10.25-v1 起「更新日志」按钮整个删除（连同 ChangelogDialog / lib/changelog.ts），
 *    要看更新记录请到仓库 changelogs/ 目录。
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
    /** v26.10.21-v5：主面板已删，「查看日志」迁到这里（打开运行日志弹窗，叠加显示） */
    openLog: [];
}>();

/** 侧边栏页签（v26.10.25-v1） */
type SettingsPage = 'feishu' | 'general' | 'about';
const page = ref<SettingsPage>('feishu');
const pages: Array<{ id: SettingsPage; label: string }> = [
    { id: 'feishu', label: '飞书快捷短语' },
    { id: 'general', label: '其他设置' },
    { id: 'about', label: '关于' },
];

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

/** 脚本版本号（「关于」页展示） */
const VERSION = (GM_info.script.version || '?') as string;
</script>

<template>
    <AppDialog
        :open="props.open"
        title="设置菜单"
        :width="680"
        :height="560"
        :footer="false"
        @update:open="emit('update:open', $event)">
        <!-- 标题栏：左侧标题 + 右侧横排快捷入口（AppDialog 的 h3 是 flex-1，ml-auto 真正靠右；
             关闭 × 由 AppDialog 自带，永远在最右） -->
        <template #title>
            <span>设置菜单</span>
            <span class="ml-auto flex items-center gap-1.5">
                <a class="btn btn-outline btn-sm" :href="HOMEPAGE_URL" target="_blank" rel="noreferrer">脚本主页</a>
                <a class="btn btn-outline btn-sm" :href="UPDATE_URL" target="_blank" rel="noreferrer">更新脚本</a>
                <button class="btn btn-outline btn-sm" data-znhd="open-log-btn" @click="emit('openLog')">运行日志</button>
            </span>
        </template>

        <div class="flex items-start gap-4 py-1" data-znhd="settings-body">
            <!-- 左侧固定侧边栏：daisyUI 5 menu，选中项 menu-active -->
            <ul class="menu w-36 shrink-0 rounded-box bg-base-200 p-1.5">
                <li v-for="p in pages" :key="p.id">
                    <button
                        :class="{ 'menu-active': page === p.id }"
                        :data-znhd="'settings-nav-' + p.id"
                        @click="page = p.id">
                        {{ p.label }}
                    </button>
                </li>
            </ul>

            <!-- 右侧内容区（弹窗高度已固定，超出部分由 AppDialog 的内容层滚动） -->
            <div class="min-w-0 flex-1">
                <!-- 飞书快捷短语（默认页）：授权 + 规则表链接 + 隐私信息表格，自成一体 -->
                <FeishuAuthPanel v-if="page === 'feishu'" />

                <!-- 其他设置：开关与时间段原样搬入 -->
                <template v-else-if="page === 'general'">
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
                        <!-- v26.10.23-v4：上午/下午**强制同一行**（v6 的 flex-wrap 在窄面板下会折成两行）。
                             用两列等分 + 内部 input `min-w-0 w-full` 自适应：容器再窄也只会挤压，不会换行。 -->
                        <div class="grid grid-cols-2 gap-x-3">
                            <div v-for="f in timeFields" :key="f.row" class="flex min-w-0 items-center gap-1">
                                <span class="shrink-0 text-[12px] text-base-content/60">{{ f.row }}</span>
                                <input
                                    type="time"
                                    step="300"
                                    class="input w-full min-w-0 px-1.5 text-[13px]"
                                    :value="hoursToHHmm(wh[f.from])"
                                    @input="updateWh(f.from, ($event.target as HTMLInputElement).value)" />
                                <span class="shrink-0 text-[12px] text-base-content/60">至</span>
                                <input
                                    type="time"
                                    step="300"
                                    class="input w-full min-w-0 px-1.5 text-[13px]"
                                    :value="hoursToHHmm(wh[f.to])"
                                    @input="updateWh(f.to, ($event.target as HTMLInputElement).value)" />
                            </div>
                        </div>
                    </fieldset>
                </template>

                <!-- 关于：技术栈 + 版本 + 主页 -->
                <div v-else class="flex flex-col gap-3 py-1" data-znhd="settings-about">
                    <p class="label whitespace-normal">
                        技术栈：Vue 3 + Tailwind CSS 4 +
                        <a
                            class="link link-hover text-primary"
                            href="https://daisyui.com/components/"
                            target="_blank"
                            rel="noreferrer">daisyUI 5</a>
                        + vite-plugin-monkey
                    </p>
                    <p class="text-[13px]">脚本版本：<span class="font-mono">v{{ VERSION }}</span></p>
                    <p class="text-[13px]">
                        作者 / 主页：<a class="link link-hover text-primary" :href="HOMEPAGE_URL" target="_blank" rel="noreferrer">Run-os/znhd-service</a>
                    </p>
                </div>
            </div>
        </div>
    </AppDialog>
</template>
