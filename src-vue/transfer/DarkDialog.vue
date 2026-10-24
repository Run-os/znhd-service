<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { Icon } from '@vue/icons';

/**
 * 传输助手窗口的弹窗壳（配对 / 企业信息 / 文件共用）—— **daisyUI 原生 `modal`**。
 *
 * 与 `panel/AppDialog.vue` 同一套官方结构（skill/components/modal.md）。
 * 之前这里靠 reka-ui 的 Portal + 手写 z-index 盖住传输窗口；
 * 改用原生 `<dialog>` 后由浏览器的 top layer 负责层级，不再需要 portal 与 z 管理，
 * 也因此不再脱离影子树（不会丢主题变量）。
 */
const open = defineModel<boolean>('open', { default: false });
const props = withDefaults(defineProps<{ title: string; description?: string; width?: number }>(), {
    description: '',
    width: 520,
});

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
                <h3 class="min-w-0 truncate text-[15px] font-semibold leading-6">{{ props.title }}</h3>
                <form method="dialog">
                    <button class="btn btn-ghost btn-sm btn-circle" aria-label="关闭">
                        <Icon name="close" :size="15" />
                    </button>
                </form>
            </div>

            <slot />

            <div v-if="$slots.footer" class="modal-action">
                <slot name="footer" />
            </div>
        </div>
        <form method="dialog" class="modal-backdrop">
            <button>close</button>
        </form>
    </dialog>
</template>
