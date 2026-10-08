import { useEffect, useState } from 'react';
import { Modal, Button, Checkbox, Input, Progress, Tag, Typography } from 'antd';
import { addLog } from '@/lib/logger';
import { safeCopyText } from '@/lib/clipboard';
import { RELAY_MAX_BODY, imagePayloadBytes, compressImageForPhone, getDeviceId, sendToPhone } from '@/lib/relay';
import { genQrDataUrl } from '@/lib/qrcode';
import { getOverlayContainer } from '@/lib/ui/panelHost';

const { Text } = Typography;

/** 体积显示：统一按 KB 输出（不足 1KB 也显示 1KB，避免出现「0KB」） */
function kbText(bytes: any) {
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
    /** 已连接的手机（由主面板轮询 /phone/status 得到；本组件不再自己轮询） */
    phones: PhoneTarget[];
    onChangeRelayServer: (url: string) => void;
}

/** 一台已连接的手机（id 为空表示老版中继只回了 online、没有手机 ID） */
export interface PhoneTarget {
    id: string;
    lastSeen?: number;
}

/** 手机 ID 的展示用短串（UUID 太长，取前 8 位） */
function shortPhoneId(id: string): string {
    if (!id) return '未知设备（旧版中继）';
    return id.length > 8 ? id.slice(0, 8) + '…' : id;
}

interface ProgressState {
    done: number;
    total: number;
    busy: boolean;
    failed: boolean;
    text: string;
}

/** 卡片式分区（与参考稿一致：圆角描边区块 + 区块标题） */
function Section({ title, extra, children }: { title: string; extra?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{ border: '1px solid #f0f0f0', borderRadius: 10, padding: '12px 14px', marginBottom: 12 }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 10,
                }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
                {extra}
            </div>
            {children}
        </div>
    );
}

/**
 * 设备互联弹窗（v26.10.06-v17：按参考稿重排版式）。
 *
 * 版式：标题「📱 手机互传 + 设备互联标签」→「电脑接收 · 本机专属链接」分区
 * （左二维码 + 右链接框 + 复制按钮；**按要求不放「重新生成」**）→ 居中的在线状态胶囊 →
 * 「发送到手机」分区（文本行 + 待发送图片行 + 虚线选图 + 发送按钮）。
 * 业务逻辑（二维码、在线轮询、逐张压缩发送、进度）与旧实现一致，只换成新排版。
 */
export default function PhoneModal({ open, onClose, relayServer, phones }: PhoneModalProps) {
    const deviceId = getDeviceId();
    const [qrUrl, setQrUrl] = useState('');
    const [link, setLink] = useState('');
    /** 选中的手机 ID（多台时用于定向发送；默认全选） */
    const [selected, setSelected] = useState<string[]>([]);
    const [sending, setSending] = useState(false);
    const [sendText, setSendText] = useState('');
    const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
    const [progress, setProgress] = useState<ProgressState | null>(null);

    const phoneIds = phones.map((p) => p.id).filter(Boolean);
    const phoneOnline = phones.length > 0;

    /**
     * 目标手机变化时同步选择项：保留「仍在线且在选中」的，把新上线的补进选中（= 默认全选）。
     * 依赖 phones 的**引用变化**即可 —— 主面板只在手机 ID 集合真的变化时才更新该引用。
     */
    useEffect(() => {
        const ids = phones.map((p) => p.id).filter(Boolean);
        setSelected((prev) =>
            prev.filter((id) => ids.indexOf(id) >= 0).concat(ids.filter((id) => prev.indexOf(id) < 0))
        );
    }, [phones]);

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

    /**
     * 本次发送的目标（v26.10.06-v4）：
     *  - 只有 1 台手机（或老版中继没给手机 ID）→ `'all'`：按用户要求「直接发送」，不做选择；
     *  - 多台且全选 → `'all'`（服务端广播给所有在线手机）；
     *  - 多台但只勾了部分 → 手机 ID 数组（服务端按长轮询上的 phoneId 定向投递）。
     */
    const sendTargets = (): 'all' | string[] => {
        if (phoneIds.length <= 1) return 'all';
        const chosen = phoneIds.filter((id) => selected.indexOf(id) >= 0);
        return chosen.length === phoneIds.length ? 'all' : chosen;
    };

    /** 多台手机时一台都没勾 → 不允许发送（否则会静默发不出去） */
    const noTarget = phoneIds.length > 1 && phoneIds.every((id) => selected.indexOf(id) < 0);

    const doSendText = () => {
        const t = (sendText || '').trim();
        if (!t) {
            addLog('[发送到手机] 文本为空', 'error', true);
            return;
        }
        if (noTarget) {
            addLog('[发送到手机] 未选择任何手机，已取消发送', 'error', true);
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
            payload: { text: t, targets: sendTargets() },
            onOk: () => {
                addLog('[发送到手机] 文本已发送', 'success');
                setSendText('');
                setSending(false);
            },
            onFail: (e: any) => {
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
        if (noTarget) {
            addLog('[发送到手机] 未选择任何手机，已取消发送', 'error', true);
            return;
        }
        setSending(true);
        // 目标一次性算好：整批图片发给同一组手机（发送过程中用户改勾选不影响本批）
        const targets = sendTargets();
        const list = pendingImages.slice();
        const total = list.length;
        let sent = 0;

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
            compressImageForPhone(it.file).then((out: any) => {
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
                        payload: { name: out.name, mime: out.mime, data: b64, targets: targets },
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
                        onFail: (e: any) => failAt(e),
                    });
                };
                rd.onerror = () => failAt('读取图片失败');
                rd.readAsDataURL(out.blob);
            });
        };

        sendNext();
    };

    const percent = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
    const canSend = phoneOnline && !sending && !noTarget;

    return (
        <Modal
            open={open}
            title={
                <span>
                    📱 手机互传{' '}
                    <Tag style={{ marginLeft: 6, fontWeight: 400 }} color="default">
                        设备互联
                    </Tag>
                </span>
            }
            onCancel={onClose}
            getContainer={getOverlayContainer}
            width={560}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            footer={<Button onClick={onClose}>关闭</Button>}>
            {/* 电脑接收 · 本机专属链接 */}
            <Section
                title="电脑接收 · 本机专属链接"
                extra={
                    <Tag color="blue" style={{ margin: 0, fontWeight: 400 }}>
                        手机扫码即上传
                    </Tag>
                }>
                {link ? (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                        <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
                            {qrUrl ? (
                                <img
                                    src={qrUrl}
                                    alt="上传链接二维码"
                                    style={{
                                        width: 124,
                                        height: 124,
                                        border: '1px solid #f0f0f0',
                                        // 二维码不加圆角（v26.10.06-v21 按用户要求）：圆角会切掉
                                        // 定位用的三个角标，部分扫码器识别率会下降
                                        display: 'block',
                                    }}
                                />
                            ) : (
                                <div
                                    style={{
                                        width: 124,
                                        height: 124,
                                        border: '1px solid #f0f0f0',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#999',
                                        fontSize: 12,
                                    }}>
                                    二维码生成中…
                                </div>
                            )}
                            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 6 }}>扫一扫上传</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 6 }}>
                                链接（复制到手机浏览器打开）
                            </div>
                            <div
                                style={{
                                    border: '1px solid #d9d9d9',
                                    borderRadius: 8,
                                    padding: '7px 10px',
                                    fontSize: 13,
                                    wordBreak: 'break-all',
                                    background: '#fafafa',
                                    maxHeight: 56,
                                    overflow: 'auto',
                                }}>
                                {link}
                            </div>
                            <Button
                                color="primary"
                                variant="solid"
                                block
                                style={{ marginTop: 10 }}
                                onClick={() => link && safeCopyText(link)}>
                                复制链接
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Text type="danger">尚未配置中继服务器，请到「设置」填写。</Text>
                )}
            </Section>

            {/* 在线状态胶囊 */}
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <span
                    style={{
                        display: 'inline-block',
                        border: '1px solid ' + (phoneOnline ? '#b7eb8f' : '#ffccc7'),
                        background: phoneOnline ? '#f6ffed' : '#fff2f0',
                        color: phoneOnline ? '#389e0d' : '#cf1322',
                        borderRadius: 16,
                        padding: '4px 16px',
                        fontSize: 13,
                    }}>
                    <span
                        style={{
                            display: 'inline-block',
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: phoneOnline ? '#52c41a' : '#ff4d4f',
                            marginRight: 6,
                            verticalAlign: 'middle',
                        }}
                    />
                    {phoneOnline ? '已连接手机 ' + phones.length + ' 台，可发送' : '当前无在线设备，无法发送'}
                </span>
            </div>

            {/* 已连接手机列表（v26.10.06-v4）：显示数量与设备 ID；≥2 台时常驻多选，默认全选 */}
            {phones.length > 0 && (
                <div
                    style={{
                        border: '1px solid #f0f0f0',
                        borderRadius: 10,
                        padding: '10px 14px',
                        marginBottom: 12,
                    }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>已连接手机（{phones.length}）</div>
                    {phones.length > 1 ? (
                        <>
                            <Checkbox.Group
                                value={selected}
                                onChange={(v) => setSelected(v as string[])}
                                style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {phones.map((p) => (
                                    <Checkbox key={p.id} value={p.id}>
                                        {shortPhoneId(p.id)}
                                    </Checkbox>
                                ))}
                            </Checkbox.Group>
                            <Text type="secondary" style={{ fontSize: 11 }}>
                                默认全选；取消勾选后只发给勾选的手机。
                            </Text>
                        </>
                    ) : (
                        <Text style={{ fontSize: 12, wordBreak: 'break-all' }}>{shortPhoneId(phones[0].id)}</Text>
                    )}
                </div>
            )}

            {/* 发送到手机 */}
            <Section title="发送到手机">
                <div style={{ display: 'flex', gap: 8 }}>
                    <Input
                        placeholder="输入要发送到手机的文本…"
                        value={sendText}
                        onChange={(e) => setSendText(e.target.value)}
                        onPressEnter={doSendText}
                        style={{ flex: 1 }}
                    />
                    <Button
                        color="primary"
                        variant="solid"
                        disabled={!canSend}
                        loading={sending}
                        onClick={doSendText}
                        style={{ width: 84 }}>
                        发送
                    </Button>
                </div>

                {pendingImages.length > 0 && (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', margin: '14px 0 8px' }}>
                            <span style={{ fontSize: 13, color: '#595959' }}>待发送图片</span>
                            <span style={{ fontSize: 13, color: '#8c8c8c' }}>已选 {pendingImages.length} 张</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
                            {pendingImages.map((img, i) => (
                                <div
                                    key={img.url}
                                    style={{
                                        position: 'relative',
                                        paddingBottom: '86%',
                                        borderRadius: 10,
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
                                    <span
                                        title="移除这张"
                                        onClick={() => removePendingImage(i)}
                                        style={{
                                            position: 'absolute',
                                            top: 6,
                                            right: 6,
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
                    </>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                    <Button variant="dashed" disabled={!canSend} onClick={pickImages} style={{ flex: '1 1 0' }}>
                        ＋ 选择 / 添加图片（可多选）
                    </Button>
                    {pendingImages.length > 0 && (
                        <Button
                            color="primary"
                            variant="solid"
                            disabled={!canSend}
                            loading={sending}
                            onClick={confirmSendImage}
                            style={{ flex: '1.2 1 0' }}>
                            发送 {pendingImages.length} 张图片
                        </Button>
                    )}
                </div>

                {progress && (
                    <div style={{ marginTop: 12 }}>
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
            </Section>
        </Modal>
    );
}
