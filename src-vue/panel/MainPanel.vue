<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { addLog, clearLogs, setLogEntriesSink, type LogEntry } from '@/lib/logger';
import { getMonitorState, resetWaitCountBaseline, setMonitorStateSink, type MonitorState } from '@/lib/monitor';
import { clearSpeechQueue } from '@/lib/speech';
import { initTransfer, onTransferAutoOpen, stopTransfer } from '@/lib/transfer/store';
import { runtime } from '@/lib/state';
import { loadPhrasesCache, savePhrasesCache, saveAllvalue, type Allvalue } from '@/lib/storage';
import { readPhrasesFromZnhd, type ZnhdPhrases } from '@/lib/phrasesZnhd';
import { hoursToHHmm } from '@/lib/utils';
import { PANEL_WIDTH } from '@/lib/ui/panelIds';
import { toast } from '@vue/lib/toast';
import { themeMode, toggleTheme } from '@vue/lib/theme';
import { Icon, type IconName } from '../icons';
import { clampHostIntoView } from './geometry';
import { usePanelDrag } from './usePanelDrag';
import SettingsDialog from './SettingsDialog.vue';
import PhrasesSheet from './PhrasesSheet.vue';
import LogDialog from './LogDialog.vue';
import ChangelogDialog from './ChangelogDialog.vue';
import SniffDialog from '@vue/sniff/SniffDialog.vue';
import ChatWindow from '@vue/transfer/ChatWindow.vue';

/**
 * 主面板。迁移到 daisyUI 后：
 *   Button → `btn`（尺寸用响应式链 `btn-sm`）；Switch → `toggle`；Tooltip → `tooltip` + `data-tip`；
 *   语义色一律换成 daisyUI 的 `base-*` / `primary` / `accent` / `error` / `success`。
 * 自定义阴影与圆角已移除（daisyUI 主题 depth=0、radius 由主题给）。
 */
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
/** 日志条目：logger 通过 sink 推进来（sink 是 React setState 风格的 updater） */
const logEntries = ref<LogEntry[]>([]);

/** 常用语（v26.10.18-v2：数据源 = 本页右侧栏「常用话术」的程序化抓取） */
const phrasesData = ref<ZnhdPhrases>({ all: [], mine: [] });
const phrasesLoading = ref(false);
const searchKeyword = ref('');
/** 请求序号：只有最新一次请求能落地，防慢的旧响应后到覆盖新数据 */
let phrasesRequestSeq = 0;

const VERSION = GM_info.script.version;

/** 收到手机内容时自动弹窗的取消订阅（卸载时摘掉） */
let offAutoOpen: (() => void) | null = null;

/** 主题切换：daisyUI 官方主题 wireframe（日）/ business（夜），持久化在 scriptCat_VueTheme */
const isDark = computed(() => themeMode.value === 'dark');
function onToggleTheme() {
    const next = toggleTheme();
    addLog('主题已切换为' + (next === 'dark' ? '夜间模式（business）' : '日间模式（wireframe）'), 'info');
}

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

/**
 * 常用语加载（移植自 React 版 `MainPanel.loadPhrasesData`，逻辑逐行对齐）：
 *  · 缓存**无 TTL**：有缓存就直接用（话术由坐席在页面里维护，改动频率低）；
 *  · 无缓存 / 手动刷新（force）才走程序化抓取；
 *  · 失败时保留上次内容，并把失败原因直接进 toast（否则看不出卡在哪一步）。
 */
function loadPhrasesData(force = false) {
    if (!force) {
        const cache = loadPhrasesCache();
        if (cache && cache.data) {
            phrasesData.value = cache.data;
            const mins = Math.round((Date.now() - cache.time) / 60000);
            addLog('常用语使用本地缓存（' + mins + ' 分钟前抓取），如需更新请点侧边栏刷新按钮', 'info');
            return;
        }
    }
    const seq = ++phrasesRequestSeq;
    phrasesLoading.value = true;
    readPhrasesFromZnhd()
        .then((data) => {
            if (seq !== phrasesRequestSeq) return;
            phrasesData.value = data;
            savePhrasesCache(data);
            const total = data.all.length + data.mine.length;
            addLog(
                '常用语抓取成功：全部话术 ' + data.all.length + ' 条、我的话术 ' + data.mine.length + ' 条',
                'success'
            );
            toast.success('常用语抓取成功（共 ' + total + ' 条）');
        })
        .catch((error: { message?: string }) => {
            if (seq !== phrasesRequestSeq) return;
            const hasOld = phrasesData.value.all.length + phrasesData.value.mine.length > 0;
            const reason = error?.message || '未知错误';
            addLog('常用语抓取失败: ' + reason + (hasOld ? '，仍显示上次内容' : ''), 'error', true);
            toast.error('常用语抓取失败：' + reason + (hasOld ? '，仍显示上次内容' : ''));
        })
        .finally(() => {
            if (seq === phrasesRequestSeq) phrasesLoading.value = false;
        });
}

// 打开常用语侧边栏即自动加载（与 React 版的 useEffect([phrasesOpen]) 等价）
watch(phrasesOpen, (open) => {
    if (open) loadPhrasesData();
});

// 悬浮球贴边后展开：按面板真实宽度裁回视口（只在「收起 → 展开」这一跳做）
watch(collapsed, (now, prev) => {
    if (prev && !now) clampHostIntoView(props.host);
});

onMounted(() => {
    setLogEntriesSink((updater) => (logEntries.value = updater(logEntries.value)));
    setMonitorStateSink((s) => (mon.value = s));
    mon.value = getMonitorState();

    // 传输助手：收件 / 在线状态必须在窗口不开时也照常工作（store 是模块级的），
    // 这里只负责「启动」与「收到内容时自动弹窗」（幂等，与 React 版行为一致）
    initTransfer();
    offAutoOpen = onTransferAutoOpen(() => (transferOpen.value = true));

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
    offAutoOpen?.();
    offAutoOpen = null;
    stopTransfer();
});
</script>

<template>
    <!-- 收起态：圆形悬浮球（可拖动，拖过就不再展开） -->
    <button
        v-if="collapsed"
        type="button"
        title="拖动可移动位置，点击展开面板"
        class="btn btn-ghost btn-circle size-9 cursor-move touch-none select-none overflow-hidden p-0"
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
            class="block size-5 rounded"
            @error="brandFailed = true" />
        <Icon v-else name="crosshair" :size="20" />
    </button>

    <div v-else class="rounded-2xl border border-base-300 bg-base-100 text-base-content" :style="{ width: PANEL_WIDTH + 'px' }">
        <!-- 标题栏 = 唯一拖拽手柄 -->
        <div
            class="flex min-h-[46px] cursor-move touch-none select-none items-center gap-1.5 border-b border-base-300 px-2.5 py-2"
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
                class="block size-[26px] shrink-0 rounded-md"
                @error="brandFailed = true" />
            <span v-else class="flex size-[26px] shrink-0 items-center justify-center rounded-md bg-primary text-primary-content">
                <Icon name="crosshair" :size="16" />
            </span>
            <span class="min-w-0 truncate text-[15px] font-bold leading-6">征纳互动监控</span>
            <span class="shrink-0 rounded-lg bg-accent px-2 py-px text-[11px] font-normal leading-5 text-accent-content">
                v{{ VERSION }}
            </span>

            <!-- 主题切换：wireframe ↔ business（daisyUI 官方 swap 组件，sun/moon 图标） -->
            <div class="tooltip tooltip-bottom ml-auto" :data-tip="isDark ? '切换到日间模式（wireframe）' : '切换到夜间模式（business）'">
                <label class="swap swap-rotate">
                    <!-- this hidden checkbox controls the state -->
                    <!-- ⚠️ daisyUI theme-controller 的 :root:has() 选择器无法穿透 shadow DOM 边界，
                         主题状态必须由 theme.ts 驱动（checked 只负责 swap 的视觉翻转） -->
                    <input
                        type="checkbox"
                        class="theme-controller"
                        value="business"
                        :checked="isDark"
                        :aria-label="isDark ? '切换到日间模式' : '切换到夜间模式'"
                        @change="onToggleTheme" />
                    <!-- sun icon -->
                    <svg
                        class="swap-off h-5 w-5"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round">
                        <circle cx="12" cy="12" r="5" />
                        <path
                            d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
                    </svg>
                    <!-- moon icon -->
                    <svg
                        class="swap-on h-5 w-5"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                    </svg>
                </label>
            </div>
            <button
                class="btn btn-ghost btn-sm btn-circle text-base-content/60"
                title="收起面板（点圆形按钮可展开）"
                aria-label="收起面板"
                @click="collapsed = true">
                <Icon name="close" :size="16" />
            </button>
        </div>

        <div class="p-3">
            <!-- 人数 / 工作时段（单行 + 在线指示灯） -->
            <div
                class="mb-2.5 flex items-center rounded-box bg-base-200 px-3 py-2 text-[13px]"
                :class="mon.inWorkingHours ? 'text-base-content' : 'text-base-content/60'">
                <span class="mr-1.5 inline-block size-1.5 rounded-full" :class="mon.online ? 'bg-success' : 'bg-error'" />
                {{ statusText }}
            </div>

            <!-- 语音播报开关 -->
            <div class="mb-2.5 flex items-center justify-between rounded-box bg-base-200 px-3 py-2">
                <span class="flex items-center gap-1.5 text-[13px]">
                    <span :class="voiceEnabled ? 'text-primary znhd-brand-fg' : 'text-base-content/60'">
                        <Icon :name="voiceEnabled ? 'volumeOn' : 'volumeOff'" :size="15" />
                    </span>
                    语音播报
                </span>
                <input
                    type="checkbox"
                    class="toggle"
                    :checked="voiceEnabled"
                    @change="toggleVoice(($event.target as HTMLInputElement).checked)" />
            </div>

            <!-- 4 个入口：btn + 容器查询控制文字显隐 -->
            <div class="grid grid-cols-4 gap-1.5">
                <div v-for="a in PANEL_ACTIONS" :key="a.key" class="tooltip tooltip-top" :data-tip="a.label">
                    <!-- ghost：无描边无底色，hover 出现圆形底（btn-circle 决定遮罩形状） -->
                    <button class="btn btn-ghost btn-sm w-full znhd-panel-btn min-w-0 gap-0.5 px-1" @click="openEntry(a.key)">
                        <!-- znhd-brand-fg：日间模式图标 = 品牌蓝（style.css 按 data-theme 作用域），夜间回落官方 primary -->
                        <span class="text-primary znhd-brand-fg"><Icon :name="a.icon" :size="15" /></span>
                        <span class="znhd-panel-btn-text ml-0.5 text-[11px]">{{ a.label }}</span>
                    </button>
                </div>
            </div>

            <!-- 底部：上次播报 + 查看日志 -->
            <div class="mt-2.5 flex items-center justify-between gap-2 text-xs text-base-content/60">
                <span class="truncate">{{ lastSpeakText(mon.lastSpeak) }}</span>
                <button class="btn btn-link btn-sm shrink-0 px-0 text-xs" @click="logOpen = true">查看日志 →</button>
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

        <PhrasesSheet
            v-model:open="phrasesOpen"
            v-model:search-keyword="searchKeyword"
            :phrases-data="phrasesData"
            :phrases-loading="phrasesLoading"
            @reload="loadPhrasesData" />

        <LogDialog
            v-model:open="logOpen"
            :log-entries="logEntries"
            :auto-refresh="!!allvalue.logAutoRefresh"
            @clear="clearLogs"
            @update:auto-refresh="(v) => patchAllvalue({ logAutoRefresh: v })" />

        <ChangelogDialog v-model:open="changelogOpen" />

        <ChatWindow v-model:open="transferOpen" />
        <SniffDialog
            v-model:open="sniffOpen"
            :min-kb="allvalue.sniffMinKB ?? 20"
            @update:min-kb="
                (kb: number) => {
                    patchAllvalue({ sniffMinKB: kb });
                    addLog('图片嗅探：只列出 ≥ ' + kb + ' KB 的图片', 'info');
                }
            " />
    </div>
</template>
