<script setup lang="ts">
import { computed } from 'vue';
import { getDeviceId } from '@/lib/relay';
import { PHONE_SESSION_KEY } from '@/lib/transfer/store';
import { avatarUrl } from './format';

/**
 * 一「轮」对话（v26.10.18-v8）：迁移到 daisyUI 的 `chat` 组件。
 *
 *   <div class="chat chat-start|chat-end">
 *     <div class="chat-image avatar">…</div>
 *     <div class="chat-bubble">…</div>   ← 由 ChatBubble 渲染（可多条）
 *     <div class="chat-footer">…</div>   ← 发送状态小字
 *   </div>
 *
 * 时间分隔条用 `divider` 的等价写法（居中一行小字），不再需要 Marker 组件。
 * 头像用 `avatar` + 圆形容器；加载失败由浏览器显示 alt 文字。
 *
 * 头像 = DiceBear（见 format.ts 的 avatarUrl）：我方 seed 用本机设备 ID、对方用会话键。
 */
const props = withDefaults(
    defineProps<{
        mine: boolean;
        sessionKey?: string;
        /** 我方头像 seed：两端身份不同（脚本端 = 电脑 deviceId；客户端 = 本机 phoneId），
         *  由宿主显式传入；不传才回退 getDeviceId()（仅脚本端有意义）。 */
        mySeed?: string;
        timeLabel?: string;
        count?: number;
    }>(),
    { sessionKey: '', mySeed: '', timeLabel: '', count: 1 }
);

/** 头像 seed（v26.10.19-v8 起两端统一「同一设备同一张脸」）：
 *  · 脚本端：我 = 电脑 deviceId（mySeed 缺省回退 getDeviceId()），对方 = 手机 phoneId（sessionKey 就是 phoneId）；
 *  · 客户端：我 = 本机 phoneId（宿主传 mySeed），对方 = 电脑 deviceId（宿主传 session-key）。
 *  此前客户端 mine 分支错用脚本端 getDeviceId()（网页里 GM 不存在 ⇒ localStorage 随机值），
 *  且对方分支用固定聚合键 ⇒ 同一设备两端两张脸。 */
const avatarSeed = computed(() =>
    props.mine ? props.mySeed || getDeviceId() : props.sessionKey || PHONE_SESSION_KEY
);
const avatarSrc = computed(() => avatarUrl(avatarSeed.value));
</script>

<template>
    <div class="min-w-0">
        <div v-if="timeLabel" class="my-2 text-center text-[11px] text-base-content/60">{{ timeLabel }}</div>

        <div class="chat" :class="mine ? 'chat-end' : 'chat-start'">
            <div class="chat-image avatar">
                <div class="w-10 rounded-full">
                    <img :src="avatarSrc" :alt="mine ? '我' : '手机'" />
                </div>
            </div>
            <!-- ⚠️ 同一轮的多条气泡必须**包一层纵向 flex**，不能让它们直接当 .chat 的网格项：
                 daisyUI 5 的 `.chat-bubble{grid-row-end:3}` 是给「一轮一条气泡」设计的，
                 多条并列时每个都固定占同一行 ⇒ 全部叠在同一个格子里，后画的盖住前面的
                 （v26.10.22-v4 修的「连发两张图只看得到最后一张」）。
                 气泡的 max-w 百分比也随之相对这层包裹（宽度 = 原来的 1fr 列），对齐靠 items-*。 -->
            <div class="flex min-w-0 flex-col gap-1" :class="mine ? 'items-end' : 'items-start'">
                <slot />
            </div>
        </div>
    </div>
</template>
