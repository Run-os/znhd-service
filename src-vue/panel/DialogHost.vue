<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { addLog, clearLogs, setLogEntriesSink, type LogEntry } from '@/lib/logger';
import { resetWaitCountBaseline } from '@/lib/monitor';
import { clearSpeechQueue } from '@/lib/speech';
import { initTransfer, onTransferAutoOpen, stopTransfer } from '@/lib/transfer/store';
import { runtime } from '@/lib/state';
import { loadPhrasesCache, savePhrasesCache, saveAllvalue, type Allvalue } from '@/lib/storage';
import { readPhrasesFromZnhd, type ZnhdPhrases } from '@/lib/phrasesZnhd';
import { hoursToHHmm } from '@/lib/utils';
import { toast } from '@vue/lib/toast';
import { dialogOpen, voiceEnabled as busVoiceEnabled, voiceToggler as busVoiceToggler } from '@vue/lib/uiBus';
import SettingsDialog from './SettingsDialog.vue';
import PhrasesSheet from './PhrasesSheet.vue';
import LogDialog from './LogDialog.vue';
import ChangelogDialog from './ChangelogDialog.vue';
import SniffDialog from '@vue/sniff/SniffDialog.vue';
import ChatWindow from '@vue/transfer/ChatWindow.vue';

/**
 * 弹窗宿主（v26.10.21-v5：主面板已整体删除）。
 *
 * 可见 UI 全部在站点导航条（panel/NavBarControls）上；本组件不可见，只负责：
 *   · 挂全部弹窗（设置/常用语/日志/更新日志/传输助手/图片嗅探），开关绑 uiBus.dialogOpen；
 *   · allvalue 配置的唯一读写点（语音开关经总线与导航条接力，见 toggleVoice 下方）；
 *   · 常用语数据抓取与缓存；
 *   · 传输助手后台收件的启动与「收到内容自动弹窗」。
 * 「查看日志」入口在设置弹窗里（@open-log）。
 */
const busDialogOpen = dialogOpen;

const allvalue = ref<Allvalue>(runtime.init);
const voiceEnabled = computed(() => !!allvalue.value.voiceEnabled);

const logOpen = ref(false);
const changelogOpen = ref(false);

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

// 标题栏注入控件（NavBarControls，独立 Vue 实例）与本宿主的双向接力：
//   状态：allvalue → voiceEnabled(computed) → 总线（单向投影，这里是唯一事实源）；
//   事件：标题栏点开关 → 总线回调 → toggleVoice 落库（持久化逻辑只有这一份）。
watch(voiceEnabled, (v) => (busVoiceEnabled.value = v), { immediate: true });
busVoiceToggler.value = toggleVoice;

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
watch(
    () => busDialogOpen.phrases,
    (open) => {
        if (open) loadPhrasesData();
    }
);

onMounted(() => {
    setLogEntriesSink((updater) => (logEntries.value = updater(logEntries.value)));

    // 传输助手：收件 / 在线状态必须在窗口不开时也照常工作（store 是模块级的），
    // 这里只负责「启动」与「收到内容时自动弹窗」（幂等，与 React 版行为一致）
    initTransfer();
    offAutoOpen = onTransferAutoOpen(() => (busDialogOpen.transfer = true));

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
    offAutoOpen?.();
    offAutoOpen = null;
    stopTransfer();
});
</script>

<template>
    <!-- 不可见宿主：只有弹窗（daisyUI modal = 原生 dialog，top layer），无常态 UI -->
    <SettingsDialog
        v-model:open="busDialogOpen.settings"
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
        @open-log="logOpen = true"
        @open-changelog="changelogOpen = true" />

    <PhrasesSheet
        v-model:open="busDialogOpen.phrases"
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

    <ChatWindow v-model:open="busDialogOpen.transfer" />
    <SniffDialog
        v-model:open="busDialogOpen.sniff"
        :min-kb="allvalue.sniffMinKB ?? 20"
        @update:min-kb="
            (kb: number) => {
                patchAllvalue({ sniffMinKB: kb });
                addLog('图片嗅探：只列出 ≥ ' + kb + ' KB 的图片', 'info');
            }
        " />
</template>
