<script setup lang="ts">
/**
 * 站点导航条上的注入控件（v26.10.21-v5）：语音播报开关 + 4 个功能入口 + 版本号。
 *
 * · 渲染在 navBarMount.ts 建的独立 shadow DOM 里，与主面板（已删，现为 DialogHost
 *   弹窗宿主）是两个 Vue 实例：弹窗开关走 uiBus.dialogOpen（弹窗本体挂在
 *   DialogHost 的 shadowRoot 里），语音开关经 uiBus 接力（状态 DialogHost → 总线 →
 *   这里；点击 总线 → toggleVoice → allvalue）。
 * · 标题栏永远是站点蓝底 —— 控件配色**不走 daisyUI 主题变量**（日/夜切换已删，
 *   对这里是同一个白）：图标白色、开关自绘，保证蓝底上始终可读。
 * · 样式只用 Tailwind 原子类 + 原生 title 提示，不依赖 daisyUI 组件
 *   （btn/tooltip 的配色公式都锚定 base-* 语义色，在蓝底上会失真）。
 * · 版式：｜语音开关｜分割线｜4 钮｜分割线｜版本号（v26.10.21-v5 定版）。
 */
import { ref } from 'vue';
import { Icon, type IconName } from '../icons';
import { dialogOpen, voiceEnabled, voiceToggler } from '../lib/uiBus';

const VERSION = ref(GM_info.script.version);

const ACTIONS: Array<{ key: 'settings' | 'phrases' | 'transfer' | 'sniff'; icon: IconName; label: string }> = [
    { key: 'settings', icon: 'settings', label: '设置' },
    { key: 'phrases', icon: 'phrases', label: '常用语' },
    { key: 'transfer', icon: 'transfer', label: '传输助手' },
    { key: 'sniff', icon: 'sniff', label: '图片嗅探' },
];

function open(key: (typeof ACTIONS)[number]['key']) {
    dialogOpen[key] = true;
}

function onVoiceToggle(event: Event) {
    voiceToggler.value((event.target as HTMLInputElement).checked);
}
</script>

<template>
    <div class="flex items-center gap-0.5">
        <!-- 与「业务管理」的分割线 -->
        <span class="mr-1.5 block h-5 w-px bg-white/25"></span>

        <!-- 语音播报：图标 + 自绘开关（track 32px / knob 12px，开=白底品牌蓝点，关=半透明白底白点）。
             v26.10.21-v8：选中点从写死的 #185FA5 统一到全局 --znhd-brand（blue 蓝，白底上可读）。 -->
        <label class="relative flex cursor-pointer items-center gap-1" title="语音播报开关">
            <span :class="voiceEnabled ? 'text-white' : 'text-white/50'">
                <Icon :name="voiceEnabled ? 'volumeOn' : 'volumeOff'" :size="16" />
            </span>
            <input type="checkbox" class="peer sr-only" :checked="voiceEnabled" @change="onVoiceToggle" />
            <span
                class="relative block h-4 w-8 rounded-full transition-colors"
                :class="voiceEnabled ? 'bg-white/90' : 'bg-white/30'">
                <span
                    class="absolute left-0.5 top-1/2 mt-[-6px] block size-3 rounded-full transition-transform"
                    :class="voiceEnabled ? 'translate-x-4 bg-(--znhd-brand)' : 'bg-white'"></span>
            </span>
        </label>

        <span class="mx-1 block h-5 w-px bg-white/25"></span>

        <!-- 4 个入口：图标圆钮（与「工作台」等站点菜单项同高，白色描边图标） -->
        <button
            v-for="a in ACTIONS"
            :key="a.key"
            type="button"
            :title="a.label"
            class="grid size-8 cursor-pointer place-items-center rounded-full text-white/90 hover:bg-white/20 active:bg-white/30"
            @click="open(a.key)">
            <Icon :name="a.icon" :size="17" />
        </button>

        <!-- 与版本号的分割线 + 版本徽标 -->
        <span class="mx-1 block h-5 w-px bg-white/25"></span>
        <span class="rounded bg-white/15 px-1.5 py-0.5 text-[11px] leading-4 text-white/90" title="脚本版本">
            v{{ VERSION }}
        </span>
    </div>
</template>
