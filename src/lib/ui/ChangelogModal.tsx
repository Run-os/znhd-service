import { useEffect, useState } from 'react';
import { Button, Empty, Spinner } from '../../../shared/ui/controls';
import { Modal } from '../../../shared/ui/OverlayModal';
import {
    CHANGELOG_DEFAULT_LIMIT,
    CHANGELOG_PAGE_URL,
    loadChangelog,
    mdToPlain,
    type ChangelogEntry,
} from '@/lib/changelog';

export interface ChangelogModalProps {
    open: boolean;
    onClose: () => void;
}

/**
 * 更新日志弹窗（v26.10.06-v13 改为弹窗；v26.10.08-v14 换自研 Modal 基座）。
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
            width={620}
            onClose={onClose}
            footer={
                <>
                    <Button onClick={() => window.open(CHANGELOG_PAGE_URL, '_blank')}>获取更多日志</Button>
                    <Button variant="primary" onClick={onClose}>
                        关闭
                    </Button>
                </>
            }>
            {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-ink-3">
                    <Spinner size={16} />
                    <span className="text-xs">读取中…</span>
                </div>
            ) : err ? (
                <>
                    <p className="text-danger-600">读取失败：{err}</p>
                    <p className="mt-2 text-xs text-ink-3">
                        可点下方「获取更多日志」在浏览器中打开 CHANGELOG.md 查看。
                    </p>
                </>
            ) : !entries || entries.length === 0 ? (
                <Empty description="暂无更新日志" />
            ) : (
                <>
                    <div className="max-h-[60vh] overflow-auto pr-1">
                        {shown.map((en) => (
                            <div key={en.title} className="mb-3.5">
                                <div className="mb-1.5 text-sm font-bold text-brand-500">{en.title}</div>
                                <div className="whitespace-pre-wrap break-words text-[13px] leading-[1.6] text-ink-1">
                                    {mdToPlain(en.body)}
                                </div>
                            </div>
                        ))}
                    </div>
                    <p className="mt-2 block text-center text-xs text-ink-3">
                        {entries.length > shown.length
                            ? '共 ' + entries.length + ' 条，已显示最新 ' + shown.length + ' 条'
                            : '共 ' + entries.length + ' 条（已全部显示）'}
                    </p>
                </>
            )}
        </Modal>
    );
}
