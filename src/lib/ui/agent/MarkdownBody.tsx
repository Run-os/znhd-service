/**
 * Agent 消息的 Markdown 渲染（v26.10.10-v14 起，对话页签两侧消息都走它）。
 *
 * 为什么是 react-markdown + remark-gfm（选型实测数据见 AGENT.md）：
 *   · **默认不渲染原始 HTML** —— 没有 `rehype-raw`，模型输出里的 `<img onerror=…>` /`<script>`
 *     永远进不了 DOM，这是「不额外引消毒库」的前提。**别顺手加 `rehype-raw`**：
 *     那是把模型输出当 HTML 执行，而且是在税务页里。
 *   · 每个元素都映射成**内联样式**的组件。宿主页的全局规则（`ul{list-style:none}`、
 *     `a{color:…}`、`img{max-width:100%}`、`h1{font-size:2em}` 之类）按元素名匹配，
 *     内联样式优先，污染不进来；`uiReset` 只兜了 text-align/字体/行高，管不到这些。
 *   · 不引 rehype-highlight / highlight.js：实测要再加 429 KiB 原始体积，代码块只给底色 + 横向滚动。
 *
 * ⚠️ `remark-breaks` 让**单个换行**也渲染成 `<br>`：聊天输入框里 Shift+Enter 换的行必须保住
 * （纯 Markdown 规范会把它并成一行），这也是 ChatGPT/NextChat 一类界面的默认行为。
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { theme } from 'antd';

interface MarkdownBodyProps {
    content: string;
}

export default function MarkdownBody({ content }: MarkdownBodyProps) {
    const { token } = theme.useToken();
    const codeBg = token.colorFillTertiary;

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                fontSize: 13,
                lineHeight: 1.6,
                minWidth: 0,
                wordBreak: 'break-word',
            }}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                    p: ({ children }) => <p style={{ margin: 0 }}>{children}</p>,
                    h1: ({ children }) => <h1 style={{ margin: 0, fontSize: 16 }}>{children}</h1>,
                    h2: ({ children }) => <h2 style={{ margin: 0, fontSize: 15 }}>{children}</h2>,
                    h3: ({ children }) => <h3 style={{ margin: 0, fontSize: 14 }}>{children}</h3>,
                    h4: ({ children }) => <h4 style={{ margin: 0, fontSize: 13 }}>{children}</h4>,
                    h5: ({ children }) => <h5 style={{ margin: 0, fontSize: 13 }}>{children}</h5>,
                    h6: ({ children }) => <h6 style={{ margin: 0, fontSize: 13 }}>{children}</h6>,
                    ul: ({ children }) => <ul style={{ margin: 0, paddingLeft: 20 }}>{children}</ul>,
                    ol: ({ children }) => <ol style={{ margin: 0, paddingLeft: 20 }}>{children}</ol>,
                    li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
                    a: ({ children, href }) => (
                        <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: token.colorPrimary, wordBreak: 'break-all' }}>
                            {children}
                        </a>
                    ),
                    // 块级代码：`language-xxx` 一定有；无语言围栏（``` 后面没写名字）靠换行兜
                    code: ({ children, className }) => {
                        const isBlock = /language-/.test(className || '') || String(children).includes('\n');
                        if (isBlock) {
                            return <code className={className}>{children}</code>;
                        }
                        return (
                            <code
                                style={{
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                    background: codeBg,
                                    fontSize: 12,
                                    wordBreak: 'break-all',
                                }}>
                                {children}
                            </code>
                        );
                    },
                    pre: ({ children }) => (
                        <pre
                            style={{
                                margin: 0,
                                padding: '8px 10px',
                                borderRadius: 6,
                                background: codeBg,
                                fontSize: 12,
                                lineHeight: 1.5,
                                overflowX: 'auto',
                                minWidth: 0,
                            }}>
                            {children}
                        </pre>
                    ),
                    blockquote: ({ children }) => (
                        <blockquote
                            style={{
                                margin: 0,
                                paddingLeft: 10,
                                borderLeft: '3px solid ' + token.colorBorder,
                                color: token.colorTextSecondary,
                            }}>
                            {children}
                        </blockquote>
                    ),
                    // 窄弹窗里表格必须能横向滚，否则会把气泡撑破
                    table: ({ children }) => (
                        <div style={{ overflowX: 'auto', minWidth: 0 }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>{children}</table>
                        </div>
                    ),
                    th: ({ children }) => (
                        <th
                            style={{
                                padding: '3px 8px',
                                border: '1px solid ' + token.colorBorderSecondary,
                                background: codeBg,
                                textAlign: 'left',
                                whiteSpace: 'nowrap',
                            }}>
                            {children}
                        </th>
                    ),
                    td: ({ children }) => (
                        <td
                            style={{
                                padding: '3px 8px',
                                border: '1px solid ' + token.colorBorderSecondary,
                                textAlign: 'left',
                            }}>
                            {children}
                        </td>
                    ),
                    hr: () => (
                        <hr
                            style={{
                                margin: '2px 0',
                                border: 0,
                                borderTop: '1px solid ' + token.colorBorderSecondary,
                            }}
                        />
                    ),
                    img: ({ src, alt }) => (
                        <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: 6, display: 'block' }} />
                    ),
                    // GFM 任务列表的复选框：antd 的全局 input 规则会把它顶歪，这里钉回来
                    input: ({ checked, type }) => (
                        <input
                            type={type}
                            checked={checked}
                            readOnly
                            style={{ marginRight: 4, verticalAlign: 'middle' }}
                        />
                    ),
                    strong: ({ children }) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                }}>
                {content}
            </ReactMarkdown>
        </div>
    );
}
