<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { Spinner } from '@vue/components/ui/spinner';
import { SHADOW_ROOT_KEY } from '@vue/lib/shadow';
import {
    cachedEmojiBlob,
    loadEmojiBlob,
    loadEmojiPacks,
    type EmojiItem,
    type EmojiPack,
} from '@/lib/transfer/emojiPack';
import { Z } from './theme';
import type { PickedEmoji } from './types';

/**
 * 在线表情包面板（v26.10.18-v5，移植自 React 版 `EmojiPackPanel`）。
 *
 * 行为逐条保留（都是用户明确要求过的）：
 *  · **点一张直接发出去**：`pick` 把 blob 一起交回调用方，不再「插字符」；
 *  · **分批下载**（每批 8 张）：首屏快出图，其余后台补，切走再切回命中缓存秒开；
 *  · **悬停 0.5 秒放大**，预览已在屏幕上时移到别的格子**立即换图**；
 *  · 合集用 chips（下拉会与「点外部关闭」抢点击）。
 *
 * ⚠️ 两处与 React 版的实现差异：
 *  ① 悬停委托仍用 mousemove（不用每格 enter/leave）—— enter/leave 在相邻格子间会
 *     「先 leave 再 enter」，导致实时切换失效，这个问题与框架无关；
 *  ② 放大浮层 Teleport 到 shadowRoot：面板在传输助手窗口里，而窗口内容带
 *     `translate(-50%,-50%)`，会成为 `position:fixed` 的包含块 ⇒ 不 Teleport 出去坐标全错
 *     （等价于 React 版 portal 到 `getPreviewHost()` 的理由）。
 */
const emit = defineEmits<{ (e: 'pick', emoji: PickedEmoji): void }>();

const shadowRoot = inject(SHADOW_ROOT_KEY) as unknown as string;

const PANEL_WIDTH = 300;
const BATCH = 8;
const HOVER_DELAY = 500;
const HOVER_BOX = 120;
const HOVER_OFFSET = 16;

const packs = ref<EmojiPack[] | null>(null);
const err = ref('');
const activeId = ref('');
const busy = ref(false);
const ready = ref<Record<string, string>>({});
const pendingKey = ref('');

const hover = ref<{ url: string; x: number; y: number } | null>(null);
let hoverTimer: number | null = null;
let hoverPending = '';
let hoverShown = false;
let hoverPos = { x: 0, y: 0 };

const activePack = computed(() => (packs.value || []).find((p) => p.id === activeId.value) || null);
const pathByUrl = computed(() => {
    const map: Record<string, string> = {};
    (activePack.value ? activePack.value.items : []).forEach((it) => {
        if (it.path) map[it.url] = it.path;
    });
    return map;
});

function clearHoverTimer() {
    if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
        hoverTimer = null;
    }
}

function closeHover() {
    clearHoverTimer();
    hoverPending = '';
    hoverShown = false;
    hover.value = null;
}

async function load(force: boolean) {
    busy.value = true;
    err.value = '';
    try {
        const list = await loadEmojiPacks(force);
        packs.value = list;
        activeId.value = activeId.value && list.some((p) => p.id === activeId.value) ? activeId.value : list[0].id;
    } catch (e) {
        err.value = (e as { message?: string })?.message || '表情包加载失败';
    } finally {
        busy.value = false;
    }
}

load(false);

// 当前合集的图片：缓存命中的同步填，其余分批下载（切合集时旧轮次自行退出）
/** 下载轮次令牌：切合集时换新对象，旧循环在下一批前发现不一致即退出 */
let token: object = {};
watch(
    activePack,
    (pack) => {
        if (!pack) return;
        const myToken = {};
        token = myToken;
        const cached: Record<string, string> = {};
        const queue: EmojiItem[] = [];
        pack.items.forEach((it) => {
            const hit = cachedEmojiBlob(it.url, it.path);
            if (hit) cached[it.url] = hit.objectUrl;
            else queue.push(it);
        });
        if (Object.keys(cached).length) ready.value = { ...ready.value, ...cached };

        const run = async () => {
            while (queue.length) {
                if (token !== myToken) return;
                const batch = queue.splice(0, BATCH);
                const results = await Promise.allSettled(batch.map((it) => loadEmojiBlob(it.url, it.path)));
                if (token !== myToken) return;
                const add: Record<string, string> = {};
                results.forEach((r, i) => {
                    if (r.status === 'fulfilled') add[batch[i].url] = r.value.objectUrl;
                });
                if (Object.keys(add).length) ready.value = { ...ready.value, ...add };
            }
        };
        void run();
    },
    { immediate: true }
);

// 悬停的那张还没下好：补一次（带中继路径，别绕过中继直连 CDN）
watch(hover, (h) => {
    if (!h || ready.value[h.url]) return;
    loadEmojiBlob(h.url, pathByUrl.value[h.url])
        .then((entry) => {
            ready.value = { ...ready.value, [h.url]: entry.objectUrl };
        })
        .catch(() => {
            /* 下载失败：浮层留在加载态，移开即消失 */
        });
});

function pick(it: EmojiItem) {
    if (!activePack.value) return;
    const pack = activePack.value;
    const hit = cachedEmojiBlob(it.url, it.path);
    if (hit) {
        emit('pick', { pack: pack.name, key: it.key, url: it.url, name: it.name, blob: hit.blob });
        return;
    }
    // 手比下载快：等这张下完再交出去，别让点击石沉大海
    pendingKey.value = it.url;
    loadEmojiBlob(it.url, it.path)
        .then((entry) => emit('pick', { pack: pack.name, key: it.key, url: it.url, name: it.name, blob: entry.blob }))
        .catch(() => {
            /* 下载失败：格子保持占位，可重试或点刷新 */
        })
        .finally(() => {
            if (pendingKey.value === it.url) pendingKey.value = '';
        });
}

function onGridMove(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    const cell = target && typeof target.closest === 'function' ? (target.closest('.znhd-emoji-item') as HTMLElement | null) : null;
    const url = cell ? cell.getAttribute('data-emoji-url') || '' : '';
    hoverPos = { x: e.clientX, y: e.clientY };
    if (!url) {
        if (hoverShown) closeHover();
        else clearHoverTimer();
        return;
    }
    if (hoverShown) {
        // 预览已在屏幕上 → 实时换图
        hover.value = { url, x: e.clientX, y: e.clientY };
        return;
    }
    if (hoverPending === url) return; // 同一格继续等，别重置计时
    clearHoverTimer();
    hoverPending = url;
    hoverTimer = window.setTimeout(() => {
        hoverTimer = null;
        hoverShown = true;
        hover.value = { url, x: hoverPos.x, y: hoverPos.y };
    }, HOVER_DELAY);
}

onBeforeUnmount(() => {
    clearHoverTimer();
    token = {};
});

const hoverStyle = computed(() => {
    const h = hover.value;
    if (!h) return {};
    const left = Math.max(8, Math.min(h.x + HOVER_OFFSET, window.innerWidth - HOVER_BOX - 8));
    const top = Math.max(8, Math.min(h.y + HOVER_OFFSET, window.innerHeight - HOVER_BOX - 8));
    return { left: left + 'px', top: top + 'px', width: HOVER_BOX + 'px', height: HOVER_BOX + 'px' };
});
</script>

<template>
    <div data-emoji-panel="1" class="znhd-emoji-panel" :style="{ width: PANEL_WIDTH + 'px' }">
        <!-- 合集 chips + 刷新 -->
        <div class="mb-1.5 flex items-center gap-1.5">
            <div class="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
                <button
                    v-for="p in packs || []"
                    :key="p.id"
                    type="button"
                    :aria-pressed="p.id === activeId"
                    class="h-[22px] shrink-0 cursor-pointer rounded-[11px] border-0 px-2 text-xs outline-none"
                    :class="
                        p.id === activeId
                            ? 'bg-[#07C160]/20 text-[#07C160]'
                            : 'bg-white/[0.06] text-white/75 hover:bg-white/10'
                    "
                    @click="activeId = p.id">
                    {{ p.name }}
                </button>
            </div>
            <button
                type="button"
                aria-label="刷新表情包"
                :disabled="busy"
                class="h-[22px] shrink-0 cursor-pointer rounded border-0 bg-transparent px-1 text-xs text-white/40 outline-none hover:text-white/70 disabled:cursor-default disabled:opacity-50"
                @click="load(true)">
                刷新
            </button>
        </div>

        <!-- 加载失败 -->
        <div v-if="err" class="py-4 text-center">
            <div class="mb-2 text-xs text-white/55">{{ err }}</div>
            <button
                type="button"
                class="cursor-pointer rounded border border-white/20 bg-white/5 px-2.5 py-1 text-xs text-white/80 outline-none hover:bg-white/10"
                @click="load(true)">
                重试
            </button>
        </div>

        <!-- 加载中 -->
        <div v-else-if="!packs" class="py-5 text-center">
            <Spinner class="mx-auto size-4 text-white/60" />
            <div class="mt-2 text-xs text-white/45">正在加载表情包…</div>
        </div>

        <!-- 图片网格（悬停委托挂在网格上） -->
        <div
            v-else
            class="grid max-h-[196px] grid-cols-8 gap-0.5 overflow-y-auto"
            @mousemove="onGridMove"
            @mouseleave="closeHover">
            <button
                v-for="it in activePack ? activePack.items : []"
                :key="it.url"
                type="button"
                class="znhd-emoji-item inline-flex size-[30px] cursor-pointer items-center justify-center rounded border-0 p-0 outline-none"
                :aria-label="'表情 ' + it.name"
                :title="it.key"
                :aria-busy="pendingKey === it.url"
                :data-emoji-url="it.url"
                :style="{
                    background: ready[it.url] ? 'transparent' : 'rgba(255,255,255,0.05)',
                    opacity: pendingKey === it.url ? 0.45 : 1,
                }"
                @click="pick(it)">
                <img v-if="ready[it.url]" :src="ready[it.url]" :alt="it.key" class="block max-h-[26px] max-w-[26px]" />
            </button>
        </div>

        <div class="mt-1.5 text-[11px] text-white/35">点表情直接发送到手机 · 悬停 0.5 秒放大查看</div>

        <!-- 悬停放大：Teleport 出窗口（transform 会困住 fixed 浮层） -->
        <Teleport :to="shadowRoot">
            <div
                v-if="hover"
                class="znhd-emoji-hover pointer-events-none fixed flex items-center justify-center rounded-[10px] border border-white/15 bg-black/80 shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
                :data-emoji-url="hover.url"
                aria-hidden="true"
                :style="[hoverStyle, { zIndex: Z.preview }]">
                <img
                    v-if="ready[hover.url]"
                    :src="ready[hover.url]"
                    alt=""
                    class="block max-h-[104px] max-w-[104px]" />
                <Spinner v-else class="size-4 text-white/60" />
            </div>
        </Teleport>
    </div>
</template>
