import { num, parseJson, str, type HttpFn } from './http';

/**
 * 搜索使用者可访问的多维表格（v26.10.24-v6）—— 让设置面板「从飞书选择表格」
 * 不再要求使用者自己去找分享链接粘贴。
 *
 * ── 接口选择：照抄飞书官方 CLI（larksuite/cli）的 `drive +search` ──────────────
 * CLI 源码 `shortcuts/drive/drive_search.go` 用的是
 *   `POST /open-apis/search/v2/doc_wiki/search`，scope 只有 `search:docs:read`。
 * 这是**唯一能覆盖「别人分享给我、但不在我的云空间里」**的表格的接口；
 * 相比之下 `drive/v1/files` 只能列某个文件夹下自己空间里的东西，还得逐层翻。
 *
 * ── 请求体形态（对齐 CLI 的 default 分支）────────────────────────────────────
 *   { query, page_size, page_token?,
 *     doc_filter: { doc_types: ['bitable'] },
 *     wiki_filter: { doc_types: ['bitable'] } }
 * `doc_filter` 管云空间文档、`wiki_filter` 管知识库节点，**两边各自独立**，
 * 只给一边会漏掉另一半（知识库里的多维表格只出现在 wiki_filter 里）。
 *
 * ── 实测/源码确认的约束 ──────────────────────────────────────────────────────
 *   · query 按 **Unicode 码点**算上限 30，超了服务端直接 99992402 —— 所以用
 *     `Array.from()` 截断（`slice()` 会把 surrogate pair 切坏）。
 *   · query 允许留空，等价于「按 filter 浏览全部多维表格」。
 *   · 返回 `data.res_units[]`，标题有两种形态：`title` 与 `title_highlighted`
 *     （后者夹着 `<hb>`/`<h>` 高亮标签，CLI 用 `/<\/?hb?>/` 清掉，这里照抄）。
 *   · 链接在 `result_meta.url`；wiki 节点给的是 `/wiki/<nodeToken>`，
 *     交给现有的 `parseTableLink` → `resolveTableLink` 就能换出 app_token。
 */

const SEARCH_API = 'https://open.feishu.cn/open-apis/search/v2/doc_wiki/search';

/**
 * 搜索云文档的 scope。**必须与 oauth.ts 的 FEISHU_SCOPE 里那一项完全一致**：
 * `getStatus()` 用它在本地判断「当前 token 有没有搜索权限」，不一致会导致
 * 明明能搜却被拦在门外（或反过来放进去再报错）。
 */
export const SEARCH_SCOPE = 'search:docs:read';

/** 单页条数：飞书 v2 上限 20，CLI 默认 15，取 15 与 CLI 行为对齐 */
const PAGE_SIZE = 15;

/** query 上限（码点数），服务端硬限制 */
const QUERY_MAX = 30;

export interface BitableDoc {
    /** 去高亮标签后的标题 */
    title: string;
    /** 文档在飞书里的完整链接（wiki 节点 / base 直链都会有） */
    url: string;
    /** `bitable` / `wiki` / … 用于界面标注来源 */
    type: string;
    /** 最后编辑时间（ms），0 = 未知 */
    editedAt: number;
}

export interface DocSearchPage {
    items: BitableDoc[];
    /** 下一页游标，空 = 没有下一页 */
    pageToken: string;
    hasMore: boolean;
}

/** 清掉飞书标题里的高亮标签 `<hb>` / `<h>`（CLI 同款正则） */
function stripHighlight(s: string): string {
    return s.replace(/<\/?hb?>/g, '');
}

/**
 * 时间字段统一成毫秒戳。
 * 优先 `update_time_iso`（CLI 也用它）；只有裸 `update_time` 时按量级判断秒/毫秒
 * —— 飞书不同接口给的单位不一致，1e12 以下不可能是毫秒戳。
 */
function timeOf(meta: Record<string, unknown>): number {
    const iso = str(meta, 'update_time_iso');
    if (iso) {
        const t = Date.parse(iso);
        if (Number.isFinite(t)) return t;
    }
    const raw = num(meta, 'update_time');
    if (!raw) return 0;
    return raw < 1e12 ? raw * 1000 : raw;
}

/** 一次搜索结果项 → 本地结构 */
function toItem(u: Record<string, unknown>): BitableDoc {
    const meta = (u['result_meta'] || {}) as Record<string, unknown>;
    // 高亮标题优先：搜索时它就是命中片段，信息量比原题多
    const title = stripHighlight(str(u, 'title_highlighted') || str(u, 'title'));
    const types = Array.isArray(meta['doc_types']) ? (meta['doc_types'] as unknown[]) : [];
    const first = typeof types[0] === 'string' ? (types[0] as string) : '';
    return {
        title: title || '（无标题）',
        url: str(meta, 'url'),
        type: first || str(u, 'entity_type'),
        editedAt: timeOf(meta),
    };
}

/**
 * 权限类错误码：都是「token 有效但没这个 scope / 应用没被授予」。
 * 99991672 = app_scope_not_applied（本项目在 base v3 上踩过），
 * 99991679 / 99991663 = permission denied 系列。
 */
const SCOPE_CODES = [99991672, 99991679, 99991663];

/** 错误码 → 人话。单独导出便于冒烟直接断言文案。 */
export function searchErrorText(code: number, msg: string): string {
    const tail = msg ? '（' + msg + '）' : '';
    if (code === 99992402) {
        return '搜索关键词太长：飞书限制 ' + QUERY_MAX + ' 个字符以内' + tail;
    }
    if (SCOPE_CODES.indexOf(code) >= 0) {
        return '当前授权不含「搜索云文档」权限' + tail + '：点「重新授权」，在飞书授权页把权限全部勾选后确认。';
    }
    return '搜索失败（' + code + '）' + tail;
}

/**
 * 搜多维表格。
 * @param query    关键词，可留空（= 列出全部可访问的多维表格）
 * @param pageToken 上一页返回的 pageToken，空 = 第一页
 */
export async function searchBitableDocs(
    http: HttpFn,
    token: string,
    query: string,
    pageToken = ''
): Promise<DocSearchPage> {
    const body: Record<string, unknown> = {
        query: Array.from((query || '').trim())
            .slice(0, QUERY_MAX)
            .join(''),
        page_size: PAGE_SIZE,
        doc_filter: { doc_types: ['bitable'] },
        wiki_filter: { doc_types: ['bitable'] },
    };
    if (pageToken) body['page_token'] = pageToken;

    const res = await http({
        method: 'POST',
        url: SEARCH_API,
        headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
    });

    const raw = parseJson(res.text);
    if (!raw) throw new Error('搜索接口返回了非 JSON 响应（HTTP ' + res.status + '）');
    // 缺 code 一律当失败：当成功会显示「没有结果」，把权限/参数问题伪装成空列表
    if (!('code' in raw)) throw new Error('搜索接口响应缺少 code 字段（HTTP ' + res.status + '）');
    const code = num(raw, 'code');
    if (code !== 0) throw new Error(searchErrorText(code, str(raw, 'msg')));

    const data = (raw['data'] || {}) as Record<string, unknown>;
    const units = Array.isArray(data['res_units']) ? (data['res_units'] as Record<string, unknown>[]) : [];
    // 没有 url 的结果无法回填到「规则表链接」，直接丢弃（列表里点了也没用）
    const items = units.map(toItem).filter((it) => !!it.url);
    return {
        items,
        pageToken: str(data, 'page_token'),
        hasMore: data['has_more'] === true,
    };
}
