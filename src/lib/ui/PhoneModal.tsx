import { useEffect, useRef, useState } from 'react';
import { Modal, Button, Input, Progress, Space, Typography } from 'antd';
import { addLog } from '@/lib/logger';
import { safeCopyText } from '@/lib/clipboard';
import { RELAY_MAX_BODY, imagePayloadBytes, compressImageForPhone, getDeviceId, sendToPhone } from '@/lib/relay';
import { genQrDataUrl } from '@/lib/qrcode';
import { getOverlayContainer } from '@/lib/ui/panelHost';

const { Text } = Typography;

/** 体积显示：统一按 KB 输出（不足 1KB 也显示 1KB，避免出现「0KB」） */
function kbText(bytes: number) {
    const n = Number(bytes) || 0;
    return Math.max(1, Math.round(n / 1024)) + 'KB';
}

interface PendingImage {
    file: File;
    name: string;
    mime: string;
    url: string;
}

export interface PhoneModalProps {
    open: boolean;
    onClose: () => void;
    relayServer: string;
    onChangeRelayServer: (url: string) => void;
}

interface ProgressState {
    done: number;
    total: number;
    busy: boolean;
    failed: boolean;
    text: string;
}

/**
 * 设备互联弹窗（v26.10.06-v9：由 CAT_UI.Drawer 侧边抽屉改为 antd Modal 弹窗）。
 * 业务逻辑（二维码、在线轮询、逐张压缩发送）与旧实现一致，仅替换渲染层。
 */
export default function PhoneModal({ open, onClose, relayServer }: PhoneModalProps) {
    const deviceId = getDeviceId();
    const [qrUrl, setQrUrl] = useState('');
    const [link, setLink] = useState('');
    const [phoneOnline, setPhoneOnline] = useState(false);
    const [sending, setSending] = useState(false);
    const [sendText, setSendText] = useState('');
    const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
    const [progress, setProgress] = useState<ProgressState | null>(null);
    // 待发列表的实时快照：发送循环里要读最新列表，又不想把整个循环塞进 setState 回调
    const pendingRef = useRef<PendingImage[]>([]);
    pendingRef.current = pendingImages;

    // 计算链接 + 二维码（非 http(s) 前缀即地址输入中途，不生成）
    useEffect(() => {
        const s = (relayServer || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(s)) {
            setLink('');
            setQrUrl('');
            return;
        }
        const lk = s + '/u/' + deviceId;
        setLink(lk);
        genQrDataUrl(lk)
            .then((u) => setQrUrl(u))
            .catch((e) => {
                addLog('[二维码] 失败: ' + e.message, 'error', true);
            });
    }, [relayServer, open, deviceId]);

    // 轮询手机在线状态（每 5s），用于发送前判断是否可发
    useEffect(() => {
        const server = (relayServer || '').trim().replace(/\/+$/, '');
        if (!open || !/^https?:\/\//i.test(server)) return;
        let alive = true;
        const check = () => {
            if (!alive) return;
            try {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: server + '/phone/status/' + encodeURIComponent(deviceId),
                    timeout: 8000,
                    onload: (r) => {
                        if (!alive) return;
                        let j = null;
                        try {
                            j = JSON.parse(r.responseText);
                        } catch (e) {
                            j = null;
                        }
                        setPhoneOnline(!!(j && j.online));
                    },
                    onerror: () => {
                        if (alive) setPhoneOnline(false);
                    },
                });
            } catch (e) {
                if (alive) setPhoneOnline(false);
            }
        };
        check();
        const t = setInterval(check, 5000);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, [open, relayServer, deviceId]);

    const doSendText = () => {
        const t = (sendText || '').trim();
        if (!t) {
            addLog('[发送到手机] 文本为空', 'error', true);
            return;
        }
        if (!phoneOnline) {
            addLog('[发送到手机] 当前无在线设备，无法发送', 'error', true);
            return;
        }
        setSending(true);
        sendToPhone({
            server: relayServer,
            uuid: deviceId,
            payload: { text: t },
            onOk: () => {
                addLog('[发送到手机] 文本已发送', 'success');
                setSendText('');
                setSending(false);
            },
            onFail: (e) => {
                addLog('[发送到手机] 发送失败：' + e, 'error');
                setSending(false);
            },
        });
    };

    // 选图：仅加入待发列表，点「发送」才真正上传（与手机端一致，避免误选即发）
    const pickImages = () => {
        if (!phoneOnline) {
            addLog('[发送到手机] 当前无在线设备，无法发送', 'error', true);
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

    // 逐张顺序发送（一张成功再发下一张，保证到达顺序；失败即停并提示进度）
    const confirmSendImage = () => {
        if (!pendingImages.length) return;
        if (!phoneOnline) {
            addLog('[发送到手机] 当前无在线设备，无法发送', 'error', true);
            return;
        }
        setSending(true);
        const list = pendingImages.slice();
        const total = list.length;
        let sent = 0;

        const sendNext = () => {
            if (sent >= total) {
                list.forEach((it) => {
                    try {
                        URL.revokeObjectURL(it.url);
                    } catch (e) {
                        /* 忽略 */
                    }
                });
                addLog('[发送到手机] ' + total + ' 张图片已全部发送', 'success');
                setSending(false);
                setPendingImages([]);
                setProgress(null);
                return;
            }
            const it = list[sent];
            // 发送前统一压缩（与「手机 → 电脑」方向一致）：SVG/GIF、解码失败、压不小都回退原图
            addLog('[发送到手机] 正在处理（' + (sent + 1) + '/' + total + '）：' + (it.name || 'image'), 'info');
            setProgress({
                done: sent,
                total,
                busy: true,
                failed: false,
                text: '处理中… ' + sent + '/' + total + '（第 ' + (sent + 1) + ' 张）',
            });
            compressImageForPhone(it.file).then((out) => {
                if (imagePayloadBytes(out.blob, out.name, out.mime) > RELAY_MAX_BODY) {
                    addLog(
                        '[发送到手机] 第 ' +
                            (sent + 1) +
                            ' 张压缩后仍超限（单张约 12MB 上限），已停止（已发 ' +
                            sent +
                            '/' +
                            total +
                            '）',
                        'error',
                        true
                    );
                    setSending(false);
                    setProgress({
                        done: sent,
                        total,
                        busy: false,
                        failed: true,
                        text: '❌ 已发送 ' + sent + '/' + total + '，已停止',
                    });
                    return;
                }
                addLog(
                    '[发送到手机] ' +
                        (out.compressed
                            ? '已压缩 ' + it.name + '：' + kbText(it.file.size) + ' → ' + kbText(out.blob.size)
                            : '原图发送 ' + out.name + '（' + kbText(out.blob.size) + '）') +
                        '，正在发送（' +
                        (sent + 1) +
                        '/' +
                        total +
                        '）',
                    'info'
                );
                const rd = new FileReader();
                rd.onload = () => {
                    const b64 = ((rd.result as string) || '').split(',')[1] || '';
                    if (!b64) {
                        failAt('读取图片失败');
                        return;
                    }
                    sendToPhone({
                        server: relayServer,
                        uuid: deviceId,
                        payload: { name: out.name, mime: out.mime, data: b64 },
                        onOk: () => {
                            sent++;
                            setProgress({
                                done: sent,
                                total,
                                busy: sent < total,
                                failed: false,
                                text: '已发送 ' + sent + '/' + total,
                            });
                            sendNext();
                        },
                        onFail: (e) => failAt(e),
                    });
                };
                rd.onerror = () => failAt('读取图片失败');
                rd.readAsDataURL(out.blob);
            });
        };

        const failAt = (reason: string) => {
            addLog(
                '[发送到手机] 第 ' + (sent + 1) + ' 张发送失败：' + reason + '（已发 ' + sent + '/' + total + '）',
                'error'
            );
            setSending(false);
            setProgress({
                done: sent,
                total,
                busy: false,
                failed: true,
                text: '❌ 已发送 ' + sent + '/' + total + '，已停止',
            });
        };

        sendNext();
    };

    const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

    return (
        <Modal
            open={open}
            title="设备互联"
            onCancel={onClose}
            getContainer={getOverlayContainer}
            width={560}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            footer={
                <Space>
                    <Button onClick={onClose}>关闭</Button>
                </Space>
            }>
            {link ? (
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ flexShrink: 0 }}>
                        {qrUrl ? (
                            <img
                                src={qrUrl}
                                alt="上传链接二维码"
                                style={{ width: 140, height: 140, border: '1px solid #eee', borderRadius: 8 }}
                            />
                        ) : (
                            <div
                                style={{
                                    width: 140,
                                    height: 140,
                                    border: '1px solid #eee',
                                    borderRadius: 8,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: '#999',
                                    fontSize: 12,
                                    textAlign: 'center',
                                }}>
                                二维码生成中…
                            </div>
                        )}
                    </div>
                    <div style={{ flex: 1, minWidth: 180 }}>
                        <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all', display: 'block' }}>
                            {link}
                        </Text>
                        <Button type="link" onClick={() => link && safeCopyText(link)}>
                            复制链接
                        </Button>
                    </div>
                </div>
            ) : (
                <Text type="danger">尚未配置中继服务器，请到「设置」填写。</Text>
            )}

            <div style={{ margin: '12px 0 4px', fontWeight: 600 }}>发送到手机</div>
            <Text type={phoneOnline ? 'success' : 'danger'} style={{ fontSize: 13 }}>
                {phoneOnline ? '🟢 手机已连接，可发送' : '⚪ 当前无在线设备，无法发送'}
            </Text>

            <Space.Compact style={{ width: '100%', marginTop: 10 }}>
                <Input
                    placeholder="输入要发送到手机的文本…"
                    value={sendText}
                    onChange={(e) => setSendText(e.target.value)}
                    onPressEnter={doSendText}
                />
                <Button
                    color="primary"
                    variant="solid"
                    disabled={!phoneOnline || sending}
                    loading={sending}
                    onClick={doSendText}>
                    发送
                </Button>
            </Space.Compact>

            <Button block disabled={!phoneOnline || sending} onClick={pickImages} style={{ marginTop: 12 }}>
                选择 / 添加图片（可多选）
            </Button>

            {pendingImages.length > 0 && (
                <>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(4, 1fr)',
                            gap: 6,
                            marginTop: 10,
                        }}>
                        {pendingImages.map((img, i) => (
                            <div
                                key={img.url}
                                style={{
                                    position: 'relative',
                                    paddingBottom: '100%',
                                    borderRadius: 8,
                                    overflow: 'hidden',
                                    background: '#f2f2f2',
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
                                <Button
                                    size="small"
                                    danger
                                    disabled={sending}
                                    onClick={() => removePendingImage(i)}
                                    style={{
                                        position: 'absolute',
                                        top: 2,
                                        right: 2,
                                        padding: '0 6px',
                                        minWidth: 22,
                                        height: 22,
                                    }}>
                                    ×
                                </Button>
                            </div>
                        ))}
                    </div>
                    <Button
                        block
                        color="primary"
                        variant="solid"
                        disabled={!phoneOnline || sending}
                        loading={sending}
                        onClick={confirmSendImage}
                        style={{ marginTop: 10 }}>
                        发送 {pendingImages.length} 张图片到手机
                    </Button>
                </>
            )}

            {progress && (
                <div style={{ marginTop: 10 }}>
                    <Progress
                        percent={percent}
                        size="small"
                        strokeColor={progress.failed ? '#e4393c' : '#007e44'}
                        status={progress.failed ? 'exception' : 'normal'}
                    />
                    <Text type={progress.failed ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
                        {progress.text}
                    </Text>
                </div>
            )}
        </Modal>
    );
}
