<script setup lang="ts">
import type { BitableDoc } from '@/lib/feishu/search';
import { searchDocs } from '@/lib/feishu/service';
import { Icon } from '@vue/icons';
import { ref, watch } from 'vue';
import AppDialog from './AppDialog.vue';

/**
 * 「从飞书选择多维表格」弹窗（v26.10.24-v6）。
 *
 * 解决的是「不想手粘分享链接」：列出当前账号**有权访问的全部多维表格**，
 * 点一条就把它的链接回填到设置面板的「规则表链接」。
 *
 * ── 为什么要单独一个弹窗（而不是在区块里内联展开）────────────────────────────
 * 结果可能有几十条、还要分页，内联展开会把设置面板撑得很长；弹窗还能复用
 * `AppDialog` 的焦点陷阱 / Esc 关闭 / 背景锁定。
 *
 * ── 嵌套在设置弹窗里的关键 ──────────────────────────────────────────────────
 * `AppDialog` 用原生 `showModal()` 打开 ⇒ 进浏览器 top layer，天然盖在设置弹窗
 * 之上，不依赖 z-index。反过来若用 `modal-open` class 切换，两个 dialog 的
 * z-index 相同会互相盖（本项目冒烟曾因多层 Modal 同屏踩过）。
 *
 * ── 打开即搜 ────────────────────────────────────────────────────────────────
 * query 留空 + `doc_types: ['bitable']` = 「按类型浏览」，一进来就能看到全部表，
 * 不用先想关键词。
 *
 * ⚠️ 请求竞态：连点搜索时只认最后一次（`seq`），否则慢的旧响应会把新结果覆盖掉。
 */
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ picked: [string] }>();

const keyword = ref('');
const items = ref<BitableDoc[]>([]);
const nextToken = ref('');
const hasMore = ref(false);
const loading = ref(false);
const searched = ref(false);
const errorText = ref('');
/** 请求序号：只让最后一次请求写结果 */
let seq = 0;

async function run(more = false): Promise<void> {
    if (loading.value) return;
    loading.value = true;
    errorText.value = '';
    const current = ++seq;
    try {
        // 翻页沿用**发起搜索时**的关键词：使用者翻页后又改了输入框，
        // 第二页会跟第一页对不上
        const page = await searchDocs(keyword.value, more ? nextToken.value : '');
        if (current !== seq) return;
        items.value = more ? items.value.concat(page.items) : page.items;
        nextToken.value = page.pageToken;
        hasMore.value = page.hasMore;
        searched.value = true;
    } catch (e) {
        if (current !== seq) return;
        errorText.value = (e as Error)?.message || '搜索失败';
        if (!more) items.value = [];
    } finally {
        if (current === seq) loading.value = false;
    }
}

function pick(it: BitableDoc): void {
    emit('picked', it.url);
    open.value = false;
}

/** 每次打开都从干净状态开始（上一轮的列表/错误/游标全部清掉） */
watch(open, (v) => {
    if (!v) return;
    seq++;
    items.value = [];
    nextToken.value = '';
    hasMore.value = false;
    searched.value = false;
    errorText.value = '';
    loading.value = false;
    void run(false);
});

/** 类型标签：bitable 是我们要的主角，其余如实显示（知识库节点也算可用来源） */
function typeText(t: string): string {
    if (t === 'bitable') return '多维表格';
    if (t === 'wiki') return '知识库';
    return t || '文档';
}

function timeText(ms: number): string {
    if (!ms) return '';
    const d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
</script>

<template>
    <AppDialog v-model:open="open" title="从飞书选择多维表格" :width="560" :footer="false">
        <div class="join mt-2 w-full">
            <label class="input input-sm join-item flex min-w-0 flex-1 items-center gap-1.5">
                <Icon name="search" :size="13" class="shrink-0 opacity-50" />
                <input
                    v-model="keyword"
                    type="text"
                    class="min-w-0 flex-1 text-[13px]"
                    placeholder="搜索表格标题，留空列出全部"
                    spellcheck="false"
                    data-znhd="quick-reply-table-search" />
            </label>
            <button class="btn btn-neutral btn-sm join-item shrink-0" :disabled="loading" @click="run(false)">
                {{ loading ? '搜索中…' : '搜索' }}
            </button>
        </div>

        <p class="mt-1 text-[11px] leading-4 text-base-content/50">
            只列出当前飞书账号<strong class="font-semibold">有权访问</strong>的多维表格（含别人分享给你的）；关键词最多 30 字。
        </p>

        <p v-if="errorText" class="mt-2 text-[12px] leading-5 break-words text-error">{{ errorText }}</p>

        <div v-if="items.length" class="mt-2 max-h-[46vh] overflow-y-auto" data-znhd="quick-reply-table-list">
            <button
                v-for="it in items"
                :key="it.url"
                type="button"
                class="flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-base-200"
                @click="pick(it)">
                <Icon name="grid" :size="15" class="mt-0.5 shrink-0 opacity-60" />
                <span class="min-w-0 flex-1">
                    <span class="block truncate text-[13px]">{{ it.title }}</span>
                    <span class="mt-0.5 flex items-center gap-2 text-[11px] text-base-content/50">
                        <span class="badge badge-ghost badge-xs">{{ typeText(it.type) }}</span>
                        <span v-if="it.editedAt" class="tabular-nums">{{ timeText(it.editedAt) }}</span>
                    </span>
                </span>
            </button>
        </div>

        <p
            v-else-if="searched && !loading && !errorText"
            class="mt-3 text-[12px] leading-5 text-base-content/50">
            没有搜到多维表格。确认这个飞书账号里确实有表，或换个关键词再试。
        </p>

        <div v-if="hasMore" class="mt-2 text-center">
            <button class="btn btn-ghost btn-sm" :disabled="loading" @click="run(true)">
                {{ loading ? '加载中…' : '加载更多' }}
            </button>
        </div>
    </AppDialog>
</template>
