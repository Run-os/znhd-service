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
    defineProps<{ mine: boolean; sessionKey?: string; timeLabel?: string; count?: number }>(),
    { sessionKey: '', timeLabel: '', count: 1 }
);

/** 头像 seed：一台设备一张脸（我方 = 本机 ID；对方 = 手机会话键，聚合会话用固定键） */
const avatarSeed = computed(() => (props.mine ? getDeviceId() : props.sessionKey || PHONE_SESSION_KEY));
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
