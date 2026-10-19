<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Icon, type IconName } from '@vue/icons';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@vue/components/ui/dropdown-menu';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from '@vue/components/ui/input-group';

/**
 * 聊天输入区（v26.10.18-v8）：**照搬 message-scroller 示例的写法** ——
 *
 *   InputGroup
 *     ├─ InputGroupTextarea                  文本域（整宽、无内边框）
 *     └─ InputGroupAddon(align="block-end")  底栏：左侧「+」下拉（图片 / 文件），右侧 `ml-auto` 发送
 *
 * 示例里「+」用的是 DropdownMenu，这里保持同款：附件入口收进下拉，输入区只剩
 * 一个加号 + 一个上箭头，不再有横排的工具栏按钮。
 *
 * ⚠️ 两条从 React 版带过来的结论（都对应过真实 bug）：
 *  ① 文本域**自己禁掉 outline / boxShadow**（InputGroup 只管外框聚焦环），避免「框里套框」；
 *  ② 行高必须固定 20px，并按 `scrollHeight` 重算高度 —— 否则「打一个字再删空，
 *     输入框永久变高」。
 *
 * v26.10.19：「+」与发送按钮整体缩小 30%（40px → 28px = `size-7`，图标 20 → 14），
 * 标题栏按钮与「滚动到底部」按钮都跟这个尺寸对齐。
 */
const props = withDefaults(
    defineProps<{
        modelValue: string;
        disabled?: boolean;
        placeholder?: string;
        /** 「+」下拉里的附件入口（图片 / 文件） */
        attach?: Array<{
            key: string;
            label: string;
            icon: IconName;
            onClick: () => void;
            disabled?: boolean;
        }>;
    }>(),
    { disabled: false, placeholder: '', attach: () => [] }
);

const emit = defineEmits<{
    (e: 'update:modelValue', v: string): void;
    (e: 'send'): void;
}>();

const root = ref<HTMLElement | null>(null);

const MIN_H = 56; // 示例同款 h-14：两行高的输入区
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

const model = computed({
    get: () => props.modelValue,
    set: (v: string) => emit('update:modelValue', v),
});

watch(
    () => props.modelValue,
    () => nextTick(autoGrow)
);

function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (!sendDisabled.value) emit('send');
}

/** 发送按钮可用性：有非空白内容且输入区整体可用 */
const sendDisabled = computed(() => !!props.disabled || !props.modelValue.trim());
</script>

<template>
    <div ref="root" class="w-full">
        <!-- v26.10.18-v9：参考 ChatGPT 式深色输入舱 —— 大圆角容器，文本在上、按钮行在下
             v26.10.19-v12：底色/描边走 var(--tw-*)，跟随日/夜模式（脚本端由 transfer/theme.ts 给，
             手机页由 web/src/style.css 的 :root 给同值暗色，两端仍是同一个输入舱） -->
        <InputGroup class="!rounded-3xl !border-[var(--tw-composer-border)] !bg-[var(--tw-composer-bg)] !shadow-none">
            <InputGroupTextarea
                v-model="model"
                :placeholder="placeholder"
                :disabled="disabled"
                rows="1"
                class="max-h-[120px] text-sm leading-5 text-foreground placeholder:text-muted-foreground !px-4 !pt-3"
                style="min-height: 56px; box-shadow: none"
                @input="autoGrow"
                @keydown="onKeydown" />

            <InputGroupAddon align="block-end" class="!px-3 !pb-3 !pt-1">
                <DropdownMenu v-if="attach.length">
                    <DropdownMenuTrigger as-child>
                        <InputGroupButton
                            size="icon-sm"
                            variant="outline"
                            class="!size-7 !rounded-full !border-[var(--tw-btn-border)] !bg-transparent !text-foreground"
                            aria-label="添加图片或文件"
                            title="添加图片或文件"
                            :disabled="disabled">
                            <Icon name="plus" :size="14" />
                        </InputGroupButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top" class="w-44">
                        <DropdownMenuItem
                            v-for="a in attach"
                            :key="a.key"
                            :disabled="a.disabled || disabled"
                            @select="a.onClick()">
                            <Icon :name="a.icon" :size="15" />
                            {{ a.label }}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>

                <InputGroupButton
                    size="icon-sm"
                    variant="default"
                    class="ml-auto !size-7 !rounded-full !text-white"
                    :disabled="sendDisabled"
                    aria-label="发送"
                    title="发送（Enter）"
                    @click="emit('send')">
                    <Icon name="send" :size="14" />
                    <span class="sr-only">发送</span>
                </InputGroupButton>
            </InputGroupAddon>
        </InputGroup>
    </div>
</template>
