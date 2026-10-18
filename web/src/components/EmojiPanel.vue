<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
    cachedEmojiBlob,
    loadEmojiBlob,
    loadEmojiPacks,
    type EmojiItem,
    type EmojiPack,
    type PickedEmoji,
} from '../lib/emojiPack';

/**
 * 手机端在线表情面板（v26.10.13-v3；v26.10.18-v7 由 React 组件重写为 Vue）。
 *
 * 与脚本端 `EmojiPackPanel`（Popover 浮层 + 悬停放大预览）的差异：
 *   · 手机页是**内嵌**在输入区里（工具栏上方），不用 Popover —— 触屏没有 hover，
 *     「悬停 0.5s 放大预览」在触屏上无从触发，做了也用不上；
 *   · 结构保持同款：顶部合集 chips（可横滑）+「刷新」→ 8 列图片网格 → 底部提示，
 *     数据层 `web/src/lib/emojiPack.ts` 与脚本端共用同一份 8 合集清单；
 *   · 点一张 = 直接把 blob 交回调用方（App.vue 随即 base64 POST 到中继），
 *     与脚本端「点表情直接发送」同语义。
 *
 * 分批下载：合集最多 134 张，一次并发 8 张 → 首屏很快就有图，剩下的后台补；
 * 已下好的（缓存命中）同步填进去，切走再切回来秒开。
 */

/** 每批并发下载的张数：太多瞬间打满连接，太少首屏出图慢（与脚本端一致） */
const BATCH = 8;

const emit = defineEmits<{ (e: 'pick', emoji: PickedEmoji): void }>();

const packs = ref<EmojiPack[] | null>(null);
const err = ref('');
const activeId = ref('');
const busy = ref(false);
/** url -> objectURL（已下好的图） */
const ready = ref<Record<string, string>>({});
/** 正在临时补下载的那张（用户点得比下载快） */
const pendingKey = ref('');

function load(force: boolean) {
    busy.value = true;
    err.value = '';
    loadEmojiPacks(force)
        .then((list) => {
            packs.value = list;
            // 默认选第一组；刷新后尽量留在原来的组
            const prev = activeId.value;
            activeId.value = prev && list.some((p) => p.id === prev) ? prev : list[0].id;
        })
        .catch((e: { message?: string }) => {
            err.value = (e && e.message) || '表情包加载失败';
        })
        .finally(() => {
            busy.value = false;
        });
}

const activePack = computed(() => (packs.value || []).find((p) => p.id === activeId.value) || null);

// 首屏加载一次
load(false);

/**
 * 当前合集的图片：缓存命中的同步填，其余分批下载（切组合集会取消上一轮）。
 * ⚠️ 取消靠局部 `cancelled` 标志 + 每轮 await 后复查 —— 不能用「清空队列」代替，
 *    否则上一轮的 Promise 落地时仍会把旧合集的图写进 ready（串图）。
 */
watch(activePack, (pack) => {
    if (!pack) return;
    let cancelled = false;
    const cached: Record<string, string> = {};
    const queue: EmojiItem[] = [];
    pack.items.forEach((it) => {
        const hit = cachedEmojiBlob(it.url, it.path);
        if (hit) cached[it.url] = hit.objectUrl;
        else queue.push(it);
    });
    if (Object.keys(cached).length) ready.value = { ...ready.value, ...cached };

    const run = async () => {
        while (queue.length && !cancelled) {
            const batch = queue.splice(0, BATCH);
            const results = await Promise.allSettled(batch.map((it) => loadEmojiBlob(it.url, it.path)));
            if (cancelled) return;
            const add: Record<string, string> = {};
            results.forEach((r, i) => {
                if (r.status === 'fulfilled') add[batch[i].url] = r.value.objectUrl;
            });
            if (Object.keys(add).length) ready.value = { ...ready.value, ...add };
        }
    };
    void run();

    return () => {
        cancelled = true;
    };
});

function pick(it: EmojiItem) {
    const pack = activePack.value;
    if (!pack) return;
    const hit = cachedEmojiBlob(it.url, it.path);
    if (hit) {
        emit('pick', { pack: pack.name, key: it.key, url: it.url, name: it.name, blob: hit.blob });
        return;
    }
    // 还没下好（用户手比下载快）：等这张下完再交出去 —— 别让点击石沉大海。
    // ⚠️ 不把未就绪的格子做成 disabled：disabled 的按钮点了完全没反馈，用户只会以为坏了。
    pendingKey.value = it.url;
    loadEmojiBlob(it.url, it.path)
        .then((entry) => emit('pick', { pack: pack.name, key: it.key, url: it.url, name: it.name, blob: entry.blob }))
        .catch(() => {
            /* 下载失败：格子保持占位，用户可重试或点刷新 */
        })
        .finally(() => {
            if (pendingKey.value === it.url) pendingKey.value = '';
        });
}
</script>

<template>
    <div class="znhd-emoji-panel">
        <div class="znhd-emoji-chips">
            <div class="znhd-emoji-chips-scroll">
                <button
                    v-for="p in packs || []"
                    :key="p.id"
                    type="button"
                    class="znhd-emoji-chip"
                    :aria-pressed="p.id === activeId"
                    @click="activeId = p.id">
                    {{ p.name }}
                </button>
            </div>
            <button type="button" class="znhd-emoji-refresh" aria-label="刷新表情包" :disabled="busy" @click="load(true)">
                刷新
            </button>
        </div>

        <div v-if="err" class="znhd-emoji-state">
            <div>{{ err }}</div>
            <button type="button" class="znhd-emoji-retry" @click="load(true)">重试</button>
        </div>
        <div v-else-if="!packs" class="znhd-emoji-state">正在加载表情包…</div>
        <div v-else class="znhd-emoji-grid">
            <button
                v-for="it in activePack ? activePack.items : []"
                :key="it.url"
                type="button"
                class="znhd-emoji-item"
                :aria-label="'表情 ' + it.name"
                :title="it.key"
                :aria-busy="pendingKey === it.url"
                @click="pick(it)">
                <img v-if="ready[it.url]" :src="ready[it.url]" :alt="it.key" />
            </button>
        </div>

        <div class="znhd-emoji-tip">点表情直接发送到电脑</div>
    </div>
</template>
