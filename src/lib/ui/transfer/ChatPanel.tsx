/**
 * 聊天面板的共用骨架件（v26.10.12-v3）。
 *
 * ── 为什么抽出来 ─────────────────────────────────────────────────────────────
 * 「设备会话」（`TransferDeviceChat`）与「Agent 对话」（`TransferAgentView`）的第三栏
 * 原来是两套自己写的结构：一个用 `header + 消息区 + 输入区` 的三段 div，另一个用
 * 「页签 + 固定 300px 消息盒 + 输入框」。用户要求两边**长得一模一样**（同一套气泡、
 * 同一种底部输入框），若各写一份，下次改样式必然只改一边 —— 所以这里把
 * 「头部 / 滚动消息区 / 气泡行」三件抽成共用件，两个面板只能通过它们拼装。
 *
 * ── 尺寸契约 ─────────────────────────────────────────────────────────────────
 * 第三栏整体是 `display:flex; flex-direction:column`，其中
 *   · 头部      `flex: 0 0 auto`（不参与伸缩）；
 *   · 消息区    `flex: 1 1 auto; minHeight: 0`（**必须 minHeight:0**，否则 flex 子项按内容
 *               撑高，滚动条永远不出现，输入框会被顶出窗口）；
 *   · 输入区    `flex: 0 0 auto`（见 ChatComposer）。
 * 于是「输入框固定吸附在底部、不随消息滚动」是布局算出来的，不是靠 position:fixed 硬钉。
 */

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 第三栏头部（微信式会话标题栏：左头像 + 名称，右操作图标）。
 *
 * v26.10.12-v4 起关闭按钮移到窗口顶部自绘标题条（znhd-transfer-titlebar）里，
 * 不再浮在第三栏右上角 —— 这里不再需要 48px 让位（v26.10.12-v2/v3 的历史约束随之解除）。
 */
export function ChatHeader({ left, right }: { left: ReactNode; right?: ReactNode }) {
    return (
        <div
            className="znhd-chat-header"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                borderBottom: '1px solid rgba(0,0,0,0.4)',
                flex: '0 0 auto',
                minWidth: 0,
            }}>
            {left}
            <span style={{ flex: '1 1 auto' }} />
            {right}
        </div>
    );
}

/**
 * 消息滚动容器：新消息到达时自动滚到底。
 *
 * ⚠️ `scrollbarGutter: 'stable'` 不是装饰：消息区出现/消失滚动条时，没有它会**整列左右抖动**
 * （Windows 上原生滚动条占 10px）。占用固定槽位后宽度不再跳。
 * 滚动条外观本身由 `uiReset` 统一美化（`.ant-modal-root *` 的 ::-webkit-scrollbar 规则）。
 */
export function ChatScroll({
    className,
    scrollDep,
    children,
}: {
    /** 冒烟夹具按这个类名找消息区（设备 `.znhd-transfer-messages` / Agent `.znhd-agent-messages`） */
    className: string;
    /** 变化即滚到底（传消息数组） */
    scrollDep: unknown;
    children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [scrollDep]);

    return (
        <div
            ref={ref}
            className={className}
            style={{
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                overflowX: 'hidden',
                padding: '10px 12px',
                scrollbarGutter: 'stable',
            }}>
            {children}
        </div>
    );
}
