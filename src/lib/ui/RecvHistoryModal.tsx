import { Button, Empty, Image, Modal, Space, Tabs, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { Children, cloneElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReactToPrint } from 'react-to-print';
import { copyImageToClipboard, getDeviceId, sendTestImage, TEST_IMAGE_URL } from '@/lib/relay';
import { safeCopyText } from '@/lib/clipboard';
import { addLog } from '@/lib/logger';
import { downloadFileName, type GalleryImage, type GalleryText } from '@/lib/gallery';
import { getOverlayContainer } from '@/lib/ui/panelHost';

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
 * 放大预览浮层的挂载容器（v26.10.08-v7 修「放大后图片盖住下方工具栏」）。
 *
 * ⚠️ **必须自己建一个挂在 `documentElement` 下的宿主 div，不能直接用 `getOverlayContainer()`**：
 * antd 的 Image 预览是 `position: fixed` 浮层，**默认 portal 到 `document.body`**；而税务页的 `body`
 * 常被加 `transform`/`filter` 形成独立层叠上下文（本仓库 `panelHost.tsx` 已记录这个坑），
 * 一旦被放进去，浮层就以 **body 的盒子**而不是视口为包含块 ⇒ 工具栏被推到视口外、图片占住它的位置。
 *
 * 实测（1280×800、页面滚到 y=600、`body{transform:translateZ(0)}`）：
 *   · 不修：预览根 `y=-579 h=3000`（= body 盒子），工具栏 `y=2330`（视口外），打印按钮中心命中的是 `img`；
 *   · 传 `getContainer: getOverlayContainer`（返回 `document.documentElement`）：**仍然被挂到 body**，
 *     即这个写法在本 antd/rc-portal 版本下不生效（实测，别改回去）；
 *   · 传本函数（自建宿主 div）：预览根 `y=0`，工具栏回到视口内，命中测试通过。
 */
function getPreviewHost(): HTMLElement {
    const ID = '__znhd_preview_host__';
    let el = document.getElementById(ID);
    if (!el) {
        el = document.createElement('div');
        el.id = ID;
        document.documentElement.appendChild(el);
    }
    return el;
}

/**
 * A4 打印版式（v26.10.08-v4 建，v5 起改为「零页边距 + 内容自己留白」）。
 *
 * ⚠️ **为什么 `@page` 的 margin 必须是 0**：浏览器的「页眉和页脚」（标题 / URL / 日期 / 页码）
 *    画在**页边距区域**里，而 Chrome 打印对话框里该项**默认是勾上的**。只要页边距非 0，
 *    它们就有地方可画 ⇒ 纸上会多出页眉页脚。把 `@page` 边距归零后它们无处容身（这也是
 *    react-to-print 默认 pageStyle 用 `margin: 0` 的原因，它自己注释写着 "Remove browser default
 *    header (title) and footer (url)"）。CSS 没有直接关掉那个勾选项的能力，只能这样「不给它留位置」。
 *    ⇒ 图片与纸边之间的距离改由**内容框自己的 padding** 提供（`A4_PAD_MM`），效果一样且不会被浏览器占用。
 *
 * ⚠️ 这几个数必须与下面 `pageStyle` 里的 `@page { size: A4 portrait; margin: 0 }` **配套**：
 *   · 内容框 = 整张 A4（210 × 297mm），减去 3mm 高度余量取 294mm；
 *   · `padding: 10mm` 且**必须 `box-sizing: border-box`** —— 否则 padding 会把框撑到 230×314mm，
 *     直接溢出纸张、多吐空白页（这是本版最容易写错的一处）；
 *   · 于是真正给图片的区域仍是 190 × 274mm。
 *   · 高度留 3mm 余量：框高**正好等于**纸高时，部分浏览器/打印驱动会因舍入多吐一张空白页。
 */
const A4_W_MM = 210;
const A4_H_MM = 297;
/** 图片与纸边的距离（自己留，不靠 @page margin —— 那个位置要留给「没有页眉页脚」） */
const A4_PAD_MM = 10;
const PRINT_BOX_W_MM = A4_W_MM; // 210（含内边距）
const PRINT_BOX_H_MM = A4_H_MM - 3; // 294（含内边距；留 3mm 防空白页）

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

    /** 预览开关 → 压掉/恢复**所有**下层浮层遮罩（规则写在 uiReset.ts 的 `html.znhd-previewing` 段） */
    useEffect(() => {
        const root = document.documentElement;
        if (previewOpen) root.classList.add('znhd-previewing');
        else root.classList.remove('znhd-previewing');
        return () => root.classList.remove('znhd-previewing');
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
         * A4 版式（v26.10.08-v4；v5 起 `margin` 归零以去掉浏览器页眉页脚）：`@page` 直接注入打印窗口，
         * 比外部 CSS 可靠得多。
         *  - `size: A4 portrait` 让浏览器默认按 A4 纵向出纸（用户在打印对话框里没改纸张时生效）。
         *  - ⚠️ `margin: 0` **不是为了贴边打印**，而是让浏览器没地方画页眉页脚（见上方常量注释）；
         *    图片与纸边的 10mm 由内容框的 `padding` 提供。
         *  - `html, body { margin: 0 }` 是必需的：打印 iframe 的 body 默认 8px 外边距，
         *    不归零会把内容框整体挤出纸张、进而多吐一张空白页。
         */
        pageStyle: '@page { size: A4 portrait; margin: 0; } html, body { margin: 0; padding: 0; }',
    });

    /**
     * 打印某一张图的**原图**，并自适应 A4 纸（v26.10.08-v4）。
     *
     * 三个关键取舍：
     *  1) 打印内容用**临时构造的游离节点**（不挂进 DOM），而不是页面上某个隐藏容器：
     *     `cloneNode` 会把**内联样式**一起克隆，所以 `display:none` / 挪到视口外的隐藏容器
     *     在打印 iframe 里同样不可见 ⇒ 打印出来是空白。游离节点只带我们给的打印样式，没有这个坑；
     *     而且它不进渲染树，也就不会「闪一下大图」。
     *  2) **图片框固定成 A4 可用区**、`object-fit: contain` 等比缩放后居中 —— 整张图必定完整落在同一页，
     *     不裁切、不跨页；小图会被放大铺满（`contain` 只保证不变形，不保证不放大），大图则缩小。
     *     `overflow: hidden` 是二道保险：即便有浏览器不认 `object-fit`，也不会把内容顶出纸张触发分页。
     *  3) 打印的是 `previewUrl`（原分辨率 objectURL），不是预览里缩放/旋转后的画面 —— 清晰度最好。
     *     ⚠️ 打印对话框弹出期间该图的 objectURL 不能被 revoke（移除该图会 revoke），否则打印空白。
     * ⚠️ 纸张最终仍受用户在打印对话框里的「缩放/适应纸张尺寸」影响：若选了「适应纸张」，
     *    浏览器会按自己的规则再缩一次，CSS 里的 `@page size` 会被覆盖（这是 CSS「不生效」的常见原因）。
     */
    const printImage = (it: GalleryImage, idx: number) => {
        const fname = downloadFileName(it.name, it.mime, idx);
        const node = document.createElement('div');
        // 内容框 = 整张 A4（含内边距）。
        // ⚠️ `box-sizing: border-box` 不能省：width 已按 A4 取 210mm，若按 content-box 再加 10mm padding，
        //    实际宽度会变成 230mm ⇒ 溢出纸张、多吐空白页。
        node.style.cssText = `box-sizing:border-box;width:${PRINT_BOX_W_MM}mm;height:${PRINT_BOX_H_MM}mm;padding:${A4_PAD_MM}mm;overflow:hidden;`;
        const img = document.createElement('img');
        img.src = it.previewUrl;
        img.alt = fname;
        // 图片区域 = 内容框的 padding 内沿（190 × 274mm），等比缩放居中
        img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
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
                         * 预览开/关 → 撤掉/恢复本弹窗自己的遮罩（v26.10.08-v9，避免两层遮罩叠加变暗）。
                         * 见 `previewOpen` 的注释。
                         */
                        onOpenChange: (o: boolean) => setPreviewOpen(o),
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
