<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { Icon, type IconName } from '@vue/icons';

/**
 * 聊天输入区（v26.10.18-v8）—— 迁移到 daisyUI 原生组件。
 *
 *   textarea（官方 `textarea`）
 *   └─ 下方按钮行：`dropdown`（附件菜单，官方 focus 式，点外部失焦收起）+ `btn-primary`（发送）
 *
 * 之前是 shadcn 的 InputGroup 复合容器；daisyUI 没有等价复合件，
 * 因此按 skill 的做法拆成「textarea + 一行按钮」，全部使用官方类名。
 *
 * ⚠️ 两条从 React 版带过来的结论（都对应过真实 bug）：
 *  ① 文本域**自己禁掉 outline / boxShadow**，避免「框里套框」；
 *  ② 行高必须固定 20px，并按 `scrollHeight` 重算高度 —— 否则「打一个字再删空，
 *     输入框永久变高」。
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

const MIN_H = 56; // 两行高的输入区
const MAX_H = 120;

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

/** 点附件项后收起下拉：focus 式 dropdown 靠焦点显隐，把触发器和被点的菜单项都失焦 */
function pickAttach(e: MouseEvent, fn: () => void) {
    fn();
    const dd = (e.currentTarget as HTMLElement).closest('.dropdown');
    dd?.querySelector<HTMLElement>('[role="button"]')?.blur();
    (e.currentTarget as HTMLElement).blur();
}
</script>

<template>
    <div ref="root" class="w-full">
        <textarea
            v-model="model"
            class="textarea w-full text-sm leading-5"
            :placeholder="placeholder"
            :disabled="disabled"
            rows="1"
            style="min-height: 56px; box-shadow: none"
            @input="autoGrow"
            @keydown="onKeydown"></textarea>

        <div class="mt-1 flex items-center gap-1">
            <!-- 官方 focus 式 dropdown（tabindex 触发）：点外部区域失焦自动收起 -->
            <div v-if="attach.length" class="dropdown dropdown-top">
                <div
                    tabindex="0"
                    role="button"
                    class="btn btn-ghost btn-sm btn-circle"
                    aria-label="添加图片或文件"
                    title="添加图片或文件">
                    <Icon name="plus" :size="14" />
                </div>
                <ul tabindex="-1" class="menu dropdown-content z-1 w-44 rounded-box bg-base-100 p-2 shadow-sm">
                    <li v-for="a in attach" :key="a.key">
                        <button :disabled="a.disabled || disabled" @click="pickAttach($event, a.onClick)">
                            <Icon :name="a.icon" :size="15" />
                            {{ a.label }}
                        </button>
                    </li>
                </ul>
            </div>

            <button
                class="btn btn-primary btn-sm btn-circle ml-auto"
                :disabled="sendDisabled"
                aria-label="发送"
                title="发送（Enter）"
                @click="emit('send')">
                <Icon name="send" :size="14" />
                <span class="sr-only">发送</span>
            </button>
        </div>
    </div>
</template>
