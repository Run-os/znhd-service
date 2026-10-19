<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
    CHANGELOG_DEFAULT_LIMIT,
    getChangelogPageUrl,
    loadChangelog,
    mdToPlain,
    type ChangelogEntry,
} from '@/lib/changelog';
import AppDialog from './AppDialog.vue';

/**
 * 更新日志弹窗（Vue 版，对应 React 的 `ChangelogModal`）。
 *
 * 拉取/解析依旧是 `lib/changelog.ts` 的纯函数，这里只负责渲染。
 * 正文用 `mdToPlain`（纯文本 + pre-wrap），与 React 版一致 —— 刻意不上 markdown 渲染器，
 * 省掉 react-markdown 那一整条依赖链。
 *
 * 迁移到 daisyUI：Button → `btn`，Spinner → `loading loading-spinner`，空态用 `hero`。
 */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [boolean] }>();

const entries = ref<ChangelogEntry[] | null>(null);
const err = ref('');
const loading = ref(false);

watch(
    () => props.open,
    (open, _prev, onCleanup) => {
        if (!open) return;
        let alive = true;
        loading.value = true;
        err.value = '';
        // 弹窗关闭/重开时丢弃上一轮的迟到响应
        onCleanup(() => {
            alive = false;
        });
        loadChangelog((list, errMsg) => {
            if (!alive) return;
            loading.value = false;
            if (!list) {
                err.value = errMsg || '未知错误';
                return;
            }
            entries.value = list;
        });
    }
);

const shown = computed(() => (entries.value ? entries.value.slice(0, CHANGELOG_DEFAULT_LIMIT) : []));
const title = computed(() => '更新日志（最新 ' + CHANGELOG_DEFAULT_LIMIT + ' 条）');

function openMore() {
    window.open(getChangelogPageUrl(), '_blank');
}
</script>

<template>
    <AppDialog
        :open="props.open"
        :title="title"
        :width="620"
        :footer="true"
        @update:open="(v: boolean) => emit('update:open', v)">
        <div v-if="loading" class="flex items-center justify-center gap-2 py-6">
            <span class="loading loading-spinner loading-sm text-primary"></span>
            <span class="text-[13px] text-base-content/60">读取中…</span>
        </div>

        <template v-else-if="err">
            <p class="text-[13px] text-error">读取失败：{{ err }}</p>
            <p class="mt-2 text-xs text-base-content/60">
                可点下方「获取更多日志」在浏览器中打开当月日志文件查看。
            </p>
        </template>

        <div v-else-if="!entries || entries.length === 0" class="hero">
            <div class="hero-content">
                <p class="text-[13px] text-base-content/60">暂无更新日志</p>
            </div>
        </div>

        <template v-else>
            <div class="max-h-[60vh] overflow-auto pr-1">
                <div v-for="en in shown" :key="en.title" class="mb-3.5">
                    <div class="mb-1.5 text-sm font-bold text-primary">{{ en.title }}</div>
                    <div class="whitespace-pre-wrap break-words text-[13px] leading-[1.6]">
                        {{ mdToPlain(en.body) }}
                    </div>
                </div>
            </div>
            <p class="mt-2 text-center text-xs text-base-content/60">
                {{
                    entries.length > shown.length
                        ? '共 ' + entries.length + ' 条，已显示最新 ' + shown.length + ' 条'
                        : '共 ' + entries.length + ' 条（已全部显示）'
                }}
            </p>
        </template>

        <template #footer>
            <button class="btn btn-outline btn-xs sm:btn-sm md:btn-md lg:btn-lg xl:btn-xl" @click="openMore">获取更多日志</button>
            <button class="btn btn-xs sm:btn-sm md:btn-md lg:btn-lg xl:btn-xl" @click="emit('update:open', false)">关闭</button>
        </template>
    </AppDialog>
</template>
