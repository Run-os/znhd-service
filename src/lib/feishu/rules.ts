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

const F_TITLE = '标题';
const F_TAGS = '标签';
const F_REPLY = '内容';
const F_EXCLUDE = '排除词';
/** 「是否常显」列（v26.10.25-v1）：复选框列，true = 永远显示、排最前、不参与匹配 */
const F_PINNED = '是否常显';

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

/** 把一行记录映射成规则；标题与内容都空的空行直接丢弃 */
function toRule(rec: Record<string, unknown>): QuickReplyRule | null {
    const fields = (rec['fields'] || {}) as Record<string, unknown>;
    const title = cellText(fields[F_TITLE]).trim();
    const reply = cellText(fields[F_REPLY]);
    if (!title && !reply) return null;
    return {
        id: str(rec, 'record_id'),
        title: title || reply.slice(0, 12),
        keywords: cellList(fields[F_TAGS]),
        excludes: cellList(fields[F_EXCLUDE]),
        reply,
        pinned: cellBool(fields[F_PINNED]),
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
