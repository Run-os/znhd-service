import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Image, Input, Popconfirm, Progress, Typography, theme } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useReactToPrint } from 'react-to-print';
import { addLog } from '@/lib/logger';
import { copyImageToClipboard } from '@/lib/relay';
import { downloadFileName } from '@/lib/gallery';
import { CheckIcon, CopyIcon, DownloadIcon, TrashIcon } from '@/lib/ui/icons';
import ImageOverlayActions from '@/lib/ui/ImageOverlayActions';
import DeviceIdTag from '@/lib/ui/transfer/DeviceIdTag';
import {
    PHONE_SESSION_KEY,
    PHONE_SESSION_LABEL,
    removeTransferMessage,
    sendImagesToSession,
    sendTextToSession,
    sessionSendable,
} from '@/lib/transfer/store';
import type { DeviceSession, PhoneInfo, TransferMessage } from '@/lib/transfer/types';
// 预览相关的通用件全部来自共享层（与手机上传页同一份，v26.10.08-v13 起）
import { appendPreviewActions } from '../../../../shared/preview/actions';
import { getPreviewHost } from '../../../../shared/preview/host';
import { syncPreviewMask } from '../../../../shared/preview/mask';
import { buildA4ImageNode, PRINT_PAGE_STYLE } from '../../../../shared/preview/print';

const { Text } = Typography;

/** 时间展示（HH:mm） */
function fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return p(d.getHours()) + ':' + p(d.getMinutes());
}

interface PendingImage {
    file: File;
    name: string;
    mime: string;
    url: string;
}

/**
 * 设备会话聊天区（v26.10.12-v1，传输助手第三栏的主体）。
 *
 * 由「设备互联」弹窗的「发送到手机」分区 + 原「历史记录」画廊合并而来：
 *   · 消息按会话聚合成聊天气泡（收到的在左灰底、本机发出的在右浅蓝底）；
 *   · 图片消息单击放大（antd Image.PreviewGroup + 共享层预览宿主 / A4 打印 / 遮罩压制）；
 *   · 右下角悬浮图标按钮（复制 / 下载 / 删除）与历史记录同一套实现；
 *   · 底部输入区发文本 / 选图发送，逐张压缩后按序投递（逻辑与原发送分区一致）。
 */
export default function TransferDeviceChat({
    session,
    phone,
    colorIndex,
    onClear,
}: {
    session: DeviceSession;
    phone?: PhoneInfo;
    colorIndex?: number;
    onClear: () => void;
}) {
    const { token } = theme.useToken();
    const [sendText, setSendText] = useState('');
    const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
    const [sending, setSending] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number; failed: boolean; text: string } | null>(
        null
    );
    /** 图片复制的反馈：记录是哪一条消息，避免所有图一起改文案 */
    const [imgCopy, setImgCopy] = useState<{ id: string; state: 'busy' | 'ok' | 'fail' } | null>(null);
    /**
     * 放大预览是否打开（用于撤掉下层遮罩，理由同 RecvHistoryModal：
     * 两层 rgba(0,0,0,0.45) 叠成 0.6975，白底被压到灰度 77）。
     */
    const [previewOpen, setPreviewOpen] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);

    const sendable = sessionSendable(session.key);
    const isAggregate = session.key === PHONE_SESSION_KEY;

    useEffect(() => {
        syncPreviewMask(previewOpen);
        return () => syncPreviewMask(false);
    }, [previewOpen]);

    // 新消息自动滚到底
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [session.messages]);

    /** 打印对话框上的文档标题（react-to-print 会在打印期间临时改写 document.title 再还原） */
    const printTitleRef = useRef('图片');

    const doPrint = useReactToPrint({
        ignoreGlobalStyles: true,
        documentTitle: () => printTitleRef.current,
        pageStyle: PRINT_PAGE_STYLE,
    });

    /** 打印某一条图片消息的原图，并自适应 A4 纸（横图自动旋转，逻辑同 RecvHistoryModal） */
    const printImage = (msg: TransferMessage, idx: number) => {
        const fname = downloadFileName(msg.name, msg.mime, idx);
        printTitleRef.current = fname;
        addLog('打印图片: ' + fname, 'success');
        const probe = document.createElement('img');
        probe.onload = () => {
            doPrint(() =>
                buildA4ImageNode(msg.previewUrl as string, fname, {
                    width: probe.naturalWidth,
                    height: probe.naturalHeight,
                })
            );
        };
        probe.onerror = () => doPrint(() => buildA4ImageNode(msg.previewUrl as string, fname));
        probe.src = msg.previewUrl as string;
    };

    const doCopy = (msg: TransferMessage) => {
        setImgCopy({ id: msg.id, state: 'busy' });
        copyImageToClipboard(msg.blob).then((ok: boolean) => {
            setImgCopy({ id: msg.id, state: ok ? 'ok' : 'fail' });
            if (ok) addLog('图片已复制到剪贴板: ' + (msg.name || ''), 'success');
            window.setTimeout(() => setImgCopy(null), 1500);
        });
    };

    const copyHint = (msg: TransferMessage): string => {
        if (!imgCopy || imgCopy.id !== msg.id) return '复制';
        if (imgCopy.state === 'busy') return '复制中…';
        return imgCopy.state === 'ok' ? '已复制' : '复制失败';
    };

    const doDownload = (msg: TransferMessage, idx: number) => {
        const fname = downloadFileName(msg.name, msg.mime, idx);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(msg.blob as Blob);
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        addLog('图片已下载: ' + fname, 'success');
    };

    const doSendText = () => {
        const t = sendText.trim();
        if (!t || !sendable) return;
        if (sendTextToSession(session.key, t)) setSendText('');
    };

    // 选图：仅加入待发列表，点「发送」才真正上传（与手机端一致，避免误选即发）
    const pickImages = () => {
        if (!sendable) {
            addLog('[传输助手] 当前无在线设备，无法发送', 'error', true);
            return;
        }
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.multiple = true;
        inp.style.display = 'none';
        document.body.appendChild(inp);
        // 取消选择（对话框关闭但未选文件）也要移除隐藏 input：'cancel' 非标准，
        // 用「对话框关闭后 window 恢复焦点」兜底清理，避免反复取消在 body 累积 input
        const cleanupFocus = () => {
            window.removeEventListener('focus', cleanupFocus);
            try {
                inp.remove();
            } catch (e) {
                /* 已移除 */
            }
        };
        inp.onchange = () => {
            const files = Array.prototype.slice.call(inp.files || []);
            window.removeEventListener('focus', cleanupFocus);
            inp.remove();
            if (!files.length) return;
            setPendingImages((prev) =>
                prev.concat(
                    files.map((f: File) => ({
                        file: f,
                        name: f.name || 'image.jpg',
                        mime: f.type || 'image/jpeg',
                        url: URL.createObjectURL(f),
                    }))
                )
            );
        };
        window.addEventListener('focus', cleanupFocus);
        inp.click();
    };

    const removePendingImage = (i: number) => {
        if (sending) return; // 发送中禁止移除：发送按快照进行，移除会导致界面与实际不一致
        setPendingImages((prev) => {
            const arr = prev.slice();
            const removed = arr.splice(i, 1)[0];
            if (removed) {
                try {
                    URL.revokeObjectURL(removed.url);
                } catch (e) {
                    /* 忽略 */
                }
            }
            return arr;
        });
    };

    const confirmSendImage = () => {
        if (!pendingImages.length || !sendable) return;
        setSending(true);
        const list = pendingImages.slice();
        const ok = sendImagesToSession(session.key, list, (done, total, failed, text) => {
            setProgress({ done, total, failed, text });
            if (done >= total || failed) {
                setSending(false);
                if (!failed) {
                    setPendingImages([]);
                    setProgress(null);
                }
            }
        });
        if (!ok) setSending(false);
    };

    // 图片消息（会话内按出现顺序）——预览左右切换由 antd 接管
    const imageMessages = useMemo(() => session.messages.filter((m) => m.type === 'image'), [session.messages]);
    const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

    const renderMessage = (msg: TransferMessage) => {
        const isUser = msg.direction === 'out';
        if (msg.type === 'image') {
            const idx = imageMessages.findIndex((m) => m.id === msg.id);
            return (
                <div
                    key={msg.id}
                    style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                    <div style={{ maxWidth: '62%' }}>
                        <ImageOverlayActions
                            actions={[
                                {
                                    label: '复制',
                                    tooltip: copyHint(msg),
                                    icon:
                                        imgCopy && imgCopy.id === msg.id && imgCopy.state === 'ok' ? (
                                            <CheckIcon size={13} />
                                        ) : (
                                            <CopyIcon size={13} />
                                        ),
                                    loading: !!(imgCopy && imgCopy.id === msg.id && imgCopy.state === 'busy'),
                                    onClick: () => doCopy(msg),
                                },
                                {
                                    label: '下载',
                                    icon: <DownloadIcon size={13} />,
                                    onClick: () => doDownload(msg, idx),
                                },
                                {
                                    label: '删除',
                                    danger: true,
                                    icon: <TrashIcon size={13} />,
                                    onClick: () => removeTransferMessage(session.key, msg.id),
                                },
                            ]}>
                            <Image
                                src={msg.previewUrl}
                                alt={msg.name || 'image'}
                                style={{
                                    width: '100%',
                                    maxWidth: 220,
                                    aspectRatio: '4 / 3',
                                    objectFit: 'cover',
                                    borderRadius: 8,
                                    // 发送中的图半透明 + 灰底，失败加红框
                                    opacity: msg.sendState === 'sending' ? 0.55 : 1,
                                    border:
                                        msg.sendState === 'failed'
                                            ? '1px solid ' + token.colorError
                                            : '1px solid ' + token.colorBorderSecondary,
                                    display: 'block',
                                }}
                            />
                        </ImageOverlayActions>
                        <div
                            style={{
                                fontSize: 11,
                                color: token.colorTextTertiary,
                                marginTop: 2,
                                textAlign: isUser ? 'right' : 'left',
                            }}>
                            {fmtTime(msg.ts)}
                            {msg.sendState === 'sending' ? ' · 发送中…' : ''}
                            {msg.sendState === 'failed' ? ' · 发送失败' : ''}
                            {msg.name ? ' · ' + msg.name : ''}
                        </div>
                    </div>
                </div>
            );
        }
        return (
            <div
                key={msg.id}
                style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                <div style={{ maxWidth: '70%' }}>
                    <div
                        style={{
                            padding: '8px 10px',
                            borderRadius: 8,
                            fontSize: 13,
                            lineHeight: 1.6,
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                            background: isUser ? token.colorPrimaryBg : token.colorFillQuaternary,
                            border: '1px solid ' + (isUser ? token.colorPrimaryBorder : token.colorBorderSecondary),
                            color: msg.sendState === 'failed' ? token.colorError : undefined,
                        }}>
                        {msg.text}
                        {msg.sendState === 'failed' && msg.sendError ? (
                            <div style={{ fontSize: 11, marginTop: 4 }}>{msg.sendError}</div>
                        ) : null}
                    </div>
                    <div
                        style={{
                            fontSize: 11,
                            color: token.colorTextTertiary,
                            marginTop: 2,
                            textAlign: isUser ? 'right' : 'left',
                        }}>
                        {fmtTime(msg.ts)}
                        {msg.sendState === 'sending' ? ' · 发送中…' : ''}
                        {msg.sendState === 'failed' ? ' · 发送失败' : ''}
                    </div>
                </div>
            </div>
        );
    };

    const onlineDot = isAggregate ? (sendable ? '#52c41a' : '#bfbfbf') : phone ? '#52c41a' : '#bfbfbf';
    // 聚合会话（多台在线）没有单一 phone 对象，不能用 `!!phone` 判在线 ——
    // 否则两头手机都在线，头部却显示「离线」（v26.10.12-v1 冒烟抓到的真 bug）。
    const onlineText = isAggregate ? (sendable ? '在线 · 多台在线' : '离线') : phone ? '在线' : '离线';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>
            {/* 会话头部：设备 + 在线状态 + 清空
                ⚠️ 右侧留 48px 空档：v26.10.12-v2 去掉了 Modal 标题栏，关闭按钮 × 是绝对定位
                浮在窗口右上角的（rc-dialog 的 closerNode 独立于 header 渲染），不占布局高度。
                这里原本只有 12px 内边距，「清空消息」会被 × 压住 —— 宽度必须 ≥ 关闭按钮占位。 */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 48px 8px 12px',
                    borderBottom: '1px solid ' + token.colorBorderSecondary,
                }}>
                {isAggregate ? (
                    <Text strong style={{ fontSize: 14 }}>
                        {PHONE_SESSION_LABEL}
                    </Text>
                ) : (
                    <DeviceIdTag id={session.key} colorIndex={colorIndex} />
                )}
                <span
                    style={{
                        fontSize: 12,
                        color: token.colorTextSecondary,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                    }}>
                    <span
                        style={{
                            display: 'inline-block',
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: onlineDot,
                        }}
                    />
                    {onlineText}
                    {isAggregate && sendable ? ' · 多台在线时收到的内容归在这里' : ''}
                </span>
                <span style={{ flex: '1 1 auto' }} />
                <Popconfirm title="清空这个会话的全部消息？" okText="清空" cancelText="取消" onConfirm={onClear}>
                    <Button type="text" size="small" icon={<TrashIcon size={13} />}>
                        清空消息
                    </Button>
                </Popconfirm>
            </div>

            {/* 消息区 */}
            <div
                ref={scrollRef}
                className="znhd-transfer-messages"
                style={{
                    flex: '1 1 auto',
                    minHeight: 0,
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    padding: '10px 12px',
                }}>
                {session.messages.length ? (
                    <Image.PreviewGroup
                        items={imageMessages.map((m) => m.previewUrl as string)}
                        preview={{
                            // 必须显式指定挂载容器（v26.10.08-v7：body 带 transform 会困住 fixed 浮层）
                            getContainer: getPreviewHost,
                            onOpenChange: (o: boolean) => setPreviewOpen(o),
                            actionsRender: (originalNode, info) => {
                                const printBtn = (
                                    <button
                                        key="znhd-print"
                                        type="button"
                                        className="ant-image-preview-actions-action"
                                        aria-label="print"
                                        title="打印原图"
                                        onClick={() => {
                                            // 优先按 url 反查，退回下标
                                            const found = imageMessages.findIndex(
                                                (m) => m.previewUrl === info.image?.url
                                            );
                                            const at = found >= 0 ? found : info.current;
                                            if (imageMessages[at]) printImage(imageMessages[at], at);
                                        }}>
                                        <PrinterOutlined />
                                    </button>
                                );
                                return appendPreviewActions(originalNode, printBtn);
                            },
                        }}>
                        {session.messages.map(renderMessage)}
                    </Image.PreviewGroup>
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={<span style={{ fontSize: 12 }}>暂无消息，用下面的输入框给这台手机发点东西吧</span>}
                    />
                )}
            </div>

            {/* 待发送图片 */}
            {pendingImages.length > 0 && (
                <div style={{ padding: '8px 12px 0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: token.colorTextSecondary }}>待发送图片</span>
                        <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
                            已选 {pendingImages.length} 张
                        </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 6 }}>
                        {pendingImages.map((img, i) => (
                            <div
                                key={img.url}
                                style={{
                                    position: 'relative',
                                    paddingBottom: '75%',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                    background: token.colorFillQuaternary,
                                }}>
                                <img
                                    src={img.url}
                                    alt={img.name}
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                    }}
                                />
                                <span
                                    title="移除这张"
                                    onClick={() => removePendingImage(i)}
                                    style={{
                                        position: 'absolute',
                                        top: 4,
                                        right: 4,
                                        width: 20,
                                        height: 20,
                                        borderRadius: '50%',
                                        background: 'rgba(0,0,0,0.55)',
                                        color: '#fff',
                                        fontSize: 13,
                                        lineHeight: '20px',
                                        textAlign: 'center',
                                        cursor: sending ? 'not-allowed' : 'pointer',
                                        userSelect: 'none',
                                    }}>
                                    ×
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 输入区 */}
            <div style={{ padding: 10, borderTop: '1px solid ' + token.colorBorderSecondary }}>
                {!sendable && (
                    <Text type="warning" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                        当前没有在线手机，连上手机后才能发送。
                    </Text>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="dashed" disabled={!sendable || sending} onClick={pickImages}>
                        选择图片
                    </Button>
                    <Input
                        placeholder="输入要发送到手机的文本…"
                        value={sendText}
                        onChange={(e) => setSendText(e.target.value)}
                        onPressEnter={doSendText}
                        disabled={!sendable}
                        style={{ flex: 1 }}
                    />
                    <Button
                        color="primary"
                        variant="solid"
                        disabled={!sendable || !sendText.trim()}
                        onClick={doSendText}
                        style={{ width: 76 }}>
                        发送
                    </Button>
                </div>
                {pendingImages.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                        <Button
                            color="primary"
                            variant="solid"
                            block
                            disabled={!sendable}
                            loading={sending}
                            onClick={confirmSendImage}>
                            发送 {pendingImages.length} 张图片
                        </Button>
                    </div>
                )}
                {progress && (
                    <div style={{ marginTop: 8 }}>
                        <Progress
                            percent={percent}
                            size="small"
                            strokeColor={progress.failed ? '#e4393c' : '#1677ff'}
                            status={progress.failed ? 'exception' : 'normal'}
                        />
                        <Text type={progress.failed ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
                            {progress.text}
                        </Text>
                    </div>
                )}
            </div>
        </div>
    );
}
