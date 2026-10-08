import { Button, Empty } from '../../../shared/ui/controls';
import { Tabs, Tooltip } from '../../../shared/ui/feedback';
import { Modal } from '../../../shared/ui/OverlayModal';
import { ImagePreview, PRINT_ICON, type PreviewItem } from '../../../shared/ui/ImagePreview';
import { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { copyImageToClipboard, getDeviceId, sendTestImage, TEST_IMAGE_URL } from '@/lib/relay';
import { safeCopyText } from '@/lib/clipboard';
import { addLog } from '@/lib/logger';
import { downloadFileName, type GalleryImage, type GalleryText } from '@/lib/gallery';
// 打印版式与「预览期间压掉下层遮罩」来自共享层（手机上传页用的是同一份，见 shared/preview/）
import { syncPreviewMask } from '../../../shared/preview/mask';
import { buildA4ImageNode, PRINT_PAGE_STYLE } from '../../../shared/preview/print';

export interface RecvHistoryModalProps {
    open: boolean;
    onClose: () => void;
    /** 中继地址：标题栏的「发送测试图片」要经它投递（未配置时按钮会给出提示） */
    relayServer: string;
    /** 收到的图片（缩略图 + 放大预览 + 打印） */
    images: GalleryImage[];
    /** 收到的文本（可回看的历史；与「自动弹出的最新一条文本」是两回事，见 gallery.ts 的 GalleryText） */
    texts: GalleryText[];
    onRemoveImage: (idx: number) => void;
    onClearImages: () => void;
    onRemoveText: (idx: number) => void;
    onClearTexts: () => void;
}

/** 文本记录的时间戳展示（MM-DD HH:mm:ss） */
function fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 「历史记录」弹窗：图片 + 文本两类收件，分两个页签（v26.10.08-v3 由单纯的「收图画廊」升级而来）。
 *
 * 为什么要分页签而不是混排一条时间线：图片页签要复用图片预览（多图左右切换、缩放/旋转、
 * 以及工具栏里的打印），它要求 items 是一组同构的图片地址；文本条目既没有预览语义、
 * 也不需要放大，混进同一列表会把两套交互互相干扰。分页签后图片侧的一切保持不变，文本侧独立。
 *
 * 历史沿革：
 *  - v26.10.06-v13：由原 DOM 弹窗 + Viewer.js 改为 Modal + Image.PreviewGroup。
 *    ⚠️ 剪贴板写入仍走 `copyImageToClipboard`：Chromium 对 image/png 支持最可靠，且
 *    「先转好 PNG 再只写一次」是仓库实测结论（写失败也会消耗用户手势），不要改回去。
 *  - v26.10.08-v1/v2：新增「打印」，入口落在放大预览的工具栏里。
 *  - v26.10.08-v3：改名与扩展为「历史记录」，新增「文本」页签（单条删除 / 清空 / 复制）。
 *  - v26.10.08-v14：antd Image.PreviewGroup → 自研 `ImagePreview`（见 shared/ui/ImagePreview.tsx
 *    的说明：为什么不用现成库）。「打印」按钮改由 `extraActions` 插槽注入预览工具栏。
 */
export default function RecvHistoryModal({
    open,
    onClose,
    relayServer,
    images,
    texts,
    onRemoveImage,
    onClearImages,
    onRemoveText,
    onClearTexts,
}: RecvHistoryModalProps) {
    /** 当前页签 */
    const [tab, setTab] = useState<'image' | 'text'>('image');
    /** 文本行的复制反馈：记录是**第几行**，避免所有行一起改文案 */
    const [copyState, setCopyState] = useState<{ idx: number; ok: boolean } | null>(null);
    /** 「发送测试图片」是否正在取图/投递（防重复点击 + 按钮 loading） */
    const [testSending, setTestSending] = useState(false);
    /**
     * 放大预览是否打开（用于撤掉本弹窗的遮罩）。
     *
     * 预览是**全屏**浮层，下层遮罩全被盖住、对视觉毫无贡献；而浮层遮罩是 `rgb(0 0 0 / 0.45)`，
     * 叠在预览自带的同款遮罩上就是 `1-(0.55×0.55)=0.6975` —— 白底被压到灰度 **77**
     * （只有一层时是 **140**），肉眼即「没有官方明亮」。
     *
     * ⚠️ **只撤「自己那层」不够**：预览打开时底下凡是还开着的弹窗，遮罩依然在画。
     * 统一做法是预览期间给 <html> 挂类、用 CSS 压掉**所有**带 data-znhd-mask 的遮罩
     * （规则与类名都在共享层 shared/preview/mask.ts，手机页用的是同一份）。
     * 这里仍保留本弹窗 showMask 的联动，让「自己这层」连画都不画（少一层合成开销）。
     */

    // 每次打开都回到「图片」页签：收到新图会自动弹这个弹窗，不应停在用户上次看的「文本」页
    useEffect(() => {
        if (open) setTab('image');
    }, [open]);

    /** 打印对话框上的文档标题（react-to-print 会在打印期间临时改写 document.title 再还原） */
    const printTitleRef = useRef('图片');

    /**
     * 打印能力来自 react-to-print：它负责「建隐藏 iframe → 把内容克隆进去 → 等图片加载完 →
     * 调 iframe 的 print() → 清理」，并自带 CSP `nonce` 与失败回调。
     *
     * ⚠️ `ignoreGlobalStyles` 必须显式设 true：它的默认行为是把宿主页面**全部** `<style>`/`<link>`
     *    抄进打印 iframe，税务页那一大坨 CSS 会跟着进去（跨域样式表读 `cssRules` 还会告警）。
     */
    const doPrint = useReactToPrint({
        ignoreGlobalStyles: true,
        documentTitle: () => printTitleRef.current,
        /**
         * A4 版式来自共享层 `shared/preview/print.ts`（手机页用的是同一个 `PRINT_PAGE_STYLE`）：
         * `@page` 直接注入打印窗口，比外部 CSS 可靠得多；`margin: 0` 是为了让浏览器**没地方画页眉页脚**，
         * 图片与纸边的 10mm 由内容框的 padding 提供 —— 完整理由见该文件头部注释。
         */
        pageStyle: PRINT_PAGE_STYLE,
    });

    /**
     * 打印某一张图的**原图**，并自适应 A4 纸。
     *
     * 版式与「为什么用游离节点」都搬进了共享层 `shared/preview/print.ts`（`buildA4ImageNode`），
     * 手机页打印时用的是同一个函数。这里只保留脚本端特有的两点：
     *   · 打印的是 `previewUrl`（原分辨率 objectURL），不是预览里缩放/旋转后的画面 —— 清晰度最好；
     *     ⚠️ 打印对话框弹出期间该图的 objectURL 不能被 revoke（移除该图会 revoke），否则打印空白；
     *   · 文档标题用 `downloadFileName`（与下载同名，便于在打印对话框里认出来）。
     * ⚠️ 纸张最终仍受用户在打印对话框里的「缩放/适应纸张尺寸」影响：若选了「适应纸张」，
     *    浏览器会按自己的规则再缩一次，CSS 里的 `@page size` 会被覆盖（这是 CSS「不生效」的常见原因）。
     */
    const printImage = (it: GalleryImage, idx: number) => {
        const fname = downloadFileName(it.name, it.mime, idx);
        const node = buildA4ImageNode(it.previewUrl, fname);

        printTitleRef.current = fname;
        addLog('打印图片: ' + fname, 'success');
        doPrint(() => node);
    };

    const doCopy = (it: GalleryImage, btn: HTMLButtonElement) => {
        const old = btn.textContent;
        btn.textContent = '复制中…';
        copyImageToClipboard(it.blob).then((ok: boolean) => {
            btn.textContent = ok ? '✓ 已复制' : '复制失败';
            if (ok) addLog('图片已复制到剪贴板: ' + (it.name || ''), 'success');
            window.setTimeout(() => {
                btn.textContent = old;
            }, 1500);
        });
    };

    const doDownload = (it: GalleryImage, idx: number) => {
        const fname = downloadFileName(it.name, it.mime, idx);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(it.blob);
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        addLog('图片已下载: ' + fname, 'success');
    };

    const doCopyText = (t: GalleryText, idx: number) => {
        // safeCopyText 会回传真实结果：无可用途径 / 被拒绝时不再假显示「已复制」
        safeCopyText(t.text, (ok: boolean) => {
            setCopyState({ idx, ok });
            if (ok) addLog('文本已复制到剪贴板', 'success');
            window.setTimeout(() => setCopyState(null), 1500);
        });
    };

    /**
     * 「发送测试图片」（v26.10.08-v10，按用户要求）：从 `TEST_IMAGE_URL` 取一张随机图，
     * **当作手机上传**投递到中继 `/u/<本机 deviceId>`，再经正常的「手机 → 电脑」通道回到本脚本、进历史记录。
     *
     * 这样空历史也能一键验证「收图 → 画廊 → 预览 → 打印」整条链路，不必掏手机。
     * ⚠️ 需要先配置中继地址（未配置时 sendTestImage 会直接失败并给出提示，不发请求）。
     */
    const doSendTestImage = () => {
        if (testSending) return;
        setTestSending(true);
        addLog('[测试图片] 正在从 ' + TEST_IMAGE_URL + ' 取图并投递到本机…', 'info');
        sendTestImage({
            server: relayServer,
            uuid: getDeviceId(),
            onOk: (info) => {
                setTestSending(false);
                addLog(
                    '[测试图片] 已投递（' +
                        info.mime +
                        '，约 ' +
                        Math.max(1, Math.round(info.bytes / 1024)) +
                        'KB），片刻后会出现在「图片」页签',
                    'success'
                );
            },
            onFail: (msg) => {
                setTestSending(false);
                addLog('[测试图片] 失败：' + msg, 'error', true);
            },
        });
    };

    /** 预览的 items：按 images 顺序，用原分辨率地址 */
    const previewItems: PreviewItem[] = images.map((i) => ({ url: i.previewUrl, name: i.name }));
    /** 当前预览项下标；-1 表示未打开 */
    const [previewIdx, setPreviewIdx] = useState(-1);

    // 预览的开/关**不另设 state**，直接由预览下标派生（-1 = 关）：
    // 两个 state 表达同一件事就必然有机会不同步（关预览时漏改其中一个 → 遮罩压不回来）。
    const previewOpen = previewIdx >= 0;

    // 预览开关 → 压掉/恢复**所有**下层浮层遮罩。
    // 规则与类名都在共享层（shared/preview/mask.ts），手机页用的是同一份；
    // syncPreviewMask 幂等，且会顺手把 CSS 注入一次。
    useEffect(() => {
        syncPreviewMask(previewOpen);
        return () => syncPreviewMask(false);
    }, [previewOpen]);
    const openPreview = (idx: number) => setPreviewIdx(idx);

    const tabItems = [
        {
            key: 'image',
            label: `图片（${images.length}）`,
            content: images.length ? (
                <div className="grid max-h-[60vh] grid-cols-3 content-start gap-2 overflow-auto">
                    {images.map((it, idx) => (
                        <div key={it.previewUrl} className="flex flex-col">
                            <img
                                src={it.previewUrl}
                                alt={it.name || 'image'}
                                title={it.name || '点击放大'}
                                className="w-full cursor-zoom-in rounded-lg object-cover"
                                style={{ aspectRatio: '1 / 1' }}
                                onClick={() => openPreview(idx)}
                            />
                            <div className="mt-1 flex w-full gap-1">
                                <Button
                                    size="small"
                                    className="flex-1"
                                    onClick={(e) => doCopy(it, e.currentTarget as HTMLButtonElement)}>
                                    复制
                                </Button>
                                <Button size="small" className="flex-1" onClick={() => doDownload(it, idx)}>
                                    下载
                                </Button>
                                <Button size="small" danger onClick={() => onRemoveImage(idx)}>
                                    ×
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <Empty description="暂无图片" />
            ),
        },
        {
            key: 'text',
            label: `文本（${texts.length}）`,
            content: texts.length ? (
                <div className="max-h-[60vh] overflow-auto">
                    {/* 最新一条在最上：历史记录按「刚收到的先看」组织，与弹窗外的日志顺序相反是有意的 */}
                    {texts.map((t, idx) => (
                        <div
                            key={t.ts + '-' + idx}
                            className="flex items-start gap-2 border-b border-black/[0.06] py-2">
                            <div className="min-w-0 flex-1">
                                <pre className="m-0 whitespace-pre-wrap break-words font-sans text-sm leading-[1.6]">
                                    {t.text}
                                </pre>
                                <span className="text-[11px] text-muted-foreground">{fmtTime(t.ts)}</span>
                            </div>
                            <div className="flex gap-1">
                                <Button size="small" onClick={() => doCopyText(t, idx)}>
                                    {copyState && copyState.idx === idx
                                        ? copyState.ok
                                            ? '✓ 已复制'
                                            : '复制失败'
                                        : '复制'}
                                </Button>
                                <Button size="small" danger onClick={() => onRemoveText(idx)}>
                                    ×
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <Empty description="暂无文本" />
            ),
        },
    ];

    return (
        <>
            <Modal
                open={open}
                width={620}
                onClose={onClose}
                // 预览打开时撤掉本弹窗的遮罩：预览是全屏浮层，这层遮罩被完全盖住、只会让画面多暗一层
                showMask={!previewOpen}
                title={
                    // 标题旁边放「发送测试图片」：空历史时也能一键灌入一张图来验证整条链路
                    <span className="inline-flex flex-wrap items-center gap-2.5">
                        <span>{`历史记录（图片 ${images.length} · 文本 ${texts.length}）`}</span>
                        <Button size="small" loading={testSending} onClick={doSendTestImage}>
                            发送测试图片
                        </Button>
                    </span>
                }
                footer={
                    <>
                        {/* 清空只作用于**当前页签**：页签化之后「清空全部」会让人误以为连另一页也一起清掉 */}
                        {tab === 'image' ? (
                            <Button
                                danger
                                disabled={!images.length}
                                onClick={() => {
                                    onClearImages();
                                    onClose();
                                }}>
                                清空图片
                            </Button>
                        ) : (
                            <Button
                                danger
                                disabled={!texts.length}
                                onClick={() => {
                                    onClearTexts();
                                    onClose();
                                }}>
                                清空文本
                            </Button>
                        )}
                        <Button variant="primary" onClick={onClose}>
                            关闭
                        </Button>
                    </>
                }>
                <Tabs items={tabItems} value={tab} onChange={(k) => setTab(k as 'image' | 'text')} />
                <p className="mt-2 block text-xs text-muted-foreground">
                    提示：图片页签单击缩略图可放大/旋转/多图切换，放大后工具栏上的「打印」打印原图；图片与文本的「复制」都会写入系统剪贴板，回征纳互动
                    Ctrl+V 即可（打印对话框弹出后请勿删除该图）。
                </p>
            </Modal>

            {/* 图片放大预览（挂在 Modal 之外：它是全屏浮层，层级高于本弹窗） */}
            <ImagePreview
                index={previewIdx}
                items={previewItems}
                onIndexChange={setPreviewIdx}
                onClose={() => setPreviewIdx(-1)}
                caption={(_it, i, total) => `图片 ${i + 1} / ${total}`}
                extraActions={() => (
                    <Tooltip content="打印原图" side="top">
                        <button
                            type="button"
                            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-white transition-colors hover:bg-popover/20"
                            aria-label="print"
                            title="打印原图"
                            onClick={() => {
                                const it = images[previewIdx];
                                if (it) printImage(it, previewIdx);
                            }}>
                            {PRINT_ICON}
                        </button>
                    </Tooltip>
                )}
            />
        </>
    );
}
