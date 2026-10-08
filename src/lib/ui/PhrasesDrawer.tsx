import { Button, Empty, Input, Spinner } from '../../../shared/ui/controls';
import { Tooltip } from '../../../shared/ui/feedback';
import { Drawer } from '../../../shared/ui/OverlayModal';
import { DEFAULTS } from '@/lib/constants';
import { addLog } from '@/lib/logger';
import { resolveGithubUrl, safeDecodeURIComponent } from '@/lib/utils';
import { appendToTinyMCE } from '@/lib/tinymce';
import { safeCopyText } from '@/lib/clipboard';
import { notify } from '@/lib/ui/notify';

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
 * 常用语侧边栏（v26.10.06-v14 改为 antd Drawer；v26.10.08-v14 改为自研 Drawer 基座）。
 *
 * 为什么它单独用抽屉：常用语是一份**长列表**（几十条，逐条一个按钮），
 * 弹窗要反复滚动、高度受限；侧边抽屉能用满整屏高度，且滑出时不遮挡右侧网页内容，
 * 更贴近「网页侧边栏」的用法。其余弹窗（设置/日志/设备互联/更新日志/收图）仍用弹窗，
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
        <Drawer open={open} title="常用语" size={360} onClose={onClose} bodyClassName="pt-3">
            <p className="mb-3 block text-xs leading-[18px] break-all text-muted-foreground">
                数据源: {safeDecodeURIComponent(resolveGithubUrl(commonPhrasesUrl || DEFAULTS.commonPhrasesUrl))}
            </p>

            <Button
                variant="primary"
                block
                loading={phrasesLoading}
                onClick={() => loadPhrasesData(true)}
                className="mb-3">
                重新加载常用语
            </Button>

            <Input
                placeholder="搜索常用语(按键名称或内容)"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="mb-3"
            />

            {phrasesLoading ? (
                <div className="flex items-center justify-center gap-2 py-5 text-muted-foreground">
                    <Spinner size={16} />
                    <span className="text-xs">加载中…</span>
                </div>
            ) : entries.length === 0 ? (
                <Empty description="暂无常用语数据，请点击上方按钮加载" />
            ) : filtered.length === 0 ? (
                <Empty description="没有匹配的常用语" />
            ) : (
                <div className="flex w-full flex-col gap-2">
                    {filtered.map(([key, value]) => (
                        /**
                         * hover 显示「标题对应的文本」（v26.10.08-v14 新增）：
                         * 常用语按钮只显示标题（key），正文（value）常常很长，
                         * 点下去才知道内容是什么 → 悬停即预览，省一次「点开又关掉」。
                         *
                         * ⚠️ Tooltip 放在按钮**外面**包着 Button（asChild 模式）：
                         *    若塞在按钮内部，浮层会被按钮的 overflow/层级裁掉。
                         * ⚠️ 同时给 title 属性做兜底：Tooltip 有 200ms 延迟，
                         *    而触屏/键盘用户等不到悬停，title 至少能在长按/聚焦时露出内容。
                         */
                        <Tooltip key={key} content={value}>
                            <Button
                                block
                                title={value}
                                className="justify-start text-left"
                                onClick={() => {
                                    safeCopyText(value);
                                    onClose();
                                    appendToTinyMCE(value);
                                    addLog(`添加文本: ${value}`, 'success');
                                    notify.success('添加文本: ' + value);
                                }}>
                                <span className="truncate">{key}</span>
                            </Button>
                        </Tooltip>
                    ))}
                </div>
            )}
        </Drawer>
    );
}
