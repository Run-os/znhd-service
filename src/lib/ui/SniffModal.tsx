import { Button, Checkbox, Empty, Image, InputNumber, Modal, Progress, Space, Tag, Typography } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { addLog } from '@/lib/logger';
// ⚠️ 三个宿主 id 必须来自**叶子模块**：扫描排除选择器是模块级常量，
// 若从 panelHost 取 OVERLAY_HOST_ID，会因 MainPanel → SniffModal → panelHost 的循环 import
// 命中 TDZ（Cannot access 'OVERLAY_HOST_ID' before initialization），脚本启动即挂（v26.10.10-v4 踩过）。
// v26.10.14-v4：选择器本身也下沉到 `ui/sniffSelector.ts`（后台预测量要用它，见该文件头）。
import { getOverlayContainer } from '@/lib/ui/panelHost';
import { SNIFF_EXCLUDE_SELECTOR } from '@/lib/ui/sniffSelector';
import { DownloadIcon } from '@/lib/ui/icons';
import ImageOverlayActions from '@/lib/ui/ImageOverlayActions';
// 会话归属（v26.10.13-v8）：把图片按会话窗口（纳税人）分组，见 lib/sniffConv.ts 的文件头
import {
    buildConvContext,
    groupByConversation,
    persistConvContext,
    type ConvContext,
    type ConvSection,
} from '@/lib/sniffConv';
import {
    EXCLUDED_NAME_PATTERNS,
    EXCLUDED_NAME_SUFFIXES,
    MAX_SNIFF,
    collectCandidates,
    downloadBatch,
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
import { getPreviewHost } from '../../../shared/preview/host';
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
 * 后缀排除（v26.10.10-v7）：名字以 EXCLUDED_NAME_SUFFIXES（`.svg`）结尾的图同样在收集阶段丢掉。
 * ⚠️ 内联 <svg> 的显示名是 inline-svg-N.svg，因此**内联 SVG 一路也不再有卡片**（有意为之）。
 *
 * 阈值的作用范围（v26.10.10-v6，用户反馈后收紧）：小于阈值的图**只被过滤掉，不再出现在任何计数里**
 * （此前头部会写「另有 N 张小于阈值」），并且**全选 / 批量下载的范围只含未被过滤的图**（达标 + 大小未知）。
 * 旧实现里「全选」选的是 kept（含被阈值挡下的那批），于是「下载所选」会把用户根本看不到的小图一起下载。
 *
 * 大小测量阶梯、视频排除规则、去重与 URL 归一化都在 src/lib/sniffer.ts（纯函数，便于单测）；
 * 「按会话（纳税人）分组」的归属判定与持久化都在 src/lib/sniffConv.ts（同样是纯逻辑 + 读页面 Vuex）；
 * 本文件只负责「合批渲染 + 交互」。测量是异步逐张回来的，所以：
 *  · 结果按 150ms 合批推给状态（300 张图逐张 setState 会把主线程拖哭）；
 *  · 列表在测完之后才按体积排序（边测边排会让卡片来回跳，用户根本点不准）；
 *  · 关闭弹窗 / 重新扫描靠 runIdRef 作废在飞请求的结果（请求本身拦不住，结果丢弃即可）。
 *
 * 分组渲染（v26.10.13-v8）：图先按会话分桶再渲染，**组头只在真有具名会话时才画**
 * （普通网页上没有「会话」概念，硬套一个标题只是噪音；此时分组恰好退化成原来的平铺形态）。
 * 「当前会话」置顶、未归属殿后、组内按体积倒序 —— 排序规则全在 sniffConv.groupByConversation。
 * 组头元素带 `data-sniff-group` / `data-sniff-group-name` / `data-sniff-group-current` 钩子（冒烟用）。
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
 * ⚠️ v26.10.14-v4 起定义在 `ui/sniffSelector.ts`（后台预测量 snifferPre.ts 也要用它，
 *    故下沉到叶子模块，避免 lib 模块 import antd 组件文件）；本文件只 import。
 */

/** 每完成这么多毫秒把测好的图推给界面一次（合批，避免逐张 setState） */
const FLUSH_MS = 150;
/** 批量下载触发段的间隔：浏览器对同一页面连续下载有节流，太快会静默丢文件（v26.10.14-v2 起交给 downloadBatch 的触发段） */
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

/** 取某张图在「展示顺序」（shown）里的下标：拿不到就 0（只影响兜底文件名的编号，不影响功能） */
function idxOf(it: { key: string }, index: Map<string, number>): number {
    const at = index.get(it.key);
    return at === undefined ? 0 : at;
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
    /** 被名称规则（EXCLUDED_NAME_PATTERNS + EXCLUDED_NAME_SUFFIXES）排除的张数 —— 让用户知道「不是没扫到，是按规则排掉了」 */
    const [excluded, setExcluded] = useState(0);
    /**
     * 哪些分组的「大小未知」档是展开的（默认全折叠）。键是分组 id（未归属为 '')。
     * v26.10.13-v8 起从「一个全局布尔」变成「按分组记」—— 分组后每个会话各有各的未知档。
     */
    const [openUnknown, setOpenUnknown] = useState<Set<string>>(() => new Set<string>());
    /**
     * 本轮扫描的会话归属上下文（页面上取不到会话信息时为 null ⇒ 面板退化成原来的平铺列表）。
     * 跟着扫描走而不是每次渲染现读页面：页面状态随时会变，同一次扫描的结果必须口径一致。
     */
    const [convCtx, setConvCtx] = useState<ConvContext | null>(null);
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
        setOpenUnknown(new Set<string>());
        setBusyKey(null);
        setBatch(null);
        setPhase('measuring');

        // 先建「文件名 → 会话」的归属上下文（纯读页面 Vuex + localStorage，零网络），
        // 再把映射写回持久层：下次即使切走了会话、Vuex 里没有那条消息，图仍能归回原会话。
        const ctx = buildConvContext();
        persistConvContext(ctx);
        setConvCtx(ctx);

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
    /**
     * 按会话分组（v26.10.13-v8）。`sections` 是**唯一的排序与分桶口径**：
     * 下面的计数 / shown / 渲染顺序全部从它派生，避免「计数一套、渲染一套」漂移。
     * 组内已按体积倒序排好（沿用原有展示习惯）；小于阈值的图不进任何分组（= v26.10.10-v6 的语义）。
     */
    const sections = useMemo<Array<ConvSection<SniffedImage>>>(
        () => groupByConversation(kept, convCtx, minBytes).sections,
        [kept, convCtx, minBytes]
    );
    /** 面板要不要画组头：一个具名会话都没有时不画（普通网页上没有「会话」概念，标题只是噪音） */
    const groupedView = useMemo(() => sections.some((s) => !!s.name), [sections]);
    /** 达标图（跨组展平，组序 = 渲染序） */
    const known = useMemo(() => sections.flatMap((s) => s.known), [sections]);
    /** 大小未知：保留、折叠 */
    const unknown = useMemo(() => sections.flatMap((s) => s.unknown), [sections]);
    /**
     * 未被阈值过滤的图（达标 + 大小未知）：**标题计数、全选、批量下载的唯一范围**。
     * 小于阈值的图只影响「列表里没有它」，不该被任何计数或批量动作带上（v26.10.10-v6）。
     */
    const pickable = useMemo(() => known.concat(unknown), [known, unknown]);
    /** 「测出来不是图片」被丢弃的张数 */
    const droppedCount = probed.length - kept.length;
    /**
     * 实际渲染的列表：某个分组的「大小未知」档展开时，那一组的未知图追加在该组达标图之后。
     * 顺序**必须**与下面渲染顺序完全一致 —— antd 的 PreviewGroup 靠 items 下标定位当前图。
     */
    const shown = useMemo(() => {
        const out: SniffedImage[] = [];
        for (const s of sections) {
            for (const it of s.known) out.push(it);
            if (openUnknown.has(s.id)) for (const it of s.unknown) out.push(it);
        }
        return out;
    }, [sections, openUnknown]);
    /** key → 在 shown 里的下标：卡片文件名里的序号、打印/预览定位都按「用户看到的顺序」算 */
    const shownIndex = useMemo(() => {
        const m = new Map<string, number>();
        shown.forEach((it, i) => m.set(it.key, i));
        return m;
    }, [shown]);

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

    /**
     * 全选 / 取消选中**某一个会话分组**（v26.10.13-v8，分组后才有的动作）。
     * 范围 = 该组的达标 + 大小未知（与全局「全选」同一套口径，只是限定在组内）——
     * 用户最常见的诉求是「把这家纳税人的图都下下来」，不该逼他一张张点。
     */
    const toggleGroup = useCallback((s: ConvSection<SniffedImage>) => {
        const keys = s.known.concat(s.unknown).map((i) => i.key);
        if (!keys.length) return;
        setSelected((prev) => {
            const next = new Set<string>(prev);
            const all = keys.every((k) => next.has(k));
            for (const k of keys) {
                if (all) next.delete(k);
                else next.add(k);
            }
            return next;
        });
    }, []);

    /** 展开/收起某个分组的「大小未知」档 */
    const toggleUnknown = useCallback((sectionId: string) => {
        setOpenUnknown((prev) => {
            const next = new Set<string>(prev);
            if (next.has(sectionId)) next.delete(sectionId);
            else next.add(sectionId);
            return next;
        });
    }, []);

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
     * 序号不往参数里传：文件名兜底编号必须与卡片上显示的一致，故统一从 shownIndex 取。
     */
    const printImage = useCallback(
        (it: SniffedImage) => {
            const fname = sniffFileName(it.url, it.mime, idxOf(it, shownIndex));
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
        [doPrint, shownIndex]
    );

    /** 单张下载：跨域图走 GM_xhr 取二进制（直接给 <a download> 会被忽略而变成导航） */
    const doDownloadOne = useCallback(
        async (it: SniffedImage) => {
            const fname = sniffFileName(it.url, it.mime, idxOf(it, shownIndex));
            setBusyKey(it.key);
            try {
                const ok = await downloadImage(it.url, fname);
                addLog(ok ? '图片已下载: ' + fname : '[图片嗅探] 下载失败: ' + fname, ok ? 'success' : 'error');
            } finally {
                setBusyKey(null);
            }
        },
        [shownIndex]
    );

    /**
     * 批量下载（v26.10.14-v2 起走 `downloadBatch` 两段式流水线：预取并发 + 触发串行带间隔）。
     * 范围是 pickable（未被阈值过滤的图）∩ 选中集：即使用户调高阈值后 selection 里残留了失效的 key，
     * 也不会把已经被过滤掉的图下载下来（v26.10.10-v6）。
     * 文件名里的序号用**展示顺序**（shownIndex），与用户看到的一致。
     */
    const doDownloadSelected = useCallback(async () => {
        const list = pickable.filter((i) => selected.has(i.key));
        if (!list.length) return;
        setBatch({ done: 0, total: list.length });
        try {
            const items = list.map((it, i) => {
                // shownIndex 缺这个 key 时退回选中集内的位次，与旧实现一致
                const at = shownIndex.get(it.key);
                return {
                    key: it.key,
                    url: it.url,
                    filename: sniffFileName(it.url, it.mime, at === undefined ? i : at),
                };
            });
            const res = await downloadBatch(items, {
                gapMs: BATCH_GAP_MS,
                onProgress: (done) => setBatch({ done: done, total: list.length }),
            });
            const failNote = res.failed.length
                ? '（失败 ' +
                  res.failed.length +
                  '：' +
                  res.failed
                      .slice(0, 3)
                      .map((f) => f.filename)
                      .join('、') +
                  (res.failed.length > 3 ? ' 等' : '') +
                  '）'
                : '';
            addLog(
                '[图片嗅探] 批量下载完成：' + res.ok + '/' + res.total + failNote,
                res.failed.length ? 'error' : 'success'
            );
        } finally {
            setBatch(null);
        }
    }, [pickable, selected, shownIndex]);

    /** 选中的、**未被阈值过滤**的张数：按钮文案与禁用态都用它（选中集里可能残留已失效的 key） */
    const selectedCount = useMemo(() => pickable.filter((i) => selected.has(i.key)).length, [pickable, selected]);

    /**
     * 单张卡片的元信息（来源、测量方式、群里的发送者）合成一句话，hover 可见。
     * 发送者只在「与会话名不同」时显示 —— 单聊里发送者就是纳税人本人，写出来是重复噪音。
     */
    const metaOf = (it: SniffedImage) => {
        const conv = it.stem && convCtx ? convCtx.byStem.get(it.stem) : undefined;
        const sender = conv && conv.sender && conv.sender !== conv.name ? '；发送者：' + conv.sender : '';
        return (
            '来源：' +
            it.sources.map((s) => SOURCE_LABEL[s]).join(' / ') +
            '；大小来源：' +
            VIA_LABEL[it.sizeVia] +
            sender
        );
    };

    /** 卡片（分组只在外面套一层容器，卡片本身与 v26.10.10-v16 完全一致） */
    const renderCard = (it: SniffedImage) => {
        // 序号按**展示顺序**取：文件名兜底编号（znhd-sniff-N）与打印标题都用它，用户看到的才是一致的
        const at = shownIndex.get(it.key);
        const fname = sniffFileName(it.url, it.mime, at === undefined ? 0 : at);
        return (
            <div key={it.key} style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <div style={{ position: 'relative' }}>
                    {/* v26.10.10-v16：下载/打印从图片下方挪到图片右下角，只显示图标、hover 才出现 */}
                    <ImageOverlayActions
                        actions={[
                            {
                                label: '下载',
                                icon: <DownloadIcon size={13} />,
                                loading: busyKey === it.key,
                                onClick: () => void doDownloadOne(it),
                            },
                            {
                                label: '打印',
                                icon: <PrinterOutlined style={{ fontSize: 13 }} />,
                                onClick: () => printImage(it),
                            },
                        ]}>
                        <Image
                            src={it.url}
                            alt={fname}
                            style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8 }}
                        />
                    </ImageOverlayActions>
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
            </div>
        );
    };

    /** 进度：已测 / 总数 */
    const percent = total > 0 ? Math.min(100, Math.round((probed.length / total) * 100)) : 0;

    /** 组头文案：`会话名（N 张）`；未归属分组（id 为空串）显示「未归属会话」 */
    const groupTitle = (s: ConvSection<SniffedImage>) =>
        (s.name || '未归属会话') + '（' + (s.known.length + s.unknown.length) + ' 张）';

    /**
     * 「量不出字节数…」这句解释挂在第一个带「大小未知」档的分组后面（每个分组都写一遍是噪音）。
     * 用分组 id 比对而不是 boolean：未归属分组的 id 是空串，`null !== ''`，两者不会混淆。
     */
    const explainUnknownId = useMemo(() => {
        const s = sections.find((x) => x.unknown.length > 0);
        return s ? s.id : null;
    }, [sections]);

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
                    {'已按文件名排除 ' +
                        excluded +
                        ' 张（' +
                        EXCLUDED_NAME_PATTERNS.concat(EXCLUDED_NAME_SUFFIXES).join(' / ') +
                        '）。'}
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
                    {/* 预览组包住所有分组网格：items 顺序必须与下面渲染顺序一致（组序 → 组内达标 → 组内未知） */}
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
                                            if (shown[at]) printImage(shown[at]);
                                        }}>
                                        <PrinterOutlined />
                                    </button>
                                );
                                return appendPreviewActions(originalNode, printBtn);
                            },
                        }}>
                        <div style={{ maxHeight: '58vh', overflow: 'auto' }}>
                            {sections.map((s, si) => {
                                const open = openUnknown.has(s.id);
                                // 该组一张都没有（如「当前会话」恰好全是小于阈值的图）：不占位置
                                if (!s.known.length && !s.unknown.length) return null;
                                return (
                                    <div
                                        key={s.id || '__unnamed__'}
                                        data-sniff-group={s.id}
                                        data-sniff-group-name={s.name}
                                        {...(s.current ? { 'data-sniff-group-current': '1' } : null)}
                                        style={{ marginTop: si === 0 ? 0 : 12 }}>
                                        {groupedView ? (
                                            <div
                                                data-sniff-group-header
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 8,
                                                    flexWrap: 'wrap',
                                                    marginBottom: 6,
                                                }}>
                                                <Text strong style={{ fontSize: 12 }}>
                                                    {groupTitle(s)}
                                                </Text>
                                                {s.current ? (
                                                    <Tag
                                                        color="blue"
                                                        style={{
                                                            marginInlineEnd: 0,
                                                            fontSize: 11,
                                                            lineHeight: '16px',
                                                        }}>
                                                        当前会话
                                                    </Tag>
                                                ) : null}
                                                <Button
                                                    type="link"
                                                    size="small"
                                                    style={{ padding: 0, fontSize: 12 }}
                                                    onClick={() => toggleGroup(s)}>
                                                    全选本组
                                                </Button>
                                            </div>
                                        ) : null}
                                        <div style={GRID_STYLE}>{s.known.map((it) => renderCard(it))}</div>
                                        {open && s.unknown.length ? (
                                            <div style={{ ...GRID_STYLE, marginTop: 8 }}>
                                                {s.unknown.map((it) => renderCard(it))}
                                            </div>
                                        ) : null}
                                        {s.unknown.length ? (
                                            <div style={{ marginTop: 6 }}>
                                                <Button
                                                    type="link"
                                                    size="small"
                                                    style={{ padding: 0 }}
                                                    onClick={() => toggleUnknown(s.id)}>
                                                    {open ? '▾' : '▸'} {'大小未知（' + s.unknown.length + '）'}
                                                </Button>
                                                {/* 解释文案只在第一个带未知档的分组后出现（每个分组都写一遍是噪音） */}
                                                {explainUnknownId === s.id ? (
                                                    <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                                                        量不出字节数（跨域响应头被拒等），可能有大图，已保留
                                                    </Text>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </Image.PreviewGroup>
                </>
            )}

            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
                提示：
                {groupedView ? '图片已按会话（纳税人）分组，组头可直接「全选本组」；' : ''}
                单击缩略图可放大 / 多图切换，放大后工具栏上的「打印」按 A4 打印原图（横图自动旋转 90 度）；
                勾选后可批量下载。视频已在扫描阶段排除，动图（gif）按图片保留。
            </Text>
        </Modal>
    );
}
