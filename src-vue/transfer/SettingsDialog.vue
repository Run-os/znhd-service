<script setup lang="ts">
import { ref, watch } from 'vue';
import { addLog } from '@/lib/logger';
import { DEFAULT_RELAY_SERVER } from '@/lib/transfer/settings';
import { clearAllTransferFiles, updateTransferSettings } from '@/lib/transfer/store';
import { useTransferStore } from '@vue/composables/useTransferStore';
import DarkDialog from './DarkDialog.vue';

/**
 * 传输助手的独立设置面板（React 版 `TransferSettingsModal` 的等价实现）。
 *
 * 中继地址用**草稿 + 失焦/回车提交**：`updateTransferSettings` 在地址变化时会
 * 重启轮询与长轮询，逐字提交会让输入 "https://…" 的每个合法前缀都触发一次重连。
 */
const open = defineModel<boolean>('open', { default: false });

const store = useTransferStore();
const relayDraft = ref(store.value.settings.relayServer);
const confirmClear = ref(false);

/** 打开时灌草稿；关闭时补交未提交的草稿（点 X / 遮罩关闭时输入框不一定失焦） */
watch(open, (v) => {
    if (v) {
        relayDraft.value = store.value.settings.relayServer;
        confirmClear.value = false;
    } else {
        commitRelay(relayDraft.value);
    }
});

function commitRelay(val: string) {
    const url = (val || '').trim().replace(/\/+$/, '');
    if (url && url !== store.value.settings.relayServer) updateTransferSettings({ relayServer: url });
}

/** 关闭前把未提交的草稿补交（点 X / 遮罩关闭时输入框不一定失焦） */
function closeWithCommit() {
    commitRelay(relayDraft.value);
    open.value = false;
}

function onBlur() {
    const url = (relayDraft.value || '').trim();
    if (!url) {
        // 清空并失焦 → 回填默认地址（与主面板常用语地址同一交互）
        relayDraft.value = DEFAULT_RELAY_SERVER;
        commitRelay(DEFAULT_RELAY_SERVER);
    } else {
        commitRelay(url);
    }
}

function doClearAll() {
    clearAllTransferFiles();
    addLog('[传输助手] 已清空全部传输记录', 'success');
    confirmClear.value = false;
}
</script>

<template>
    <DarkDialog v-model:open="open" title="传输助手设置" :width="480">
        <div class="mb-2 font-semibold text-white/90">中继服务器地址</div>
        <input
            v-model="relayDraft"
            placeholder="https://你的服务器:端口"
            class="h-9 w-full rounded-md border border-white/20 bg-white/[0.06] px-2.5 text-sm text-white/90 outline-none placeholder:text-white/30 focus:border-[#07C160]"
            @blur="onBlur"
            @keydown.enter.prevent="commitRelay(relayDraft)" />
        <div class="mb-4 mt-2 text-xs text-white/45">
            手机上传的图片 / 文本经此服务器转发到本机。修改后点其他区域或按回车生效；留空失焦恢复默认地址。
        </div>

        <div class="mb-1 flex items-center gap-2">
            <span class="font-semibold text-white/90">收到内容时自动打开传输助手</span>
            <button
                type="button"
                role="switch"
                :aria-checked="store.settings.autoOpenOnReceive"
                class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-0 p-0 outline-none transition-colors"
                :class="store.settings.autoOpenOnReceive ? 'bg-[#07C160]' : 'bg-white/25'"
                @click="updateTransferSettings({ autoOpenOnReceive: !store.settings.autoOpenOnReceive })">
                <span
                    class="block size-4 rounded-full bg-white shadow-[0_2px_4px_rgba(0,35,11,0.2)] transition-transform"
                    :class="store.settings.autoOpenOnReceive ? 'translate-x-[18px]' : 'translate-x-0.5'" />
            </button>
        </div>
        <div class="mb-4 text-xs text-white/45">
            关闭时仅累计未读角标，不打扰；窗口已开着则只累加，不强行切换会话。
        </div>

        <div class="border-t border-white/10 pt-3">
            <div v-if="!confirmClear" class="flex">
                <button
                    type="button"
                    class="cursor-pointer rounded-[6px] border border-[#ff4d4f]/50 bg-transparent px-3 py-1 text-[13px] text-[#ff7875] outline-none hover:bg-[#ff4d4f]/15"
                    @click="confirmClear = true">
                    清空全部传输记录
                </button>
            </div>
            <div v-else class="rounded-[8px] border border-[#ff4d4f]/35 bg-[#ff4d4f]/10 p-3">
                <div class="mb-1 text-[13px] text-white/90">清空全部传输记录</div>
                <div class="mb-2 text-xs text-white/50">
                    所有会话的图片与文本都会被移除（仅清理本机内存，不影响手机上的文件）
                </div>
                <div class="flex justify-end gap-2">
                    <button
                        type="button"
                        class="cursor-pointer rounded border border-white/15 bg-transparent px-2.5 py-0.5 text-xs text-white/70 outline-none hover:bg-white/10"
                        @click="confirmClear = false">
                        取消
                    </button>
                    <button
                        type="button"
                        class="cursor-pointer rounded border-0 bg-[#E81123] px-2.5 py-0.5 text-xs text-white outline-none hover:bg-[#c50f1f]"
                        @click="doClearAll">
                        清空
                    </button>
                </div>
            </div>
        </div>

        <template #footer>
            <button
                type="button"
                class="cursor-pointer rounded-[6px] border-0 bg-[#07C160] px-4 py-1 text-sm text-white outline-none hover:bg-[#06AD56]"
                @click="closeWithCommit">
                完成
            </button>
        </template>
    </DarkDialog>
</template>
