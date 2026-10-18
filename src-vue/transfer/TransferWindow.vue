<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { Icon } from '@vue/icons';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';
import { addLog } from '@/lib/logger';
import {
    PHONE_SESSION_KEY,
    PHONE_SESSION_LABEL,
    clearTransferSession,
    markSessionRead,
    sessionKeyOf,
    setActiveSession,
    setTransferWindowOpen,
} from '@/lib/transfer/store';
import type { DeviceSession, TransferMessage } from '@/lib/transfer/types';
import { resolveDeviceColors, shortPhoneId } from '@/lib/ui/transfer/deviceColors';
import { RADIUS, WECHAT } from '@/lib/ui/transfer/wechatTheme';
import { useTransferStore } from '@vue/composables/useTransferStore';
import NavRail from './NavRail.vue';
import SessionList from './SessionList.vue';
import DeviceChat from './DeviceChat.vue';
import FilesView from './FilesView.vue';
import PairPanel from './PairPanel.vue';
import PairDialog from './PairDialog.vue';
import SettingsDialog from './SettingsDialog.vue';
import AboutDialog from './AboutDialog.vue';
import { TRANSFER_VARS, Z } from './theme';
import type { DeviceEntry, TransferNav } from './types';

/**
 * 传输助手主窗口（v26.10.18-v5，React 版 `TransferAssistantModal` 的等价实现）。
 *
 * 布局照搬微信桌面版（与 React 版逐层一致）：
 *   标题条（#2E2E2E，右侧自绘关闭按钮，悬浮变红）
 *   第一栏（窄图标栏 #2E2E2E，贴满高度）
 *   内容面板 = 第二栏（会话列表 #252525）+ 第三栏（聊天 #1E1E1E）的内嵌圆角卡片，
 *   右/下缘留 10/8px 露出窗口底色（与第一栏同色，避免色差断层）。
 */
const open = defineModel<boolean>('open', { default: false });
const shadowRoot = inject(SHADOW_ROOT_KEY);

const store = useTransferStore();

const nav = ref<TransferNav>('devices');
const search = ref('');
/** 文件视图的会话筛选（'' = 全部文件），与 activeSessionKey 分开：点会话不该触发已读 */
const filesFilterKey = ref('');
const pairOpen = ref(false);
const settingsOpen = ref(false);
const aboutOpen = ref(false);

// 窗口开合 → 通知 store（决定未读累计与自动弹窗）
watch(open, (v) => setTransferWindowOpen(v), { immediate: true });
onBeforeUnmount(() => setTransferWindowOpen(false));

// 自动弹窗打开时，若 store 已把选中切到新消息所在会话，右侧跟着切回「对话」
// （只认「关 → 开」这一个跳变：窗口开着时用户手动切视图不被抢）
let prevOpen = false;
watch(
    [open, () => store.value.activeSessionKey] as const,
    ([isOpen, key]) => {
        if (isOpen && !prevOpen && key) nav.value = 'devices';
        prevOpen = isOpen;
    },
    { immediate: true }
);

// 选中/切换会话即已读
watch(
    [open, () => store.value.activeSessionKey] as const,
    ([isOpen, key]) => {
        if (isOpen && key) markSessionRead(key);
    },
    { immediate: true }
);

/** 设备 ID → 色板下标（列表、聊天头、配对窗共用同一套） */
const deviceColors = computed(() => resolveDeviceColors(store.value.phones.map((p) => p.id)));

/** 第二栏条目：在线手机（无消息也出现，便于直接发起）∪ 有消息的会话 */
const deviceEntries = computed<DeviceEntry[]>(() => {
    const map = new Map<string, DeviceEntry>();
    store.value.phones.forEach((p) => {
        const key = sessionKeyOf(p.id);
        map.set(key, {
            key,
            label: key === PHONE_SESSION_KEY ? PHONE_SESSION_LABEL : shortPhoneId(p.id),
            isAggregate: key === PHONE_SESSION_KEY,
            online: true,
            unread: 0,
            lastTs: 0,
            hasMessages: false,
        });
    });
    store.value.sessions.forEach((sess) => {
        const prev = map.get(sess.key);
        const lastMsg = sess.messages.length ? sess.messages[sess.messages.length - 1] : undefined;
        map.set(sess.key, {
            key: sess.key,
            label: prev && !prev.isAggregate ? prev.label : sess.key === PHONE_SESSION_KEY ? PHONE_SESSION_LABEL : shortPhoneId(sess.key),
            isAggregate: sess.key === PHONE_SESSION_KEY,
            online: prev ? prev.online : false,
            unread: (prev ? prev.unread : 0) + sess.unread,
            lastTs: sess.lastTs,
            lastMsg,
            hasMessages: sess.messages.length > 0,
        });
    });
    // 有消息的（按最后消息时间）排在前，纯在线设备随后
    return Array.from(map.values()).sort((a, b) => b.lastTs - a.lastTs);
});

const unreadTotal = computed(() => store.value.sessions.reduce((n, x) => n + x.unread, 0));

const allMessages = computed<TransferMessage[]>(() =>
    store.value.sessions.reduce<TransferMessage[]>((acc, x) => acc.concat(x.messages), [])
);

const filesMessages = computed(() =>
    filesFilterKey.value ? allMessages.value.filter((m) => m.sessionKey === filesFilterKey.value) : allMessages.value
);

const filesScopeLabel = computed(() => {
    if (!filesFilterKey.value) return '全部文件';
    const found = deviceEntries.value.find((e) => e.key === filesFilterKey.value);
    return (found?.label || shortPhoneId(filesFilterKey.value)) + '的文件';
});

/**
 * 当前会话；选中一台**在线但无历史**的手机时合成一条空会话，
 * 让用户能直接发起发送（发送侧只要求对方在线）。
 */
const activeSession = computed<DeviceSession | undefined>(() => {
    const key = store.value.activeSessionKey;
    const found = store.value.sessions.find((x) => x.key === key);
    if (found) return found;
    if (!key) return undefined;
    const known =
        key === PHONE_SESSION_KEY
            ? store.value.phones.length > 0
            : store.value.phones.some((p) => sessionKeyOf(p.id) === key);
    return known ? { key, messages: [], unread: 0, lastTs: 0 } : undefined;
});

const activePhone = computed(() =>
    activeSession.value ? store.value.phones.find((p) => sessionKeyOf(p.id) === activeSession.value!.key) : undefined
);

function onSelectSession(key: string) {
    nav.value = 'devices';
    setActiveSession(key);
}

/** 离开文件分组就还原成「全部文件」（筛选是文件视图的临时状态） */
function onNav(next: TransferNav) {
    nav.value = next;
    if (next !== 'files') filesFilterKey.value = '';
}

function onClearSession(key: string) {
    clearTransferSession(key);
    addLog('[传输助手] 已清空会话消息', 'success');
}
</script>

<template>
    <DialogRoot v-model:open="open">
        <DialogPortal :to="shadowRoot as unknown as HTMLElement">
            <DialogOverlay class="fixed inset-0 bg-black/45" :style="{ zIndex: Z.windowMask }" />
            <DialogContent
                class="fixed left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden text-left outline-none"
                :style="[
                    TRANSFER_VARS,
                    {
                        zIndex: Z.window,
                        width: 'min(1166px, 96vw)',
                        height: 'min(756px, calc(100vh - 96px))',
                        borderRadius: RADIUS.window + 'px',
                        background: WECHAT.rail,
                        boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
                    },
                ]">
                <DialogTitle class="sr-only">传输助手</DialogTitle>
                <DialogDescription class="sr-only">电脑与手机之间的图片、文件与文本传输</DialogDescription>

                <!-- 标题条：右侧自绘关闭按钮（悬浮变红，微信/Windows 同款） -->
                <div class="flex shrink-0 items-center" :style="{ height: '40px', background: WECHAT.rail }">
                    <span class="flex-1" />
                    <button
                        type="button"
                        aria-label="关闭"
                        title="关闭"
                        class="znhd-transfer-close inline-flex h-10 w-11 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-white/65 outline-none hover:bg-[#E81123] hover:text-white"
                        @click="open = false">
                        <Icon name="close" :size="15" />
                    </button>
                </div>

                <!-- 三栏 -->
                <div class="flex min-h-0 flex-1 flex-row">
                    <NavRail
                        :nav="nav"
                        :unread-total="unreadTotal"
                        @nav="onNav"
                        @settings="settingsOpen = true"
                        @about="aboutOpen = true" />

                    <!-- 内容面板：第二三栏的内嵌圆角卡片（右/下露窗口底色形成层级） -->
                    <div
                        class="znhd-transfer-content flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
                        :style="{
                            marginRight: '10px',
                            marginBottom: '8px',
                            borderRadius: RADIUS.panel + 'px',
                            border: '1px solid rgba(255,255,255,0.06)',
                            background: WECHAT.list,
                        }">
                        <SessionList
                            :nav="nav"
                            :search="search"
                            :device-entries="deviceEntries"
                            :active-session-key="store.activeSessionKey"
                            :files-active-key="filesFilterKey"
                            @update:search="(v) => (search = v)"
                            @pair="pairOpen = true"
                            @select="onSelectSession"
                            @select-files-session="(k) => (filesFilterKey = k)" />

                        <!-- 第三栏 -->
                        <div class="znhd-transfer-main flex min-w-0 flex-1 flex-col" :style="{ background: WECHAT.chat }">
                            <FilesView
                                v-if="nav === 'files'"
                                :messages="filesMessages"
                                :scope-label="filesScopeLabel"
                                :clear-scope="filesFilterKey ? () => onClearSession(filesFilterKey) : undefined" />
                            <DeviceChat
                                v-else-if="activeSession"
                                :key="activeSession.key"
                                :session="activeSession"
                                :phone="activePhone"
                                :color-index="activePhone ? deviceColors[activePhone.id] : undefined"
                                @clear="onClearSession(activeSession.key)" />
                            <!-- 未选中会话：第三栏直接展示配对信息（不再显示「请选择会话」） -->
                            <div v-else class="znhd-transfer-empty znhd-transfer-pair flex min-h-0 flex-1 flex-col items-start justify-start overflow-auto">
                                <PairPanel :relay-server="store.settings.relayServer" :phones="store.phones" />
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 子窗口 -->
                <PairDialog v-model:open="pairOpen" :relay-server="store.settings.relayServer" :phones="store.phones" />
                <SettingsDialog v-model:open="settingsOpen" />
                <AboutDialog v-model:open="aboutOpen" />
            </DialogContent>
        </DialogPortal>
    </DialogRoot>
</template>
