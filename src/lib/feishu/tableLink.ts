import { str, type HttpFn } from './http';
import type { RulesTableConfig } from './rules';

/**
 * 把使用者粘贴的「多维表格链接」解析并解析成可读表的定位信息（v26.10.23-v2）。
 *
 * ── 支持哪些链接 ──────────────────────────────────────────────────────────────
 *   ① wiki 分享链接 `https://xxx.feishu.cn/wiki/<节点token>?table=tblX&view=vewY`
 *      —— 从飞书「分享」按钮复制出来的就是这种。节点 token 不是 app_token，
 *      要先调 `wiki/v2/spaces/get_node` 换出 `obj_token` 才能读记录。
 *   ② base 直链 `https://xxx.feishu.cn/base/<appToken>?table=tblX&view=vewY`
 *   ③ 两者的 `table` / `view` 参数都可以省略：没给 table 就列该表第一个数据表，
 *      没给 view 就读全表（v1 的 view_id 本来就是可选参数）。
 *
 * ⚠️ 链接由使用者粘贴，**绝不假设域名**：只认路径形态，`xxx.feishu.cn` / 自建域名都吃得下。
 * ⚠️ get_node 需要 `wiki:wiki:readonly` scope（授权时已申请，见 oauth.ts 的 FEISHU_SCOPE）。
 */

const WIKI_NODE_API = 'https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node';
const TABLES_API = 'https://open.feishu.cn/open-apis/bitable/v1/apps';

/** 解析结果：wikiToken / appToken 二选一 */
export interface ParsedTableLink {
    /** `/wiki/<token>` 的节点 token（还需换成 obj_token） */
    wikiToken?: string;
    /** `/base/<token>`（或 `/bitable/<token>`）的多维表格 app_token */
    appToken?: string;
    /** `?table=` 参数，可缺省 */
    tableId?: string;
    /** `?view=` 参数，可缺省 */
    viewId?: string;
}

/** 解析多维表格链接；形态不认识返回 null（调用方提示使用者检查链接） */
export function parseTableLink(raw: string): ParsedTableLink | null {
    const s = (raw || '').trim();
    if (!s) return null;
    let url: URL;
    try {
        // 使用者常复制出形如 `https://xxx.feishu.cn/wiki/xxx?table=…&view=…` 的完整链接；
        // 少数人只粘 `xxx.feishu.cn/...`（无协议），补一下再解析
        url = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s);
    } catch {
        return null;
    }
    // 取路径第一段当类型：/wiki/<token>、/base/<token>、/bitable/<token>
    const segs = url.pathname.split('/').filter(Boolean);
    if (segs.length < 2) return null;
    const kind = segs[0].toLowerCase();
    const token = segs[1];
    if (!token) return null;
    const out: ParsedTableLink = {
        tableId: url.searchParams.get('table') || undefined,
        viewId: url.searchParams.get('view') || undefined,
    };
    if (kind === 'wiki') out.wikiToken = token;
    else if (kind === 'base' || kind === 'bitable') out.appToken = token;
    else return null;
    return out.wikiToken || out.appToken ? out : null;
}

/**
 * wiki 节点 → 多维表格 app_token（`obj_token`）。
 * 节点不是 bitable（比如是文档/思维笔记）时报错并点明原因。
 */
async function resolveWikiToken(http: HttpFn, token: string, wikiToken: string): Promise<string> {
    const res = await http({
        method: 'GET',
        url: WIKI_NODE_API + '?token=' + encodeURIComponent(wikiToken),
        headers: { Authorization: 'Bearer ' + token },
    });
    const body = JSON.parse(res.text || '{}') as Record<string, unknown>;
    if (Number(body['code']) !== 0) {
        throw new Error('解析 wiki 链接失败：' + (str(body, 'msg') || 'HTTP ' + res.status));
    }
    const data = (body['data'] || {}) as Record<string, unknown>;
    const node = (data['node'] || {}) as Record<string, unknown>;
    if (str(node, 'obj_type') !== 'bitable') {
        throw new Error('该链接指向的不是多维表格（obj_type=' + (str(node, 'obj_type') || '未知') + '）');
    }
    const objToken = str(node, 'obj_token');
    if (!objToken) throw new Error('wiki 节点里没有 obj_token（表格可能已被删除或无权访问）');
    return objToken;
}

/** 没给 `?table=` 时列该多维表格的第一个数据表 */
async function fetchFirstTableId(http: HttpFn, token: string, appToken: string): Promise<string> {
    const res = await http({
        method: 'GET',
        url: TABLES_API + '/' + encodeURIComponent(appToken) + '/tables?page_size=20',
        headers: { Authorization: 'Bearer ' + token },
    });
    const body = JSON.parse(res.text || '{}') as Record<string, unknown>;
    if (Number(body['code']) !== 0) {
        throw new Error('列出数据表失败：' + (str(body, 'msg') || 'HTTP ' + res.status));
    }
    const data = (body['data'] || {}) as Record<string, unknown>;
    const items = Array.isArray(data['items']) ? (data['items'] as Record<string, unknown>[]) : [];
    const first = items.length ? str(items[0], 'table_id') : '';
    if (!first) throw new Error('该多维表格里没有数据表');
    return first;
}

/**
 * 链接 → 可读表的定位信息。
 * @param token user_access_token（wiki 换 token / 列数据表都要）
 */
export async function resolveTableLink(http: HttpFn, token: string, link: ParsedTableLink): Promise<RulesTableConfig> {
    const appToken = link.appToken || (link.wikiToken ? await resolveWikiToken(http, token, link.wikiToken) : '');
    if (!appToken) throw new Error('链接里既没有 wiki 节点也没有 app_token，无法定位表格');
    const tableId = link.tableId || (await fetchFirstTableId(http, token, appToken));
    const cfg: RulesTableConfig = { appToken, tableId };
    if (link.viewId) cfg.viewId = link.viewId;
    return cfg;
}
