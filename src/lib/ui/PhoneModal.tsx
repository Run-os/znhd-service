import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox, CheckboxGroup, Input, Progress, Tag } from '../../../shared/ui/controls';
import { Modal } from '../../../shared/ui/OverlayModal';
import { cn } from '../../../shared/ui/cn';
import { addLog } from '@/lib/logger';
import { safeCopyText } from '@/lib/clipboard';
import { RELAY_MAX_BODY, imagePayloadBytes, compressImageForPhone, getDeviceId, sendToPhone } from '@/lib/relay';
import { genQrDataUrl } from '@/lib/qrcode';

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

/**
 * 设备 ID 的专属配色（v26.10.08-v12：给设备 ID 加边框和彩色底色，不同设备不同色）。
 *
 * ⚠️ 用**固定色板 + 哈希取模**，而不是「由 ID 算 HSL」：后者在哈希相邻时会算出几乎一样的色相，
 *    多台手机并排时反而分不清。色板取同一组「浅底 / 中边框 / 深字」三档，
 *    保证浅色主题下文字对比度足够，也与面板整体配色语言一致。
 */
const DEVICE_COLORS = [
    { bg: '#e6f4ff', border: '#91caff', color: '#0958d9' }, // 蓝
    { bg: '#e6fffb', border: '#87e8de', color: '#08979c' }, // 青
    { bg: '#f6ffed', border: '#b7eb8f', color: '#389e0d' }, // 绿
    { bg: '#fffbe6', border: '#ffe58f', color: '#d48806' }, // 黄
    { bg: '#fff7e6', border: '#ffd591', color: '#d46b08' }, // 橙
    { bg: '#fff1f0', border: '#ffa39e', color: '#cf1322' }, // 红
    { bg: '#f9f0ff', border: '#d3adf7', color: '#531dab' }, // 紫
    { bg: '#fff0f6', border: '#ffadd2', color: '#c41d7f' }, // 洋红
];

/** 同一 ID 恒定取到同一个颜色（跨会话稳定）；不同 ID 尽量落到不同颜色 */
function hashDeviceId(id: string): number {
    // FNV-1a（32 位）：对「只差一个字符」的 ID 也敏感。
    // ⚠️ 别退回 `h = h * 31 + c`：实测两个只差首字符的 ID 会被 `>>>0` 截断成同一个下标，
    //    导致「不同设备不同底色」失效（本功能第一版就踩了）。
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

/**
 * 为一个**列表**解析「ID → 色板下标」，并把撞色的往后顺延。
 *
 * 为什么不能只用哈希：哈希再好也可能撞（实测「前缀重复字符」的 ID 会整批落到同一色），
 * 而用户要的是「不同设备 ID 不同底色」。故在列表内做贪心分配 ——
 * 设备数 ≤ 色板数（8）时**一定能拿到互不相同的颜色**。
 * 先按哈希排序再分配：谁拿哪个色只取决于 ID 集合，与 phones 的数组顺序无关。
 */
function resolveDeviceColors(ids: string[]): Record<string, number> {
    const out: Record<string, number> = {};
    const used = new Set<number>();
    const ordered = ids
        .filter(Boolean)
        .slice()
        .sort((a, b) => hashDeviceId(a) - hashDeviceId(b) || (a < b ? -1 : 1));
    for (const id of ordered) {
        let idx = hashDeviceId(id) % DEVICE_COLORS.length;
        for (let step = 0; step < DEVICE_COLORS.length && used.has(idx); step++) {
            idx = (idx + 1) % DEVICE_COLORS.length;
        }
        used.add(idx);
        out[id] = idx;
    }
    return out;
}

/** 带边框与专属底色的设备 ID 标签 */
function DeviceIdTag({ id, colorIndex }: { id: string; colorIndex?: number }) {
    const idx = typeof colorIndex === 'number' ? colorIndex : hashDeviceId(id) % DEVICE_COLORS.length;
    const c = DEVICE_COLORS[idx];
    return (
        <span
            data-device-id={id}
            data-color-index={idx}
            className="inline-block rounded-[6px] border px-2 leading-5"
            style={{ background: c.bg, borderColor: c.border, color: c.color }}>
            {shortPhoneId(id)}
        </span>
    );
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
        <div className="mb-3 rounded-[10px] border border-ink-6 px-3.5 py-3">
            <div className="mb-2.5 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{title}</span>
                {extra}
            </div>
            {children}
        </div>
    );
}

/**
 * 设备互联弹窗（v26.10.06-v17 按参考稿重排版式；v26.10.08-v14 换自研 Modal 基座）。
 *
 * 版式：标题「📱 手机互传 + 设备互联标签」→「电脑接收 · 本机专属链接」分区
 * （左二维码 + 右链接框 + 复制按钮；**按要求不放「重新生成」**）→ 居中的在线状态胶囊 →
 * 「发送到手机」分区（文本行 + 待发送图片行 + 虚线选图 + 发送按钮）。
 * 业务逻辑（二维码、在线轮询、逐张压缩发送、进度）与旧实现一致，只换样式载体。
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
    /** 设备 ID → 色板下标（列表内解决撞色，见 resolveDeviceColors） */
    const deviceColors = useMemo(() => resolveDeviceColors(phones.map((p) => p.id)), [phones]);

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
            width={560}
            onClose={onClose}
            title={
                <span className="inline-flex items-center">
                    📱 手机互传
                    <Tag className="ml-1.5">设备互联</Tag>
                </span>
            }
            footer={<Button onClick={onClose}>关闭</Button>}>
            {/* 电脑接收 · 本机专属链接 */}
            <Section
                title="电脑接收 · 本机专属链接"
                extra={
                    <Tag color="blue" className="font-normal">
                        手机扫码即上传
                    </Tag>
                }>
                {link ? (
                    <div className="flex items-start gap-3">
                        <div className="shrink-0 text-center">
                            {qrUrl ? (
                                <img
                                    src={qrUrl}
                                    alt="上传链接二维码"
                                    className="block border border-ink-6"
                                    style={{ width: 124, height: 124 }}
                                />
                            ) : (
                                <div
                                    className="flex items-center justify-center border border-ink-6 text-xs text-[#999]"
                                    style={{ width: 124, height: 124 }}>
                                    二维码生成中…
                                </div>
                            )}
                            <div className="mt-1.5 text-xs text-ink-3">扫一扫上传</div>
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="mb-1.5 text-xs text-ink-3">链接（复制到手机浏览器打开）</div>
                            <div
                                className="max-h-14 overflow-auto break-all rounded-[8px] border border-ink-5 bg-ink-8 px-2.5 py-1.5 text-[13px]"
                                style={{ wordBreak: 'break-all' }}>
                                {link}
                            </div>
                            <Button
                                variant="primary"
                                block
                                className="mt-2.5"
                                onClick={() => link && safeCopyText(link)}>
                                复制链接
                            </Button>
                        </div>
                    </div>
                ) : (
                    <span className="text-danger-600">尚未配置中继服务器，请到「设置」填写。</span>
                )}
            </Section>

            {/* 在线状态胶囊 */}
            <div className="mb-3 text-center">
                <span
                    className="inline-block rounded-2xl border px-4 py-1 text-[13px]"
                    style={
                        phoneOnline
                            ? { borderColor: '#b7eb8f', background: '#f6ffed', color: '#389e0d' }
                            : { borderColor: '#ffccc7', background: '#fff2f0', color: '#cf1322' }
                    }>
                    <span
                        className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                        style={{ background: phoneOnline ? '#52c41a' : '#ff4d4f' }}
                    />
                    {phoneOnline ? '已连接手机 ' + phones.length + ' 台，可发送' : '当前无在线设备，无法发送'}
                </span>
            </div>

            {/* 已连接手机列表（v26.10.06-v4）：显示数量与设备 ID；≥2 台时常驻多选，默认全选 */}
            {phones.length > 0 && (
                <div className="mb-3 rounded-[10px] border border-ink-6 px-3.5 py-2.5">
                    <div className="mb-1.5 text-[13px] font-semibold">已连接手机（{phones.length}）</div>
                    {phones.length > 1 ? (
                        <>
                            <CheckboxGroup>
                                {phones.map((p) => (
                                    <Checkbox
                                        key={p.id}
                                        checked={selected.indexOf(p.id) >= 0}
                                        onChange={(next) =>
                                            setSelected((prev) =>
                                                next ? prev.concat(p.id) : prev.filter((id) => id !== p.id)
                                            )
                                        }>
                                        <DeviceIdTag id={p.id} colorIndex={deviceColors[p.id]} />
                                    </Checkbox>
                                ))}
                            </CheckboxGroup>
                            <p className="mt-1.5 text-[11px] text-ink-3">默认全选；取消勾选后只发给勾选的手机。</p>
                        </>
                    ) : (
                        <DeviceIdTag id={phones[0].id} colorIndex={deviceColors[phones[0].id]} />
                    )}
                </div>
            )}

            {/* 发送到手机 */}
            <Section title="发送到手机">
                <div className="flex gap-2">
                    <Input
                        placeholder="输入要发送到手机的文本…"
                        value={sendText}
                        onChange={(e) => setSendText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') doSendText();
                        }}
                        className="flex-1"
                    />
                    <Button
                        variant="primary"
                        disabled={!canSend}
                        loading={sending}
                        onClick={doSendText}
                        className="w-[84px] shrink-0">
                        发送
                    </Button>
                </div>

                {pendingImages.length > 0 && (
                    <>
                        <div className="mb-2 mt-3.5 flex items-center justify-between">
                            <span className="text-[13px] text-ink-2">待发送图片</span>
                            <span className="text-[13px] text-ink-3">已选 {pendingImages.length} 张</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {pendingImages.map((img, i) => (
                                <div
                                    key={img.url}
                                    className="relative overflow-hidden rounded-[10px] bg-[#f2f2f2]"
                                    style={{ paddingBottom: '86%' }}>
                                    <img
                                        src={img.url}
                                        alt={img.name}
                                        className="absolute inset-0 h-full w-full object-cover"
                                    />
                                    <span
                                        title="移除这张"
                                        onClick={() => removePendingImage(i)}
                                        className="absolute right-1.5 top-1.5 h-5 w-5 cursor-pointer select-none rounded-full bg-black/55 text-center text-[13px] leading-5 text-white"
                                        style={{ cursor: sending ? 'not-allowed' : 'pointer' }}>
                                        ×
                                    </span>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                <div className="mt-3.5 flex gap-2">
                    <Button variant="dashed" disabled={!canSend} onClick={pickImages} className="flex-[1_1_0]">
                        ＋ 选择 / 添加图片（可多选）
                    </Button>
                    {pendingImages.length > 0 && (
                        <Button
                            variant="primary"
                            disabled={!canSend}
                            loading={sending}
                            onClick={confirmSendImage}
                            className="flex-[1.2_1_0]">
                            发送 {pendingImages.length} 张图片
                        </Button>
                    )}
                </div>

                {progress && (
                    <div className="mt-3">
                        <Progress percent={percent} status={progress.failed ? 'exception' : 'normal'} />
                        <p className={cn('mt-1 text-xs', progress.failed ? 'text-danger-600' : 'text-ink-3')}>
                            {progress.text}
                        </p>
                    </div>
                )}
            </Section>
        </Modal>
    );
}
