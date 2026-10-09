import { useEffect, useState } from 'react';
import { Modal, Button, Empty, Space, Spin, Typography } from 'antd';
import {
    CHANGELOG_DEFAULT_LIMIT,
    CHANGELOG_PAGE_URL,
    loadChangelog,
    mdToPlain,
    type ChangelogEntry,
} from '@/lib/changelog';
import { getOverlayContainer } from '@/lib/ui/panelHost';

const { Text } = Typography;

export interface ChangelogModalProps {
    open: boolean;
    onClose: () => void;
}

/**
 * 更新日志弹窗（v26.10.06-v13：由原 DOM 弹窗改为 antd Modal）。
 * 拉取/解析逻辑仍在 `lib/changelog.ts`（保持可测试的纯函数），这里只管渲染。
 */
export default function ChangelogModal({ open, onClose }: ChangelogModalProps) {
    const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
    const [err, setErr] = useState<string>('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!open) return;
        let alive = true;
        setLoading(true);
        setErr('');
        loadChangelog((list, errMsg) => {
            if (!alive) return;
            setLoading(false);
            if (!list) {
                setErr(errMsg || '未知错误');
                return;
            }
            setEntries(list);
        });
        return () => {
            alive = false;
        };
    }, [open]);

    const shown = entries ? entries.slice(0, CHANGELOG_DEFAULT_LIMIT) : [];

    return (
        <Modal
            open={open}
            title={'更新日志（最新 ' + CHANGELOG_DEFAULT_LIMIT + ' 条）'}
            onCancel={onClose}
            getContainer={getOverlayContainer}
            width={620}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            footer={
                <Space>
                    <Button onClick={() => window.open(CHANGELOG_PAGE_URL, '_blank')}>获取更多日志</Button>
                    <Button color="primary" variant="solid" onClick={onClose}>
                        关闭
                    </Button>
                </Space>
            }>
            {loading ? (
                <div style={{ textAlign: 'center', padding: 24 }}>
                    <Spin /> <Text type="secondary">读取中…</Text>
                </div>
            ) : err ? (
                <>
                    <Text type="danger">读取失败：{err}</Text>
                    <div style={{ marginTop: 8 }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            可点下方「获取更多日志」在浏览器中打开 CHANGELOG.md 查看。
                        </Text>
                    </div>
                </>
            ) : !entries || entries.length === 0 ? (
                <Empty description="暂无更新日志" />
            ) : (
                <>
                    <div style={{ maxHeight: '60vh', overflow: 'auto', paddingRight: 4 }}>
                        {shown.map((en) => (
                            <div key={en.title} style={{ marginBottom: 14 }}>
                                <div style={{ fontSize: 14, fontWeight: 'bold', color: '#1890ff', marginBottom: 6 }}>
                                    {en.title}
                                </div>
                                <div
                                    style={{
                                        fontSize: 13,
                                        lineHeight: 1.6,
                                        color: '#333',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                    }}>
                                    {mdToPlain(en.body)}
                                </div>
                            </div>
                        ))}
                    </div>
                    <Text
                        type="secondary"
                        style={{ fontSize: 12, display: 'block', marginTop: 8, textAlign: 'center' }}>
                        {entries.length > shown.length
                            ? '共 ' + entries.length + ' 条，已显示最新 ' + shown.length + ' 条'
                            : '共 ' + entries.length + ' 条（已全部显示）'}
                    </Text>
                </>
            )}
        </Modal>
    );
}
