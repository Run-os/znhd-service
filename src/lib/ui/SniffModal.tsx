import { Button, Checkbox, Empty, Image, InputNumber, Modal, Progress, Space, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { addLog } from '@/lib/logger';
// ⚠️ 三个宿主 id 必须来自**叶子模块**：本文件的 `SNIFF_EXCLUDE_SELECTOR` 是模块级常量，
// 若从 panelHost 取 OVERLAY_HOST_ID，会因 MainPanel → SniffModal → panelHost 的循环 import
// 命中 TDZ（Cannot access 'OVERLAY_HOST_ID' before initialization），脚本启动即挂（v26.10.10-v4 踩过）。
import { getOverlayContainer } from '@/lib/ui/panelHost';
import { OVERLAY_HOST_ID, PANEL_HOST_ID } from '@/lib/ui/panelIds';
import {
    EXCLUDED_NAME_PATTERNS,
    MAX_SNIFF,
    collectCandidates,
    downloadImage,
    formatBytes,
    resolveSizes,
    sniffFileName,
    type SniffSource,
    type SniffedImage,
    type SizeVia,
} from '@/lib/sniffer';
// 预览相关通用件全部来自共享层（与「历史记录」、手机上传页同一份实现）
import { appendPreviewActions } from '../../../shared/preview/actions';
import { PREVIEW_HOST_ID, getPreviewHost } from '../../../shared/preview/host';
import { syncPreviewMask } from '../../../shared/preview/mask';
import { buildA4ImageNode, PRINT_PAGE_STYLE } from '../../../shared/preview/print';

const { Text } = Typography;

/**
 * 「图片嗅探」弹窗（v26.10.10-v4 新增）。
 *
 * 解决什么问题：税务系统里的图片（附件预览、扫描件、回单截图）往往只能在页面上看、没有下载入口，
 * 想存下来或打印只能截图。这里把「当前页面上的图片」一次性列出来，让用户挑着下载或直接按 A4 打印
 * —— 等价于暴力猴上的「图片提取器」脚本，但**不对宿主页打任何桩**（不 patch fetch/XHR/URL.createObjectURL、
 * 不改页面 DOM），因此对税务页零侵入：只读 DOM/计算样式 + 只读资源性能表。
 *
 * 三条设计红线（改之前先读）：
 *  1) **扫描必须排除本脚本自己的宿主**（面板 / 浮层 / 预览三层，见 SNIFF_EXCLUDE_SELECTOR）：
 *     我们的图标全是**内联 SVG**，嗅探的内联 SVG 这一路会把它们当成页面图片收进来；
 *     面板里还挂着一堆 antd 自带的 SVG（Empty 插图、图标）—— 不排除就是「自己嗅自己」。
 *  2) **阈值只影响显示与下载，不影响请求**：先扫描（零额外网络开销地列出候选），再按需测量大小。
 *     反过来「先探测每条 URL 再决定要不要列出来」的话，一个页面就是几百个请求。
 *  3) **大小未知的图不丢**：跨域 HEAD/Range 被拒、blob: 图、部分懒加载图都量不出字节数，
 *     但它们完全可能是用户真正想要的大图，故折叠保留、可照常预览/下载/打印。
 *
 * 名称排除（v26.10.10-v5）：名字含 EXCLUDED_NAME_PATTERNS 的图在**收集阶段**就被丢掉（不测大小、不发请求），
 * 面板顶部给出「已按文件名排除 N 张」的提示 —— 否则用户删不掉页面上那些头像/无名字的噪声图。
 *
 * 阈值的作用范围（v26.10.10-v6，用户反馈后收紧）：小于阈值的图**只被过滤掉，不再出现在任何计数里**
 * （此前头部会写「另有 N 张小于阈值」），并且**全选 / 批量下载的范围只含未被过滤的图**（达标 + 大小未知）。
 * 旧实现里「全选」选的是 kept（含被阈值挡下的那批），于是「下载所选」会把用户根本看不到的小图一起下载。
 *
 * 大小测量阶梯、视频排除规则、去重与 URL 归一化都在 src/lib/sniffer.ts（纯函数，便于单测）；
 * 本文件只负责「合批渲染 + 交互」。测量是异步逐张回来的，所以：
 *  · 结果按 150ms 合批推给状态（300 张图逐张 setState 会把主线程拖哭）；
 *  · 列表在测完之后才按体积排序（边测边排会让卡片来回跳，用户根本点不准）；
 *  · 关闭弹窗 / 重新扫描靠 runIdRef 作废在飞请求的结果（请求本身拦不住，结果丢弃即可）。
 */
export interface SniffModalProps {
    open: boolean;
    onClose: () => void;
    /** 显示/下载阈值（KB）：持久化在 Allvalue.sniffMinKB，不是组件局部状态 */
    minKB: number;
    onMinKBChange: (kb: number) => void;
}

/**
 * 扫描时要跳过的子树：本脚本自己的三个宿主。
 * 它们都挂在 documentElement 下（见 panelHost.tsx 与 shared/preview/host.ts 的取舍说明），
 * 故这里是三个 id 的并集，而不是一个前缀匹配。
 */
export const SNIFF_EXCLUDE_SELECTOR = ['#' + PANEL_HOST_ID, '#' + OVERLAY_HOST_ID, '#' + PREVIEW_HOST_ID].join(',');

/** 每完成这么多毫秒把测好的图推给界面一次（合批，避免逐张 setState） */
const FLUSH_MS = 150;
/** 批量下载之间的间隔：浏览器对同一页面连续触发下载有节流，太快会静默丢文件 */
const BATCH_GAP_MS = 400;
/**
 * 阈值兜底（KB）。storage.ts 的 loadAllvalue 只对 workingHours 做字段级校验，
 * 存量数据里 sniffMinKB 完全可能是坏值（字符串 / null / 负数），故消费点自己兜一次。
 */
const DEFAULT_MIN_KB = 20;

const SOURCE_LABEL: Record<SniffSource, string> = {
    dom: '页面元素',
    svg: '内联 SVG',
    css: 'CSS 背景',
    perf: '资源表',
};

const VIA_LABEL: Record<SizeVia, string> = {
    perf: '资源表读数',
    local: '本地计算',
    head: 'HEAD 响应头',
    range: 'Range 响应头',
    unknown: '未测到',
};

const GRID_STYLE = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0,1fr))',
    gap: 8,
    alignContent: 'start',
} as const;

function sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
    });
}

export default function SniffModal({ open, onClose, minKB, onMinKBChange }: SniffModalProps) {
    /** 本轮扫描到哪一步：测量中 / 测完（测量中显示进度条） */
    const [phase, setPhase] = useState<'measuring' | 'done'>('done');
    /** 已量完的图（**完成顺序**，不是文档顺序；展示时才排序） */
    const [probed, setProbed] = useState<SniffedImage[]>([]);
    /** 本轮候选总数（进度条分母） */
    const [total, setTotal] = useState(0);
    /** 候选被上限截断（CSS 遍历元素数 / MAX_SNIFF）—— 必须明确告诉用户「不止这些」 */
    const [truncated, setTruncated] = useState(false);
    /** 被文件名规则（EXCLUDED_NAME_PATTERNS）排除的张数 —— 让用户知道「不是没扫到，是按规则排掉了」 */
    const [excluded, setExcluded] = useState(0);
    /** 「大小未知」分组是否展开（默认折叠） */
    const [unknownOpen, setUnknownOpen] = useState(false);
    /** 勾选（存 key，不用下标：结果集是异步增长的，下标会错位） */
    const [selected, setSelected] = useState<Set<string>>(() => new Set<string>());
    /** 放大预览是否打开（用于撤掉下层遮罩，同「历史记录」） */
    const [previewOpen, setPreviewOpen] = useState(false);
    /** 正在下载的单张 key（按钮 loading） */
    const [busyKey, setBusyKey] = useState<string | null>(null);
    /** 批量下载进度（null = 空闲） */
    const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

    /** 本轮扫描编号：关闭弹窗 / 重新扫描时自增，作废在飞请求的结果 */
    const runIdRef = useRef(0);
    /** 待推送到界面的缓冲 */
    const bufRef = useRef<SniffedImage[]>([]);
    /** 合批定时器 */
    const timerRef = useRef<number | null>(null);

    /** 把缓冲推给界面（立刻，并清掉未触发的定时器） */
    const flush = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        const buf = bufRef.current;
        if (!buf.length) return;
        bufRef.current = [];
        setProbed((prev) => prev.concat(buf));
    }, []);

    /** 合批调度：150ms 内的多张合并成一次 setState */
    const scheduleFlush = useCallback(() => {
        if (timerRef.current !== null) return;
        timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            flush();
        }, FLUSH_MS);
    }, [flush]);

    /**
     * 扫一轮：收集候选（同步、零网络）→ 异步测量大小（按需发 HEAD/Range）。
     * 收集阶段是同步的，超大页面可能耗时几十毫秒，故放在用户点按钮 / 打开弹窗之后。
     */
    const startScan = useCallback(() => {
        const runId = ++runIdRef.current;
        bufRef.current = [];
        setProbed([]);
        setTotal(0);
        setTruncated(false);
        setExcluded(0);
        setSelected(new Set<string>());
        setUnknownOpen(false);
        setBusyKey(null);
        setBatch(null);
        setPhase('measuring');

        addLog('[图片嗅探] 开始扫描当前页面的图片…', 'info');
        const res = collectCandidates({ excludeSelector: SNIFF_EXCLUDE_SELECTOR });
        if (runIdRef.current !== runId) return;
        setTotal(res.items.length);
        setTruncated(res.truncated);
        setExcluded(res.excluded);

        if (!res.items.length) {
            setPhase('done');
            addLog('[图片嗅探] 本页未发现图片（可先滚动页面让懒加载的图出现）', 'info');
            return;
        }
        addLog('[图片嗅探] 候选 ' + res.items.length + ' 张，正在测量大小…', 'info');

        void resolveSizes(res.items, {
            onItem: (it) => {
                if (runIdRef.current !== runId) return;
                bufRef.current.push(it);
                scheduleFlush();
            },
            // 面板已关闭 / 重扫：在飞请求拦不住，但结果会被丢弃
            shouldStop: () => runIdRef.current !== runId,
        }).then(() => {
            if (runIdRef.current !== runId) return;
            flush();
            setPhase('done');
            addLog('[图片嗅探] 测量完成，共 ' + res.items.length + ' 张候选', 'success');
        });
    }, [flush, scheduleFlush]);

    /**
     * 打开即扫；关闭时作废在飞结果。
     * ⚠️ 关闭不能只清状态：测量是异步的，不递增 runId 的话「关掉再打开」会被上一轮回调污染。
     */
    useEffect(() => {
        if (!open) {
            runIdRef.current++;
            if (timerRef.current !== null) {
                window.clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            bufRef.current = [];
            return;
        }
        startScan();
    }, [open, startScan]);

    /** 预览开关 → 压掉/恢复所有下层浮层遮罩（幂等，CSS 只在共享层注入一份） */
    useEffect(() => {
        syncPreviewMask(previewOpen);
        return () => syncPreviewMask(false);
    }, [previewOpen]);

    /** 阈值（KB → 字节），坏值兜底 */
    const minBytes = useMemo(() => {
        const kb = Number.isFinite(minKB) && minKB > 0 ? minKB : DEFAULT_MIN_KB;
        return kb * 1024;
    }, [minKB]);

    /** 丢掉「测出来根本不是图片」的条目（Content-Type 明确是 text/video/json 等） */
    const kept = useMemo(() => probed.filter((i) => !i.drop), [probed]);
    /** 达标（已知大小且不小于阈值），按体积从大到小 */
    const known = useMemo(() => {
        const list = kept.filter((i) => i.size !== null && i.size >= minBytes);
        list.sort((a, b) => (b.size as number) - (a.size as number));
        return list;
    }, [kept, minBytes]);
    /** 大小未知：保留、折叠 */
    const unknown = useMemo(() => kept.filter((i) => i.size === null), [kept]);
    /**
     * 未被阈值过滤的图（达标 + 大小未知）：**标题计数、全选、批量下载的唯一范围**。
     * 小于阈值的图只影响「列表里没有它」，不该被任何计数或批量动作带上（v26.10.10-v6）。
     */
    const pickable = useMemo(() => known.concat(unknown), [known, unknown]);
    /** 「测出来不是图片」被丢弃的张数 */
    const droppedCount = probed.length - kept.length;
    /** 实际渲染的列表：展开未知组时追加在后面（顺序 = 预览 items 的顺序，必须一致） */
    const shown = useMemo(() => (unknownOpen ? known.concat(unknown) : known), [known, unknown, unknownOpen]);

    const toggleOne = useCallback((key: string) => {
        setSelected((prev) => {
            const next = new Set<string>(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    const allSelected = pickable.length > 0 && pickable.every((i) => selected.has(i.key));

    /**
     * 全选 / 取消全选：范围是**全部达标 + 未知**（不止当前可见的那批），
     * 但**不含被阈值过滤掉的图** —— 它们不在列表里，被一起选上再下载就是「下了看不到的图」（v26.10.10-v6）。
     */
    const toggleAll = useCallback(() => {
        setSelected((prev) => {
            const all = pickable.every((i) => prev.has(i.key));
            return all ? new Set<string>() : new Set<string>(pickable.map((i) => i.key));
        });
    }, [pickable]);

    /** 打印对话框上的文档标题（react-to-print 会临时改写 document.title 再还原） */
    const printTitleRef = useRef('图片');

    /**
     * 打印能力来自 react-to-print，参数与「历史记录」完全一致 ——
     * ignoreGlobalStyles 必须显式 true（否则宿主页的全部样式会被抄进打印 iframe），
     * A4 版式来自共享层 PRINT_PAGE_STYLE（@page 直接注入打印窗口最可靠）。
     */
    const doPrint = useReactToPrint({
        ignoreGlobalStyles: true,
        documentTitle: () => printTitleRef.current,
        pageStyle: PRINT_PAGE_STYLE,
    });

    /**
     * 打印某一张图的**原图**并按 A4 自适应（横图自动旋转 90 度，见 shared/preview/print.ts）。
     * ⚠️ 不能依赖 <img> 的 onLoad 改样式：react-to-print 克隆的是独立节点，
     *    故先用游离 Image 量出自然宽高，再构造好节点交给 doPrint（同「历史记录」的做法）。
     */
    const printImage = useCallback(
        (it: SniffedImage, idx: number) => {
            const fname = sniffFileName(it.url, it.mime, idx);
            printTitleRef.current = fname;
            addLog('打印图片: ' + fname, 'success');
            const probe = document.createElement('img');
            probe.onload = () =>
                doPrint(() =>
                    buildA4ImageNode(it.url, fname, {
                        width: probe.naturalWidth,
                        height: probe.naturalHeight,
                    })
                );
            probe.onerror = () => doPrint(() => buildA4ImageNode(it.url, fname));
            probe.src = it.url;
        },
        [doPrint]
    );

    /** 单张下载：跨域图走 GM_xhr 取二进制（直接给 <a download> 会被忽略而变成导航） */
    const doDownloadOne = useCallback(async (it: SniffedImage, idx: number) => {
        const fname = sniffFileName(it.url, it.mime, idx);
        setBusyKey(it.key);
        try {
            const ok = await downloadImage(it.url, fname);
            addLog(ok ? '图片已下载: ' + fname : '[图片嗅探] 下载失败: ' + fname, ok ? 'success' : 'error');
        } finally {
            setBusyKey(null);
        }
    }, []);

    /**
     * 批量下载：串行 + 间隔，避免浏览器把连续下载当弹窗拦截 / 静默丢弃。
     * 范围是 pickable（未被阈值过滤的图）∩ 选中集：即使用户调高阈值后 selection 里残留了失效的 key，
     * 也不会把已经被过滤掉的图下载下来（v26.10.10-v6）。
     */
    const doDownloadSelected = useCallback(async () => {
        const list = pickable.filter((i) => selected.has(i.key));
        if (!list.length) return;
        setBatch({ done: 0, total: list.length });
        let ok = 0;
        try {
            for (let i = 0; i < list.length; i++) {
                const it = list[i];
                // 文件名里的序号用**展示顺序**，与用户看到的一致
                const at = shown.indexOf(it);
                if (await downloadImage(it.url, sniffFileName(it.url, it.mime, at >= 0 ? at : i))) ok++;
                setBatch({ done: i + 1, total: list.length });
                if (i < list.length - 1) await sleep(BATCH_GAP_MS);
            }
            addLog('[图片嗅探] 批量下载完成：' + ok + '/' + list.length, ok ? 'success' : 'error');
        } finally {
            setBatch(null);
        }
    }, [pickable, selected, shown]);

    /** 选中的、**未被阈值过滤**的张数：按钮文案与禁用态都用它（选中集里可能残留已失效的 key） */
    const selectedCount = useMemo(() => pickable.filter((i) => selected.has(i.key)).length, [pickable, selected]);

    /** 单张卡片的元信息（来源、测量方式）合成一句话，hover 可见 */
    const metaOf = (it: SniffedImage) =>
        '来源：' + it.sources.map((s) => SOURCE_LABEL[s]).join(' / ') + '；大小来源：' + VIA_LABEL[it.sizeVia];

    const renderCard = (it: SniffedImage, idx: number) => {
        const fname = sniffFileName(it.url, it.mime, idx);
        return (
            <div key={it.key} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ position: 'relative' }}>
                    <Image
                        src={it.url}
                        alt={fname}
                        style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8 }}
                    />
                    {/* 勾选框压在缩略图左上角：点它只切换勾选，不会触发 Image 自己的放大预览 */}
                    <Checkbox
                        checked={selected.has(it.key)}
                        onChange={() => toggleOne(it.key)}
                        style={{ position: 'absolute', left: 6, top: 6, zIndex: 2 }}
                    />
                </div>
                <Text ellipsis style={{ fontSize: 11, marginTop: 4 }} title={fname}>
                    {fname}
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }} title={metaOf(it)}>
                    {formatBytes(it.size)}
                    {it.width && it.height ? ' · ' + it.width + '×' + it.height : ''}
                </Text>
                <Space size={4} style={{ marginTop: 4, width: '100%' }}>
                    <Button
                        size="small"
                        style={{ flex: 1 }}
                        loading={busyKey === it.key}
                        onClick={() => void doDownloadOne(it, idx)}>
                        下载
                    </Button>
                    <Button size="small" style={{ flex: 1 }} onClick={() => printImage(it, idx)}>
                        打印
                    </Button>
                </Space>
            </div>
        );
    };

    /** 进度：已测 / 总数 */
    const percent = total > 0 ? Math.min(100, Math.round((probed.length / total) * 100)) : 0;

    return (
        <Modal
            open={open}
            title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span>{'图片嗅探（共 ' + pickable.length + ' 张）'}</span>
                    <Button size="small" loading={phase === 'measuring'} onClick={startScan}>
                        {phase === 'measuring' ? '扫描中…' : '重新扫描'}
                    </Button>
                </div>
            }
            onCancel={onClose}
            getContainer={getOverlayContainer}
            width={720}
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            // 预览打开时撤掉本弹窗遮罩：预览是全屏浮层，这层遮罩只会让画面多暗一层（同「历史记录」）
            mask={!previewOpen}
            footer={
                <Space>
                    <Button
                        disabled={!selectedCount || !!batch}
                        loading={!!batch}
                        onClick={() => void doDownloadSelected()}>
                        {batch ? '下载中 ' + batch.done + '/' + batch.total : '下载所选（' + selectedCount + '）'}
                    </Button>
                    <Button disabled={!selected.size || !!batch} onClick={() => setSelected(new Set<string>())}>
                        清空选择
                    </Button>
                    <Button color="primary" variant="solid" onClick={onClose}>
                        关闭
                    </Button>
                </Space>
            }>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                    只列出 ≥
                </Text>
                <InputNumber
                    size="small"
                    min={1}
                    max={10240}
                    step={10}
                    value={minKB}
                    addonAfter="KB"
                    style={{ width: 132 }}
                    onChange={(v) =>
                        onMinKBChange(Number.isFinite(v) && !!v && v > 0 ? Math.round(v as number) : DEFAULT_MIN_KB)
                    }
                />
                {/* 不写「另有 N 张小于阈值」（用户 v26.10.10-v6 要求）：小于阈值的图既不显示也不参与勾选 */}
                <Text type="secondary" style={{ fontSize: 12 }}>
                    {'的图片（显示 ' + known.length + ' 张）'}
                </Text>
                <Checkbox checked={allSelected} disabled={!kept.length} onChange={toggleAll}>
                    全选
                </Checkbox>
            </div>

            {truncated ? (
                <Text type="warning" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    {'页面元素太多或图片超过 ' + MAX_SNIFF + ' 张，本次只扫描了前一部分 —— 结果可能不完整。'}
                </Text>
            ) : null}
            {droppedCount > 0 ? (
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    {'已排除 ' + droppedCount + ' 个响应不是图片的地址（视频 / 网页 / JSON 等）。'}
                </Text>
            ) : null}
            {excluded > 0 ? (
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    {'已按文件名排除 ' + excluded + ' 张（' + EXCLUDED_NAME_PATTERNS.join(' / ') + '）。'}
                </Text>
            ) : null}

            {phase === 'measuring' && !probed.length ? (
                <div style={{ padding: '24px 0', textAlign: 'center' }}>
                    <Progress percent={percent} size="small" style={{ maxWidth: 320 }} />
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                        {'正在测量大小…（' + probed.length + '/' + total + '）'}
                    </Text>
                </div>
            ) : !kept.length ? (
                <Empty
                    description={
                        phase === 'measuring'
                            ? '正在测量大小…'
                            : total
                            ? '扫描到 ' + total + ' 个候选，但都被阈值或类型过滤掉了（可调低阈值再试）'
                            : '未在当前页面发现图片'
                    }
                />
            ) : (
                <>
                    {/* 预览组包住两个网格：items 顺序必须与下面渲染顺序一致（达标在前、未知组在后） */}
                    <Image.PreviewGroup
                        items={shown.map((i) => i.url)}
                        preview={{
                            /**
                             * ⚠️ 必须显式指定挂载容器（原因见 shared/preview/host.ts）：
                             * 税务页 body 带 transform 时，antd 默认 portal 到 body 会把预览困在 body 盒子里。
                             */
                            getContainer: getPreviewHost,
                            onOpenChange: (o: boolean) => setPreviewOpen(o),
                            /** 工具栏追加「打印」（走共享层的 appendPreviewActions，与手机页同一份） */
                            actionsRender: (originalNode, info) => {
                                const printBtn = (
                                    <button
                                        key="znhd-print"
                                        type="button"
                                        className="ant-image-preview-actions-action"
                                        aria-label="print"
                                        title="打印原图"
                                        onClick={() => {
                                            const found = shown.findIndex((i) => i.url === info.image?.url);
                                            const at = found >= 0 ? found : info.current;
                                            if (shown[at]) printImage(shown[at], at);
                                        }}>
                                        <PrinterOutlined />
                                    </button>
                                );
                                return appendPreviewActions(originalNode, printBtn);
                            },
                        }}>
                        <div style={{ maxHeight: '58vh', overflow: 'auto' }}>
                            <div style={GRID_STYLE}>{known.map((it, idx) => renderCard(it, idx))}</div>
                            {unknownOpen && unknown.length > 0 ? (
                                <div style={{ ...GRID_STYLE, marginTop: 8 }}>
                                    {unknown.map((it, idx) => renderCard(it, known.length + idx))}
                                </div>
                            ) : null}
                        </div>
                    </Image.PreviewGroup>
                    {unknown.length > 0 ? (
                        <div style={{ marginTop: 6 }}>
                            <Button
                                type="link"
                                size="small"
                                style={{ padding: 0 }}
                                onClick={() => setUnknownOpen(!unknownOpen)}>
                                {unknownOpen ? '▾' : '▸'} {'大小未知（' + unknown.length + '）'}
                            </Button>
                            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                                量不出字节数（跨域响应头被拒等），可能有大图，已保留
                            </Text>
                        </div>
                    ) : null}
                </>
            )}

            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                提示：单击缩略图可放大 / 多图切换，放大后工具栏上的「打印」按 A4 打印原图（横图自动旋转 90 度）；
                勾选后可批量下载。视频已在扫描阶段排除，动图（gif）按图片保留。
            </Text>
        </Modal>
    );
}
