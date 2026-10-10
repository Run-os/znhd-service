/**
 * ScriptCat Agent API（`CAT.agent.*`）的类型声明与纯工具函数。
 *
 * ── 为什么这里自己声明（v26.10.10-v10）──────────────────────────────────────
 * 官方 d.ts 随 ScriptCat 仓库发布（`src/app/service/agent/core/types.ts` 与
 * `src/types/scriptcat.d.ts`），**不进本仓库的 node_modules**：本脚本是油猴脚本，
 * `npm run typecheck` 用的是本仓库 tsconfig，拿不到 `declare const CAT`。
 * 故此处按官方类型等价声明一份，唯一约束是「只声明 UI 真正用到的字段」。
 *
 * ⚠️ **本文件按官方源码（而非官方文档）对齐**，三处文档与实现不一致已在下方逐条标注
 * `[与文档不符]`。改这里之前建议先回看官方 `src/app/service/agent/core/types.ts`。
 *
 * ── 可用性前提 ─────────────────────────────────────────────────────────────
 * 整套 `CAT.agent.*` 是 **ScriptCat v1.4+** 才有的能力，且需逐项 `@grant`
 * （见 `config/common.meta.json`）。Tampermonkey 等其它管理器里 `CAT` 全局根本不存在，
 * 故所有调用都必须先过 `src/lib/agent/api.ts` 的探测，**绝不能直接摸 `CAT.agent`**。
 *
 * ── 本文件不做任何运行时副作用 ─────────────────────────────────────────────
 * 只有类型 + 纯函数（内容压平 / 工具名去命名空间），可被 UI 复用。
 */

/* ============================================================ 消息内容 */

export interface AgentTextBlock {
    type: 'text';
    text: string;
}

/** 图片块：`attachmentId` 由 `conversation.attach()` 得到 */
export interface AgentImageBlock {
    type: 'image';
    attachmentId: string;
    mimeType: string;
}

/** 文件块 */
export interface AgentFileBlock {
    type: 'file';
    attachmentId: string;
    mimeType: string;
    filename: string;
}

/** 音频块 */
export interface AgentAudioBlock {
    type: 'audio';
    attachmentId: string;
    mimeType: string;
}

/** 多模态内容块（本次只发纯文本，其余留给将来） */
export type AgentContentBlock = AgentTextBlock | AgentImageBlock | AgentFileBlock | AgentAudioBlock;

/** 消息正文：纯文本或多模态块数组 */
export type AgentMessageContent = string | AgentContentBlock[];

/** 把正文压成一行可显示文本（图片/文件/音频退化成占位标记） */
export function contentToText(content: AgentMessageContent): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .map((block) => {
            if (!block || typeof block !== 'object') return '';
            switch (block.type) {
                case 'text':
                    return typeof block.text === 'string' ? block.text : '';
                case 'image':
                    return '[图片]';
                case 'file':
                    return '[文件 ' + (typeof block.filename === 'string' ? block.filename : '') + ']';
                case 'audio':
                    return '[音频]';
                default:
                    return '';
            }
        })
        .join('');
}

/**
 * 把思考过程归一成字符串。
 *
 * ⚠️ 只有 `chat()` / 流式分片累加出来的是**字符串**；`getMessages()` 返回的历史消息里
 * `thinking` 是**对象**（官方 `ThinkingBlock = { content: string }`，见 scriptcat
 * `core/types.ts:94-96` 与 `tool_loop_orchestrator.ts:696` 的
 * `thinking: result.thinking ? { content: result.thinking } : undefined`）。
 * 直接把对象交给 React 渲染会抛
 * `Objects are not valid as a React child (found: object with keys {content})`，
 * 而面板没有错误边界 ⇒ 整棵面板树被卸载（v26.10.10-v11 之前线上真实踩到：
 * 对话过后关弹窗再打开，主面板整个消失且不自愈）。
 */
export function thinkingToText(thinking: string | { content?: string } | null | undefined): string {
    if (typeof thinking === 'string') return thinking;
    if (thinking && typeof thinking === 'object' && typeof thinking.content === 'string') return thinking.content;
    return '';
}

/* ============================================================ 模型 */

export interface AgentModelSummary {
    id: string;
    name: string;
    provider: 'openai' | 'anthropic' | 'zhipu';
    apiBaseUrl: string;
    model: string;
    maxTokens: number;
    contextWindow: number;
    supportsVision: boolean;
    supportsImageOutput: boolean;
}

export interface AgentModelApi {
    list(): Promise<AgentModelSummary[]>;
    get(modelId: string): Promise<AgentModelSummary | null>;
    /**
     * ⚠️ [与文档不符] 文档写「返回文本摘要」，官方 d.ts 标注 `Promise<string>`，
     * 而实际实现返回的是 `ModelSummary | null`（默认模型的完整摘要）。
     * 形状在 2026 年内改过，故调用侧**必须运行时判型**（见 api.ts 的 pickDefaultModelId）。
     */
    getDefault(): Promise<unknown>;
}

/* ============================================================ 工具调用 */

/** 工具调用松紧不一致：arguments 是增量拼出来的 JSON 字符串，result 是 JSON 字符串结果 */
export interface AgentToolCall {
    id?: string;
    name: string;
    /** JSON 字符串（流式期间可能是半截的，不可直接 JSON.parse） */
    arguments?: string;
    /** 同名旧字段，兼容部分返回形状 */
    args?: unknown;
    result?: string;
    status?: 'pending' | 'running' | 'completed' | 'error';
    attachments?: Array<{ id: string; type: string; name: string; mimeType: string; size?: number }>;
}

/**
 * 工具名既可能是裸名（`read_file`），也可能带服务端命名空间（`mcp__xxx__read_file`）。
 * 面板上只显示最后一段，避免超长名把按钮撑破。
 */
export function toolDisplayName(name: string): string {
    const raw = typeof name === 'string' ? name : '';
    const parts = raw.split('__').filter((segment) => segment.length > 0);
    return parts.length > 1 ? parts[parts.length - 1] : raw || '工具';
}

/* ============================================================ 对话 */

export interface AgentUsage {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
}

export interface AgentChatResult {
    content: AgentMessageContent;
    thinking?: string;
    toolCalls?: AgentToolCall[];
    usage?: AgentUsage;
    durationMs?: number;
    /** [与文档不符] 官方类型是 `boolean`（标识该回复来自命令处理器），非 `{name,result}` */
    command?: boolean;
    /** 非致命警告（如图片保存失败） */
    warning?: string;
}

/** 流式分片（按官方 `StreamChunk` 联合类型逐项对齐） */
export interface AgentStreamChunk {
    type:
        | 'content_delta'
        | 'thinking_delta'
        | 'tool_call'
        | 'tool_call_complete'
        | 'content_block'
        | 'new_message'
        | 'system_warning'
        | 'done'
        | 'error';
    content?: string;
    block?: AgentContentBlock;
    toolCall?: AgentToolCall;
    usage?: AgentUsage;
    durationMs?: number;
    error?: string;
    /** rate_limit / auth / tool_timeout / context_too_large / api_error */
    errorCode?: string;
    /** type 为 system_warning 时是警告文本；type 为 done 时是本轮累计警告 */
    warning?: string;
}

export interface AgentChatMessage {
    id?: string;
    conversationId?: string;
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: AgentMessageContent;
    toolCalls?: AgentToolCall[];
    toolCallId?: string;
    /**
     * 历史消息里是官方 `ThinkingBlock`（对象 `{ content }`），只有 `chat()` 的返回值是字符串。
     * 渲染前必须过 `thinkingToText()`，否则整棵 React 树会被对象子节点炸掉。
     */
    thinking?: string | { content: string };
    createtime?: number;
}

/** 脚本可注入的自定义工具（需要 handler，签名见官方 `ToolDefinition`） */
export interface AgentToolDefinition {
    name: string;
    description: string;
    /** JSON Schema */
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
}

export interface AgentChatOptions {
    tools?: AgentToolDefinition[];
}

export interface AgentConversationOptions {
    id?: string;
    system?: string;
    /** modelId，不传则用默认模型 */
    model?: string;
    /** 'auto' = 加载全部已装技能；数组 = 指定技能名 */
    skills?: 'auto' | string[];
    tools?: AgentToolDefinition[];
    commands?: Record<string, unknown>;
    /** true = 不持久化、不加载内置资源，工具只能由脚本提供 */
    ephemeral?: boolean;
    /** 提示词缓存，默认开 */
    cache?: boolean;
    /** 后台运行：UI 断开后继续 */
    background?: boolean;
}

export interface AgentConversation {
    /** 只读：对话 id */
    readonly id: string;
    readonly title: string;
    readonly modelId: string;
    chat(content: AgentMessageContent, options?: AgentChatOptions): Promise<AgentChatResult>;
    /** ⚠️ **返回值是 Promise**，必须 `await` 后才拿到异步迭代器（官方文档示例漏了 await） */
    chatStream(content: AgentMessageContent, options?: AgentChatOptions): Promise<AsyncIterable<AgentStreamChunk>>;
    getMessages(): Promise<AgentChatMessage[]>;
    clear(): Promise<void>;
    save(): Promise<void>;
    attach(blob: Blob, meta?: Record<string, unknown>): Promise<{ attachmentId: string; mimeType: string }>;
}

export interface AgentConversationApi {
    create(options?: AgentConversationOptions): Promise<AgentConversation>;
    /** 不存在返回 null */
    get(id: string): Promise<AgentConversation | null>;
}

/* ============================================================ 技能 */

export interface AgentSkillSummary {
    name: string;
    description: string;
    version: string;
    toolNames: string[];
    referenceNames: string[];
    hasConfig: boolean;
    enabled: boolean;
    installUrl?: string;
    installtime?: number;
    updatetime?: number;
}

export interface AgentSkillApi {
    list(): Promise<AgentSkillSummary[]>;
    get(name: string): Promise<unknown>;
    /** skillMd 为技能清单原文；scripts/references 为可选附带文件 */
    install(skillMd: string, scripts?: Record<string, string>, references?: Record<string, string>): Promise<unknown>;
    remove(name: string): Promise<boolean>;
    /** 执行技能脚本（默认超时 300s，可在脚本内 @timeout 覆盖） */
    call(skillName: string, scriptName: string, params?: Record<string, unknown>): Promise<unknown>;
}

/* ============================================================ 定时任务 */

export type AgentTaskMode = 'internal' | 'event';
export type AgentTaskRunStatus = 'success' | 'failed' | 'running' | 'skipped' | string;

export interface AgentTask {
    id: string;
    name: string;
    /** 五字段 crontab：分 时 日 月 周 */
    crontab: string;
    mode: AgentTaskMode;
    enabled: boolean;
    notify: boolean;
    nextruntime?: number;
    lastruntime?: number;
    lastRunStatus?: AgentTaskRunStatus;
    lastRunError?: string;
    createtime?: number;
}

export interface AgentTaskInput {
    name: string;
    crontab: string;
    mode?: AgentTaskMode;
    enabled?: boolean;
    notify?: boolean;
    prompt?: string;
    modelId?: string;
    skills?: 'auto' | string[];
}

export interface AgentTaskRunEvent {
    taskId: string;
    name: string;
    crontab: string;
    triggeredAt: number;
}

export interface AgentTaskApi {
    create(input: AgentTaskInput): Promise<AgentTask>;
    list(): Promise<AgentTask[]>;
    get(id: string): Promise<AgentTask | null>;
    update(id: string, patch: Partial<AgentTaskInput>): Promise<AgentTask>;
    remove(id: string): Promise<boolean>;
    /** 非阻塞触发一次 */
    runNow(id: string): Promise<void>;
    addListener(taskId: string, cb: (event: AgentTaskRunEvent) => void): void;
    removeListener(listenerId: string): void;
}

/* ============================================================ 顶层 */

export interface CatAgentApi {
    conversation: AgentConversationApi;
    model: AgentModelApi;
    skills: AgentSkillApi;
    task: AgentTaskApi;
}

/** 四个子能力，用于逐项探测可用性（顺序即面板提示里的列出顺序） */
export const CAT_AGENT_PARTS = ['conversation', 'model', 'skills', 'task'] as const;

export type CatAgentPart = (typeof CAT_AGENT_PARTS)[number];
