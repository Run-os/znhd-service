import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp, Button, Image, Input, Popover, Tag } from 'antd';
import {
    CopyOutlined,
    DownloadOutlined,
    InfoCircleOutlined,
    PictureOutlined,
    PrinterOutlined,
    SendOutlined,
} from '@ant-design/icons';
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
// 预览相关的通用件与脚本端**共用同一份**（v26.10.08-v13 起，见仓库根 shared/preview/）
import { appendPreviewActions } from '../../shared/preview/actions';
import { getPreviewHost } from '../../shared/preview/host';
import { syncPreviewMask } from '../../shared/preview/mask';
import { buildA4ImageNode, PRINT_PAGE_STYLE } from '../../shared/preview/print';

/**
 * v26.10.13-v1：手机页从「卡片式上传页」整体重排为**聊天窗口**（用户拍板的通用 IM 聊天流）。
 * 收发内容按时间排气泡：收到的在左、发出的在右、连接/结果等状态走居中系统气泡；
 * 底部一条输入栏（选图 + 文本 + 发送），待发图片走输入栏上方的「待发条」（方案 A，点发送才入流）。
 * relay 通信层（lib/relay.ts）、压缩（lib/image.ts）、预览共享层全部不动。
 */

/** 收件图片上限：与脚本端 MAX_GALLERY=27 对齐，超出丢最旧（data URL 大字符串，无上限会持续吃内存） */
const MAX_RECV = 27;

/** 相邻收到的图片在这么短时间内到达 → 并进同一个气泡（电脑端连发多图时呈现为一组） */
const IMG_GROUP_WINDOW = 2000;

interface PendingImage {
    id: string;
    blob: Blob;
    name: string;
    mime: string;
    url: string;
}

interface RecvImage {
    id: string;
    url: string;
    mime: string;
    name?: string;
}

/** 聊天流消息（discriminated union，渲染时按 kind 分支） */
type ChatMsg =
    /** 居中系统气泡：连接变化 / 发送结果 / 失败原因 */
    | { kind: 'sys'; id: string; text: string; tone: 'info' | 'error' }
    /** 收到的图片（同窗到达的多张并成一个九宫格气泡） */
    | { kind: 'img-in'; id: string; ts: number; imgs: RecvImage[] }
    /** 收到的文本 */
    | { kind: 'text-in'; id: string; text: string }
    /** 发出的图片组（一次「发送」N 张 = 一个气泡；done/total 驱动进度文案） */
    | {
          kind: 'img-out';
          id: string;
          urls: string[];
          total: number;
          done: number;
          state: 'sending' | 'sent' | 'failed';
          note?: string;
      }
    /** 发出的文本 */
    | { kind: 'text-out'; id: string; text: string; state: 'sending' | 'sent' | 'failed'; note?: string };

let seq = 0;
const uid = () => 'z' + ++seq + '-' + Date.now().toString(36);

export default function App() {
    const { message } = AntApp.useApp();
    const deviceId = useMemo(() => parseDeviceId(window.location.pathname), []);
    // 本机（手机）设备 ID：持久化在 localStorage，用于让电脑端区分「哪台手机在线」
    const phoneId = useMemo(() => getPhoneId(), []);

    const [conn, setConn] = useState<ConnState>({ state: 'offline' });
    const [msgs, setMsgs] = useState<ChatMsg[]>([]);
    const [pending, setPending] = useState<PendingImage[]>([]);
    const [preparing, setPreparing] = useState(false);
    const [sending, setSending] = useState(false);
    const [text, setText] = useState('');
    const [sendTextBusy, setSendTextBusy] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const streamRef = useRef<HTMLDivElement>(null);

    const pushMsg = useCallback((m: ChatMsg) => {
        setMsgs((prev) => [...prev, m]);
    }, []);

    const patchMsg = useCallback((id: string, patch: Record<string, unknown>) => {
        setMsgs((prev) => prev.map((m) => (m.id === id ? ({ ...m, ...patch } as ChatMsg) : m)));
    }, []);

    // ===== 消息流自动滚到底 =====
    useEffect(() => {
        const el = streamRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [msgs, pending.length]);

    // ===== 连接状态 → 状态栏 + 系统气泡（只在状态真正变化时提示）=====
    const prevConnRef = useRef<ConnState['state'] | null>(null);
    const onConn = useCallback(
        (s: ConnState) => {
            setConn(s);
            const prev = prevConnRef.current;
            if (prev !== s.state) {
                prevConnRef.current = s.state;
                if (s.state === 'online') pushMsg({ kind: 'sys', id: uid(), text: '已连接，可以收发', tone: 'info' });
                else if (s.state === 'error')
                    pushMsg({ kind: 'sys', id: uid(), text: s.msg || '连接失败', tone: 'error' });
                else pushMsg({ kind: 'sys', id: uid(), text: '连接已断开，正在重连…', tone: 'info' });
            }
        },
        [pushMsg]
    );

    // ===== 收到的内容（电脑 → 手机）=====
    const onItem = useCallback(
        (item: RecvItem) => {
            if (item.type === 'image' && item.data) {
                const img: RecvImage = {
                    id: uid(),
                    url: 'data:' + (item.mime || 'image/jpeg') + ';base64,' + item.data,
                    mime: item.mime || 'image/jpeg',
                    name: item.name,
                };
                setMsgs((prev) => {
                    const last = prev[prev.length - 1];
                    let next: ChatMsg[];
                    // 短窗内连续到达的图片并进同一个九宫格气泡（电脑端连发多图）
                    if (last && last.kind === 'img-in' && Date.now() - last.ts < IMG_GROUP_WINDOW) {
                        next = prev.slice(0, -1).concat({ ...last, imgs: last.imgs.concat(img) });
                    } else {
                        next = prev.concat({ kind: 'img-in', id: uid(), ts: Date.now(), imgs: [img] });
                    }
                    // 超上限丢最旧的**收件**图片（从最早的 img-in 气泡开始整组丢弃）
                    let count = 0;
                    for (const m of next) if (m.kind === 'img-in') count += m.imgs.length;
                    while (count > MAX_RECV) {
                        const i = next.findIndex((m) => m.kind === 'img-in');
                        if (i < 0) break;
                        count -= (next[i] as Extract<ChatMsg, { kind: 'img-in' }>).imgs.length;
                        next = next.filter((_, idx) => idx !== i);
                    }
                    return next;
                });
            } else if (item.type === 'text') {
                pushMsg({ kind: 'text-in', id: uid(), text: item.text || '' });
            }
        },
        [pushMsg]
    );

    // 心跳 + 长轮询：挂载时启动，卸载时停止（StrictMode 下会 mount→unmount→mount，靠 cleanup 保证不重复）
    useEffect(() => {
        if (!deviceId) {
            onConn({ state: 'error', msg: '链接无效：未识别到设备ID，请重新生成二维码' });
            return;
        }
        return startPhoneRelay({ deviceId, phoneId, onConn, onItem });
    }, [deviceId, phoneId, onConn, onItem]);

    // ===== 选图（多选）→ 逐张压缩 → 进待发条 =====
    const onPick = async (files: FileList | null) => {
        const list = Array.from(files || []);
        if (!list.length) return;
        setPreparing(true);
        try {
            for (const f of list) {
                const prepared = await prepareImage(f);
                const url = URL.createObjectURL(prepared.blob);
                setPending((prev) => [
                    ...prev,
                    { id: uid(), blob: prepared.blob, name: prepared.name, mime: prepared.mime, url },
                ]);
            }
        } finally {
            setPreparing(false);
        }
    };

    /** 手动从待发条删除：回收 objectURL */
    const removePending = (id: string) => {
        setPending((prev) => {
            const hit = prev.find((p) => p.id === id);
            if (hit) URL.revokeObjectURL(hit.url);
            return prev.filter((p) => p.id !== id);
        });
    };

    // ===== 发送图片（逐张顺序发送保证到达顺序；失败即停，气泡上留失败原因，待发条里剩的还能重发）=====
    const confirmSend = async () => {
        if (!pending.length || sending) return;
        setSending(true);
        const list = pending.slice();
        const total = list.length;
        const bubbleId = uid();
        pushMsg({ kind: 'img-out', id: bubbleId, urls: list.map((p) => p.url), total, done: 0, state: 'sending' });

        for (let i = 0; i < list.length; i++) {
            const it = list[i];
            let b64 = '';
            try {
                b64 = await blobToBase64(it.blob);
            } catch (e: any) {
                patchMsg(bubbleId, { state: 'failed', note: e && e.message ? e.message : '读取图片失败' });
                pushMsg({ kind: 'sys', id: uid(), text: '图片发送失败，可重新点「发送」重试剩余', tone: 'error' });
                setSending(false);
                return;
            }
            const res = await postItem({ name: it.name, mime: it.mime, data: b64 });
            if (res && res.ok) {
                // 出栈已发送的；⚠️ 不回收 objectURL——气泡缩略图还在引用它
                setPending((prev) => prev.filter((p) => p.id !== it.id));
                patchMsg(bubbleId, { done: i + 1 });
            } else {
                patchMsg(bubbleId, {
                    state: 'failed',
                    note: '第 ' + (i + 1) + ' 张失败：' + ((res && res.error) || '未知错误'),
                });
                pushMsg({ kind: 'sys', id: uid(), text: '图片发送失败，可重新点「发送」重试剩余', tone: 'error' });
                setSending(false);
                return;
            }
        }

        patchMsg(bubbleId, { state: 'sent' });
        pushMsg({ kind: 'sys', id: uid(), text: total + ' 张已全部发送到电脑', tone: 'info' });
        setSending(false);
    };

    // ===== 发送文本 =====
    const confirmSendText = async () => {
        const t = (text || '').trim();
        if (!t || sendTextBusy) return;
        setSendTextBusy(true);
        const bubbleId = uid();
        pushMsg({ kind: 'text-out', id: bubbleId, text: t, state: 'sending' });
        setText('');
        const res = await postItem({ text: t });
        setSendTextBusy(false);
        if (res && res.ok) {
            patchMsg(bubbleId, { state: 'sent' });
            pushMsg({ kind: 'sys', id: uid(), text: '文本已发送到电脑，请在电脑端点击「复制到剪贴板」', tone: 'info' });
        } else {
            patchMsg(bubbleId, { state: 'failed', note: (res && res.error) || '未知错误' });
        }
    };

    // ===== 收件图片：复制 / 下载 =====
    const copyRecvImage = async (img: RecvImage) => {
        try {
            const blob = await (await fetch(img.url)).blob();
            const CI: any = (window as any).ClipboardItem;
            if (!navigator.clipboard || !CI) throw new Error('当前浏览器不支持图片剪贴板');
            // Chromium 对 image/png 支持最可靠：非 PNG 先转 PNG 再写（且只写一次，避免消耗手势）
            let out = blob;
            if (blob.type !== 'image/png') {
                const bmp = await createImageBitmap(blob);
                const cv = document.createElement('canvas');
                cv.width = bmp.width;
                cv.height = bmp.height;
                cv.getContext('2d')!.drawImage(bmp, 0, 0);
                bmp.close();
                out = await new Promise<Blob>((r) => cv.toBlob((b) => r(b || blob), 'image/png'));
            }
            await navigator.clipboard.write([new CI({ 'image/png': out })]);
            message.success('已复制到剪贴板');
        } catch (e: any) {
            message.error('复制失败：' + ((e && e.message) || '未知错误') + '，可长按图片保存');
        }
    };

    const downloadRecvImage = async (img: RecvImage) => {
        try {
            const blob = await (await fetch(img.url)).blob();
            let ext = (img.mime && img.mime.split('/')[1]) || 'jpg';
            ext = (ext.split('+')[0] || ext).replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = img.name || 'znhd-image.' + ext;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
            message.success('已开始下载');
        } catch (e: any) {
            message.error('保存失败：' + ((e && e.message) || '未知错误'));
        }
    };

    /**
     * 打印能力来自 react-to-print（与脚本端同一个库、同一套 A4 版式）。
     * `ignoreGlobalStyles: true`：没必要把整页 <style> 抄进打印 iframe，也会拖慢。
     */
    const printTitleRef = useRef('image');
    const doPrint = useReactToPrint({
        ignoreGlobalStyles: true,
        documentTitle: () => printTitleRef.current,
        pageStyle: PRINT_PAGE_STYLE,
    });

    /** 打印指定图片的原图，自适应 A4（横图自动旋转 90° 铺满，与脚本端行为一致；不裁切、不跨页） */
    const printRecvImage = (img: RecvImage) => {
        const fname = img.name || 'image.jpg';
        printTitleRef.current = fname;
        // 先探测图片自然尺寸，横图旋转 90° 铺满纵向 A4
        const probe = document.createElement('img');
        probe.onload = () =>
            doPrint(() =>
                buildA4ImageNode(img.url, fname, {
                    width: probe.naturalWidth,
                    height: probe.naturalHeight,
                })
            );
        probe.onerror = () => doPrint(() => buildA4ImageNode(img.url, fname));
        probe.src = img.url;
    };

    const copyRecvText = async (t: string) => {
        try {
            await navigator.clipboard.writeText(t);
            message.success('已复制文本');
        } catch {
            message.warning('复制失败，请长按文本手动复制');
        }
    };

    // ===== 渲染：一条消息 =====
    const renderMsg = (m: ChatMsg) => {
        if (m.kind === 'sys') {
            return (
                <div key={m.id} className={'znhd-sys' + (m.tone === 'error' ? ' znhd-sys-err' : '')}>
                    {m.text}
                </div>
            );
        }

        if (m.kind === 'text-in') {
            return (
                <div key={m.id} className="znhd-row znhd-row-in">
                    <div className="znhd-bubble znhd-bubble-in">
                        <div className="znhd-msg-text">{m.text}</div>
                    </div>
                    <button
                        type="button"
                        className="znhd-mini-btn"
                        title="复制文本"
                        aria-label="复制"
                        onClick={() => void copyRecvText(m.text)}>
                        <CopyOutlined />
                    </button>
                </div>
            );
        }

        if (m.kind === 'img-in') {
            const many = m.imgs.length > 1;
            return (
                <div key={m.id} className="znhd-row znhd-row-in">
                    <div className="znhd-bubble znhd-bubble-in znhd-bubble-img">
                        <Image.PreviewGroup
                            items={m.imgs.map((i) => ({ src: i.url }))}
                            preview={{
                                /**
                                 * 三个通用件全部走**与脚本端同一份**共享实现：
                                 *  · getPreviewHost：预览是 fixed 浮层，统一挂载点；
                                 *  · onOpenChange + syncPreviewMask：预览期间压掉下层遮罩，避免两层半透明叠出发暗；
                                 *  · actionsRender + appendPreviewActions：把「打印」按钮追加进 antd 的工具栏胶囊。
                                 */
                                getContainer: getPreviewHost,
                                onOpenChange: (o: boolean) => syncPreviewMask(o),
                                actionsRender: (originalNode, info) => {
                                    const at = typeof info.current === 'number' ? info.current : 0;
                                    const img = m.imgs[at];
                                    const printBtn = (
                                        <button
                                            key="znhd-print"
                                            type="button"
                                            className="ant-image-preview-actions-action"
                                            aria-label="print"
                                            title="打印原图"
                                            onClick={() => {
                                                if (img) printRecvImage(img);
                                            }}>
                                            <PrinterOutlined />
                                        </button>
                                    );
                                    return appendPreviewActions(originalNode, printBtn);
                                },
                            }}>
                            <div className={many ? 'znhd-img-grid' : ''}>
                                {m.imgs.map((img) => (
                                    <Image key={img.id} src={img.url} alt={img.name || 'image'} className="znhd-img" />
                                ))}
                            </div>
                        </Image.PreviewGroup>
                        {many && <div className="znhd-img-count">{m.imgs.length} 张图片 · 单击放大</div>}
                    </div>
                    <div className="znhd-mini-col">
                        <button
                            type="button"
                            className="znhd-mini-btn"
                            title="复制"
                            aria-label="复制"
                            onClick={() => void copyRecvImage(m.imgs[0])}>
                            <CopyOutlined />
                        </button>
                        <button
                            type="button"
                            className="znhd-mini-btn"
                            title="下载"
                            aria-label="下载"
                            onClick={() => void downloadRecvImage(m.imgs[0])}>
                            <DownloadOutlined />
                        </button>
                    </div>
                </div>
            );
        }

        if (m.kind === 'text-out') {
            return (
                <div key={m.id} className="znhd-row znhd-row-out">
                    <div
                        className={
                            'znhd-bubble znhd-bubble-out' + (m.state === 'failed' ? ' znhd-bubble-failed' : '')
                        }>
                        <div className="znhd-msg-text">{m.text}</div>
                        {m.state === 'sending' && <div className="znhd-note">发送中…</div>}
                        {m.state === 'failed' && <div className="znhd-note znhd-note-err">发送失败：{m.note}</div>}
                    </div>
                </div>
            );
        }

        // img-out：发出的图片组（纯展示缩略图，进度在气泡底部一行）
        const many = m.urls.length > 1;
        return (
            <div key={m.id} className="znhd-row znhd-row-out">
                <div
                    className={
                        'znhd-bubble znhd-bubble-out znhd-bubble-img' +
                        (m.state === 'failed' ? ' znhd-bubble-failed' : '')
                    }>
                    <div className={many ? 'znhd-img-grid' : ''}>
                        {m.urls.map((u, i) => (
                            <img key={i} src={u} alt="已发送图片" className="znhd-img znhd-img-plain" />
                        ))}
                    </div>
                    <div className="znhd-note">
                        {m.state === 'sending' && '发送中… ' + m.done + '/' + m.total}
                        {m.state === 'sent' && '已送达电脑 ✓'}
                        {m.state === 'failed' && <span className="znhd-note-err">失败：{m.note}</span>}
                    </div>
                </div>
            </div>
        );
    };

    const statusText = () => {
        if (conn.state === 'online') return '已连接';
        if (conn.state === 'error') return conn.msg || '连接失败';
        return '连接中…';
    };

    const pendingKb = Math.round(pending.reduce((s, p) => s + p.blob.size, 0) / 1024);

    return (
        <div className="znhd-page">
            {/* 顶部状态栏 */}
            <header className="znhd-topbar">
                <div className="znhd-top-status">
                    <span
                        className={
                            'znhd-dot' +
                            (conn.state === 'online' ? ' znhd-dot-on' : conn.state === 'error' ? ' znhd-dot-err' : '')
                        }
                    />
                    <span className="znhd-top-text" title={statusText()}>
                        {statusText()}
                    </span>
                </div>
                <div className="znhd-top-right">
                    <Tag color="green" variant="filled" style={{ marginInlineEnd: 0 }}>
                        v{__APP_VERSION__}
                    </Tag>
                    <Popover
                        placement="bottomRight"
                        title="设备信息"
                        content={
                            <div style={{ fontSize: 12, maxWidth: 320, wordBreak: 'break-all' }}>
                                <div>本机（手机）ID：{phoneId}</div>
                                <div style={{ marginTop: 4 }}>
                                    脚本端设备 ID：{deviceId || '未识别，请重新生成二维码'}
                                </div>
                            </div>
                        }>
                        <button type="button" className="znhd-mini-btn" aria-label="设备信息" title="设备信息">
                            <InfoCircleOutlined />
                        </button>
                    </Popover>
                </div>
            </header>

            {/* 消息流 */}
            <div className="znhd-stream" ref={streamRef}>
                {msgs.length === 0 ? (
                    <div className="znhd-empty">
                        连接成功后，电脑发来的图片和文本会出现在这里；选图或输入文字即可发到电脑。
                    </div>
                ) : (
                    msgs.map(renderMsg)
                )}
            </div>

            {/* 待发条（方案 A：选图先进这里，点「发送」才入流） */}
            {pending.length > 0 && (
                <div className="znhd-pending">
                    <div className="znhd-pending-strip">
                        {pending.map((p) => (
                            <div key={p.id} className="znhd-pending-thumb">
                                <img src={p.url} alt={p.name} />
                                <button
                                    type="button"
                                    className="znhd-pending-del"
                                    aria-label="移除"
                                    disabled={sending}
                                    onClick={() => removePending(p.id)}>
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="znhd-pending-bar">
                        <span className="znhd-pending-info">
                            已选 {pending.length} 张 · 约 {pendingKb} KB
                        </span>
                        <Button
                            size="small"
                            color="primary"
                            variant="solid"
                            loading={sending}
                            disabled={sending || preparing}
                            onClick={() => void confirmSend()}>
                            {pending.length > 1 ? '发送 ' + pending.length + ' 张图片' : '发送图片'}
                        </Button>
                    </div>
                </div>
            )}

            {/* 底部输入栏 */}
            <div className="znhd-inputbar">
                <button
                    type="button"
                    className="znhd-mini-btn znhd-pick-btn"
                    aria-label="选择图片"
                    title="选择图片 / 拍照"
                    disabled={preparing}
                    onClick={() => fileRef.current?.click()}>
                    <PictureOutlined />
                </button>
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
                <Input.TextArea
                    className="znhd-input"
                    autoSize={{ minRows: 1, maxRows: 4 }}
                    value={text}
                    placeholder={conn.state === 'online' ? '输入要发到电脑的文字…' : '未连接也可以先编辑，连接成功后即可发送'}
                    onChange={(e) => setText(e.target.value)}
                    onPressEnter={(e) => {
                        if (!e.shiftKey) {
                            e.preventDefault();
                            void confirmSendText();
                        }
                    }}
                />
                <Button
                    type="primary"
                    className="znhd-send-btn"
                    aria-label="发送"
                    title="发送文本"
                    loading={sendTextBusy}
                    disabled={sendTextBusy || !text.trim()}
                    onClick={() => void confirmSendText()}>
                    <SendOutlined />
                </Button>
            </div>
        </div>
    );
}
