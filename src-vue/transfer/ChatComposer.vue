<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Icon, type IconName } from '@vue/icons';

/**
 * 聊天输入区（v26.10.18-v8）—— 迁移到 daisyUI 原生组件。
 *
 *   textarea（官方 `textarea`）
 *   └─ 下方按钮行：`dropdown`（附件菜单，官方 details 式）+ `btn-primary`（发送）
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

/** 附件下拉：官方 `<details class="dropdown">` 结构（skill/components/dropdown 的 details 语法）。
 *  details 只在点 summary 时开合，**点外部不会自动收** —— 这里补一个 document 上的
 *  pointerdown 监听兜「点空白处收起」。影子树里事件的 `target` 会被重定向成宿主元素，
 *  所以用 `composedPath()` 判断是否点在菜单内（否则点菜单项也会被当成外部点击）。 */
const attachDd = ref<HTMLDetailsElement | null>(null);

function onDocPointerDown(e: PointerEvent) {
    const dd = attachDd.value;
    if (!dd?.open) return;
    if (e.composedPath().includes(dd)) return;
    dd.open = false;
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown, true));

/** 点附件项后收起下拉 */
function pickAttach(fn: () => void) {
    fn();
    if (attachDd.value) attachDd.value.open = false;
}
</script>

<template>
    <div ref="root" class="w-full">
        <textarea
            v-model="model"
            class="textarea min-h-14 w-full text-sm leading-5 shadow-none"
            :placeholder="placeholder"
            :disabled="disabled"
            rows="1"
            @input="autoGrow"
            @keydown="onKeydown"></textarea>

        <div class="mt-1 flex items-center gap-1">
            <!-- 官方 details 式 dropdown（skill/components/dropdown）：summary 开合，
                 点外部由上面的 pointerdown 监听收起（details 自身不会自关） -->
            <details v-if="attach.length" ref="attachDd" class="dropdown dropdown-top">
                <summary
                    class="btn btn-ghost btn-sm btn-circle list-none"
                    aria-label="添加图片或文件"
                    title="添加图片或文件">
                    <Icon name="plus" :size="14" />
                </summary>
                <ul class="menu dropdown-content z-1 w-44 rounded-box bg-base-100 p-2 shadow-sm">
                    <li v-for="a in attach" :key="a.key">
                        <button :disabled="a.disabled || disabled" @click="pickAttach(a.onClick)">
                            <Icon :name="a.icon" :size="15" />
                            {{ a.label }}
                        </button>
                    </li>
                </ul>
            </details>

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
