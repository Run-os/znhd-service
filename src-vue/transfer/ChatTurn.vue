<script setup lang="ts">
import { computed } from 'vue';
import { Avatar, AvatarFallback, AvatarImage } from '@vue/components/ui/avatar';
import { BubbleGroup } from '@vue/components/ui/bubble';
import { Message, MessageAvatar, MessageContent } from '@vue/components/ui/message';
import { Marker, MarkerContent } from '@vue/components/ui/marker';
import { getDeviceId } from '@/lib/relay';
import { PHONE_SESSION_KEY } from '@/lib/transfer/store';
import { avatarUrl } from './format';

/**
 * 一「轮」对话（v26.10.18-v8）：照搬官方示例 Conversation 的三段结构 ——
 *
 *   Marker（时间分隔条，可选）
 *   Message + MessageAvatar（Avatar / AvatarFallback 字母头像）
 *   MessageContent
 *     └─ BubbleGroup（同方向连续消息 > 1 条时） / 直接 slot（单条）
 *
 * 轮次内的每条消息由父组件用 `<ChatBubble grouped>` 渲染进默认插槽；
 * 单条时 slot 直出（不带 BubbleGroup 包裹，与示例同款）。
 *
 * 头像 = DiceBear（见 format.ts 的 avatarUrl）：我方 seed 用本机设备 ID、对方用会话键，
 * 加载失败 / 被 CSP 挡掉时回落成 AvatarFallback 的文字头像。
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
        <Marker v-if="timeLabel" class="mb-3 justify-center">
            <MarkerContent class="text-[11px] text-muted-foreground">{{ timeLabel }}</MarkerContent>
        </Marker>

        <Message :align="mine ? 'end' : 'start'" class="min-w-0">
            <!-- 头像：DiceBear SVG（失败时回落成文字头像） -->
            <MessageAvatar>
                <Avatar>
                    <AvatarImage :src="avatarSrc" :alt="mine ? '我' : '手机'" />
                    <AvatarFallback :class="mine ? 'bg-secondary text-secondary-foreground' : ''">
                        {{ mine ? '我' : '手' }}
                    </AvatarFallback>
                </Avatar>
            </MessageAvatar>

            <MessageContent>
                <BubbleGroup v-if="count > 1">
                    <slot />
                </BubbleGroup>
                <slot v-else />
            </MessageContent>
        </Message>
    </div>
</template>
