<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Icon, type IconName } from '@vue/icons';
import { Toaster } from '@vue/components/ui/sonner';
import {
    Card,
    CardAction,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from '@vue/components/ui/card';
import {
    MessageScroller,
    MessageScrollerButton,
    MessageScrollerContent,
    MessageScrollerItem,
    MessageScrollerProvider,
    MessageScrollerViewport,
} from '@vue/components/ui/message-scroller';
import ImagePreview from '@vue/components/media/ImagePreview.vue';
import ChatBubble from '@vue/transfer/ChatBubble.vue';
import ChatTurn from '@vue/transfer/ChatTurn.vue';
import ChatComposer from '@vue/transfer/ChatComposer.vue';
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
import { clearChatMessages, loadChatMessages, saveChatMessages, type ChatMsg } from './lib/chatPersist';
import { groupTurns } from '@vue/transfer/turns';

/**
 * 手机端聊天窗（v26.10.18-v8）：**与脚本端传输助手同一套 chat 布局** ——
 * 直接照搬 shadcn-vue `message-scroller` 示例的 Card（Header / Content / Footer 三段），
 * 气泡复用 `@vue/transfer/ChatBubble.vue`，输入区复用 `@vue/transfer/ChatComposer.vue`
 * （InputGroup：文本域 + block-end 的「+」下拉与发送键）。
 *
 * 功能不变：选图/拍照（自动压缩）发到电脑、发文本、任意文件互传，
 * 接收电脑发来的图片（可预览/打印/下载）、文件（可下载）与文本（可复制）。
 *   · 手机发出去的 = 右侧气泡（`mine`）；电脑发来的 = 左侧气泡；
 *   · 发送状态（发送中 / 已发送 / 失败）显示在气泡下方的小字；
 *   · 间隔超 5 分钟的消息之间插一条居中时间分隔条（ChatBubble 的 `timeLabel`）。
 *
 * ⚠️ 整页骨架仍是 `position:fixed` 贴视口（见 app.css 的注释），top/height 由
 * `useShellViewport` 按 visualViewport 动态校正（键盘弹出时输入区跟着上移）。
 * 桌面浏览器打开时（`useLayoutMode`）聊天窗变成屏幕居中的弹窗。
 */

/** 聊天记录内存上限：超出丢最旧（收件项是 base64 大字符串，无上限会持续吃内存） */
const MAX_MSGS = 100;

/** 时间分隔条阈值：与脚本端一致，间隔超 5 分钟插一条 */
const TIME_GAP_MS = 5 * 60 * 1000;

/** 消息形态见 `lib/chatPersist.ts`（v26.10.19-v10 起类型随持久化模块走，脚本端同款 7 天 TTL） */

let seq = 0;
const uid = () => 'z' + ++seq + '-' + Date.now().toString(36);

/** 时间分隔条文案（与脚本端同一套：今天 HH:mm / 昨天 / MM-DD） */
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

/** 体积显示（文件气泡用）；档位与脚本端 `formatBytes` 一致（B / KB / MB / GB） */
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
// 本机（手机）设备 ID：持久化在 localStorage
const phoneId = getPhoneId();

/** 构建期注入的版本号（来自 relay-server/package.json）。模板里读不到全局常量，先落到本地变量 */
const appVersion = __APP_VERSION__;

const conn = ref<ConnState>({ state: 'offline' });
const msgs = ref<ChatMsg[]>([]);
const text = ref('');
const sendingText = ref(false);
const preparing = ref(false);

const fileRef = ref<HTMLInputElement | null>(null);
/** 任意文件的隐藏 input（accept 留空 = 不过滤类型） */
const fileAnyRef = ref<HTMLInputElement | null>(null);

// 整页骨架跟随视觉视口（键盘弹出 / 工具栏收放时输入区仍贴最底）
useShellViewport();
// 桌面 → 居中弹窗；手机 → 全屏（见 lib/layoutMode.ts 的判定规则）
const layoutMode = useLayoutMode();

const isPhone = computed(() => layoutMode.value === 'phone');
const rootClass = computed(() => (isPhone.value ? '' : 'znhd-window-layer'));
const shellClass = computed(() => (isPhone.value ? 'znhd-phone-chat' : 'znhd-phone-chat znhd-chat-window'));
/** 手机全屏时卡片贴边（去掉圆角/描边）；桌面弹窗时用完整 Card 外观。
 *  v26.10.19-v3：与脚本端 v26.10.18-v9 对齐——窗口底色纯黑，桌面弹窗外圈
 *  rgb(34,34,34) 细边（Card 自带 ring-1，只换色）。 */
const cardClass = computed(() =>
    isPhone.value
        ? 'min-h-0 w-full flex-1 gap-0 rounded-none py-0 ring-0 !bg-black'
        : 'min-h-0 w-full flex-1 gap-0 rounded-xl py-0 !bg-black !ring-[rgb(34,34,34)]'
);

// ===== 预览层 =====
const previewOpen = ref(false);
const previewIndex = ref(0);
/** 预览只针对「电脑发来的图片」（本地发出的不预览，避免和上传态混淆） */
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
        // 任意文件：data:URL 不用在 <img> 上，而是挂到 <a download> 交给浏览器下载。
        // 用 data:URL 而非 objectURL：收件项是事件回调里的瞬时值，没有生命周期管理点来 revoke。
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

function startRelay() {
    if (!deviceId) return;
    stopRelay = startPhoneRelay({ deviceId, phoneId, onConn: (c) => (conn.value = c), onItem });
}

/** 手动重连（v26.10.19-v9）：停掉现有轮询再重起（消息列表保留不清） */
function refreshConn() {
    if (stopRelay) {
        try {
            stopRelay();
        } catch (e) {
            /* 已停止 */
        }
        stopRelay = null;
    }
    conn.value = { state: 'offline' };
    startRelay();
}

// ===== 会话持久化（v26.10.19-v10，与脚本端同款：IndexedDB + 7 天 TTL + 手动清空） =====
onMounted(async () => {
    msgs.value = await loadChatMessages();
});
watch(msgs, (v) => saveChatMessages(v));

/** 手动清空聊天记录（持久化 + 内存态一起清） */
function clearAll() {
    msgs.value = [];
    clearChatMessages();
    toast.success('已清空聊天记录');
}

onMounted(() => {
    if (!deviceId) {
        conn.value = { state: 'error', msg: '链接无效：未识别到设备ID，请重新生成二维码' };
        return;
    }
    startRelay();
});

onBeforeUnmount(() => {
    stopRelay?.();
    stopRelay = null;
});

// ===== 选图（多选）→ 先出「发送中」气泡 → 逐张压缩 → 顺序发送 =====
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
            patchMsg(id, { url, name: prepared.name, mime: prepared.mime });
            if (tmpUrl !== url) URL.revokeObjectURL(tmpUrl);
        }
        // 逐张顺序发送（保证到达顺序）；失败即停，剩余标记为失败
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

// ===== 选文件（任意类型，多选）→ 不压缩 → 顺序发送 =====
async function onPickFiles(files: FileList | null) {
    const list = Array.from(files || []);
    if (!list.length) return;
    preparing.value = true;
    try {
        const queued: Array<{ id: string; blob: Blob; name: string; mime: string }> = [];
        for (const f of list) {
            const id = uid();
            const name = f.name || 'file.bin';
            const mime = f.type || 'application/octet-stream';
            queued.push({ id, blob: f, name, mime });
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
        for (const it of queued) {
            try {
                const b64 = await blobToBase64(it.blob);
                let lastPct = -1;
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
    const res = await postItem({ text: t }, phoneId);
    sendingText.value = false;
    if (res && res.ok) {
        patchMsg(id, { state: 'ok' });
    } else {
        patchMsg(id, { state: 'failed', err: (res && res.error) || '未知错误' });
        text.value = t; // 发送失败把内容还回输入框，方便改完重发
    }
}

/** 收到文件的下载（data:URL 直接交给浏览器的下载器） */
function downloadMsg(m: ChatMsg) {
    if (!m.url) return;
    const a = document.createElement('a');
    a.href = m.url;
    a.download = m.name || 'file';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/** 收到的文本：复制 */
async function copyInText(t: string) {
    try {
        await navigator.clipboard.writeText(t);
        toast.success('已复制文本');
    } catch {
        toast.warning('复制失败，请长按文本手动复制');
    }
}

/** 头部连接状态（圆点 + 文字） */
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

/** 轮次：同方向且间隔 ≤ 2 分钟的消息合并进一个 BubbleGroup（与脚本端同一套 groupTurns） */
const turns = computed(() =>
    groupTurns(msgs.value.map((m, i) => ({ msg: m, sepText: showTimeAt(i) ? timeLabel(m.ts) : '' })), {
        keyOf: (row) => row.msg.id,
        mineOf: (row) => row.msg.side === 'out',
        tsOf: (row) => row.msg.ts || 0,
        sepOf: (row) => row.sepText,
    })
);

/** 「+」下拉里的附件入口（图片 / 任意文件） */
const attachActions = computed<
    Array<{ key: string; label: string; icon: IconName; onClick: () => void; disabled: boolean }>
>(() => [
    {
        key: 'image',
        label: '图片',
        icon: 'image',
        onClick: () => fileRef.value?.click(),
        disabled: preparing.value,
    },
    {
        key: 'file',
        label: '文件',
        icon: 'paperclip',
        onClick: () => fileAnyRef.value?.click(),
        disabled: preparing.value,
    },
]);

/** 卡片下方那行提示（对应示例里 `Demo is read only…` 的位置） */
const footerHint = computed(() => {
    if (conn.value.state === 'error') return (conn.value as { msg?: string }).msg || '连接失败，请重新扫码';
    // v26.10.19-v2：在线态去掉「已连接电脑 · 图片会先压缩再发送」—— 连接状态标题栏已有显示，
    // 「先压缩」也只是实现细节。返回空串后该行只剩 4px 底部内边距，不占视觉空间。
    if (conn.value.state === 'online') return '';
    return '正在连接电脑…';
});
</script>

<template>
    <div :class="rootClass">
        <div :class="shellClass">
            <MessageScrollerProvider auto-scroll default-scroll-position="end">
              <div class="relative flex min-h-0 flex-1 flex-col gap-2">
                <Card :class="cardClass">
                    <!-- ===== 头部：标题 / 设备信息 / 连接状态（与脚本端同一结构） ===== -->
                    <!-- ⚠️ 分界线不能写 border-b：Tailwind v4 默认边框色是 currentColor ⇒ 一条亮白线；
                            写死 rgb(34,34,34)（v26.10.19-v1，与脚本端 v26.10.18-v9 同色）。原 border-b
                            触发的 [.border-b]:pb-6 规则随之失效，补回 pb-6 保持原有间距。
                        v26.10.19-v4：cardClass 是 py-0（Card 基类上下 24px 已被去掉），Header 只补
                            pb-6 会让标题贴死视口顶 ⇒ 改 py-6（分隔线上下各 24px 对称，标题栏居中）。 -->
                    <CardHeader class="shrink-0 gap-1 py-6 [border-bottom:1px_solid_rgb(34,34,34)]">
                        <CardTitle class="flex items-center gap-2 text-[15px]">
                            传输助手
                            <span
                                class="inline-flex h-5 items-center rounded-[4px] bg-primary/15 px-1.5 text-[11px] font-medium text-primary">
                                v{{ appVersion }}
                            </span>
                        </CardTitle>
                        <!-- v26.10.19-v9：删掉「本机 id · 电脑 id」描述行；CardAction 加脚本端同款圆形刷新按钮
                             v26.10.19-v10：加「清空聊天记录」（持久化 + 内存态一起清，对齐脚本端） -->
                        <CardAction class="flex items-center gap-1.5">
                            <button
                                type="button"
                                aria-label="清空聊天记录"
                                title="清空聊天记录"
                                class="inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-transparent p-0 text-white/80 outline-none hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                                :disabled="!msgs.length"
                                @click="clearAll">
                                <Icon name="rotateCw" :size="14" />
                            </button>
                            <button
                                type="button"
                                aria-label="重新连接"
                                title="重新连接"
                                class="inline-flex size-7 cursor-pointer items-center justify-center rounded-full border border-white/20 bg-transparent p-0 text-white/80 outline-none hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                                :disabled="conn.state !== 'offline' && conn.state !== 'error'"
                                @click="refreshConn">
                                <Icon name="refresh" :size="14" />
                            </button>
                            <!-- h-5 与标题行（版本徽章 h-5）同高 ⇒ 顶对齐的 grid 里中心线也在一条线上（v26.10.19-v1） -->
                            <span class="inline-flex h-5 items-center gap-1.5 text-xs text-muted-foreground">
                                <i class="inline-block size-1.5 rounded-full" :class="connDot" />
                                {{ connText }}
                            </span>
                        </CardAction>
                    </CardHeader>

                    <!-- ===== 消息区：单条时间线（v26.10.19-v3 与脚本端 v26.10.19-v1 同步：
                              去掉「还没有消息」空态，消息区保持空白干净） ===== -->
                    <CardContent class="min-h-0 flex-1 overflow-hidden !bg-black p-0">
                        <MessageScroller>
                            <MessageScrollerViewport>
                                <!-- 手机全屏时左右内边距 24px→12px（v26.10.19-v1：窄屏下头像别离边框太远）；
                                        桌面弹窗保持 p-6 与脚本端一致 -->
                                <MessageScrollerContent :class="isPhone ? 'px-3 py-6' : 'p-6'">
                                    <MessageScrollerItem
                                        v-for="turn in turns"
                                        :key="turn.key"
                                        :message-id="turn.key"
                                        :scroll-anchor="turn.mine">
                                        <ChatTurn
                                            :mine="turn.mine"
                                            :session-key="deviceId"
                                            :my-seed="phoneId"
                                            :time-label="turn.sepText"
                                            :count="turn.items.length">
                                            <ChatBubble
                                                v-for="row in turn.items"
                                                :key="row.msg.id"
                                                grouped
                                                :type="row.msg.type"
                                                :mine="row.msg.side === 'out'"
                                                :text="row.msg.text || ''"
                                                :name="row.msg.name || ''"
                                                :mime="row.msg.mime || ''"
                                                :size-text="fmtSize(row.msg.size || 0)"
                                                :image-src="row.msg.url || ''"
                                                :meta="metaOf(row.msg)"
                                                :meta-danger="row.msg.state === 'failed'"
                                                :progress="row.msg.state === 'sending' ? (row.msg.progress ?? null) : null"
                                                :error="row.msg.state === 'failed' ? row.msg.err || '' : ''"
                                                :clickable="row.msg.type === 'image' && row.msg.side === 'in'"
                                                :can-download="row.msg.type === 'file'"
                                                :copy-label="row.msg.side === 'in' && row.msg.type === 'text' ? '复制' : ''"
                                                @preview="openPreview(row.msg)"
                                                @download="downloadMsg(row.msg)"
                                                @copy="copyInText(row.msg.text || '')" />
                                        </ChatTurn>
                                    </MessageScrollerItem>
                                </MessageScrollerContent>
                            </MessageScrollerViewport>
                            <!-- 与脚本端一致：向下箭头改圆形 28px（v26.10.19-v3 同步） -->
                            <MessageScrollerButton class="!size-7 !rounded-full [&_svg]:size-3.5" />
                        </MessageScroller>
                    </CardContent>

                    <!-- ===== 输入区（与脚本端同一个 ChatComposer：InputGroup + 附件下拉） ===== -->
                    <!-- v26.10.19-v4：cardClass 是 py-0，Footer 不补 pb 输入框会贴死窗口底边（用户截图实录）
                            ⇒ 加 pb-6，与脚本端「Card 底部 24px」的视觉节奏一致 -->
                    <CardFooter class="shrink-0 flex-col gap-2 pb-6">
                        <ChatComposer
                            v-model="text"
                            :disabled="sendingText || preparing"
                            placeholder="输入要发送到电脑的文本…"
                            :attach="attachActions"
                            @send="sendText" />

                        <input
                            ref="fileRef"
                            type="file"
                            accept="image/*"
                            multiple
                            hidden
                            @change="
                                (e) => {
                                    void onPick((e.target as HTMLInputElement).files);
                                    (e.target as HTMLInputElement).value = '';
                                }
                            " />
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
                    </CardFooter>
                </Card>

                    <!-- v26.10.19-v3 与脚本端 v26.10.19-v4 同步：提示为空时整行不渲染，不留死内边距 -->
                    <div
                        v-if="footerHint"
                        class="znhd-phone-hint shrink-0 px-0.5 pb-1 text-center text-xs text-muted-foreground">
                        {{ footerHint }}
                    </div>
              </div>
            </MessageScrollerProvider>
        </div>

        <!-- 图片预览（复用脚本端的 ImagePreview：缩放 / 旋转 / 上下张 / A4 打印 / Esc） -->
        <ImagePreview v-model:open="previewOpen" :items="previewItems" :index="previewIndex" :names="previewNames" />

        <Toaster theme="dark" position="top-center" />
    </div>
</template>
