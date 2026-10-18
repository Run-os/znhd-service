<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { addLog, setLogEntriesSink, type LogEntry } from '@/lib/logger';
import { getMonitorState, resetWaitCountBaseline, setMonitorStateSink, type MonitorState } from '@/lib/monitor';
import { clearSpeechQueue } from '@/lib/speech';
import { runtime } from '@/lib/state';
import { saveAllvalue, type Allvalue } from '@/lib/storage';
import { hoursToHHmm } from '@/lib/utils';
import { PANEL_WIDTH } from '@/lib/ui/panelIds';
import { Icon, type IconName } from '../icons';
import Tooltip from '../components/ui/tooltip/Tooltip.vue';
import Switch from '../components/ui/switch/Switch.vue';
import { clampHostIntoView } from './geometry';
import { usePanelDrag } from './usePanelDrag';
import SettingsDialog from './SettingsDialog.vue';
import PlaceholderDialog from './PlaceholderDialog.vue';

const props = defineProps<{ host: HTMLElement }>();
const drag = usePanelDrag(props.host);

/** 品牌图标：税务站点 favicon，失败回退准星（同 React 版 BrandIcon） */
const BRAND_ICON = 'https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico';
const brandFailed = ref(false);

/** 面板入口（与 React 版 PANEL_ACTIONS 一致；「传输助手」4 字是最长标签） */
const PANEL_ACTIONS: Array<{ key: string; icon: IconName; label: string }> = [
    { key: 'settings', icon: 'settings', label: '设置' },
    { key: 'phrases', icon: 'phrases', label: '常用语' },
    { key: 'transfer', icon: 'transfer', label: '传输助手' },
    { key: 'sniff', icon: 'sniff', label: '图片嗅探' },
];

const allvalue = ref<Allvalue>(runtime.init);
const voiceEnabled = computed(() => !!allvalue.value.voiceEnabled);

const settingsOpen = ref(false);
const phrasesOpen = ref(false);
const transferOpen = ref(false);
const sniffOpen = ref(false);
const logOpen = ref(false);
const changelogOpen = ref(false);

const collapsed = ref(false);
const mon = ref<MonitorState>(getMonitorState());
/** 日志条目：阶段 2 的日志弹窗直接消费它（sink 是 React setState 风格，这里转成 ref） */
const logEntries = ref<LogEntry[]>([]);

const VERSION = GM_info.script.version;

function patchAllvalue(kv: Partial<Allvalue>) {
    const next = { ...allvalue.value, ...kv };
    allvalue.value = next;
    saveAllvalue(next);
    runtime.voiceEnabled = next.voiceEnabled;
    runtime.workingHours = next.workingHours;
    runtime.useCdn = !!next.useCdn;
    runtime.logAutoRefresh = !!next.logAutoRefresh;
}

function toggleVoice(next: boolean) {
    patchAllvalue({ voiceEnabled: next });
    addLog('语音播报已' + (next ? '开启' : '静音'), 'info');
    if (next && 'speechSynthesis' in window) {
        // 播放一个静默语音激活语音合成（绕过浏览器 not-allowed 限制）
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
        // 关闭期间人数上升沿被 speak() 的静音判断吃掉，复位基线让下一次轮询补播
        resetWaitCountBaseline();
    } else if (!next) {
        clearSpeechQueue();
    }
}

function lastSpeakText(last: MonitorState['lastSpeak']): string {
    if (!last) return '暂无播报记录';
    const mins = Math.floor((Date.now() - last.at) / 60000);
    const when = mins <= 0 ? '刚刚' : mins + ' 分钟前';
    return '上次播报：' + when + ' · ' + last.reason;
}

const statusText = computed(() =>
    mon.value.inWorkingHours
        ? '当前等待人数：' + (mon.value.waiting === null ? '—' : mon.value.waiting) + ' 人'
        : '当前非工作时段'
);

function openEntry(key: string) {
    if (key === 'settings') settingsOpen.value = true;
    else if (key === 'phrases') phrasesOpen.value = true;
    else if (key === 'transfer') transferOpen.value = true;
    else if (key === 'sniff') sniffOpen.value = true;
}

// 悬浮球贴边后展开：按面板真实宽度裁回视口（只在「收起 → 展开」这一跳做）
watch(collapsed, (now, prev) => {
    if (prev && !now) clampHostIntoView(props.host);
});

onMounted(() => {
    setLogEntriesSink((updater) => (logEntries.value = updater(logEntries.value)));
    setMonitorStateSink((s) => (mon.value = s));
    mon.value = getMonitorState();

    addLog('脚本已启动，版本 v' + (VERSION || '?'), 'success');
    const wh = allvalue.value.workingHours || runtime.workingHours;
    if (wh) {
        addLog(
            '监控时间段：上午 ' +
                hoursToHHmm(wh.morningStart) +
                '-' +
                hoursToHHmm(wh.morningEnd) +
                '，下午 ' +
                hoursToHHmm(wh.afternoonStart) +
                '-' +
                hoursToHHmm(wh.afternoonEnd),
            'info'
        );
    }
    addLog('语音播报：' + (runtime.voiceEnabled ? '已开启' : '已静音'), 'info');
});

onBeforeUnmount(() => {
    setLogEntriesSink(null);
    setMonitorStateSink(null);
});

// logEntries 在阶段 2 的日志弹窗里消费；先显式引用，避免 noUnusedLocals 误报
void logEntries;
</script>

<template>
    <!-- 收起态：圆形悬浮球（可拖动，拖过就不再展开） -->
    <button
        v-if="collapsed"
        type="button"
        title="拖动可移动位置，点击展开面板"
        class="flex size-9 cursor-move touch-none select-none items-center justify-center overflow-hidden rounded-full border-0 bg-[#1677ff] p-0 shadow-[0_4px_16px_rgba(0,0,0,0.18)] outline-none"
        @pointerdown="drag.onPointerDown"
        @pointermove="drag.onPointerMove"
        @pointerup="drag.onPointerUp"
        @pointercancel="drag.onPointerCancel"
        @click="drag.consumeDrag() || (collapsed = false)">
        <img
            v-if="!brandFailed"
            :src="BRAND_ICON"
            alt=""
            draggable="false"
            class="block size-5 rounded-[4px]"
            @error="brandFailed = true" />
        <Icon v-else name="crosshair" :size="20" color="#fff" />
    </button>

    <div
        v-else
        class="overflow-hidden rounded-[8px] border border-[#f0f0f0] bg-white shadow-[0_6px_24px_rgba(0,0,0,0.18)]"
        :style="{ width: PANEL_WIDTH + 'px' }">
        <!-- 标题栏 = 唯一拖拽手柄 -->
        <div
            class="flex cursor-move touch-none select-none items-center gap-1.5 border-b border-[#f0f0f0] px-2.5 py-2"
            style="min-height: 46px"
            title="按住拖动面板"
            @pointerdown="drag.onPointerDown"
            @pointermove="drag.onPointerMove"
            @pointerup="drag.onPointerUp"
            @pointercancel="drag.onPointerCancel">
            <img
                v-if="!brandFailed"
                :src="BRAND_ICON"
                alt=""
                draggable="false"
                class="block size-[26px] shrink-0 rounded-[6px]"
                @error="brandFailed = true" />
            <span
                v-else
                class="flex size-[26px] shrink-0 items-center justify-center rounded-[6px] bg-[#1677ff]">
                <Icon name="crosshair" :size="16" color="#fff" />
            </span>
            <span class="min-w-0 truncate text-[15px] font-bold leading-6">征纳互动监控</span>
            <span
                class="shrink-0 rounded-[10px] bg-[#e6f4ff] px-[8px] py-[1px] text-[11px] font-normal leading-5 text-[#1677ff]">
                v{{ VERSION }}
            </span>
            <button
                type="button"
                class="ml-auto inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-[#8c8c8c] outline-none hover:bg-black/5 hover:text-[#262626]"
                title="收起面板（点圆形按钮可展开）"
                aria-label="收起面板"
                @click="collapsed = true">
                <Icon name="close" :size="16" />
            </button>
        </div>

        <div class="p-3">
            <!-- 人数 / 工作时段（单行 + 在线指示灯） -->
            <div
                class="mb-2.5 flex items-center rounded-[10px] bg-[#f7f8fa] px-3 py-2 text-[13px]"
                :class="mon.inWorkingHours ? 'text-[#262626]' : 'text-[#8c8c8c]'">
                <span
                    class="mr-1.5 inline-block size-1.5 rounded-full"
                    :style="{ background: mon.online ? '#52c41a' : '#ff4d4f' }" />
                {{ statusText }}
            </div>

            <!-- 语音播报开关 -->
            <div class="mb-2.5 flex items-center justify-between rounded-[10px] bg-[#f7f8fa] px-3 py-2">
                <span class="flex items-center gap-1.5 text-[13px]">
                    <Icon
                        :name="voiceEnabled ? 'volumeOn' : 'volumeOff'"
                        :size="15"
                        :color="voiceEnabled ? '#1677ff' : '#bfbfbf'" />
                    语音播报
                </span>
                <Switch :model-value="voiceEnabled" @update:model-value="toggleVoice" />
            </div>

            <!-- 4 个入口：宽度足够才显示文字（容器查询），悬停给完整文案 -->
            <div class="grid grid-cols-4 gap-1.5">
                <Tooltip v-for="a in PANEL_ACTIONS" :key="a.key" :content="a.label">
                    <button
                        type="button"
                        class="znhd-panel-btn flex h-10 min-w-0 cursor-pointer items-center justify-center gap-0.5 rounded-[8px] border border-[#d9d9d9] bg-white px-1 text-[#262626] outline-none hover:border-[#4096ff] hover:text-[#4096ff]"
                        @click="openEntry(a.key)">
                        <Icon :name="a.icon" :size="15" color="#1677ff" />
                        <span class="znhd-panel-btn-text ml-0.5 text-[11px]">{{ a.label }}</span>
                    </button>
                </Tooltip>
            </div>

            <!-- 底部：上次播报 + 查看日志 -->
            <div class="mt-2.5 flex items-center justify-between gap-2 text-xs text-[#8c8c8c]">
                <span class="truncate">{{ lastSpeakText(mon.lastSpeak) }}</span>
                <button
                    type="button"
                    class="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-xs text-[#1677ff] hover:text-[#4096ff]"
                    @click="logOpen = true">
                    查看日志 →
                </button>
            </div>
        </div>

        <SettingsDialog
            v-model:open="settingsOpen"
            :working-hours="allvalue.workingHours"
            :use-cdn="!!allvalue.useCdn"
            :sniff-pre-measure="allvalue.sniffPreMeasure !== false"
            @change-working-hours="
                (wh) => {
                    patchAllvalue({ workingHours: wh });
                    addLog(
                        '监控时间段已更新：上午 ' +
                            hoursToHHmm(wh.morningStart) +
                            '-' +
                            hoursToHHmm(wh.morningEnd) +
                            '，下午 ' +
                            hoursToHHmm(wh.afternoonStart) +
                            '-' +
                            hoursToHHmm(wh.afternoonEnd),
                        'info'
                    );
                }
            "
            @change-use-cdn="
                (v) => {
                    patchAllvalue({ useCdn: !!v });
                    addLog('CDN 加速已' + (v ? '开启' : '关闭'), 'info');
                }
            "
            @change-sniff-pre-measure="
                (v) => {
                    patchAllvalue({ sniffPreMeasure: !!v });
                    addLog('图片嗅探：后台预测量已' + (v ? '开启' : '关闭'), 'info');
                }
            "
            @open-changelog="changelogOpen = true" />

        <PlaceholderDialog v-model:open="phrasesOpen" title="常用语" phase="阶段 2" />
        <PlaceholderDialog v-model:open="transferOpen" title="传输助手" phase="阶段 3" />
        <PlaceholderDialog v-model:open="sniffOpen" title="图片嗅探" phase="阶段 4" />
        <PlaceholderDialog v-model:open="logOpen" title="查看日志" phase="阶段 2" />
        <PlaceholderDialog v-model:open="changelogOpen" title="更新日志" phase="阶段 2" />
    </div>
</template>
