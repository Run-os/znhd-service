<script setup lang="ts">
import { computed } from 'vue';
import { Bubble, BubbleContent } from '@vue/components/ui/bubble';
import { MessageFooter } from '@vue/components/ui/message';
import { Icon } from '@vue/icons';
import ImageActions from '@vue/components/media/ImageActions.vue';
import type { ImageAction } from './types';
import { MD_MINE, MD_PEER, renderMarkdown } from './markdown';

/**
 * 一条聊天消息（v26.10.18-v8）：官方 `Message` + `Bubble` 的**纯展示**组件。
 *
 * 脚本端传输助手窗口与客户端手机页共用这一个组件 —— 两边数据源完全不同
 * （脚本端是 store 里的 `TransferMessage`，客户端是轮询得到的 `ChatMsg`），
 * 所以这里只收「已经摊平的字面量」，不碰任何 store / 网络。
 *
 * 结构分工（对应官方 Conversation 示例）：
 *  · 时间分隔条 / 头像 / BubbleGroup 由 `ChatTurn.vue` 负责；
 *  · 本组件只画「一个气泡 + 气泡下方的小字（发送状态）」，`grouped` 模式下
 *    被 ChatTurn 塞进同一个 MessageContent / BubbleGroup 里。
 *
 * ── 官方组件怎么对上聊天观感 ────────────────────────────────────────────────
 * 不在组件里改 `bg-primary` 这类类名，而是靠宿主根节点上的 CSS 变量覆盖：
 *  · 我方气泡 = `Bubble variant="default"` ⇒ `bg-primary`（脚本端日间蓝 / 夜间绿 / 客户端微信绿）
 *  · 对方气泡 = `Bubble variant="muted"`   ⇒ `bg-muted`
 *  · 图片气泡 = `Bubble variant="ghost"`   ⇒ 透明无内边距（图片自带圆角）
 *
 * ⚠️ 内边距/最大宽度用 `!` 强制：ghost 变体的 `*[data-slot=bubble-content]` 选择器与
 * BubbleContent 自带的 `px-3 py-2` 是同权重的，谁生效取决于 Tailwind 产出顺序 ——
 * 不加前缀会出现「图片气泡莫名有 12px 内边距」这类随版本漂移的问题。
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
        /** true = 被 ChatTurn 塞进 MessageContent / BubbleGroup 里（不画时间条与外边距） */
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

/** 进度条宽度：2% 起步，避免「刚发出时看起来没反应」 */
const progressPct = computed(() =>
    props.progress === null ? 0 : Math.min(100, Math.max(2, props.progress))
);

/** 文件卡片里的图标底色：我方实心底色上用半透明黑（v9 起我方文字一律黑色），对方用浅一档 */
const fileIconStyle = computed(() =>
    props.mine
        ? { background: 'rgba(0,0,0,0.15)', color: '#000000' }
        : { background: 'rgba(127,127,127,0.18)', color: 'inherit' }
);
</script>

<template>
    <!-- ⚠️ 根节点必须是 flex-col：Bubble 的 `data-[align=end]:self-end` 靠它右对齐 -->
    <div class="flex min-w-0 flex-col">
        <!-- ---------- 图片 ---------- -->
                <Bubble v-if="type === 'image'" variant="ghost" :align="mine ? 'end' : 'start'" class="!max-w-[62%]">
                    <BubbleContent class="!rounded-[8px] !border-0 !p-0">
                        <ImageActions v-if="imageActions.length" :actions="imageActions" @click.stop>
                            <img
                                :src="imageSrc"
                                :alt="name || 'image'"
                                class="block h-auto w-auto max-w-[240px] rounded-[8px]"
                                :class="clickable ? 'cursor-zoom-in' : ''"
                                :style="{
                                    maxHeight: '360px',
                                    opacity: sending ? 0.55 : 1,
                                    border: error ? '1px solid var(--color-destructive)' : 'none',
                                }"
                                @click="emit('preview')" />
                        </ImageActions>
                        <img
                            v-else
                            :src="imageSrc"
                            :alt="name || 'image'"
                            class="block h-auto w-auto max-w-[240px] rounded-[8px]"
                            :class="clickable ? 'cursor-zoom-in' : ''"
                            :style="{
                                maxHeight: '360px',
                                opacity: sending ? 0.55 : 1,
                                border: error ? '1px solid var(--color-destructive)' : 'none',
                            }"
                            @click="emit('preview')" />
                        <div
                            v-if="progress !== null"
                            :data-chat-progress="progress"
                            class="mt-1 h-1 w-full overflow-hidden rounded-[2px] bg-foreground/20">
                            <div
                                class="h-full rounded-[2px] bg-primary transition-[width] duration-100"
                                :style="{ width: progressPct + '%' }" />
                        </div>
                    </BubbleContent>
                </Bubble>

                <!-- ---------- 文件 ---------- -->
                <Bubble
                    v-else-if="type === 'file'"
                    :variant="mine ? 'default' : 'muted'"
                    :align="mine ? 'end' : 'start'"
                    class="!max-w-[74%]">
                    <BubbleContent class="!px-3 !py-2" :class="mine ? '!text-black' : ''">
                        <div
                            data-chat-file-bubble="1"
                            class="flex min-w-0 items-center gap-2.5"
                            :style="sending ? { opacity: 0.55 } : undefined">
                            <span
                                class="inline-flex size-8 shrink-0 items-center justify-center rounded-[6px]"
                                :style="fileIconStyle">
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
                                class="shrink-0 cursor-pointer rounded-[6px] border px-2 py-0.5 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                :class="
                                    mine
                                        ? 'border-black/30 bg-black/10 text-black hover:bg-black/20'
                                        : 'border-border bg-foreground/5 text-foreground hover:bg-foreground/10'
                                "
                                @click="emit('download')">
                                {{ downloadLabel }}
                            </button>
                        </div>
                        <div
                            v-if="progress !== null"
                            class="mt-1 h-1 w-full overflow-hidden rounded-[2px] bg-foreground/25">
                            <div
                                class="h-full rounded-[2px] transition-[width] duration-100"
                                :style="{
                                    width: progressPct + '%',
                                    background: mine ? 'var(--color-primary-foreground)' : 'var(--color-primary)',
                                }" />
                        </div>
                        <div v-if="error" class="mt-1 text-[11px]">{{ error }}</div>
                    </BubbleContent>
                </Bubble>

                <!-- ---------- 文本（Markdown → VNode，无 v-html） ---------- -->
                <template v-else>
                    <Bubble :variant="mine ? 'default' : 'muted'" :align="mine ? 'end' : 'start'" class="!max-w-[74%]">
                        <BubbleContent class="!px-3 !py-2 !text-[13px] !leading-relaxed" :class="mine ? '!text-black' : ''">
                            <component :is="() => mdNodes" />
                            <div v-if="error" class="mt-1 text-[11px]">{{ error }}</div>
                        </BubbleContent>
                    </Bubble>
                    <button
                        v-if="copyLabel"
                        type="button"
                        class="mt-0.5 cursor-pointer border-0 bg-transparent p-0 text-[11px] text-muted-foreground outline-none hover:text-foreground"
                        @click="emit('copy')">
                        {{ copyLabel }}
                    </button>
                </template>

        <MessageFooter
            v-if="meta"
            class="!px-0 !text-[11px]"
            :class="[metaDanger ? '!text-destructive' : '', mine ? 'justify-end' : '']">
            {{ meta }}
        </MessageFooter>
    </div>
</template>
