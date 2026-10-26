<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Icon, type IconName } from '@vue/icons';

/**
 * 聊天输入舱（v26.10.26-v8）—— 由「textarea + 下方一行按钮」改为「一个外壳包住全部元素」。
 *
 *   外壳（唯一视觉框：border + 底色 + 小圆角，flex items-end）
 *   ├─ details.dropdown（附件菜单触发，官方 details 式）+ 发送按钮
 *   └─ textarea（透明、无边框，融进外壳，宽度 flex-1）
 *
 * 关键约束（改动前请先读）：
 *  ① 视觉框在外壳 div 上，**不是** textarea 自己的框 —— daisyUI 的 textarea 自带
 *     border / 背景 / 圆角 / resize 手柄 / focus outline，不压掉就会「框里套框」，
 *     所以 textarea 上要显式写 border-0 rounded-none bg-transparent shadow-none
 *     resize-none px-0 min-h-0 以及 focus/disabled 三态的同名覆盖；
 *  ② 圆角克制：外壳只用 rounded-lg（8px，长方形 + 四角微圆），textarea 自身
 *     rounded-none 彻底无圆角（daisyUI 默认圆角取 --radius-field，cupcake 主题下
 *     是 2rem，不写 rounded-none 会变成胶囊）；
 *  ③ ⚠️ 别改回 SFC 的 style scoped：脚本端把 CSS 以 style.css?inline 字符串注入
 *     **影子树**（见 src-vue/main.ts），而 SFC scoped 样式只会进 document.head，
 *     在影子树里一条都不生效（v8 实测：textarea 仍带边框 + 胶囊圆角 + 拖拽手柄）。
 *     组件内兜底只能靠工具类（两端构建都会编译模板里的类名）；
 *  ④ 自动增高走 JS（scrollHeight + 夹紧），**不能用 field-sizing-content**
 *     （超浏览器基线：Chrome/Edge 88+ / FF 85+ / Safari 14+ 不认）；
 *  ⑤ 高度重算必须先置 height=auto 再读 scrollHeight，否则「打一个字再删空，
 *     输入框永久变高」（历史 bug，回归过两次）；
 *  ⑥ 冒烟钉死了两件事：textarea 必须保留官方 textarea 类名；
 *     外壳下必须恰好 2 个带 aria-label 的圆形控件（附件 summary + 发送 button），
 *     所以不要给外壳或 textarea 加 aria-label，也不要把按钮再包一层。
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

/** 单行高度：py-1.5 (6+6) + leading-5 (20) = 32，与 btn-sm btn-circle 的 32x32 齐平 */
const MIN_H = 32;
/** 上限 = 内边距 12 + 6 行 x 20 = 132，整行不截断；超过后内部滚动 */
const MAX_H = 132;

function textareaEl(): HTMLTextAreaElement | null {
    return root.value?.querySelector('textarea') ?? null;
}

function autoGrow() {
    const el = textareaEl();
    if (!el) return;
    // ⚠️ 必须先回 auto：否则读到的 scrollHeight 会被上一次的内联 height 撑住，
    //    删空文本后永远回不到单行高。
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

/** 附件下拉：官方 details.dropdown 结构。details 只在点 summary 时开合，
 *  **点外部不会自动收** —— 这里补一个 document 上的 pointerdown 监听兜「点空白处收起」。
 *  影子树里事件的 target 会被重定向成宿主元素，所以用 composedPath() 判断是否点在菜单内
 *  （否则点菜单项也会被当成外部点击）。 */
const attachDd = ref<HTMLDetailsElement | null>(null);

function onDocPointerDown(e: PointerEvent) {
    const dd = attachDd.value;
    if (!dd?.open) return;
    if (e.composedPath().includes(dd)) return;
    dd.open = false;
}

onMounted(() => {
    document.addEventListener('pointerdown', onDocPointerDown, true);
    // 初始值可能非空（会话草稿回填），挂载后先算一次高度
    autoGrow();
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointerDown, true));

/** 点附件项后收起下拉 */
function pickAttach(fn: () => void) {
    fn();
    if (attachDd.value) attachDd.value.open = false;
}
</script>

<template>
    <!-- 外壳 = 唯一的视觉框：长方形 + 四角小圆角（rounded-lg），底对齐让按钮与单行文本齐平。
         ⚠️ 外壳**不要**挂 disabled 的透明度弱化：客户端发送文本时 :disabled 会瞬态变 true，
         整舱 opacity-60 会让每发一条消息闪一下；禁用态交给 textarea 与 daisyUI 的 :disabled。 -->
    <div
        ref="root"
        class="flex w-full items-end gap-1 rounded-lg border border-base-300 bg-base-100 px-2 py-1.5">
        <!-- 官方 details 式 dropdown：summary 开合，点外部由上面的 pointerdown 监听收起。
             ⚠️ summary 必须带 flex（block 级）：它默认是 inline-flex，而 details 从上层容器
             继承了 42px 的绝对行高，inline 级子元素会在 details 里生成 42px 的行盒，
             把外壳从 46 撑到 56（实测过，别删）。 -->
        <details v-if="attach.length" ref="attachDd" class="dropdown dropdown-top">
            <summary
                class="btn btn-ghost btn-sm btn-circle list-none flex"
                aria-label="添加图片或文件"
                title="添加图片或文件">
                <Icon name="plus" :size="14" />
            </summary>
            <ul class="menu dropdown-content z-1 w-44 rounded-box bg-base-100 p-2 shadow-sm">
                <li v-for="a in attach" :key="a.key">
                    <!-- ⚠️ 不能把 a.disabled 落到 button 的 disabled 上（v26.10.26-v10，使用者反馈
                         「+ 菜单点不动」）：daisyUI 的 .menu 给禁用项加 pointer-events: none，
                         点下去连 click 事件都没有、也没有任何提示，看起来就是按钮坏了。
                         现在只用透明度做「暂不可用」的视觉提示，真正的拦截交给 a.onClick 里的
                         toast 说明原因；整个输入区被禁用（disabled prop）时才真的禁掉。
                         type="button"：脚本端这个菜单在 <form> 里，默认 type=submit 会顺带提交表单。 -->
                    <button
                        type="button"
                        :disabled="disabled"
                        :class="a.disabled ? 'opacity-50' : ''"
                        @click="pickAttach(a.onClick)">
                        <Icon :name="a.icon" :size="15" />
                        {{ a.label }}
                    </button>
                </li>
            </ul>
        </details>

        <!-- 中间文本域：把 daisyUI textarea 的边框/底色/圆角/resize 手柄全部压平，
             只留外壳那一层视觉；min-w-0 + flex-1 让它撑满中间并可在窄屏压缩
             （长文本不会把发送按钮挤出外壳）。 -->
        <textarea
            v-model="model"
            class="textarea min-h-0 w-full min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-1.5 text-sm leading-5 shadow-none outline-none focus:border-0 focus:bg-transparent focus:shadow-none focus:outline-none disabled:border-0 disabled:bg-transparent disabled:shadow-none"
            :placeholder="placeholder"
            :disabled="disabled"
            rows="1"
            @input="autoGrow"
            @keydown="onKeydown"></textarea>

        <!-- 不再需要 ml-auto：textarea 的 flex-1 已经把它推到右侧 -->
        <button
            class="btn btn-primary btn-sm btn-circle"
            :disabled="sendDisabled"
            aria-label="发送"
            title="发送（Enter）"
            @click="emit('send')">
            <Icon name="send" :size="14" />
            <span class="sr-only">发送</span>
        </button>
    </div>
</template>
