import { Image, Button, Empty, Modal, Space, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { Children, cloneElement, useRef, type ReactNode } from 'react';
import { useReactToPrint } from 'react-to-print';
import { copyImageToClipboard } from '@/lib/relay';
import { addLog } from '@/lib/logger';
import { downloadFileName, type GalleryImage } from '@/lib/gallery';
import { notify } from '@/lib/ui/notify';
import { getOverlayContainer } from '@/lib/ui/panelHost';

const { Text } = Typography;

export interface RecvGalleryModalProps {
    open: boolean;
    onClose: () => void;
    images: GalleryImage[];
    onRemove: (idx: number) => void;
    onClear: () => void;
}

/**
 * 收到图片的画廊弹窗（v26.10.06-v13：由原 DOM 弹窗 + Viewer.js 改为 antd Modal + Image.PreviewGroup）。
 *
 * 为什么能去掉 Viewer.js：antd 的 `Image.PreviewGroup` 自带
 * 「多图左右切换 / 缩放 / 旋转 / 翻转 / 1:1 / 关闭」整套交互，与脚本端原来的能力对齐，
 * 少一个第三方库 + 一份它自带的 CSS（以及当年为它写的层级/过渡补丁）。
 * ⚠️ 剪贴板写入仍走 `copyImageToClipboard`：Chromium 对 image/png 支持最可靠，
 *    且「先转好 PNG 再只写一次」是仓库实测结论（写失败也会消耗用户手势），不要改回去。
 * v26.10.08-v1：新增「打印」能力 —— antd 的 `Image` 预览只带缩放/旋转等变换，**不自带打印**，
 *    故引入 `react-to-print` 打印**原图**（不是预览里变换后的画面），见 `printImage` 注释。
 * v26.10.08-v2：按用户要求，打印入口由「缩略图下方按钮行」挪到**放大预览的工具栏**里
 *    （antd 预览的 `actionsRender`，见 `<Image.PreviewGroup preview>` 处的实现注释）。
 */
export default function RecvGalleryModal({ open, onClose, images, onRemove, onClear }: RecvGalleryModalProps) {
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
     * 打印某一张图的**原图**（v26.10.08-v1）。
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

    return (
        <Modal
            open={open}
            title={'收到的图片（' + images.length + '）· 单击放大'}
            onCancel={onClose}
            getContainer={getOverlayContainer}
            width={620}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            footer={
                <Space>
                    <Button
                        danger
                        onClick={() => {
                            onClear();
                            onClose();
                        }}>
                        清空全部
                    </Button>
                    <Button color="primary" variant="solid" onClick={onClose}>
                        关闭
                    </Button>
                </Space>
            }>
            {images.length === 0 ? (
                <Empty description="暂无图片" />
            ) : (
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
                                    <Button size="small" danger onClick={() => onRemove(idx)}>
                                        ×
                                    </Button>
                                </Space>
                            </div>
                        ))}
                    </div>
                </Image.PreviewGroup>
            )}
            {images.length > 0 && (
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                    提示：单击缩略图可放大/旋转/多图切换；「复制」会把图片写入系统剪贴板，回征纳互动 Ctrl+V
                    即可；放大后点工具栏上的「打印」可打印原图（打印对话框弹出后请勿删除该图）。
                </Text>
            )}
        </Modal>
    );
}
