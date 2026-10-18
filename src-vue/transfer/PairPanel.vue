<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Icon } from '@vue/icons';
import { addLog } from '@/lib/logger';
import { safeCopyText } from '@/lib/clipboard';
import { getDeviceId, sendTestImage, TEST_IMAGE_URL } from '@/lib/relay';
import { genQrDataUrl } from '@/lib/qrcode';
import { resolveDeviceColors } from '@/lib/ui/transfer/deviceColors';
import type { PhoneInfo } from '@/lib/transfer/types';
import DeviceIdTag from './DeviceIdTag.vue';

/**
 * 配对面板正文（v26.10.18-v5，React 版 `TransferPairPanel` 的等价实现）。
 * 两处复用：第二栏「＋」的配对弹窗、以及**未选中会话时第三栏的空状态**。
 */
const props = defineProps<{ relayServer: string; phones: PhoneInfo[] }>();

const deviceId = getDeviceId();
const qrUrl = ref('');
const link = ref('');
const testSending = ref(false);

const deviceColors = computed(() => resolveDeviceColors(props.phones.map((p) => p.id)));
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

/**
 * 「发送测试图片」：从 `TEST_IMAGE_URL` 取一张随机图，**当作手机上传**投递到中继
 * `/u/<本机 deviceId>`，再经正常的「手机 → 电脑」通道回到本脚本、进对应会话。
 */
function doSendTestImage() {
    if (testSending.value) return;
    testSending.value = true;
    addLog('[测试图片] 正在从 ' + TEST_IMAGE_URL + ' 取图并投递到本机…', 'info');
    sendTestImage({
        server: props.relayServer,
        uuid: deviceId,
        onOk: (info) => {
            testSending.value = false;
            addLog(
                '[测试图片] 已投递（' +
                    info.mime +
                    '，约 ' +
                    Math.max(1, Math.round(info.bytes / 1024)) +
                    'KB），片刻后会出现在会话里',
                'success'
            );
        },
        onFail: (msg) => {
            testSending.value = false;
            addLog('[测试图片] 失败：' + msg, 'error', true);
        },
    });
}

const card = 'rounded-[10px] border border-white/10 px-3.5 py-3 mb-3';
</script>

<template>
    <div class="w-full overflow-auto px-4 py-4" style="max-width: 560px; margin: auto">
        <!-- 标题 + 标签 -->
        <div class="mb-3 flex items-center justify-between gap-2">
            <span class="inline-flex items-center gap-1.5 text-sm font-semibold text-white/90">
                <Icon name="smartphone" :size="16" />
                配对设备
            </span>
            <span class="rounded border border-white/15 px-2 py-0.5 text-xs text-white/60">手机扫码即配对</span>
        </div>

        <!-- 本机专属链接 -->
        <div :class="card">
            <div class="mb-2.5 flex items-center justify-between gap-2">
                <span class="text-sm font-semibold text-white/90">电脑接收 · 本机专属链接</span>
                <span class="rounded border border-[#07C160]/40 bg-[#07C160]/15 px-2 py-0.5 text-xs text-[#07C160]">
                    手机扫码即上传
                </span>
            </div>

            <div v-if="link" class="flex items-start gap-3">
                <div class="shrink-0 text-center">
                    <img
                        v-if="qrUrl"
                        :src="qrUrl"
                        alt="上传链接二维码"
                        class="block size-[124px] border border-white/15"
                        style="border-radius: 0" />
                    <div
                        v-else
                        class="flex size-[124px] items-center justify-center border border-white/15 text-xs text-white/25">
                        二维码生成中…
                    </div>
                    <div class="mt-1.5 text-xs text-white/35">扫一扫上传</div>
                </div>
                <div class="min-w-0 flex-1">
                    <div class="mb-1.5 text-xs text-white/35">链接（复制到手机浏览器打开）</div>
                    <div
                        class="max-h-14 overflow-auto break-all rounded-[8px] border border-white/20 bg-white/[0.06] px-2.5 py-1.5 text-[13px] text-white/85">
                        {{ link }}
                    </div>
                    <button
                        type="button"
                        class="mt-2.5 w-full cursor-pointer rounded-[6px] border-0 bg-[#07C160] py-1.5 text-sm text-white outline-none hover:bg-[#06AD56]"
                        @click="link && safeCopyText(link)">
                        复制链接
                    </button>
                </div>
            </div>
            <div v-else class="text-sm text-[#ff7875]">尚未配置中继服务器，请到第一栏「设置」填写。</div>
        </div>

        <!-- 在线状态胶囊 -->
        <div class="mb-3 text-center">
            <span
                class="inline-block rounded-[16px] border px-4 py-1 text-[13px]"
                :class="
                    phoneOnline
                        ? 'border-[#52c41a]/45 bg-[#52c41a]/15 text-[#73d13d]'
                        : 'border-[#ff4d4f]/45 bg-[#ff4d4f]/12 text-[#ff7875]'
                ">
                <span
                    class="mr-1.5 inline-block size-1.5 rounded-full align-middle"
                    :style="{ background: phoneOnline ? '#52c41a' : '#ff4d4f' }" />
                {{ phoneOnline ? '已连接手机 ' + phones.length + ' 台，可收发' : '当前无在线设备，暂不可收发' }}
            </span>
        </div>

        <!-- 已连接手机列表 -->
        <div v-if="phones.length" :class="card">
            <div class="mb-1.5 text-[13px] font-semibold text-white/90">已连接手机（{{ phones.length }}）</div>
            <div class="flex flex-wrap gap-1.5">
                <DeviceIdTag v-for="p in phones" :key="p.id || 'unknown'" :id="p.id" :color-index="deviceColors[p.id]" />
            </div>
            <div class="mt-1.5 text-[11px] text-white/45">在左侧「对话」分组点对应手机即可进入会话；发给谁由所在会话决定。</div>
        </div>

        <div class="flex justify-start">
            <button
                type="button"
                :disabled="testSending"
                class="cursor-pointer rounded-[6px] border border-white/20 bg-white/[0.08] px-3 py-1 text-[13px] text-white/85 outline-none hover:bg-white/15 disabled:cursor-wait disabled:opacity-60"
                @click="doSendTestImage">
                {{ testSending ? '发送中…' : '发送测试图片' }}
            </button>
        </div>
    </div>
</template>
