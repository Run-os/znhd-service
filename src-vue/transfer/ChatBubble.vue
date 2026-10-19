<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@vue/icons';
import ImageActions from '@vue/components/media/ImageActions.vue';
import type { ImageAction } from './types';
import { MD_MINE, MD_PEER, renderMarkdown } from './markdown';

/**
 * 一条聊天消息（v26.10.18-v8）—— 迁移到 daisyUI 的 `chat-bubble`。
 *
 * 脚本端传输助手窗口与客户端手机页共用这一个组件 —— 两边数据源完全不同
 * （脚本端是 store 里的 `TransferMessage`，客户端是轮询得到的 `ChatMsg`），
 * 所以这里只收「已经摊平的字面量」，不碰任何 store / 网络。
 *
 * 结构：
 *  · 左右对齐与头像由 `ChatTurn.vue` 的 `chat-start` / `chat-end` 决定；
 *  · 本组件只画气泡本身（`chat-bubble`）与下方 `chat-footer`（发送状态小字）；
 *  · 我方气泡加 `chat-bubble-primary`，对方用默认色（`base-200`）。
 *
 * 进度条改用官方 `progress`；文件图标底色用 `primary-content` / `base-content` 的透明度变体。
 */
const props = withDefaults(
    defineProps<{
        /** 消息类型 */
        type: 'image' | 'file' | 'text';
        /** true = 我方（右侧），false = 对方（左侧） */
        mine: boolean;
        text?: string;
        name?: string;
        mime?: string;
        /** 已格式化好的体积文案（组件不做单位换算） */
        sizeText?: string;
        /** 图片地址（objectURL / data:URL 都行） */
        imageSrc?: string;
        /** true = 被 ChatTurn 塞进同一个 chat 容器里（不画时间条与外边距） */
        grouped?: boolean;
        /** 气泡下方的小字（发送中… / 已发送 / 发送失败：原因） */
        meta?: string;
        /** meta 用失败色 */
        metaDanger?: boolean;
        /** 上传进度（0–100）；null / undefined = 不画进度条 */
        progress?: number | null;
        /** 失败原因（贴在图/文件下方的一行小字） */
        error?: string;
        /** 图片悬浮动作（复制 / 下载 / 删除）；不传则图片不可操作 */
        imageActions?: ImageAction[];
        /** 图片可点开预览 */
        clickable?: boolean;
        /** 文件能否下载（没有 blob 时为 false，按钮置灰） */
        canDownload?: boolean;
        /** 文件气泡里的按钮文案 */
        downloadLabel?: string;
        /** 给了就渲染「复制」小按钮（对方文本消息用） */
        copyLabel?: string;
    }>(),
    {
        text: '',
        name: '',
        mime: '',
        sizeText: '',
        imageSrc: '',
        grouped: false,
        meta: '',
        metaDanger: false,
        progress: null,
        error: '',
        imageActions: () => [],
        clickable: false,
        canDownload: true,
        downloadLabel: '下载',
        copyLabel: '',
    }
);

const emit = defineEmits<{
    (e: 'preview'): void;
    (e: 'download'): void;
    (e: 'copy'): void;
}>();

/** 上传中的整体淡化（图片/文件气泡共用） */
const sending = computed(() => props.progress !== null);

const mdNodes = computed(() => renderMarkdown(props.text || '', props.mine ? MD_MINE : MD_PEER));
</script>

<template>
    <!-- ---------- 图片 ---------- -->
    <div v-if="type === 'image'" class="chat-bubble max-w-[62%]">
        <ImageActions v-if="imageActions.length" :actions="imageActions" @click.stop>
            <img
                :src="imageSrc"
                :alt="name || 'image'"
                class="block h-auto w-auto max-w-[240px] rounded-box"
                :class="clickable ? 'cursor-zoom-in' : ''"
                :style="{
                    maxHeight: '360px',
                    opacity: sending ? 0.55 : 1,
                    border: error ? '1px solid var(--color-error)' : 'none',
                }"
                @click="emit('preview')" />
        </ImageActions>
        <img
            v-else
            :src="imageSrc"
            :alt="name || 'image'"
            class="block h-auto w-auto max-w-[240px] rounded-box"
            :class="clickable ? 'cursor-zoom-in' : ''"
            :style="{
                maxHeight: '360px',
                opacity: sending ? 0.55 : 1,
                border: error ? '1px solid var(--color-error)' : 'none',
            }"
            @click="emit('preview')" />
        <progress
            v-if="progress !== null"
            :data-chat-progress="progress"
            class="progress progress-primary mt-1 w-full"
            :value="progress"
            max="100"></progress>
    </div>

    <!-- ---------- 文件 ---------- -->
    <div v-else-if="type === 'file'" class="chat-bubble max-w-[74%]" :class="mine ? 'chat-bubble-primary' : ''">
        <div
            data-chat-file-bubble="1"
            class="flex min-w-0 items-center gap-2.5"
            :style="sending ? { opacity: 0.55 } : undefined">
            <span
                class="inline-flex size-8 shrink-0 items-center justify-center rounded-box"
                :class="mine ? 'bg-primary-content/15' : 'bg-base-content/10'">
                <Icon name="fileText" :size="18" />
            </span>
            <div class="min-w-0 flex-1">
                <div class="truncate text-[13px] font-medium" :title="name || 'file'">
                    {{ name || 'file' }}
                </div>
                <div class="mt-px text-[11px] opacity-75">
                    {{ sizeText }}<template v-if="mime"> · {{ mime }}</template>
                </div>
            </div>
            <button
                type="button"
                aria-label="下载文件"
                :disabled="!canDownload"
                class="btn btn-xs shrink-0"
                :class="mine ? 'btn-neutral' : 'btn-outline'"
                @click="emit('download')">
                {{ downloadLabel }}
            </button>
        </div>
        <progress
            v-if="progress !== null"
            class="progress mt-1 w-full"
            :class="mine ? 'progress-neutral' : 'progress-primary'"
            :value="progress"
            max="100"></progress>
        <div v-if="error" class="mt-1 text-[11px]">{{ error }}</div>
    </div>

    <!-- ---------- 文本（Markdown → VNode，无 v-html） ---------- -->
    <template v-else>
        <div class="chat-bubble max-w-[74%] text-[13px] leading-relaxed" :class="mine ? 'chat-bubble-primary' : ''">
            <component :is="() => mdNodes" />
            <div v-if="error" class="mt-1 text-[11px]">{{ error }}</div>
        </div>
        <button
            v-if="copyLabel"
            type="button"
            class="mt-0.5 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-base-content/60 outline-none hover:text-base-content"
            @click="emit('copy')">
            {{ copyLabel }}
        </button>
    </template>

    <div v-if="meta" class="chat-footer text-[11px]" :class="metaDanger ? 'text-error' : ''">{{ meta }}</div>
</template>
