import { h, type VNode } from 'vue';

/**
 * 聊天气泡的极简 Markdown 渲染（v26.10.18-v5，Vue 版）。
 *
 * ── 为什么手写而不是装 `marked` / `markdown-it` ─────────────────────────────
 * ① 这两者都输出 **HTML 字符串** ⇒ 要配 `v-html`，「模型/手机发来的原始 HTML」就得靠
 *    自己的转义或消毒库兜底；本实现直接产出 **VNode**，`<script>` / `<img onerror>` 这类
 *    输入永远只是文本节点，从机制上没有注入面（等价于 React 版「不启用 rehype-raw」）。
 * ② 产物默认不压缩（用户要求可读 diff），一个渲染库会往产物里塞十几万字符的不可读代码。
 * ③ 聊天只需要 GFM 的常用子集：标题 / 段落 / 换行 / 粗斜删 / 行内码 / 围栏码 / 列表 /
 *    引用 / 表格 / 链接 / 图片 / 分隔线。超出这个范围的内容在聊天里本来就没人写。
 *
 * ⚠️ 与 React 版 `MarkdownBody.tsx` 的等价关系（改这里请同步那边，或至少保持观感一致）：
 *    · `remark-breaks` 的行为 = 单个换行渲染成 `<br>` ⇒ 这里段落内按 `\n` 切 `<br>`；
 *    · 链接一律新窗口打开、`rel="noreferrer"`，颜色跟随所在气泡的调色板（我方黑 / 对方绿）；
 *    · 代码块只给底色 + 横向滚动，不做语法高亮（React 版实测高亮库要多 429KiB）。
 */

interface MdPalette {
    codeBg: string;
    link: string;
    line: string;
    quote: string;
    text: string;
    strong: string;
    /** 表格表头文字色 */
    head: string;
}

/** 对方气泡（#2F2F2F 实心灰）：浅灰底 + 微信绿链接 */
export const MD_PEER: MdPalette = {
    codeBg: 'rgba(255,255,255,0.08)',
    link: '#5FD08A',
    line: 'rgba(255,255,255,0.16)',
    quote: 'rgba(255,255,255,0.3)',
    text: 'rgba(255,255,255,0.9)',
    strong: '#ffffff',
    head: 'rgba(255,255,255,0.9)',
};

/** 我方气泡（微信绿实心）：v26.10.18-v9 起按用户要求一律黑字（半透明黑做底纹，避免「绿字压绿底」） */
export const MD_MINE: MdPalette = {
    codeBg: 'rgba(0,0,0,0.12)',
    link: '#000000',
    line: 'rgba(0,0,0,0.25)',
    quote: 'rgba(0,0,0,0.45)',
    text: '#000000',
    strong: '#000000',
    head: '#000000',
};

const SAFE_URL = /^(https?:\/\/|mailto:|#|\/)/i;

function isSafeUrl(url: string): boolean {
    return SAFE_URL.test(url.trim());
}

/* ============================================================ 行内 */

/**
 * 行内语法（顺序即优先级，单趟扫描）：
 * 行内码 → 粗体 → 斜体 → 删除线 → 图片 → 链接 → 裸链接。
 * 粗体/斜体/删除线内部**递归**解析（`**加粗里的 `代码`**` 也能正确渲染）。
 */
/**
 * ⚠️ 必须是**工厂**：每次调用拿到独立的正则实例。
 * 曾经写成模块级 `/g` 正则 + 递归，递归体内 `lastIndex = 0` 会把外层循环的游标清零
 * ⇒ 外层反复命中同一个 token ⇒ 死循环卡死整个渲染进程
 * （现象：puppeteer 报 `Runtime.callFunctionOn timed out`，页面完全无响应）。
 */
const inlineRe = () =>
    /(`+[^`]*?`+)|(\*\*[^*]+?\*\*)|(__[^_]+?__)|(\*[^*\n]+?\*)|(_[^_\n]+?_)|(~~[^~]+?~~)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]*\]\([^)\s]+\))|(https?:\/\/[^\s<>()）]+)/g;

function renderInline(text: string, p: MdPalette, keyBase: string): Array<VNode | string> {
    const re = inlineRe();
    const out: Array<VNode | string> = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let n = 0;
    const push = (node: VNode | string) => {
        out.push(node);
        n++;
    };
    while ((m = re.exec(text))) {
        if (m.index > last) push(text.slice(last, m.index));
        const token = m[0];
        const key = keyBase + '-' + n;
        if (token.startsWith('`')) {
            const ticks = /^`+/.exec(token)![0].length;
            const inner = token.slice(ticks, token.length - ticks);
            push(
                h(
                    'code',
                    {
                        key,
                        style: {
                            padding: '1px 5px',
                            borderRadius: '4px',
                            background: p.codeBg,
                            fontSize: '12px',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                            wordBreak: 'break-all',
                        },
                    },
                    inner
                )
            );
        } else if (token.startsWith('**') || token.startsWith('__')) {
            push(
                h(
                    'strong',
                    { key, style: { fontWeight: 600, color: p.strong } },
                    renderInline(token.slice(2, -2), p, key)
                )
            );
        } else if (token.startsWith('~~')) {
            push(h('del', { key, style: { opacity: 0.7 } }, renderInline(token.slice(2, -2), p, key)));
        } else if (token.startsWith('*') || token.startsWith('_')) {
            push(h('em', { key }, renderInline(token.slice(1, -1), p, key)));
        } else {
            // 图片 / 链接 / 裸链接
            const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
            const link = /^\[([^\]]*)\]\(([^)\s]+)\)$/.exec(token);
            if (img) {
                const src = img[2];
                push(
                    isSafeUrl(src)
                        ? h('img', {
                              key,
                              src,
                              alt: img[1],
                              style: { maxWidth: '100%', borderRadius: '6px', display: 'block', margin: '2px 0' },
                          })
                        : img[0]
                );
            } else if (link) {
                const href = link[2];
                push(
                    isSafeUrl(href)
                        ? h(
                              'a',
                              {
                                  key,
                                  href,
                                  target: '_blank',
                                  rel: 'noreferrer',
                                  style: {
                                      color: p.link,
                                      textDecoration: 'underline',
                                      wordBreak: 'break-all',
                                  },
                              },
                              renderInline(link[1] || href, p, key)
                          )
                        : token
                );
            } else {
                push(
                    h(
                        'a',
                        {
                            key,
                            href: token,
                            target: '_blank',
                            rel: 'noreferrer',
                            style: { color: p.link, textDecoration: 'underline', wordBreak: 'break-all' },
                        },
                        token
                    )
                );
            }
        }
        last = m.index + token.length;
    }
    if (last < text.length) push(text.slice(last));
    return out;
}

/** 段落内的软换行 → `<br>`（等价 remark-breaks） */
function renderParagraph(lines: string[], p: MdPalette, key: string): VNode {
    const children: Array<VNode | string> = [];
    lines.forEach((line, i) => {
        if (i > 0) children.push(h('br', { key: key + '-br' + i }));
        children.push(...renderInline(line, p, key + '-' + i));
    });
    return h('p', { key, style: { margin: '0' } }, children);
}

/* ============================================================ 块级 */

const RE_FENCE = /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/;
const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const RE_HR = /^\s{0,3}((?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const RE_UL = /^\s{0,3}[-*+]\s+(.*)$/;
const RE_OL = /^\s{0,3}\d+[.)]\s+(.*)$/;
const RE_QUOTE = /^\s{0,3}>\s?(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
}

function renderCode(code: string[], lang: string, p: MdPalette, key: string): VNode {
    return h(
        'pre',
        {
            key,
            'data-lang': lang || undefined,
            style: {
                margin: '0',
                padding: '8px 10px',
                borderRadius: '6px',
                background: p.codeBg,
                fontSize: '12px',
                lineHeight: '1.5',
                overflowX: 'auto',
                minWidth: '0',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            },
        },
        [h('code', code.join('\n'))]
    );
}

/**
 * 表格：结构走 `.md-table`（见 style.css 与 web/src/style.css 的同名段落），
 * 颜色走**气泡调色板** —— 表格要落在「我方绿气泡」或「对方灰气泡」里，
 * 边框/表头底色必须跟着所在气泡走，daisyUI 的 `table` 组件只认
 * `--color-base-*`（绿底上会糊成一片），所以调色板值以 CSS 变量
 * `--md-line / --md-code-bg / --md-head` 写在 <table> 上，单元格只留类名。
 * （v26.10.20-v21：#4 审计项 —— 去掉逐单元格内联样式。）
 */
function renderTable(rows: string[][], p: MdPalette, key: string): VNode {
    const [head, ...body] = rows;
    const cell = (text: string, tag: 'th' | 'td', k: string) =>
        h(tag, { key: k }, renderInline(text, p, k));
    const vars = {
        '--md-line': p.line,
        '--md-code-bg': p.codeBg,
        '--md-head': p.head,
    } as Record<string, string>;
    return h('div', { key, class: 'min-w-0 overflow-x-auto' }, [
        h('table', { class: 'md-table', style: vars }, [
            h('thead', [
                h(
                    'tr',
                    head.map((c, i) => cell(c, 'th', key + '-h' + i))
                ),
            ]),
            h(
                'tbody',
                body.map((row, ri) =>
                    h(
                        'tr',
                        { key: key + '-r' + ri },
                        row.map((c, ci) => cell(c, 'td', key + '-r' + ri + 'c' + ci))
                    )
                )
            ),
        ]),
    ]);
}

/**
 * 渲染整段 Markdown。
 * @param content 原文
 * @param palette `MD_MINE`（我方绿气泡）/ `MD_PEER`（对方灰气泡）
 */
export function renderMarkdown(content: string, palette: MdPalette): VNode[] {
    const p = palette;
    const lines = (content || '').replace(/\r\n?/g, '\n').split('\n');
    const out: VNode[] = [];
    let i = 0;
    let seq = 0;

    while (i < lines.length) {
        const line = lines[i];
        const key = 'md' + seq++;

        // 空行
        if (!line.trim()) {
            i++;
            continue;
        }

        // 围栏代码
        const fence = RE_FENCE.exec(line);
        if (fence) {
            const marker = fence[1][0];
            const lang = fence[2] || '';
            const buf: string[] = [];
            i++;
            while (i < lines.length && !new RegExp('^\\s*' + marker + '{3,}\\s*$').test(lines[i])) {
                buf.push(lines[i]);
                i++;
            }
            i++; // 跳过结束围栏
            out.push(renderCode(buf, lang, p, key));
            continue;
        }

        // 标题
        const head = RE_HEADING.exec(line);
        if (head) {
            const level = head[1].length;
            out.push(
                h(
                    'h' + level,
                    {
                        key,
                        style: {
                            margin: '0',
                            fontSize: level === 1 ? '16px' : level === 2 ? '15px' : level === 3 ? '14px' : '13px',
                            fontWeight: 600,
                            lineHeight: '1.5',
                        },
                    },
                    renderInline(head[2], p, key)
                )
            );
            i++;
            continue;
        }

        // 分隔线
        if (RE_HR.test(line)) {
            out.push(h('hr', { key, style: { margin: '2px 0', border: '0', borderTop: '1px solid ' + p.line } }));
            i++;
            continue;
        }

        // 引用（连续 > 行合并后再递归解析）
        if (RE_QUOTE.test(line)) {
            const buf: string[] = [];
            while (i < lines.length && RE_QUOTE.test(lines[i])) {
                buf.push(RE_QUOTE.exec(lines[i])![1]);
                i++;
            }
            out.push(
                h(
                    'blockquote',
                    {
                        key,
                        style: {
                            margin: '0',
                            paddingLeft: '10px',
                            borderLeft: '3px solid ' + p.quote,
                            color: p.text,
                            opacity: 0.9,
                        },
                    },
                    renderMarkdown(buf.join('\n'), p)
                )
            );
            continue;
        }

        // 表格：本行含 | 且下一行是分隔行
        if (line.includes('|') && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) {
            const rows: string[][] = [splitRow(line)];
            i += 2;
            while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
                rows.push(splitRow(lines[i]));
                i++;
            }
            out.push(renderTable(rows, p, key));
            continue;
        }

        // 无序 / 有序列表
        const ul = RE_UL.exec(line);
        const ol = ul ? null : RE_OL.exec(line);
        if (ul || ol) {
            const ordered = !!ol;
            const items: string[] = [];
            while (i < lines.length) {
                const m2 = (ordered ? RE_OL : RE_UL).exec(lines[i]);
                if (!m2) break;
                items.push(m2[1]);
                i++;
            }
            out.push(
                h(
                    ordered ? 'ol' : 'ul',
                    { key, style: { margin: '0', paddingLeft: '20px' } },
                    items.map((t, idx) =>
                        h(
                            'li',
                            { key: key + '-i' + idx, style: { margin: '2px 0' } },
                            renderInline(t, p, key + '-i' + idx)
                        )
                    )
                )
            );
            continue;
        }

        // 段落：吃到空行或下一个块级标记为止（软换行保留）
        const para: string[] = [line];
        i++;
        while (i < lines.length) {
            const next = lines[i];
            if (
                !next.trim() ||
                RE_FENCE.test(next) ||
                RE_HEADING.test(next) ||
                RE_HR.test(next) ||
                RE_QUOTE.test(next) ||
                RE_UL.test(next) ||
                RE_OL.test(next)
            ) {
                break;
            }
            para.push(next);
            i++;
        }
        out.push(renderParagraph(para, p, key));
    }

    return out;
}
