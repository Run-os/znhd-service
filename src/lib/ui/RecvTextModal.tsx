import { useState } from 'react';
import { Button } from '../../../shared/ui/controls';
import { Modal } from '../../../shared/ui/OverlayModal';
import { safeCopyText } from '@/lib/clipboard';

export interface RecvTextModalProps {
    /** 收到的文本；null 表示不显示 */
    text: string | null;
    onClose: () => void;
}

/**
 * 收到文本的弹窗（v26.10.06-v13 改为 Modal；v26.10.08-v14 换自研 Modal 基座）。
 * 同屏只保留最新一条：新文本直接替换内容（旧实现会叠加多个全屏遮罩，关掉顶层会露出过期文本）。
 */
export default function RecvTextModal({ text, onClose }: RecvTextModalProps) {
    const [copied, setCopied] = useState('');

    const doCopy = () => {
        // 用 safeCopyText 的真实结果更新按钮文案：无可用途径 / 被拒绝时不再假显示「已复制」
        safeCopyText(text || '', (ok: boolean) => {
            setCopied(ok ? '✓ 已复制' : '复制失败，请长按文本手动复制');
        });
    };

    return (
        <Modal
            open={text !== null}
            title="收到电脑发来的文本"
            width={520}
            onClose={() => {
                setCopied('');
                onClose();
            }}
            footer={
                <>
                    <Button variant="primary" onClick={doCopy}>
                        {copied || '复制到剪贴板'}
                    </Button>
                    <Button
                        onClick={() => {
                            setCopied('');
                            onClose();
                        }}>
                        关闭
                    </Button>
                </>
            }>
            <pre className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.6]">
                {text || ''}
            </pre>
        </Modal>
    );
}
