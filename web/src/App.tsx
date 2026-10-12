import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp, Badge, Button, Image, Input, Tag } from 'antd';
import { PictureOutlined, PrinterOutlined, SendOutlined, SmileOutlined } from '@ant-design/icons';
import { useReactToPrint } from 'react-to-print';
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
import EmojiPanel from './EmojiPanel';
import type { PickedEmoji } from './lib/emojiPack';
// 预览相关的通用件与脚本端**共用同一份**（v26.10.08-v13 起，见仓库根 shared/preview/）
import { appendPreviewActions } from '../../shared/preview/actions';
import { getPreviewHost } from '../../shared/preview/host';
import { syncPreviewMask } from '../../shared/preview/mask';
import { buildA4ImageNode, PRINT_PAGE_STYLE } from '../../shared/preview/print';

/**
 * 手机端聊天窗（v26.10.12-v5 重构；v26.10.13-v3 加表情按钮 + 输入区吸底修复）：整页改为
 * **与脚本端第三栏同一套聊天样式**（微信暗色）。
 *
 * 与旧「上传到电脑」双卡片页的关系：功能全部保留 —— 选图/拍照（自动压缩）发到电脑、
 * 发文本到电脑、**点在线表情直接发到电脑**（v26.10.13-v3）、接收电脑发来的图片
 * （可预览/打印/复制/下载）与文本 —— 只是呈现方式从「两张卡片 + 画廊弹窗」变成
 * 「消息气泡 + 底部输入区」：
 *   · 手机发出去的 = 右侧绿色气泡（微信「我方」配色 #07C160）；
 *   · 电脑发来的   = 左侧灰色气泡（微信「对方」配色 #2F2F2F）；
 *   · 发送状态（发送中 / 已发送 / 发送失败）显示在气泡下方的小字；
 *   · 间隔超 5 分钟的消息之间插一条居中时间分隔条（与脚本端第三栏同一规则）。
 *
 * ⚠️ 整页骨架是 `position:fixed` 贴视口（见 app.css `.znhd-phone-chat` 的注释：
 * antd `<AntApp>` 的包裹层没有高度，`height:100%` 会断链），top/height 由
 * `useShellViewport` 按 visualViewport 动态校正（键盘弹出时输入区跟着上移）。
 */

/** 聊天记录内存上限：超出丢最旧（收件项是 base64 大字符串，无上限会持续吃内存；旧画廊是 27，聊天窗放宽到 100） */
const MAX_MSGS = 100;

/** 时间分隔条阈值：与脚本端第三栏一致，间隔超 5 分钟插一条 */
const TIME_GAP_MS = 5 * 60 * 1000;

interface ChatMsg {
    id: string;
    type: 'image' | 'text';
    /** out = 手机发到电脑；in = 电脑发来 */
    side: 'in' | 'out';
    text?: string;
    /** 图片展示地址（out = objectURL；in = data:URL） */
    url?: string;
    name?: string;
    mime?: string;
    /** 发送状态（仅 out；发送中 / 已发送 / 发送失败） */
    state?: 'sending' | 'failed' | 'ok';
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

export default function App() {
    const { message } = AntApp.useApp();
    const deviceId = useMemo(() => parseDeviceId(window.location.pathname), []);
    // 本机（手机）设备 ID：持久化在 localStorage，用于让电脑端区分「哪台手机在线」
    const phoneId = useMemo(() => getPhoneId(), []);

    const [conn, setConn] = useState<ConnState>({ state: 'offline' });
    const [msgs, setMsgs] = useState<ChatMsg[]>([]);
    const [text, setText] = useState('');
    const [sendingText, setSendingText] = useState(false);
    const [preparing, setPreparing] = useState(false);
    /** 表情面板展开态（v26.10.13-v3：内嵌在输入区里、工具栏上方） */
    const [emojiOpen, setEmojiOpen] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    // 整页骨架跟随视觉视口（键盘弹出 / 工具栏收放时输入区仍贴最底）
    useShellViewport();

    const pushMsg = useCallback((m: ChatMsg) => {
        setMsgs((prev) => {
            const next = prev.concat(m);
            return next.length > MAX_MSGS ? next.slice(next.length - MAX_MSGS) : next;
        });
    }, []);

    const patchMsg = useCallback((id: string, patch: Partial<ChatMsg>) => {
        setMsgs((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    }, []);

    // ===== 收到的内容（电脑 → 手机）=====
    const onItem = useCallback(
        (item: RecvItem) => {
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
                message.success('收到电脑发来的图片');
            } else if (item.type === 'text') {
                pushMsg({ id: uid(), type: 'text', side: 'in', text: item.text || '', ts: item.ts || Date.now() });
                message.success('收到电脑发来的文本');
            }
        },
        [message, pushMsg]
    );

    // 心跳 + 长轮询：挂载时启动，卸载时停止（StrictMode 下会 mount→unmount→mount，靠 cleanup 保证不重复）
    useEffect(() => {
        if (!deviceId) {
            setConn({ state: 'error', msg: '链接无效：未识别到设备ID，请重新生成二维码' });
            return;
        }
        return startPhoneRelay({ deviceId, phoneId, onConn: setConn, onItem });
    }, [deviceId, phoneId, onItem]);

    // 消息变化 → 滚动到底（聊天窗的基本行为）；表情面板开合也重算（面板会挤占滚动区高度）
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [msgs, emojiOpen]);

    // ===== 选图（多选）→ 逐张压缩 → 变成「发送中」气泡 → 顺序发送 =====
    const onPick = async (files: FileList | null) => {
        const list = Array.from(files || []);
        if (!list.length) return;
        setPreparing(true);
        try {
            const queued: Array<{ id: string; blob: Blob; name: string; mime: string }> = [];
            for (const f of list) {
                const prepared = await prepareImage(f);
                const id = uid();
                queued.push({ id, blob: prepared.blob, name: prepared.name, mime: prepared.mime });
                pushMsg({
                    id,
                    type: 'image',
                    side: 'out',
                    url: URL.createObjectURL(prepared.blob),
                    name: prepared.name,
                    mime: prepared.mime,
                    state: 'sending',
                    ts: Date.now(),
                });
            }
            // 逐张顺序发送（保证到达顺序）；失败即停，剩余保持「发送中」标记为失败
            for (const it of queued) {
                try {
                    const b64 = await blobToBase64(it.blob);
                    const res = await postItem({ name: it.name, mime: it.mime, data: b64 });
                    if (res && res.ok) {
                        patchMsg(it.id, { state: 'ok' });
                    } else {
                        patchMsg(it.id, { state: 'failed', err: (res && res.error) || '未知错误' });
                        message.error('第 ' + it.name + ' 发送失败，可重新选图重试');
                        break;
                    }
                } catch (e: any) {
                    patchMsg(it.id, { state: 'failed', err: (e && e.message) || '读取图片失败' });
                    break;
                }
            }
        } finally {
            setPreparing(false);
        }
    };

    // ===== 发送文本 =====
    const sendText = async () => {
        const t = (text || '').replace(/\s+$/, '');
        if (!t || sendingText) return;
        const id = uid();
        setSendingText(true);
        pushMsg({ id, type: 'text', side: 'out', text: t, state: 'sending', ts: Date.now() });
        setText('');
        const res = await postItem({ text: t });
        setSendingText(false);
        if (res && res.ok) {
            patchMsg(id, { state: 'ok' });
        } else {
            patchMsg(id, { state: 'failed', err: (res && res.error) || '未知错误' });
            setText(t); // 发送失败把内容还回输入框，方便改完重发
        }
    };

    // ===== 发送在线表情（v26.10.13-v3）：点一张直接发，与脚本端「点表情即发出」同语义 =====
    // 面板交回的就是下好的 blob，这里 base64 后走与文本/图片同一条 postItem 链路。
    // ⚠️ 不走 prepareImage 的 canvas 压缩：表情本来就是 2–6KB 的 webp，原样发更小也更保真
    //   （PC 端会话气泡与「图片上传」收到的图一样直接渲染，webp 现代浏览器都认）。
    const sendEmoji = async (emoji: PickedEmoji) => {
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
            const res = await postItem({ name: emoji.name, mime, data: b64 });
            if (res && res.ok) {
                patchMsg(id, { state: 'ok' });
            } else {
                patchMsg(id, { state: 'failed', err: (res && res.error) || '未知错误' });
                message.error('表情 ' + emoji.name + ' 发送失败');
            }
        } catch (e: any) {
            patchMsg(id, { state: 'failed', err: (e && e.message) || '读取图片失败' });
        }
    };

    // ===== 收到的文本：复制 =====
    const copyInText = async (t: string) => {
        try {
            await navigator.clipboard.writeText(t);
            message.success('已复制文本');
        } catch {
            message.warning('复制失败，请长按文本手动复制');
        }
    };

    /**
     * 打印能力来自 react-to-print（与脚本端同一个库、同一套 A4 版式，v26.10.08-v13 起）。
     * ⚠️ `ignoreGlobalStyles: true`：没必要把整页样式抄进打印 iframe。
     */
    const printTitleRef = useRef('image');
    const doPrint = useReactToPrint({
        ignoreGlobalStyles: true,
        documentTitle: () => printTitleRef.current,
        pageStyle: PRINT_PAGE_STYLE,
    });

    /** 打印「当前预览的那张图」的原图，自适应 A4（横图自动旋转 90° 铺满；不裁切、不跨页） */
    const printRecvImage = (url: string, fname: string) => {
        printTitleRef.current = fname;
        // 先探测图片自然尺寸（横图旋转 90° 铺满纵向 A4 的判断需要），失败按未知尺寸兜底
        const probe = document.createElement('img');
        probe.onload = () => doPrint(() => buildA4ImageNode(url, fname, { width: probe.naturalWidth, height: probe.naturalHeight }));
        probe.onerror = () => doPrint(() => buildA4ImageNode(url, fname));
        probe.src = url;
    };

    /** 头部连接状态 */
    const connBadge = () => {
        if (conn.state === 'online') return <Badge status="success" text="已连接电脑" />;
        if (conn.state === 'error') return <Badge status="error" text={conn.msg || '连接失败'} />;
        return <Badge status="default" text="连接中…" />;
    };

    /** 收到的图片（可预览 + 打印）：与脚本端共用 shared/preview 的整套集成。
     *  ⚠️ 预览配置必须长在**每张 Image 自己的 preview prop** 上：PreviewGroup 的 React context
     *  只对它的**子树**生效，气泡里的 Image 不在 Group 子树内时点击会走 antd 默认预览
     *  （portal 到 body、没有打印按钮）——v5 首版冒烟抓到的真 bug。 */
    const renderInImage = (m: ChatMsg) => (
        <Image
            src={m.url}
            alt={m.name || 'image'}
            width={220}
            style={{ borderRadius: 8, display: 'block', height: 'auto' }}
            preview={{
                getContainer: getPreviewHost,
                onOpenChange: (o: boolean) => syncPreviewMask(o),
                actionsRender: (originalNode) => {
                    const printBtn = (
                        <button
                            key="znhd-print"
                            type="button"
                            className="ant-image-preview-actions-action"
                            aria-label="print"
                            title="打印原图"
                            onClick={() => {
                                if (m.url) printRecvImage(m.url, m.name || 'image.jpg');
                            }}>
                            <PrinterOutlined />
                        </button>
                    );
                    return appendPreviewActions(originalNode, printBtn);
                },
            }}
        />
    );

    return (
        <div className="znhd-phone-chat">
            {/* 头部：标题 + 连接状态（设备 ID 收进小字，不再占半屏） */}
            <header className="znhd-phone-header">
                <div className="znhd-phone-header-row">
                    <span className="znhd-phone-title">传输助手</span>
                    <Tag color="green" variant="filled" style={{ marginLeft: 8 }}>
                        v{__APP_VERSION__}
                    </Tag>
                    <span style={{ flex: 1 }} />
                    <span className="znhd-phone-conn">{connBadge()}</span>
                </div>
                <div className="znhd-phone-sub">
                    本机（手机）ID：{phoneId || '未知'} · 电脑设备：{deviceId || '未识别，请重新生成二维码'}
                </div>
            </header>

            {/* 消息滚动区 */}
            <div className="znhd-phone-scroll" ref={scrollRef}>
                {msgs.length === 0 ? (
                    <div className="znhd-chat-empty">
                        选择图片 / 拍照 / 发表情，或输入文本发送到电脑；电脑发来的内容也会出现在这里。
                    </div>
                ) : null}
                {msgs.map((m, i) => {
                    const prev = i > 0 ? msgs[i - 1] : undefined;
                    const showTime = !prev || (m.ts || 0) - (prev.ts || 0) > TIME_GAP_MS;
                    const meta =
                        m.side === 'out'
                            ? m.state === 'sending'
                                ? '发送中…'
                                : m.state === 'failed'
                                ? '发送失败' + (m.err ? '：' + m.err : '')
                                : '已发送'
                            : '';
                    return (
                        <div key={m.id}>
                            {showTime ? <div className="znhd-chat-time">{timeLabel(m.ts)}</div> : null}
                            <div className="znhd-chat-msg" data-side={m.side}>
                                <span
                                    className="znhd-chat-avatar"
                                    style={{ background: m.side === 'out' ? '#3D8B72' : '#4A4A4A' }}>
                                    {m.side === 'out' ? '我' : '电'}
                                </span>
                                <div style={{ minWidth: 0, maxWidth: '78%' }}>
                                    <div className={'znhd-chat-bubble' + (m.type === 'image' ? ' znhd-chat-bubble-img' : '')}>
                                        {m.type === 'image' ? (
                                            m.side === 'in' ? (
                                                renderInImage(m)
                                            ) : (
                                                <img className="znhd-chat-img" src={m.url} alt={m.name || 'image'} />
                                            )
                                        ) : (
                                            <span>{m.text}</span>
                                        )}
                                    </div>
                                    {m.side === 'in' && m.type === 'text' ? (
                                        <button type="button" className="znhd-chat-copy" onClick={() => void copyInText(m.text || '')}>
                                            复制
                                        </button>
                                    ) : null}
                                    {meta ? (
                                        <div
                                            className="znhd-chat-meta"
                                            style={m.state === 'failed' ? { color: '#e86c6c' } : undefined}>
                                            {meta}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* 底部输入区：图标行（表情 / 图片）+ 输入框 + 发送（与脚本端第三栏同一结构） */}
            <div className="znhd-phone-composer">
                {/* 在线表情面板：展开时内嵌在工具栏上方（微信式），再点表情按钮收起 */}
                {emojiOpen ? <EmojiPanel onPick={(e) => void sendEmoji(e)} /> : null}
                <div className="znhd-composer-tools">
                    <Button
                        type="text"
                        aria-label="表情"
                        onClick={() => setEmojiOpen((v) => !v)}
                        icon={<SmileOutlined />}
                    />
                    <Button
                        type="text"
                        aria-label="图片上传"
                        loading={preparing}
                        onClick={() => fileRef.current?.click()}
                        icon={<PictureOutlined />}
                    />
                    <input
                        ref={fileRef}
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(e) => {
                            void onPick(e.target.files);
                            e.target.value = ''; // 允许再次选同一批
                        }}
                    />
                </div>
                <div className="znhd-composer-row">
                    <Input.TextArea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onPressEnter={(e) => {
                            if (!(e as unknown as KeyboardEvent).shiftKey) {
                                e.preventDefault();
                                void sendText();
                            }
                        }}
                        // 聚焦 = 用户要打字：收起表情面板，否则键盘 + 面板双双顶起
                        onFocus={() => setEmojiOpen(false)}
                        placeholder="输入要发送到电脑的文本…（Enter 发送，Shift+Enter 换行）"
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        style={{ background: '#1E1E1E', color: 'rgba(255,255,255,0.9)' }}
                    />
                    <Button
                        type="primary"
                        aria-label="发送"
                        disabled={sendingText || !text.trim()}
                        loading={sendingText}
                        onClick={() => void sendText()}
                        icon={<SendOutlined />}
                    />
                </div>
            </div>

            {/* 「收到的图片」的预览配置直接挂在每张 Image 上（见 renderInImage 的说明） */}
        </div>
    );
}
