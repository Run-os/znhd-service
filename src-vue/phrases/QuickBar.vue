<script setup lang="ts">
import type { QuickReplyRule } from '@/lib/feishu/types';
import { Icon } from '@vue/icons';

/**
 * 输入框上方的快捷回复按钮条（v26.10.23，v26.10.25-v1 起三段内容）。
 *
 * 形态：最多两行可横向滚动的胶囊按钮 ——
 *   · 上行「隐私信息」（可选）：独立表格的全量速查条目，永远显示，不参与匹配；
 *   · 下行「快捷短语」：常显规则（pinned，排最前）+ 竖向分割线 + 普通命中规则。
 * 点一下把该规则的 `内容` **整体替换**进会话输入框（不是追加 —— 使用者要求「替换」）。
 *
 * ── 为什么要横向滚动而不是换行 ────────────────────────────────────────────────
 * 输入框上方是页面里最宝贵的垂直空间，换行会把 TinyMCE 往下顶、挤压聊天区；
 * `overflow-x: auto` + `flex-nowrap` 让高度恒为一行，多了就横滑。
 *
 * ── 配色 ──────────────────────────────────────────────────────────────────────
 * 不使用 `btn-primary`：这条按钮条常驻在输入框上方，主色块会抢走发送按钮的视觉焦点。
 * 用 `btn-outline` + 悬浮转 primary 描边，静息时足够轻。
 * 隐私栏标签用 `text-warning`（色相区分 + 语义类，不写死 hex）——
 * ⚠️ 影子树里所有颜色走 daisyUI 语义类（base-content / primary / warning），
 *    站点主题被外层改写时才能跟着变。
 */
const props = defineProps<{
    /** 常显规则（规则表「是否常显」= true，排在快捷短语栏最前方，v26.10.25-v1） */
    pinned: QuickReplyRule[];
    /** 普通命中规则（已按 id 去掉 pinned，避免重复显示） */
    rules: QuickReplyRule[];
    /** 隐私信息条目（独立表格全量常显，v26.10.25-v1） */
    privacy: QuickReplyRule[];
}>();

const emit = defineEmits<{
    /** 选中某条规则（由宿主负责展开魔法变量并写入输入框） */
    pick: [QuickReplyRule];
}>();

function onClick(rule: QuickReplyRule): void {
    emit('pick', rule);
}
</script>

<template>
    <!-- 任一段有内容才渲染：全空时宿主页面上不应多出任何占位（高度必须为 0） -->
    <div
        v-if="props.pinned.length || props.rules.length || props.privacy.length"
        data-znhd="quick-reply-bar"
        class="flex flex-col gap-0.5 py-1">
        <!-- 隐私信息栏（v26.10.25-v1）：主栏上方独立一行，自己的横向滚动容器 -->
        <div v-if="props.privacy.length" class="flex items-center gap-2">
            <span class="flex shrink-0 items-center gap-1 text-[12px] text-warning">
                <Icon name="lock" :size="13" />
                隐私信息
            </span>
            <!-- 横向滚动区：min-w-0 必不可少，否则 flex 子项默认 min-width:auto 会把整条撑出容器 -->
            <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5" style="scrollbar-width: thin">
                <button
                    v-for="rule in props.privacy"
                    :key="rule.id"
                    data-znhd="quick-reply-privacy-btn"
                    type="button"
                    class="btn btn-outline btn-xs shrink-0 rounded-full font-normal hover:border-warning hover:bg-warning/10 hover:text-warning"
                    :title="rule.reply"
                    @click="onClick(rule)">
                    {{ rule.title }}
                </button>
            </div>
        </div>

        <!-- 快捷短语主栏：pinned 最前 + 竖线 + 普通命中 -->
        <div v-if="props.pinned.length || props.rules.length" class="flex items-center gap-2">
            <span class="flex shrink-0 items-center gap-1 text-[12px] text-base-content/50">
                <Icon name="phrases" :size="13" />
                快捷短语
            </span>
            <div class="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5" style="scrollbar-width: thin">
                <!-- 常显规则：忽略标签/排除词，始终显示（对话为空也在） -->
                <button
                    v-for="rule in props.pinned"
                    :key="rule.id"
                    data-znhd="quick-reply-btn"
                    type="button"
                    class="btn btn-outline btn-xs shrink-0 rounded-full font-normal hover:border-primary hover:bg-primary/10 hover:text-primary"
                    :title="'（常显）' + rule.reply"
                    @click="onClick(rule)">
                    {{ rule.title }}
                </button>
                <!-- 竖向分割线：仅在两边都有内容时渲染 -->
                <span
                    v-if="props.pinned.length && props.rules.length"
                    class="h-4 w-px shrink-0 bg-base-content/20"></span>
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
    </div>
</template>
