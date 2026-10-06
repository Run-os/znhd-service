import { Modal, Button, Empty, Input, Space, Spin, Typography } from 'antd';
import { DEFAULTS } from '@/lib/constants';
import { addLog } from '@/lib/logger';
import { resolveGithubUrl, safeDecodeURIComponent } from '@/lib/utils';
import { appendToTinyMCE } from '@/lib/tinymce';
import { safeCopyText } from '@/lib/clipboard';
import { notify } from '@/lib/ui/notify';
import { getOverlayContainer } from '@/lib/ui/panelHost';

const { Text } = Typography;

export interface PhrasesModalProps {
    open: boolean;
    onClose: () => void;
    phrasesData: Record<string, string>;
    phrasesLoading: boolean;
    searchKeyword: string;
    setSearchKeyword: (v: string) => void;
    loadPhrasesData: (force?: boolean) => void;
    commonPhrasesUrl: string;
}

/**
 * 常用语弹窗（v26.10.06-v9：由 CAT_UI.Drawer 侧边抽屉改为 antd Modal 弹窗）。
 * 逻辑与旧实现一致：搜索过滤 → 点按钮复制 + 关闭 + 追加到 TinyMCE。
 */
export default function PhrasesModal({
    open,
    onClose,
    phrasesData,
    phrasesLoading,
    searchKeyword,
    setSearchKeyword,
    loadPhrasesData,
    commonPhrasesUrl,
}: PhrasesModalProps) {
    const keyword = searchKeyword.trim().toLowerCase();
    const entries = Object.entries(phrasesData || {});
    const filtered = keyword
        ? entries.filter(
              ([key, value]) =>
                  String(key).toLowerCase().includes(keyword) || String(value).toLowerCase().includes(keyword)
          )
        : entries;

    return (
        <Modal
            open={open}
            title="常用语"
            onCancel={onClose}
            getContainer={getOverlayContainer}
            width={520}
            destroyOnHidden
            footer={
                <Space>
                    <Button onClick={onClose}>关闭</Button>
                </Space>
            }>
            <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all', display: 'block', marginBottom: 12 }}>
                数据源: {safeDecodeURIComponent(resolveGithubUrl(commonPhrasesUrl || DEFAULTS.commonPhrasesUrl))}
            </Text>

            <Button
                color="primary"
                variant="solid"
                block
                loading={phrasesLoading}
                onClick={() => loadPhrasesData(true)}
                style={{ marginBottom: 12 }}>
                重新加载常用语
            </Button>

            <Input
                placeholder="搜索常用语(按键名称或内容)"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                allowClear
                style={{ marginBottom: 12 }}
            />

            {phrasesLoading ? (
                <div style={{ textAlign: 'center', padding: 20 }}>
                    <Spin /> <Text type="secondary">加载中…</Text>
                </div>
            ) : entries.length === 0 ? (
                <Empty description="暂无常用语数据，请点击上方按钮加载" />
            ) : filtered.length === 0 ? (
                <Empty description="没有匹配的常用语" />
            ) : (
                <Space orientation="vertical" size={8} style={{ width: '100%', maxHeight: '50vh', overflow: 'auto' }}>
                    {filtered.map(([key, value]) => (
                        <Button
                            key={key}
                            block
                            onClick={() => {
                                safeCopyText(value);
                                onClose();
                                appendToTinyMCE(value);
                                addLog(`添加文本: ${value}`, 'success');
                                notify.success('添加文本: ' + value);
                            }}>
                            {key}
                        </Button>
                    ))}
                </Space>
            )}
        </Modal>
    );
}
