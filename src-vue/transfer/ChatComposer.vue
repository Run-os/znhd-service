<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Icon, type IconName } from '@vue/icons';
import { Button } from '@vue/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupTextarea } from '@vue/components/ui/input-group';
import EmojiPanel from './EmojiPanel.vue';
import type { PickedEmoji } from './types';

/**
 * 聊天输入区（对齐 React 版 `ChatComposer` 的微信桌面版结构）：
 *   ┌────────────────────────────────┐
 *   │ 😀 🖼 📎        ← 工具栏图标行（上）│
 *   │ ┌────────────────────────────┐ │
 *   │ │ 多行文本（自动增高）   [发送] │ │ ← 官方 InputGroup（Textarea + block-end addon）
 *   │ └────────────────────────────┘ │
 *   └────────────────────────────────┘
 *
 * ⚠️ 三条从 React 版带过来的结论（都对应过真实 bug）：
 *  ① 文本域**自己禁掉 outline / boxShadow**（InputGroup 只管外框聚焦环），避免「框里套框」；
 *  ② 行高必须固定 20px，并按 `scrollHeight` 重算高度 —— 否则「打一个字再删空，
 *     输入框永久变高」；
 *  ③ 表情面板用 `absolute` 挂在输入卡片上（不用 Popover）：它本来就在影子树里，
 *     不需要 portal，也就没有「浮层挂到 body 后样式全丢」的风险。
 */
const props = withDefaults(
    defineProps<{
        modelValue: string;
        disabled?: boolean;
        placeholder?: string;
        /** 输入面板上方的提示行（无在线手机等），纯文本 */
        notice?: string;
        /** 表情之后的附加功能按钮 */
        actions?: Array<{ key: string; label: string; tooltip?: string; icon: IconName; onClick: () => void; disabled?: boolean }>;
        /** 是否支持发表情（没有回调时不显示为可用） */
        emojiEnabled?: boolean;
    }>(),
    { disabled: false, placeholder: '', notice: '', actions: () => [], emojiEnabled: true }
);

const emit = defineEmits<{
    (e: 'update:modelValue', v: string): void;
    (e: 'send'): void;
    (e: 'pickEmoji', emoji: PickedEmoji): void;
}>();

const root = ref<HTMLElement | null>(null);
const emojiOpen = ref(false);

const MIN_H = 40;
const MAX_H = 120;

/** textarea 在 InputGroupTextarea 内部，用 DOM 查询取元素（组件 ref 拿到的是组件实例） */
function textareaEl(): HTMLTextAreaElement | null {
    return root.value?.querySelector('textarea') ?? null;
}

function autoGrow() {
    const el = textareaEl();
    if (!el) return;
    el.style.height = 'auto';
    const h = Math.min(Math.max(el.scrollHeight, MIN_H), MAX_H);
    el.style.height = h + 'px';
    el.style.overflowY = el.scrollHeight > MAX_H ? 'auto' : 'hidden';
}

watch(
    () => props.modelValue,
    () => nextTick(autoGrow)
);

function onInput(e: Event) {
    const el = e.target as HTMLTextAreaElement;
    emit('update:modelValue', el.value);
    autoGrow();
}

function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (!sendDisabled.value) emit('send');
}

/** 发送按钮可用性：有非空白内容且输入区整体可用（与原 React 版 canSend 默认值一致） */
const sendDisabled = computed(() => !!props.disabled || !props.modelValue.trim());

function pickEmoji(emoji: PickedEmoji) {
    // 点一张就收起面板（点击落在面板内部，外点关闭逻辑不会触发）
    emojiOpen.value = false;
    emit('pickEmoji', emoji);
}

/**
 * 点面板之外收起。
 * ⚠️ 必须用 `composedPath()` 判内外：事件冒泡到 document 时 `event.target` 会被
 * 重定向成影子宿主 `<div id="__znhd_panel_host__">`，用 `contains(target)` 永远为 false。
 */
function onDocDown(e: MouseEvent) {
    const path = e.composedPath() as unknown as Array<{ getAttribute?: (n: string) => string | null }>;
    const inPanel = path.some((el) => el && typeof el.getAttribute === 'function' && el.getAttribute('data-emoji-panel') === '1');
    const onTrigger = path.some((el) => el && typeof el.getAttribute === 'function' && el.getAttribute('aria-label') === '表情');
    if (!inPanel && !onTrigger) emojiOpen.value = false;
}

watch(emojiOpen, (open) => {
    if (open) document.addEventListener('mousedown', onDocDown, true);
    else document.removeEventListener('mousedown', onDocDown, true);
});

onBeforeUnmount(() => document.removeEventListener('mousedown', onDocDown, true));
</script>

<template>
    <div
        ref="root"
        class="znhd-chat-composer relative mx-3 mb-3 flex shrink-0 flex-col rounded-xl border border-border bg-card px-3 pb-2.5 pt-2">
        <!-- 表情面板：贴在输入卡片上方 -->
        <div
            v-if="emojiOpen"
            class="absolute bottom-full left-0 z-30 mb-2 rounded-[10px] border border-border bg-popover p-2.5 shadow-[0_8px_28px_rgba(0,0,0,0.55)]">
            <EmojiPanel @pick="pickEmoji" />
        </div>

        <div v-if="notice" class="mb-1.5 text-xs text-warning">{{ notice }}</div>

        <!-- 工具栏（微信把这一行放在输入框上面）：官方 Button 的 ghost 图标态 -->
        <div class="mb-1 flex items-center gap-0.5">
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="表情"
                :title="emojiEnabled ? '表情包（点一张直接发送到手机，悬停可放大）' : '当前对话不支持发送表情'"
                :disabled="disabled || !emojiEnabled"
                class="text-muted-foreground hover:text-foreground"
                @click="emojiOpen = !emojiOpen">
                <Icon name="smile" :size="16" />
            </Button>
            <Button
                v-for="a in actions"
                :key="a.key"
                variant="ghost"
                size="icon-sm"
                :aria-label="a.label"
                :title="a.tooltip || a.label"
                :disabled="a.disabled || disabled"
                class="text-muted-foreground hover:text-foreground"
                @click="a.onClick()">
                <Icon :name="a.icon" :size="15" />
            </Button>
        </div>

        <!-- 输入框 = 官方 InputGroup：Textarea 在左，发送按钮作为 block-end addon -->
        <InputGroup class="border-input">
            <InputGroupTextarea
                :model-value="modelValue"
                :placeholder="placeholder"
                :disabled="disabled"
                rows="2"
                class="max-h-[120px] min-h-[40px] text-sm leading-5 text-foreground placeholder:text-muted-foreground"
                style="min-height: 40px; box-shadow: none"
                @input="onInput"
                @keydown="onKeydown" />
            <InputGroupAddon align="block-end" class="justify-end pt-0">
                <Button
                    size="xs"
                    :variant="sendDisabled ? 'ghost' : 'secondary'"
                    :disabled="sendDisabled"
                    aria-label="发送"
                    class="min-w-[64px]"
                    @click="emit('send')">
                    <Icon name="send" :size="13" />
                    发送
                </Button>
            </InputGroupAddon>
        </InputGroup>
    </div>
</template>
