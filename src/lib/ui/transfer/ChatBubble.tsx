/**
 * 聊天气泡（v26.10.12-v3）：设备会话与 Agent 对话**共用同一条消息的排版**。
 *
 * ── 布局（用户给的规格）──────────────────────────────────────────────────────
 *   他人 / AI：气泡靠左、**浅色底**、圆角，头像在气泡左侧；
 *   我       ：气泡靠右、**深色底**（这里用主色实心）、圆角，头像在气泡右侧。
 * 实现上只有一个 flex 容器：`flexDirection` 在 `row` / `row-reverse` 之间切，
 * 于是「头像位置」与「气泡贴哪边」用同一份代码得到，不会出现两边各写一套而错位。
 *
 * ── 为什么头像用 span 包一层 ─────────────────────────────────────────────────
 * 宿主税务页给 `svg` 加过 margin/vertical-align（见 `uiReset` 与 `icons.tsx` 的说明），
 * 头像里的矢量图标必须待在一个 inline-flex 的定尺容器里，否则会被顶偏。
 */

import type { CSSProperties, ReactNode } from 'react';
import { theme } from 'antd';

export default function ChatBubble({
    side,
    avatar,
    children,
    meta,
    bare,
    danger,
    maxWidth = '72%',
    avatarStyle,
}: {
    /** right = 本机发出（用户消息）；left = 收到（手机 / AI） */
    side: 'left' | 'right';
    avatar: ReactNode;
    children: ReactNode;
    /** 气泡下方的时间 / 发送状态行 */
    meta?: ReactNode;
    /** 图片气泡：去掉内边距与边框（图片自带圆角与描边） */
    bare?: boolean;
    /** 发送失败等错误态：加一圈红边 */
    danger?: boolean;
    maxWidth?: string;
    /** 覆盖头像底色/文字色（设备会话用设备专属色板，见 deviceColors） */
    avatarStyle?: CSSProperties;
}) {
    const { token } = theme.useToken();
    const isUser = side === 'right';

    return (
        <div
            className="znhd-chat-msg"
            // data-side 是给冒烟夹具用的稳定钩子：断言「收到的靠左（row）/ 发出的靠右（row-reverse）」
            // 时不能靠猜气泡颜色（深色主题下主色底和灰底都不好认），直接读这个属性
            data-side={side}
            style={{
                display: 'flex',
                flexDirection: isUser ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
                gap: 8,
                marginBottom: 12,
                minWidth: 0,
            }}>
            <span
                className="znhd-chat-avatar"
                style={{
                    flex: '0 0 auto',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    background: isUser ? token.colorPrimaryBg : token.colorFillSecondary,
                    color: isUser ? token.colorPrimary : token.colorTextSecondary,
                    fontSize: 12,
                    fontWeight: 600,
                    overflow: 'hidden',
                    ...avatarStyle,
                }}>
                {avatar}
            </span>
            <div
                style={{
                    minWidth: 0,
                    maxWidth,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                }}>
                <div
                    className="znhd-chat-bubble"
                    style={{
                        maxWidth: '100%',
                        padding: bare ? 0 : '8px 11px',
                        borderRadius: bare ? 8 : 10,
                        fontSize: 13,
                        lineHeight: 1.6,
                        wordBreak: 'break-word',
                        background: bare ? 'transparent' : isUser ? token.colorPrimary : token.colorFillQuaternary,
                        border: bare
                            ? 'none'
                            : '1px solid ' +
                              (danger ? token.colorError : isUser ? token.colorPrimary : token.colorBorderSecondary),
                        // 用户气泡是主色实心：文字必须显式刷白，否则深色主题下会继承成暗色文字
                        color: bare ? undefined : isUser ? '#fff' : undefined,
                        overflow: 'hidden',
                    }}>
                    {children}
                </div>
                {meta ? (
                    <div
                        style={{
                            fontSize: 11,
                            color: token.colorTextTertiary,
                            marginTop: 2,
                            maxWidth: '100%',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}>
                        {meta}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
