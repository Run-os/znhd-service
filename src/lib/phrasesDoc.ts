/**
 * 常用语数据源解析（v26.10.17-v3）。
 *
 * ── 为什么要有这个文件 ───────────────────────────────────────────────────
 * 常用语原本只支持「远程 YAML」（`commonPhrasesUrl` → js-yaml 解析）。用户希望
 * 直接用腾讯文档维护常用语，于是这里加一条**腾讯文档普通文档**（`/doc/<id>`）通道：
 *
 *   GET https://docs.qq.com/dop-api/opendoc?id=<id>&normal=1&outformat=1&noEscape=1
 *
 * 该接口**匿名可读**（分享权限为「获得链接的人可阅读」时 `canRead:true`），返回纯 JSON，
 * 正文在 `clientVars.collab_client_vars.initialAttributedText`。⚠️ 只支持普通文档：
 * 智能文档（`/aio/`，smartcanvas）正文要另走 `POST /api/smartdoc/get/records`，
 * 匿名请求返回 `12607 没有权限`（实测），**不要**试图在这里兼容。
 *
 * ── 文档约定（用户指定）────────────────────────────────────────────────────
 *   · **一级标题（heading 1）** 作为常用语的「标题」（即键名）；
 *   · 该一级标题之下的所有文本 = 该条常用语的正文（多行用换行连接）；
 *   · 第一个一级标题**之前**的内容（通常是说明文字）整段丢弃；
 *   · 超链接写成 `\u0013HYPERLINK <url> ... \u0014<显示文字>\u0015` 的字段结构，
 *     显示文字其实就等于 URL（腾讯文档导出习惯），故直接收敛成一个 URL，避免重复。
 *
 * ── 快照结构里的坑（本文件最容易改错的地方）─────────────────────────────
 *   · 文本只在一条 `{ty:'is', s}` 里，**段落用 `\r` 分隔**；富文本属性全在
 *     `mp`（mt: 'run' / 'paragraph' / 'story'）里，数量远少于段落数；
 *   · 段落样式 `mp.pr.paragraph.pStyle.val` 是样式 ID（如 `000002`），
 *     **必须**去 `ms` 的 `pr.styles.style[<id>].name` 里查名字才知道哪个是 heading 1；
 *   · ⚠️ 这些 `mp` 的 `bl` 恒等于全文长度（4506），**不能**按数组顺序或 `bl` 归位；
 *     唯一可靠的定位依据是 `bi`（字符偏移），且它指向**该段落内容的首字符**
 *     （不是段落分隔符 `\r`），所以要先切段落、再按区间反查段落下标。
 */

/** 腾讯文档普通文档的链接形态：https://docs.qq.com/doc/<ID>[?...] */
const QQDOC_RE = /^https?:\/\/docs\.qq\.com\/doc\/([A-Za-z0-9_-]+)/i;

/** 智能文档（/aio/）——明确不支持，给出可读的错误提示 */
const QQ_AIO_RE = /^https?:\/\/docs\.qq\.com\/(aio|sheet|slide|pdf|mind)\//i;

/** 是否是需要走「腾讯文档」通道的地址 */
export function isTencentDocUrl(url: string): boolean {
    return QQDOC_RE.test((url || '').trim());
}

/** 从腾讯文档链接里取文件 ID（取不到返回空串） */
export function tencentDocId(url: string): string {
    const m = QQDOC_RE.exec((url || '').trim());
    return m ? m[1] : '';
}

/**
 * 构造匿名读取用的接口地址。
 * `outformat=1&noEscape=1` 是让正文以「不转义」的形态返回（否则 `\r` 会被转义）。
 */
export function tencentDocApiUrl(id: string): string {
    return 'https://docs.qq.com/dop-api/opendoc?id=' + encodeURIComponent(id) + '&normal=1&outformat=1&noEscape=1';
}

// 腾讯文档正文里的字段标记（Word 二进制格式遗留）：\u0013 = 字段开始、\u0014 = 结果开始、\u0015 = 字段结束
const FIELD_BEGIN = String.fromCharCode(0x13);
const FIELD_SEP = String.fromCharCode(0x14);
const FIELD_END = String.fromCharCode(0x15);
// 其余不可打印控制符（保留 \t \n \r，它们是段落与缩进的语义）
// eslint-disable-next-line no-control-regex -- 就是要过滤控制符，这里是有意为之
const CTRL_RE = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]', 'g');
// 超链接字段：<0x13>HYPERLINK <url> …<0x14><显示文字><0x15>
const LINK_RE = new RegExp(FIELD_BEGIN + 'HYPERLINK\\s+(\\S+)[\\s\\S]*?' + FIELD_SEP + '([\\s\\S]*?)' + FIELD_END, 'g');
// 兜底：没闭合的超链接字段，至少把 URL 留下
const LINK_OPEN_RE = new RegExp(FIELD_BEGIN + 'HYPERLINK\\s+(\\S+)[\\s\\S]*?' + FIELD_SEP, 'g');

/** 把一句话里的控制符 / 超链接字段整理成普通文本 */
function decorate(text: string): string {
    return (
        text
            .replace(LINK_RE, (_m, url: string, label: string) => {
                const shown = (label || '').trim();
                // 显示文字等于 URL（或为空）时只留一份，否则写成「显示文字 URL」
                if (!shown || shown === url) return ' ' + url + ' ';
                return ' ' + shown + ' ' + url + ' ';
            })
            .replace(LINK_OPEN_RE, (_m, url: string) => ' ' + url + ' ')
            // 其余字段标记与不可打印控制符一律去掉
            .replace(CTRL_RE, '')
            .replace(/[ \t]{2,}/g, ' ')
            .trim()
    );
}

/**
 * 从样式表里取「样式 ID → 样式名」映射（heading 1 / Normal / …）
 */
function styleNames(mutations: Record<string, unknown>[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const m of mutations) {
        const pr = m.pr as { styles?: { style?: Record<string, { name?: unknown }> } } | undefined;
        const styles = pr && pr.styles && pr.styles.style;
        if (!styles) continue;
        for (const id of Object.keys(styles)) {
            const name = styles[id] && (styles[id].name as { val?: string } | string);
            map[id] = String(typeof name === 'string' ? name : (name && name.val) || '');
        }
    }
    return map;
}

// ── 列表（有序 / 无序）──────────────────────────────────────────────────────
// 段落带 `pr.paragraph.numPr = { ilvl:{val}, numId:{val} }` 才算列表项；
// `numId` 要在样式表的 `numbering.num[numId].abstractNumId.val` 里换成
// `numbering.abstractNum[abs].lvl[ilvl]`，那里才有 `numFmt`（decimal / bullet …）
// 与 `lvlText`（`%1.` 这种序号模板）。**缺任一步就认不出列表**。

/** 无序列表各级的显示字符。⚠️ 不能用文档里的 `lvlText` 原字符（是 Wingdings 私有区） */
const BULLETS = ['•', '◦', '▪'];

/** Wingdings / Symbol 私有区字符（U+F000-U+F0FF、U+A1）⇒ 中文环境会显示成豆腐块 */
function isSymbolFontChar(ch: string): boolean {
    const c = ch.charCodeAt(0);
    return (c >= 0xf000 && c <= 0xf0ff) || c === 0xa1;
}

/** 编号格式 → 一个可读的序号（只覆盖 Word 常用的几种；认不出就用十进制，绝不会返回空） */
function formatNumber(n: number, numFmt: string): string {
    const fmt = numFmt.replace('STNumberFormat_', '');
    const roman = (x: number): string => {
        const table: [number, string][] = [
            [1000, 'm'],
            [900, 'cm'],
            [500, 'd'],
            [400, 'cd'],
            [100, 'c'],
            [90, 'xc'],
            [50, 'l'],
            [40, 'xl'],
            [10, 'x'],
            [9, 'ix'],
            [5, 'v'],
            [4, 'iv'],
            [1, 'i'],
        ];
        let out = '';
        let rest = x;
        for (const [v, s] of table) {
            while (rest >= v) {
                out += s;
                rest -= v;
            }
        }
        return out;
    };
    const letters = (x: number): string => {
        // 1→a、26→z、27→aa（Word 的字母编号规则）
        let out = '';
        let rest = x;
        while (rest > 0) {
            rest -= 1;
            out = String.fromCharCode(97 + (rest % 26)) + out;
            rest = Math.floor(rest / 26);
        }
        return out;
    };
    switch (fmt) {
        case 'lowerLetter':
            return letters(n);
        case 'upperLetter':
            return letters(n).toUpperCase();
        case 'lowerRoman':
            return roman(n);
        case 'upperRoman':
            return roman(n).toUpperCase();
        case 'chineseCounting':
        case 'chineseCountingThousand':
        case 'ideographDigital':
            return chineseNumber(n);
        case 'decimalEnclosedCircle':
        case 'decimalEnclosedCircleChinese':
            return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
        case 'decimalZero':
            return n < 10 ? '0' + n : String(n);
        case 'none':
            return '';
        default:
            // decimal / decimalHalfWidth / decimalFullWidth / 未知格式
            return String(n);
    }
}

/** 1 → 一、12 → 十二、105 → 一百零五（列表序号只会用到小数目，但写成通用的） */
function chineseNumber(n: number): string {
    const digit = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    const unit = ['', '十', '百', '千'];
    if (n <= 0) return String(n);
    if (n < 11) return n === 10 ? '十' : digit[n];
    const s = String(n);
    let out = '';
    let zero = false;
    for (let i = 0; i < s.length; i++) {
        const d = Number(s[i]);
        const u = s.length - 1 - i;
        if (d === 0) {
            zero = true;
            continue;
        }
        if (zero && out) out += '零';
        zero = false;
        // 「十一」不写「一十一」
        out += (d === 1 && u === 1 && !out ? '' : digit[d]) + unit[u];
    }
    return out;
}

type ListDef = { kind: 'ordered' | 'bullet'; numFmt: string; lvlText: string };

/** 建「numId@ilvl → 列表定义」表（一次遍历样式表，供所有段落复用） */
function listDefs(mutations: Record<string, unknown>[]): Map<string, ListDef> {
    const out = new Map<string, ListDef>();
    for (const m of mutations) {
        const pr = m.pr as
            | {
                  numbering?: {
                      abstractNum?: Record<string, { lvl?: Record<string, unknown> }>;
                      num?: Record<string, { abstractNumId?: { val?: string } }>;
                  };
              }
            | undefined;
        const numbering = pr && pr.numbering;
        if (!numbering || !numbering.abstractNum || !numbering.num) continue;
        for (const numId of Object.keys(numbering.num)) {
            const absId = numbering.num[numId].abstractNumId?.val;
            const abs = absId ? numbering.abstractNum[absId] : undefined;
            if (!abs || !abs.lvl) continue;
            for (const lvKey of Object.keys(abs.lvl)) {
                const lv = abs.lvl[lvKey] as {
                    numFmt?: { val?: string };
                    lvlText?: { val?: string };
                };
                const numFmt = (lv && lv.numFmt && lv.numFmt.val) || 'STNumberFormat_decimal';
                const lvlText = (lv && lv.lvlText && lv.lvlText.val) || '';
                const isBullet = numFmt === 'STNumberFormat_bullet';
                out.set(numId + '@' + Number(lvKey), {
                    kind: isBullet ? 'bullet' : 'ordered',
                    numFmt,
                    lvlText,
                });
            }
        }
    }
    return out;
}

/**
 * 把一段的列表定义渲染成行首前缀。
 *
 * ⚠️ **序号只在「同一个 numId 的连续段落」里递增** —— 这是 Word 的语义：
 * 同一个 numId 表示「同一个列表」，被普通段落隔开就是两个新列表，各自从 start 重新数。
 * 故计数状态由调用方按「是否连续」维护，本函数只负责套模板。
 */
function renderListPrefix(def: ListDef, counters: Map<number, number>, ilvl: number): string {
    const indent = '    '.repeat(Math.max(0, Math.min(ilvl, 4)));
    if (def.kind === 'bullet') {
        // 文档里的 lvlText 是 Wingdings 字符（U+F06C 等），在中文环境会变豆腐块 ⇒ 换成通用圆点
        const mark = BULLETS[Math.min(ilvl, BULLETS.length - 1)];
        return indent + mark + ' ';
    }
    const n = counters.get(ilvl) || 1;
    const unit = formatNumber(n, def.numFmt);
    // `%1.` / `%2)` / `%1` —— 把 %N 换成对应级别的序号；模板里没有 %N 就自己拼一个
    const text = def.lvlText && def.lvlText.indexOf('%') >= 0 ? def.lvlText : '%' + (ilvl + 1) + '.';
    const prefix = text.replace(/%(\d+)/g, (_m, d: string) => {
        const lv = Number(d) - 1;
        return lv === ilvl ? unit : formatNumber(counters.get(lv) || 1, def.numFmt);
    });
    // 序号模板里的私有区字符（极少见）也换成普通字符，避免豆腐块
    const safe = Array.from(prefix)
        .filter((ch) => !isSymbolFontChar(ch))
        .join('');
    return indent + safe + ' ';
}

/**
 * 把 opendoc 接口的 JSON 解析成「标题 → 正文」键值对。
 *
 * 只认 heading 1 作为分割点；第一个 heading 1 之前的内容全部丢弃。
 * 解析不出任何一级标题时抛错（让调用方提示「文档格式不符合约定」，
 * 而不是静默变成一份空常用语）。
 */
export function parseTencentDocPhrases(payload: unknown): Record<string, string> {
    const cv = (payload as { clientVars?: Record<string, unknown> })?.clientVars;
    const ccv = cv?.collab_client_vars as { initialAttributedText?: Record<string, unknown> } | undefined;
    const iat = ccv && ccv.initialAttributedText;
    if (!iat) throw new Error('腾讯文档返回的数据里没有正文（可能已删除、或无阅读权限）');

    const parts = (iat.text as { commands?: { type: string; mutations?: Record<string, unknown>[] }[] }[]) || [];
    const mutations: Record<string, unknown>[] = [];
    for (const part of parts) {
        for (const cmd of part.commands || []) {
            if (cmd.type !== 'DocKeyframe') continue;
            for (const m of cmd.mutations || []) mutations.push(m);
        }
    }
    if (!mutations.length) throw new Error('腾讯文档正文为空');

    // 1) 全文（段落用 \r 分隔）
    let raw = '';
    for (const m of mutations) {
        if (m.ty === 'is' && typeof m.s === 'string') raw += m.s;
    }

    // 2) 段落 + 每段起始偏移（用于把 bi 偏移换算成段落下标）
    const paras: { start: number; text: string }[] = [];
    let off = 0;
    for (const seg of raw.split('\r')) {
        paras.push({ start: off, text: seg });
        off += seg.length + 1;
    }

    // 3) 段落样式 + 列表属性：mp(paragraph).pStyle / numPr，用 bi 定位到所在段落
    const names = styleNames(mutations);
    const defs = listDefs(mutations);
    const paraStyle = new Map<number, string>();
    const paraList = new Map<number, { numId: string; ilvl: number }>();
    for (const m of mutations) {
        if (m.ty !== 'mp') continue;
        const pr = m.pr as
            | {
                  paragraph?: {
                      pStyle?: { val?: string };
                      numPr?: { numId?: { val?: string }; ilvl?: { val?: number | string } };
                  };
              }
            | undefined;
        const para = pr && pr.paragraph;
        const pos = typeof m.bi === 'number' ? m.bi : -1;
        if (!para || pos < 0) continue;
        // bi 指向段落内容首字符 ⇒ 落在 [start, start+len] 区间内
        let idx = -1;
        for (let i = 0; i < paras.length; i++) {
            if (pos >= paras[i].start && pos <= paras[i].start + paras[i].text.length) {
                idx = i;
                break;
            }
        }
        if (idx < 0) continue;
        const styleId = para.pStyle && para.pStyle.val;
        if (styleId) paraStyle.set(idx, styleId);
        const numId = para.numPr && para.numPr.numId && para.numPr.numId.val;
        if (numId) {
            const lvl = para.numPr && para.numPr.ilvl ? Number(para.numPr.ilvl.val) : 0;
            paraList.set(idx, { numId: String(numId), ilvl: Number.isFinite(lvl) ? lvl : 0 });
        }
    }

    // 4) 找出所有 heading 1 段落
    const h1: number[] = [];
    paraStyle.forEach((styleId, idx) => {
        if (names[styleId] === 'heading 1') h1.push(idx);
    });
    h1.sort((a, b) => a - b);
    if (!h1.length) {
        throw new Error('文档里没有找到「一级标题」，请按约定把每条常用语的名称设为一级标题');
    }

    // 5) 按一级标题切块（第一个标题之前的内容直接丢弃）
    const out: Record<string, string> = {};
    h1.forEach((startIdx, n) => {
        const endIdx = n + 1 < h1.length ? h1[n + 1] : paras.length;
        const title = decorate(paras[startIdx].text);
        if (!title) return;
        const lines: string[] = [];
        // 列表计数器：每个 numId 一份「级别 → 当前序号」，**只在连续段落里递增**
        const counters = new Map<string, Map<number, number>>();
        let openKey = '';
        for (let i = startIdx + 1; i < endIdx; i++) {
            const line = decorate(paras[i].text);
            const listItem = paraList.get(i);
            if (!listItem) {
                // 普通段落：打断列表连续性
                openKey = '';
                if (line) lines.push(line);
                continue;
            }
            const def = defs.get(listItem.numId + '@' + listItem.ilvl);
            if (!def) {
                // 有 numPr 但样式表里查不到定义（少见）⇒ 退化成普通段落，绝不丢内容
                openKey = '';
                if (line) lines.push(line);
                continue;
            }
            if (openKey !== listItem.numId) {
                // 换了一个列表（或列表被打断后重新开始）⇒ 该 numId 从 1 重新数
                counters.delete(listItem.numId);
                openKey = listItem.numId;
            }
            let byLvl = counters.get(listItem.numId);
            if (!byLvl) {
                byLvl = new Map<number, number>();
                counters.set(listItem.numId, byLvl);
            }
            const next = (byLvl.get(listItem.ilvl) || 0) + 1;
            byLvl.set(listItem.ilvl, next);
            // 更深的层级重新计数（与 Word 一致）
            for (const lv of Array.from(byLvl.keys())) {
                if (lv > listItem.ilvl) byLvl.delete(lv);
            }
            if (!line) continue;
            lines.push(renderListPrefix(def, byLvl, listItem.ilvl) + line);
        }
        // 有同名标题时后者覆盖前者——与 YAML 里重复键的行为一致
        out[title] = lines.join('\n');
    });

    if (!Object.keys(out).length) throw new Error('一级标题下面的内容都是空的');
    return out;
}

/** 供加载链路调用的统一入口：URL → 键值对（非腾讯文档链接返回 null，交回 YAML 分支） */
export function phrasesFromTencentDoc(url: string, payload: unknown): Record<string, string> | null {
    if (!isTencentDocUrl(url)) {
        if (QQ_AIO_RE.test((url || '').trim())) {
            throw new Error('暂不支持智能文档（/aio/），请改用「文档」类型（链接形如 docs.qq.com/doc/…）');
        }
        return null;
    }
    return parseTencentDocPhrases(payload);
}
