import { useEffect, useState } from 'react';
import { Button, Input, Modal, Popconfirm, Switch, Typography } from 'antd';
import { theme } from 'antd';
import { addLog } from '@/lib/logger';
import { DEFAULT_RELAY_SERVER } from '@/lib/transfer/settings';
import { clearAllTransferFiles, updateTransferSettings, useTransferStore } from '@/lib/transfer/store';
import { getOverlayContainer } from '@/lib/ui/panelHost';

const { Text } = Typography;

/**
 * 传输助手的**独立设置面板**（v26.10.12-v1）。
 *
 * 与 App 主面板的「设置菜单」完全分开（用户要求：数据、入口、UI 均不共用）：
 *   · 数据落在 `scriptCat_TransferSettings`，不写主设置的 `scriptCat_Allvalue`；
 *   · 入口在第一栏底部「设置」，主面板设置菜单里不再有中继地址。
 *
 * 中继地址用**草稿 + 失焦/回车提交**：`updateTransferSettings` 在地址变化时会重启
 * 轮询与长轮询（stop → start），如果逐字提交，输入 "https://…" 的每个合法前缀都会
 * 触发一次重连（原主面板设置是逐字提交的，那里只有一处地址框，影响面小）。
 */
export default function TransferSettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { token } = theme.useToken();
    const s = useTransferStore();
    const settings = s.settings;

    const [relayDraft, setRelayDraft] = useState(settings.relayServer);

    // 打开时把当前值灌进草稿；提交后 settings.relayServer 变化会同步回来（与草稿相同，无感）
    useEffect(() => {
        if (open) setRelayDraft(settings.relayServer);
    }, [open, settings.relayServer]);

    /** 提交草稿（去首尾空白 + 尾斜杠后与现值比较，相同则 store 自己会跳过） */
    const commitRelay = (val: string) => {
        const url = (val || '').trim().replace(/\/+$/, '');
        if (url && url !== settings.relayServer) updateTransferSettings({ relayServer: url });
    };

    /** 关闭前把未提交的草稿补交（点 X / 遮罩关闭时输入框不一定失焦） */
    const closeWithCommit = () => {
        commitRelay(relayDraft);
        onClose();
    };

    return (
        <Modal
            open={open}
            title="传输助手设置"
            onCancel={closeWithCommit}
            getContainer={getOverlayContainer}
            // v26.10.12-v5：小窗口垂直居中（默认 top:100px 会顶到传输助手窗口上沿）
            centered
            width={480}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            footer={
                <Button color="primary" variant="solid" onClick={closeWithCommit}>
                    完成
                </Button>
            }>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
                中继服务器地址
            </Text>
            <Input
                placeholder="https://你的服务器:端口"
                value={relayDraft}
                onChange={(e) => setRelayDraft(e.target.value)}
                onBlur={(e) => {
                    const url = (e.target.value || '').trim();
                    if (!url) {
                        // 清空并失焦 → 回填默认地址（与主面板常用语地址同一交互）
                        setRelayDraft(DEFAULT_RELAY_SERVER);
                        commitRelay(DEFAULT_RELAY_SERVER);
                    } else {
                        commitRelay(url);
                    }
                }}
                onPressEnter={(e) => commitRelay((e.target as HTMLInputElement).value)}
                allowClear
                style={{ marginBottom: 8 }}
            />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
                手机上传的图片 / 文本经此服务器转发到本机。修改后点其他区域或按回车生效；留空失焦恢复默认地址。
            </Text>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text strong>收到内容时自动打开传输助手</Text>
                <Switch
                    checked={settings.autoOpenOnReceive}
                    onChange={(v) => updateTransferSettings({ autoOpenOnReceive: v })}
                />
            </div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 16 }}>
                关闭时仅累计未读角标，不打扰；窗口已开着则只累加，不强行切换会话。
            </Text>

            <div style={{ borderTop: '1px solid ' + token.colorBorderSecondary, paddingTop: 12 }}>
                <Popconfirm
                    title="清空全部传输记录"
                    description="所有会话的图片与文本都会被移除（仅清理本机内存，不影响手机上的文件）"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => {
                        clearAllTransferFiles();
                        addLog('[传输助手] 已清空全部传输记录', 'success');
                    }}>
                    <Button danger>清空全部传输记录</Button>
                </Popconfirm>
            </div>
        </Modal>
    );
}
