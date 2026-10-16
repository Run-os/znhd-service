import { useEffect, useMemo, useState } from 'react';
import { Button, Tag, Typography, theme } from 'antd';
import { safeCopyText } from '@/lib/clipboard';
import { addLog } from '@/lib/logger';
import { getDeviceId, sendTestImage, TEST_IMAGE_URL } from '@/lib/relay';
import { genQrDataUrl } from '@/lib/qrcode';
import { SmartphoneIcon } from '@/lib/ui/icons';
import DeviceIdTag from '@/lib/ui/transfer/DeviceIdTag';
import { resolveDeviceColors } from '@/lib/ui/transfer/deviceColors';
import type { PhoneInfo } from '@/lib/transfer/types';

const { Text } = Typography;

/**
 * 配对面板正文（v26.10.17-v1，从 TransferPairModal 抽出的可复用内容）：
 * 二维码 / 链接、在线状态、已连接手机列表、发送测试图片。
 *
 * 两个使用方：
 *  - TransferPairModal（第二栏「＋」弹窗，带标题与底部按钮）；
 *  - TransferAssistantModal 第三栏空状态（未选中会话时直接展示配对信息，
 *    用户不再看到「选择一个会话」的纯提示）。
 */
export default function TransferPairPanel({
    relayServer,
    phones,
}: {
    /** 中继地址（来自传输助手自有设置） */
    relayServer: string;
    /** 在线手机列表（store 的轮询结果） */
    phones: PhoneInfo[];
}) {
    const { token } = theme.useToken();
    const deviceId = getDeviceId();
    const [qrUrl, setQrUrl] = useState('');
    const [link, setLink] = useState('');
    /** 「发送测试图片」是否正在取图/投递（防重复点击 + 按钮 loading） */
    const [testSending, setTestSending] = useState(false);

    /** 设备 ID → 色板下标（列表内解决撞色，见 resolveDeviceColors） */
    const deviceColors = useMemo(() => resolveDeviceColors(phones.map((p) => p.id)), [phones]);
    const phoneOnline = phones.length > 0;

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
            .catch((e: { message?: string }) => {
                addLog('[配对] 二维码失败: ' + (e && e.message), 'error', true);
            });
    }, [relayServer, deviceId]);

    /**
     * 「发送测试图片」：从 `TEST_IMAGE_URL` 取一张随机图，**当作手机上传**投递到
     * 中继 `/u/<本机 deviceId>`，再经正常的「手机 → 电脑」通道回到本脚本、进对应会话。
     * ⚠️ 需要先配置中继地址（未配置时 sendTestImage 会直接失败并给出提示，不发请求）。
     */
    const doSendTestImage = () => {
        if (testSending) return;
        setTestSending(true);
        addLog('[测试图片] 正在从 ' + TEST_IMAGE_URL + ' 取图并投递到本机…', 'info');
        sendTestImage({
            server: relayServer,
            uuid: deviceId,
            onOk: (info) => {
                setTestSending(false);
                addLog(
                    '[测试图片] 已投递（' +
                        info.mime +
                        '，约 ' +
                        Math.max(1, Math.round(info.bytes / 1024)) +
                        'KB），片刻后会出现在会话里',
                    'success'
                );
            },
            onFail: (msg) => {
                setTestSending(false);
                addLog('[测试图片] 失败：' + msg, 'error', true);
            },
        });
    };

    return (
        <div style={{ width: '100%', maxWidth: 560, padding: '16px 18px', overflow: 'auto', margin: 'auto' }}>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 12,
                }}>
                <span
                    style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 14,
                        fontWeight: 600,
                    }}>
                    <SmartphoneIcon size={16} />
                    配对设备
                </span>
                <Tag style={{ margin: 0, fontWeight: 400 }} color="default">
                    手机扫码即配对
                </Tag>
            </div>

            {/* 电脑接收 · 本机专属链接 */}
            <div
                style={{
                    border: '1px solid ' + token.colorBorderSecondary,
                    borderRadius: 10,
                    padding: '12px 14px',
                    marginBottom: 12,
                }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        marginBottom: 10,
                    }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>电脑接收 · 本机专属链接</span>
                    <Tag color="blue" style={{ margin: 0, fontWeight: 400 }}>
                        手机扫码即上传
                    </Tag>
                </div>
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
                                        border: '1px solid ' + token.colorBorderSecondary,
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
                                        border: '1px solid ' + token.colorBorderSecondary,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: token.colorTextQuaternary,
                                        fontSize: 12,
                                    }}>
                                    二维码生成中…
                                </div>
                            )}
                            <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 6 }}>扫一扫上传</div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 6 }}>
                                链接（复制到手机浏览器打开）
                            </div>
                            <div
                                style={{
                                    border: '1px solid ' + token.colorBorder,
                                    borderRadius: 8,
                                    padding: '7px 10px',
                                    fontSize: 13,
                                    wordBreak: 'break-all',
                                    background: token.colorFillQuaternary,
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
                    <Text type="danger">尚未配置中继服务器，请到第一栏「设置」填写。</Text>
                )}
            </div>

            {/* 在线状态胶囊 */}
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <span
                    style={{
                        display: 'inline-block',
                        border: '1px solid ' + (phoneOnline ? token.colorSuccessBorder : token.colorErrorBorder),
                        background: phoneOnline ? token.colorSuccessBg : token.colorErrorBg,
                        color: phoneOnline ? token.colorSuccess : token.colorError,
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
                            background: phoneOnline ? token.colorSuccess : token.colorError,
                            marginRight: 6,
                            verticalAlign: 'middle',
                        }}
                    />
                    {phoneOnline ? '已连接手机 ' + phones.length + ' 台，可收发' : '当前无在线设备，暂不可收发'}
                </span>
            </div>

            {/* 已连接手机列表（informational：发送目标按会话选，不在这里勾选） */}
            {phones.length > 0 && (
                <div
                    style={{
                        border: '1px solid ' + token.colorBorderSecondary,
                        borderRadius: 10,
                        padding: '10px 14px',
                        marginBottom: 12,
                    }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>已连接手机（{phones.length}）</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {phones.map((p) => (
                            <DeviceIdTag key={p.id || 'unknown'} id={p.id} colorIndex={deviceColors[p.id]} />
                        ))}
                    </div>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                        在左侧「设备」分组点对应手机即可进入会话；发给谁由所在会话决定。
                    </Text>
                </div>
            )}

            {/* 测试图片（原来在弹窗 footer 的按钮，面板内联在内容底部） */}
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <Button loading={testSending} onClick={doSendTestImage}>
                    发送测试图片
                </Button>
            </div>
        </div>
    );
}
