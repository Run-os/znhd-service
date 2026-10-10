import { Button, Empty, Image, Modal, Space, Tabs, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { copyImageToClipboard, getDeviceId, sendTestImage, TEST_IMAGE_URL } from '@/lib/relay';
import { safeCopyText } from '@/lib/clipboard';
import { addLog } from '@/lib/logger';
import { downloadFileName, type GalleryImage, type GalleryText } from '@/lib/gallery';
import { getOverlayContainer } from '@/lib/ui/panelHost';
import { CheckIcon } from '@/lib/ui/icons';
// 预览相关的通用件全部来自共享层（与手机上传页同一份，v26.10.08-v13 起）
import { appendPreviewActions } from '../../../shared/preview/actions';
import { getPreviewHost } from '../../../shared/preview/host';
import { syncPreviewMask } from '../../../shared/preview/mask';
import { buildA4ImageNode, PRINT_PAGE_STYLE } from '../../../shared/preview/print';

const { Text } = Typography;

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
 * 预览浮层的挂载容器、A4 打印版式、遮罩压制、工具栏追加按钮 ——
 * 这些**通用件已全部搬进 `shared/preview/`**（v26.10.08-v13），与手机上传页共用同一份实现，
 * 因此本文件不再自带一份；原来的实测数据与「为什么这么做」的说明随代码一起搬过去了，见：
 *   · `shared/preview/host.ts`  —— 为什么必须自建宿主 div（body 带 transform 会困住 fixed 浮层）
 *   · `shared/preview/print.ts` —— A4 版式常量、`PRINT_PAGE_STYLE`、`buildA4ImageNode()`
 *   · `shared/preview/mask.ts`  —— 预览期间压掉所有下层遮罩（否则两层 rgba 叠成 0.6975）
 *   · `shared/preview/actions.tsx` —— 把按钮追加进 antd 工具栏胶囊
 */

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
     * 放大预览是否打开（v26.10.08-v9 起用于撤掉下层遮罩）。
     *
     * 预览是**全屏**浮层，下层遮罩全被盖住、对视觉毫无贡献；但 antd 的 Modal / Drawer 遮罩都是
     * `rgba(0,0,0,0.45)`，叠在预览自带的同款遮罩上就是 `1-(0.55×0.55)=0.6975` ——
     * 白底被压到灰度 **77**（只有一层时是 **140**），肉眼即「没有官方明亮」。
     *
     * ⚠️ **v26.10.08-v9 只撤了本弹窗自己那层，不够**：实测预览打开时，取样点上还叠着
     * **设置抽屉的 `.ant-drawer-mask`** 以及其它弹窗的 `.ant-modal-mask`。
     * v11 起改为「预览期间一律压掉所有下层遮罩」（见下面给 documentElement 挂的类）。
     */
    const [previewOpen, setPreviewOpen] = useState(false);

    /**
     * 预览开关 → 压掉/恢复**所有**下层浮层遮罩。
     * 规则与类名都在共享层（`shared/preview/mask.ts`），手机页用的是同一份；
     * `syncPreviewMask` 幂等，且会顺手把 CSS 注入一次（原先脚本端在 uiReset 里另写了一份，已去掉）。
     */
    useEffect(() => {
        syncPreviewMask(previewOpen);
        return () => syncPreviewMask(false);
    }, [previewOpen]);

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

        printTitleRef.current = fname;
        addLog('打印图片: ' + fname, 'success');
        // v26.10.10-v2：打印前先探测图片自然尺寸，横图自动旋转 90° 铺满纵向 A4。
        // ⚠️ 不能依赖 img.onload 改样式：react-to-print 克隆的是独立节点，原始节点的 onload
        //    改动不会带到克隆里。所以这里用临时的 Image() 先量出宽高，再构造好节点交给 doPrint。
        const probe = document.createElement('img');
        probe.onload = () => {
            doPrint(() =>
                buildA4ImageNode(it.previewUrl, fname, {
                    width: probe.naturalWidth,
                    height: probe.naturalHeight,
                })
            );
        };
        probe.onerror = () => doPrint(() => buildA4ImageNode(it.previewUrl, fname));
        probe.src = it.previewUrl;
    };

    const [imgCopy, setImgCopy] = useState<{ idx: number; state: 'busy' | 'ok' | 'fail' } | null>(null);

    /**
     * 复制图片并给出反馈。
     *
     * ⚠️ v26.10.09-v7：原实现是**命令式改 `btn.textContent`**（`'复制中…'` → `'✓ 已复制'`）。
     * 因为反馈文案里的 `✓`(U+2713) 属 Dingbats、Win7 字形覆盖不确定，要把它换成内联 SVG
     * 就必须由 React 渲染，故改为 state 驱动。行为与原来一致：1.5s 后回到「复制」。
     * ⚠️ 冒烟测试是按 `textContent.trim() === '复制'` 找这个按钮的，所以**空闲态文案必须仍是「复制」**。
     */
    const doCopy = (it: GalleryImage, idx: number) => {
        setImgCopy({ idx, state: 'busy' });
        copyImageToClipboard(it.blob).then((ok: boolean) => {
            setImgCopy({ idx, state: ok ? 'ok' : 'fail' });
            if (ok) addLog('图片已复制到剪贴板: ' + (it.name || ''), 'success');
            window.setTimeout(() => setImgCopy(null), 1500);
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
                         * ⚠️ **必须显式指定挂载容器**（v26.10.08-v7 修「放大后图片盖住下方工具栏」）：
                         * 原因、实测数据与「为什么不能直接用 getOverlayContainer」都写在 `getPreviewHost` 的注释里。
                         */
                        getContainer: getPreviewHost,
                        /**
                         * 预览开/关 → 压掉/恢复下层遮罩（避免两层遮罩叠加变暗）。见上方 useEffect。
                         */
                        onOpenChange: (o: boolean) => setPreviewOpen(o),
                        /**
                         * 「打印」放在**放大预览的工具栏**里（v26.10.08-v2，按用户要求从缩略图行挪过来）。
                         * 追加方式用共享层的 `appendPreviewActions`（手机页用的是同一个函数）；
                         * 「为什么必须 cloneElement 进 antd 的 actions 容器」写在那个文件里。
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
                            return appendPreviewActions(originalNode, printBtn);
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
                                    <Button size="small" style={{ flex: 1 }} onClick={() => doCopy(it, idx)}>
                                        {imgCopy && imgCopy.idx === idx ? (
                                            imgCopy.state === 'busy' ? (
                                                '复制中…'
                                            ) : imgCopy.state === 'ok' ? (
                                                <>
                                                    <CheckIcon size={12} /> 已复制
                                                </>
                                            ) : (
                                                '复制失败'
                                            )
                                        ) : (
                                            '复制'
                                        )}
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
                                    {copyState && copyState.idx === idx ? (
                                        copyState.ok ? (
                                            <>
                                                <CheckIcon size={12} /> 已复制
                                            </>
                                        ) : (
                                            '复制失败'
                                        )
                                    ) : (
                                        '复制'
                                    )}
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
            title={
                // 标题旁边放「发送测试图片」：空历史时也能一键灌入一张图来验证整条链路
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span>{`历史记录（图片 ${images.length} · 文本 ${texts.length}）`}</span>
                    <Button size="small" loading={testSending} onClick={doSendTestImage}>
                        发送测试图片
                    </Button>
                </div>
            }
            onCancel={onClose}
            getContainer={getOverlayContainer}
            width={620}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            // 预览打开时撤掉本弹窗的遮罩：预览是全屏浮层，这层遮罩被完全盖住、只会让画面多暗一层（见 previewOpen 注释）
            mask={!previewOpen}
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
