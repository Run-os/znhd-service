import { Button, Modal, Typography } from 'antd';
import { theme } from 'antd';
import { getDeviceId } from '@/lib/relay';
import { safeCopyText } from '@/lib/clipboard';
import { getOverlayContainer } from '@/lib/ui/panelHost';
import DeviceIdTag from '@/lib/ui/transfer/DeviceIdTag';
import { resolveDeviceColors } from '@/lib/ui/transfer/deviceColors';
import { useTransferStore } from '@/lib/transfer/store';
import { CopyIcon } from '@/lib/ui/icons';

const { Text } = Typography;

/** 一行「标签 — 值」 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid rgba(128,128,128,0.12)' }}>
            <span style={{ flex: '0 0 92px', fontSize: 13, color: 'inherit', opacity: 0.65 }}>{label}</span>
            <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 13, wordBreak: 'break-all' }}>{children}</span>
        </div>
    );
}

/**
 * 企业信息（v26.10.12-v1）：传输助手第一栏底部入口。
 *
 * 对齐企业微信桌面端的「企业信息」：展示本助手的运行环境（中继地址、本机设备 ID、
 * 在线手机、脚本版本），便于排查「连不上」时先确认这几项。
 */
export default function TransferAboutModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { token } = theme.useToken();
    const s = useTransferStore();
    const deviceId = getDeviceId();
    const colors = resolveDeviceColors(s.phones.map((p) => p.id));

    return (
        <Modal
            open={open}
            title="企业信息"
            onCancel={onClose}
            getContainer={getOverlayContainer}
            // v26.10.12-v5：小窗口垂直居中（默认 top:100px 会顶到传输助手窗口上沿）
            centered
            width={440}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            footer={
                <Button color="primary" variant="solid" onClick={onClose}>
                    关闭
                </Button>
            }>
            <Row label="中继服务器">{s.settings.relayServer || '（未配置）'}</Row>
            <Row label="本机设备">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <DeviceIdTag id={deviceId} />
                    <span style={{ fontSize: 11, opacity: 0.65 }}>{deviceId}</span>
                    <Button
                        size="small"
                        type="text"
                        aria-label="复制设备 ID"
                        title="复制设备 ID"
                        style={{ color: token.colorTextTertiary }}
                        onClick={() => safeCopyText(deviceId)}>
                        <CopyIcon size={13} />
                    </Button>
                </span>
            </Row>
            <Row label="在线手机">
                {s.phones.length ? (
                    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                        {s.phones.map((p) => (
                            <DeviceIdTag key={p.id || 'unknown'} id={p.id} colorIndex={colors[p.id]} />
                        ))}
                        <span style={{ fontSize: 11, opacity: 0.65 }}>共 {s.phones.length} 台</span>
                    </span>
                ) : (
                    <Text type="secondary">暂无（手机端打开本机链接后出现）</Text>
                )}
            </Row>
            <Row label="脚本版本">{(GM_info.script && GM_info.script.version) || '未知'}</Row>
            <Row label="项目主页">
                <Button
                    type="link"
                    style={{ padding: 0, height: 'auto' }}
                    onClick={() => window.open('https://github.com/Run-os/znhd-service', '_blank')}>
                    github.com/Run-os/znhd-service
                </Button>
            </Row>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
                提示：排查「连不上」时先看这里 —— 中继地址是否可达、手机是否出现在在线列表里；
                会话记录保存在本机（IndexedDB），仅保留最近 7 天，超期自动清理。
            </Text>
        </Modal>
    );
}
