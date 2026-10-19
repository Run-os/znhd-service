<script setup lang="ts">
import { computed } from 'vue';
import { addLog } from '@/lib/logger';
import { appendToTinyMCE } from '@/lib/tinymce';
import { safeCopyText } from '@/lib/clipboard';
import type { ZnhdPhrases } from '@/lib/phrasesZnhd';
import { Icon } from '@vue/icons';
import { toast } from '@vue/lib/toast';
import { Button } from '@vue/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@vue/components/ui/input-group';
import { Item, ItemContent, ItemTitle } from '@vue/components/ui/item';
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
 * 组件构成（2026-10-18 组件正规化，全部来自官方 registry）：
 *   Sheet（右侧抽屉）+ Tabs（全部/我的）+ **InputGroup**（搜索框，带图标 addon）
 *   + **Item**（每条话术一行）+ Empty（空态）+ Spinner（加载中）+ Button / Tooltip。
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
        <!--
            ⚠️ border-border 不能省：官方 SheetContent 的 `data-[side=right]:border-l` 只设宽度、
            **不设颜色** ⇒ 取 currentColor；暗色下 currentColor = popover-foreground（#f2f3f5 近白），
            左缘会变成一条刺眼的白线（2026-10-19 用户截图实测）。显式改回语义边框色：
            暗色 #262626 ≈ 传输助手窗口外框 rgb(34,34,34)，日间 #e5e6eb，与传输助手细边保持一致。
        -->
        <SheetContent
            side="right"
            :show-close-button="true"
            class="gap-0 border-border p-0"
            :style="{ width: '360px', maxWidth: '360px' }">
            <SheetHeader class="flex-row items-center gap-1 border-b border-border px-4 py-3 pr-12">
                <SheetTitle class="text-[15px] font-semibold text-foreground">常用语</SheetTitle>
                <!-- 标题旁刷新：无文字图标 + aria-label（读屏/冒烟都靠它定位） -->
                <Tooltip content="重新加载常用语" side="bottom">
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="重新加载常用语"
                        :disabled="props.phrasesLoading"
                        class="text-muted-foreground"
                        @click="emit('reload', true)">
                        <Icon name="refresh" :size="15" />
                    </Button>
                </Tooltip>
            </SheetHeader>

            <div class="flex min-h-0 flex-1 flex-col px-4 py-3">
                <InputGroup class="mb-3">
                    <InputGroupAddon>
                        <Icon name="search" :size="14" />
                    </InputGroupAddon>
                    <InputGroupInput
                        :model-value="props.searchKeyword"
                        placeholder="搜索常用语(按内容)"
                        class="text-[13px]"
                        @update:model-value="(v: string | number) => emit('update:searchKeyword', String(v))" />
                </InputGroup>

                <!-- ⚠️ Tabs/TabsList 必须显式给 flex-col / h-9：
                     官方类里的布局写在 data-horizontal:* 变体下，而本机 reka-ui 输出的是
                     data-orientation="horizontal"（没有裸 data-horizontal 属性），那些类不会命中。 -->
                <Tabs default-value="all" class="flex min-h-0 flex-1 flex-col gap-2">
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
                                <Spinner class="size-5 text-primary" />
                                <span class="text-center text-xs leading-5 text-muted-foreground">
                                    正在抓取常用话术…（右侧栏会自动切 tab，请勿操作）
                                </span>
                            </div>

                            <Empty v-else-if="!tab.items.length" class="border-0 p-6">
                                <EmptyHeader>
                                    <EmptyDescription class="text-[13px]">
                                        {{ tab.empty }}
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>

                            <div v-else class="flex flex-col gap-1.5">
                                <Tooltip v-for="(t, i) in tab.items" :key="tab.key + i" :content="t" side="left">
                                    <!-- 每条话术 = 官方 Item（as="button"，整行可点） -->
                                    <Item
                                        as="button"
                                        variant="outline"
                                        size="xs"
                                        class="items-start text-left hover:bg-muted"
                                        @click="pick(t)">
                                        <!--
                                            统一行高（v26.10.19-v14）：话术长短不一，1 行 20px / 2 行 40px
                                            ⇒ 卡片高度在列表里跳变。给内容区钉死两行高度（min-h-10 = 40px）
                                            再 justify-center：单行的上下各留 10px、两行的正好填满，
                                            卡片一律 py-2 + 40px + py-2 = 56px，扫描时基线整齐。
                                            ⚠️ 不要改成给 Item 写 h-14：字号/行高一变就会挤，min-h 才是内容驱动。
                                        -->
                                        <ItemContent class="min-h-10 justify-center">
                                            <ItemTitle
                                                class="whitespace-normal font-normal leading-5 text-[13px]"
                                                style="
                                                    display: -webkit-box;
                                                    -webkit-line-clamp: 2;
                                                    -webkit-box-orient: vertical;
                                                    overflow: hidden;
                                                    white-space: pre-wrap;
                                                    word-break: break-word;
                                                ">
                                                {{ t }}
                                            </ItemTitle>
                                        </ItemContent>
                                    </Item>
                                </Tooltip>
                            </div>
                        </TabsContent>
                    </template>
                </Tabs>
            </div>
        </SheetContent>
    </Sheet>
</template>
