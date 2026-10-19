<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Icon, type IconName } from '@vue/icons';
import { addLog } from '@/lib/logger';
import { downloadFileName } from '@/lib/gallery';
import { copyImageToClipboard } from '@/lib/relay';
import {
    PHONE_SESSION_KEY,
    clearTransferSession,
    markSessionRead,
    removeTransferMessage,
    sendFilesToSession,
    sendImagesToSession,
    sendTextToSession,
    sessionSendable,
    setActiveSession,
    setTransferWindowOpen,
} from '@/lib/transfer/store';
import type { TransferMessage } from '@/lib/transfer/types';
import { useTransferStore } from '@vue/composables/useTransferStore';
import ImagePreview from '@vue/components/media/ImagePreview.vue';
import ChatBubble from './ChatBubble.vue';
import ChatTurn from './ChatTurn.vue';
import ChatComposer from './ChatComposer.vue';
import FilesView from './FilesView.vue';
import DarkDialog from './DarkDialog.vue';
import PairDialog from './PairDialog.vue';
import SettingsDialog from './SettingsDialog.vue';
import AboutDialog from './AboutDialog.vue';
import { sepTimeText } from './format';
import { groupTurns } from './turns';

/**
 * 传输助手 —— chat 窗口（v26.10.18-v8）。
 *
 * 排版**直接照搬** shadcn-vue `message-scroller` 文档示例：
 *
 *   MessageScrollerProvider
 *     └─ Card（gap-0 / 圆角 / 阴影）
 *          ├─ CardHeader  标题 + 说明 + CardAction（清空 / 更多 / 关闭）
 *          ├─ CardContent Empty（空态）或 MessageScroller（Viewport + Content + Button）
 *          └─ CardFooter  ChatComposer（InputGroup：文本域 + block-end 附件与发送）
 *     └─ 卡片下方一行居中提示（对应示例里那句 "Demo is read only…"）
 *
 * 没有图标栏、没有会话列表、也不再区分多台手机：所有设备的消息合并成一条时间线，
 * 发送统一走聚合会话 `PHONE_SESSION_KEY`（它的 sendTargets 就是「广播给所有在线手机」）。
 *
 * 选图 / 选文件即发（不再有「待发送」暂存区）—— 选完立刻落成「发送中」气泡，
 * 进度画在气泡下方，失败也显示在气泡上，和示例「发出去就是一条消息」的心智一致。
 */
const open = defineModel<boolean>('open', { default: false });

const store = useTransferStore();

const filesOpen = ref(false);
const pairOpen = ref(false);
const settingsOpen = ref(false);
const aboutOpen = ref(false);

const sendText = ref('');
const imgCopy = ref<{ id: string; state: 'busy' | 'ok' | 'fail' } | null>(null);

const previewOpen = ref(false);
const previewIndex = ref(0);
/** 消息滚动容器（message-scroller 已按用户要求移除，改成普通 overflow 容器） */
const scroller = ref<HTMLElement | null>(null);
/** 原生 dialog（daisyUI modal） */
const dlg = ref<HTMLDialogElement | null>(null);

/** 两条消息间隔超过 5 分钟就插一条时间分隔条（微信同款，不逐条显示时间） */
const TIME_GAP = 5 * 60 * 1000;

/** 单会话：所有手机的消息按时间合并成一条流 */
const messages = computed<TransferMessage[]>(() =>
    store.value.sessions
        .reduce<TransferMessage[]>((acc, s) => acc.concat(s.messages), [])
        .sort((a, b) => a.ts - b.ts)
);

const sendable = computed(() => sessionSendable(PHONE_SESSION_KEY));
const onlineCount = computed(() => store.value.phones.length);
/** 有正在发的消息时禁掉附件按钮，避免叠着发 */
const sending = computed(() => messages.value.some((m) => m.sendState === 'sending'));

const imageMessages = computed(() => messages.value.filter((m) => m.type === 'image'));
const imageUrls = computed(() => imageMessages.value.map((m) => m.previewUrl as string));
const imageNames = computed(() => imageMessages.value.map((m, i) => downloadFileName(m.name, m.mime, i)));

/** 消息行：带时间分隔条与图片下标（下载文件名要用） */
const rows = computed(() =>
    messages.value.map((msg, i) => {
        const prev = i > 0 ? messages.value[i - 1] : undefined;
        return {
            msg,
            sepText: !prev || msg.ts - prev.ts > TIME_GAP ? sepTimeText(msg.ts) : '',
            imageIndex: msg.type === 'image' ? imageMessages.value.findIndex((m) => m.id === msg.id) : -1,
        };
    })
);

/** 轮次：同方向且间隔 ≤ 2 分钟的消息合并进一个 BubbleGroup（官方 Conversation 语义） */
const turns = computed(() =>
    groupTurns(rows.value, {
        keyOf: (row) => row.msg.id,
        mineOf: (row) => row.msg.direction === 'out',
        tsOf: (row) => row.msg.ts,
        sepOf: (row) => row.sepText,
    })
);

function metaOf(msg: TransferMessage): { text: string; danger: boolean } {
    if (msg.direction !== 'out') return { text: '', danger: false };
    if (msg.sendState === 'sending') {
        return {
            text: typeof msg.sendProgress === 'number' ? '发送中 ' + msg.sendProgress + '%' : '发送中…',
            danger: false,
        };
    }
    if (msg.sendState === 'queued') return { text: '已排队 · 等设备上线后发送', danger: false };
    if (msg.sendState === 'failed') return { text: '发送失败' + (msg.sendError ? '：' + msg.sendError : ''), danger: true };
    return { text: '已发送', danger: false };
}

watch(open, (v) => setTransferWindowOpen(v), { immediate: true });
onBeforeUnmount(() => setTransferWindowOpen(false));

/** 窗口打开即把全部会话标为已读（单时间线视图，没有「哪条未读」的概念了） */
watch(
    open,
    (v) => {
        if (!v) return;
        setActiveSession(PHONE_SESSION_KEY);
        store.value.sessions.forEach((s) => markSessionRead(s.key));
    },
    { immediate: true }
);

function syncDialog(v: boolean): void {
    const el = dlg.value;
    if (!el) return;
    if (v && !el.open) el.showModal();
    else if (!v && el.open) el.close();
}
watch(open, (v) => syncDialog(v));
onMounted(() => {
    if (open.value) syncDialog(true);
});

/**
 * 点下拉项后收起 focus 式 dropdown（官方 tabindex 方案不会自关，须让触发器失焦）。
 * 菜单项聚焦在 ul[tabindex="-1"] 上，blur 的是触发器 div[tabindex="0"]。
 */
function closeMenu(e: MouseEvent) {
    (e.currentTarget as HTMLElement).closest('.dropdown')?.querySelector<HTMLElement>('[role="button"]')?.blur();
}

/** 我们自己发出的消息要立刻见底（用户可能先往上翻了历史） */
function scrollToEnd() {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
}

function doSendText() {
    const t = sendText.value.trim();
    // v26.10.19-v8：去掉 sendable 拦截——离线时 store 会把消息标成「排队」等设备上线补发
    if (!t) return;
    if (sendTextToSession(PHONE_SESSION_KEY, t)) {
        sendText.value = '';
        scrollToEnd();
    }
}

/** 隐藏 input 选文件：取消选择也要移除节点（'cancel' 事件非标准，用 window focus 兜底） */
function pickFilesInto(accept: string, apply: (files: File[]) => void) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = true;
    inp.style.display = 'none';
    document.body.appendChild(inp);
    const cleanupFocus = () => {
        window.removeEventListener('focus', cleanupFocus);
        try {
            inp.remove();
        } catch (e) {
            /* 已移除 */
        }
    };
    inp.onchange = () => {
        const files = Array.prototype.slice.call(inp.files || []) as File[];
        window.removeEventListener('focus', cleanupFocus);
        inp.remove();
        if (files.length) apply(files);
    };
    window.addEventListener('focus', cleanupFocus);
    inp.click();
}

/** 选完即发：store 会先把它们落成「发送中」气泡，再逐张压缩/上传 */
function pickImages() {
    if (!sendable.value) {
        addLog('[传输助手] 当前无在线设备，无法发送', 'error', true);
        return;
    }
    pickFilesInto('image/*', (files) => {
        const list = files.map((f) => ({
            file: f,
            name: f.name || 'image.jpg',
            mime: f.type || 'image/jpeg',
            url: URL.createObjectURL(f),
        }));
        if (sendImagesToSession(PHONE_SESSION_KEY, list, () => undefined)) scrollToEnd();
    });
}

function pickFiles() {
    if (!sendable.value) {
        addLog('[传输助手] 当前无在线设备，无法发送', 'error', true);
        return;
    }
    pickFilesInto('', (files) => {
        const list = files.map((f) => ({
            file: f,
            name: f.name || 'file.bin',
            mime: f.type || 'application/octet-stream',
            url: URL.createObjectURL(f),
        }));
        if (sendFilesToSession(PHONE_SESSION_KEY, list, () => undefined)) scrollToEnd();
    });
}

function doCopy(msg: TransferMessage) {
    imgCopy.value = { id: msg.id, state: 'busy' };
    copyImageToClipboard(msg.blob).then((ok) => {
        imgCopy.value = { id: msg.id, state: ok ? 'ok' : 'fail' };
        if (ok) addLog('图片已复制到剪贴板: ' + (msg.name || ''), 'success');
        window.setTimeout(() => (imgCopy.value = null), 1500);
    });
}

function saveBlob(blob: Blob | undefined, name: string) {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function doDownload(msg: TransferMessage, idx: number) {
    const fname = downloadFileName(msg.name, msg.mime, idx);
    saveBlob(msg.blob, fname);
    addLog('图片已下载: ' + fname, 'success');
}

function doDownloadFile(msg: TransferMessage) {
    const fname = msg.name || 'file.bin';
    saveBlob(msg.blob, fname);
    addLog('文件已下载: ' + fname, 'success');
}

function openPreview(msg: TransferMessage) {
    const at = imageMessages.value.findIndex((m) => m.id === msg.id);
    previewIndex.value = at >= 0 ? at : 0;
    previewOpen.value = true;
}

/** 清空整个聊天（单时间线 = 清掉所有会话的消息） */
function clearAll() {
    store.value.sessions.forEach((s) => clearTransferSession(s.key));
    addLog('[传输助手] 已清空聊天记录', 'success');
}

/** 「+」下拉里的附件入口 */
const attachActions = computed<
    Array<{ key: string; label: string; icon: IconName; onClick: () => void; disabled: boolean }>
>(() => [
    {
        key: 'image',
        label: '图片',
        icon: 'image',
        onClick: pickImages,
        disabled: !sendable.value || sending.value,
    },
    {
        key: 'file',
        label: '文件',
        icon: 'paperclip',
        onClick: pickFiles,
        disabled: !sendable.value || sending.value,
    },
]);

/** 标题右侧的设备连接状态（v26.10.19：只保留连接数，不再重复说明能传什么） */
const headerText = computed(() => (onlineCount.value ? '已连接 ' + onlineCount.value + ' 台设备' : '未连接设备'));

/** 卡片下方那行提示（v26.10.19-v8：离线时说明「消息会排队等上线」，不再说「才能发送」） */
const footerHint = computed(() => (sendable.value ? '' : '当前没有在线手机，发出去的消息会在设备上线后自动送达'));
</script>
<template>
    <dialog ref="dlg" class="modal" @close="open = false">
        <div class="modal-box flex h-[672px] max-h-[calc(100vh-96px)] w-[768px] max-w-[94vw] flex-col gap-0 p-0">
            <!-- ===== 头部：标题 / 状态 / 动作 ===== -->
            <div class="flex shrink-0 items-center gap-1 border-b border-base-300 px-6 py-3">
                <div class="flex min-w-0 items-center gap-2">
                    <h3 class="truncate text-lg font-bold">传输助手</h3>
                    <span class="shrink-0 text-xs text-base-content/60">{{ headerText }}</span>
                </div>
                <div class="ml-auto flex items-center gap-1.5">
                    <div class="tooltip tooltip-bottom" data-tip="清空聊天记录">
                        <button
                            class="btn btn-outline btn-sm btn-circle"
                            aria-label="清空聊天记录"
                            :disabled="!rows.length"
                            @click="clearAll">
                            <Icon name="rotateCw" :size="14" />
                        </button>
                    </div>

                    <div class="tooltip tooltip-bottom" data-tip="全部文件">
                        <button
                            class="btn btn-outline btn-sm btn-circle"
                            aria-label="全部文件"
                            title="全部文件"
                            @click="filesOpen = true">
                            <Icon name="files" :size="14" />
                        </button>
                    </div>

                    <div class="tooltip tooltip-bottom" data-tip="扫码连接手机">
                        <button
                            class="btn btn-outline btn-sm btn-circle"
                            aria-label="扫码连接手机"
                            title="扫码连接手机"
                            @click="pairOpen = true">
                            <Icon name="qr" :size="14" />
                        </button>
                    </div>

                    <!-- 更多：daisyUI 官方 focus 式 dropdown（tabindex 触发，点外部 / Esc 失焦收起） -->
                    <div class="dropdown dropdown-end">
                        <div tabindex="0" role="button" class="btn btn-outline btn-sm btn-circle" aria-label="更多" title="更多">
                            <Icon name="more" :size="14" />
                        </div>
                        <ul tabindex="-1" class="menu dropdown-content z-1 w-52 rounded-box bg-base-100 p-2 shadow-sm">
                            <li>
                                <button @click="settingsOpen = true; closeMenu($event)">
                                    <Icon name="settings" :size="15" />
                                    设置
                                </button>
                            </li>
                            <li>
                                <button @click="aboutOpen = true; closeMenu($event)">
                                    <Icon name="info" :size="15" />
                                    关于
                                </button>
                            </li>
                        </ul>
                    </div>

                    <form method="dialog">
                        <button class="btn btn-outline btn-sm btn-circle" aria-label="关闭" title="关闭">
                            <Icon name="close" :size="14" />
                        </button>
                    </form>
                </div>
            </div>

            <!-- ===== 消息区：单条时间线（message-scroller 已移除，普通滚动容器） ===== -->
            <div ref="scroller" data-znhd="chat-scroller" class="min-h-0 flex-1 overflow-y-auto p-6">
                <ChatTurn
                    v-for="turn in turns"
                    :key="turn.key"
                    :mine="turn.mine"
                    :session-key="turn.items[0]?.msg.sessionKey || ''"
                    :time-label="turn.sepText"
                    :count="turn.items.length">
                    <ChatBubble
                        v-for="row in turn.items"
                        :key="row.msg.id"
                        grouped
                        :type="row.msg.type"
                        :mine="row.msg.direction === 'out'"
                        :text="row.msg.text || ''"
                        :name="row.msg.name || ''"
                        :mime="row.msg.mime || ''"
                        :size-text="
                            row.msg.blob ? Math.max(1, Math.round(row.msg.blob.size / 1024)) + ' KB' : ''
                        "
                        :image-src="row.msg.previewUrl || ''"
                        :meta="metaOf(row.msg).text"
                        :meta-danger="metaOf(row.msg).danger"
                        :progress="row.msg.sendState === 'sending' ? (row.msg.sendProgress ?? null) : null"
                        :error="row.msg.sendState === 'failed' ? row.msg.sendError || '' : ''"
                        :clickable="row.msg.type === 'image'"
                        :can-download="!!row.msg.blob"
                        :image-actions="
                            row.msg.type === 'image'
                                ? [
                                      {
                                          label: '复制',
                                          tooltip: '复制',
                                          icon:
                                              imgCopy && imgCopy.id === row.msg.id && imgCopy.state === 'ok'
                                                  ? 'check'
                                                  : 'copy',
                                          onClick: () => doCopy(row.msg),
                                      },
                                      {
                                          label: '下载',
                                          icon: 'download',
                                          onClick: () => doDownload(row.msg, row.imageIndex),
                                      },
                                      {
                                          label: '删除',
                                          icon: 'trash',
                                          danger: true,
                                          onClick: () => removeTransferMessage(row.msg.sessionKey, row.msg.id),
                                      },
                                  ]
                                : []
                        "
                        @preview="openPreview(row.msg)"
                        @download="
                            row.msg.type === 'file' ? doDownloadFile(row.msg) : doDownload(row.msg, row.imageIndex)
                        " />
                </ChatTurn>
            </div>

            <!-- ===== 输入区 ===== -->
            <div class="shrink-0 border-t border-base-300 px-6 py-3">
                <form @submit.prevent="doSendText">
                    <!-- v26.10.19-v8：离线也可输入发送（消息进队列等设备上线），不再禁用输入框 -->
                    <ChatComposer
                        v-model="sendText"
                        placeholder="输入要发送到手机的文本…"
                        :attach="attachActions"
                        @send="doSendText" />
                </form>
                <div v-if="footerHint" class="mt-2 text-center text-xs text-base-content/60">
                    {{ footerHint }}
                </div>
            </div>
        </div>

        <form method="dialog" class="modal-backdrop">
            <button>close</button>
        </form>
    </dialog>

    <!-- 子窗口 -->
    <DarkDialog v-model:open="filesOpen" title="文件" :width="780" description="本次会话的全部图片 / 文件 / 文本">
        <FilesView :messages="messages" scope-label="全部文件" :clear-scope="clearAll" />
    </DarkDialog>
    <PairDialog v-model:open="pairOpen" :relay-server="store.settings.relayServer" :phones="store.phones" />
    <SettingsDialog v-model:open="settingsOpen" />
    <AboutDialog v-model:open="aboutOpen" />

    <ImagePreview v-model:open="previewOpen" :items="imageUrls" :index="previewIndex" :names="imageNames" />
</template>
