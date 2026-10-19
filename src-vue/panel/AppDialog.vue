<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Icon } from '@vue/icons';

/**
 * 面板侧弹窗外壳：**daisyUI 原生 `modal`**（`<dialog class="modal">`）。
 *
 * 结构严格照 skill/components/modal.md：
 *   <dialog class="modal">
 *     <div class="modal-box">{CONTENT}</div>
 *     <form method="dialog" class="modal-backdrop"><button>close</button></form>
 *   </dialog>
 *
 * 开关由原生 `showModal()` / `close()` 驱动（skill 推荐方式），
 * 因此焦点陷阱、Esc 关闭、背景锁定全部由浏览器提供，不再需要 reka-ui。
 *
 * 宽度用官方允许的方式覆盖（modal 文档：可用任意 w-/max-w- 工具类），
 * 其余视觉一律交给 `modal-box` 默认值。
 */
const open = defineModel<boolean>('open', { default: false });

const props = withDefaults(
    defineProps<{ title: string; description?: string; width?: number; footer?: boolean }>(),
    {
        description: '',
        width: 520,
        footer: true,
    }
);

const dlg = ref<HTMLDialogElement | null>(null);

function sync(v: boolean): void {
    const el = dlg.value;
    if (!el) return;
    if (v && !el.open) el.showModal();
    else if (!v && el.open) el.close();
}

watch(open, (v) => sync(v));
onMounted(() => {
    if (open.value) sync(true);
});
</script>

<template>
    <dialog ref="dlg" class="modal" @close="open = false">
        <div class="modal-box" :style="{ width: props.width + 'px', maxWidth: 'calc(100vw - 32px)' }">
            <div class="flex items-center justify-between gap-3">
                <h3 class="min-w-0 text-[15px] font-semibold leading-6">
                    <!-- #title 供需要「标题 + 动作按钮」的弹窗用（如图片嗅探的「重新扫描」） -->
                    <slot name="title">{{ props.title }}</slot>
                </h3>
                <form method="dialog">
                    <button class="btn btn-ghost btn-sm btn-square" aria-label="关闭">
                        <Icon name="close" :size="15" />
                    </button>
                </form>
            </div>

            <slot />

            <!-- footer=false 表示不要默认按钮；调用方给了 #footer 插槽时仍要渲染 -->
            <div v-if="props.footer || $slots.footer" class="modal-action">
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
