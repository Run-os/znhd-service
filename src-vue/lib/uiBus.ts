import { reactive, ref } from 'vue';

/**
 * 跨挂载点的 UI 总线（v26.10.21-v4：标题栏注入控件）。
 *
 * 站点导航条上的控件（panel/NavBarControls）与悬浮面板（panel/MainPanel）是
 * 两个独立的 Vue 应用实例 —— 弹窗本体仍挂在主面板的 shadowRoot 里，标题栏
 * 控件通过这条总线遥控它们：
 *   · 弹窗开关：NavBarControls 写 `dialogOpen.*`，MainPanel 的弹窗直接
 *     `v-model:open="dialogOpen.xxx"` 绑上来（reactive 对象属性可双向绑定）；
 *   · 语音开关：状态由 MainPanel 单向投影进 `voiceEnabled`（MainPanel 的
 *     allvalue 是唯一事实源），点击事件经 `voiceToggler` 回调还给 MainPanel
 *     的 toggleVoice 落库 —— 改动持久化/播报激活逻辑只存在一份。
 */
export const dialogOpen = reactive({
    settings: false,
    phrases: false,
    transfer: false,
    sniff: false,
});

export type DialogKey = keyof typeof dialogOpen;

/** 语音播报开关状态（MainPanel 写入 → NavBarControls 读取渲染） */
export const voiceEnabled = ref(false);

/** 语音开关的真正实现（MainPanel 注册 toggleVoice；NavBarControls 只负责调用） */
export const voiceToggler = ref<(next: boolean) => void>(() => {});
