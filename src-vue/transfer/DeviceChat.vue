<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Empty } from '@vue/components/ui/empty';
import { Icon, type IconName } from '@vue/icons';
import { addLog } from '@/lib/logger';
import { copyImageToClipboard } from '@/lib/relay';
import { downloadFileName } from '@/lib/gallery';
import {
    PHONE_SESSION_KEY,
    PHONE_SESSION_LABEL,
    removeTransferMessage,
    sendFilesToSession,
    sendImagesToSession,
    sendTextToSession,
    sessionSendable,
} from '@/lib/transfer/store';
import type { DeviceSession, PhoneInfo, TransferMessage } from '@/lib/transfer/types';
import { DEVICE_COLORS, hashDeviceId } from '@/lib/ui/transfer/deviceColors';
import ChatComposer from './ChatComposer.vue';
import ChatMessage from './ChatMessage.vue';
import DeviceIdTag from './DeviceIdTag.vue';
import ImagePreview from '@vue/components/media/ImagePreview.vue';
import { sepTimeText } from './format';
import type { PickedEmoji } from './types';

/**
 * 设备会话聊天区（v26.10.18-v5，React 版 `TransferDeviceChat` 的等价实现）。
 *
 * 排版全部交给官方 `Message` / `Bubble`（见 ChatMessage.vue），本组件只负责**数据与动作**：
 * 发送文本 / 图片 / 文件、发送表情、复制 / 下载 / 删除、时间分隔条、待发列表、进度。
 * 想改气泡外观请改 ChatMessage + theme.ts，不要在这里另写一套。
 */
const props = defineProps<{
    session: DeviceSession;
    phone?: PhoneInfo;
    colorIndex?: number;
}>();

const emit = defineEmits<{ (e: 'clear'): void }>();

/** 两条消息间隔超过 5 分钟就插一条时间分隔条（微信同款，不逐条显示时间） */
const TIME_GAP = 5 * 60 * 1000;

const sendText = ref('');
interface PendingImage {
    file: File;
    name: string;
    mime: string;
    url: string;
    emoji?: boolean;
}
const pendingImages = ref<PendingImage[]>([]);
const pendingFiles = ref<Array<{ file: File; name: string; mime: string; url: string }>>([]);
const sending = ref(false);
const progress = ref<{ done: number; total: number; failed: boolean; text: string } | null>(null);
const imgCopy = ref<{ id: string; state: 'busy' | 'ok' | 'fail' } | null>(null);

const previewOpen = ref(false);
const previewIndex = ref(0);
const confirmClear = ref(false);
const scrollEl = ref<HTMLElement | null>(null);

const sendable = computed(() => sessionSendable(props.session.key));
const isAggregate = computed(() => props.session.key === PHONE_SESSION_KEY);
const imageMessages = computed(() => props.session.messages.filter((m) => m.type === 'image'));
const imageUrls = computed(() => imageMessages.value.map((m) => m.previewUrl as string));
const imageNames = computed(() =>
    imageMessages.value.map((m, i) => downloadFileName(m.name, m.mime, i))
);

/** 输入区工具栏按钮（表情之后）——放在 script 里才能保住 `icon` 的字面量类型 */
const composerActions = computed<
    Array<{ key: string; label: string; tooltip: string; icon: IconName; onClick: () => void; disabled: boolean }>
>(() => [
    {
        key: 'image',
        label: '图片上传',
        tooltip: '选择图片发送到手机（发送前自动压缩）',
        icon: 'image',
        onClick: pickImages,
        disabled: !sendable.value || sending.value,
    },
    {
        key: 'file',
        label: '文件',
        tooltip: '选择任意文件发送到手机（不压缩，单次上限约 100MB）',
        icon: 'paperclip',
        onClick: pickFiles,
        disabled: !sendable.value || sending.value,
    },
]);

const palette = computed(
    () => DEVICE_COLORS[typeof props.colorIndex === 'number' ? props.colorIndex : hashDeviceId(props.session.key) % DEVICE_COLORS.length]
);
const peerAvatarStyle = computed<Record<string, string>>(() => ({
    background: palette.value.bg,
    border: '1px solid ' + palette.value.border,
    color: palette.value.color,
}));
const peerAvatarText = computed(() => (props.session.key ? props.session.key.slice(0, 1).toUpperCase() : ''));

const onlineDot = computed(() => {
    if (isAggregate.value) return sendable.value ? '#52c41a' : '#bfbfbf';
    return props.phone ? '#52c41a' : '#bfbfbf';
});
const onlineText = computed(() => {
    if (isAggregate.value) return sendable.value ? '在线 · 多台在线' : '离线';
    return props.phone ? '在线' : '离线';
});

/** 消息 + 时间分隔条（相邻两条间隔 > 5 分钟就插一条居中的时间） */
const rows = computed(() => {
    const out: Array<{ kind: 'sep'; key: string; text: string } | { kind: 'msg'; key: string; msg: TransferMessage; imageIndex: number }> = [];
    let prevTs = 0;
    props.session.messages.forEach((msg) => {
        if (!prevTs || msg.ts - prevTs > TIME_GAP) {
            out.push({ kind: 'sep', key: 'sep-' + msg.id, text: sepTimeText(msg.ts) });
        }
        prevTs = msg.ts;
        out.push({
            kind: 'msg',
            key: msg.id,
            msg,
            imageIndex: msg.type === 'image' ? imageMessages.value.findIndex((m) => m.id === msg.id) : -1,
        });
    });
    return out;
});

const percent = computed(() =>
    progress.value && progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0
);

// 新消息到达 → 滚到底
watch(
    () => props.session.messages,
    () => {
        nextTick(() => {
            const el = scrollEl.value;
            if (el) el.scrollTop = el.scrollHeight;
        });
    }
);

onBeforeUnmount(() => {
    pendingImages.value.forEach((p) => URL.revokeObjectURL(p.url));
    pendingFiles.value.forEach((p) => URL.revokeObjectURL(p.url));
});

function doSendText() {
    const t = sendText.value.trim();
    if (!t || !sendable.value) return;
    if (sendTextToSession(props.session.key, t)) sendText.value = '';
}

/** 隐藏 input 选文件：取消选择也要移除节点（'cancel' 事件非标准，用 window focus 兜底） */
function pickFilesInto(
    accept: string,
    apply: (files: File[]) => void
) {
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

function pickImages() {
    if (!sendable.value) {
        addLog('[传输助手] 当前无在线设备，无法发送', 'error', true);
        return;
    }
    pickFilesInto('image/*', (files) => {
        pendingImages.value = pendingImages.value.concat(
            files.map((f) => ({
                file: f,
                name: f.name || 'image.jpg',
                mime: f.type || 'image/jpeg',
                url: URL.createObjectURL(f),
            }))
        );
    });
}

function pickFiles() {
    if (!sendable.value) {
        addLog('[传输助手] 当前无在线设备，无法发送', 'error', true);
        return;
    }
    pickFilesInto('', (files) => {
        pendingFiles.value = pendingFiles.value.concat(
            files.map((f) => ({
                file: f,
                name: f.name || 'file.bin',
                mime: f.type || 'application/octet-stream',
                url: URL.createObjectURL(f),
            }))
        );
    });
}

function runSend(list: PendingImage[], afterOk: () => void) {
    sending.value = true;
    const ok = sendImagesToSession(props.session.key, list, (done, total, failed, text) => {
        progress.value = { done, total, failed, text };
        if (done >= total || failed) {
            sending.value = false;
            if (!failed) {
                afterOk();
                progress.value = null;
            }
        }
    });
    if (!ok) sending.value = false;
}

function confirmSendImage() {
    if (!pendingImages.value.length || !sendable.value) return;
    const snapshot = pendingImages.value.slice();
    runSend(snapshot, () => {
        pendingImages.value = [];
    });
}

function sendFilesNow(list: Array<{ file: File; name: string; mime: string; url: string }>, afterOk: () => void) {
    sending.value = true;
    const ok = sendFilesToSession(props.session.key, list, (done, total, failed, text) => {
        progress.value = { done, total, failed, text };
        if (done >= total || failed) {
            sending.value = false;
            if (!failed) {
                afterOk();
                progress.value = null;
            }
        }
    });
    if (!ok) sending.value = false;
}

function confirmSendFiles() {
    if (!pendingFiles.value.length || !sendable.value) return;
    const snapshot = pendingFiles.value.slice();
    sendFilesNow(snapshot, () => {
        pendingFiles.value = [];
    });
}

function removePendingImage(i: number) {
    if (sending.value) return; // 发送按快照进行，发送中禁止改动
    const arr = pendingImages.value.slice();
    const removed = arr.splice(i, 1)[0];
    if (removed) URL.revokeObjectURL(removed.url);
    pendingImages.value = arr;
}

function removePendingFile(i: number) {
    if (sending.value) return;
    const arr = pendingFiles.value.slice();
    const removed = arr.splice(i, 1)[0];
    if (removed) URL.revokeObjectURL(removed.url);
    pendingFiles.value = arr;
}

/** 点一张表情 = 直接发出去（与「图片上传 → 发送」同一条链路，跳过待发列表） */
function sendEmojiNow(emoji: PickedEmoji) {
    if (!sendable.value) {
        addLog('[传输助手] 当前无在线设备，无法发送', 'error', true);
        return;
    }
    if (sending.value) {
        addLog('[传输助手] 正在发送上一批，稍后再点表情', 'info');
        return;
    }
    const mime = emoji.blob.type || 'image/webp';
    const file = new File([emoji.blob], emoji.name, { type: mime });
    addLog('[传输助手] 发送表情：' + emoji.pack + ' · ' + emoji.key, 'info');
    runSend(
        [
            {
                file,
                name: emoji.name,
                mime,
                // 这张 blob 还被表情面板的缩略图引用，**不 revoke**
                url: URL.createObjectURL(emoji.blob),
                emoji: true,
            },
        ],
        () => {
            /* 直接发送：没有待发列表要清 */
        }
    );
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

function doClear() {
    confirmClear.value = false;
    emit('clear');
}
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col">
        <!-- 会话头部：左 = 头像 + 名称 + 在线状态；右 = 垃圾桶（清空） -->
        <div class="flex min-w-0 shrink-0 items-center gap-2 border-b border-black/40 px-3 py-2.5">
            <span
                class="inline-flex size-[30px] shrink-0 items-center justify-center rounded-[8px] text-[13px] font-semibold"
                :style="peerAvatarStyle">
                <Icon v-if="isAggregate" name="smartphone" :size="15" />
                <template v-else>{{ peerAvatarText }}</template>
            </span>
            <span v-if="isAggregate" class="text-[15px] font-semibold text-white/90">{{ PHONE_SESSION_LABEL }}</span>
            <DeviceIdTag v-else :id="session.key" :color-index="colorIndex" />
            <span class="inline-flex items-center gap-1 text-xs text-white/55">
                <span class="inline-block size-1.5 rounded-full" :style="{ background: onlineDot }" />
                {{ onlineText }}
                <template v-if="isAggregate && sendable"> · 无法识别发送设备时归在这里</template>
            </span>
            <span class="flex-1" />
            <div class="relative shrink-0">
                <button
                    type="button"
                    aria-label="清空消息"
                    title="清空消息"
                    class="inline-flex size-7 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-white/55 outline-none hover:bg-white/10 hover:text-white"
                    @click="confirmClear = !confirmClear">
                    <Icon name="trash" :size="15" />
                </button>
                <div
                    v-if="confirmClear"
                    class="absolute right-0 top-full z-20 mt-1 w-[190px] rounded-[8px] border border-white/10 bg-[#2B2B2B] p-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.5)]">
                    <div class="mb-2 text-xs text-white/80">清空这个会话的全部消息？</div>
                    <div class="flex justify-end gap-2">
                        <button
                            type="button"
                            class="cursor-pointer rounded border border-white/15 bg-transparent px-2 py-0.5 text-xs text-white/70 outline-none hover:bg-white/10"
                            @click="confirmClear = false">
                            取消
                        </button>
                        <button
                            type="button"
                            class="cursor-pointer rounded border-0 bg-[#E81123] px-2 py-0.5 text-xs text-white outline-none hover:bg-[#c50f1f]"
                            @click="doClear">
                            清空
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 消息区 -->
        <div
            ref="scrollEl"
            class="znhd-transfer-messages min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2.5"
            style="scrollbar-gutter: stable">
            <template v-if="rows.length">
                <template v-for="row in rows" :key="row.key">
                    <div v-if="row.kind === 'sep'" class="znhd-chat-time my-1.5 mb-3 text-center text-[11px] text-white/35">
                        {{ row.text }}
                    </div>
                    <ChatMessage
                        v-else
                        :msg="row.msg"
                        :peer-avatar-text="peerAvatarText"
                        :peer-avatar-style="peerAvatarStyle"
                        :is-aggregate="isAggregate"
                        :image-index="row.imageIndex"
                        :copy-state="imgCopy"
                        @preview="openPreview(row.msg)"
                        @copy="doCopy(row.msg)"
                        @download="row.msg.type === 'file' ? doDownloadFile(row.msg) : doDownload(row.msg, row.imageIndex)"
                        @remove="removeTransferMessage(session.key, row.msg.id)" />
                </template>
            </template>
            <Empty v-else class="!p-6">
                <span class="text-xs text-white/40">暂无消息，用下面的输入框给这台手机发点东西吧</span>
            </Empty>
        </div>

        <!-- 待发送图片（贴在输入框上方；输入框本身保持两端一致） -->
        <div v-if="pendingImages.length" class="shrink-0 px-3 pt-2">
            <div class="mb-1.5 flex justify-between">
                <span class="text-xs text-white/55">待发送图片</span>
                <span class="text-xs text-white/35">已选 {{ pendingImages.length }} 张</span>
            </div>
            <div class="grid grid-cols-6 gap-1.5">
                <div
                    v-for="(img, i) in pendingImages"
                    :key="img.url"
                    class="relative overflow-hidden rounded-[8px] bg-white/5"
                    style="padding-bottom: 75%">
                    <img :src="img.url" :alt="img.name" class="absolute inset-0 size-full object-cover" />
                    <button
                        type="button"
                        title="移除这张"
                        aria-label="移除这张"
                        class="absolute right-1 top-1 inline-flex size-5 cursor-pointer items-center justify-center rounded-full border-0 bg-black/55 p-0 text-[13px] leading-none text-white outline-none hover:bg-black/75"
                        :class="sending ? 'cursor-not-allowed' : ''"
                        @click="removePendingImage(i)">
                        ×
                    </button>
                </div>
            </div>
            <button
                type="button"
                :disabled="!sendable"
                class="mt-2 w-full cursor-pointer rounded-[6px] border-0 bg-[#07C160] py-1.5 text-sm text-white outline-none hover:bg-[#06AD56] disabled:cursor-not-allowed disabled:opacity-50"
                @click="confirmSendImage">
                发送 {{ pendingImages.length }} 张图片
            </button>
        </div>

        <!-- 待发送文件 -->
        <div v-if="pendingFiles.length" class="shrink-0 px-3 pt-2">
            <div class="mb-1.5 flex justify-between">
                <span class="text-xs text-white/55">待发送文件</span>
                <span class="text-xs text-white/35">已选 {{ pendingFiles.length }} 个</span>
            </div>
            <div class="flex flex-col gap-1.5">
                <div
                    v-for="(f, i) in pendingFiles"
                    :key="f.url"
                    class="flex min-w-0 items-center gap-2 rounded-[8px] border border-white/10 bg-white/5 px-2.5 py-1.5">
                    <Icon name="fileText" :size="16" class="text-white/60" />
                    <div class="min-w-0 flex-1">
                        <div class="truncate text-xs text-white/85" :title="f.name">{{ f.name }}</div>
                        <div class="text-[11px] text-white/40">{{ Math.max(1, Math.round(f.file.size / 1024)) }} KB</div>
                    </div>
                    <button
                        type="button"
                        title="移除这个文件"
                        aria-label="移除这个文件"
                        class="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-black/35 p-0 text-[13px] leading-none text-white outline-none hover:bg-black/55"
                        @click="removePendingFile(i)">
                        ×
                    </button>
                </div>
            </div>
            <button
                type="button"
                :disabled="!sendable"
                class="mt-2 w-full cursor-pointer rounded-[6px] border-0 bg-[#07C160] py-1.5 text-sm text-white outline-none hover:bg-[#06AD56] disabled:cursor-not-allowed disabled:opacity-50"
                @click="confirmSendFiles">
                发送 {{ pendingFiles.length }} 个文件
            </button>
        </div>

        <!-- 批量发送进度 -->
        <div v-if="progress" class="shrink-0 px-3 pt-2">
            <div class="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                    class="h-full rounded-full transition-[width] duration-150"
                    :style="{ width: percent + '%', background: progress.failed ? '#e4393c' : '#07C160' }" />
            </div>
            <div class="mt-1 text-xs" :class="progress.failed ? 'text-[#ff7875]' : 'text-white/55'">{{ progress.text }}</div>
        </div>

        <ChatComposer
            v-model="sendText"
            :disabled="!sendable"
            placeholder="输入要发送到手机的文本…（Enter 发送，Shift+Enter 换行）"
            :notice="sendable ? '' : '当前没有在线手机，连上手机后才能发送。'"
            :actions="composerActions"
            @send="doSendText"
            @pick-emoji="sendEmojiNow" />

        <ImagePreview v-model:open="previewOpen" :items="imageUrls" :index="previewIndex" :names="imageNames" />
    </div>
</template>
