import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Image, Space, Typography, theme } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useReactToPrint } from 'react-to-print';
import { addLog } from '@/lib/logger';
import { copyImageToClipboard } from '@/lib/relay';
import { safeCopyText } from '@/lib/clipboard';
import { downloadFileName } from '@/lib/gallery';
import { CheckIcon, CopyIcon, DownloadIcon, TrashIcon } from '@/lib/ui/icons';
import ImageOverlayActions from '@/lib/ui/ImageOverlayActions';
import { clearAllTransferFiles, PHONE_SESSION_KEY, removeTransferMessage } from '@/lib/transfer/store';
import { shortPhoneId } from '@/lib/ui/transfer/deviceColors';
import type { TransferMessage } from '@/lib/transfer/types';
// 预览相关的通用件全部来自共享层（与手机上传页同一份，v26.10.08-v13 起）
import { appendPreviewActions } from '../../../../shared/preview/actions';
import { getPreviewHost } from '../../../../shared/preview/host';
import { syncPreviewMask } from '../../../../shared/preview/mask';
import { buildA4ImageNode, PRINT_PAGE_STYLE } from '../../../../shared/preview/print';

const { Text } = Typography;

/** 时间戳展示（MM-DD HH:mm:ss） */
function fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 来源设备名（聚合会话显示「手机」） */
function sourceLabel(msg: TransferMessage): string {
    if (msg.sessionKey === PHONE_SESSION_KEY) return '手机';
    return shortPhoneId(msg.sessionKey);
}

/**
 * 文件视图（v26.10.12-v1，传输助手第三栏的「文件」分组）。
 *
 * 原「历史记录」弹窗的整体搬迁：全部传输过的文件（跨会话汇总）按图片 / 文本
 * 两类平铺，图片用九宫格 + 右下角悬浮图标按钮（复制 / 下载 / 删除）+ 单击放大
 * （缩放 / 旋转 / 多图切换 / 工具栏打印原图，A4 自适应）。
 */
export default function TransferFilesView({ messages }: { messages: TransferMessage[] }) {
    const { token } = theme.useToken();
    /** 文本行的复制反馈：记录是**哪一行**，避免所有行一起改文案 */
    const [copyState, setCopyState] = useState<{ id: string; ok: boolean } | null>(null);
    /** 图片复制的反馈 */
    const [imgCopy, setImgCopy] = useState<{ id: string; state: 'busy' | 'ok' | 'fail' } | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const printTitleRef = useRef('图片');

    useEffect(() => {
        syncPreviewMask(previewOpen);
        return () => syncPreviewMask(false);
    }, [previewOpen]);

    const doPrint = useReactToPrint({
        ignoreGlobalStyles: true,
        documentTitle: () => printTitleRef.current,
        pageStyle: PRINT_PAGE_STYLE,
    });

    // 最新在前（与「历史记录」一致：刚收到的先看）
    const ordered = useMemo(() => messages.slice().sort((a, b) => b.ts - a.ts), [messages]);
    const images = ordered.filter((m) => m.type === 'image');
    const texts = ordered.filter((m) => m.type === 'text');

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

    const doCopyText = (msg: TransferMessage) => {
        safeCopyText(msg.text || '', (ok: boolean) => {
            setCopyState({ id: msg.id, ok });
            if (ok) addLog('文本已复制到剪贴板', 'success');
            window.setTimeout(() => setCopyState(null), 1500);
        });
    };

    if (!ordered.length) {
        return (
            <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span style={{ fontSize: 12 }}>暂无文件——手机发来的图片 / 文本会汇总在这里</span>}
                />
            </div>
        );
    }

    return (
        <div
            className="znhd-transfer-files"
            style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '10px 12px' }}>
            {/* 右侧留 48px 空档：v26.10.12-v2 去掉 Modal 标题栏后，关闭按钮 × 绝对定位浮在窗口右上角，
                「清空全部」贴右边会被它压住 */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, paddingRight: 36 }}>
                <Text strong style={{ fontSize: 14 }}>
                    全部文件（图片 {images.length} · 文本 {texts.length}）
                </Text>
                <span style={{ flex: '1 1 auto' }} />
                <Button danger size="small" onClick={clearAllTransferFiles}>
                    清空全部
                </Button>
            </div>

            {images.length ? (
                <Image.PreviewGroup
                    items={images.map((m) => m.previewUrl as string)}
                    preview={{
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
                                        const found = images.findIndex((m) => m.previewUrl === info.image?.url);
                                        const at = found >= 0 ? found : info.current;
                                        if (images[at]) printImage(images[at], at);
                                    }}>
                                    <PrinterOutlined />
                                </button>
                            );
                            return appendPreviewActions(originalNode, printBtn);
                        },
                    }}>
                    <div
                        style={{
                            // auto-fill + 96px 下限：格子必须宽过右下角悬浮按钮条（3 个图标按钮实测 74px），
                            // 否则窄栏（窗口未最大化时主聊天区只有约 300px）会把按钮条挤出图片，
                            // 「按钮在图片右下角」这条几何契约就假红（v26.10.12-v1 冒烟实测：4 等分格子只有 53px）。
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                            gap: 8,
                            alignContent: 'start',
                        }}>
                        {images.map((msg, idx) => (
                            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column' }}>
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
                                            onClick: () => removeTransferMessage(msg.sessionKey, msg.id),
                                        },
                                    ]}>
                                    <Image
                                        src={msg.previewUrl}
                                        alt={msg.name || 'image'}
                                        style={{
                                            width: '100%',
                                            aspectRatio: '1 / 1',
                                            objectFit: 'cover',
                                            borderRadius: 8,
                                        }}
                                    />
                                </ImageOverlayActions>
                                <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 2 }}>
                                    {sourceLabel(msg)} · {fmtTime(msg.ts)} · {msg.direction === 'in' ? '收到' : '发出'}
                                </div>
                            </div>
                        ))}
                    </div>
                </Image.PreviewGroup>
            ) : null}

            {texts.length ? (
                <div style={{ marginTop: images.length ? 16 : 0 }}>
                    <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 6 }}>
                        文本（{texts.length}）
                    </Text>
                    {texts.map((msg) => (
                        <div
                            key={msg.id}
                            style={{
                                display: 'flex',
                                gap: 8,
                                alignItems: 'flex-start',
                                padding: '8px 0',
                                borderBottom: '1px solid ' + token.colorBorderSecondary,
                            }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <pre
                                    style={{
                                        margin: 0,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        fontFamily: 'inherit',
                                        fontSize: 14,
                                        lineHeight: 1.6,
                                    }}>
                                    {msg.text}
                                </pre>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                    {sourceLabel(msg)} · {fmtTime(msg.ts)} · {msg.direction === 'in' ? '收到' : '发出'}
                                </Text>
                            </div>
                            <Space size={4}>
                                <Button size="small" onClick={() => doCopyText(msg)}>
                                    {copyState && copyState.id === msg.id ? (
                                        copyState.ok ? (
                                            <>
                                                <CheckIcon size={12} /> 已复制
                                            </>
                                        ) : (
                                            '复制失败'
                                        )
                                    ) : (
                                        '复制'
                                    )}
                                </Button>
                                <Button
                                    size="small"
                                    danger
                                    aria-label="删除文本"
                                    onClick={() => removeTransferMessage(msg.sessionKey, msg.id)}>
                                    ×
                                </Button>
                            </Space>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
