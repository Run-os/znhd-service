import { addLog } from '@/lib/logger';
import { readVueInstance } from './convText';

/**
 * 魔法变量展开（v26.10.25-v1）。
 *
 * 规则表「内容」列里可以写 `${变量名}`，点按钮写入输入框前在**点击时刻**展开 ——
 * 保证数值新鲜（人数是实时变的，缓存展开结果会发旧值）。
 *
 * 语法：`/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g`，**未知变量名原样保留**（写错名不至于
 * 把话术里的字吞掉，使用者能在输入框里直接看到没展开的占位符再改）。
 *
 * ── 当前支持的变量 ────────────────────────────────────────────────────────────
 *   `${Active_Cnt}` = 正在对话人数。取值链（宿主 Vuex store，v1 实测字段，
 *   见 docs/tinymce-send-doc.md）：
 *     ① `state.chat.groupInfoList` 是数组 → 取 length；
 *     ② 否则 `state.allChat.historyMsg` 是对象 → Object.keys().length；
 *     ③ 都拿不到 → 0。
 *   每次解析成功记一条日志（来源 + 人数，**不记对话文本**，与 convText.ts 同一隐私红线）。
 *
 * ⚠️ 本模块通过 convText.ts 读宿主页面（`unsafeWindow` / `#app.__vue__`），
 *    但不发起任何网络请求；冒烟环境没有宿主 store 时安全返回 0。
 */

/** 变量名 → 取值实现。新变量加在这里（保持纯读取、不发请求） */
const RESOLVERS: Record<string, () => { value: string; source: string }> = {
    Active_Cnt: resolveActiveCnt,
};

/** 正在对话人数：从宿主 Vuex store 尽力读取（绝不抛错，拿不到按 0） */
function resolveActiveCnt(): { value: string; source: string } {
    const vm = readVueInstance();
    const st = vm?.$store?.state;
    if (st) {
        // ① groupInfoList：数组长度 = 正在对话人数（v26.10.24 实测字段）
        const chat = st['chat'] as Record<string, unknown> | undefined;
        const gil = chat ? chat['groupInfoList'] : undefined;
        if (Array.isArray(gil)) return { value: String(gil.length), source: 'groupInfoList' };
        // ② 兜底：allChat.historyMsg 以「会话 id → 消息」的形态存历史，键数 ≈ 会话数
        const allChat = st['allChat'] as Record<string, unknown> | undefined;
        const hm = allChat ? allChat['historyMsg'] : undefined;
        if (hm && typeof hm === 'object') {
            return { value: String(Object.keys(hm as object).length), source: 'historyMsg' };
        }
    }
    return { value: '0', source: '未知' };
}

/**
 * 展开文本里的魔法变量。
 * @param text 规则「内容」原文（未展开）
 * @returns 展开后的文本；无占位符时原串返回（零开销直通）
 */
export function expandMagicVars(text: string): string {
    if (!text || text.indexOf('${') < 0) return text;
    return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (raw: string, name: string) => {
        const resolver = RESOLVERS[name];
        if (!resolver) return raw; // 未知变量原样保留
        const { value, source } = resolver();
        addLog('正在对话人数（' + source + '）：' + value + ' 人', 'info');
        return value;
    });
}
