import { Button, Empty, Image, Modal, Space, Tabs, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { Children, cloneElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReactToPrint } from 'react-to-print';
import { copyImageToClipboard } from '@/lib/relay';
import { safeCopyText } from '@/lib/clipboard';
import { addLog } from '@/lib/logger';
import { downloadFileName, type GalleryImage, type GalleryText } from '@/lib/gallery';
import { getOverlayContainer } from '@/lib/ui/panelHost';

const { Text } = Typography;

export interface RecvHistoryModalProps {
    open: boolean;
    onClose: () => void;
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
 * 为什么要分页签而不是混排一条时间线：图片页签要复用 antd `Image.PreviewGroup`（多图左右切换、
 * 缩放/旋转、以及工具栏里的打印），它要求 items 是一组同构的图片 URL；文本条目既没有预览语义、
 * 也不需要放大，混进同一列表会把两套交互互相干扰。分页签后图片侧的一切保持不变，文本侧独立。
 *
 * 历史沿革：
 *  - v26.10.06-v13：由原 DOM 弹窗 + Viewer.js 改为 antd Modal + Image.PreviewGroup。
 *    ⚠️ 剪贴板写入仍走 `copyImageToClipboard`：Chromium 对 image/png 支持最可靠，且
 *    「先转好 PNG 再只写一次」是仓库实测结论（写失败也会消耗用户手势），不要改回去。
 *  - v26.10.08-v1/v2：新增「打印」，入口最终落在放大预览的工具栏（antd 预览的 `actionsRender`）。
 *  - v26.10.08-v3：改名与扩展为「历史记录」，新增「文本」页签（单条删除 / 清空 / 复制）。
 */
export default function RecvHistoryModal({
    open,
    onClose,
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
        pageStyle: '@page { margin: 10mm }',
    });

    /**
     * 打印某一张图的**原图**。
     *
     * 两个关键取舍：
     *  1) 打印内容用**临时构造的游离节点**（不挂进 DOM），而不是页面上某个隐藏容器：
     *     `cloneNode` 会把**内联样式**一起克隆，所以 `display:none` / 挪到视口外的隐藏容器
     *     在打印 iframe 里同样不可见 ⇒ 打印出来是空白。游离节点只带我们给的打印样式，没有这个坑；
     *     而且它不进渲染树，也就不会「闪一下大图」。
     *  2) 打印的是 `previewUrl`（原分辨率 objectURL），不是预览里缩放/旋转后的画面 —— 清晰度最好。
     *     ⚠️ 打印对话框弹出期间该图的 objectURL 不能被 revoke（移除该图会 revoke），否则打印空白。
     */
    const printImage = (it: GalleryImage, idx: number) => {
        const fname = downloadFileName(it.name, it.mime, idx);
        const node = document.createElement('div');
        const img = document.createElement('img');
        img.src = it.previewUrl;
        img.alt = fname;
        img.style.cssText = 'display:block;max-width:100%;height:auto;margin:0 auto;';
        node.appendChild(img);

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

    const tabItems = [
        {
            key: 'image',
            label: `图片（${images.length}）`,
            children: images.length ? (
                // items 用 objectURL 列表：预览里的左右切换由 antd 接管
                <Image.PreviewGroup
                    items={images.map((i) => i.previewUrl)}
                    preview={{
                        /**
                         * 「打印」放在**放大预览的工具栏**里（v26.10.08-v2，按用户要求从缩略图行挪过来）。
                         *
                         * ⚠️ 必须用 cloneElement 把按钮**追加进 antd 自己的 `.ant-image-preview-actions` 容器**，
                         *    不能直接当 `originalNode` 的兄弟节点返回：工具栏的胶囊背景与圆角长在 actions 容器上，
                         *    而它的父级 footer 是 `flex-direction: column` —— 放外面会变成「工具栏下方一个没有背景的裸按钮」。
                         *    按钮复用 antd 自己的 `-actions-action` 类，尺寸/悬停与自带图标完全一致。
                         */
                        actionsRender: (originalNode, info) => {
                            const printBtn = (
                                <button
                                    key="znhd-print"
                                    type="button"
                                    className="ant-image-preview-actions-action"
                                    aria-label="print"
                                    title="打印原图"
                                    onClick={() => {
                                        // 优先按 url 反查（items 与 images 同序，但按 url 更稳），退回下标
                                        const found = images.findIndex((i) => i.previewUrl === info.image?.url);
                                        const at = found >= 0 ? found : info.current;
                                        if (images[at]) printImage(images[at], at);
                                    }}>
                                    <PrinterOutlined />
                                </button>
                            );
                            return cloneElement(originalNode, {}, [
                                ...Children.toArray((originalNode.props as { children?: ReactNode }).children),
                                printBtn,
                            ]);
                        },
                    }}>
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(3, minmax(0,1fr))',
                            gap: 8,
                            maxHeight: '60vh',
                            overflow: 'auto',
                            alignContent: 'start',
                        }}>
                        {images.map((it, idx) => (
                            <div key={it.previewUrl} style={{ display: 'flex', flexDirection: 'column' }}>
                                <Image
                                    src={it.previewUrl}
                                    alt={it.name || 'image'}
                                    style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8 }}
                                />
                                <Space size={4} style={{ marginTop: 4, width: '100%' }}>
                                    <Button
                                        size="small"
                                        style={{ flex: 1 }}
                                        onClick={(e) => doCopy(it, e.currentTarget as HTMLButtonElement)}>
                                        复制
                                    </Button>
                                    <Button size="small" style={{ flex: 1 }} onClick={() => doDownload(it, idx)}>
                                        下载
                                    </Button>
                                    <Button size="small" danger onClick={() => onRemoveImage(idx)}>
                                        ×
                                    </Button>
                                </Space>
                            </div>
                        ))}
                    </div>
                </Image.PreviewGroup>
            ) : (
                <Empty description="暂无图片" />
            ),
        },
        {
            key: 'text',
            label: `文本（${texts.length}）`,
            children: texts.length ? (
                <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
                    {/* 最新一条在最上：历史记录按「刚收到的先看」组织，与弹窗外的日志顺序相反是有意的 */}
                    {texts.map((t, idx) => (
                        <div
                            key={t.ts + '-' + idx}
                            style={{
                                display: 'flex',
                                gap: 8,
                                alignItems: 'flex-start',
                                padding: '8px 0',
                                borderBottom: '1px solid rgba(0,0,0,0.06)',
                            }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <pre
                                    style={{
                                        margin: 0,
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-word',
                                        fontFamily: 'inherit',
                                        fontSize: 14,
                                        lineHeight: 1.6,
                                    }}>
                                    {t.text}
                                </pre>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                    {fmtTime(t.ts)}
                                </Text>
                            </div>
                            <Space size={4}>
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
                            </Space>
                        </div>
                    ))}
                </div>
            ) : (
                <Empty description="暂无文本" />
            ),
        },
    ];

    return (
        <Modal
            open={open}
            title={`历史记录（图片 ${images.length} · 文本 ${texts.length}）`}
            onCancel={onClose}
            getContainer={getOverlayContainer}
            width={620}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            footer={
                <Space>
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
                    <Button color="primary" variant="solid" onClick={onClose}>
                        关闭
                    </Button>
                </Space>
            }>
            <Tabs activeKey={tab} onChange={(k) => setTab(k as 'image' | 'text')} items={tabItems} />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                提示：图片页签单击缩略图可放大/旋转/多图切换，放大后工具栏上的「打印」打印原图；图片与文本的「复制」都会写入系统剪贴板，回征纳互动
                Ctrl+V 即可（打印对话框弹出后请勿删除该图）。
            </Text>
        </Modal>
    );
}
