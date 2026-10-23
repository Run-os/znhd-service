<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import {
    authorize,
    forgetCredential,
    getRules,
    getTableUrl,
    getStatus,
    revoke,
    setTableUrl,
    type AuthPhase,
} from '@/lib/feishu/service';
import type { DeviceCodeChallenge } from '@/lib/feishu/types';
import { Icon } from '@vue/icons';
import { toast } from '@vue/lib/toast';

/**
 * 设置面板里的「飞书快捷回复」区块（v26.10.23）。
 *
 * 它承担三件事：
 *   ① 展示授权状态（已授权账号 / token 到期 / 已缓存规则条数）；
 *   ② 走完设备授权：把飞书返回的 user_code 与**原样链接**摆给使用者，自己在后台轮询；
 *   ③ 解除授权、手动刷新规则。
 *
 * ⚠️ 授权链接必须原样给出（飞书响应体里有明确警告：不得改写、拼接、重新编码）。
 *    这里直接 `{{ challenge.verificationUriComplete }}` 渲染 + `<a :href>`，
 *    不做任何 URL 处理。
 *
 * ⚠️ 授权是长任务（要等使用者去飞书确认），所以 `authorize()` 用 `isCancelled` 回调
 *    支持中途取消 —— 组件卸载 / 点「取消」都会把它置 true，避免关掉面板后还在后台轮询。
 */
const status = ref(getStatus());
const busy = ref(false);
const phase = ref<AuthPhase | null>(null);
const challenge = ref<DeviceCodeChallenge | null>(null);
const errorText = ref('');
const tableUrl = ref(getTableUrl());
const urlBusy = ref(false);
let cancelled = false;

/**
 * 错误是不是「没权限」类（v26.10.23-v2）。
 * 授权成功 ≠ 表能读：表不在当前账号名下 / 是别人分享但没加协作者 / scope 没勾全，
 * 都会走到读表这一步才炸 —— 这类错误要给专门提示，不能只丢一句 raw msg。
 */
const permissionError = computed(() =>
    /forbidden|permission|denied|无权|权限|scope|99991672|91403|1254/i.test(errorText.value)
);

async function saveTable(): Promise<void> {
    if (urlBusy.value) return;
    urlBusy.value = true;
    try {
        setTableUrl(tableUrl.value);
        tableUrl.value = getTableUrl();
        await reloadRules();
    } finally {
        urlBusy.value = false;
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

function refreshStatus(): void {
    status.value = getStatus();
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

async function reloadRules(): Promise<void> {
    try {
        busy.value = true;
        await getRules(true);
        refreshStatus();
        toast.success('已更新 ' + status.value.ruleCount + ' 条规则');
    } catch (e) {
        const msg = (e as Error)?.message || '刷新失败';
        errorText.value = msg;
        toast.error(msg);
    } finally {
        busy.value = false;
    }
}

function doRevoke(): void {
    revoke();
    refreshStatus();
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
    toast.success('已作废本机凭证，下次授权将重新注册应用');
}

onMounted(refreshStatus);
onUnmounted(() => {
    cancelled = true;
});
</script>

<template>
    <fieldset class="fieldset" data-znhd="feishu-auth">
        <legend class="fieldset-legend flex w-full items-center justify-between gap-3">
            <span>飞书快捷回复（输出框上方的快捷短语）</span>
            <span v-if="status.authorized" class="flex items-center gap-1 text-[12px] text-success">
                <Icon name="check" :size="13" />
                已授权
            </span>
            <span v-else class="text-[12px] text-base-content/50">未授权</span>
        </legend>

        <!-- 状态摘要：只显示与使用者有关的三个数，不暴露 token/凭证 -->
        <p v-if="status.authorized" class="mb-2 text-[12px] leading-5 text-base-content/60">
            规则 {{ status.ruleCount }} 条，上次更新：{{ fetchedText }}<br />
            token 到期：{{ expiresText }}（到期前会自动续期）
        </p>
        <p v-else class="mb-2 text-[12px] leading-5 text-base-content/60">
            授权后脚本会读取你飞书多维表格里的规则表，按当前对话内容在输出框上方显示快捷短语按钮。
            对话文本只在本机匹配，不会上传到任何地方。
        </p>

        <!-- 授权进行中：把飞书返回的 user_code 与链接原样给出 -->
        <div v-if="busy && challenge" class="mb-2 rounded-box bg-base-200 p-3">
            <p class="mb-1 text-[12px] text-base-content/70">{{ phaseText }}</p>
            <p class="mb-1 text-[13px]">
                在飞书里确认授权码：<span class="font-mono text-[15px] font-semibold">{{ challenge.userCode }}</span>
            </p>
            <a
                class="link link-primary inline-block text-[12px] break-all"
                :href="challenge.verificationUriComplete"
                target="_blank"
                rel="noreferrer">
                {{ challenge.verificationUriComplete }}
            </a>
            <p class="mt-1 text-[11px] text-base-content/50">
                链接 {{ Math.round(challenge.expiresIn / 60) }} 分钟内有效；确认后这里会自动完成。
                授权页里要登录注册应用时的那个账号（第 1 步确认创建时用的账号）。
            </p>
        </div>

        <p v-if="busy && !challenge" class="mb-2 text-[12px] text-base-content/60">
            <span class="loading loading-spinner loading-xs mr-1"></span>正在与飞书通信…
        </p>

        <!-- 有凭证但未授权：说明第 1 步已过、第 2 步还没完成；给一条「回退」出路（v26.10.23-v3） -->
        <p v-if="!status.authorized && status.hasCredential" class="mb-2 text-[12px] leading-5 text-base-content/60">
            本机已注册过应用（第 1 步已完成），点「授权飞书账号」会直接进入第 2 步。
            如果第 1 步当时用错了账号（例如豆包账号），点「作废并重新注册」可回到第 1 步。
        </p>

        <p v-if="errorText" class="mb-2 text-[12px] break-words text-error">{{ errorText }}</p>

        <!-- 没权限的专门提示（v26.10.23-v2）：授权成功只代表登录了账号，不代表能读那张表 -->
        <div v-if="errorText && permissionError" class="mb-2 rounded-box border border-warning/40 bg-warning/10 p-3 text-[12px] leading-5">
            <p class="mb-1 font-semibold">没有读取这张多维表格的权限，依次检查：</p>
            <p>① 表是不是当前授权账号的？别人分享的表，请让所有者把你的飞书账号加为协作者（「可阅读」即可）；</p>
            <p>② 授权时 scope 是否勾全 —— 点上方「重新授权」，弹出的授权页里**全部勾选**后再确认；</p>
            <p>③ 链接是否贴对 —— 在飞书里打开那张表，点右上角「分享」复制链接，粘贴到下方输入框。</p>
        </div>

        <!-- 规则表链接（v26.10.23-v2）：不再写死，谁用谁配自己的表 -->
        <div class="mb-2">
            <p class="mb-1 text-[12px] text-base-content/60">规则表链接（粘贴多维表格的分享链接）</p>
            <input
                v-model="tableUrl"
                type="text"
                class="input input-bordered input-sm w-full font-mono text-[12px]"
                placeholder="https://xxx.feishu.cn/wiki/…?table=tbl…&view=vew…"
                spellcheck="false"
                data-znhd="quick-reply-table-url" />
            <p class="mt-1 text-[11px] text-base-content/50">
                支持 /wiki/ 分享链接与 /base/ 直链；链接里不带 table 参数时自动用第一个数据表。
                链接有改动时点「保存链接」，保存后会自动刷新一次规则。
            </p>
            <button class="btn btn-outline btn-sm mt-1" :disabled="urlBusy" @click="saveTable">
                {{ urlBusy ? '保存中…' : '保存链接' }}
            </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
            <button v-if="!status.authorized" class="btn btn-primary btn-sm" :disabled="busy" @click="startAuth">
                {{ busy ? '等待确认…' : '授权飞书账号' }}
            </button>
            <template v-else>
                <button class="btn btn-outline btn-sm" :disabled="busy" @click="reloadRules">立即刷新规则</button>
                <button class="btn btn-primary btn-sm" :disabled="busy" @click="startAuth">重新授权</button>
                <button class="btn btn-error btn-sm" :disabled="busy" @click="doRevoke">解除授权</button>
            </template>
            <!-- v26.10.23-v3：第 1 步用错账号时的回退出路（清凭证后重新授权 = 重新注册） -->
            <button
                v-if="status.hasCredential"
                class="btn btn-outline btn-warning btn-sm"
                :disabled="busy"
                @click="doForget">
                作废并重新注册
            </button>
            <button v-if="busy" class="btn btn-ghost btn-sm" @click="cancel">取消并返回</button>
        </div>
    </fieldset>
</template>
