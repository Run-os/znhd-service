import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfigProvider, Modal, theme } from 'antd';
import { addLog } from '@/lib/logger';
import { getOverlayContainer } from '@/lib/ui/panelHost';
import { CloseIcon } from '@/lib/ui/icons';
import TransferNavRail, { type TransferNav } from '@/lib/ui/transfer/TransferNavRail';
import TransferSessionList, { type DeviceEntry } from '@/lib/ui/transfer/TransferSessionList';
import TransferDeviceChat from '@/lib/ui/transfer/TransferDeviceChat';
import TransferFilesView from '@/lib/ui/transfer/TransferFilesView';
import TransferPairModal from '@/lib/ui/transfer/TransferPairModal';
import TransferPairPanel from '@/lib/ui/transfer/TransferPairPanel';
import TransferSettingsModal from '@/lib/ui/transfer/TransferSettingsModal';
import TransferAboutModal from '@/lib/ui/transfer/TransferAboutModal';
import { resolveDeviceColors, shortPhoneId } from '@/lib/ui/transfer/deviceColors';
import { RADIUS, WECHAT } from '@/lib/ui/transfer/wechatTheme';
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
import type { DeviceSession, TransferMessage } from '@/lib/transfer/types';

/**
 * 传输助手主窗口（v26.10.12-v1）：原「设备互联」重构后的三栏窗口。
 *
 * ── 布局（v26.10.12-v4 起**对齐微信桌面版**；v26.10.13-v10 起按用户 excalidraw
 *    白板稿做「圆角 + 层级」）──────────────────────────────────────────────
 *   标题条（与第一栏同色 #2E2E2E，v26.10.12-v5 起）：右侧自绘关闭按钮（悬浮变红，微信同款）
 *   第一栏（窄图标栏 #2E2E2E）：logo → 对话 / 文件 → 设置 / 企业信息（**贴满窗口高度**）
 *   内容面板（v26.10.13-v10）：第二栏 + 第三栏整体是一张**内嵌圆角卡片**——
 *     右缘 / 下缘与窗口边缘留出空隙（**v26.10.14-v1 起露出与第一栏同色的
 *     #2E2E2E 窗口底色，不再用 #383838 —— 用户要求避免与第一栏的色差断层**），
 *     窗口外框大圆角，于是视觉上是「窗口 → 圆角卡片 → 三栏」三层，
 *     而不是三栏直接贴窗口边；
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
 *     （窗口不开时照常收件、按设置自动弹窗），见 `lib/transfer/store.ts` 头注。
 *
 * ⚠️ v26.10.13-v9：原第一栏的 **Agents 入口与 Agent 对话第三栏已整体删除**
 * （含 `useAgentChat` / `TransferAgentView` / 技能·定时任务面板）。
 */

/** 标题条高度（含自绘关闭按钮；v26.10.13-v10 38 → 40，配合外层大圆角更稳） */
const TITLE_BAR_HEIGHT = 40;

/** 内容面板的外缩进（v26.10.13-v10）：右 / 下缘露出窗口底色形成层级；左缘紧贴第一栏。
 *  ⚠️ v26.10.14-v1：窗口底色由 frame 色（#383838）改为与第一栏同色的 rail（#2E2E2E）——
 *  用户要求「第二三栏最下面的底色与第一栏一致，避免断层」，右侧露出带一并同色。 */
const PANEL_INSET = { right: 10, bottom: 8 } as const;

export default function TransferAssistantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const s = useTransferStore();

    // ── 窗口自身的 UI 状态（与 store 的持久状态分开）──────────────────────
    const [nav, setNav] = useState<TransferNav>('devices');
    const [search, setSearch] = useState('');
    /**
     * 文件视图的会话筛选（v26.10.13-v5）：'' = 全部文件（跨会话汇总）；
     * 在文件分组点第二栏某个会话 = 只看那个会话的文件。与 `activeSessionKey` 分开——
     * 文件分组下点会话不该影响「对话」分组的选中态，也不该触发已读标记。
     */
    const [filesFilterKey, setFilesFilterKey] = useState('');
    const [pairOpen, setPairOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);
    /** 自绘关闭按钮的悬浮态（变红，微信/Windows 同款交互） */
    const [closeHover, setCloseHover] = useState(false);

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

    /** 文件视图实际显示的消息：筛选了具体会话就只取该会话的 */
    const filesMessages = useMemo<TransferMessage[]>(
        () => (filesFilterKey ? allMessages.filter((m) => m.sessionKey === filesFilterKey) : allMessages),
        [allMessages, filesFilterKey]
    );

    /** 文件视图标题：全部文件 / <会话名>的文件 */
    const filesScopeLabel = filesFilterKey
        ? (deviceEntries.find((e) => e.key === filesFilterKey)?.label || shortPhoneId(filesFilterKey)) + '的文件'
        : '全部文件';

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
     * 第一栏导航：离开文件分组就还原成「全部文件」——筛选是文件视图的临时状态，
     * 保留到下次进来会出现「明明点的是文件却只看到某个会话」的困惑。
     */
    const onNav = (next: TransferNav) => {
        setNav(next);
        if (next !== 'files') setFilesFilterKey('');
    };

    /** 第三栏路由 */
    let main: ReactNode = null;
    if (nav === 'files') {
        main = (
            <TransferFilesView
                messages={filesMessages}
                scopeLabel={filesScopeLabel}
                onClearScope={
                    filesFilterKey
                        ? () => {
                              clearTransferSession(filesFilterKey);
                              addLog('[传输助手] 已清空该会话的文件与消息', 'success');
                          }
                        : undefined
                }
            />
        );
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
        // v26.10.17-v1（用户要求）：未选中会话时第三栏直接展示「配对设备」信息
        // （二维码 / 链接 / 在线状态 / 已连接手机），不再显示「选择一个会话」的提示文案
        main = (
            <div
                className="znhd-transfer-empty znhd-transfer-pair"
                style={{
                    flex: '1 1 auto',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    minHeight: 0,
                    overflow: 'auto',
                }}>
                <TransferPairPanel relayServer={s.settings.relayServer} phones={s.phones} />
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
                    // v26.10.13-v10：窗口外框大圆角（antd Modal 容器用的是 borderRadiusLG），
                    // 配对 / 设置 / 企业信息等子弹窗同族一致；内容面板圆角另见 RADIUS.panel
                    borderRadiusLG: RADIUS.window,
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
                    // v26.10.14-v1：container 与 body 双设 rail 底色 —— container 自己是
                    // 包着 body 的那层（v6 的 DOM：.ant-modal > .ant-modal-container >
                    // .ant-modal-body），默认带 colorBgElevated；body 虽撑满盖住它，
                    // 一并设同色防未来哪层露底出现异色断层。
                    container: { background: WECHAT.rail },
                    body: {
                        padding: 0,
                        // v26.10.12-v5：窗口放大 20%（700→840，1080→1296）
                        // v26.10.13-v1：在 v5 基础上整体缩小 10%（1296→1166，840→756）
                        height: 'min(756px, calc(100vh - 96px))',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        // v26.10.14-v1：窗口底色由 frame（#383838）改为与第一栏同色的
                        // rail（#2E2E2E）—— 第二三栏卡片右/下缘露出的就是这一层，
                        // 与第一栏连成一体，不再有颜色断层（v26.10.13-v10 曾用 frame 色）
                        background: WECHAT.rail,
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
                    {/* 第一栏：微信式窄图标导航（贴满窗口高度，不随内容卡片内缩） */}
                    <TransferNavRail
                        nav={nav}
                        onNav={onNav}
                        onOpenSettings={() => setSettingsOpen(true)}
                        onOpenAbout={() => setAboutOpen(true)}
                        unreadTotal={unreadTotal}
                    />

                    {/* 内容面板（v26.10.13-v10）：第二栏 + 第三栏整体的内嵌圆角卡片。
                        右 / 下缘留出 PANEL_INSET 的空隙露出窗口底色（v26.10.14-v1 起与
                        第一栏同色 #2E2E2E，避免色差断层），与外框大圆角一起构成
                        「窗口 → 卡片 → 三栏」的层级；
                        overflow:hidden 让卡片圆角裁掉内部两栏的直角边。 */}
                    <div
                        className="znhd-transfer-content"
                        style={{
                            flex: '1 1 auto',
                            minWidth: 0,
                            minHeight: 0,
                            margin: `0 ${PANEL_INSET.right}px ${PANEL_INSET.bottom}px 0`,
                            borderRadius: RADIUS.panel,
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                            overflow: 'hidden',
                            display: 'flex',
                            flexDirection: 'row',
                            background: WECHAT.list,
                        }}>
                        {/* 第二栏：搜索 +「＋」+ 会话列表 */}
                        <TransferSessionList
                            nav={nav}
                            search={search}
                            onSearch={setSearch}
                            onPair={() => setPairOpen(true)}
                            deviceEntries={deviceEntries}
                            activeSessionKey={s.activeSessionKey}
                            onSelectSession={onSelectSession}
                            filesActiveKey={filesFilterKey}
                            onSelectFilesSession={setFilesFilterKey}
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
