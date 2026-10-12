import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Empty, Image, Popconfirm, Progress, Typography, theme } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useReactToPrint } from 'react-to-print';
import { addLog } from '@/lib/logger';
import { copyImageToClipboard } from '@/lib/relay';
import { downloadFileName } from '@/lib/gallery';
import {
    CheckIcon,
    CopyIcon,
    DownloadIcon,
    ImageIcon,
    PaperclipIcon,
    SmartphoneIcon,
    TrashIcon,
    UserIcon,
} from '@/lib/ui/icons';
import ImageOverlayActions from '@/lib/ui/ImageOverlayActions';
import DeviceIdTag from '@/lib/ui/transfer/DeviceIdTag';
import ChatBubble from '@/lib/ui/transfer/ChatBubble';
import ChatComposer from '@/lib/ui/transfer/ChatComposer';
import type { PickedEmoji } from '@/lib/ui/transfer/EmojiPackPanel';
import { ChatHeader, ChatScroll } from '@/lib/ui/transfer/ChatPanel';
import { DEVICE_COLORS, hashDeviceId, shortPhoneId } from '@/lib/ui/transfer/deviceColors';
import MarkdownBody from '@/lib/ui/agent/MarkdownBody';
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

/**
 * 时间分隔条的文案（微信规则）：今天只显示 HH:mm，昨天加「昨天」前缀，再往前 MM-DD HH:mm。
 */
function sepTimeText(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    const dayOf = (x: Date) => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();
    const now = new Date();
    const hm = fmtTime(ts);
    if (dayOf(d) === dayOf(now)) return hm;
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (dayOf(d) === dayOf(yesterday)) return '昨天 ' + hm;
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + hm;
}

/** 两条消息间隔超过 5 分钟就插一条时间分隔条（微信同款；不逐条显示时间） */
const TIME_GAP = 5 * 60 * 1000;

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
 *   · 消息按会话聚合成聊天气泡（收到的在左浅底、本机发出的在右主色实心）；
 *   · 图片消息单击放大（antd Image.PreviewGroup + 共享层预览宿主 / A4 打印 / 遮罩压制）；
 *   · 右下角悬浮图标按钮（复制 / 下载 / 删除）与历史记录同一套实现；
 *   · 底部输入区发文本 / 选图发送，逐张压缩后按序投递。
 *
 * v26.10.12-v3：气泡、滚动区、输入框全部换成 `ChatBubble` / `ChatScroll` / `ChatComposer`
 * （与 Agent 对话共用同一套）。用户要求「设备菜单和 agent 菜单下的对话主区域使用相同的样式」，
 * 所以这里**只负责数据与动作**，排版一律走共用件 —— 想改外观请改共用件，别在这里另写一套。
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

    const sendable = sessionSendable(session.key);
    const isAggregate = session.key === PHONE_SESSION_KEY;

    useEffect(() => {
        syncPreviewMask(previewOpen);
        return () => syncPreviewMask(false);
    }, [previewOpen]);

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

    /**
     * 投递一批图片（「发送 N 张」与「点表情直接发送」共用）：
     * 逐张压缩 → POST /phone/send，进度写进 `progress`；全部成功时清进度并执行 `afterOk`。
     * 失败停在原地（进度条转红 + 文案说明已发几张），由用户决定是否重发。
     */
    const runSend = (list: PendingImage[], afterOk: () => void) => {
        setSending(true);
        const ok = sendImagesToSession(session.key, list, (done, total, failed, text) => {
            setProgress({ done, total, failed, text });
            if (done >= total || failed) {
                setSending(false);
                if (!failed) {
                    afterOk();
                    setProgress(null);
                }
            }
        });
        if (!ok) setSending(false);
    };

    /**
     * 点选一张在线表情（v26.10.13-v3 入待发列表；**v26.10.13-v4 改为直接发送**，按用户要求）：
     * 表情面板已经把图下好了（blob 在手上），这里直接把它包成一张图投出去 ——
     * 与「图片上传 → 发送 N 张」走**同一条发送链路**（逐张压缩 → /phone/send → 气泡 + 进度），
     * 只是跳过「待发列表」这一步：点一下就是一次发送，与微信「点表情即发出」一致。
     */
    const sendEmojiNow = (emoji: PickedEmoji) => {
        if (!sendable) {
            addLog('[传输助手] 当前无在线设备，无法发送', 'error', true);
            return;
        }
        if (sending) {
            addLog('[传输助手] 正在发送上一批，稍后再点表情', 'info');
            return;
        }
        const mime = emoji.blob.type || 'image/webp';
        const file = new File([emoji.blob], emoji.name, { type: mime });
        addLog('[传输助手] 发送表情：' + emoji.pack + ' · ' + emoji.key, 'info');
        runSend(
            [
                {
                    file,
                    name: emoji.name,
                    mime,
                    // 与「图片上传」一样用 objectURL；这张 blob 还会被表情面板的缩略图/浮层引用，
                    // 故这里**不 revoke**（本进程内长期复用同一份 blob，撤销会让面板一起裂掉）
                    url: URL.createObjectURL(emoji.blob),
                },
            ],
            () => {
                /* 直接发送：没有待发列表要清 */
            }
        );
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
        // 发送按**快照**进行：列表在发送期间被清空/改动都不影响这一批
        const snapshot = pendingImages.slice();
        runSend(snapshot, () => setPendingImages([]));
    };

    // 图片消息（会话内按出现顺序）——预览左右切换由 antd 接管
    const imageMessages = useMemo(() => session.messages.filter((m) => m.type === 'image'), [session.messages]);
    const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

    /** 对方头像 = 设备专属色板（与第二栏列表、配对窗同一个色，一眼对应是哪台） */
    const palette =
        DEVICE_COLORS[typeof colorIndex === 'number' ? colorIndex : hashDeviceId(session.key) % DEVICE_COLORS.length];
    const peerAvatarStyle = {
        background: palette.bg,
        border: '1px solid ' + palette.border,
        color: palette.color,
    };
    const peerAvatar = isAggregate ? (
        <SmartphoneIcon size={15} color="currentColor" />
    ) : (
        shortPhoneId(session.key).slice(0, 1).toUpperCase()
    );

    /** 时间分隔条之后才轮到发送状态：meta 只在「发送中 / 失败」时出现（时间在分隔条上，微信规则） */
    const metaOf = (msg: TransferMessage): ReactNode =>
        msg.sendState === 'sending' ? '发送中…' : msg.sendState === 'failed' ? '发送失败' : undefined;

    const renderMessage = (msg: TransferMessage) => {
        const isUser = msg.direction === 'out';
        const side = isUser ? 'right' : 'left';
        if (msg.type === 'image') {
            const idx = imageMessages.findIndex((m) => m.id === msg.id);
            return (
                <ChatBubble
                    key={msg.id}
                    side={side}
                    bare
                    maxWidth="62%"
                    danger={msg.sendState === 'failed'}
                    meta={metaOf(msg)}
                    avatar={isUser ? <UserIcon size={15} /> : peerAvatar}
                    avatarStyle={isUser ? undefined : peerAvatarStyle}>
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
                                // 微信规则：按图片自身尺寸显示（宽高 auto + 只给上限），
                                // 比例永远保持、完整可见 —— 不用 aspectRatio/objectFit 裁切
                                maxWidth: 240,
                                maxHeight: 360,
                                width: 'auto',
                                height: 'auto',
                                borderRadius: 8,
                                // 发送中的图半透明，失败加红框
                                opacity: msg.sendState === 'sending' ? 0.55 : 1,
                                border: msg.sendState === 'failed' ? '1px solid ' + token.colorError : 'none',
                                display: 'block',
                            }}
                        />
                    </ImageOverlayActions>
                </ChatBubble>
            );
        }
        return (
            <ChatBubble
                key={msg.id}
                side={side}
                maxWidth="74%"
                danger={msg.sendState === 'failed'}
                meta={metaOf(msg)}
                avatar={isUser ? <UserIcon size={15} /> : peerAvatar}
                avatarStyle={isUser ? undefined : peerAvatarStyle}>
                {/* 两侧都按 Markdown 渲染：与 Agent 对话保持同一种文字排版；
                    用户气泡是主色实心，故走反色档（否则链接/代码块会「蓝压蓝」看不见） */}
                <MarkdownBody content={msg.text || ''} inverted={isUser} />
                {msg.sendState === 'failed' && msg.sendError ? (
                    <div style={{ fontSize: 11, marginTop: 4 }}>{msg.sendError}</div>
                ) : null}
            </ChatBubble>
        );
    };

    const onlineDot = isAggregate ? (sendable ? '#52c41a' : '#bfbfbf') : phone ? '#52c41a' : '#bfbfbf';
    // 聚合会话（多台在线）没有单一 phone 对象，不能用 `!!phone` 判在线 ——
    // 否则两头手机都在线，头部却显示「离线」（v26.10.12-v1 冒烟抓到的真 bug）。
    const onlineText = isAggregate ? (sendable ? '在线 · 多台在线' : '离线') : phone ? '在线' : '离线';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>
            {/* 会话头部（微信式）：左 = 对方头像 + 会话名称 + 在线状态；右 = 垃圾桶（清空） */}
            <ChatHeader
                left={
                    <>
                        <span
                            style={{
                                width: 30,
                                height: 30,
                                borderRadius: 6,
                                flex: '0 0 auto',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 13,
                                fontWeight: 600,
                                ...peerAvatarStyle,
                            }}>
                            {peerAvatar}
                        </span>
                        {isAggregate ? (
                            <Text strong style={{ fontSize: 15 }}>
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
                    </>
                }
                right={
                    <Popconfirm title="清空这个会话的全部消息？" okText="清空" cancelText="取消" onConfirm={onClear}>
                        {/* 微信同款：头部右侧是纯图标功能按钮（垃圾桶），不带文字 */}
                        <Button
                            type="text"
                            size="small"
                            aria-label="清空消息"
                            title="清空消息"
                            icon={<TrashIcon size={15} />}
                            style={{ color: token.colorTextSecondary }}
                        />
                    </Popconfirm>
                }
            />

            {/* 消息区（时间分隔条：间隔超过 5 分钟的一组消息共用一条，微信同款） */}
            <ChatScroll className="znhd-transfer-messages" scrollDep={session.messages}>
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
                        {/* 消息 + 时间分隔条：相邻两条间隔 > 5 分钟就插一条居中的时间（多条共用，微信规则） */}
                        {(() => {
                            const nodes: ReactNode[] = [];
                            let prevTs = 0;
                            session.messages.forEach((msg) => {
                                if (!prevTs || msg.ts - prevTs > TIME_GAP) {
                                    nodes.push(
                                        <div
                                            key={'sep-' + msg.id}
                                            className="znhd-chat-time"
                                            style={{
                                                textAlign: 'center',
                                                fontSize: 11,
                                                color: 'rgba(255,255,255,0.35)',
                                                margin: '6px 0 12px',
                                            }}>
                                            {sepTimeText(msg.ts)}
                                        </div>
                                    );
                                }
                                prevTs = msg.ts;
                                nodes.push(renderMessage(msg));
                            });
                            return nodes;
                        })()}
                    </Image.PreviewGroup>
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={<span style={{ fontSize: 12 }}>暂无消息，用下面的输入框给这台手机发点东西吧</span>}
                    />
                )}
            </ChatScroll>

            {/* 待发送图片 + 进度：贴在输入框**上方**（输入框本身在两端保持完全一致，不塞业务块） */}
            {pendingImages.length > 0 && (
                <div style={{ flex: '0 0 auto', padding: '8px 12px 0' }}>
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
                    <Button
                        color="primary"
                        variant="solid"
                        block
                        disabled={!sendable}
                        loading={sending}
                        onClick={confirmSendImage}
                        style={{ marginTop: 8 }}>
                        发送 {pendingImages.length} 张图片
                    </Button>
                </div>
            )}
            {progress && (
                <div style={{ flex: '0 0 auto', padding: '8px 12px 0' }}>
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

            {/* 输入区（与 Agent 对话同一个 ChatComposer） */}
            <ChatComposer
                value={sendText}
                onChange={setSendText}
                onSend={doSendText}
                disabled={!sendable}
                canSend={!!sendText.trim()}
                placeholder="输入要发送到手机的文本…（Enter 发送，Shift+Enter 换行）"
                onPickEmojiImage={sendEmojiNow}
                notice={
                    sendable ? undefined : (
                        <Text type="warning" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
                            当前没有在线手机，连上手机后才能发送。
                        </Text>
                    )
                }
                actions={[
                    {
                        key: 'image',
                        label: '图片上传',
                        tooltip: '选择图片发送到手机（发送前自动压缩）',
                        icon: <ImageIcon size={15} />,
                        onClick: pickImages,
                        disabled: !sendable || sending,
                    },
                    {
                        key: 'file',
                        label: '附件',
                        tooltip: '暂不支持发送附件：中继服务只转发图片与文本',
                        icon: <PaperclipIcon size={15} />,
                        disabled: true,
                    },
                ]}
            />
        </div>
    );
}
