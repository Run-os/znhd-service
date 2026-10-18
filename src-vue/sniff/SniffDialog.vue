<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { addLog } from '@/lib/logger';
import { SNIFF_EXCLUDE_SELECTOR } from '@/lib/ui/sniffSelector';
import {
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
import {
    buildConvContext,
    groupByConversation,
    persistConvContext,
    timeOfItem,
    type ConvContext,
    type ConvSection,
} from '@/lib/sniffConv';
import { Icon } from '@vue/icons';
import { Button } from '@vue/components/ui/button';
import { Checkbox } from '@vue/components/ui/checkbox';
import { Progress } from '@vue/components/ui/progress';
import { Input } from '@vue/components/ui/input';
import { Badge } from '@vue/components/ui/badge';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@vue/components/ui/empty';
import ImageActions from '@vue/components/media/ImageActions.vue';
import ImagePreview from '@vue/components/media/ImagePreview.vue';
import type { ImageAction } from '@vue/components/media/types';
import { printA4Image } from '@vue/lib/print';
import AppDialog from '@vue/panel/AppDialog.vue';

/**
 * 「图片嗅探」弹窗（Vue 版，v26.10.18-v6；原型是 `lib/ui/SniffModal.tsx`）.
 *
 * 业务逻辑（收集候选 / 测大小 / 会话归组 / 批量下载）**原样复用** `lib/sniffer.ts` 与
 * `lib/sniffConv.ts`，这里只重写渲染与交互。三条设计红线与 React 版完全一致：
 *  1) **扫描必须排除本脚本自己的宿主**（`SNIFF_EXCLUDE_SELECTOR`）：面板里全是内联 SVG 图标，
 *     不排除就是「自己嗅自己」；
 *  2) **阈值只影响显示与下载，不影响请求**：先零成本收集，再按需测量；
 *  3) **大小未知的图不丢**：跨域读不到字节数的大图往往正是用户要的，折叠保留、可照常预览/下载/打印。
 *
 * 与 React 版的实现差异（都是「换成官方组件」带来的，行为不变）：
 *  · `Modal` → 面板统一的 **AppDialog**（Dialog + Card）；左侧对齐、828 宽、标题栏内嵌「重新扫描」；
 *  · antd `Image.PreviewGroup` → 共用 **ImagePreview**（Teleport 进 shadowRoot，缩放/旋转/打印/Esc 全有，
 *    items 顺序必须与渲染顺序一致，下标定位才准）；
 *  · antd `Checkbox` / `Progress` / `InputNumber` / `Tag` / `Empty` → 官方 Checkbox / Progress /
 *    Input（数字）+ Badge / Empty；
 *  · antd `Image` 点击放大 → `<img>` + `@click` 手动开 ImagePreview（直接给下标，不依赖 PreviewGroup 的隐式定位）。
 *
 * 异步测量仍按 150ms 合批推给界面（300 张图逐张赋值会把主线程拖哭），测完才排序，
 * 关闭 / 重扫靠 `runId` 作废在飞结果 —— 这三条是 React 版踩出来的，别改回去。
 */
const open = defineModel<boolean>('open', { default: false });

const props = defineProps<{
    /**
     * 显示/下载阈值（KB）：持久化在 Allvalue.sniffMinKB，不是组件局部状态。
     * ⚠️ 名字用 `minKb` 而不是 `minKB`：模板里 `:min-kb` 只会被推导成 `minKb`，
     *    写成 `minKB` 时这个 kebab 绑定**不生效**（vue-tsc 直接报缺 prop）。
     */
    minKb: number;
}>();

const emit = defineEmits<{ (e: 'update:minKb', v: number): void }>();

/** 每完成这么多毫秒把测好的图推给界面一次（合批） */
const FLUSH_MS = 150;
/** 批量下载触发段的间隔：浏览器对同页面连续下载有节流，太快会静默丢文件 */
const BATCH_GAP_MS = 400;
/** 阈值兜底（KB）：存量数据里的 sniffMinKB 可能是坏值，消费点自己兜一次 */
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

/*
 * 「没拿到消息时间」的标记方式（v26.10.19 改）：**文件名文字标红**，不再给卡片加红圈
 * （红圈是 v26.10.16-v3 的做法，用 box-shadow 铺两层；用户要求改成文字标红）。
 * 判据仍是同一个出口 `noTimeOf`（= `timeOfItem` 为 null），与排序里被殿后的那批严格一致。
 */

/** 本轮扫描到哪一步 */
const phase = ref<'measuring' | 'done'>('done');
/** 已量完的图（完成顺序，不是文档顺序；展示时才排序） */
const probed = ref<SniffedImage[]>([]);
/** 本轮候选总数（进度条分母） */
const total = ref(0);
/** 候选被上限截断（CSS 遍历元素数 / MAX_SNIFF） */
const truncated = ref(false);
/** 被名称/后缀规则排除的张数（界面上不显示，只作 data-sniff-excluded 钩子给冒烟读） */
const excluded = ref(0);
/** 哪些分组的「大小未知」档是展开的（默认全折叠），键是分组 id（未归属为 ''） */
const openUnknown = ref<Set<string>>(new Set());
/**
 * 本轮扫描的会话归属上下文（页面上取不到会话信息时为 null ⇒ 退化成平铺列表）。
 * ⚠️ 必须 `shallowRef`：`ConvContext` 里的 `byStem` 是 Map，`ref` 会把它包成 reactive proxy，
 *    类型（`Map & Omit<...>`）与 `ConvContext` 不再兼容，传给 sniffConv/groupByConversation 会报错。
 *    这里只整体替换、不深度修改，shallowRef 语义正好。
 */
const convCtx = shallowRef<ConvContext | null>(null);
/** 勾选（存 key 不用下标：结果集异步增长，下标会错位） */
const selected = ref<Set<string>>(new Set());
/** 正在下载的单张 key（按钮禁用） */
const busyKey = ref<string | null>(null);
/** 批量下载进度（null = 空闲） */
const batch = ref<{ done: number; total: number } | null>(null);
/** 放大预览 */
const previewOpen = ref(false);
const previewIndex = ref(0);

/** 本轮扫描编号：关闭/重扫时自增，作废在飞请求的结果 */
let runId = 0;
/** 待推送到界面的缓冲 */
let buf: SniffedImage[] = [];
/** 合批定时器 */
let timer: number | null = null;

/** 阈值输入框的本地文本（antd InputNumber 是「失焦/回车才提交」，这里用 @change 对齐） */
const minKBText = ref(String(props.minKb || DEFAULT_MIN_KB));
watch(
    () => props.minKb,
    (v) => (minKBText.value = String(v || DEFAULT_MIN_KB))
);

function commitMinKB() {
    const n = Math.round(Number(minKBText.value));
    const next = Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_KB;
    minKBText.value = String(next);
    if (next !== props.minKb) emit('update:minKb', next);
}

function flush() {
    if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
    }
    if (!buf.length) return;
    probed.value = probed.value.concat(buf);
    buf = [];
}

function scheduleFlush() {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
        timer = null;
        flush();
    }, FLUSH_MS);
}

/**
 * 扫一轮：收集候选（同步、零网络）→ 异步测量大小（按需发 HEAD/Range）。
 * 收集阶段同步执行，超大页面可能耗时几十毫秒，故只在用户点按钮 / 打开弹窗之后跑。
 */
function startScan() {
    const id = ++runId;
    buf = [];
    probed.value = [];
    total.value = 0;
    truncated.value = false;
    excluded.value = 0;
    selected.value = new Set();
    openUnknown.value = new Set();
    busyKey.value = null;
    batch.value = null;
    phase.value = 'measuring';

    // 先建「文件名 → 会话」归属上下文（纯读页面 Vuex + localStorage，零网络），
    // 再写回持久层：下次即使切走了会话、Vuex 里没有那条消息，图仍能归回原会话
    const ctx = buildConvContext();
    persistConvContext(ctx);
    convCtx.value = ctx;

    addLog('[图片嗅探] 开始扫描当前页面的图片…', 'info');
    const res = collectCandidates({ excludeSelector: SNIFF_EXCLUDE_SELECTOR });
    if (runId !== id) return;
    total.value = res.items.length;
    truncated.value = res.truncated;
    excluded.value = res.excluded;

    if (!res.items.length) {
        phase.value = 'done';
        addLog('[图片嗅探] 本页未发现图片（可先滚动页面让懒加载的图出现）', 'info');
        return;
    }
    addLog('[图片嗅探] 候选 ' + res.items.length + ' 张，正在测量大小…', 'info');

    void resolveSizes(res.items, {
        onItem: (it) => {
            if (runId !== id) return;
            buf.push(it);
            scheduleFlush();
        },
        // 弹窗已关闭 / 重扫：在飞请求拦不住，但结果会被丢弃
        shouldStop: () => runId !== id,
    }).then(() => {
        if (runId !== id) return;
        flush();
        phase.value = 'done';
        addLog('[图片嗅探] 测量完成，共 ' + res.items.length + ' 张候选', 'success');
    });
}

/** 打开即扫；关闭时作废在飞结果（只清状态不够：异步回调会污染「关掉再打开」） */
watch(open, (v) => {
    if (!v) {
        runId++;
        if (timer !== null) {
            window.clearTimeout(timer);
            timer = null;
        }
        buf = [];
        previewOpen.value = false;
        return;
    }
    startScan();
});

onBeforeUnmount(() => {
    runId++;
    if (timer !== null) window.clearTimeout(timer);
});

/** 阈值（字节），坏值兜底 */
const minBytes = computed(() => {
    const kb = Number.isFinite(props.minKb) && props.minKb > 0 ? props.minKb : DEFAULT_MIN_KB;
    return kb * 1024;
});

/** 丢掉「测出来根本不是图片」的条目（Content-Type 明确是 text/video/json 等） */
const kept = computed(() => probed.value.filter((i) => !i.drop));
/**
 * 按会话分组：`sections` 是**唯一的排序与分桶口径**，下面的计数 / shown / 渲染顺序全部从它派生，
 * 避免「计数一套、渲染一套」漂移。组内已按消息时间从新到旧（无时间的殿后、按体积倒序）。
 */
const sections = computed<Array<ConvSection<SniffedImage>>>(() =>
    groupByConversation(kept.value, convCtx.value, minBytes.value).sections
);
/** 面板要不要画组头：一个具名会话都没有时不画（普通网页上没有「会话」概念） */
const groupedView = computed(() => sections.value.some((s) => !!s.name));
/** 达标图（跨组展平，组序 = 渲染序） */
const known = computed(() => sections.value.flatMap((s) => s.known));
/** 大小未知（保留、折叠） */
const unknown = computed(() => sections.value.flatMap((s) => s.unknown));
/** 未被阈值过滤的图：标题计数 / 全选 / 批量下载的唯一范围 */
const pickable = computed(() => known.value.concat(unknown.value));
/** 「测出来不是图片」被丢弃的张数 */
const droppedCount = computed(() => probed.value.length - kept.value.length);

/**
 * 实际渲染的列表：某组的「大小未知」档展开时，该组未知图追加在该组达标图之后。
 * 顺序**必须**与渲染顺序一致 —— ImagePreview 靠下标定位当前图。
 */
const shown = computed(() => {
    const out: SniffedImage[] = [];
    for (const s of sections.value) {
        for (const it of s.known) out.push(it);
        if (openUnknown.value.has(s.id)) for (const it of s.unknown) out.push(it);
    }
    return out;
});

/** key → 在 shown 里的下标：文件名兜底编号与预览定位都按「用户看到的顺序」算 */
const shownIndex = computed(() => {
    const m = new Map<string, number>();
    shown.value.forEach((it, i) => m.set(it.key, i));
    return m;
});

const fileNameOf = (it: SniffedImage): string => {
    const at = shownIndex.value.get(it.key);
    return sniffFileName(it.url, it.mime, at === undefined ? 0 : at);
};

const allSelected = computed(
    () => pickable.value.length > 0 && pickable.value.every((i) => selected.value.has(i.key))
);

function toggleOne(key: string) {
    const next = new Set(selected.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected.value = next;
}

/** 全选 / 取消全选：范围是全部达标 + 未知，但**不含被阈值过滤掉的图** */
function toggleAll() {
    const all = pickable.value.every((i) => selected.value.has(i.key));
    selected.value = all ? new Set() : new Set(pickable.value.map((i) => i.key));
}

/** 全选 / 取消选中某个会话分组（「把这家纳税人的图都下下来」不该逼用户一张张点） */
function toggleGroup(s: ConvSection<SniffedImage>) {
    const keys = s.known.concat(s.unknown).map((i) => i.key);
    if (!keys.length) return;
    const next = new Set(selected.value);
    const all = keys.every((k) => next.has(k));
    for (const k of keys) {
        if (all) next.delete(k);
        else next.add(k);
    }
    selected.value = next;
}

function toggleUnknown(sectionId: string) {
    const next = new Set(openUnknown.value);
    if (next.has(sectionId)) next.delete(sectionId);
    else next.add(sectionId);
    openUnknown.value = next;
}

/** 选中的、未被阈值过滤的张数（选中集里可能残留失效 key） */
const selectedCount = computed(() => pickable.value.filter((i) => selected.value.has(i.key)).length);

/**
 * 单张卡片的元信息（来源、大小来源、群里发送者）合成一句话，hover 可见。
 * 发送者只在「与会话名不同」时显示 —— 单聊里发送者就是纳税人本人，写出来是重复噪音。
 */
function metaOf(it: SniffedImage): string {
    const conv = it.stem && convCtx.value ? convCtx.value.byStem.get(it.stem) : undefined;
    const sender = conv && conv.sender && conv.sender !== conv.name ? '；发送者：' + conv.sender : '';
    return (
        '来源：' +
        it.sources.map((s) => SOURCE_LABEL[s]).join(' / ') +
        '；大小来源：' +
        VIA_LABEL[it.sizeVia] +
        sender
    );
}

/** 这张图没拿到消息时间（判据必须复用 timeOfItem，与排序里被殿后的那批严格一致） */
const noTimeOf = (it: SniffedImage) => timeOfItem(it, convCtx.value) === null;

function sizeText(it: SniffedImage): string {
    return formatBytes(it.size) + (it.width && it.height ? ' · ' + it.width + '×' + it.height : '');
}

/** 单张下载：跨域图走 GM_xhr 取二进制（直接给 <a download> 会被忽略而变成导航） */
async function doDownloadOne(it: SniffedImage) {
    const fname = fileNameOf(it);
    busyKey.value = it.key;
    try {
        const ok = await downloadImage(it.url, fname);
        addLog(ok ? '图片已下载: ' + fname : '[图片嗅探] 下载失败: ' + fname, ok ? 'success' : 'error');
    } finally {
        busyKey.value = null;
    }
}

/** 单张打印：A4 自适应（横图自动旋转 90 度，见 shared/preview/print.ts） */
function printOne(it: SniffedImage) {
    const fname = fileNameOf(it);
    addLog('打印图片: ' + fname, 'success');
    printA4Image(it.url, fname);
}

/** 打开放大预览：下标按展示顺序取，预览里左右切换的顺序与卡片一致 */
function openPreview(it: SniffedImage) {
    const at = shownIndex.value.get(it.key);
    previewIndex.value = at === undefined ? 0 : at;
    previewOpen.value = true;
}

/**
 * 批量下载（走 `downloadBatch` 两段式流水线：预取并发 + 触发串行带间隔）。
 * 范围是 pickable ∩ 选中集：即使用户调高阈值后 selection 里残留失效 key，也不会下到已被过滤的图。
 */
async function doDownloadSelected() {
    const list = pickable.value.filter((i) => selected.value.has(i.key));
    if (!list.length) return;
    batch.value = { done: 0, total: list.length };
    try {
        const items = list.map((it, i) => {
            const at = shownIndex.value.get(it.key);
            return {
                key: it.key,
                url: it.url,
                filename: sniffFileName(it.url, it.mime, at === undefined ? i : at),
            };
        });
        const res = await downloadBatch(items, {
            gapMs: BATCH_GAP_MS,
            onProgress: (done) => (batch.value = { done, total: list.length }),
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
        batch.value = null;
    }
}

/** 进度：已测 / 总数 */
const percent = computed(() =>
    total.value > 0 ? Math.min(100, Math.round((probed.value.length / total.value) * 100)) : 0
);

/** 组头文案：`会话名（N 张）`；未归属分组（id 为空串）显示「未归属会话」 */
const groupTitle = (s: ConvSection<SniffedImage>) =>
    (s.name || '未归属会话') + '（' + (s.known.length + s.unknown.length) + ' 张）';

/** 「量不出字节数…」这句解释只挂在第一个带未知档的分组后（每组都写一遍是噪音） */
const explainUnknownId = computed(() => {
    const s = sections.value.find((x) => x.unknown.length > 0);
    return s ? s.id : null;
});

const previewUrls = computed(() => shown.value.map((i) => i.url));
const previewNames = computed(() => shown.value.map((i) => fileNameOf(i)));

function actionsOf(it: SniffedImage): ImageAction[] {
    return [
        {
            label: '下载',
            icon: 'download',
            loading: busyKey.value === it.key,
            onClick: () => void doDownloadOne(it),
        },
        { label: '打印', icon: 'printer', onClick: () => printOne(it) },
    ];
}

const emptyText = computed(() => {
    if (phase.value === 'measuring') return '正在测量大小…';
    if (total.value) return '扫描到 ' + total.value + ' 个候选，但都被阈值或类型过滤掉了（可调低阈值再试）';
    return '未在当前页面发现图片';
});
</script>

<template>
    <AppDialog v-model:open="open" :width="828" title="图片嗅探">
        <template #title>
            <span class="shrink-0">图片嗅探（共 {{ pickable.length }} 张）</span>
            <Button
                variant="outline"
                size="xs"
                class="h-6 shrink-0 px-2 text-[11px]"
                :disabled="phase === 'measuring'"
                @click="startScan">
                {{ phase === 'measuring' ? '扫描中…' : '重新扫描' }}
            </Button>
        </template>

        <!-- data-sniff-excluded：被名称/后缀规则排除的张数。界面上不显示这句提示，
             但必须留这个钩子 —— 否则「按文件名排除生效」的断言只能靠「名字没出现」判定，
             而「什么都没渲染」同样满足它（假绿）。 -->
        <div
            class="mb-2 flex flex-wrap items-center gap-2"
            :data-sniff-excluded="excluded">
            <span class="text-xs text-muted-foreground">只列出 ≥</span>
            <div class="relative w-[132px] shrink-0">
                <Input
                    v-model="minKBText"
                    type="number"
                    min="1"
                    max="10240"
                    step="10"
                    class="h-7 pr-9 text-xs"
                    aria-label="最小体积 KB"
                    @change="commitMinKB"
                    @blur="commitMinKB" />
                <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                    KB
                </span>
            </div>
            <span class="text-xs text-muted-foreground">的图片（显示 {{ known.length }} 张）</span>
            <label class="ml-1 flex cursor-pointer items-center gap-1.5 text-xs">
                <Checkbox
                    :model-value="allSelected"
                    :disabled="!kept.length"
                    aria-label="全选"
                    @update:model-value="toggleAll" />
                全选
            </label>
        </div>

        <p v-if="truncated" class="mb-2 text-xs text-destructive">
            页面元素太多或图片超过 {{ MAX_SNIFF }} 张，本次只扫描了前一部分 —— 结果可能不完整。
        </p>
        <p v-if="droppedCount > 0" class="mb-2 text-xs text-muted-foreground">
            已排除 {{ droppedCount }} 个响应不是图片的地址（视频 / 网页 / JSON 等）。
        </p>

        <!-- 测量中且一张都还没回来：进度条（v26.10.19-v3：与列表/空态统一固定 58vh，弹窗高度不随内容抖动） -->
        <div v-if="phase === 'measuring' && !probed.length" class="flex h-[58vh] flex-col items-center justify-center">
            <Progress :model-value="percent" class="mx-auto max-w-[320px]" />
            <p class="mt-2 text-xs text-muted-foreground">
                正在测量大小…（{{ probed.length }}/{{ total }}）
            </p>
        </div>

        <Empty v-else-if="!kept.length" class="h-[58vh] border-0 py-8">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Icon name="image" :size="20" />
                </EmptyMedia>
                <EmptyTitle class="text-sm">没有可显示的图片</EmptyTitle>
                <EmptyDescription class="text-xs">{{ emptyText }}</EmptyDescription>
            </EmptyHeader>
        </Empty>

        <!-- v26.10.19-v3：固定 h-[58vh]（原 max-h）——空态/列表/测量中窗口大小一致 -->
        <div v-else class="h-[58vh] overflow-auto pr-1">
            <div
                v-for="(s, si) in sections"
                :key="s.id || '__unnamed__'"
                :data-sniff-group="s.id"
                :data-sniff-group-name="s.name"
                :data-sniff-group-current="s.current ? '1' : undefined"
                :class="si === 0 ? '' : 'mt-3'">
                <!-- 组头只在真有具名会话时画：普通网页上没有「会话」概念，硬套标题只是噪音 -->
                <div
                    v-if="groupedView && (s.known.length || s.unknown.length)"
                    data-sniff-group-header
                    class="mb-1.5 flex flex-wrap items-center gap-2">
                    <span class="text-xs font-semibold text-foreground">{{ groupTitle(s) }}</span>
                    <Badge v-if="s.current" variant="secondary" class="h-4 px-1.5 text-[10px]">当前会话</Badge>
                    <Button variant="link" size="xs" class="h-auto px-0 text-[11px]" @click="toggleGroup(s)">
                        全选本组
                    </Button>
                </div>

                <div v-if="s.known.length" class="grid grid-cols-5 gap-2">
                    <div
                        v-for="it in s.known"
                        :key="it.key"
                        data-sniff-card
                        :data-sniff-no-time="noTimeOf(it) ? '1' : undefined"
                        class="flex min-w-0 flex-col rounded-xl p-1.5">
                        <div class="relative">
                            <ImageActions :actions="actionsOf(it)">
                                <img
                                    :src="it.url"
                                    :alt="fileNameOf(it)"
                                    draggable="false"
                                    class="aspect-square w-full cursor-zoom-in rounded-lg object-cover"
                                    @click="openPreview(it)" />
                            </ImageActions>
                            <!-- 勾选框压在左上角：点它只切换勾选，不会触发放大 -->
                            <div class="absolute left-1.5 top-1.5 z-[2]" @click.stop>
                                <Checkbox
                                    :model-value="selected.has(it.key)"
                                    :aria-label="'选择 ' + fileNameOf(it)"
                                    @update:model-value="toggleOne(it.key)" />
                            </div>
                        </div>
                        <!-- 文件名：没拿到消息时间的标红（原先用卡片四周的红圈表示） -->
                        <span
                            data-sniff-name
                            class="mt-1 truncate text-[11px] leading-4"
                            :class="noTimeOf(it) ? 'text-destructive' : 'text-muted-foreground'"
                            :title="fileNameOf(it)">
                            {{ fileNameOf(it) }}
                        </span>
                        <span class="truncate text-[11px] leading-4 text-muted-foreground" :title="metaOf(it)">
                            {{ sizeText(it) }}
                        </span>
                    </div>
                </div>

                <div v-if="openUnknown.has(s.id) && s.unknown.length" class="mt-2 grid grid-cols-5 gap-2">
                    <div
                        v-for="it in s.unknown"
                        :key="it.key"
                        data-sniff-card
                        :data-sniff-no-time="noTimeOf(it) ? '1' : undefined"
                        class="flex min-w-0 flex-col rounded-xl p-1.5">
                        <div class="relative">
                            <ImageActions :actions="actionsOf(it)">
                                <img
                                    :src="it.url"
                                    :alt="fileNameOf(it)"
                                    draggable="false"
                                    class="aspect-square w-full cursor-zoom-in rounded-lg object-cover"
                                    @click="openPreview(it)" />
                            </ImageActions>
                            <div class="absolute left-1.5 top-1.5 z-[2]" @click.stop>
                                <Checkbox
                                    :model-value="selected.has(it.key)"
                                    :aria-label="'选择 ' + fileNameOf(it)"
                                    @update:model-value="toggleOne(it.key)" />
                            </div>
                        </div>
                        <!-- 文件名：没拿到消息时间的标红（原先用卡片四周的红圈表示） -->
                        <span
                            data-sniff-name
                            class="mt-1 truncate text-[11px] leading-4"
                            :class="noTimeOf(it) ? 'text-destructive' : 'text-muted-foreground'"
                            :title="fileNameOf(it)">
                            {{ fileNameOf(it) }}
                        </span>
                        <span class="truncate text-[11px] leading-4 text-muted-foreground" :title="metaOf(it)">
                            {{ sizeText(it) }}
                        </span>
                    </div>
                </div>

                <div v-if="s.unknown.length" class="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Button variant="link" size="xs" class="h-auto px-0 text-[11px]" @click="toggleUnknown(s.id)">
                        {{ openUnknown.has(s.id) ? '▾' : '▸' }} 大小未知（{{ s.unknown.length }}）
                    </Button>
                    <span v-if="explainUnknownId === s.id" class="text-[11px] text-muted-foreground">
                        量不出字节数（跨域响应头被拒等），可能有大图，已保留
                    </span>
                </div>
            </div>
        </div>

        <!-- v26.10.19-v3：无图时不渲染内容但保留占位（invisible），弹窗总高与有图时一致 -->
        <p class="mt-2 text-xs leading-5 text-muted-foreground" :class="kept.length ? '' : 'invisible'">
            提示：
            <template v-if="groupedView">图片已按会话（纳税人）分组，组头可直接「全选本组」；</template>
            单击缩略图可放大 / 多图切换，放大后工具栏上的「打印」按 A4 打印原图（横图自动旋转 90 度）；
            勾选后可批量下载。视频已在扫描阶段排除，动图（gif）按图片保留。
        </p>

        <template #footer>
            <Button
                size="sm"
                :disabled="!selectedCount || !!batch"
                @click="void doDownloadSelected()">
                {{ batch ? '下载中 ' + batch.done + '/' + batch.total : '下载所选（' + selectedCount + '）' }}
            </Button>
            <Button
                variant="outline"
                size="sm"
                :disabled="!selected.size || !!batch"
                @click="selected = new Set()">
                清空选择
            </Button>
            <Button variant="secondary" size="sm" @click="open = false">关闭</Button>
        </template>

        <!-- 放大预览：Teleport 进 shadowRoot，层级高于本弹窗 -->
        <ImagePreview
            v-model:open="previewOpen"
            :items="previewUrls"
            :index="previewIndex"
            :names="previewNames" />
    </AppDialog>
</template>
