<script setup lang="ts">
import { computed } from 'vue';
import { addLog } from '@/lib/logger';
import { appendToTinyMCE } from '@/lib/tinymce';
import { safeCopyText } from '@/lib/clipboard';
import type { ZnhdPhrases } from '@/lib/phrasesZnhd';
import { Icon } from '@vue/icons';
import { toast } from '@vue/lib/toast';
import { Button } from '@vue/components/ui/button';
import { Input } from '@vue/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@vue/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@vue/components/ui/tabs';
import { Empty, EmptyDescription, EmptyHeader } from '@vue/components/ui/empty';
import { Spinner } from '@vue/components/ui/spinner';
import Tooltip from '../components/ui/tooltip/Tooltip.vue';

/**
 * 常用语侧边栏（Vue 版，对应 React 的 `PhrasesDrawer`）。
 *
 * 为什么是 Sheet 而不是 Dialog：常用语是长列表，弹窗要反复滚动、高度受限；
 * 右侧抽屉能用满整屏高度（与 antd Drawer 的行为一致）。
 *
 * 组件全部走官方 shadcn-vue registry（sheet / tabs / input / empty / spinner），
 * 只有「单条话术按钮」和标题栏刷新按钮按业务排版组合。
 */
const props = defineProps<{
    open: boolean;
    phrasesData: ZnhdPhrases;
    phrasesLoading: boolean;
    searchKeyword: string;
}>();

const emit = defineEmits<{
    'update:open': [boolean];
    'update:searchKeyword': [string];
    /** force=true 无视缓存重新抓取 */
    reload: [boolean];
}>();

const keyword = computed(() => props.searchKeyword.trim().toLowerCase());
const hit = (t: string) => !keyword.value || t.toLowerCase().includes(keyword.value);
const all = computed(() => (props.phrasesData.all || []).filter(hit));
const mine = computed(() => (props.phrasesData.mine || []).filter(hit));

/** 点一条：复制 + 关抽屉 + 追加到 TinyMCE（与 React 版顺序一致） */
function pick(text: string) {
    safeCopyText(text);
    emit('update:open', false);
    appendToTinyMCE(text);
    addLog(`添加文本: ${text}`, 'success');
    toast.success('添加文本: ' + text);
}
</script>

<template>
    <Sheet :open="props.open" @update:open="(v: boolean) => emit('update:open', v)">
        <SheetContent
            side="right"
            :show-close-button="true"
            class="gap-0 p-0"
            :style="{ width: '360px', maxWidth: '360px' }">
            <SheetHeader class="flex-row items-center gap-1 border-b border-[#f0f0f0] px-4 py-3 pr-12">
                <SheetTitle class="text-[15px] font-semibold text-[#262626]">常用语</SheetTitle>
                <!-- 标题旁刷新：无文字图标 + aria-label（读屏/冒烟都靠它定位） -->
                <Tooltip content="重新加载常用语" side="bottom">
                    <button
                        type="button"
                        aria-label="重新加载常用语"
                        :disabled="props.phrasesLoading"
                        class="inline-flex size-6 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent text-[#8c8c8c] outline-none hover:bg-black/5 hover:text-[#262626] disabled:cursor-default disabled:opacity-50"
                        @click="emit('reload', true)">
                        <Icon name="refresh" :size="15" />
                    </button>
                </Tooltip>
            </SheetHeader>

            <div class="flex min-h-0 flex-1 flex-col px-4 py-3">
                <Input
                    :model-value="props.searchKeyword"
                    placeholder="搜索常用语(按内容)"
                    class="mb-3 h-8 text-[13px]"
                    @update:model-value="(v) => emit('update:searchKeyword', String(v))" />

                <!-- ⚠️ Tabs/TabsList 必须显式给 flex-col / h-9：
                     官方类里的布局写在 data-horizontal:* 变体下，而本机 reka-ui 输出的是
                     data-orientation="horizontal"（没有裸 data-horizontal 属性），那些类不会命中。 -->
                <Tabs default-value="all" class="min-h-0 flex-1 flex-col gap-2">
                    <TabsList class="h-9 w-full">
                        <TabsTrigger value="all">全部话术</TabsTrigger>
                        <TabsTrigger value="mine">我的话术</TabsTrigger>
                    </TabsList>

                    <!-- 两个 tab 共用一套「加载中 / 空 / 列表」渲染 -->
                    <template v-for="tab in [
                        { key: 'all', items: all, empty: '暂无全部话术，点右上角刷新抓取' },
                        { key: 'mine', items: mine, empty: '暂无我的话术，点右上角刷新抓取' },
                    ]" :key="tab.key">
                        <TabsContent :value="tab.key" class="min-h-0 flex-1 overflow-y-auto">
                            <div v-if="props.phrasesLoading" class="flex flex-col items-center gap-2 py-6">
                                <Spinner class="size-5 text-[#1677ff]" />
                                <span class="text-center text-xs leading-5 text-[#8c8c8c]">
                                    正在抓取常用话术…（右侧栏会自动切 tab，请勿操作）
                                </span>
                            </div>

                            <Empty v-else-if="!tab.items.length" class="border-0 p-6">
                                <EmptyHeader>
                                    <EmptyDescription class="text-[13px] text-[#8c8c8c]">
                                        {{ tab.empty }}
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>

                            <div v-else class="flex flex-col gap-2">
                                <Tooltip v-for="(t, i) in tab.items" :key="tab.key + i" :content="t" side="left">
                                    <Button
                                        class="h-auto min-h-8 w-full justify-start whitespace-normal px-3 py-1 text-left text-[13px] font-normal"
                                        @click="pick(t)">
                                        <span
                                            class="text-left leading-5"
                                            style="
                                                display: -webkit-box;
                                                -webkit-line-clamp: 2;
                                                -webkit-box-orient: vertical;
                                                overflow: hidden;
                                                white-space: pre-wrap;
                                                word-break: break-word;
                                            ">
                                            {{ t }}
                                        </span>
                                    </Button>
                                </Tooltip>
                            </div>
                        </TabsContent>
                    </template>
                </Tabs>
            </div>
        </SheetContent>
    </Sheet>
</template>
