<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Icon } from '@vue/icons';
import { Button } from '@vue/components/ui/button';
import { Toaster } from '@vue/components/ui/sonner';
import ImagePreview from '@vue/components/media/ImagePreview.vue';
import { toast } from '@vue/lib/toast';
import {
    blobToBase64,
    getPhoneId,
    parseDeviceId,
    postItem,
    startPhoneRelay,
    type ConnState,
    type RecvItem,
} from './lib/relay';
import { prepareImage } from './lib/image';
import { useShellViewport } from './lib/viewport';
import { useLayoutMode } from './lib/layoutMode';
import EmojiPanel from './components/EmojiPanel.vue';
import type { PickedEmoji } from './lib/emojiPack';

/**
 * 手机端聊天窗（v26.10.12-v5 重构；v26.10.13-v3 加表情按钮 + 输入区吸底修复；
 * **v26.10.18-v7 由 React 19 + antd v6 整体重写为 Vue 3**）：整页与脚本端第三栏
 * 同一套聊天样式（微信暗色）。
 *
 * 功能与 React 版逐条对齐 —— 选图/拍照（自动压缩）发到电脑、发文本到电脑、
 * **点在线表情直接发到电脑**（v26.10.13-v3）、接收电脑发来的图片（可预览/打印/下载）
 * 与文本、任意文件互传。呈现仍是「消息气泡 + 底部输入区」：
 *   · 手机发出去的 = 右侧绿色气泡（微信「我方」配色 #07C160）；
 *   · 电脑发来的   = 左侧灰色气泡（微信「对方」配色 #2F2F2F）；
 *   · 发送状态（发送中 / 已发送 / 发送失败）显示在气泡下方的小字；
 *   · 间隔超 5 分钟的消息之间插一条居中时间分隔条（与脚本端第三栏同一规则）。
 *
 * ⚠️ 整页骨架是 `position:fixed` 贴视口（见 app.css `.znhd-phone-chat` 的注释），
 * top/height 由 `useShellViewport` 按 visualViewport 动态校正（键盘弹出时输入区跟着上移）。
 *
 * v26.10.13-v4 桌面/手机分流（`useLayoutMode`）：**桌面浏览器**打开本页时聊天窗
 * 不再全屏，而是屏幕居中的弹窗（420×680，参考微信 PC 端「文件传输助手」独立窗），
 * 弹窗外是更深一档的纯色背景；**手机/触屏窄屏**仍用全屏骨架。
 */

/** 聊天记录内存上限：超出丢最旧（收件项是 base64 大字符串，无上限会持续吃内存） */
const MAX_MSGS = 100;

/** 时间分隔条阈值：与脚本端第三栏一致，间隔超 5 分钟插一条 */
const TIME_GAP_MS = 5 * 60 * 1000;

interface ChatMsg {
    id: string;
    /** v26.10.14-v6：'file' = 任意文件（气泡渲染为文件卡片，可下载） */
    type: 'image' | 'file' | 'text';
    /** out = 手机发到电脑；in = 电脑发来 */
    side: 'in' | 'out';
    text?: string;
    /** 图片展示地址（out = objectURL；in = data:URL）；文件消息里它是 Blob 的 objectURL（供下载） */
    url?: string;
    name?: string;
    mime?: string;
    /** 文件消息的字节数（气泡里显示大小；图片不需要，靠自然尺寸展示） */
    size?: number;
    /** 发送状态（仅 out；发送中 / 已发送 / 发送失败） */
    state?: 'sending' | 'failed' | 'ok';
    /**
     * v26.10.18-v1：上传进度（0–100，仅 state==='sending' 时有意义）。
     * **首个 upload.onprogress 事件到达前是 undefined** —— 此时气泡保持「发送中…」
     * 不画进度条（大文件在 FileReader base64 / JSON 序列化阶段本就还没有进度可报）。
     */
    progress?: number;
    err?: string;
    ts: number;
}

let seq = 0;
const uid = () => 'z' + ++seq + '-' + Date.now().toString(36);

/** 时间分隔条文案（与脚本端第三栏同一套：今天 HH:mm / 昨天 / MM-DD） */
function timeLabel(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    const now = new Date();
    const dayOf = (x: Date) => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();
    const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (dayOf(d) === dayOf(now)) return '今天 ' + hm;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayOf(d) === dayOf(yesterday)) return '昨天 ' + hm;
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + hm;
}

/** 体积显示（v26.10.14-v6，文件气泡用）；档位与脚本端 `formatBytes` 一致（B / KB / MB / GB） */
function fmtSize(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(2) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/**
 * 由 base64 字符串估算原始字节数（仅用于显示大小；文件消息本机不解码）。
 * base64 长度 × 3/4 再扣掉结尾 padding，误差 ≤2 字节。
 */
function fileDataSize(b64: string): number {
    const s = String(b64 || '');
    const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

const deviceId = parseDeviceId(window.location.pathname);
// 本机（手机）设备 ID：持久化在 localStorage，用于让电脑端区分「哪台手机在线」
const phoneId = getPhoneId();

/** 构建期注入的版本号（来自 relay-server/package.json）。模板里读不到全局常量，先落到本地变量 */
const appVersion = __APP_VERSION__;

const conn = ref<ConnState>({ state: 'offline' });
const msgs = ref<ChatMsg[]>([]);
const text = ref('');
const sendingText = ref(false);
const preparing = ref(false);
/** 表情面板展开态（v26.10.13-v3：内嵌在输入区里、工具栏上方） */
const emojiOpen = ref(false);

const fileRef = ref<HTMLInputElement | null>(null);
/** v26.10.14-v6：任意文件的隐藏 input（accept 留空 = 不过滤类型） */
const fileAnyRef = ref<HTMLInputElement | null>(null);
const scrollEl = ref<HTMLDivElement | null>(null);
const textEl = ref<HTMLTextAreaElement | null>(null);

// 整页骨架跟随视觉视口（键盘弹出 / 工具栏收放时输入区仍贴最底）
useShellViewport();
// 桌面 → 居中弹窗；手机 → 全屏（见 lib/layoutMode.ts 的判定规则）
const layoutMode = useLayoutMode();

/** 手机版直接是聊天窗；桌面版外面多套一层用于居中 + 深色背景的层（与 React 版 DOM 一致） */
const rootClass = computed(() => (layoutMode.value === 'phone' ? '' : 'znhd-window-layer'));
const shellClass = computed(() =>
    layoutMode.value === 'phone' ? 'znhd-phone-chat' : 'znhd-phone-chat znhd-chat-window'
);

// ===== 预览层（替代 antd `Image` + `shared/preview` 那套 cloneElement 注入）=====
const previewOpen = ref(false);
const previewIndex = ref(0);
/** 预览只针对「电脑发来的图片」，与 React 版一致（本地发出的不预览，避免和上传态混淆） */
const inImages = computed(() => msgs.value.filter((m) => m.type === 'image' && m.side === 'in' && !!m.url));
const previewItems = computed(() => inImages.value.map((m) => m.url as string));
const previewNames = computed(() => inImages.value.map((m) => m.name || 'image.jpg'));

function openPreview(m: ChatMsg) {
    const i = inImages.value.findIndex((x) => x.id === m.id);
    previewIndex.value = i < 0 ? 0 : i;
    previewOpen.value = true;
}

function pushMsg(m: ChatMsg) {
    const next = msgs.value.concat(m);
    msgs.value = next.length > MAX_MSGS ? next.slice(next.length - MAX_MSGS) : next;
}

function patchMsg(id: string, patch: Partial<ChatMsg>) {
    msgs.value = msgs.value.map((m) => (m.id === id ? { ...m, ...patch } : m));
}

// ===== 收到的内容（电脑 → 手机）=====
function onItem(item: RecvItem) {
    if (item.type === 'image' && item.data) {
        pushMsg({
            id: uid(),
            type: 'image',
            side: 'in',
            url: 'data:' + (item.mime || 'image/jpeg') + ';base64,' + item.data,
            mime: item.mime || 'image/jpeg',
            name: item.name,
            ts: item.ts || Date.now(),
        });
        toast.success('收到电脑发来的图片');
    } else if (item.type === 'file' && item.data) {
        // v26.10.14-v6：任意文件。data:URL 不用在 <img> 上，而是挂到 <a download> 交给浏览器下载。
        // 用 data:URL 而非 objectURL：收件项是事件回调里的瞬时值，没有生命周期管理点来 revoke
        // （与图片同一取舍：图片也是直接 data:URL 渲染）。
        pushMsg({
            id: uid(),
            type: 'file',
            side: 'in',
            url: 'data:' + (item.mime || 'application/octet-stream') + ';base64,' + item.data,
            mime: item.mime || 'application/octet-stream',
            name: item.name || 'file',
            size: fileDataSize(item.data),
            ts: item.ts || Date.now(),
        });
        toast.success('收到电脑发来的文件');
    } else if (item.type === 'text') {
        pushMsg({ id: uid(), type: 'text', side: 'in', text: item.text || '', ts: item.ts || Date.now() });
        toast.success('收到电脑发来的文本');
    }
}

// 心跳 + 长轮询：挂载时启动，卸载时停止
let stopRelay: (() => void) | null = null;

onMounted(() => {
    if (!deviceId) {
        conn.value = { state: 'error', msg: '链接无效：未识别到设备ID，请重新生成二维码' };
        return;
    }
    stopRelay = startPhoneRelay({ deviceId, phoneId, onConn: (c) => (conn.value = c), onItem });
});

onBeforeUnmount(() => {
    stopRelay?.();
    stopRelay = null;
});

// 消息变化 → 滚动到底（聊天窗的基本行为）；表情面板开合也重算（面板会挤占滚动区高度）
watch(
    [msgs, emojiOpen],
    () => {
        const el = scrollEl.value;
        if (el) el.scrollTop = el.scrollHeight;
    },
    { flush: 'post' }
);

/** 输入框自增高（替代 antd `autoSize={{minRows:1,maxRows:4}}`：40px 起、96px 封顶） */
function autoGrow() {
    const el = textEl.value;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 96) + 'px';
}
watch(text, () => void nextTick(autoGrow));

// ===== 选图（多选）→ 先出「发送中」气泡 → 逐张压缩 → 顺序发送 =====
// v26.10.18-v1：气泡**先于压缩**落进会话（预览先用原图 objectURL），压缩完成后
// 再把气泡的 url/name/mime 换成压缩产物并回收原图 URL —— 用户选完立刻能看到要传什么。
async function onPick(files: FileList | null) {
    const list = Array.from(files || []);
    if (!list.length) return;
    preparing.value = true;
    try {
        const queued: Array<{ id: string; blob: Blob; name: string; mime: string; tmpUrl?: string }> = [];
        for (const f of list) {
            const id = uid();
            const tmpUrl = URL.createObjectURL(f);
            pushMsg({
                id,
                type: 'image',
                side: 'out',
                url: tmpUrl,
                name: f.name || 'image.jpg',
                mime: f.type || 'image/jpeg',
                state: 'sending',
                ts: Date.now(),
            });
            const prepared = await prepareImage(f);
            const url = URL.createObjectURL(prepared.blob);
            queued.push({ id, blob: prepared.blob, name: prepared.name, mime: prepared.mime, tmpUrl });
            // 压缩产物回填气泡（名称/类型以压缩结果为准），并回收原图 URL
            patchMsg(id, { url, name: prepared.name, mime: prepared.mime });
            if (tmpUrl !== url) URL.revokeObjectURL(tmpUrl);
        }
        // 逐张顺序发送（保证到达顺序）；失败即停，剩余保持「发送中」标记为失败
        for (const it of queued) {
            try {
                const b64 = await blobToBase64(it.blob);
                let lastPct = -1; // 同值不重发：progress 事件比百分比密，避免无谓重渲染
                // 带 phoneId：服务端随投递回传 from，电脑端把内容归到本台手机的会话（v26.10.13-v3）
                const res = await postItem({ name: it.name, mime: it.mime, data: b64 }, phoneId, (pct) => {
                    if (pct !== lastPct) {
                        lastPct = pct;
                        patchMsg(it.id, { progress: pct });
                    }
                });
                if (res && res.ok) {
                    patchMsg(it.id, { state: 'ok', progress: undefined });
                } else {
                    patchMsg(it.id, { state: 'failed', err: (res && res.error) || '未知错误', progress: undefined });
                    toast.error('第 ' + it.name + ' 发送失败，可重新选图重试');
                    break;
                }
            } catch (e: any) {
                patchMsg(it.id, { state: 'failed', err: (e && e.message) || '读取图片失败', progress: undefined });
                break;
            }
        }
    } finally {
        preparing.value = false;
    }
}

// ===== 选文件（任意类型，多选）→ 不压缩 → 顺序发送（v26.10.14-v6）=====
// 与选图的关键差异：**不做 canvas 压缩**（PDF/zip/视频解码必然失败），原样 base64 后投递。
// 中继按 mime 分流：非 image/* 的落到 type 'file'，电脑端显示为文件卡片。
async function onPickFiles(files: FileList | null) {
    const list = Array.from(files || []);
    if (!list.length) return;
    preparing.value = true;
    try {
        const queued: Array<{ id: string; blob: Blob; name: string; mime: string; size: number }> = [];
        for (const f of list) {
            const id = uid();
            const name = f.name || 'file.bin';
            const mime = f.type || 'application/octet-stream';
            queued.push({ id, blob: f, name, mime, size: f.size });
            pushMsg({
                id,
                type: 'file',
                side: 'out',
                url: URL.createObjectURL(f),
                name,
                mime,
                size: f.size,
                state: 'sending',
                ts: Date.now(),
            });
        }
        // 逐条顺序发送（保证到达顺序）；失败即停，剩余保持「发送中」标记为失败
        for (const it of queued) {
            try {
                const b64 = await blobToBase64(it.blob);
                let lastPct = -1; // 同值不重发：progress 事件比百分比密，避免无谓重渲染
                const res = await postItem({ name: it.name, mime: it.mime, data: b64 }, phoneId, (pct) => {
                    if (pct !== lastPct) {
                        lastPct = pct;
                        patchMsg(it.id, { progress: pct });
                    }
                });
                if (res && res.ok) {
                    patchMsg(it.id, { state: 'ok', progress: undefined });
                } else {
                    patchMsg(it.id, { state: 'failed', err: (res && res.error) || '未知错误', progress: undefined });
                    toast.error(it.name + ' 发送失败，可重新选择重试');
                    break;
                }
            } catch (e: any) {
                patchMsg(it.id, { state: 'failed', err: (e && e.message) || '读取文件失败', progress: undefined });
                break;
            }
        }
    } finally {
        preparing.value = false;
    }
}

// ===== 发送文本 =====
async function sendText() {
    const t = (text.value || '').replace(/\s+$/, '');
    if (!t || sendingText.value) return;
    const id = uid();
    sendingText.value = true;
    pushMsg({ id, type: 'text', side: 'out', text: t, state: 'sending', ts: Date.now() });
    text.value = '';
    // 带 phoneId：让电脑端把这条文本归到本台手机的会话（v26.10.13-v3）
    const res = await postItem({ text: t }, phoneId);
    sendingText.value = false;
    if (res && res.ok) {
        patchMsg(id, { state: 'ok' });
    } else {
        patchMsg(id, { state: 'failed', err: (res && res.error) || '未知错误' });
        text.value = t; // 发送失败把内容还回输入框，方便改完重发
    }
}

// ===== 发送在线表情（v26.10.13-v3）：点一张直接发，与脚本端「点表情即发出」同语义 =====
// 面板交回的就是下好的 blob，这里 base64 后走与文本/图片同一条 postItem 链路。
// ⚠️ 不走 prepareImage 的 canvas 压缩：表情本来就是 2–6KB 的 webp，原样发更小也更保真。
// ⚠️ 必须带 phoneId（与上传图/文本一致）：漏了它服务端写不出 `from`，电脑端只能按旧规则兜底归组。
async function sendEmoji(emoji: PickedEmoji) {
    const mime = emoji.blob.type || 'image/webp';
    const id = uid();
    pushMsg({
        id,
        type: 'image',
        side: 'out',
        url: URL.createObjectURL(emoji.blob),
        name: emoji.name,
        mime,
        state: 'sending',
        ts: Date.now(),
    });
    try {
        const b64 = await blobToBase64(emoji.blob);
        // emoji:true（v26.10.14-v3）：表情包标记，服务端写进条目，电脑端「全部文件」据此过滤
        const res = await postItem({ name: emoji.name, mime, data: b64, emoji: true }, phoneId);
        if (res && res.ok) {
            patchMsg(id, { state: 'ok' });
        } else {
            patchMsg(id, { state: 'failed', err: (res && res.error) || '未知错误' });
            toast.error('表情 ' + emoji.name + ' 发送失败');
        }
    } catch (e: any) {
        patchMsg(id, { state: 'failed', err: (e && e.message) || '读取图片失败' });
    }
}

// ===== 收到的文本：复制 =====
async function copyInText(t: string) {
    try {
        await navigator.clipboard.writeText(t);
        toast.success('已复制文本');
    } catch {
        toast.warning('复制失败，请长按文本手动复制');
    }
}

/** 头部连接状态（antd Badge → 「圆点 + 文字」，不依赖组件库） */
const connText = computed(() => {
    if (conn.value.state === 'online') return '已连接电脑';
    if (conn.value.state === 'error') return (conn.value as { msg?: string }).msg || '连接失败';
    return '连接中…';
});
const connDot = computed(() => {
    if (conn.value.state === 'online') return 'bg-[#07c160]';
    if (conn.value.state === 'error') return 'bg-[#e86c6c]';
    return 'bg-white/35';
});

/** 气泡下方小字（仅我方消息有） */
function metaOf(m: ChatMsg): string {
    if (m.side !== 'out') return '';
    if (m.state === 'sending') return typeof m.progress === 'number' ? '发送中 ' + m.progress + '%' : '发送中…';
    if (m.state === 'failed') return '发送失败' + (m.err ? '：' + m.err : '');
    return '已发送';
}

/** 时间分隔条：与上一条间隔 > 5 分钟才插 */
function showTimeAt(i: number): boolean {
    const prev = i > 0 ? msgs.value[i - 1] : undefined;
    const cur = msgs.value[i];
    return !prev || (cur.ts || 0) - (prev.ts || 0) > TIME_GAP_MS;
}
</script>

<template>
    <div :class="rootClass">
        <div :class="shellClass">
            <!-- 头部：标题 + 连接状态（设备 ID 收进小字，不再占半屏） -->
            <header class="znhd-phone-header">
                <div class="znhd-phone-header-row">
                    <span class="znhd-phone-title">传输助手</span>
                    <span
                        class="ml-2 inline-flex h-5 items-center rounded-[4px] bg-[#07c160]/18 px-1.5 text-[11px] font-medium text-[#07c160]">
                        v{{ appVersion }}
                    </span>
                    <span class="flex-1" />
                    <span class="znhd-phone-conn inline-flex items-center gap-1.5">
                        <i class="inline-block size-1.5 rounded-full" :class="connDot" />
                        {{ connText }}
                    </span>
                </div>
                <div class="znhd-phone-sub">
                    本机（手机）ID：{{ phoneId || '未知' }} · 电脑设备：{{ deviceId || '未识别，请重新生成二维码' }}
                </div>
            </header>

            <!-- 消息滚动区 -->
            <div ref="scrollEl" class="znhd-phone-scroll">
                <div v-if="msgs.length === 0" class="znhd-chat-empty">
                    选择图片 / 拍照 / 发表情，或输入文本发送到电脑；电脑发来的内容也会出现在这里。
                </div>
                <div v-for="(m, i) in msgs" :key="m.id">
                    <div v-if="showTimeAt(i)" class="znhd-chat-time">{{ timeLabel(m.ts) }}</div>
                    <div class="znhd-chat-msg" :data-side="m.side">
                        <span
                            class="znhd-chat-avatar"
                            :style="{ background: m.side === 'out' ? '#3D8B72' : '#4A4A4A' }">
                            {{ m.side === 'out' ? '我' : '电' }}
                        </span>
                        <div style="min-width: 0; max-width: 78%">
                            <div
                                class="znhd-chat-bubble"
                                :class="{
                                    'znhd-chat-bubble-img': m.type === 'image',
                                    'znhd-chat-bubble-file': m.type === 'file',
                                }">
                                <template v-if="m.type === 'image'">
                                    <img
                                        class="znhd-chat-img"
                                        :class="{ 'znhd-chat-img-clickable': m.side === 'in' }"
                                        :src="m.url"
                                        :alt="m.name || 'image'"
                                        @click="m.side === 'in' && openPreview(m)" />
                                    <!-- v26.10.18-v1：上传进度条贴在图片正下方 -->
                                    <div
                                        v-if="m.state === 'sending' && typeof m.progress === 'number'"
                                        :data-chat-progress="String(m.progress)"
                                        :style="{
                                            width: '100%',
                                            height: '4px',
                                            borderRadius: '2px',
                                            background: 'rgba(0,0,0,0.28)',
                                            overflow: 'hidden',
                                            marginTop: '4px',
                                        }">
                                        <div
                                            :style="{
                                                width: Math.min(100, Math.max(2, m.progress)) + '%',
                                                height: '100%',
                                                borderRadius: '2px',
                                                background: '#fff',
                                                transition: 'width 120ms linear',
                                            }" />
                                    </div>
                                </template>

                                <!-- v26.10.14-v6：文件卡片（图标 + 文件名 + 大小 + 下载） -->
                                <template v-else-if="m.type === 'file'">
                                    <div class="znhd-chat-file">
                                        <span class="znhd-chat-file-icon" aria-hidden="true">
                                            <Icon name="fileText" :size="18" />
                                        </span>
                                        <span class="znhd-chat-file-main">
                                            <span class="znhd-chat-file-name" :title="m.name">
                                                {{ m.name || 'file' }}
                                            </span>
                                            <span class="znhd-chat-file-size">
                                                {{ fmtSize(m.size || 0) }}{{ m.mime ? ' · ' + m.mime : '' }}
                                            </span>
                                        </span>
                                        <a
                                            class="znhd-chat-file-dl"
                                            :href="m.url"
                                            :download="m.name || 'file'"
                                            aria-label="下载文件">
                                            下载
                                        </a>
                                    </div>
                                    <div
                                        v-if="m.state === 'sending' && typeof m.progress === 'number'"
                                        :data-chat-progress="String(m.progress)"
                                        :style="{
                                            width: '100%',
                                            height: '4px',
                                            borderRadius: '2px',
                                            background: 'rgba(0,0,0,0.28)',
                                            overflow: 'hidden',
                                            marginTop: '6px',
                                        }">
                                        <div
                                            :style="{
                                                width: Math.min(100, Math.max(2, m.progress)) + '%',
                                                height: '100%',
                                                borderRadius: '2px',
                                                background: '#fff',
                                                transition: 'width 120ms linear',
                                            }" />
                                    </div>
                                </template>

                                <span v-else>{{ m.text }}</span>
                            </div>

                            <button
                                v-if="m.side === 'in' && m.type === 'text'"
                                type="button"
                                class="znhd-chat-copy"
                                @click="copyInText(m.text || '')">
                                复制
                            </button>

                            <div v-if="metaOf(m)" class="znhd-chat-meta" :style="m.state === 'failed' ? { color: '#e86c6c' } : undefined">
                                {{ metaOf(m) }}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 底部输入区：图标行（表情 / 图片 / 文件）+ 输入框 + 发送（与脚本端第三栏同一结构） -->
            <div class="znhd-phone-composer">
                <!-- 在线表情面板：展开时内嵌在工具栏上方（微信式），再点表情按钮收起 -->
                <EmojiPanel v-if="emojiOpen" @pick="sendEmoji" />

                <div class="znhd-composer-tools">
                    <Button variant="ghost" size="icon-sm" aria-label="表情" @click="emojiOpen = !emojiOpen">
                        <Icon name="smile" :size="18" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="图片上传"
                        :disabled="preparing"
                        @click="fileRef?.click()">
                        <Icon v-if="preparing" name="rotateCw" :size="18" class="animate-spin" />
                        <Icon v-else name="image" :size="18" />
                    </Button>
                    <input
                        ref="fileRef"
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        @change="
                            (e) => {
                                void onPick((e.target as HTMLInputElement).files);
                                (e.target as HTMLInputElement).value = ''; /* 允许再次选同一批 */
                            }
                        " />
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="文件上传"
                        :disabled="preparing"
                        @click="fileAnyRef?.click()">
                        <Icon name="paperclip" :size="18" />
                    </Button>
                    <input
                        ref="fileAnyRef"
                        type="file"
                        multiple
                        hidden
                        @change="
                            (e) => {
                                void onPickFiles((e.target as HTMLInputElement).files);
                                (e.target as HTMLInputElement).value = '';
                            }
                        " />
                </div>

                <div class="znhd-composer-row">
                    <textarea
                        ref="textEl"
                        v-model="text"
                        class="znhd-composer-input"
                        rows="1"
                        placeholder="输入要发送到电脑的文本…（Enter 发送，Shift+Enter 换行）"
                        @keydown.enter.exact.prevent="sendText"
                        @focus="emojiOpen = false" />
                    <Button
                        size="icon-sm"
                        aria-label="发送"
                        :disabled="sendingText || !text.trim()"
                        @click="sendText">
                        <Icon name="send" :size="18" />
                    </Button>
                </div>
            </div>
        </div>

        <!-- 图片预览（复用脚本端的 ImagePreview：缩放 / 旋转 / 上下张 / A4 打印 / Esc） -->
        <ImagePreview
            v-model:open="previewOpen"
            :items="previewItems"
            :index="previewIndex"
            :names="previewNames" />

        <Toaster theme="dark" position="top-center" />
    </div>
</template>
