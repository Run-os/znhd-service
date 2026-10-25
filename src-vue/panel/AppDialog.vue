<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@vue/icons';
import { useNativeDialog } from '@vue/composables/useNativeDialog';

/**
 * 弹窗外壳：**daisyUI 原生 `modal`**（`<dialog class="modal">`）。
 *
 * 结构严格照 skill/components/modal.md：
 *   <dialog class="modal">
 *     <div class="modal-box">{CONTENT}</div>
 *     <form method="dialog" class="modal-backdrop"><button>close</button></form>
 *   </dialog>
 *
 * 开关由原生 `showModal()` / `close()` 驱动（skill 推荐方式），
 * 因此焦点陷阱、Esc 关闭、背景锁定全部由浏览器提供，不再需要 reka-ui。
 * 开/关的机械同步收敛在 `useNativeDialog` composable（v26.10.25-v8）。
 *
 * 宽度用官方允许的方式覆盖（modal 文档：可用任意 w-/max-w- 工具类），
 * 其余视觉一律交给 `modal-box` 默认值。
 *
 * ── variant（v26.10.25-v8：吸收原 transfer/DarkDialog.vue，后者已删除）────────
 * 两壳机械结构相同，视觉差异只有三处，全部参数化：
 *   · header：default = 标题行 flex 占满（#title 插槽可放「标题 + 动作按钮」）；
 *     plain = 标题 truncate（传输窗原 DarkDialog 行为），关闭钮带 btn-sm（32px）；
 *   · footer：default = `footer` prop（默认 true，渲染「确定」兜底钮）；
 *     plain = 只有调用方给 #footer 插槽才渲染（无默认钮）。
 * 其余（modal-box 尺寸/背板/backdrop）逐像素等价。
 */
const open = defineModel<boolean>('open', { default: false });

const props = withDefaults(
    defineProps<{
        title: string;
        description?: string;
        width?: number;
        height?: number;
        footer?: boolean;
        /** 'plain' = 原传输窗 DarkDialog 壳：标题 truncate + btn-sm 关闭钮 + 无默认确定钮 */
        variant?: 'default' | 'plain';
    }>(),
    {
        description: '',
        width: 520,
        /** 固定高度（px）。给值 = 弹窗高度钉死、内容区内部滚动（切页不改变窗口大小）；不传 = 高度随内容 */
        height: 0,
        footer: true,
        variant: 'default',
    }
);

const dlg = ref<HTMLDialogElement | null>(null);

useNativeDialog(open, dlg);

const plain = computed(() => props.variant === 'plain');

/** modal-box 内联样式：width 恒有；height > 0 时再钉死高度（配合 flex 列布局让内容区吃满剩余空间） */
const boxStyle = computed(() => {
    const s: Record<string, string> = { width: props.width + 'px', maxWidth: 'calc(100vw - 32px)' };
    if (props.height > 0) s.height = props.height + 'px';
    return s;
});
</script>

<template>
    <dialog ref="dlg" class="modal" @close="open = false">
        <div class="modal-box" :class="{ 'flex flex-col': props.height > 0 }" :style="boxStyle">
            <div class="flex items-center justify-between gap-3">
                <!-- flex + gap：#title 插槽里「标题文本 + 动作按钮」横排且不重叠。
                     h3 flex-1：占满除关闭 × 以外的整行宽度，插槽里的 ml-auto 才能真正把按钮推到右侧 -->
                <h3
                    :class="
                        plain
                            ? 'min-w-0 truncate text-[15px] font-semibold leading-6'
                            : 'flex min-w-0 flex-1 items-center gap-2 text-[15px] font-semibold leading-6'
                    ">
                    <!-- #title 供需要「标题 + 动作按钮」的弹窗用（如图片嗅探的「重新扫描」） -->
                    <slot name="title">{{ props.title }}</slot>
                </h3>
                <form method="dialog">
                    <!-- 不用 btn-sm：btn-circle 默认 40px 才够密集桌面 UI 的最小命中区（skill: hit area）；
                         plain 档保留原传输窗的 32px（btn-sm btn-circle） -->
                    <button :class="plain ? 'btn btn-ghost btn-sm btn-circle' : 'btn btn-ghost btn-circle'" aria-label="关闭">
                        <Icon name="close" :size="15" />
                    </button>
                </form>
            </div>

            <!-- height > 0 = 固定高度弹窗：内容区包一层吃满剩余高度、内部滚动（切页不撑大窗口）；
                 不传 height 时保持原结构（slot 直接渲染，高度随内容），不影响其他弹窗 -->
            <div v-if="props.height > 0" class="min-h-0 flex-1 overflow-y-auto">
                <slot />
            </div>
            <template v-else>
                <slot />
            </template>

            <!-- default：footer=false 表示不要默认按钮；调用方给了 #footer 插槽时仍要渲染。
                 plain：只有 #footer 插槽才渲染（原 DarkDialog 行为，无「确定」兜底钮） -->
            <div v-if="plain ? !!$slots.footer : props.footer || $slots.footer" class="modal-action">
                <slot name="footer">
                    <button class="btn btn-sm" @click="open = false">确定</button>
                </slot>
            </div>
        </div>
        <form method="dialog" class="modal-backdrop">
            <button>close</button>
        </form>
    </dialog>
</template>
