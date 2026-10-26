import { str, type HttpFn } from './http';
import type { QuickReplyRule } from './types';

/**
 * 从飞书多维表格读取快捷回复规则。
 *
 * ── 为什么走 bitable **v1** 而不是新版 base v3 ────────────────────────────────
 * v3（`/open-apis/base/v3/apps/...`）把权限拆成一列一个的细粒度 scope
 * （`base:record:read`、`base:field:read`…），设备授权时要么逐个申请、要么被拒
 * 99991672；v1 只认 `bitable:app:readonly` 一个粗粒度 scope，一次授权覆盖读表 + 读字段。
 * 实测 2026-10-23：v1 `records` 接口 `code: 0` 正常返回全部记录。
 *
 * ── 列约定 ────────────────────────────────────────────────────────────────────
 *   `标题`  → 按钮文字
 *   `标签`  → 命中关键词（多选，对话文本包含任意一个即命中）
 *   `内容`  → 点按钮后填进输入框的文本
 *   `排除词` → 可选；对话文本包含任意一个则这条不显示。**表里没有这一列时自动降级为不排除**
 *             （使用者可能还没加上，不能因此整表读不出来）。
 *   `是否常显` → 可选（v26.10.25-v1）；复选框列，true = 忽略标签/排除词、始终显示且排最前。
 *             列不存在或值为空时按普通规则处理，不影响整表读取。
 *
 * 单元格值的形态随列类型变化：文本列是字符串，多选列是字符串数组，富文本/公式列可能是
 * `[{type:'text', text:'…'}]` 的分段数组 —— 统一在 `cellText` / `cellList` 里消化。
 */

const RECORDS_API = 'https://open.feishu.cn/open-apis/bitable/v1/apps';

/**
 * 规则表定位。
 * v26.10.23-v2 起不再写死：由设置面板的「规则表链接」解析而来（见 tableLink.ts），
 * `viewId` 可缺省（链接里没带 `?view=` 时读全表）。
 */
export interface RulesTableConfig {
    appToken: string;
    tableId: string;
    viewId?: string;
}

const F_TAGS = '标签';
const F_EXCLUDE = '排除词';
/** 「是否常显」列（v26.10.25-v1）：复选框列，true = 永远显示、排最前、不参与匹配 */
const F_PINNED = '是否常显';

/**
 * 标题 / 内容列的候选名（v26.10.26-v1）。
 *
 * ── 为什么需要别名 ────────────────────────────────────────────────────────────
 * 隐私信息表是使用者另建的，列名常常不是「标题 / 内容」而是「名称 / 信息项 / 文本」等。
 * 只认死列名时 `title` 会落进「内容前 12 字」的回退 ⇒ 快捷短语栏/隐私栏的按钮显示的是
 * **被截断的正文**而不是标题（2026-10-26 实际发生：隐私表第一列不是「标题」）。
 *
 * 匹配策略（`pickField`）：先忽略大小写/空格/下划线/斜杠做**精确**匹配；
 * 再对前 4 个主别名做**包含**匹配（表头常带后缀，如「标题（必填）」「内容/话术」），
 * 「值 / 键 / text」这类短别名只参与精确匹配，避免误伤别的列。
 * 一条都没匹配到 ⇒ `titleFallback = true`，由上层记日志提示补列，而不是静默显示正文。
 */
const TITLE_ALIASES = ['标题', '名称', '信息项', '项目', '事项', '条目', '字段', '键', 'title', 'name'];
const REPLY_ALIASES = ['内容', '文本', '正文', '详情', '话术', '值', '回复', 'content', 'text', 'value'];

/** 列名归一化：去空格/下划线/斜杠、转小写（「标题 Title」「内容/话术」都能对上） */
function normKey(k: string): string {
    return k
        .trim()
        .toLowerCase()
        .replace(/[\s_\-/]+/g, '');
}

/**
 * 按候选名从一个 record 的 fields 里取值（空值视为没找到，继续找下一个候选）。
 * 返回**原样**文本，是否 trim 由调用方决定。
 */
function pickField(fields: Record<string, unknown>, aliases: string[]): string {
    const keys = Object.keys(fields);
    // ① 精确匹配
    for (const a of aliases) {
        const want = normKey(a);
        const k = keys.find((kk) => normKey(kk) === want);
        if (k !== undefined) {
            const raw = cellText(fields[k]);
            if (raw.trim()) return raw;
        }
    }
    // ② 包含匹配（只对主别名，避免「值」「键」这类短词误伤）
    for (const a of aliases.slice(0, 4)) {
        const want = normKey(a);
        const k = keys.find((kk) => normKey(kk).includes(want));
        if (k !== undefined) {
            const raw = cellText(fields[k]);
            if (raw.trim()) return raw;
        }
    }
    return '';
}

/** 把一个单元格值压成纯文本（兼容富文本分段数组） */
function cellText(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (Array.isArray(v)) {
        return v
            .map((seg) => {
                if (typeof seg === 'string') return seg;
                if (seg && typeof seg === 'object') {
                    const o = seg as Record<string, unknown>;
                    return str(o, 'text') || str(o, 'name') || str(o, 'link');
                }
                return '';
            })
            .join('');
    }
    return '';
}

/** 把一个单元格值压成字符串数组（多选列 / 逗号分隔文本都吃得下） */
function cellList(v: unknown): string[] {
    if (Array.isArray(v)) {
        return v.map(cellText).flatMap((t) => splitLoose(t));
    }
    const t = cellText(v);
    return splitLoose(t);
}

/** 宽松拆分：中文逗号 / 英文逗号 / 顿号 / 换行 / 分号都当分隔符 */
function splitLoose(t: string): string[] {
    return t
        .split(/[,，、;；\n\r]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * 「是否常显」单元格解析：布尔直接用；字符串按 'true'/'是'/'1'/'√' 判 true；
 * 列不存在（undefined）时为 false。
 */
function cellBool(v: unknown): boolean {
    if (typeof v === 'boolean') return v;
    const t = cellText(v).trim().toLowerCase();
    return t === 'true' || t === '是' || t === '1' || t === '√';
}

/** 把一行记录映射成规则；标题与内容都空的空行直接丢弃（标题/内容列支持别名，见 TITLE_ALIASES） */
function toRule(rec: Record<string, unknown>): QuickReplyRule | null {
    const fields = (rec['fields'] || {}) as Record<string, unknown>;
    const title = pickField(fields, TITLE_ALIASES).trim();
    const reply = pickField(fields, REPLY_ALIASES);
    if (!title && !reply.trim()) return null;
    return {
        id: str(rec, 'record_id'),
        title: title || reply.trim().slice(0, 12),
        keywords: cellList(fields[F_TAGS]),
        excludes: cellList(fields[F_EXCLUDE]),
        reply,
        pinned: cellBool(fields[F_PINNED]),
        /** 没有可识别的标题列 ⇒ 按钮文字是内容截断（上层据此记日志提示补列） */
        titleFallback: !title,
    };
}

/**
 * 拉取全部规则（自动翻页）。
 *
 * @param http  特权请求实现（见 http.ts 的 gmHttp）
 * @param token user_access_token（有效期 2h，由调用方负责刷新）
 * @param cfg   表定位信息
 */
export async function fetchRules(http: HttpFn, token: string, cfg: RulesTableConfig): Promise<QuickReplyRule[]> {
    const rules: QuickReplyRule[] = [];
    let pageToken = '';
    for (let page = 0; page < 20; page++) {
        const query =
            '?page_size=500' +
            (cfg.viewId ? '&view_id=' + encodeURIComponent(cfg.viewId) : '') +
            (pageToken ? '&page_token=' + encodeURIComponent(pageToken) : '');
        const res = await http({
            method: 'GET',
            url: RECORDS_API + '/' + cfg.appToken + '/tables/' + cfg.tableId + '/records' + query,
            headers: { Authorization: 'Bearer ' + token },
        });
        const body = JSON.parse(res.text || '{}') as Record<string, unknown>;
        if (Number(body['code']) !== 0) {
            const msg = str(body, 'msg') || 'HTTP ' + res.status;
            throw new Error('读取飞书规则表失败：' + msg);
        }
        const data = (body['data'] || {}) as Record<string, unknown>;
        const items = Array.isArray(data['items']) ? (data['items'] as Record<string, unknown>[]) : [];
        for (const it of items) {
            const rule = toRule(it);
            if (rule) rules.push(rule);
        }
        if (!data['has_more']) break;
        pageToken = str(data, 'page_token');
        if (!pageToken) break;
    }
    return rules;
}
