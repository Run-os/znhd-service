import { Modal } from 'antd';
import { getOverlayContainer } from '@/lib/ui/panelHost';
import { SmartphoneIcon } from '@/lib/ui/icons';
import TransferPairPanel from '@/lib/ui/transfer/TransferPairPanel';
import type { PhoneInfo } from '@/lib/transfer/types';

/**
 * 配对窗口（v26.10.12-v1，由原「设备互联」弹窗的配对部分搬迁而来）。
 *
 * 入口统一收在第二栏搜索框右侧的「+」按钮（不再散落在主面板）。本窗口只负责
 * **配对与连通性验证**：二维码 / 链接、在线状态、已连接手机列表、发送测试图片。
 * 真正的收发（文本 / 图片）在右侧聊天区按会话进行，不在这里。
 *
 * ⚠️ v26.10.17-v1：正文内容抽到 `TransferPairPanel`（第三栏未选中会话时的空状态
 * 也复用同一份配对信息），本组件只剩弹窗壳：标题 + 底部按钮。
 */
export default function TransferPairModal({
    open,
    onClose,
    relayServer,
    phones,
}: {
    open: boolean;
    onClose: () => void;
    /** 中继地址（来自传输助手自有设置） */
    relayServer: string;
    /** 在线手机列表（store 的轮询结果） */
    phones: PhoneInfo[];
}) {
    return (
        <Modal
            open={open}
            title={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <SmartphoneIcon size={16} />
                    配对设备
                </span>
            }
            onCancel={onClose}
            getContainer={getOverlayContainer}
            // v26.10.12-v5：小窗口垂直居中（默认 top:100px 会顶到传输助手窗口上沿）
            centered
            width={520}
            destroyOnHidden
            footer={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ flex: '1 1 auto' }} />
                    <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>手机扫码即配对</span>
                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            border: 'none',
                            borderRadius: 6,
                            padding: '4px 14px',
                            cursor: 'pointer',
                            background: 'rgba(255,255,255,0.12)',
                            color: '#fff',
                            fontSize: 13,
                        }}>
                        关闭
                    </button>
                </div>
            }>
            <TransferPairPanel relayServer={relayServer} phones={phones} />
        </Modal>
    );
}
