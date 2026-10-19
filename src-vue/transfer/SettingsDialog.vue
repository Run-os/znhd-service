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
 *
 * 迁移到 daisyUI：`fieldset` + `fieldset-legend` + `label`（设置项）、
 * `input`（中继地址）、`toggle`（开关）、`btn`（按钮）。
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
        <fieldset class="fieldset">
            <legend class="fieldset-legend">中继服务器地址</legend>
            <input
                v-model="relayDraft"
                type="text"
                class="input w-full"
                placeholder="https://你的服务器:端口"
                @blur="onBlur"
                @keydown.enter.prevent="commitRelay(relayDraft)" />
            <p class="label whitespace-normal">
                手机上传的图片 / 文本经此服务器转发到本机。修改后点其他区域或按回车生效；留空失焦恢复默认地址。
            </p>
        </fieldset>

        <fieldset class="fieldset">
            <legend class="fieldset-legend">收到内容时自动打开传输助手</legend>
            <input
                type="checkbox"
                class="toggle"
                :checked="store.settings.autoOpenOnReceive"
                @change="updateTransferSettings({ autoOpenOnReceive: ($event.target as HTMLInputElement).checked })" />
            <p class="label whitespace-normal">关闭时仅累计未读角标，不打扰；窗口已开着则只累加，不强行切换会话。</p>
        </fieldset>

        <div class="mt-2 border-t border-base-300 pt-3">
            <template v-if="!confirmClear">
                <button class="btn btn-error btn-sm" @click="confirmClear = true">清空全部传输记录</button>
            </template>
            <div v-else class="alert alert-error alert-soft alert-vertical">
                <div>
                    <div class="text-[13px]">清空全部传输记录</div>
                    <div class="text-xs">
                        所有会话的图片与文本都会被移除（仅清理本机内存，不影响手机上的文件）
                    </div>
                </div>
                <div class="flex justify-end gap-2">
                    <button class="btn btn-outline btn-sm" @click="confirmClear = false">取消</button>
                    <button class="btn btn-error btn-sm" @click="doClearAll">清空</button>
                </div>
            </div>
        </div>

        <template #footer>
            <button class="btn btn-sm" @click="closeWithCommit">完成</button>
        </template>
    </DarkDialog>
</template>
