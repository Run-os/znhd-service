<script setup lang="ts">
import type { QuickReplyRule } from '@/lib/feishu/types';
import { Icon } from '@vue/icons';

/**
 * 输入框上方的快捷回复按钮条（v26.10.23）。
 *
 * 形态：一条可横向滚动的胶囊按钮，一个命中规则一个按钮，点一下把该规则的 `内容`
 * **整体替换**进会话输入框（不是追加 —— 使用者要求「替换」）。
 *
 * ── 为什么要横向滚动而不是换行 ────────────────────────────────────────────────
 * 输入框上方是页面里最宝贵的垂直空间，换行会把 TinyMCE 往下顶、挤压聊天区；
 * `overflow-x: auto` + `flex-nowrap` 让高度恒为一行，多了就横滑。
 *
 * ── 配色 ──────────────────────────────────────────────────────────────────────
 * 不使用 `btn-primary`：这条按钮条常驻在输入框上方，主色块会抢走发送按钮的视觉焦点。
 * 用 `btn-outline` + 悬浮转 primary 描边，静息时足够轻。
 * ⚠️ 影子树里所有颜色走 daisyUI 语义类（base-content / primary），不写死 hex ——
 *    站点主题被外层改写时才能跟着变。
 */
const props = defineProps<{
    rules: QuickReplyRule[];
}>();

const emit = defineEmits<{
    /** 选中某条规则（由宿主负责写入输入框） */
    pick: [QuickReplyRule];
}>();

function onClick(rule: QuickReplyRule): void {
    emit('pick', rule);
}
</script>

<template>
    <!-- 只有命中规则时才渲染：未命中时宿主页面上不应多出任何占位（高度必须为 0） -->
    <div v-if="props.rules.length" data-znhd="quick-reply-bar" class="flex items-center gap-2 py-1">
        <span class="flex shrink-0 items-center gap-1 text-[12px] text-base-content/50">
            <Icon name="phrases" :size="13" />
            常用语
        </span>
        <!-- 横向滚动区：min-w-0 必不可少，否则 flex 子项默认 min-width:auto 会把整条撑出容器 -->
        <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5" style="scrollbar-width: thin">
            <button
                v-for="rule in props.rules"
                :key="rule.id"
                data-znhd="quick-reply-btn"
                type="button"
                class="btn btn-outline btn-xs shrink-0 rounded-full font-normal hover:border-primary hover:bg-primary/10 hover:text-primary"
                :title="rule.reply"
                @click="onClick(rule)">
                {{ rule.title }}
            </button>
        </div>
    </div>
</template>
