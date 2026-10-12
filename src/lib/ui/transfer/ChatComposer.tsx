/**
 * 聊天输入区（v26.10.12-v3）：设备会话与 Agent 对话**共用同一个输入框**。
 *
 * ── 用户给的规格 ─────────────────────────────────────────────────────────────
 *   ① 固定吸附在聊天区底部，不随消息滚动；
 *   ② 多行输入框随内容自动增高，到最大高度后**框内**出现滚动条；
 *   ③ 左下角：表情 / 图片上传 / 附件；右下角：发送按钮；
 *   ④ Enter 发送、Shift+Enter 换行；外层有边框，hover / focus 时高亮。
 * ② 与 ④ 的「高亮画在哪」有两处实测结论不能动，写在这里当路标：
 *
 * ⚠️ **聚焦高亮画在外层容器，不画在 textarea 上**（v26.10.10-v13 的结论，本次沿用）：
 * antd v6 的 `variant="borderless"` 会在 `:focus-visible` 时给文本域**自己**画一层
 * `outline`（`node_modules/antd/es/input/style/variants.js` 的 `genBorderlessFocusVisibleStyle`），
 * 看起来就是「输入框里又套了一个蓝框」。所以这里内联关掉 outline / boxShadow
 * （冒烟断言 `agentInputNoRingOk` 守着），聚焦反馈改由外层容器的 border + boxShadow 承担。
 *
 * ⚠️ **必须同时钉住 `minRows: 2` 与 `lineHeight: '20px'`**（v26.10.10-v15）：
 * rc-textarea 挂载时按 `minRows` 算高度（1 行 ≈ 20px），输入过内容之后改按
 * 「行数 × 行高 + padding」重算（1 行文本实测 41px）；而挂载那一刻 antd 的 CSS 还没注入完、
 * 行高按 20px 算、输入后才是 20.5px ⇒「打一个字再全删掉」会让输入框永久停在更高的位置。
 * 冒烟 `agentInputHeightOk` 按严格整数相等守着，别只改其中一个。
 */

import { useRef, useState, type ReactNode } from 'react';
import { Button, Input, Popover, Tooltip, theme } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { SendIcon, SmileIcon, StopIcon } from '@/lib/ui/icons';
import { EMOJI_GROUPS } from '@/lib/ui/transfer/chatEmojis';

/** 左下角的附加功能按钮（表情独立在组件内，这个数组是它之后的按钮） */
export interface ComposerAction {
    key: string;
    /** 无障碍名（按钮只有图标）：读屏与冒烟测试都靠它 */
    label: string;
    icon: ReactNode;
    /** hover 提示，默认取 label */
    tooltip?: string;
    onClick?: () => void;
    /** 置灰（后端还没接的能力，见两个调用处的说明） */
    disabled?: boolean;
}

export interface ChatComposerProps {
    value: string;
    onChange: (value: string) => void;
    /** 发送（按钮点击或 Enter） */
    onSend: () => void;
    /** 整个输入区不可用（Agent 能力缺失 / 当前无在线手机） */
    disabled?: boolean;
    /** 正在流式回答：发送按钮原位变成中止按钮 */
    streaming?: boolean;
    onStop?: () => void;
    placeholder?: string;
    /** 发送按钮是否可点，默认「有非空白内容」 */
    canSend?: boolean;
    /** 表情之后的附加功能按钮 */
    actions?: ComposerAction[];
    /** 发送按钮左侧的附加控件（Agent 的模型下拉） */
    rightExtras?: ReactNode;
    /** 输入框上方的提示行（无在线手机 / 待发图片计数等） */
    notice?: ReactNode;
}

export default function ChatComposer({
    value,
    onChange,
    onSend,
    disabled,
    streaming,
    onStop,
    placeholder,
    canSend,
    actions,
    rightExtras,
    notice,
}: ChatComposerProps) {
    const { token } = theme.useToken();
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [emojiOpen, setEmojiOpen] = useState(false);
    const inputRef = useRef<TextAreaRef | null>(null);

    const highlighted = focused || hovered;
    const sendDisabled = !!disabled || streaming || !(canSend === undefined ? value.trim() : canSend);

    /** 把字符插到光标处（不是追加到末尾：用户可能改到中间才想起来加个表情） */
    const insertEmoji = (ch: string) => {
        // antd 的 TextAreaRef.nativeElement 声明为 HTMLElement，取光标位置要自己收窄成 textarea
        const el = inputRef.current?.nativeElement as HTMLTextAreaElement | undefined;
        const start = el && el.selectionStart !== null ? el.selectionStart : value.length;
        const end = el && el.selectionEnd !== null ? el.selectionEnd : value.length;
        onChange(value.slice(0, start) + ch + value.slice(end));
        const caret = start + ch.length;
        // 等 React 把这轮 value 提交完再摆光标；点表情按钮后焦点会跑到按钮上，顺手抢回来
        window.requestAnimationFrame(() => {
            const node = inputRef.current?.nativeElement as HTMLTextAreaElement | undefined;
            if (!node) return;
            node.focus();
            node.setSelectionRange(caret, caret);
        });
    };

    const emojiPanel = (
        <div style={{ width: 236 }}>
            {EMOJI_GROUPS.map((group) => (
                <div key={group.title} style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 11, color: token.colorTextTertiary, marginBottom: 2 }}>{group.title}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, minmax(0, 1fr))', gap: 2 }}>
                        {group.items.map((ch) => (
                            <Button
                                key={ch}
                                type="text"
                                size="small"
                                aria-label={'表情 ' + ch}
                                onClick={() => insertEmoji(ch)}
                                style={{ height: 24, minWidth: 0, padding: 0, fontSize: 15, lineHeight: '24px' }}>
                                {ch}
                            </Button>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );

    const iconButton = (
        label: string,
        tooltip: string,
        icon: ReactNode,
        onClick?: () => void,
        isDisabled?: boolean
    ) => (
        <Tooltip key={label} title={tooltip}>
            {/* span 包一层：disabled 的 antd Button 不派发 mouseenter，Tooltip 会失效 */}
            <span style={{ display: 'inline-flex' }}>
                <Button
                    type="text"
                    size="small"
                    aria-label={label}
                    icon={icon}
                    disabled={isDisabled}
                    onClick={onClick}
                    style={{ width: 26, height: 26, minWidth: 26, padding: 0, color: token.colorTextSecondary }}
                />
            </span>
        </Tooltip>
    );

    return (
        <div
            style={{
                flex: '0 0 auto',
                padding: 10,
                borderTop: '1px solid ' + token.colorBorderSecondary,
            }}>
            {notice}
            <div
                className="znhd-chat-composer"
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    padding: '6px 8px 4px',
                    border: '1px solid ' + (highlighted ? token.colorPrimaryBorder : token.colorBorderSecondary),
                    borderRadius: 10,
                    background: token.colorBgContainer,
                    // 聚焦时再补一圈淡主色光晕（聚焦反馈只在这里，textarea 自己是干净的）
                    boxShadow: focused ? '0 0 0 2px ' + token.colorPrimaryBg : 'none',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                }}>
                <Input.TextArea
                    ref={inputRef}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    onPressEnter={(event) => {
                        if (event.shiftKey) return;
                        event.preventDefault();
                        onSend();
                    }}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    placeholder={placeholder}
                    // 行数上限 6 行：超过后 rc-textarea 交给原生滚动条（框内滚动），
                    // 输入区高度因此有上限，不会把消息区挤没
                    autoSize={{ minRows: 2, maxRows: 6 }}
                    disabled={disabled}
                    variant="borderless"
                    style={{
                        resize: 'none',
                        padding: 0,
                        fontSize: 13,
                        lineHeight: '20px',
                        outline: 'none',
                        boxShadow: 'none',
                    }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
                    <Popover
                        trigger="click"
                        placement="topLeft"
                        open={emojiOpen}
                        onOpenChange={setEmojiOpen}
                        content={emojiPanel}>
                        {iconButton(
                            '表情',
                            '插入符号 / 表情',
                            <SmileIcon size={15} />,
                            () => setEmojiOpen((v) => !v),
                            disabled
                        )}
                    </Popover>
                    {(actions || []).map((action) =>
                        iconButton(
                            action.label,
                            action.tooltip || action.label,
                            action.icon,
                            action.onClick,
                            action.disabled || disabled
                        )
                    )}
                    <span style={{ flex: '1 1 auto', minWidth: 0 }} />
                    {rightExtras}
                    {streaming ? (
                        <Tooltip title="中止本轮回答">
                            <Button
                                shape="circle"
                                size="small"
                                danger
                                aria-label="中止"
                                icon={<StopIcon size={12} />}
                                onClick={() => onStop && onStop()}
                            />
                        </Tooltip>
                    ) : (
                        <Tooltip title="发送（Enter）">
                            <Button
                                shape="circle"
                                size="small"
                                type="primary"
                                aria-label="发送"
                                icon={<SendIcon size={14} />}
                                onClick={onSend}
                                disabled={sendDisabled}
                            />
                        </Tooltip>
                    )}
                </div>
            </div>
        </div>
    );
}
