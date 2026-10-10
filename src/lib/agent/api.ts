/**
 * ScriptCat Agent 服务层：能力探测 + 四个子 API 的薄封装（v26.10.10-v10）。
 *
 * ── 为什么要有这一层，而不是让 UI 直接摸 `CAT.agent` ─────────────────────────
 * ① `CAT` 全局**只在 ScriptCat 里存在**。本脚本同时支持 Tampermonkey（`@match` 含税务页与
 *    example.com），在 TM 里访问 `CAT.agent` 是 ReferenceError —— 直接写就是「打开面板即崩」。
 * ② 就算在 ScriptCat 里，四个子能力也是**逐项 `@grant`** 的：老版本 ScriptCat（< 1.4）、
 *    或用户在管理页里拒绝某项授权，都会让单个子 API 缺失。故这里按能力逐个探测，
 *    缺哪块只在对应页签里提示，不牵连其它功能。
 * ③ 官方 API 的返回形状有 3 处文档与实现不一致（见 types.ts 的 `[与文档不符]`），
 *    纠偏逻辑集中放在这里，UI 只面对规整后的数据。
 *
 * ── 探测时机与代价 ─────────────────────────────────────────────────────────
 * `detectCatAgent()` 是**纯内存判空**（`typeof` + 逐层取属性），不发起任何异步调用，
 * 因此可以放心在组件 render 期调用；真正的 `model.list()` / `conversation.create()`
 * 等异步动作只在用户打开弹窗时才发生。
 *
 * ── ephemeral 之外的对话会落到 OPFS ───────────────────────────────────────
 * 本脚本用的是**非 ephemeral** 对话（持久化、带内置工具），关掉弹窗再打开仍能接着聊；
 * 「新建对话」走 `conversation.create()` 换新实例，不是 `clear()`。
 */

import { addLog } from '@/lib/logger';
import type {
    AgentChatMessage,
    AgentConversation,
    AgentConversationOptions,
    AgentModelSummary,
    AgentSkillSummary,
    AgentStreamChunk,
    AgentTask,
    AgentTaskApi,
    AgentTaskInput,
    AgentToolCall,
    AgentUsage,
    CatAgentApi,
    CatAgentPart,
} from '@/lib/agent/types';
import { CAT_AGENT_PARTS, toolDisplayName } from '@/lib/agent/types';

/* ============================================================ 能力探测 */

export interface CatAgentAvailability {
    /** 可用时为探测到的 API 对象，否则 null */
    api: CatAgentApi | null;
    /** 四个子能力各自是否存在 */
    parts: Record<CatAgentPart, boolean>;
    /** 不可用的人话原因，直接可展示给用户 */
    reason: string;
}

const MISSING_CAT_REASON =
    '当前脚本管理器没有 Agent 能力：需要 ScriptCat v1.4 及以上（Tampermonkey 等其它管理器不支持）。';

/** 探测 `CAT.agent.*`。纯内存判空，可安全重复调用（不缓存，避免脚本管理器热重载后状态过期） */
export function detectCatAgent(): CatAgentAvailability {
    const unavailable = (reason: string): CatAgentAvailability => ({
        api: null,
        parts: { conversation: false, model: false, skills: false, task: false },
        reason,
    });

    if (typeof CAT === 'undefined' || !CAT) return unavailable(MISSING_CAT_REASON);

    let agent: unknown;
    try {
        agent = (CAT as { agent?: unknown }).agent;
    } catch {
        // 极端情况下 getter 抛错（不该发生），当作不可用而不是让整个面板崩掉
        return unavailable(MISSING_CAT_REASON);
    }
    if (!agent || typeof agent !== 'object') {
        return unavailable('当前 ScriptCat 版本未提供 Agent 功能，请升级到 v1.4 及以上。');
    }

    const record = agent as Record<string, unknown>;
    const parts = {} as Record<CatAgentPart, boolean>;
    const missing: CatAgentPart[] = [];
    for (const part of CAT_AGENT_PARTS) {
        const ok = !!record[part] && typeof record[part] === 'object';
        parts[part] = ok;
        if (!ok) missing.push(part);
    }

    if (missing.length) {
        return {
            api: null,
            parts,
            reason:
                'Agent 的「' +
                missing.join(' / ') +
                '」权限不可用：请在 ScriptCat 里重新安装脚本并允许对应授权（脚本需要 CAT.agent.conversation / model / skills / task 四项）。',
        };
    }

    return { api: agent as CatAgentApi, parts, reason: '' };
}

/* ============================================================ 错误文案 */

const ERROR_CODE_TEXT: Record<string, string> = {
    rate_limit: '触发模型限流，请稍后重试。',
    auth: '模型鉴权失败：请在 ScriptCat 设置里检查该模型的 API Key。',
    tool_timeout: '工具执行超时。',
    context_too_large: '对话上下文超出模型窗口，请新建对话或清空历史。',
    api_error: '模型接口报错。',
};

/** 把任意抛出物压成一句话（供日志与界面共用） */
export function agentErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message || error.name || '未知错误';
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
        const maybe = error as { message?: unknown; error?: unknown };
        if (typeof maybe.message === 'string' && maybe.message) return maybe.message;
        if (typeof maybe.error === 'string' && maybe.error) return maybe.error;
        try {
            return JSON.stringify(error);
        } catch {
            return '未知错误';
        }
    }
    return String(error);
}

/** 按 errorCode 补充中文提示，界面统一走这个 */
export function describeAgentError(error: unknown, errorCode?: string): string {
    const raw = agentErrorMessage(error);
    const hint = errorCode ? ERROR_CODE_TEXT[errorCode] : '';
    if (!hint) return raw;
    return raw && raw !== hint ? hint + '（' + raw + '）' : hint;
}

/* ============================================================ 模型 */

function isModelSummary(value: unknown): value is AgentModelSummary {
    if (!value || typeof value !== 'object') return false;
    const model = value as { id?: unknown; name?: unknown };
    return typeof model.id === 'string';
}

/** 列出可用模型；任何一步失败都返回空数组（界面显示「未配置模型」而不是报错弹窗） */
export async function listModels(api: CatAgentApi): Promise<AgentModelSummary[]> {
    try {
        const list = await api.model.list();
        return Array.isArray(list) ? list.filter(isModelSummary) : [];
    } catch (error) {
        addLog('[Agent] 读取模型列表失败: ' + agentErrorMessage(error), 'warning');
        return [];
    }
}

/**
 * 取默认模型 id。⚠️ `model.getDefault()` 的返回形状在官方 d.ts / 文档 / 实现之间不一致：
 * 可能是字符串、ModelSummary、或 {modelId}/{id}/{name} 包装对象，故逐一判型后兜底。
 */
export async function pickDefaultModelId(api: CatAgentApi): Promise<string> {
    let value: unknown;
    try {
        value = await api.model.getDefault();
    } catch (error) {
        addLog('[Agent] 读取默认模型失败: ' + agentErrorMessage(error), 'warning');
        return '';
    }
    if (typeof value === 'string') return value;
    if (isModelSummary(value)) return value.id;
    if (value && typeof value === 'object') {
        const wrapper = value as { modelId?: unknown; id?: unknown; name?: unknown; summary?: unknown };
        if (typeof wrapper.modelId === 'string') return wrapper.modelId;
        if (typeof wrapper.id === 'string') return wrapper.id;
        if (typeof wrapper.summary === 'string') return wrapper.summary;
        if (isModelSummary(wrapper.summary)) return wrapper.summary.id;
    }
    return '';
}

/* ============================================================ 对话 */

/** 新建对话。system 用于交代脚本自身上下文；不传 model 时由 ScriptCat 用默认模型 */
export async function createConversation(
    api: CatAgentApi,
    options: AgentConversationOptions
): Promise<AgentConversation> {
    return api.conversation.create(options);
}

/** 读取历史消息并统一成界面结构（跳过 system 消息：那是脚本自己注入的提示词） */
export async function readConversationMessages(conversation: AgentConversation): Promise<AgentChatMessage[]> {
    const messages = await conversation.getMessages();
    if (!Array.isArray(messages)) return [];
    return messages.filter((message) => message && message.role !== 'system');
}

export interface AgentStreamHandlers {
    onContent?: (delta: string) => void;
    onThinking?: (delta: string) => void;
    onToolCall?: (toolCall: AgentToolCall) => void;
    /** 非致命提示（system_warning / done 里带的 warning） */
    onWarning?: (text: string) => void;
}

export interface AgentStreamOutcome {
    content: string;
    thinking: string;
    usage?: AgentUsage;
    durationMs?: number;
    /** 流以 error 分片结束时写入（此时不抛异常，UI 需要把错误显示在气泡里） */
    error?: string;
    errorCode?: string;
}

/** 消费一次流式对话；`timeoutMs` 是**静默看门狗**（默认 2 分钟无任何分片即中止） */
export async function streamConversation(
    conversation: AgentConversation,
    content: string,
    handlers: AgentStreamHandlers = {},
    timeoutMs = 120_000
): Promise<AgentStreamOutcome> {
    const outcome: AgentStreamOutcome = { content: '', thinking: '' };
    const stream = await conversation.chatStream(content);
    const iterator = stream[Symbol.asyncIterator]();
    let timedOut = false;

    try {
        for (;;) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const guard = new Promise<'timeout'>((resolve) => {
                timer = setTimeout(() => resolve('timeout'), timeoutMs);
            });
            const next = await Promise.race([iterator.next(), guard]);
            if (timer) clearTimeout(timer);

            if (next === 'timeout') {
                timedOut = true;
                break;
            }
            if (next.done) break;

            const chunk: AgentStreamChunk = next.value;
            if (!chunk || typeof chunk !== 'object') continue;

            switch (chunk.type) {
                case 'content_delta':
                    if (chunk.content) {
                        outcome.content += chunk.content;
                        handlers.onContent?.(chunk.content);
                    }
                    break;
                case 'thinking_delta':
                    if (chunk.content) {
                        outcome.thinking += chunk.content;
                        handlers.onThinking?.(chunk.content);
                    }
                    break;
                case 'tool_call':
                case 'tool_call_complete':
                    if (chunk.toolCall) handlers.onToolCall?.(chunk.toolCall);
                    break;
                case 'system_warning':
                    if (chunk.warning) handlers.onWarning?.(chunk.warning);
                    break;
                case 'done':
                    outcome.usage = chunk.usage;
                    outcome.durationMs = chunk.durationMs;
                    if (chunk.warning) handlers.onWarning?.(chunk.warning);
                    break;
                case 'error':
                    outcome.error = describeAgentError(chunk.error || '模型返回错误', chunk.errorCode);
                    outcome.errorCode = chunk.errorCode;
                    outcome.usage = chunk.usage;
                    break;
                default:
                    // content_block / new_message 等：本轮 UI 不做区分展示
                    break;
            }
        }
    } finally {
        // 正常 `done` 之后迭代器自己已断开连接；提前 break / 超时 / 抛错时必须显式 return()，
        // 否则 SW 侧的 port 会一直挂着（官方 processStream 的注释专门写了这一点）
        await iterator.return?.();
    }

    if (timedOut && !outcome.content && !outcome.error) {
        outcome.error = '等待模型响应超过 ' + Math.round(timeoutMs / 1000) + ' 秒，已中止本次请求。';
        outcome.errorCode = 'timeout';
    }
    return outcome;
}

/* ============================================================ 技能 */

export async function listSkills(api: CatAgentApi): Promise<AgentSkillSummary[]> {
    const list = await api.skills.list();
    return Array.isArray(list) ? list : [];
}

export async function removeSkill(api: CatAgentApi, name: string): Promise<boolean> {
    return api.skills.remove(name);
}

/* ============================================================ 定时任务 */

export async function listTasks(api: CatAgentApi): Promise<AgentTask[]> {
    const list = await api.task.list();
    return Array.isArray(list) ? list : [];
}

/** 任务动作的薄封装：把「哪个动作失败」写进日志，便于用户回看运行日志定位 */
export async function runTaskAction(
    api: CatAgentApi,
    action: string,
    run: (task: AgentTaskApi) => Promise<unknown>
): Promise<void> {
    try {
        await run(api.task);
        addLog('[Agent] 定时任务' + action + '成功', 'success');
    } catch (error) {
        const message = agentErrorMessage(error);
        addLog('[Agent] 定时任务' + action + '失败: ' + message, 'error');
        throw error;
    }
}

export function buildTaskInput(draft: { name: string; crontab: string; prompt: string }): AgentTaskInput {
    return {
        name: draft.name.trim(),
        crontab: draft.crontab.trim(),
        prompt: draft.prompt.trim(),
        mode: 'internal',
        enabled: true,
        notify: false,
    };
}

/**
 * 五字段 crontab 的**轻量**校验（分 时 日 月 周）。
 * 只挡明显写错（字段数不对、出现非法字符），不做完整 cron 语义校验 ——
 * 真正的合法性由 ScriptCat 的 TaskScheduler 判定，这里的作用是让用户尽早得到反馈。
 */
export function validateCrontab(expression: string): string {
    const text = expression.trim();
    if (!text) return '请填写 crontab（五段：分 时 日 月 周）';
    const fields = text.split(/\s+/);
    if (fields.length !== 5) return 'crontab 需要 5 段（分 时 日 月 周），当前 ' + fields.length + ' 段';
    for (const field of fields) {
        if (!/^[\d*,\-/]+$/.test(field)) return 'crontab 里有不支持的字符：' + field;
    }
    return '';
}

/** 判断某个已安装技能是否被 agent 对话自动加载（仅用于界面提示措辞） */
export function skillToolSummary(skill: AgentSkillSummary): string {
    const tools = Array.isArray(skill.toolNames) ? skill.toolNames : [];
    if (!tools.length) return '无工具';
    const shown = tools.slice(0, 3).map(toolDisplayName).join('、');
    return tools.length > 3 ? shown + ' 等 ' + tools.length + ' 个' : shown;
}
