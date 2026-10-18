<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Icon } from '@vue/icons';
import { addLog } from '@/lib/logger';
import { safeCopyText } from '@/lib/clipboard';
import { getDeviceId } from '@/lib/relay';
import { genQrDataUrl } from '@/lib/qrcode';
import { resolveDeviceColors } from '@/lib/ui/transfer/deviceColors';
import type { PhoneInfo } from '@/lib/transfer/types';
import { Button } from '@vue/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@vue/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vue/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@vue/components/ui/item';
import DeviceIdTag from './DeviceIdTag.vue';

/**
 * 配对面板正文（React 版 `TransferPairPanel` 的等价实现）。
 * 两处复用：第二栏「＋」的配对弹窗、以及**未选中会话时第三栏的空状态**。
 *
 * 组件构成（2026-10-18 组件正规化）：
 *   · 分区容器 = 官方 **Card**（本机链接 / 已连接手机）；
 *   · 「没配中继」空态 = 官方 **Empty**（图标 + 标题 + 说明）；
 *   · 每台已连接手机 = 官方 **Item**；
 *   · 按钮 = 官方 **Button**（复制链接）。
 *
 * v26.10.19 精简：去掉顶部「配对设备 / 手机扫码即配对」标题行、无手机时的
 * 「还没有配对的手机」空态与「发送测试图片」按钮 —— 在线状态胶囊已经把该说的说完了。
 * （`sendTestImage` / `TEST_IMAGE_URL` 保留在 `lib/relay.ts`，暂未删除。）
 */
const props = defineProps<{ relayServer: string; phones: PhoneInfo[] }>();

const deviceId = getDeviceId();
const qrUrl = ref('');
const link = ref('');

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

</script>

<template>
    <div class="w-full overflow-auto px-4 py-4" style="max-width: 560px; margin: auto">
        <!-- 本机专属链接 -->
        <Card class="mb-3 gap-3 py-3">
            <CardHeader class="px-3.5">
                <CardTitle class="flex items-center justify-between gap-2 text-sm">
                    <span>电脑接收 · 本机专属链接</span>
                    <span class="rounded border border-primary/40 bg-primary/15 px-2 py-0.5 text-xs font-normal text-primary">
                        手机扫码即上传
                    </span>
                </CardTitle>
            </CardHeader>

            <CardContent class="px-3.5">
                <div v-if="link" class="flex items-start gap-3">
                    <div class="shrink-0 text-center">
                        <img
                            v-if="qrUrl"
                            :src="qrUrl"
                            alt="上传链接二维码"
                            class="block size-[124px] rounded border border-border" />
                        <div
                            v-else
                            class="flex size-[124px] items-center justify-center rounded border border-border text-xs text-muted-foreground/60">
                            二维码生成中…
                        </div>
                        <div class="mt-1.5 text-xs text-muted-foreground/70">扫一扫上传</div>
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="mb-1.5 text-xs text-muted-foreground/70">链接（复制到手机浏览器打开）</div>
                        <div
                            class="max-h-14 overflow-auto break-all rounded-md border border-border bg-muted px-2.5 py-1.5 text-[13px] text-foreground">
                            {{ link }}
                        </div>
                        <Button class="mt-2.5 w-full" size="sm" @click="link && safeCopyText(link)">复制链接</Button>
                    </div>
                </div>

                <!-- 未配置中继：用官方 Empty 说明，而不是一行红字 -->
                <Empty v-else class="border-0 p-4">
                    <EmptyHeader>
                        <EmptyMedia variant="icon"><Icon name="settings" :size="20" /></EmptyMedia>
                        <EmptyTitle class="text-sm">尚未配置中继服务器</EmptyTitle>
                        <EmptyDescription class="text-[13px]">
                            请到第一栏「设置」填写中继地址，保存后这里会自动生成扫码链接。
                        </EmptyDescription>
                    </EmptyHeader>
                </Empty>
            </CardContent>
        </Card>

        <!-- 在线状态胶囊 -->
        <div class="mb-3 text-center">
            <span
                class="inline-block rounded-2xl border px-4 py-1 text-[13px]"
                :class="
                    phoneOnline
                        ? 'border-success/45 bg-success/15 text-success'
                        : 'border-destructive/45 bg-destructive/10 text-destructive'
                ">
                <span
                    class="mr-1.5 inline-block size-1.5 rounded-full align-middle"
                    :class="phoneOnline ? 'bg-success' : 'bg-destructive'" />
                {{ phoneOnline ? '已连接手机 ' + phones.length + ' 台，可收发' : '当前无在线设备，暂不可收发' }}
            </span>
        </div>

        <!-- 已连接手机列表：每台一个 Item -->
        <Card v-if="phones.length" class="mb-3 gap-2 py-3">
            <CardHeader class="px-3.5">
                <CardTitle class="text-[13px]">已连接手机（{{ phones.length }}）</CardTitle>
            </CardHeader>
            <CardContent class="px-3.5">
                <Item
                    v-for="p in phones"
                    :key="p.id || 'unknown'"
                    size="xs"
                    variant="muted"
                    class="mb-1.5 last:mb-0">
                    <ItemMedia>
                        <Icon name="smartphone" :size="16" />
                    </ItemMedia>
                    <ItemContent>
                        <ItemTitle><DeviceIdTag :id="p.id" :color-index="deviceColors[p.id]" /></ItemTitle>
                        <ItemDescription class="text-[11px]">在线</ItemDescription>
                    </ItemContent>
                </Item>
                <div class="mt-1.5 text-[11px] text-muted-foreground/70">
                    在左侧「对话」分组点对应手机即可进入会话；发给谁由所在会话决定。
                </div>
            </CardContent>
        </Card>

    </div>
</template>
