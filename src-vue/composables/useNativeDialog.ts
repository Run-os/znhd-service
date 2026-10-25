import { onMounted, watch, type Ref } from 'vue';

/**
 * 原生 `<dialog class="modal">` 开关收敛（v26.10.25-v8）。
 *
 * 弹窗壳（AppDialog / ChatWindow / PhrasesSheet / ImagePreview）此前各自手抄同一套
 * 机械逻辑：`watch(open, sync)` + `onMounted(若 open 立即 showModal)` + 模板
 * `@close → open=false`。这里把**相同的部分**收敛成一份：
 *
 *   · open 变 true → `showModal()`（进浏览器 top layer，焦点陷阱 / Esc 免费拿）；
 *   · open 变 false → `close()`（幂等：已关就不再调）；
 *   · 挂载时 open 已为 true → 立即 showModal（v-if 重挂场景不丢状态）。
 *
 * 各壳的**差异留在壳里**：
 *   · `@close="open = false"`（或 emit）仍写在各壳模板上 —— 事件回写方向各家绑定不同；
 *   · 关闭时的副效应（如 PhrasesSheet 收起长话术悬浮提示）走 `onSync` 钩子，
 *     每次 open 同步都会回调一次（与原实现「sync(false) 里顺手 hideTip」等价）。
 *
 * @param open   开关状态（defineModel 的 model ref 或 `computed(() => props.open)`）
 * @param dlg    `<dialog>` 元素 ref
 * @param onSync 可选副效应钩子，参数为本次同步的目标状态
 */
export function useNativeDialog(
    open: Ref<boolean>,
    dlg: Ref<HTMLDialogElement | null>,
    onSync?: (v: boolean) => void
): void {
    function sync(v: boolean): void {
        const el = dlg.value;
        if (!el) return;
        if (v && !el.open) el.showModal();
        else if (!v && el.open) el.close();
        onSync?.(v);
    }

    watch(open, sync);
    onMounted(() => {
        if (open.value) sync(true);
    });
}
