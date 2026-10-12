import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfigProvider, Modal, theme } from 'antd';
import { addLog } from '@/lib/logger';
import { getOverlayContainer } from '@/lib/ui/panelHost';
import { CloseIcon, DeviceIcon } from '@/lib/ui/icons';
import TransferNavRail, { type TransferNav } from '@/lib/ui/transfer/TransferNavRail';
import TransferSessionList, { type DeviceEntry } from '@/lib/ui/transfer/TransferSessionList';
import TransferAgentView from '@/lib/ui/transfer/TransferAgentView';
import TransferDeviceChat from '@/lib/ui/transfer/TransferDeviceChat';
import TransferFilesView from '@/lib/ui/transfer/TransferFilesView';
import TransferPairModal from '@/lib/ui/transfer/TransferPairModal';
import TransferSettingsModal from '@/lib/ui/transfer/TransferSettingsModal';
import TransferAboutModal from '@/lib/ui/transfer/TransferAboutModal';
import { useAgentChat } from '@/lib/ui/transfer/useAgentChat';
import { resolveDeviceColors, shortPhoneId } from '@/lib/ui/transfer/deviceColors';
import { WECHAT } from '@/lib/ui/transfer/wechatTheme';
import {
    PHONE_SESSION_KEY,
    PHONE_SESSION_LABEL,
    clearTransferSession,
    markSessionRead,
    sessionKeyOf,
    setActiveSession,
    setTransferWindowOpen,
    useTransferStore,
} from '@/lib/transfer/store';
import type { AgentPane, DeviceSession, TransferMessage } from '@/lib/transfer/types';

/**
 * 传输助手主窗口（v26.10.12-v1）：原「设备互联」重构后的三栏窗口。
 *
 * ── 布局（v26.10.12-v4 起**对齐微信桌面版**）────────────────────────────────
 *   标题条（与第一栏同色 #2E2E2E，v26.10.12-v5 起）：右侧自绘关闭按钮（悬浮变红，微信同款）
 *   第一栏（窄图标栏 #2E2E2E）：logo → 对话 / Agents / 文件 → 设置 / 企业信息
 *   第二栏（会话列表 #252525）：搜索框 +「＋」→ 会话列表
 *   第三栏（聊天主区 #1E1E1E，最深）：当前会话的聊天区，未选中显示空状态
 *
 * ── 关键设计 ─────────────────────────────────────────────────────────────
 *   · **固定微信暗色**：整窗配色走 `wechatTheme.ts` 的分层色板，主色 token 换成微信绿
 *     #07C160（用户气泡 / 发送按钮 / 选中态一起变绿）。嵌套 ConfigProvider 仍把暗色算法
 *     限制在本窗，与主面板、征纳互动页面的主题互不影响；
 *   · **自绘关闭按钮**：antd Modal 的 `closable=false` 关掉默认 ×，标题条右侧放自己的
 *     按钮（悬浮变红 #E81123）。Esc / 点遮罩关闭仍走 onCancel，不受影响；
 *   · **数据隔离**：设置走 `scriptCat_TransferSettings`，收发明明在模块级 store
 *     （窗口不开时照常收件、按设置自动弹窗），见 `lib/transfer/store.ts` 头注；
 *   · **Agents 直达**：点第一栏 Agents 就在右侧主聊天区打开对话（useAgentChat）。
 */

/** 标题条高度（含自绘关闭按钮；微信桌面版约 32px） */
const TITLE_BAR_HEIGHT = 36;

export default function TransferAssistantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const s = useTransferStore();

    // ── 窗口自身的 UI 状态（与 store 的持久状态分开）──────────────────────
    const [nav, setNav] = useState<TransferNav>('devices');
    /**
     * Agents 分组下第三栏显示什么（v26.10.12-v3）：对话 / 技能 / 定时任务。
     * 「技能」「定时任务」由第二栏顶部的两个控件切换（原来是第三栏的页签）。
     * 三处会把它复位到 chat：切第一栏导航、点会话卡片、点搜索框旁的「＋」新建对话。
     */
    const [agentPane, setAgentPane] = useState<AgentPane>('chat');
    const [search, setSearch] = useState('');
    const [pairOpen, setPairOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    /** 自绘关闭按钮的悬浮态（变红，微信/Windows 同款交互） */
    const [closeHover, setCloseHover] = useState(false);

    /**
     * Agent 对话控制器：第一栏选中 Agents 且窗口开着才算 active（不活跃时 hook 内部
     * 暂停流式与轮询，但会话索引照常留在 localStorage，重进不丢）。
     * ⚠️ hook 必须无条件调用（不能塞进 `nav === 'agents'` 分支里）。
     */
    const agent = useAgentChat(nav === 'agents' && open);

    // 窗口开合 → 通知 store（决定未读累计与自动弹窗行为）
    useEffect(() => {
        setTransferWindowOpen(open);
        return () => setTransferWindowOpen(false);
    }, [open]);

    // 自动弹窗打开时，若 store 已把选中切到新消息所在会话，右侧跟着切到「对话」视图
    // （只认「关 → 开」这一个跳变：窗口开着时用户手动切视图不被抢）
    const prevOpen = useRef(false);
    useEffect(() => {
        if (open && !prevOpen.current && s.activeSessionKey) setNav('devices');
        prevOpen.current = open;
    }, [open, s.activeSessionKey]);

    // 选中/切换会话即已读
    useEffect(() => {
        if (open && s.activeSessionKey) markSessionRead(s.activeSessionKey);
    }, [open, s.activeSessionKey]);

    /** 设备 ID → 色板下标（会话列表、聊天头部、配对窗共用同一套配色） */
    const deviceColors = useMemo(() => resolveDeviceColors(s.phones.map((p) => p.id)), [s.phones]);

    /** 第二栏的设备条目：在线手机（无消息也出现，便于直接发起会话） ∪ 有消息的会话 */
    const deviceEntries = useMemo(() => {
        const map = new Map<string, DeviceEntry>();
        s.phones.forEach((p) => {
            const key = sessionKeyOf(p.id);
            map.set(key, {
                key,
                label: key === PHONE_SESSION_KEY ? PHONE_SESSION_LABEL : shortPhoneId(p.id),
                isAggregate: key === PHONE_SESSION_KEY,
                online: true,
                unread: 0,
                lastTs: 0,
                hasMessages: false,
            });
        });
        s.sessions.forEach((sess) => {
            const prev = map.get(sess.key);
            const lastMsg = sess.messages.length ? sess.messages[sess.messages.length - 1] : undefined;
            map.set(sess.key, {
                key: sess.key,
                label:
                    prev && !prev.isAggregate
                        ? prev.label
                        : sess.key === PHONE_SESSION_KEY
                        ? PHONE_SESSION_LABEL
                        : shortPhoneId(sess.key),
                isAggregate: sess.key === PHONE_SESSION_KEY,
                online: prev ? prev.online : false,
                unread: (prev ? prev.unread : 0) + sess.unread,
                lastTs: sess.lastTs,
                lastMsg,
                hasMessages: sess.messages.length > 0,
            });
        });
        // 有消息的（按最后消息时间）排在前，纯在线设备随后
        return Array.from(map.values()).sort((a, b) => b.lastTs - a.lastTs);
    }, [s.phones, s.sessions]);

    /** 未读总数（第一栏「对话」入口的红色角标） */
    const unreadTotal = s.sessions.reduce((n, x) => n + x.unread, 0);

    /** 全部文件视图的数据源：所有会话的消息（组件内部按时间倒序） */
    const allMessages = useMemo<TransferMessage[]>(
        () => s.sessions.reduce<TransferMessage[]>((acc, x) => acc.concat(x.messages), []),
        [s.sessions]
    );

    /**
     * 当前会话；选中了一台**在线但无历史**的手机时合成一条空会话，
     * 让用户能直接发起发送（发送侧只要求对方在线，不要求有历史）。
     */
    const activeSession = useMemo<DeviceSession | undefined>(() => {
        const found = s.sessions.find((x) => x.key === s.activeSessionKey);
        if (found) return found;
        if (!s.activeSessionKey) return undefined;
        const known =
            s.activeSessionKey === PHONE_SESSION_KEY
                ? s.phones.length > 0
                : s.phones.some((p) => sessionKeyOf(p.id) === s.activeSessionKey);
        return known ? { key: s.activeSessionKey, messages: [], unread: 0, lastTs: 0 } : undefined;
    }, [s.sessions, s.activeSessionKey, s.phones]);

    const activePhone = activeSession ? s.phones.find((p) => sessionKeyOf(p.id) === activeSession.key) : undefined;

    const onSelectSession = (key: string) => {
        setNav('devices');
        setActiveSession(key);
    };

    /**
     * 第一栏导航：切到 Agents 时把第三栏复位成「对话」。
     * 没有这一步会出现「上次停在技能页 → 关窗重开 → 点 Agents 看到技能页」这种摸不着头脑的状态
     * （重开虽然会重置 state，但**同一次会话内**来回切第一栏不会）。
     */
    const onNav = (next: TransferNav) => {
        setNav(next);
        if (next === 'agents') setAgentPane('chat');
    };

    /** 第三栏路由 */
    let main: ReactNode = null;
    if (nav === 'agents') {
        main = <TransferAgentView agent={agent} pane={agentPane} />;
    } else if (nav === 'files') {
        main = <TransferFilesView messages={allMessages} />;
    } else if (activeSession) {
        main = (
            <TransferDeviceChat
                session={activeSession}
                phone={activePhone}
                colorIndex={activePhone ? deviceColors[activePhone.id] : undefined}
                onClear={() => {
                    clearTransferSession(activeSession.key);
                    addLog('[传输助手] 已清空会话消息', 'success');
                }}
            />
        );
    } else {
        main = (
            <div
                className="znhd-transfer-empty"
                style={{
                    flex: '1 1 auto',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                }}>
                <DeviceIcon size={44} color="rgba(255,255,255,0.18)" />
                <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.65)' }}>暂无消息</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>
                    在「对话」里选择一个会话开始收发，或点右上角 ＋ 配对手机
                </div>
            </div>
        );
    }

    return (
        <ConfigProvider
            // 暗色算法 + 微信绿主色只作用于传输助手窗口（嵌套 provider：locale / zIndexPopupBase 等
            // 仍从外层主面板的 provider 继承）；浮层统一进 overlay 宿主，避开宿主页层叠上下文
            theme={{
                algorithm: theme.darkAlgorithm,
                token: {
                    colorPrimary: WECHAT.primary,
                    colorLink: WECHAT.primary,
                    borderRadius: 8,
                    borderRadiusLG: 10,
                    borderRadiusSM: 6,
                },
            }}
            getPopupContainer={getOverlayContainer}>
            <Modal
                open={open}
                // v26.10.12-v2 起不传 title（标题与第一栏重复）；v26.10.12-v4 起连默认 × 也关掉，
                // 换成标题条右侧的自绘关闭按钮（悬浮变红）。Esc（keyboard 默认 true）与点遮罩
                // 仍走 onCancel，三条关闭路径一条不少。
                closable={false}
                className="znhd-transfer-modal"
                onCancel={onClose}
                getContainer={getOverlayContainer}
                width="min(1166px, 96vw)"
                styles={{
                    // ⚠️ content 的 16/24 默认内边距不能用 styles 归零（antd v6 的 Modal styles
                    // 没有 content 键，tsc 实测 TS2353），改由 uiReset 的 CSS 规则处理
                    // （.znhd-transfer-modal 专属）：三栏贴满窗口 + 关闭按钮贴右上角。
                    body: {
                        padding: 0,
                        // v26.10.12-v5：窗口放大 20%（700→840，1080→1296）
                        // v26.10.13-v1：在 v5 基础上整体缩小 10%（1296→1166，840→756）
                        height: 'min(756px, calc(100vh - 96px))',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        background: WECHAT.frame,
                    },
                }}
                destroyOnHidden
                footer={null}>
                {/* 标题条：v26.10.12-v5 起与第一栏同色（#2E2E2E），右侧自绘关闭按钮（悬浮变红） */}
                <div
                    className="znhd-transfer-titlebar"
                    style={{
                        flex: '0 0 auto',
                        height: TITLE_BAR_HEIGHT,
                        display: 'flex',
                        alignItems: 'center',
                        background: WECHAT.rail,
                    }}>
                    <span style={{ flex: '1 1 auto' }} />
                    <button
                        type="button"
                        className="znhd-transfer-close"
                        aria-label="关闭"
                        title="关闭"
                        onMouseEnter={() => setCloseHover(true)}
                        onMouseLeave={() => setCloseHover(false)}
                        onClick={onClose}
                        style={{
                            width: 44,
                            height: TITLE_BAR_HEIGHT,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            background: closeHover ? WECHAT.closeHover : 'transparent',
                            color: closeHover ? '#fff' : 'rgba(255,255,255,0.65)',
                            // ⚠️ 不加 transition：冒烟会在派发 mouseover 的同一帧量底色，
                            // 有过渡就会量到半路的透明 → 假红（微信的关闭变红本身也是瞬时的）
                        }}>
                        <CloseIcon size={15} color="currentColor" />
                    </button>
                </div>

                {/* 三栏内容 */}
                <div style={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'row' }}>
                    {/* 第一栏：微信式窄图标导航 */}
                    <TransferNavRail
                        nav={nav}
                        onNav={onNav}
                        onOpenSettings={() => setSettingsOpen(true)}
                        onOpenAbout={() => setAboutOpen(true)}
                        unreadTotal={unreadTotal}
                    />

                    {/* 第二栏：搜索 +「＋」+ 会话列表 */}
                    <TransferSessionList
                        nav={nav}
                        search={search}
                        onSearch={setSearch}
                        onPair={() => setPairOpen(true)}
                        deviceEntries={deviceEntries}
                        activeSessionKey={s.activeSessionKey}
                        onSelectSession={onSelectSession}
                        agent={nav === 'agents' ? agent : undefined}
                        agentPane={agentPane}
                        onAgentPane={setAgentPane}
                    />

                    {/* 第三栏：聊天主区（三栏里最深的一层） */}
                    <div
                        className="znhd-transfer-main"
                        style={{
                            flex: '1 1 auto',
                            minWidth: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            background: WECHAT.chat,
                        }}>
                        {main}
                    </div>
                </div>

                {/* 子窗口：配对 / 设置 / 企业信息（都在本窗的 ConfigProvider 内，继承外观） */}
                <TransferPairModal
                    open={pairOpen}
                    onClose={() => setPairOpen(false)}
                    relayServer={s.settings.relayServer}
                    phones={s.phones}
                />
                <TransferSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
                <TransferAboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
            </Modal>
        </ConfigProvider>
    );
}
