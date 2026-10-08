import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Progress, Tag, Textarea } from '../../shared/ui/controls';
import { Tooltip } from '../../shared/ui/feedback';
import { Modal } from '../../shared/ui/OverlayModal';
import { ImagePreview, PRINT_ICON, type PreviewItem } from '../../shared/ui/ImagePreview';
import { cn } from '../../shared/ui/cn';
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
// 打印版式与脚本端**共用同一份**（见仓库根 shared/）；
// ⚠️ 「预览期间压掉下层遮罩」由 shared/ui/ImagePreview 内部调用 syncPreviewMask 自动处理，
//    这里不需要也不应该再手动调一次（重复调虽幂等，但会让人误以为必须手动接）。
import { buildA4ImageNode, PRINT_PAGE_STYLE } from '../../shared/preview/print';

/** 收件画廊上限：与脚本端 MAX_GALLERY=27 对齐，超出丢最旧（收件项是 base64 大字符串，无上限会持续吃内存） */
const MAX_RECV = 27;

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

/** 连发多图的进度状态 */
interface ProgressState {
    done: number;
    total: number;
    busy: boolean;
    failed: boolean;
    text: string;
}

let seq = 0;
const uid = () => 'z' + ++seq + '-' + Date.now().toString(36);

/**
 * 卡片容器（替换前是 antd Card；标题行 + 内容）。
 *
 * ⚠️ `data-znhd-card` 是冒烟断言的稳定钩子（scripts/smoke/phone-page.js 靠它定位卡片、
 *    再断言「发送提示落在哪张卡片里」）。Tailwind 工具类不进 DOM 属性、当契约太脆，故用它。
 */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section data-znhd-card="" data-znhd-card-title={title} className="rounded-lg border border-ink-6 bg-white">
            <h2 className="border-b border-ink-6 px-3.5 py-2.5 text-sm font-semibold leading-6 text-ink-1">{title}</h2>
            <div className="px-3.5 py-3">{children}</div>
        </section>
    );
}

/** 状态提示条（成功绿 / 失败红），两处流程各回各的卡片（见 imgStatus / textStatus 的注释） */
function StatusLine({ ok, msg }: { ok: boolean; msg: string }) {
    return (
        <p className={cn('mt-3 mb-0 text-center text-[13px]', ok ? 'text-success-700' : 'text-danger-600')}>{msg}</p>
    );
}

export default function App() {
    const deviceId = useMemo(() => parseDeviceId(window.location.pathname), []);
    // 本机（手机）设备 ID：持久化在 localStorage，用于让电脑端区分「哪台手机在线」
    const phoneId = useMemo(() => getPhoneId(), []);

    const [conn, setConn] = useState<ConnState>({ state: 'offline' });
    const [pending, setPending] = useState<PendingImage[]>([]);
    const [preparing, setPreparing] = useState(false);
    const [sending, setSending] = useState(false);
    const [progress, setProgress] = useState<ProgressState | null>(null);
    const [text, setText] = useState('');
    const [sendTextBusy, setSendTextBusy] = useState(false);
    /**
     * 两条流程各用各的提示（v26.10.08-v13 修）。
     *
     * ⚠️ 原先共用一个 `status` 且只渲染在「发送文本到电脑」卡片里，导致**图片**发完后那句
     * 「✅ x 张已全部发送到电脑，请在电脑端接收」跑到了**文本**卡片下面（用户反馈）。
     * 拆成两个 state，各回各的卡片。
     */
    const [imgStatus, setImgStatus] = useState<{ ok: boolean; msg: string } | null>(null);
    const [textStatus, setTextStatus] = useState<{ ok: boolean; msg: string } | null>(null);
    const [recvImages, setRecvImages] = useState<RecvImage[]>([]);
    const [galleryOpen, setGalleryOpen] = useState(false);
    /** 当前预览项下标；-1 表示未打开 */
    const [previewIdx, setPreviewIdx] = useState(-1);
    const [recvText, setRecvText] = useState<{ id: string; text: string } | null>(null);
    /** 「复制文本」的结果反馈（替换前走 antd message；现挂在弹窗内，避免与发送流程的状态混在一起） */
    const [copyTextState, setCopyTextState] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    // ===== 收到的内容（电脑 → 手机）=====
    const onItem = useCallback((item: RecvItem) => {
        if (item.type === 'image' && item.data) {
            const img: RecvImage = {
                id: uid(),
                url: 'data:' + (item.mime || 'image/jpeg') + ';base64,' + item.data,
                mime: item.mime || 'image/jpeg',
                name: item.name,
            };
            setRecvImages((prev) => {
                const next = prev.concat(img);
                return next.length > MAX_RECV ? next.slice(next.length - MAX_RECV) : next;
            });
            setGalleryOpen(true);
        } else if (item.type === 'text') {
            // 同屏只留最新一条：新文本替换旧弹窗（旧实现会叠加多个全屏遮罩）
            setRecvText({ id: uid(), text: item.text || '' });
        }
    }, []);

    // 心跳 + 长轮询：挂载时启动，卸载时停止（StrictMode 下会 mount→unmount→mount，靠 cleanup 保证不重复）
    useEffect(() => {
        if (!deviceId) {
            setConn({ state: 'error', msg: '链接无效：未识别到设备ID，请重新生成二维码' });
            return;
        }
        return startPhoneRelay({ deviceId, phoneId, onConn: setConn, onItem });
    }, [deviceId, phoneId, onItem]);

    // ===== 选图（多选）→ 逐张压缩 → 进待发列表 =====
    const onPick = async (files: FileList | null) => {
        const list = Array.from(files || []);
        if (!list.length) return;
        setPreparing(true);
        setImgStatus(null);
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

    const removePending = (id: string) => {
        setPending((prev) => {
            const hit = prev.find((p) => p.id === id);
            if (hit) URL.revokeObjectURL(hit.url);
            return prev.filter((p) => p.id !== id);
        });
    };

    // ===== 发送（逐张顺序发送，保证到达顺序；失败即停，剩余可重试）=====
    const confirmSend = async () => {
        if (!pending.length) return;
        setSending(true);
        setImgStatus(null);
        const list = pending.slice();
        const total = list.length;
        let done = 0;
        setProgress({ done: 0, total, busy: true, failed: false, text: '发送中… 0/' + total });

        for (let i = 0; i < list.length; i++) {
            const it = list[i];
            setProgress({
                done,
                total,
                busy: true,
                failed: false,
                text: '发送中… ' + done + '/' + total + '（正在发送第 ' + (i + 1) + ' 张）',
            });
            let b64 = '';
            try {
                b64 = await blobToBase64(it.blob);
            } catch (e: any) {
                setImgStatus({ ok: false, msg: e && e.message ? e.message : '读取图片失败' });
                setProgress({ done, total, busy: false, failed: true, text: '❌ 已发送 ' + done + '/' + total + '，已停止' });
                setSending(false);
                return;
            }
            const res = await postItem({ name: it.name, mime: it.mime, data: b64 });
            if (res && res.ok) {
                done += 1;
                setPending((prev) => prev.filter((p) => p.id !== it.id)); // 立即从列表移除，避免重复发送
                setProgress({
                    done,
                    total,
                    busy: done < total,
                    failed: false,
                    text: done < total ? '已发送 ' + done + '/' + total : '✅ 已发送 ' + total + '/' + total + '，全部完成',
                });
            } else {
                setImgStatus({ ok: false, msg: '第 ' + (done + 1) + ' 张发送失败：' + ((res && res.error) || '未知错误') + '，可点按钮重试剩余' });
                setProgress({ done, total, busy: false, failed: true, text: '❌ 已发送 ' + done + '/' + total + '，已停止' });
                setSending(false);
                return;
            }
        }

        setImgStatus({ ok: true, msg: '✅ ' + total + ' 张已全部发送到电脑，请在电脑端接收' });
        setSending(false);
        // 完成后 2.5s 自动收起进度条
        window.setTimeout(() => setProgress(null), 2500);
    };

    // ===== 发送文本 =====
    const confirmSendText = async () => {
        const t = (text || '').trim();
        if (!t) {
            setTextStatus({ ok: false, msg: '请输入要发送的文本' });
            return;
        }
        setSendTextBusy(true);
        setTextStatus({ ok: false, msg: '发送中…' });
        const res = await postItem({ text: t });
        setSendTextBusy(false);
        if (res && res.ok) {
            setTextStatus({ ok: true, msg: '✅ 文本已发送到电脑，请在电脑端点击「复制到剪贴板」' });
            setText('');
        } else {
            setTextStatus({ ok: false, msg: '发送失败：' + ((res && res.error) || '未知错误') });
        }
    };

    // ===== 收件：复制 / 下载 / 移除 / 清空 =====
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
            setImgStatus({ ok: true, msg: '✅ 已复制到剪贴板' });
        } catch (e: any) {
            setImgStatus({ ok: false, msg: '复制失败：' + ((e && e.message) || '未知错误') + '，可长按图片保存' });
        }
    };

    const downloadRecvImage = async (img: RecvImage) => {
        try {
            const blob = await (await fetch(img.url)).blob();
            let ext = (img.mime && img.mime.split('/')[1]) || 'jpg';
            ext = ((ext.split('+')[0] || ext).replace(/[^a-zA-Z0-9]/g, '')) || 'jpg';
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = img.name || 'znhd-image.' + ext;
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } catch (e: any) {
            setImgStatus({ ok: false, msg: '保存失败：' + ((e && e.message) || '未知错误') });
        }
    };

    /**
     * 打印能力来自 react-to-print（与脚本端同一个库、同一套 A4 版式，v26.10.08-v13 起）。
     * 版式常量与「游离节点」的做法都在共享层 `shared/preview/print.ts`。
     * ⚠️ `ignoreGlobalStyles: true`：默认行为会把当前页面全部 <style>/<link> 抄进打印 iframe，
     *    没必要（打印内容只有一张图），也会拖慢。
     */
    const printTitleRef = useRef('image');
    const doPrint = useReactToPrint({
        ignoreGlobalStyles: true,
        documentTitle: () => printTitleRef.current,
        pageStyle: PRINT_PAGE_STYLE,
    });

    /** 打印「当前预览的那张图」的原图，自适应 A4（与脚本端行为一致：等比缩放居中、不裁切、不跨页） */
    const printRecvImage = (img: RecvImage) => {
        const fname = img.name || 'image.jpg';
        printTitleRef.current = fname;
        doPrint(() => buildA4ImageNode(img.url, fname));
    };

    const copyRecvText = async () => {
        const t = recvText ? recvText.text : '';
        try {
            await navigator.clipboard.writeText(t);
            setCopyTextState('✅ 已复制文本');
        } catch {
            // 失败要给明确反馈（复制在 iOS Safari / 非 HTTPS 下常被拒）
            setCopyTextState('复制失败，请长按文本手动复制');
        }
    };

    const connBadge = () => {
        if (conn.state === 'online')
            return (
                <span className="inline-flex items-center gap-1.5 text-xs text-success-700">
                    <span className="h-2 w-2 rounded-full bg-success-500" />
                    已连接，可接收电脑发送
                </span>
            );
        if (conn.state === 'error')
            return (
                <span className="inline-flex items-center gap-1.5 text-xs text-danger-600">
                    <span className="h-2 w-2 rounded-full bg-danger-500" />
                    {conn.msg || '连接失败'}
                </span>
            );
        return (
            <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
                <span className="h-2 w-2 rounded-full bg-ink-4" />
                未连接（电脑端将提示无法发送）
            </span>
        );
    };

    const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

    /** 预览的 items：按 recvImages 顺序 */
    const previewItems: PreviewItem[] = recvImages.map((i) => ({ url: i.url, name: i.name }));

    return (
        <div className="znhd-page">
            <header className="mb-4">
                <div className="flex flex-wrap items-center gap-2">
                    <h1 className="m-0 text-lg font-semibold leading-7 text-ink-1">📷 上传到电脑</h1>
                    <Tag color="blue">v{__APP_VERSION__}</Tag>
                </div>
                <p className="mb-1 mt-2 text-[13px] text-ink-3">
                    选择/拍摄图片自动压缩后发送，或直接输入文本发送到电脑剪贴板。
                </p>
                <div className="text-xs">{connBadge()}</div>
                <p className="mt-1 text-[11px] break-all text-ink-3">
                    本机（手机）ID：{phoneId}
                    <br />
                    已连接的脚本端设备ID：{deviceId || '未识别，请重新生成二维码'}
                </p>
            </header>

            {/* 手机单列；md 及以上放宽并变两列（替换前是 antd Row/Col，现用 CSS grid） */}
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                {/* 左：发送图片 */}
                <Card title="发送图片到电脑">
                    <Button
                        block
                        size="large"
                        variant="primary"
                        loading={preparing}
                        onClick={() => fileRef.current?.click()}>
                        点击选择图片 / 拍照（可多选）
                    </Button>
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

                    {pending.length > 0 && (
                        <>
                            {/* 待发送缩略图：手机 3 列、桌面 6 列 */}
                            <div className="mt-3 grid grid-cols-3 gap-2 md:grid-cols-6">
                                {pending.map((p) => (
                                    <div key={p.id} className="relative aspect-square overflow-hidden rounded-lg border border-[#eee] bg-white">
                                        <img src={p.url} alt={p.name} className="block h-full w-full object-cover" />
                                        <Button
                                            size="small"
                                            danger
                                            className="absolute right-0.5 top-0.5 min-w-[22px] rounded-full px-1.5 leading-5"
                                            disabled={sending}
                                            onClick={() => removePending(p.id)}>
                                            ×
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            <p className="mt-1.5 text-xs text-ink-3">
                                已选 {pending.length} 张，共约{' '}
                                {pending.reduce((s, p) => s + p.blob.size, 0) / 1024 > 0
                                    ? Math.round(pending.reduce((s, p) => s + p.blob.size, 0) / 1024)
                                    : 0}{' '}
                                KB
                            </p>
                        </>
                    )}

                    {progress && (
                        <div className="mt-3">
                            <Progress percent={percent} status={progress.failed ? 'exception' : 'normal'} />
                            <p className="mt-1 block text-center text-xs text-ink-3">{progress.text}</p>
                        </div>
                    )}

                    <Button
                        block
                        size="large"
                        variant="primary"
                        className="mt-3"
                        disabled={pending.length === 0 || sending || preparing}
                        loading={sending}
                        onClick={() => void confirmSend()}>
                        {pending.length > 1 ? '发送 ' + pending.length + ' 张图片到电脑' : '发送图片到电脑'}
                    </Button>
                    {/* 图片流程的提示**必须留在图片卡片里**（v26.10.08-v13 修）：原先共用 status 且只渲染在文本卡片，
                        于是图片发完的「x 张已全部发送到电脑」出现在「发送文本到电脑」下面 */}
                    {imgStatus && <StatusLine ok={imgStatus.ok} msg={imgStatus.msg} />}
                    {recvImages.length > 0 && (
                        <Button block size="large" className="mt-2" onClick={() => setGalleryOpen(true)}>
                            🖼 查看收到的图片（{recvImages.length}）
                        </Button>
                    )}
                </Card>

                {/* 右：发送文本 */}
                <Card title="发送文本到电脑">
                    <Textarea
                        rows={4}
                        value={text}
                        placeholder="输入要发送到电脑的文本…"
                        onChange={(e) => setText(e.target.value)}
                    />
                    <Button
                        block
                        size="large"
                        variant="primary"
                        className="mt-3"
                        loading={sendTextBusy}
                        disabled={sendTextBusy}
                        onClick={() => void confirmSendText()}>
                        发送文本到电脑
                    </Button>
                    {textStatus && <StatusLine ok={textStatus.ok} msg={textStatus.msg} />}
                </Card>
            </div>

            {/* 收到的图片：画廊 + 共享预览（多图左右切换、放大、旋转由 shared/ui/ImagePreview 提供） */}
            <Modal
                open={galleryOpen}
                title={'收到的图片（' + recvImages.length + '）· 单击放大'}
                width={620}
                showMask={previewIdx < 0}
                onClose={() => setGalleryOpen(false)}
                footer={
                    <>
                        <Button
                            danger
                            onClick={() => {
                                setRecvImages([]);
                                setGalleryOpen(false);
                            }}>
                            清空全部
                        </Button>
                        <Button variant="primary" onClick={() => setGalleryOpen(false)}>
                            关闭
                        </Button>
                    </>
                }>
                {recvImages.length === 0 ? (
                    <Empty description="暂无图片" />
                ) : (
                    /* 收到的图片九宫格 */
                    <div className="grid max-h-[62vh] grid-cols-3 content-start gap-2 overflow-auto">
                        {recvImages.map((img, idx) => (
                            <div key={img.id} className="flex flex-col">
                                <img
                                    src={img.url}
                                    alt={img.name || 'image'}
                                    className="w-full cursor-zoom-in rounded-lg bg-[#f2f2f2] object-cover"
                                    style={{ aspectRatio: '1 / 1' }}
                                    onClick={() => setPreviewIdx(idx)}
                                />
                                <div className="mt-1 flex w-full gap-1">
                                    <Button size="small" className="flex-1" onClick={() => void copyRecvImage(img)}>
                                        复制
                                    </Button>
                                    <Button size="small" className="flex-1" onClick={() => void downloadRecvImage(img)}>
                                        下载
                                    </Button>
                                    <Button
                                        size="small"
                                        danger
                                        onClick={() => setRecvImages((prev) => prev.filter((p) => p.id !== img.id))}>
                                        ×
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </Modal>

            {/* 图片放大预览：全屏浮层，层级高于上面的画廊弹窗 */}
            <ImagePreview
                index={previewIdx}
                items={previewItems}
                onIndexChange={setPreviewIdx}
                onClose={() => setPreviewIdx(-1)}
                caption={(_it, i, total) => `图片 ${i + 1} / ${total}`}
                extraActions={(_item, i) => {
                    const img = recvImages[i];
                    if (!img) return null;
                    return (
                        <Tooltip content="打印原图" side="top">
                            <button
                                type="button"
                                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white transition-colors hover:bg-white/20"
                                aria-label="print"
                                title="打印原图"
                                onClick={() => printRecvImage(img)}>
                                {PRINT_ICON}
                            </button>
                        </Tooltip>
                    );
                }}
            />

            {/* 收到的文本：独立弹窗，同屏只留最新一条 */}
            <Modal
                open={!!recvText}
                title="收到电脑发来的文本"
                width={520}
                onClose={() => {
                    setCopyTextState('');
                    setRecvText(null);
                }}
                footer={
                    <>
                        <Button
                            variant="primary"
                            onClick={() => {
                                setCopyTextState('复制中…');
                                void copyRecvText();
                            }}>
                            {copyTextState && copyTextState !== '复制中…' ? copyTextState : '复制文本'}
                        </Button>
                        <Button
                            onClick={() => {
                                setCopyTextState('');
                                setRecvText(null);
                            }}>
                            关闭
                        </Button>
                    </>
                }>
                {/* 收到的文本 */}
                <pre className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.6]">
                    {recvText ? recvText.text : ''}
                </pre>
            </Modal>
        </div>
    );
}