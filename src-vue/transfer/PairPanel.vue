<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Icon } from '@vue/icons';
import { addLog } from '@/lib/logger';
import { safeCopyText } from '@/lib/clipboard';
import { getDeviceId } from '@/lib/relay';
import { genQrDataUrl } from '@/lib/qrcode';
import type { PhoneInfo } from '@/lib/transfer/types';

/**
 * 配对面板正文（React 版 `TransferPairPanel` 的等价实现）。
 * 两处复用：第二栏「＋」的配对弹窗、以及**未选中会话时第三栏的空状态**。
 *
 * 迁移到 daisyUI：分区容器 `card` + `card-body`；空态 `hero`；
 * 状态胶囊 `badge`；按钮 `btn`。
 *
 * v26.10.19 精简：去掉顶部「配对设备 / 手机扫码即配对」标题行、无手机时的
 * 「还没有配对的手机」空态与「发送测试图片」按钮。
 * v26.10.20-v14：删掉「已连接手机（N）」设备列表卡片与在线状态文案
 * （会话列表本身就是设备清单，无需重复展示）。
 */
const props = defineProps<{ relayServer: string; phones: PhoneInfo[] }>();

const deviceId = getDeviceId();
const qrUrl = ref('');
const link = ref('');

const phoneOnline = computed(() => props.phones.length > 0);

function refreshLink() {
    const s = (props.relayServer || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(s)) {
        link.value = '';
        qrUrl.value = '';
        return;
    }
    const lk = s + '/u/' + deviceId;
    link.value = lk;
    genQrDataUrl(lk)
        .then((u) => (qrUrl.value = u))
        .catch((e: { message?: string }) => addLog('[配对] 二维码失败: ' + (e && e.message), 'error', true));
}

watch(() => props.relayServer, refreshLink);
onMounted(refreshLink);
</script>

<template>
    <div class="w-full overflow-auto px-4 py-4" style="max-width: 560px; margin: auto">
        <!-- 本机专属链接 -->
        <div class="card mb-3">
            <div class="card-body gap-3 p-3.5">
                <div v-if="link" class="flex items-start gap-3">
                    <div class="shrink-0 text-center">
                        <img
                            v-if="qrUrl"
                            :src="qrUrl"
                            alt="上传链接二维码"
                            class="block size-[124px] rounded border border-base-300" />
                        <div
                            v-else
                            class="flex size-[124px] flex-col items-center justify-center gap-1.5 rounded border border-base-300 text-xs text-base-content/40">
                            <span class="loading loading-spinner loading-sm"></span>
                            二维码生成中…
                        </div>
                        <div class="mt-1.5 text-xs text-base-content/60">扫一扫上传</div>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="mb-1.5 text-xs text-base-content/60">链接（复制到手机浏览器打开）</div>
                        <div
                            class="max-h-14 overflow-auto break-all rounded-box border border-base-300 bg-base-200 px-2.5 py-1.5 text-[13px] text-base-content">
                            {{ link }}
                        </div>
                        <button class="btn btn-sm mt-2.5 w-full" @click="link && safeCopyText(link)">复制链接</button>
                    </div>
                </div>

                <!-- 未配置中继：用官方 hero 空态说明，而不是一行红字 -->
                <div v-else class="hero">
                    <div class="hero-content flex-col text-center">
                        <Icon name="settings" :size="20" />
                        <p class="text-sm">尚未配置中继服务器</p>
                        <p class="text-[13px] text-base-content/60">
                            请到第一栏「设置」填写中继地址，保存后这里会自动生成扫码链接。
                        </p>
                    </div>
                </div>
            </div>
        </div>

        <!-- 在线状态胶囊：只在无设备在线时提示（在线时不再显示「已连接手机 N 台」与设备列表） -->
        <div v-if="!phoneOnline" class="mb-3 text-center">
            <span class="badge badge-lg badge-error">
                <span class="mr-1.5 inline-block size-1.5 rounded-full bg-error" />
                当前无在线设备，暂不可收发
            </span>
        </div>
    </div>
</template>
