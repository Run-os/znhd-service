import { useState } from 'react';
import { Button, Modal, Space } from 'antd';
import { safeCopyText } from '@/lib/clipboard';
import { getOverlayContainer } from '@/lib/ui/panelHost';
import { CheckIcon } from '@/lib/ui/icons';

export interface RecvTextModalProps {
    /** 收到的文本；null 表示不显示 */
    text: string | null;
    onClose: () => void;
}

/**
 * 收到文本的弹窗（v26.10.06-v13：由原 DOM 覆盖层改为 antd Modal）。
 * 同屏只保留最新一条：新文本直接替换内容（旧实现会叠加多个全屏遮罩，关掉顶层会露出过期文本）。
 */
export default function RecvTextModal({ text, onClose }: RecvTextModalProps) {
    // 复制反馈：'' = 未复制（按钮显示「复制到剪贴板」），'ok' / 'fail' = 两种结果。
    // ⚠️ v26.10.09-v7：原为直接存文案字符串（含 `✓` U+2713，Dingbats 在 Win7 字形覆盖不确定）。
    // 现在只存状态、由 JSX 渲染内联 SVG 图标，文案不再依赖任何字体字形。
    const [copied, setCopied] = useState<'' | 'ok' | 'fail'>('');

    const doCopy = () => {
        // 用 safeCopyText 的真实结果更新按钮文案：无可用途径 / 被拒绝时不再假显示「已复制」
        safeCopyText(text || '', (ok: boolean) => {
            setCopied(ok ? 'ok' : 'fail');
        });
    };

    return (
        <Modal
            open={text !== null}
            title="收到电脑发来的文本"
            onCancel={() => {
                setCopied('');
                onClose();
            }}
            getContainer={getOverlayContainer}
            width={520}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            footer={
                <Space>
                    <Button color="primary" variant="solid" onClick={doCopy}>
                        {copied === 'ok' ? (
                            <>
                                <CheckIcon size={13} /> 已复制
                            </>
                        ) : copied === 'fail' ? (
                            '复制失败，请长按文本手动复制'
                        ) : (
                            '复制到剪贴板'
                        )}
                    </Button>
                    <Button
                        onClick={() => {
                            setCopied('');
                            onClose();
                        }}>
                        关闭
                    </Button>
                </Space>
            }>
            <pre
                style={{
                    margin: 0,
                    maxHeight: '60vh',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'inherit',
                    fontSize: 15,
                    lineHeight: 1.6,
                }}>
                {text || ''}
            </pre>
        </Modal>
    );
}
