<script setup lang="ts">
import { computed } from 'vue';
import { Bubble, BubbleContent } from '@vue/components/ui/bubble';
import { Message, MessageAvatar, MessageContent, MessageFooter } from '@vue/components/ui/message';
import { Icon } from '@vue/icons';
import { formatBytes } from '@/lib/sniffer';
import type { TransferMessage } from '@/lib/transfer/types';
import { MD_MINE, MD_PEER, renderMarkdown } from './markdown';
import { metaOf } from './format';
import ImageActions from './ImageActions.vue';
import type { ImageAction } from './types';

/**
 * 单条消息（v26.10.18-v5）：官方 `Message` + `Bubble` 组合，替代 React 版手写的 `ChatBubble`。
 *
 * ── 官方组件怎么对上微信暗色观感 ────────────────────────────────────────────
 * 不在组件里改 `bg-primary` 这些类，而是靠窗口根节点上的 CSS 变量覆盖（见 theme.ts）：
 *  · 我方气泡 = `Bubble variant="default"` ⇒ `bg-primary` = 微信绿 #07C160 + 白字；
 *  · 对方气泡 = `Bubble variant="muted"`   ⇒ `bg-muted`   = #2F2F2F 微信灰；
 *  · 图片气泡 = `Bubble variant="ghost"`   ⇒ 透明无内边距（图片自带圆角）。
 *
 * ⚠️ 内边距/最大宽度用 `!` 强制：ghost 变体的 `*[data-slot=bubble-content]` 选择器与
 * BubbleContent 自带的 `px-3 py-2` 是**同权重**的，谁生效取决于 Tailwind 的产出顺序 ——
 * 不加强制前缀会出现「图片气泡莫名有 12px 内边距」这类随版本漂移的问题。
 */
const props = defineProps<{
    msg: TransferMessage;
    /** 对方头像里的内容（首字母 / 手机图标由父组件决定） */
    peerAvatarText: string;
    peerAvatarStyle: Record<string, string>;
    isAggregate: boolean;
    /** 该图片在本会话图片序列里的下标（下载文件名用） */
    imageIndex: number;
    /** 图片复制的瞬时状态（与消息 id 绑定） */
    copyState?: { id: string; state: 'busy' | 'ok' | 'fail' } | null;
}>();

const emit = defineEmits<{
    (e: 'preview'): void;
    (e: 'copy'): void;
    (e: 'download'): void;
    (e: 'remove'): void;
}>();

const isUser = computed(() => props.msg.direction === 'out');
const meta = computed(() => metaOf(props.msg));
const sending = computed(() => props.msg.sendState === 'sending');

/** 气泡内上传进度（只有真正收到 progress 事件才画，否则保持「发送中…」静默降级） */
const progressPct = computed(() => {
    if (props.msg.sendState !== 'sending' || typeof props.msg.sendProgress !== 'number') return null;
    return Math.min(100, Math.max(2, props.msg.sendProgress));
});

const mdNodes = computed(() => renderMarkdown(props.msg.text || '', isUser.value ? MD_MINE : MD_PEER));

const imageActions = computed<ImageAction[]>(() => [
    {
        label: '复制',
        tooltip: copyTooltip.value,
        icon: props.copyState && props.copyState.id === props.msg.id && props.copyState.state === 'ok' ? 'check' : 'copy',
        onClick: () => emit('copy'),
    },
    { label: '下载', icon: 'download', onClick: () => emit('download') },
    { label: '删除', icon: 'trash', danger: true, onClick: () => emit('remove') },
]);

const copyTooltip = computed(() => {
    const st = props.copyState;
    if (!st || st.id !== props.msg.id) return '复制';
    if (st.state === 'busy') return '复制中…';
    return st.state === 'ok' ? '已复制' : '复制失败';
});

/** 文件卡片里的文件图标底色：我方实心绿底用半透明白，对方灰底用浅白 */
const fileIconStyle = computed(() =>
    isUser.value
        ? { background: 'rgba(255,255,255,0.22)', color: '#fff' }
        : { background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.65)' }
);
</script>

<template>
    <Message :align="isUser ? 'end' : 'start'" class="mb-3.5 min-w-0">
        <!-- 头像：对方 = 设备色板；我方 = 深灰方坯 + 人像图标 -->
        <MessageAvatar
            class="!size-8 !shrink-0 !self-start !rounded-[8px] text-[13px] font-semibold"
            :style="isUser ? { background: '#4A4A4A', color: '#fff' } : peerAvatarStyle">
            <Icon v-if="isUser" name="user" :size="15" />
            <Icon v-else-if="isAggregate" name="smartphone" :size="15" />
            <template v-else>{{ peerAvatarText }}</template>
        </MessageAvatar>

        <MessageContent class="!gap-0.5">
            <!-- ---------- 图片 ---------- -->
            <Bubble v-if="msg.type === 'image'" variant="ghost" :align="isUser ? 'end' : 'start'" class="!max-w-[62%]">
                <BubbleContent class="!rounded-[8px] !border-0 !p-0">
                    <ImageActions :actions="imageActions" @click.stop>
                        <img
                            :src="msg.previewUrl"
                            :alt="msg.name || 'image'"
                            class="block h-auto w-auto max-w-[240px] cursor-zoom-in rounded-[8px]"
                            :style="{
                                maxHeight: '360px',
                                opacity: sending ? 0.55 : 1,
                                border: msg.sendState === 'failed' ? '1px solid #ff4d4f' : 'none',
                            }"
                            @click="emit('preview')" />
                    </ImageActions>
                </BubbleContent>
                <div
                    v-if="progressPct !== null"
                    :data-transfer-progress="msg.sendProgress"
                    class="mt-1 h-1 w-full overflow-hidden rounded-[2px] bg-white/20">
                    <div
                        class="h-full rounded-[2px] bg-[#07C160] transition-[width] duration-100"
                        :style="{ width: progressPct + '%' }" />
                </div>
            </Bubble>

            <!-- ---------- 文件 ---------- -->
            <Bubble
                v-else-if="msg.type === 'file'"
                :variant="isUser ? 'default' : 'muted'"
                :align="isUser ? 'end' : 'start'"
                class="!max-w-[74%]">
                <BubbleContent class="!px-3 !py-2">
                    <div
                        data-transfer-file-bubble="1"
                        class="flex min-w-0 items-center gap-2.5"
                        :style="{ opacity: sending ? 0.55 : 1 }">
                        <span
                            class="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px]"
                            :style="fileIconStyle">
                            <Icon name="fileText" :size="18" />
                        </span>
                        <div class="min-w-0 flex-1">
                            <div class="truncate text-[13px] font-medium" :title="msg.name || 'file'">
                                {{ msg.name || 'file' }}
                            </div>
                            <div class="mt-px text-[11px] opacity-75">
                                {{ formatBytes(msg.blob ? msg.blob.size : 0) }}{{ msg.mime ? ' · ' + msg.mime : '' }}
                            </div>
                        </div>
                        <button
                            type="button"
                            aria-label="下载文件"
                            :disabled="sending || !msg.blob"
                            class="shrink-0 cursor-pointer rounded-[6px] border px-2 py-0.5 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50"
                            :class="
                                isUser
                                    ? 'border-white/40 bg-white/10 text-white hover:bg-white/20'
                                    : 'border-white/20 bg-white/5 text-white/80 hover:bg-white/15'
                            "
                            @click="emit('download')">
                            下载
                        </button>
                    </div>
                    <div
                        v-if="progressPct !== null"
                        class="mt-1 h-1 w-full overflow-hidden rounded-[2px]"
                        :style="{ background: isUser ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.22)' }">
                        <div
                            class="h-full rounded-[2px] transition-[width] duration-100"
                            :style="{ width: progressPct + '%', background: isUser ? '#fff' : '#07C160' }" />
                    </div>
                    <div v-if="msg.sendState === 'failed' && msg.sendError" class="mt-1 text-[11px]">
                        {{ msg.sendError }}
                    </div>
                </BubbleContent>
            </Bubble>

            <!-- ---------- 文本（Markdown） ---------- -->
            <Bubble
                v-else
                :variant="isUser ? 'default' : 'muted'"
                :align="isUser ? 'end' : 'start'"
                class="!max-w-[74%]">
                <BubbleContent class="!px-3 !py-2 !text-[13px] !leading-relaxed">
                    <!-- renderMarkdown 产出 VNode（不是 HTML 字符串）⇒ 原文里的标签只是文本，无注入面 -->
                    <component :is="() => mdNodes" />
                    <div v-if="msg.sendState === 'failed' && msg.sendError" class="mt-1 text-[11px]">
                        {{ msg.sendError }}
                    </div>
                </BubbleContent>
            </Bubble>

            <MessageFooter v-if="meta" class="!px-0 !text-[11px]">{{ meta }}</MessageFooter>
        </MessageContent>
    </Message>
</template>
