import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App as AntApp, Badge, Button, Card, Col, Empty, Image, Input, Modal, Progress, Row, Space, Tag, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
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

const { Title, Text, Paragraph } = Typography;

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

export default function App() {
    const { message } = AntApp.useApp();
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
    const [recvText, setRecvText] = useState<{ id: string; text: string } | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

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
                setRecvImages((prev) => {
                    const next = prev.concat(img);
                    return next.length > MAX_RECV ? next.slice(next.length - MAX_RECV) : next;
                });
                setGalleryOpen(true);
                message.success('收到电脑发来的图片');
            } else if (item.type === 'text') {
                // 同屏只留最新一条：新文本替换旧弹窗（旧实现会叠加多个全屏遮罩）
                setRecvText({ id: uid(), text: item.text || '' });
                message.success('收到电脑发来的文本');
            }
        },
        [message]
    );

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
            message.success('已加入待发送列表');
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
                removePending(it.id);
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
            message.success('已复制到剪贴板');
        } catch (e: any) {
            message.error('复制失败：' + ((e && e.message) || '未知错误') + '，可长按图片保存');
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
            message.success('已开始下载');
        } catch (e: any) {
            message.error('保存失败：' + ((e && e.message) || '未知错误'));
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

    /** 打印「当前预览的那张图」的原图，自适应 A4（横图自动旋转 90° 铺满，与脚本端行为一致；不裁切、不跨页） */
    const printRecvImage = (img: RecvImage) => {
        const fname = img.name || 'image.jpg';
        printTitleRef.current = fname;
        // v26.10.10-v2：先探测图片自然尺寸，横图旋转 90° 铺满纵向 A4
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

    const copyRecvText = async () => {
        const t = recvText ? recvText.text : '';
        try {
            await navigator.clipboard.writeText(t);
            message.success('已复制文本');
        } catch {
            message.warning('复制失败，请长按文本手动复制');
        }
    };

    const connBadge = () => {
        if (conn.state === 'online') return <Badge status="success" text="已连接，可接收电脑发送" />;
        if (conn.state === 'error') return <Badge status="error" text={conn.msg || '连接失败'} />;
        return <Badge status="default" text="未连接（电脑端将提示无法发送）" />;
    };

    const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

    return (
        <div className="znhd-page">
            <header style={{ marginBottom: 16 }}>
                <Space align="center" wrap>
                    <Title level={4} style={{ margin: 0 }}>
                        📷 上传到电脑
                    </Title>
                    <Tag color="green" variant="filled">
                        v{__APP_VERSION__}
                    </Tag>
                </Space>
                <Paragraph type="secondary" style={{ margin: '8px 0 4px', fontSize: 13 }}>
                    选择/拍摄图片自动压缩后发送，或直接输入文本发送到电脑剪贴板。
                </Paragraph>
                <div style={{ fontSize: 12 }}>{connBadge()}</div>
                <Text type="secondary" style={{ fontSize: 11, wordBreak: 'break-all' }}>
                    本机（手机）ID：{phoneId}
                    <br />
                    已连接的脚本端设备ID：{deviceId || '未识别，请重新生成二维码'}
                </Text>
            </header>

            <Row gutter={[16, 16]} align="top">
                {/* 左：发送图片 */}
                <Col xs={24} md={12}>
                    <Card title="发送图片到电脑" size="small">
                        <Button
                            block
                            size="large"
                            color="primary"
                            variant="solid"
                            loading={preparing}
                            onClick={() => fileRef.current?.click()}
                        >
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
                                <div className="znhd-preview-grid" style={{ marginTop: 12 }}>
                                    {pending.map((p) => (
                                        <div key={p.id} className="znhd-thumb">
                                            <img src={p.url} alt={p.name} className="znhd-thumb-img" />
                                            <Button
                                                size="small"
                                                danger
                                                className="znhd-thumb-del"
                                                disabled={sending}
                                                onClick={() => removePending(p.id)}
                                            >
                                                ×
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                    已选 {pending.length} 张，共约{' '}
                                    {pending.reduce((s, p) => s + p.blob.size, 0) / 1024 > 0
                                        ? Math.round(pending.reduce((s, p) => s + p.blob.size, 0) / 1024)
                                        : 0}{' '}
                                    KB
                                </Text>
                            </>
                        )}

                        {progress && (
                            <div style={{ marginTop: 12 }}>
                                <Progress
                                    percent={percent}
                                    size="small"
                                    strokeColor={progress.failed ? '#e4393c' : '#007e44'}
                                    railColor="#eeeeee"
                                    status={progress.failed ? 'exception' : 'normal'}
                                />
                                <Text
                                    type={progress.failed ? 'danger' : undefined}
                                    style={{ fontSize: 12, display: 'block', textAlign: 'center' }}
                                >
                                    {progress.text}
                                </Text>
                            </div>
                        )}

                        <Button
                            block
                            size="large"
                            color="primary"
                            variant="solid"
                            style={{ marginTop: 12 }}
                            disabled={pending.length === 0 || sending || preparing}
                            loading={sending}
                            onClick={() => void confirmSend()}
                        >
                            {pending.length > 1 ? '发送 ' + pending.length + ' 张图片到电脑' : '发送图片到电脑'}
                        </Button>
                        {/* 图片流程的提示**必须留在图片卡片里**（v26.10.08-v13 修）：原先共用 status 且只渲染在文本卡片，
                            于是图片发完的「x 张已全部发送到电脑」出现在「发送文本到电脑」下面 */}
                        {imgStatus && (
                            <Paragraph
                                type={imgStatus.ok ? 'success' : 'danger'}
                                style={{ marginTop: 12, marginBottom: 0, fontSize: 13, textAlign: 'center' }}
                            >
                                {imgStatus.msg}
                            </Paragraph>
                        )}
                        {recvImages.length > 0 && (
                            <Button block size="large" style={{ marginTop: 8 }} onClick={() => setGalleryOpen(true)}>
                                🖼 查看收到的图片（{recvImages.length}）
                            </Button>
                        )}
                    </Card>
                </Col>

                {/* 右：发送文本 + 说明 */}
                <Col xs={24} md={12}>
                    <Card title="发送文本到电脑" size="small" style={{ marginBottom: 16 }}>
                        <Input.TextArea
                            rows={4}
                            value={text}
                            placeholder="输入要发送到电脑的文本…"
                            onChange={(e) => setText(e.target.value)}
                        />
                        <Button
                            block
                            size="large"
                            color="primary"
                            variant="solid"
                            style={{ marginTop: 12 }}
                            loading={sendTextBusy}
                            disabled={sendTextBusy}
                            onClick={() => void confirmSendText()}
                        >
                            发送文本到电脑
                        </Button>
                        {textStatus && (
                            <Paragraph
                                type={textStatus.ok ? 'success' : 'danger'}
                                style={{ marginTop: 12, marginBottom: 0, fontSize: 13, textAlign: 'center' }}
                            >
                                {textStatus.msg}
                            </Paragraph>
                        )}
                    </Card>
                </Col>
            </Row>

            {/* 收到的图片：画廊 + antd Image 预览（多图左右切换、放大、旋转由 antd 接管，不再依赖 Viewer.js） */}
            <Modal
                open={galleryOpen}
                title={'收到的图片（' + recvImages.length + '）· 单击放大'}
                onCancel={() => setGalleryOpen(false)}
                footer={[
                    <Button
                        key="clear"
                        danger
                        onClick={() => {
                            setRecvImages([]);
                            setGalleryOpen(false);
                        }}
                    >
                        清空全部
                    </Button>,
                    <Button key="close" color="primary" variant="solid" onClick={() => setGalleryOpen(false)}>
                        关闭
                    </Button>,
                ]}
                width={620}
                destroyOnHidden
            >
                {recvImages.length === 0 ? (
                    <Empty description="暂无图片" />
                ) : (
                    <Image.PreviewGroup
                        items={recvImages.map((i) => ({ src: i.url }))}
                        preview={{
                            /**
                             * 三个通用件全部走**与脚本端同一份**共享实现（v26.10.08-v13 起）：
                             *  · getPreviewHost：预览是 fixed 浮层，挂到 body 会被宿主页 transform 困住；
                             *  · onOpenChange + syncPreviewMask：预览期间压掉下层弹窗/抽屉遮罩，
                             *    否则两层 rgba(0,0,0,0.45) 叠成 0.6975、画面明显发暗（脚本端踩过）；
                             *  · actionsRender + appendPreviewActions：把「打印」按钮追加进 antd 的工具栏胶囊。
                             */
                            getContainer: getPreviewHost,
                            onOpenChange: (o: boolean) => syncPreviewMask(o),
                            actionsRender: (originalNode, info) => {
                                const at = typeof info.current === 'number' ? info.current : 0;
                                const printBtn = (
                                    <button
                                        key="znhd-print"
                                        type="button"
                                        className="ant-image-preview-actions-action"
                                        aria-label="print"
                                        title="打印原图"
                                        onClick={() => {
                                            const img = recvImages[at];
                                            if (img) printRecvImage(img);
                                        }}>
                                        <PrinterOutlined />
                                    </button>
                                );
                                return appendPreviewActions(originalNode, printBtn);
                            },
                        }}>
                        <div className="znhd-recv-grid">
                            {recvImages.map((img) => (
                                <div key={img.id} className="znhd-recv-cell">
                                    <Image src={img.url} alt={img.name || 'image'} className="znhd-recv-img" />
                                    <Space size={4} orientation="horizontal" style={{ marginTop: 4, width: '100%' }}>
                                        <Button size="small" block onClick={() => void copyRecvImage(img)}>
                                            复制
                                        </Button>
                                        <Button size="small" block onClick={() => void downloadRecvImage(img)}>
                                            下载
                                        </Button>
                                        <Button
                                            size="small"
                                            danger
                                            onClick={() => setRecvImages((prev) => prev.filter((p) => p.id !== img.id))}
                                        >
                                            ×
                                        </Button>
                                    </Space>
                                </div>
                            ))}
                        </div>
                    </Image.PreviewGroup>
                )}
            </Modal>

            {/* 收到的文本：独立弹窗，同屏只留最新一条 */}
            <Modal
                open={!!recvText}
                title="收到电脑发来的文本"
                onCancel={() => setRecvText(null)}
                footer={[
                    <Button key="copy" color="primary" variant="solid" onClick={() => void copyRecvText()}>
                        复制文本
                    </Button>,
                    <Button key="close" onClick={() => setRecvText(null)}>
                        关闭
                    </Button>,
                ]}
                width={520}
                destroyOnHidden
            >
                <pre className="znhd-recv-text">{recvText ? recvText.text : ''}</pre>
            </Modal>
        </div>
    );
}
