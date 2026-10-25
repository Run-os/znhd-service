<script setup lang="ts">
import {
    authorize,
    forgetCredential,
    getPrivacyRules,
    getPrivacyStatus,
    getPrivacyTableUrl,
    getRules,
    getStatus,
    revoke,
    setPrivacyTableUrl,
    setTableUrl,
    type AuthPhase,
} from '@/lib/feishu/service';
import type { DeviceCodeChallenge } from '@/lib/feishu/types';
import { Icon } from '@vue/icons';
import { toast } from '@vue/lib/toast';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import TablePickerDialog from './TablePickerDialog.vue';

/**
 * 设置面板里的「飞书快捷回复」区块（v26.10.23）。
 *
 * 它承担四件事：
 *   ① 展示授权状态（已授权账号 / token 到期 / 已缓存规则条数）；
 *   ② 走完设备授权：把飞书返回的 user_code 摆给使用者 +「打开授权页」按钮，自己在后台轮询；
 *   ③ 解除授权、手动刷新规则；
 *   ④ 配置并刷新「隐私信息」表格（v26.10.25-v1）：独立第二张表，全部条目常显、不参与匹配。
 *
 * ⚠️ 表格链接**不再展示/手填**（v26.10.25-v2，使用者定版）：规则表与隐私表的链接输入框
 *    都已删除，配置统一走「从飞书选择表格」，选完即保存并拉取。
 *
 * ⚠️ 授权链接**不再原文展示**（v26.10.25-v1，使用者定版：长链接没有阅读价值）：
 *    只给一个「打开授权页」按钮，`href` 仍是飞书返回的 `verificationUriComplete` 原样值
 *    （不做任何改写/拼接 —— 飞书响应体明确要求），只是不把 URL 打印出来。
 *
 * ⚠️ 授权是长任务（要等使用者去飞书确认），所以 `authorize()` 用 `isCancelled` 回调
 *    支持中途取消 —— 组件卸载 / 点「取消」都会把它置 true，避免关掉面板后还在后台轮询。
 */
const status = ref(getStatus());
const busy = ref(false);
const phase = ref<AuthPhase | null>(null);
const challenge = ref<DeviceCodeChallenge | null>(null);
const errorText = ref('');
/** 「从飞书选择表格」进行中的 loading（v26.10.25-v2：链接输入框已删，选表即保存） */
const urlBusy = ref(false);
/** 「从飞书选择表格」弹窗开关（v26.10.24-v6） */
const pickerOpen = ref(false);
/** 弹窗回填目标（v26.10.25-v1）：main = 规则表链接，privacy = 隐私信息表格链接 */
const pickerTarget = ref<'main' | 'privacy'>('main');
/** 隐私信息表格（v26.10.25-v1）：独立状态展示（链接输入框 v26.10.25-v2 已删） */
const privacyUrlBusy = ref(false);
const privacyStatus = ref(getPrivacyStatus());
let cancelled = false;

/** 案例表链接（legend 里的「查看案例」，使用者定版：给一张示范表看列怎么填） */
const EXAMPLE_URL = 'https://mi0cdkcaj1o.feishu.cn/wiki/HImpwjCTeiPTIbkzIB0cHOKcnDd?from=from_copylink';

/**
 * 错误是不是「没权限」类（v26.10.23-v2）。
 * 授权成功 ≠ 表能读：表不在当前账号名下 / 是别人分享但没加协作者 / scope 没勾全，
 * 都会走到读表这一步才炸 —— 这类错误要给专门提示，不能只丢一句 raw msg。
 */
const permissionError = computed(() =>
    /forbidden|permission|denied|无权|权限|scope|99991672|91403|1254/i.test(errorText.value)
);

/**
 * 保存规则表链接并立刻回源拉取（v26.10.25-v2：不再有输入框，唯一入口是「从飞书选择表格」，
 * 选完即保存，不要求再点一次确认）。
 */
async function saveTable(url: string): Promise<void> {
    if (!url) return;
    urlBusy.value = true;
    try {
        setTableUrl(url);
        await reloadRules();
    } finally {
        urlBusy.value = false;
    }
}

/** 保存隐私表格链接并立刻回源拉一次（失败只 toast，不影响主表状态） */
async function savePrivacyTable(url: string): Promise<void> {
    if (!url) return;
    privacyUrlBusy.value = true;
    try {
        setPrivacyTableUrl(url);
        refreshPrivacyStatus();
        try {
            await getPrivacyRules(true);
            refreshPrivacyStatus();
        } catch (e) {
            toast.error('隐私信息拉取失败：' + ((e as Error)?.message || '未知错误'));
        }
    } finally {
        privacyUrlBusy.value = false;
    }
}

const phaseText = computed(() =>
    phase.value === 'register' ? '第 1 步 / 共 2 步：注册应用' : '第 2 步 / 共 2 步：授权读取表格'
);

const expiresText = computed(() => {
    if (!status.value.expiresAt) return '';
    return new Date(status.value.expiresAt).toLocaleString('zh-CN', { hour12: false });
});

const fetchedText = computed(() => {
    if (!status.value.rulesFetchedAt) return '从未拉取';
    return new Date(status.value.rulesFetchedAt).toLocaleString('zh-CN', { hour12: false });
});

const privacyFetchedText = computed(() => {
    if (!privacyStatus.value.fetchedAt) return '从未拉取';
    return new Date(privacyStatus.value.fetchedAt).toLocaleString('zh-CN', { hour12: false });
});

function refreshStatus(): void {
    status.value = getStatus();
}

function refreshPrivacyStatus(): void {
    privacyStatus.value = getPrivacyStatus();
}

function cancel(): void {
    cancelled = true;
    busy.value = false;
    challenge.value = null;
    phase.value = null;
}

async function startAuth(): Promise<void> {
    if (busy.value) return;
    cancelled = false;
    errorText.value = '';
    challenge.value = null;
    phase.value = null;
    busy.value = true;
    try {
        await authorize({
            onChallenge: (p, c) => {
                phase.value = p;
                challenge.value = c;
            },
            isCancelled: () => cancelled,
        });
        refreshStatus();
        toast.success('飞书授权成功');
        // 授权完立刻拉一次规则，免得使用者还要再点一次刷新
        await reloadRules();
    } catch (e) {
        if (!cancelled) {
            errorText.value = (e as Error)?.message || '授权失败';
            toast.error(errorText.value);
        }
    } finally {
        busy.value = false;
        challenge.value = null;
        phase.value = null;
    }
}

/**
 * 「立即刷新规则」（v26.10.25-v1 起**同时**刷新主表与隐私表）：
 *   · 隐私未配置链接时静默跳过，不报错；
 *   · 主表成功而隐私失败只 toast 提示隐私失败（主表的成功结果不能被隐私失败掩盖）。
 */
async function reloadRules(): Promise<void> {
    busy.value = true;
    try {
        await getRules(true);
        refreshStatus();
        toast.success('已更新 ' + status.value.ruleCount + ' 条规则');
    } catch (e) {
        const msg = (e as Error)?.message || '刷新失败';
        errorText.value = msg;
        toast.error(msg);
    }
    if (privacyStatus.value.configured || getPrivacyTableUrl()) {
        try {
            await getPrivacyRules(true);
            refreshPrivacyStatus();
        } catch (e) {
            toast.error('隐私信息刷新失败：' + ((e as Error)?.message || '未知错误'));
        }
    }
    busy.value = false;
}

function doRevoke(): void {
    revoke();
    refreshStatus();
    refreshPrivacyStatus();
    toast.success('已解除飞书授权');
}

/**
 * 作废本机应用凭证（v26.10.23-v3）：连第 1 步注册的 client_id/secret 一起忘掉，
 * 下次授权重新走「动态注册」。用于第 1 步用错账号确认的场景（比如豆包账号）——
 * 凭证不清掉，每次点授权都会跳过第 1 步带着错账号的上下文，永远回不去。
 */
function doForget(): void {
    forgetCredential();
    refreshStatus();
    refreshPrivacyStatus();
    toast.success('已作废本机凭证，下次授权将重新注册应用');
}

/**
 * 打开选表弹窗（v26.10.25-v1 起复用同一个实例，用 target 区分回填目标）：
 * 实现「最简单者」—— 一个弹窗 + mode 标记，比第二个实例少挂一份状态。
 */
function openPicker(target: 'main' | 'privacy'): void {
    pickerTarget.value = target;
    pickerOpen.value = true;
}

/**
 * 弹窗里选中一条表（v26.10.24-v6）：**立刻保存并刷新**。
 * v26.10.25-v2 起没有输入框可回填 —— 选表就是唯一入口，保存动作对使用者透明。
 */
function onPick(url: string): void {
    if (!url) return;
    if (pickerTarget.value === 'privacy') {
        void savePrivacyTable(url);
    } else {
        void saveTable(url);
    }
}

onMounted(() => {
    refreshStatus();
    refreshPrivacyStatus();
});
onUnmounted(() => {
    cancelled = true;
});
</script>

<template>
    <div class="fieldset" data-znhd="feishu-auth">
        <div class="fieldset-legend flex w-full items-center justify-between gap-3 text-[15px] font-semibold">
            <span>
                飞书快捷回复（输出框上方的快捷短语，<a
                    class="link link-primary underline underline-offset-2"
                    :href="EXAMPLE_URL"
                    target="_blank"
                    rel="noreferrer">查看案例</a>）
            </span>
            <span v-if="status.authorized" class="flex items-center gap-1 text-[12px] font-normal text-success">
                <Icon name="check" :size="13" />
                已授权
            </span>
            <span v-else class="text-[12px] font-normal text-base-content/50">未授权</span>
        </div>

        <!-- 状态摘要：授权后只留 token 一行（条数进卡片徽章），不暴露 token/凭证 -->
        <p v-if="status.authorized" class="pb-3 text-[12px] leading-5 text-base-content/60 tabular-nums">
            token 到期：{{ expiresText }}（到期前会自动续期）
        </p>
        <p v-else class="pb-3 text-[12px] leading-5 text-base-content/60">
            授权后脚本会读取你飞书多维表格里的规则表，按当前对话内容在输出框上方显示快捷短语按钮。
            对话文本只在本机匹配，不会上传到任何地方。
        </p>

        <!-- v26.10.25-v4：功能区之间统一 hairline 分割（divide-y），间距统一 py-3 —— 对齐参考图行距 -->
        <div class="divide-y divide-base-300">
            <!-- 授权进行中：授权码大字展示 + 「打开授权页」按钮（不再打印长链接原文） -->
            <div v-if="busy && challenge" class="py-3">
                <div class="rounded-box bg-base-200 p-3">
                    <p class="mb-2 text-[12px] text-base-content/70">{{ phaseText }}</p>
                    <p class="mb-2 text-[13px]">
                        在飞书里确认授权码：<span class="font-mono text-[15px] font-semibold">{{ challenge.userCode }}</span>
                    </p>
                    <div class="flex items-center gap-3">
                        <a
                            class="btn btn-primary btn-sm rounded-full"
                            :href="challenge.verificationUriComplete"
                            target="_blank"
                            rel="noreferrer">
                            打开授权页
                        </a>
                        <p class="text-[11px] leading-4 text-base-content/50">
                            授权页 {{ Math.round(challenge.expiresIn / 60) }} 分钟内有效；确认后这里会自动完成。<br />
                            授权页里要登录注册应用时的那个账号（第 1 步确认创建时用的账号）。
                        </p>
                    </div>
                </div>
            </div>

            <p v-if="busy && !challenge" class="py-3 text-[12px] text-base-content/60">
                <span class="loading loading-spinner loading-xs mr-1"></span>正在与飞书通信…
            </p>

            <!-- 有凭证但未授权：说明第 1 步已过、第 2 步还没完成；给一条「回退」出路（v26.10.23-v3） -->
            <p v-if="!status.authorized && status.hasCredential" class="py-3 text-[12px] leading-5 text-base-content/60">
                本机已注册过应用（第 1 步已完成），点「授权飞书账号」会直接进入第 2 步。
                如果第 1 步当时用错了账号（例如豆包账号），点「作废并重新注册」可回到第 1 步。
            </p>

            <p v-if="errorText" class="py-3 text-[12px] break-words text-error">{{ errorText }}</p>

            <!-- 没权限的专门提示（v26.10.23-v2）：授权成功只代表登录了账号，不代表能读那张表 -->
            <div v-if="errorText && permissionError" class="py-3">
                <div class="rounded-box border border-warning/40 bg-warning/10 p-3 text-[12px] leading-5">
                    <p class="mb-1 font-semibold">没有读取这张多维表格的权限，依次检查：</p>
                    <p>① 表是不是当前授权账号的？别人分享的表，请让所有者把你的飞书账号加为协作者（「可阅读」即可）；</p>
                    <p>② 授权时 scope 是否勾全 —— 点上方「重新授权」，弹出的授权页里**全部勾选**后再确认；</p>
                    <p>③ 表选对没有 —— 点「从飞书选择表格」重新选一张（确认选的是要用的那张表）。</p>
                </div>
            </div>

        <!-- 双卡片（v26.10.25-v3 参考图定版）：规则表 / 隐私信息表并排，徽章显条数、
             全宽描边按钮选表。链接输入框 v26.10.25-v2 已删，配置唯一入口 = 选表。 -->
        <div class="grid grid-cols-2 gap-4 py-3">
            <div class="rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm">
                <div class="mb-3 flex items-center gap-2">
                    <span class="text-[14px] font-semibold">规则表</span>
                    <span
                        v-if="status.authorized"
                        class="badge badge-ghost badge-sm tabular-nums"
                        :title="'上次更新：' + fetchedText">已缓存 {{ status.ruleCount }} 条</span>
                    <span v-else class="badge badge-outline badge-sm">未授权</span>
                </div>
                <button
                    v-if="status.authorized && status.searchScopeOk"
                    class="btn btn-outline btn-sm w-full rounded-full"
                    :disabled="urlBusy"
                    data-znhd="quick-reply-table-pick"
                    @click="openPicker('main')">
                    <Icon name="search" :size="13" />
                    从飞书选择表格
                </button>
                <p v-else-if="status.authorized" class="text-[11px] leading-4 text-warning">
                    当前授权不含「搜索云文档」权限，点下方「重新授权」后就能选表。
                </p>
                <p v-else class="text-[11px] leading-4 text-base-content/50">授权后可从飞书直接选表。</p>
            </div>

            <div class="rounded-2xl border border-base-300 bg-base-100 p-4 shadow-sm" data-znhd="privacy-table-block">
                <div class="mb-3 flex items-center gap-2">
                    <span class="text-[14px] font-semibold">隐私信息表</span>
                    <span
                        v-if="privacyStatus.configured"
                        class="badge badge-ghost badge-sm tabular-nums"
                        :title="'上次拉取：' + privacyFetchedText">已缓存 {{ privacyStatus.ruleCount }} 条</span>
                    <span v-else class="badge badge-outline badge-sm">未配置</span>
                </div>
                <button
                    v-if="status.authorized && status.searchScopeOk"
                    class="btn btn-outline btn-sm w-full rounded-full"
                    :disabled="privacyUrlBusy"
                    data-znhd="privacy-table-pick"
                    @click="openPicker('privacy')">
                    <Icon name="search" :size="13" />
                    从飞书选择表格
                </button>
                <p v-else-if="status.authorized" class="text-[11px] leading-4 text-warning">
                    授权不含搜索权限，重新授权后可配这张可选的速查表。
                </p>
                <p v-else class="text-[11px] leading-4 text-base-content/50">可选；授权后从飞书选表。</p>
            </div>
        </div>

            <div class="flex flex-wrap items-center gap-2 py-3">
                <button v-if="!status.authorized" class="btn btn-primary btn-sm rounded-full" :disabled="busy" @click="startAuth">
                    {{ busy ? '等待确认…' : '授权飞书账号' }}
                </button>
                <template v-else>
                    <button class="btn btn-outline btn-sm rounded-full" :disabled="busy" @click="reloadRules">立即刷新规则</button>
                    <button class="btn btn-primary btn-sm rounded-full" :disabled="busy" @click="startAuth">重新授权</button>
                    <button class="btn btn-error btn-sm rounded-full" :disabled="busy" @click="doRevoke">解除授权</button>
                </template>
                <!-- v26.10.23-v3：第 1 步用错账号时的回退出路（清凭证后重新授权 = 重新注册） -->
                <button
                    v-if="status.hasCredential"
                    class="btn btn-outline btn-warning btn-sm rounded-full"
                    :disabled="busy"
                    @click="doForget">
                    作废并重新注册
                </button>
                <button v-if="busy" class="btn btn-ghost btn-sm rounded-full" @click="cancel">取消并返回</button>
            </div>
        </div>

        <!-- 选表弹窗：原生 showModal() 进 top layer，天然盖在本设置弹窗之上。
             主表 / 隐私表共用一个实例，回填目标由 pickerTarget 区分。 -->
        <TablePickerDialog v-model:open="pickerOpen" @picked="onPick" />
    </div>
</template>
