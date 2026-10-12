/**
 * 聊天输入区（v26.10.12-v3；v26.10.12-v4 改**微信桌面版结构**）：设备会话与 Agent 对话
 * **共用同一个输入面板**。
 *
 * ── 微信原版结构（对齐截图）─────────────────────────────────────────────────
 *   ┌────────────────────────────────────────┐
 *   │ 😀 🖼 📎                ← 工具栏图标行（上） │
 *   │ 多行文本输入框（自动增高，超限框内滚动）      │
 *   │                        [发送] ← 右下角 │
 *   └────────────────────────────────────────┘
 * 整个面板是一块 #262626 的实心底（比聊天区略浅，靠上边框分开），**不再有 v3 那个
 * 带边框圆角的内层盒子** —— 微信的输入区就是一整块面板。
 *
 * ⚠️ 两条实测结论仍然成立，别动：
 * · **textarea 自己禁 outline / boxShadow**（v26.10.10-v13）：antd `variant="borderless"`
 *   会在 `:focus-visible` 时给文本域自己画 outline（「框里套框」）。聚焦反馈交给光标，
 *   不再画外圈（微信输入区也没有聚焦光圈）。
 * · **必须同时钉住 `minRows` 与 `lineHeight: '20px'`**（v26.10.10-v15）：rc-textarea
 *   挂载时按 minRows 算高、输入后按「行数 × 行高 + padding」重算，行高不一致会出现
 *   「打一个字再删空，输入框永久变高」。冒烟 `agentInputHeightOk` 严格相等守着。
 *
 * v26.10.13-v3：表情面板由「BMP 字符符号」换成**在线图片表情包**（`EmojiPackPanel`，
 * 数据层见 `@/lib/transfer/emojiPack`）。点一张表情不再往输入框插字符，而是把图片交回
 * 调用方（`onPickEmojiImage`）——设备会话据此**直接发出去**（v26.10.13-v4 起）；
 * **不传这个回调的宿主（Agent 对话）表情按钮自动禁用**（那条通道只收文本）。
 */

import { useState, type ReactNode } from 'react';
import { Button, Input, Popover, Tooltip } from 'antd';
import { SendIcon, SmileIcon, StopIcon } from '@/lib/ui/icons';
import EmojiPackPanel, { type PickedEmoji } from '@/lib/ui/transfer/EmojiPackPanel';
import { WECHAT } from '@/lib/ui/transfer/wechatTheme';

/** 工具栏行的附加功能按钮（表情独立在组件内，这个数组是它之后的按钮） */
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
    /** 输入面板上方的提示行（无在线手机 / 待发图片计数等） */
    notice?: ReactNode;
    /**
     * 点选一张**在线表情**（v26.10.13-v3）。设备会话收到后**直接发送到手机**（v26.10.13-v4）；
     * **不传则表情按钮禁用**（Agent 对话只收文本，与旁边的「图片上传 / 附件」同为灰态）。
     */
    onPickEmojiImage?: (emoji: PickedEmoji) => void;
    /** 表情按钮禁用时的 hover 说明（不传 onPickEmojiImage 时用） */
    emojiDisabledReason?: string;
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
    onPickEmojiImage,
    emojiDisabledReason,
}: ChatComposerProps) {
    const [emojiOpen, setEmojiOpen] = useState(false);

    const sendDisabled = !!disabled || streaming || !(canSend === undefined ? value.trim() : canSend);

    /** 表情面板只在有回调时可用（v26.10.13-v3：换成在线图片表情包，见 EmojiPackPanel） */
    const emojiEnabled = !!onPickEmojiImage;

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
                    style={{ width: 28, height: 28, minWidth: 28, padding: 0, color: 'rgba(255,255,255,0.6)' }}
                />
            </span>
        </Tooltip>
    );

    return (
        <div
            // 类名是冒烟夹具识别「共用输入面板」的钩子（composerFacts / composerBoxOf），勿改
            className="znhd-chat-composer"
            style={{
                flex: '0 0 auto',
                display: 'flex',
                flexDirection: 'column',
                padding: '6px 12px 8px',
                background: WECHAT.input,
                borderTop: '1px solid rgba(0,0,0,0.4)',
            }}>
            {notice}
            {/* 工具栏图标行（微信把这一行放在输入框上面） */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: 2 }}>
                <Popover
                    trigger="click"
                    placement="topLeft"
                    open={emojiOpen}
                    onOpenChange={setEmojiOpen}
                    // 面板内容只在首次打开时挂载（Popover 不渲染关闭态的内容）：表情包清单与图片
                    // 都是打开面板才去拉，不开面板不产生任何网络请求
                    content={emojiEnabled ? <EmojiPackPanel onPick={onPickEmojiImage} /> : null}>
                    {iconButton(
                        '表情',
                        emojiEnabled
                            ? '表情包（点一张直接发送到手机，悬停可放大）'
                            : emojiDisabledReason || '当前对话不支持发送表情',
                        <SmileIcon size={16} />,
                        () => setEmojiOpen((v) => !v),
                        disabled || !emojiEnabled
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
            </div>
            <Input.TextArea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onPressEnter={(event) => {
                    if (event.shiftKey) return;
                    event.preventDefault();
                    onSend();
                }}
                placeholder={placeholder}
                // 行数上限 6 行：超过后 rc-textarea 交给原生滚动条（框内滚动），
                // 输入区高度因此有上限，不会把消息区挤没
                autoSize={{ minRows: 2, maxRows: 6 }}
                disabled={disabled}
                variant="borderless"
                style={{
                    resize: 'none',
                    padding: 0,
                    fontSize: 14,
                    lineHeight: '20px',
                    color: 'rgba(255,255,255,0.9)',
                    outline: 'none',
                    boxShadow: 'none',
                }}
            />
            {/* 底部一行：右侧发送按钮（微信同位置；Enter 发送 / Shift+Enter 换行走 onPressEnter） */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
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
                    <Button
                        size="small"
                        aria-label="发送"
                        disabled={sendDisabled}
                        onClick={onSend}
                        icon={<SendIcon size={13} />}
                        style={{
                            minWidth: 64,
                            color: sendDisabled ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.9)',
                            background: sendDisabled ? 'transparent' : 'rgba(255,255,255,0.08)',
                        }}>
                        发送
                    </Button>
                )}
            </div>
        </div>
    );
}
