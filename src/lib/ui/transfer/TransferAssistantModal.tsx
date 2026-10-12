import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ConfigProvider, Modal, theme } from 'antd';
import { addLog } from '@/lib/logger';
import { getOverlayContainer } from '@/lib/ui/panelHost';
import { DeviceIcon } from '@/lib/ui/icons';
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
import {
    PHONE_SESSION_KEY,
    PHONE_SESSION_LABEL,
    clearTransferSession,
    markSessionRead,
    sessionKeyOf,
    setActiveSession,
    setTransferWindowOpen,
    updateTransferSettings,
    useTransferStore,
} from '@/lib/transfer/store';
import type { DeviceSession, TransferMessage, TransferTheme } from '@/lib/transfer/types';

/**
 * 传输助手主窗口（v26.10.12-v1）：原「设备互联」重构后的三栏窗口。
 *
 * ── 布局（对齐企业微信桌面端）────────────────────────────────────────────
 *   第一栏（最窄）：logo + 折叠开关 → Agents（固定最顶部）/ 设备 / 文件 → 底部外观 / 设置 / 企业信息
 *   第二栏（中等）：搜索框 + 紧邻的「+」配对按钮 → 会话 / 设备列表（Agents 分组时为对话列表）
 *   第三栏（最宽）：当前会话的聊天区（设备收发 / Agent 对话 / 全部文件），未选中显示空状态
 *
 * ── 关键设计 ─────────────────────────────────────────────────────────────
 *   · **外观隔离**：整窗套一层嵌套 ConfigProvider（深色算法只作用于本窗），
 *     与主面板、征纳互动页面的主题互不影响；
 *   · **数据隔离**：设置走 `scriptCat_TransferSettings`，收发明明在模块级 store
 *     （窗口不开时照常收件、按设置自动弹窗），见 `lib/transfer/store.ts` 头注；
 *   · **Agents 直达**：点第一栏 Agents 就在右侧主聊天区打开对话（useAgentChat），
 *     不再有「打开 Agent 助手」按钮 + 独立窗口的旧交互。
 */
export default function TransferAssistantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const s = useTransferStore();

    // ── 窗口自身的 UI 状态（与 store 的持久状态分开）──────────────────────
    const [nav, setNav] = useState<TransferNav>('devices');
    const [collapsed, setCollapsed] = useState(false);
    const [search, setSearch] = useState('');
    const [pairOpen, setPairOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [aboutOpen, setAboutOpen] = useState(false);

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

    // 自动弹窗打开时，若 store 已把选中切到新消息所在会话，右侧跟着切到「设备」视图
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

    /** 未读总数（第一栏「设备」入口的小红点） */
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

    /** 第三栏路由 */
    let main: ReactNode = null;
    if (nav === 'agents') {
        main = <TransferAgentView agent={agent} />;
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
                <DeviceIcon size={44} color="rgba(128,128,128,0.45)" />
                <div style={{ fontSize: 14, fontWeight: 600, opacity: 0.75 }}>暂无消息</div>
                <div style={{ fontSize: 12, opacity: 0.55 }}>
                    点第二栏右上角 + 配对手机，或在「设备」里选择一个会话开始收发
                </div>
            </div>
        );
    }

    const dark = s.settings.theme === 'dark';

    return (
        <ConfigProvider
            // 深色算法只作用于传输助手窗口（嵌套 provider：locale / zIndexPopupBase 等
            // 仍从外层主面板的 provider 继承）；浮层统一进 overlay 宿主，避开宿主页层叠上下文
            theme={{
                algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
                token: { borderRadius: 8, borderRadiusLG: 10, borderRadiusSM: 6 },
            }}
            getPopupContainer={getOverlayContainer}>
            <Modal
                open={open}
                // v26.10.12-v2：**不传 title** —— 标题栏（图标 + 「传输助手」）与第一栏顶部的
                // logo + 名称完全重复，用户要求整条去掉。rc-dialog 的 header 只在 `title` 为真值时
                // 才渲染，而关闭按钮 `closerNode` 是独立渲染的（见 @rc-component/dialog 的
                // Content/Panel），所以去掉标题**不会**把右上角的 × 一起弄丢。
                // className 是冒烟/夹具识别本窗口的**唯一稳定钩子**（className 落在 `.ant-modal`
                // 元素上，见 Panel 的 `clsx(prefixCls, className)`）：v26.10.12-v1 之前靠标题文字
                // 精确匹配区分本窗口与「传输助手设置」子窗口，现在没有标题了，必须换成 class 定位。
                className="znhd-transfer-modal"
                onCancel={onClose}
                getContainer={getOverlayContainer}
                width="min(1080px, 96vw)"
                styles={{
                    body: {
                        padding: 0,
                        // 去掉标题栏省下约 57px，这里相应放宽视口上限（原来按「标题栏 + 内边距」留的 190）
                        height: 'min(660px, calc(100vh - 140px))',
                        display: 'flex',
                        flexDirection: 'row',
                        overflow: 'hidden',
                    },
                }}
                destroyOnHidden
                footer={null}>
                {/* 第一栏：窄导航 */}
                <TransferNavRail
                    nav={nav}
                    onNav={setNav}
                    collapsed={collapsed}
                    onToggleCollapsed={() => setCollapsed((v) => !v)}
                    themeMode={s.settings.theme}
                    onThemeMode={(t: TransferTheme) => updateTransferSettings({ theme: t })}
                    onOpenSettings={() => setSettingsOpen(true)}
                    onOpenAbout={() => setAboutOpen(true)}
                    unreadTotal={unreadTotal}
                />

                {/* 第二栏：搜索 + 配对 + 会话列表 */}
                <TransferSessionList
                    nav={nav}
                    search={search}
                    onSearch={setSearch}
                    onPair={() => setPairOpen(true)}
                    deviceEntries={deviceEntries}
                    activeSessionKey={s.activeSessionKey}
                    onSelectSession={onSelectSession}
                    agent={nav === 'agents' ? agent : undefined}
                />

                {/* 第三栏：聊天主区 */}
                <div
                    className="znhd-transfer-main"
                    style={{
                        flex: '1 1 auto',
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        background: s.settings.theme === 'dark' ? '#141414' : '#fff',
                    }}>
                    {main}
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
