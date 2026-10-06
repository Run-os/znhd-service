import { Image, Button, Empty, Modal, Space, Typography } from 'antd';
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
 */
export default function RecvGalleryModal({ open, onClose, images, onRemove, onClear }: RecvGalleryModalProps) {
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
                <Image.PreviewGroup items={images.map((i) => i.previewUrl)}>
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
                    提示：单击缩略图可放大/旋转/多图切换；「复制」会把图片写入系统剪贴板，回征纳互动 Ctrl+V 即可。
                </Text>
            )}
        </Modal>
    );
}
