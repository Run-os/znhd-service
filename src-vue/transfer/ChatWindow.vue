<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch, type ComponentPublicInstance } from 'vue';
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { Icon, type IconName } from '@vue/icons';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';
import { Button } from '@vue/components/ui/button';
import {
    Card,
    CardAction,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@vue/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@vue/components/ui/dropdown-menu';
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from '@vue/components/ui/message-scroller';
import Tooltip from '@vue/components/ui/tooltip/Tooltip.vue';
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
import { TRANSFER_VARS, Z } from './theme';

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
const shadowRoot = inject(SHADOW_ROOT_KEY);

const store = useTransferStore();

const filesOpen = ref(false);
const pairOpen = ref(false);
const settingsOpen = ref(false);
const aboutOpen = ref(false);

const sendText = ref('');
const imgCopy = ref<{ id: string; state: 'busy' | 'ok' | 'fail' } | null>(null);

const previewOpen = ref(false);
const previewIndex = ref(0);
/** Card 是组件，ref 拿到的是实例；滚动要用它内部的 DOM（`$el`） */
const cardRef = ref<ComponentPublicInstance | null>(null);

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

/** 我们自己发出的消息要立刻见底（用户可能先往上翻了历史） */
function scrollToEnd() {
    const root = cardRef.value?.$el as HTMLElement | undefined;
    const el = root?.querySelector('[data-slot=message-scroller-viewport]') as HTMLElement | null;
    if (el) el.scrollTop = el.scrollHeight;
}

function doSendText() {
    const t = sendText.value.trim();
    if (!t || !sendable.value) return;
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

/** 卡片下方那行提示（v26.10.19-v4：在线时不再显示「Enter 发送 · Shift + Enter 换行」，只留离线警示） */
const footerHint = computed(() => (sendable.value ? '' : '当前没有在线手机，连上后才能发送'));
</script>

<template>
    <DialogRoot v-model:open="open">
        <DialogPortal :to="shadowRoot as unknown as HTMLElement">
            <DialogOverlay class="fixed inset-0 bg-black/45" :style="{ zIndex: Z.windowMask }" />
            <DialogContent
                class="fixed left-1/2 top-1/2 w-auto max-w-none -translate-x-1/2 -translate-y-1/2 border-0 bg-transparent p-0 shadow-none outline-none"
                :style="[TRANSFER_VARS, { zIndex: Z.window }]">
                <DialogTitle class="sr-only">传输助手</DialogTitle>
                <DialogDescription class="sr-only">电脑与手机之间的图片、文件与文本传输</DialogDescription>

                <MessageScrollerProvider auto-scroll default-scroll-position="end">
                    <!-- v26.10.19：横向放大一倍（384 → 768），高度 +20%（560 → 672） -->
                    <div class="relative flex w-[768px] max-w-[94vw] flex-col gap-4">
                        <!-- v26.10.18-v9：窗口底色纯黑 + 外圈 rgb(34,34,34) 细边（Card 自带 ring-1，只换色） -->
                        <Card
                            ref="cardRef"
                            class="h-168 max-h-[calc(100vh-96px)] w-full gap-0 shadow-lg !bg-black !ring-[rgb(34,34,34)]">
                            <!--
                                ===== 头部：标题 / 状态 / 动作（示例同款三段） =====
                                v26.10.19：头部与会话区之间只留 1px 细线，颜色跟窗口外框一致
                                （Tailwind v4 的 border 默认色是 currentColor ⇒ 不写死就是一条亮白线）。
                            -->
                            <!-- v26.10.19-v3：items-center + CardAction self-center——标题行（文字 20px）与
                                 28px 圆形按钮在 grid 默认顶对齐下中心线错开 4px，改为行内垂直居中 -->
                            <CardHeader class="shrink-0 items-center gap-1 [border-bottom:1px_solid_rgb(34,34,34)]">
                                <!-- v26.10.19：设备连接数跟标题同一行（原来的 CardDescription 已移除） -->
                                <div class="flex min-w-0 items-center gap-2">
                                    <CardTitle class="truncate">传输助手</CardTitle>
                                    <span class="shrink-0 text-xs text-muted-foreground">{{ headerText }}</span>
                                </div>
                                <!-- v26.10.19：标题栏按钮改圆形，尺寸与输入框按钮一致（28px） -->
                                <CardAction class="flex items-center gap-1.5 self-center">
                                    <Tooltip content="清空聊天记录" side="bottom">
                                        <Button
                                            variant="outline"
                                            size="icon-sm"
                                            class="!size-7 !rounded-full"
                                            aria-label="清空聊天记录"
                                            :disabled="!rows.length"
                                            @click="clearAll">
                                            <Icon name="rotateCw" :size="14" />
                                        </Button>
                                    </Tooltip>

                                    <DropdownMenu>
                                        <DropdownMenuTrigger as-child>
                                            <Button
                                                variant="outline"
                                                size="icon-sm"
                                                class="!size-7 !rounded-full"
                                                aria-label="更多"
                                                title="更多">
                                                <Icon name="more" :size="14" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" side="bottom" class="w-44">
                                            <DropdownMenuItem @select="filesOpen = true">
                                                <Icon name="files" :size="15" />
                                                全部文件
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @select="pairOpen = true">
                                                <Icon name="qr" :size="15" />
                                                扫码连接手机
                                            </DropdownMenuItem>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem @select="settingsOpen = true">
                                                <Icon name="settings" :size="15" />
                                                设置
                                            </DropdownMenuItem>
                                            <DropdownMenuItem @select="aboutOpen = true">
                                                <Icon name="info" :size="15" />
                                                关于
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>

                                    <DialogClose as-child>
                                        <Button
                                            variant="outline"
                                            size="icon-sm"
                                            class="!size-7 !rounded-full"
                                            aria-label="关闭"
                                            title="关闭">
                                            <Icon name="close" :size="14" />
                                        </Button>
                                    </DialogClose>
                                </CardAction>
                            </CardHeader>

                            <!-- ===== 消息区：单条时间线（v26.10.19：去掉「还没有消息」空态） ===== -->
                            <CardContent class="min-h-0 flex-1 overflow-hidden !bg-black p-0">
                                <MessageScroller>
                                    <MessageScrollerViewport>
                                        <MessageScrollerContent class="p-6">
                                            <MessageScrollerItem
                                                v-for="turn in turns"
                                                :key="turn.key"
                                                :message-id="turn.key"
                                                :scroll-anchor="turn.mine">
                                                <ChatTurn
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
                                                            row.msg.blob
                                                                ? Math.max(1, Math.round(row.msg.blob.size / 1024)) + ' KB'
                                                                : ''
                                                        "
                                                        :image-src="row.msg.previewUrl || ''"
                                                        :meta="metaOf(row.msg).text"
                                                        :meta-danger="metaOf(row.msg).danger"
                                                        :progress="
                                                            row.msg.sendState === 'sending' ? (row.msg.sendProgress ?? null) : null
                                                        "
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
                                                                          onClick: () =>
                                                                              removeTransferMessage(row.msg.sessionKey, row.msg.id),
                                                                      },
                                                                  ]
                                                                : []
                                                        "
                                                        @preview="openPreview(row.msg)"
                                                        @download="
                                                            row.msg.type === 'file'
                                                                ? doDownloadFile(row.msg)
                                                                : doDownload(row.msg, row.imageIndex)
                                                        " />
                                                </ChatTurn>
                                            </MessageScrollerItem>
                                        </MessageScrollerContent>
                                    </MessageScrollerViewport>
                                    <!-- 向下箭头：同样改圆形 + 28px，与标题栏 / 输入框按钮一致 -->
                                    <MessageScrollerButton class="!size-7 !rounded-full [&_svg]:size-3.5" />
                                </MessageScroller>
                            </CardContent>

                            <!-- ===== 输入区：示例同款 InputGroup（文本域 + block-end 附件/发送） ===== -->
                            <CardFooter class="shrink-0 flex-col gap-2">
                                <form class="w-full" @submit.prevent="doSendText">
                                    <ChatComposer
                                        v-model="sendText"
                                        :disabled="!sendable"
                                        placeholder="输入要发送到手机的文本…"
                                        :attach="attachActions"
                                        @send="doSendText" />
                                </form>
                            </CardFooter>
                        </Card>

                        <!-- 示例里卡片下面那行居中提示（v26.10.19-v4：在线时整行不渲染，不留死内边距） -->
                        <div v-if="footerHint" class="px-0.5 text-center text-xs text-muted-foreground">
                            {{ footerHint }}
                        </div>
                    </div>
                </MessageScrollerProvider>

                <!-- 子窗口 -->
                <DarkDialog v-model:open="filesOpen" title="文件" :width="780" description="本次会话的全部图片 / 文件 / 文本">
                    <FilesView :messages="messages" scope-label="全部文件" :clear-scope="clearAll" />
                </DarkDialog>
                <PairDialog v-model:open="pairOpen" :relay-server="store.settings.relayServer" :phones="store.phones" />
                <SettingsDialog v-model:open="settingsOpen" />
                <AboutDialog v-model:open="aboutOpen" />
            </DialogContent>
        </DialogPortal>
    </DialogRoot>

    <ImagePreview v-model:open="previewOpen" :items="imageUrls" :index="previewIndex" :names="imageNames" />
</template>
