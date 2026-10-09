import { Button, Drawer, Empty, Input, Space, Spin, Tooltip, Typography } from 'antd';
import { DEFAULTS } from '@/lib/constants';
import { addLog } from '@/lib/logger';
import { resolveGithubUrl, safeDecodeURIComponent } from '@/lib/utils';
import { appendToTinyMCE } from '@/lib/tinymce';
import { safeCopyText } from '@/lib/clipboard';
import { notify } from '@/lib/ui/notify';
import { getOverlayContainer } from '@/lib/ui/panelHost';

const { Text } = Typography;

export interface PhrasesDrawerProps {
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
 * 常用语侧边栏（v26.10.06-v14：由 antd Modal 改为 antd **Drawer**）。
 *
 * 为什么它单独用 Drawer：常用语是一份**长列表**（几十条，逐条一个按钮），
 * 弹窗要反复滚动、高度受限；侧边抽屉能用满整屏高度，且滑出时不遮挡右侧网页内容，
 * 更贴近「网页侧边栏」的用法。其余弹窗（设置/日志/设备互联/更新日志/收图）仍用 Modal，
 * 因为它们是「一次性确认型」交互。
 *
 * 逻辑与旧实现一致：搜索过滤 → 点按钮复制 + 关闭 + 追加到 TinyMCE。
 */
export default function PhrasesDrawer({
    open,
    onClose,
    phrasesData,
    phrasesLoading,
    searchKeyword,
    setSearchKeyword,
    loadPhrasesData,
    commonPhrasesUrl,
}: PhrasesDrawerProps) {
    const keyword = searchKeyword.trim().toLowerCase();
    const entries = Object.entries(phrasesData || {});
    const filtered = keyword
        ? entries.filter(
              ([key, value]) =>
                  String(key).toLowerCase().includes(keyword) || String(value).toLowerCase().includes(keyword)
          )
        : entries;

    return (
        <Drawer
            open={open}
            title="常用语"
            placement="right" // 网页侧边栏习惯：从右侧滑出
            size={360} // v6 中 `width` 已弃用，改用 size（number | string | 'default' | 'large'）
            onClose={onClose}
            getContainer={getOverlayContainer}
            styles={{ body: { textAlign: 'left', paddingTop: 12 } }}
            destroyOnHidden>
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
                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                    {filtered.map(([key, value]) => (
                        /**
                         * hover 显示**正文**（v26.10.09-v4 新增，按用户要求）。
                         *
                         * 为什么值得加：按钮上只放标题（key），而常用语正文（value）常是整段话 ——
                         * 不 hover 的话只能「点下去才知道内容是什么」，点错就得关窗重来。
                         *
                         * ⚠️ 三个取值都不是随手写的：
                         *   · `placement="left"`：抽屉贴右侧，提示向左展开才不会顶出视口。
                         *   · `styles.root.maxWidth`：不给上限时长正文会拉成一条超长单行（很难读）。
                         *   · `styles.container.textAlign: 'left'`：提示 portal 到 `documentElement`
                         *     （见 PanelApp 的 getPopupContainer），**不在** `.znhd-root` 隔离层里，
                         *     税务页的全局 `text-align: center` 会把正文居中 —— 必须显式压回来。
                         *
                         * ⚠️ 这里**不**再额外挂原生 `title`：antd Tooltip 与浏览器原生提示会同时弹两个。
                         *     键盘可达性由 Tooltip 默认的 `hover + focus` 触发覆盖。
                         */
                        <Tooltip
                            key={key}
                            title={value}
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
                                onClick={() => {
                                    safeCopyText(value);
                                    onClose();
                                    appendToTinyMCE(value);
                                    addLog(`添加文本: ${value}`, 'success');
                                    notify.success('添加文本: ' + value);
                                }}>
                                {key}
                            </Button>
                        </Tooltip>
                    ))}
                </Space>
            )}
        </Drawer>
    );
}
