<script setup lang="ts">
import { addLog } from '@/lib/logger';
import { DEFAULT_RELAY_SERVER } from '@/lib/transfer/settings';
import { clearAllTransferFiles, updateTransferSettings } from '@/lib/transfer/store';
import { useTransferStore } from '@vue/composables/useTransferStore';
import { computed, ref, watch } from 'vue';
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
 * 左侧固定侧边栏（daisyUI 5 `menu`，v26.10.25-v4 参考图定版：**浮动面板** = 四边 8px 外边距 +
 * 20px 圆角 + 低透明度柔和投影；选中项黑色胶囊 = `menu-active bg-neutral text-neutral-content`），
 * 右侧内容区随选择切换，**默认选中「飞书快捷短语」**；各页功能区之间统一 hairline 分割（divide-y）：
 *   · 飞书快捷短语 = `<FeishuAuthPanel />`（含隐私信息表格区块）；
 *   · 传输助手 = 中继地址 / 自动打开开关 / 清空记录（v26.10.25-v2 自传输窗口迁入）；
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

/** 侧边栏页签（v26.10.25-v1；v26.10.25-v2 起并入「传输助手」—— 原传输窗口的设置弹窗已删） */
type SettingsPage = 'feishu' | 'transfer' | 'general' | 'about';
const page = ref<SettingsPage>('feishu');
const pages: Array<{ id: SettingsPage; label: string }> = [
    { id: 'feishu', label: '飞书快捷短语' },
    { id: 'transfer', label: '传输助手' },
    { id: 'general', label: '其他设置' },
    { id: 'about', label: '关于' },
];

/* ── 传输助手（v26.10.25-v2 自 transfer/SettingsDialog.vue 迁入）─────────────
 * 中继地址用**草稿 + 失焦/回车提交**：updateTransferSettings 在地址变化时会
 * 重启轮询与长轮询，逐字提交会让输入 "https://…" 的每个合法前缀都触发一次重连。 */
const transferStore = useTransferStore();
const relayDraft = ref(transferStore.value.settings.relayServer);
const confirmClear = ref(false);

watch(
    () => props.open,
    (v) => {
        if (v) {
            relayDraft.value = transferStore.value.settings.relayServer;
            confirmClear.value = false;
        } else {
            commitRelay(relayDraft.value);
        }
    }
);

function commitRelay(val: string) {
    const url = (val || '').trim().replace(/\/+$/, '');
    if (url && url !== transferStore.value.settings.relayServer) updateTransferSettings({ relayServer: url });
}

function onBlur() {
    const url = (relayDraft.value || '').trim();
    if (!url) {
        // 清空并失焦 → 回填默认地址（与主面板常用语地址同一交互）
        relayDraft.value = DEFAULT_RELAY_SERVER;
        commitRelay(DEFAULT_RELAY_SERVER);
    } else {
        commitRelay(url);
    }
}

function doClearAll() {
    clearAllTransferFiles();
    addLog('[传输助手] 已清空全部传输记录', 'success');
    confirmClear.value = false;
}

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
                <a class="btn btn-outline btn-sm rounded-full" :href="HOMEPAGE_URL" target="_blank" rel="noreferrer">脚本主页</a>
                <a class="btn btn-outline btn-sm rounded-full" :href="UPDATE_URL" target="_blank" rel="noreferrer">更新脚本</a>
                <button class="btn btn-outline btn-sm rounded-full" data-znhd="open-log-btn" @click="emit('openLog')">运行日志</button>
            </span>
        </template>

        <!-- v26.10.25-v4 参考图定版：侧边栏 = 浮动面板（四边 m-2 外边距 + 20px 圆角 + 低透明度柔和投影）；
             选中项 = 黑色胶囊（menu-active + bg-neutral 覆写，utilities 层优先级高于组件层）。
             右侧内容区同样 my-2，让上下沿与侧边栏外边距对齐 -->
        <div class="flex items-stretch gap-4" data-znhd="settings-body">
            <!-- 左侧固定侧边栏：daisyUI 5 menu -->
            <ul class="menu m-2 w-36 shrink-0 rounded-[20px] bg-base-200 p-2 shadow-[0_2px_16px_rgba(0,0,0,0.08)]">
                <li v-for="p in pages" :key="p.id">
                    <button
                        :class="{ 'menu-active bg-neutral text-neutral-content': page === p.id }"
                        :data-znhd="'settings-nav-' + p.id"
                        @click="page = p.id">
                        {{ p.label }}
                    </button>
                </li>
            </ul>

            <!-- 右侧内容区（弹窗高度已固定，超出部分由 AppDialog 的内容层滚动） -->
            <div class="my-2 min-w-0 flex-1">
                <!-- 飞书快捷短语（默认页）：授权 + 规则表链接 + 隐私信息表格，自成一体 -->
                <FeishuAuthPanel v-if="page === 'feishu'" />

                <!-- 传输助手（v26.10.25-v2 自传输窗口的设置弹窗迁入；v4 起功能区之间用 hairline 分割） -->
                <div v-else-if="page === 'transfer'" class="divide-y divide-base-300" data-znhd="transfer-settings">
                    <fieldset class="fieldset py-3 first:pt-0">
                        <legend class="fieldset-legend">中继服务器地址</legend>
                        <input
                            v-model="relayDraft"
                            type="text"
                            class="input w-full"
                            placeholder="https://你的服务器:端口"
                            @blur="onBlur"
                            @keydown.enter.prevent="commitRelay(relayDraft)" />
                        <p class="label whitespace-normal">
                            手机上传的图片 / 文本经此服务器转发到本机。修改后点其他区域或按回车生效；留空失焦恢复默认地址。
                        </p>
                    </fieldset>

                    <fieldset class="fieldset py-3">
                        <legend class="fieldset-legend flex w-full items-center justify-between gap-3">
                            <span>收到内容时自动打开传输助手</span>
                            <input
                                type="checkbox"
                                class="toggle"
                                :checked="transferStore.settings.autoOpenOnReceive"
                                @change="updateTransferSettings({ autoOpenOnReceive: ($event.target as HTMLInputElement).checked })" />
                        </legend>
                        <p class="label whitespace-normal">关闭时仅累计未读角标，不打扰；窗口已开着则只累加，不强行切换会话。</p>
                    </fieldset>

                    <div class="py-3">
                        <template v-if="!confirmClear">
                            <button class="btn btn-error btn-sm rounded-full" @click="confirmClear = true">清空全部传输记录</button>
                        </template>
                        <div v-else role="alert" class="alert alert-error alert-soft alert-vertical">
                            <div>
                                <div class="text-[13px]">清空全部传输记录</div>
                                <div class="text-xs">
                                    所有会话的图片与文本都会被移除（仅清理本机内存，不影响手机上的文件）
                                </div>
                            </div>
                            <div class="flex justify-end gap-2">
                                <button class="btn btn-outline btn-sm rounded-full" @click="confirmClear = false">取消</button>
                                <button class="btn btn-error btn-sm rounded-full" @click="doClearAll">清空</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 其他设置：开关与时间段（v4 起功能区之间用 hairline 分割） -->
                <div v-else-if="page === 'general'" class="divide-y divide-base-300">
                    <fieldset class="fieldset py-3 first:pt-0">
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

                    <fieldset class="fieldset py-3">
                        <legend class="fieldset-legend flex w-full items-center justify-between gap-3">
                            <span>图片嗅探：先在后台预测量图片大小</span>
                            <input
                                type="checkbox"
                                class="toggle"
                                :checked="props.sniffPreMeasure"
                                @change="emit('changeSniffPreMeasure', ($event.target as HTMLInputElement).checked)" />
                        </legend>
                    </fieldset>

                    <fieldset class="fieldset py-3">
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
                </div>

                <!-- 关于：技术栈 + 版本 + 主页（v4 起行间用 hairline 分割） -->
                <div v-else class="divide-y divide-base-300" data-znhd="settings-about">
                    <p class="label whitespace-normal py-3 first:pt-0">
                        技术栈：Vue 3 + Tailwind CSS 4 +
                        <a
                            class="link link-hover text-primary"
                            href="https://daisyui.com/components/"
                            target="_blank"
                            rel="noreferrer">daisyUI 5</a>
                        + vite-plugin-monkey
                    </p>
                    <p class="py-3 text-[13px]">脚本版本：<span class="font-mono">v{{ VERSION }}</span></p>
                    <p class="py-3 text-[13px]">
                        作者 / 主页：<a class="link link-hover text-primary" :href="HOMEPAGE_URL" target="_blank" rel="noreferrer">Run-os/znhd-service</a>
                    </p>
                </div>
            </div>
        </div>
    </AppDialog>
</template>
