import { Button, Drawer, Empty, Input, Space, Spin, Tabs, Tooltip, Typography } from 'antd';
import { RefreshIcon } from '@/lib/ui/icons';
import { addLog } from '@/lib/logger';
import { appendToTinyMCE } from '@/lib/tinymce';
import { safeCopyText } from '@/lib/clipboard';
import { notify } from '@/lib/ui/notify';
import { getOverlayContainer } from '@/lib/ui/panelHost';
import type { ZnhdPhrases } from '@/lib/phrasesZnhd';

const { Text } = Typography;

export interface PhrasesDrawerProps {
    open: boolean;
    onClose: () => void;
    /** v26.10.18-v2：两组话术（全部话术 / 我的话术），来自本页「常用话术」程序化抓取 */
    phrasesData: ZnhdPhrases;
    phrasesLoading: boolean;
    searchKeyword: string;
    setSearchKeyword: (v: string) => void;
    /** force=true 时无视缓存直接重新抓取（刷新按钮） */
    loadPhrasesData: (force?: boolean) => void;
}

/** 单条话术按钮：最多两行截断，hover 弹完整正文，点击复制并填输入框 */
function PhraseItem({ text, onPick }: { text: string; onPick: (t: string) => void }) {
    return (
        <Tooltip
            title={text}
            placement="left"
            // 默认 0.1s 在快速划过一整列按钮时会「一路连弹」，稍微放缓
            mouseEnterDelay={0.15}
            styles={{
                root: { maxWidth: 360 },
                container: {
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    textAlign: 'left',
                },
            }}>
            <Button
                block
                onClick={() => onPick(text)}
                style={{
                    textAlign: 'left',
                    whiteSpace: 'normal',
                    height: 'auto',
                    minHeight: 32,
                    padding: '4px 12px',
                }}>
                <span
                    style={{
                        // 最多两行：-webkit-line-clamp 是 Chrome 88+/Firefox 85+/Safari 14+ 全支持的老标准前缀写法
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                    }}>
                    {text}
                </span>
            </Button>
        </Tooltip>
    );
}

/**
 * 常用语侧边栏（v26.10.06-v14：由 antd Modal 改为 antd **Drawer**）。
 *
 * 为什么它单独用 Drawer：常用语是一份**长列表**，弹窗要反复滚动、高度受限；
 * 侧边抽屉能用满整屏高度，且滑出时不遮挡右侧网页内容。
 *
 * v26.10.18-v2 重构：
 *  - 数据源 = 本页右侧栏「常用话术」（程序化抓取，见 lib/phrasesZnhd.ts），不再是腾讯文档/YAML；
 *  - 「重新加载常用语」大按钮改为标题旁**右对齐的 SVG 刷新图标**（aria-label="重新加载常用语"）；
 *  - 内容分 **全部话术 / 我的话术** 两个 tab；每条按钮最多两行，hover 看全文，点击复制并填输入框。
 *
 * 逻辑不变的部分：搜索过滤 → 点按钮复制 + 关闭 + 追加到 TinyMCE。
 */
export default function PhrasesDrawer({
    open,
    onClose,
    phrasesData,
    phrasesLoading,
    searchKeyword,
    setSearchKeyword,
    loadPhrasesData,
}: PhrasesDrawerProps) {
    const keyword = searchKeyword.trim().toLowerCase();
    const hit = (t: string) => !keyword || t.toLowerCase().includes(keyword);
    const all = (phrasesData.all || []).filter(hit);
    const mine = (phrasesData.mine || []).filter(hit);

    const pick = (text: string) => {
        safeCopyText(text);
        onClose();
        appendToTinyMCE(text);
        addLog(`添加文本: ${text}`, 'success');
        notify.success('添加文本: ' + text);
    };

    /** 单个 tab 的列表内容（加载中 / 空 / 列表三态共用） */
    const listBody = (items: string[], emptyTip: string) => {
        if (phrasesLoading) {
            return (
                <div style={{ textAlign: 'center', padding: 20 }}>
                    <Spin /> <Text type="secondary">正在抓取常用话术…（右侧栏会自动切 tab，请勿操作）</Text>
                </div>
            );
        }
        if (!items.length) {
            return <Empty description={emptyTip} />;
        }
        return (
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                {items.map((t, i) => (
                    <PhraseItem key={i} text={t} onPick={pick} />
                ))}
            </Space>
        );
    };

    return (
        <Drawer
            open={open}
            title="常用语"
            placement="right" // 网页侧边栏习惯：从右侧滑出
            size={360} // v6 中 `width` 已弃用，改用 size（number | string | 'default' | 'large'）
            onClose={onClose}
            getContainer={getOverlayContainer}
            styles={{ body: { textAlign: 'left', paddingTop: 12 } }}
            destroyOnHidden
            extra={
                // 标题栏右侧的刷新按钮（v26.10.18-v2，替代原「重新加载常用语」大按钮）：
                // 无文字图标 + aria-label（读屏 / 冒烟夹具都靠它定位）
                <Button
                    type="text"
                    aria-label="重新加载常用语"
                    loading={phrasesLoading}
                    icon={<RefreshIcon size={16} />}
                    onClick={() => loadPhrasesData(true)}>
                    {''}
                </Button>
            }>
            <Input
                placeholder="搜索常用语(按内容)"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                allowClear
                style={{ marginBottom: 12 }}
            />

            <Tabs
                defaultActiveKey="all"
                items={[
                    { key: 'all', label: '全部话术', children: listBody(all, '暂无全部话术，点右上角刷新抓取') },
                    { key: 'mine', label: '我的话术', children: listBody(mine, '暂无我的话术，点右上角刷新抓取') },
                ]}
            />
        </Drawer>
    );
}
