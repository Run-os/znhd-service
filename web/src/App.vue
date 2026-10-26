<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Icon, type IconName } from '@vue/icons';
import ImagePreview from '@vue/components/media/ImagePreview.vue';
import ChatBubble from '@vue/transfer/ChatBubble.vue';
import ChatTurn from '@vue/transfer/ChatTurn.vue';
import ChatComposer from '@vue/transfer/ChatComposer.vue';
import { toast } from './lib/toast';
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
import {
    clearChatMessages,
    flushChatMessages,
    loadChatMessages,
    saveChatMessages,
    type ChatMsg,
} from './lib/chatPersist';
import { groupTurns } from '@vue/transfer/turns';

/**
 * 手机端聊天窗（v26.10.20-v14 客户端 daisyUI 化）—— **与脚本端传输助手同一套结构**：
 *
 *   div[data-slot=card]（base-100 窗体，桌面弹窗加圆角 + 投影；v26.10.21-v1 样式同步脚本端）
 *     ├─ div[data-slot=card-header]   标题 + 版本徽标 + 圆形动作钮（daisyUI btn-ghost + tooltip）
 *     ├─ div[data-slot=card-content]  普通滚动容器（脚本端 v26.10.19-v4 同款，message-scroller 已移除，
 *     │                               仅保留 data-slot 钩子供冒烟定位）
 *     └─ div[data-slot=card-footer]   ChatComposer（daisyUI textarea + 附件 dropdown + 发送钮）
 *     └─ 卡片下方一行居中提示（连接失败 / 连接中）
 *
 * 与脚本端的差异只剩：桌面弹窗 420×680 居中（微信 PC 文件传输助手独立窗）、手机全屏贴边。
 * 功能不变：选图/拍照（自动压缩）发到电脑、发文本、任意文件互传，
 * 接收电脑发来的图片（可预览/打印/下载）、文件（可下载）与文本（可复制）。
 *
 * ⚠️ 整页骨架仍是 `position:fixed` 贴视口（见 app.css 的注释），top/height 由
 * `useShellViewport` 按 visualViewport 动态校正（键盘弹出时输入区跟着上移）。
 */

/** 聊天记录内存上限：超出丢最旧（收件项是 base64 大字符串，无上限会持续吃内存） */
const MAX_MSGS = 100;

/** 时间分隔条阈值：与脚本端一致，间隔超 5 分钟插一条 */
const TIME_GAP_MS = 5 * 60 * 1000;

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
/** 手机全屏时窗口贴边（无圆角无描边）；桌面弹窗时圆角 + 投影
 *  （v26.10.21-v1 样式同步脚本端：窗口底色 = 主题 base-100，与脚本端传输助手
 *  modal-box 同源；此前的纯黑窗体 --color-znhd-* token 已随暗色主题一起删除）。 */
const cardClass = computed(() =>
    isPhone.value
        ? 'flex min-h-0 w-full flex-1 flex-col gap-0 overflow-hidden rounded-none bg-base-100'
        : 'flex min-h-0 w-full flex-1 flex-col gap-0 overflow-hidden rounded-xl bg-base-100 shadow-2xl'
);

// ===== 消息滚动容器（普通 overflow 容器，脚本端 v26.10.19-v4 同款）=====
const scroller = ref<HTMLElement | null>(null);

/** 新消息到底自动滚（替代旧 message-scroller 的 auto-scroll / default-scroll-position=end） */
function scrollToBottom() {
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
}

watch(
    () => msgs.value.length,
    () => nextTick(scrollToBottom)
);

// ===== 预览层 =====
const previewOpen = ref(false);
const previewIndex = ref(0);
/** 预览集合 = 全部图片（含本地发出的，与脚本端 ChatWindow 对齐：v26.10.27-v1 前 out 图不可点开预览） */
const previewImages = computed(() => msgs.value.filter((m) => m.type === 'image' && !!m.url));
const previewItems = computed(() => previewImages.value.map((m) => m.url as string));
const previewNames = computed(() => previewImages.value.map((m) => m.name || 'image.jpg'));

function openPreview(m: ChatMsg) {
    const i = previewImages.value.findIndex((x) => x.id === m.id);
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

// ===== 会话持久化（v26.10.19-v10，与脚本端同款：IndexedDB + 7 天 TTL + 手动清空） =====
// ⚠️ 顺序有讲究（v26.10.22-v4）：
//   ① 先载入历史，**载入完成后**才启动「变动即落盘」与接收 —— 否则刚收到的消息可能被
//      「载入结果整体赋值」覆盖，或空列表先把历史冲掉；
//   ② 页面隐藏 / 卸载时立刻 flush，别让 800ms 防抖窗口里的最后一条丢掉。
/** 历史是否已就位（false 时一律不落盘，防「空状态覆盖旧数据」） */
let hydrated = false;

onMounted(async () => {
    msgs.value = await loadChatMessages();
    hydrated = true;
    if (!deviceId) {
        conn.value = { state: 'error', msg: '链接无效：未识别到设备ID，请重新生成二维码' };
        return;
    }
    startRelay();
});

watch(msgs, (v) => {
    if (hydrated) saveChatMessages(v);
});

// 兜底落盘：手机浏览器切后台/锁屏常常直接丢弃页面，光靠防抖会丢最后一条
function hiddenFlush() {
    if (document.visibilityState === 'hidden') flushChatMessages();
}

onMounted(() => {
    window.addEventListener('pagehide', flushChatMessages);
    document.addEventListener('visibilitychange', hiddenFlush);
});

onBeforeUnmount(() => {
    window.removeEventListener('pagehide', flushChatMessages);
    document.removeEventListener('visibilitychange', hiddenFlush);
    stopRelay?.();
    stopRelay = null;
});

/** 手动清空聊天记录（持久化 + 内存态一起清） */
function clearAll() {
    msgs.value = [];
    clearChatMessages();
    toast.success('已清空聊天记录');
}

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
            // blob 一并挂到消息上：它是**唯一能跨刷新留存**的载体（url 是 objectURL，刷新即失效）
            patchMsg(id, { url, blob: prepared.blob, name: prepared.name, mime: prepared.mime });
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
                // blob 落盘用（objectURL 跨刷新失效）；任意类型文件原样存，不压缩不转码
                blob: f,
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
    if (conn.value.state === 'online') return 'bg-success';
    if (conn.value.state === 'error') return 'bg-error';
    return 'bg-base-content/35';
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

/** 卡片下方那行提示（脚本端同位置的那行小字） */
const footerHint = computed(() => {
    if (conn.value.state === 'error') return (conn.value as { msg?: string }).msg || '连接失败，请重新扫码';
    // v26.10.19-v2：在线态去掉「已连接电脑 · 图片会先压缩再发送」—— 连接状态标题栏已有显示，
    // 「先压缩」也只是实现细节。返回空串后该行不渲染，不占视觉空间。
    if (conn.value.state === 'online') return '';
    return '正在连接电脑…';
});
</script>

<template>
    <div :class="rootClass">
        <div :class="shellClass">
            <div :class="cardClass" data-slot="card">
                <!-- ===== 头部：标题 / 版本 / 连接状态 / 动作（daisyUI：btn-ghost 圆钮 + tooltip） ===== -->
                <div data-slot="card-header" class="flex shrink-0 items-center gap-1.5 border-b border-base-300 px-4 py-2.5">
                    <div class="flex min-w-0 items-center gap-2">
                        <h3 class="truncate text-[15px] font-bold">传输助手</h3>
                        <span class="badge badge-sm shrink-0 rounded-full badge-outline">v{{ appVersion }}</span>
                    </div>
                    <div class="ml-auto flex items-center gap-1">
                        <div class="tooltip tooltip-bottom" data-tip="清空聊天记录">
                            <button
                                type="button"
                                class="btn btn-ghost btn-sm btn-circle"
                                aria-label="清空聊天记录"
                                :disabled="!msgs.length"
                                @click="clearAll">
                                <Icon name="rotateCw" :size="14" />
                            </button>
                        </div>
                        <span class="inline-flex h-5 items-center gap-1.5 text-xs text-base-content/60">
                            <i class="inline-block size-1.5 rounded-full" :class="connDot" />
                            {{ connText }}
                        </span>
                    </div>
                </div>

                <!-- ===== 消息区：普通滚动容器（脚本端 v26.10.19-v4 同款） ===== -->
                <div data-slot="card-content" class="min-h-0 flex-1 overflow-hidden p-0">
                    <div
                        ref="scroller"
                        data-slot="message-scroller"
                        class="h-full overflow-y-auto scrollbar-thin"
                        :class="isPhone ? 'px-3 py-6' : 'px-6 py-6'">
                        <ChatTurn
                            v-for="turn in turns"
                            :key="turn.key"
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
                                :clickable="row.msg.type === 'image'"
                                :can-download="row.msg.type === 'file'"
                                :copy-label="row.msg.side === 'in' && row.msg.type === 'text' ? '复制' : ''"
                                @preview="openPreview(row.msg)"
                                @download="downloadMsg(row.msg)"
                                @copy="copyInText(row.msg.text || '')" />
                        </ChatTurn>
                    </div>
                </div>

                <!-- ===== 输入区（与脚本端同一个 ChatComposer：textarea + 附件 dropdown + 发送） ===== -->
                <div data-slot="card-footer" class="shrink-0 px-3 pb-3">
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
                </div>
            </div>

            <!-- 提示为空时整行不渲染，不留死内边距（冒烟断言它贴视口底） -->
            <div
                v-if="footerHint"
                class="znhd-phone-hint shrink-0 px-0.5 pb-1 text-center text-xs text-base-content/60">
                {{ footerHint }}
            </div>
        </div>

        <!-- 图片预览（复用脚本端的 ImagePreview：缩放 / 旋转 / 上下张 / A4 打印 / Esc） -->
        <ImagePreview v-model:open="previewOpen" :items="previewItems" :index="previewIndex" :names="previewNames" />
    </div>
</template>
