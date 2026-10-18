<script setup lang="ts">
import { computed, ref } from 'vue';
import { Empty } from '@vue/components/ui/empty';
import { Icon } from '@vue/icons';
import { addLog } from '@/lib/logger';
import { copyImageToClipboard } from '@/lib/relay';
import { downloadFileName } from '@/lib/gallery';
import { clearAllTransferFiles, removeTransferMessage } from '@/lib/transfer/store';
import { formatBytes } from '@/lib/sniffer';
import type { TransferMessage } from '@/lib/transfer/types';
import ImageActions from '@vue/components/media/ImageActions.vue';
import ImagePreview from '@vue/components/media/ImagePreview.vue';
import { fullTime, sourceLabel } from './format';
import type { ImageAction } from './types';

/**
 * 文件视图（v26.10.18-v5，React 版 `TransferFilesView` 的等价实现）。
 *
 * 「全部文件」= 父组件传进来的全部消息：图片九宫格 + 文件卡片。
 * ⚠️ v26.10.19-v9：**不再收录文本**——文本留在聊天时间线里看，这里只管图片和文件。
 */
const props = defineProps<{
    messages: TransferMessage[];
    /** 标题前缀：「全部文件」或「<会话名>的文件」 */
    scopeLabel: string;
    /** 仅单会话时提供：清空按钮变成「清空本会话」 */
    clearScope?: () => void;
}>();

const imgCopy = ref<{ id: string; state: 'busy' | 'ok' | 'fail' } | null>(null);
const previewOpen = ref(false);
const previewIndex = ref(0);

/** 最新在前（刚收到的先看） */
const ordered = computed(() =>
    props.messages
        .slice()
        .filter((m) => m.type !== 'text')
        .sort((a, b) => b.ts - a.ts)
);
const images = computed(() => ordered.value.filter((m) => m.type === 'image'));
const files = computed(() => ordered.value.filter((m) => m.type === 'file'));

const imageUrls = computed(() => images.value.map((m) => m.previewUrl as string));
const imageNames = computed(() => images.value.map((m, i) => downloadFileName(m.name, m.mime, i)));

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

function doCopy(msg: TransferMessage) {
    imgCopy.value = { id: msg.id, state: 'busy' };
    copyImageToClipboard(msg.blob).then((ok) => {
        imgCopy.value = { id: msg.id, state: ok ? 'ok' : 'fail' };
        if (ok) addLog('图片已复制到剪贴板: ' + (msg.name || ''), 'success');
        window.setTimeout(() => (imgCopy.value = null), 1500);
    });
}

function copyHint(msg: TransferMessage): string {
    const st = imgCopy.value;
    if (!st || st.id !== msg.id) return '复制';
    if (st.state === 'busy') return '复制中…';
    return st.state === 'ok' ? '已复制' : '复制失败';
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
    const at = images.value.findIndex((m) => m.id === msg.id);
    previewIndex.value = at >= 0 ? at : 0;
    previewOpen.value = true;
}

/** 格子上的三个悬浮动作（在 script 里构造，保住 `icon` 的字面量类型） */
function actionsOf(msg: TransferMessage, idx: number): ImageAction[] {
    return [
        {
            label: '复制',
            tooltip: copyHint(msg),
            icon: imgCopy.value && imgCopy.value.id === msg.id && imgCopy.value.state === 'ok' ? 'check' : 'copy',
            onClick: () => doCopy(msg),
        },
        { label: '下载', icon: 'download', onClick: () => doDownload(msg, idx) },
        { label: '删除', icon: 'trash', danger: true, onClick: () => removeTransferMessage(msg.sessionKey, msg.id) },
    ];
}

function onClear() {
    if (props.clearScope) {
        props.clearScope();
        addLog('[传输助手] 已清空该会话的文件与消息', 'success');
    } else {
        clearAllTransferFiles();
    }
}
</script>

<template>
    <!-- 空状态 -->
    <div v-if="!ordered.length" class="flex flex-1 items-center justify-center">
        <Empty class="!p-6">
            <span class="text-xs text-white/40">
                {{ clearScope ? '该会话暂无图片 / 文件' : '暂无文件——手机发来的图片 / 文件会汇总在这里' }}
            </span>
        </Empty>
    </div>

    <div v-else class="znhd-transfer-files min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
        <div class="mb-2 flex items-baseline gap-2">
            <span class="text-sm font-semibold text-white/90">
                {{ scopeLabel }}（图片 {{ images.length }} · 文件 {{ files.length }}）
            </span>
            <span class="flex-1" />
            <button
                type="button"
                class="cursor-pointer rounded border border-[#ff7875]/50 bg-transparent px-2 py-0.5 text-xs text-[#ff7875] outline-none hover:bg-[#ff7875]/15"
                @click="onClear">
                {{ clearScope ? '清空本会话' : '清空全部' }}
            </button>
        </div>

        <!-- 图片九宫格：格子下限 96px（要宽过右下角 3 个悬浮按钮，窄栏才不会把按钮挤出图片） -->
        <div
            v-if="images.length"
            class="grid gap-2"
            style="grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); align-content: start">
            <div v-for="(msg, idx) in images" :key="msg.id" class="flex flex-col">
                <ImageActions :actions="actionsOf(msg, idx)">
                    <img
                        :src="msg.previewUrl"
                        :alt="msg.name || 'image'"
                        class="block w-full cursor-zoom-in rounded-[8px] object-cover"
                        style="aspect-ratio: 1 / 1"
                        @click="openPreview(msg)" />
                </ImageActions>
                <div class="mt-0.5 truncate text-[11px] text-white/35">
                    {{ sourceLabel(msg) }} · {{ fullTime(msg.ts) }} · {{ msg.direction === 'in' ? '收到' : '发出' }}
                </div>
            </div>
        </div>

        <!-- 文件卡片 -->
        <div v-if="files.length" :class="images.length ? 'mt-4' : ''">
            <div class="mb-1.5 text-[13px] font-semibold text-white/90">文件（{{ files.length }}）</div>
            <div
                class="grid gap-2"
                style="grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); align-content: start">
                <div
                    v-for="msg in files"
                    :key="msg.id"
                    data-transfer-file-card="1"
                    class="flex min-w-0 items-center gap-2.5 rounded-[8px] border border-white/10 bg-white/[0.04] px-2.5 py-2">
                    <span class="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-white/[0.08] text-white/60">
                        <Icon name="fileText" :size="18" />
                    </span>
                    <div class="min-w-0 flex-1">
                        <div class="truncate text-[13px] text-white/90" :title="msg.name || 'file'">
                            {{ msg.name || 'file' }}
                        </div>
                        <div class="mt-px truncate text-[11px] text-white/35">
                            {{ formatBytes(msg.blob ? msg.blob.size : 0) }} · {{ sourceLabel(msg) }} ·
                            {{ fullTime(msg.ts) }} · {{ msg.direction === 'in' ? '收到' : '发出' }}
                        </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                        <button
                            type="button"
                            aria-label="下载文件"
                            :disabled="!msg.blob"
                            class="cursor-pointer rounded border border-white/20 bg-white/5 px-2 py-0.5 text-xs text-white/80 outline-none hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                            @click="doDownloadFile(msg)">
                            下载
                        </button>
                        <button
                            type="button"
                            aria-label="删除文件"
                            class="inline-flex size-[22px] cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-[#ff7875] outline-none hover:bg-[#ff7875]/15"
                            @click="removeTransferMessage(msg.sessionKey, msg.id)">
                            <Icon name="close" :size="13" />
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- v26.10.19-v9：文本列表整段移除——文本只在聊天时间线看，「全部文件」只收图片和文件 -->

        <ImagePreview v-model:open="previewOpen" :items="imageUrls" :index="previewIndex" :names="imageNames" />
    </div>
</template>
