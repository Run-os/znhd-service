import { useEffect, useRef, useState } from 'react';
import { Button, Card, Space, Switch, Tooltip } from 'antd';
import { DEFAULTS, PHRASES_CACHE_TTL } from '@/lib/constants';
import { addLog, addLogDebounced, setLogEntriesSink, clearLogs, type LogEntry } from '@/lib/logger';
import { loadPhrasesCache, savePhrasesCache, saveAllvalue, type Allvalue } from '@/lib/storage';
import { runtime } from '@/lib/state';
import { resolveGithubUrl, hoursToHHmm } from '@/lib/utils';
import { getDeviceId, startPhoneReceive } from '@/lib/relay';
import { MAX_GALLERY, type GalleryImage } from '@/lib/gallery';
import { clearSpeechQueue } from '@/lib/speech';
import { getMonitorState, setMonitorStateSink, type MonitorState } from '@/lib/monitor';
import { notify } from '@/lib/ui/notify';
import { clampHostIntoView, usePanelDrag } from '@/lib/ui/panelHost';
import { PANEL_WIDTH } from '@/lib/ui/panelIds';
import SettingsModal from '@/lib/ui/SettingsModal';
import PhrasesDrawer from '@/lib/ui/PhrasesDrawer';
import PhoneModal from '@/lib/ui/PhoneModal';
import LogModal from '@/lib/ui/LogModal';
import ChangelogModal from '@/lib/ui/ChangelogModal';
import RecvGalleryModal from '@/lib/ui/RecvGalleryModal';
import RecvTextModal from '@/lib/ui/RecvTextModal';

// 常用语请求序号（loadPhrasesData 用）：仅最新一次请求可落地结果，防慢的旧响应后到覆盖新数据
let phrasesRequestSeq = 0;

/** 面板品牌图标：税务站点自身的 favicon（与脚本 @icon 一致） */
const BRAND_ICON = 'https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico';

/**
 * 品牌图标：优先用 favicon（与油猴脚本 @icon 同源），加载失败（离线/被拦）时回退到 emoji，
 * 避免面板头部出现空白块。
 */
function BrandIcon({ size = 26 }: { size?: number }) {
    const [failed, setFailed] = useState(false);
    const box = { width: size, height: size, borderRadius: 6, flex: '0 0 auto' } as const;
    if (failed) {
        return (
            <span
                style={{
                    ...box,
                    background: '#1677ff',
                    color: '#fff',
                    fontSize: Math.round(size * 0.55),
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                🎯
            </span>
        );
    }
    return (
        <img
            src={BRAND_ICON}
            alt=""
            draggable={false}
            style={{ ...box, display: 'block' }}
            onError={() => setFailed(true)}
        />
    );
}

/**
 * 底部四入口按钮的自适应样式（v26.10.07-v3）。
 *
 * 需求：4 个入口合并到一行，并随宽度自适应——
 *   · 宽度足够 → 图标 + 文字同排；
 *   · 宽度不足 → **只留图标**（当前面板就落在这一档，文案靠 hover Tooltip 给出）；
 *   · 两种状态下悬停都有 Tooltip（见下方 JSX）。
 *
 * 阈值为什么取 68px（实测：Chrome 154）：
 *   容器查询的尺寸按**内容盒**算 —— 按钮宽度减去内边距 4×2 与边框 1×2 才是被查询的尺寸。
 *   横排所需宽度 = emoji 18px + 间距 2px + 「历史文件」4 字 × 11px = **64px**，
 *   正好卡在边界会折成两行，故阈值取 68px（留 4px 余量）。
 *   ⚠️ 该阈值与面板宽度无关，只取决于按钮自身宽度：
 *      · 面板 340px 时四列各 74px（内容盒 64px）→ 刚好在阈值下，只显示图标；
 *      · 面板缩到 238px 后四列各 48.5px（内容盒 38.5px）→ 更在阈值下，仍是只显示图标；
 *      · 面板加宽到约 78px/按钮以上，文字会自动出现，**无需改代码**。
 *
 * ⚠️ 文字用 `display: none` 隐藏，**不是条件渲染**：文字必须留在 DOM 里 ——
 *    冒烟测试是按 textContent 找面板按钮的（`clickByText('设置')`），
 *    若改成 `{show && <span>…}` 会把断言直接打挂；同时它也是纯图标态的可访问名。
 *
 * ⚠️ 用 CSS 容器查询而非 JS 测量：按钮在 grid 里宽度由栅格决定（与自身内容无关），
 *    因此不存在「隐藏文字 → 按钮变窄 → 反过来触发隐藏」的抖动回路。
 */
const PANEL_CSS = `
.znhd-panel-btn {
  container-type: inline-size;
}
.znhd-panel-btn-text {
  display: none;
}
@container (min-width: 68px) {
  .znhd-panel-btn-text {
    display: inline;
  }
}
`;

/** 底部四个入口：key + 图标 + 文案（文案同时用于 hover Tooltip；点击行为见组件内 actionHandlers） */
const PANEL_ACTIONS = [
    { key: 'settings', icon: '⚙️', label: '设置' },
    { key: 'phrases', icon: '💬', label: '常用语' },
    { key: 'gallery', icon: '🖼️', label: '历史文件' },
    { key: 'phone', icon: '💻', label: '设备互联' },
] as const;

/** 状态点 */
function Dot({ color }: { color: string }) {
    return (
        <span
            style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: color,
                marginRight: 6,
                verticalAlign: 'middle',
            }}
        />
    );
}

/** 「上次播报」的展示文案（面板每 3s 随监控状态重渲染，所以相对时间会自动更新） */
function lastSpeakText(last: MonitorState['lastSpeak']): string {
    if (!last) return '暂无播报记录';
    const mins = Math.floor((Date.now() - last.at) / 60000);
    const when = mins <= 0 ? '刚刚' : mins + ' 分钟前';
    return '上次播报：' + when + ' · ' + last.reason;
}

interface MainPanelProps {
    /** 面板宿主元素：拖拽时改写它的 left/top */
    host: HTMLElement;
}

/**
 * 主面板（v26.10.06-v9：CAT_UI → React + Ant Design）。
 * 版式对齐参考图：头部（图标+标题+版本+收起）、人数/状态卡、语音开关行、一行四入口按钮、底部「查看日志」。
 */
export default function MainPanel({ host }: MainPanelProps) {
    // dragHandlers 给「展开态标题栏」和「收起态悬浮球」共用；consumeDrag 供悬浮球区分点击与拖拽
    const { consumeDrag, ...dragHandlers } = usePanelDrag(host);

    // 惰性初始化：useState(loadAllvalue()) 的实参每次渲染都会求值，而本组件因 logEntries 频繁重渲染，
    // 等于反复白读 localStorage。顶层 runtime.init 已是启动时读好的同一份数据。
    const [Allvalue, setAllvalue] = useState<Allvalue>(() => runtime.init);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [phrasesOpen, setPhrasesOpen] = useState(false);
    const [phoneOpen, setPhoneOpen] = useState(false);
    const [logOpen, setLogOpen] = useState(false);
    const [changelogOpen, setChangelogOpen] = useState(false);
    // 收到图片/文本（v26.10.06-v13：由原来的命令式 DOM 弹窗改为 React state 驱动 antd 弹窗）
    const [recvImages, setRecvImages] = useState<GalleryImage[]>([]);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [recvText, setRecvText] = useState<string | null>(null);
    const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
    const [phrasesData, setPhrasesData] = useState<Record<string, string>>({});
    const [phrasesLoading, setPhrasesLoading] = useState(false);
    const [searchKeyword, setSearchKeyword] = useState('');
    const [collapsed, setCollapsed] = useState(false);
    const [mon, setMon] = useState<MonitorState>(() => getMonitorState());
    const receiveStopRef = useRef<null | (() => void)>(null);

    const updateAllvalue = (newValue: Allvalue) => {
        setAllvalue(newValue);
        saveAllvalue(newValue);
        runtime.voiceEnabled = newValue.voiceEnabled;
        runtime.workingHours = newValue.workingHours;
        runtime.commonPhrasesUrl = newValue.commonPhrasesUrl;
        runtime.useCdn = !!newValue.useCdn;
        runtime.logAutoRefresh = !!newValue.logAutoRefresh;
    };
    const patchAllvalue = (kv: Partial<Allvalue>) => updateAllvalue({ ...Allvalue, ...kv });

    const { voiceEnabled } = Allvalue;

    // 日志写入回调
    useEffect(() => {
        setLogEntriesSink(setLogEntries);
        return () => setLogEntriesSink(null);
    }, []);

    // 监控状态订阅（人数/在线/工作时段/上次播报）
    useEffect(() => {
        setMonitorStateSink(setMon);
        setMon(getMonitorState());
        return () => setMonitorStateSink(null);
    }, []);

    // 启动日志（只跑一次）
    useEffect(() => {
        addLog('脚本已启动，版本 v' + (GM_info.script.version || '?'), 'success');
        const wh = Allvalue.workingHours || runtime.workingHours;
        if (wh) {
            addLog(
                '监控时间段：上午 ' +
                    hoursToHHmm(wh.morningStart) +
                    '-' +
                    hoursToHHmm(wh.morningEnd) +
                    '，下午 ' +
                    hoursToHHmm(wh.afternoonStart) +
                    '-' +
                    hoursToHHmm(wh.afternoonEnd),
                'info'
            );
        }
        addLog('语音播报：' + (runtime.voiceEnabled ? '已开启' : '已静音'), 'info');
    }, []);

    // 悬浮球可以被拖到贴边；展开回面板时按**面板真实宽度**重新裁回视口，
    // 否则「从屏幕右下角展开」会出现面板大半在屏幕外、抓不回来。
    // ⚠️ 只在「收起 → 展开」这一跳时裁：挂载时 usePanelDrag 已按真实尺寸裁过一次，这里再裁会多写一遍存档。
    const prevCollapsedRef = useRef(collapsed);
    useEffect(() => {
        const wasCollapsed = prevCollapsedRef.current;
        prevCollapsedRef.current = collapsed;
        if (wasCollapsed && !collapsed) clampHostIntoView(host);
    }, [collapsed, host]);

    const loadPhrasesData = (force = false) => {
        if (!force) {
            const cache = loadPhrasesCache();
            if (cache && cache.url === runtime.commonPhrasesUrl && Date.now() - cache.time < PHRASES_CACHE_TTL) {
                setPhrasesData(cache.data || {});
                const mins = Math.round((Date.now() - cache.time) / 60000);
                addLog('常用语使用本地缓存（' + mins + ' 分钟前加载），已跳过网络请求', 'info');
                return;
            }
        }
        const seq = ++phrasesRequestSeq;
        setPhrasesLoading(true);
        GM_xmlhttpRequest({
            method: 'GET',
            url: resolveGithubUrl(runtime.commonPhrasesUrl || DEFAULTS.commonPhrasesUrl),
            timeout: 15000,
            onload: function (response) {
                if (seq !== phrasesRequestSeq) return;
                try {
                    if (response.status !== 200) throw new Error('数据源返回 HTTP ' + response.status);
                    const data = jsyaml.load(response.responseText);
                    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                        throw new Error('数据源不是有效的键值对象（可能返回了网页/错误页）');
                    }
                    setPhrasesData(data as Record<string, string>);
                    savePhrasesCache(runtime.commonPhrasesUrl, data);
                    addLog('常用语加载成功，共 ' + Object.keys(data).length + ' 条', 'success');
                    notify.success('常用语加载成功');
                } catch (error) {
                    const hasOld = Object.keys(phrasesData).length > 0;
                    addLog(
                        '常用语加载失败: ' + error.message + (hasOld ? '，仍显示上次加载的内容' : ''),
                        'error',
                        true
                    );
                    notify.error('常用语加载失败' + (hasOld ? '，仍显示上次内容' : ''));
                } finally {
                    setPhrasesLoading(false);
                }
            },
            onerror: function (error: unknown) {
                if (seq !== phrasesRequestSeq) return;
                // GM_xmlhttpRequest 的错误参数形态不定（对象 / 字符串），故按需取值而非断言类型
                const err = (error || {}) as { message?: string };
                const errMsg = err.message ? err.message : typeof error === 'string' ? error : '网络错误';
                const hasOld = Object.keys(phrasesData).length > 0;
                addLog('加载常用语失败: ' + errMsg + (hasOld ? '，仍显示上次加载的内容' : ''), 'error', true);
                notify.error('加载常用语失败' + (hasOld ? '，仍显示上次内容' : ''));
                setPhrasesLoading(false);
            },
            ontimeout: function () {
                if (seq !== phrasesRequestSeq) return;
                const hasOld = Object.keys(phrasesData).length > 0;
                addLog('加载常用语超时（15s），已取消' + (hasOld ? '，仍显示上次加载的内容' : ''), 'error', true);
                notify.error('加载常用语超时' + (hasOld ? '，仍显示上次内容' : ''));
                setPhrasesLoading(false);
            },
        });
    };

    // 常用语弹窗打开时自动加载
    useEffect(() => {
        if (phrasesOpen) loadPhrasesData();
    }, [phrasesOpen]);

    // 设备互联：地址填好后默认自动开始接收（门控 + 800ms 防抖，避免逐字输入时反复启停）
    useEffect(() => {
        const s = (Allvalue.relayServer || '').trim().replace(/\/+$/, '');
        if (!s || !/^https?:\/\//i.test(s)) return;
        const timer = setTimeout(() => {
            if (receiveStopRef.current) return;
            const stop = startPhoneReceive({
                server: s,
                uuid: getDeviceId(),
                onConnected: () => addLog('[设备互联] 已自动开始接收（' + s + '）', 'info'),
                // 入参类型由 startPhoneReceive 的 PhoneReceiveOptions 上下文推断，无需显式标注
                onImage: (img) => {
                    addLog(
                        '[设备互联] 收到图片：' + (img.name || 'image') + '（' + (img.mime || 'image') + '）',
                        'success'
                    );
                    // 入列 + 上限保护（超出的丢最旧并 revoke 其 objectURL，防内存累积），随后自动打开画廊
                    setRecvImages((prev) => {
                        const next = prev.concat({
                            blob: img.blob,
                            previewUrl: img.previewUrl,
                            name: img.name,
                            mime: img.mime,
                        });
                        while (next.length > MAX_GALLERY) {
                            const dropped = next.shift();
                            if (dropped) {
                                try {
                                    URL.revokeObjectURL(dropped.previewUrl);
                                } catch (e) {
                                    /* 忽略 */
                                }
                            }
                        }
                        return next;
                    });
                    setGalleryOpen(true);
                },
                onText: (txt) => {
                    const t = (txt.text || '').replace(/\s+$/, '');
                    addLog('[设备互联] 收到文本：' + (t.length > 40 ? t.slice(0, 40) + '…' : t), 'success');
                    // 同屏只留最新一条：直接替换内容（antd Modal 单实例）
                    setRecvText(txt.text || '');
                },
            });
            receiveStopRef.current = stop;
        }, 800);
        return () => {
            clearTimeout(timer);
            if (receiveStopRef.current) {
                receiveStopRef.current();
                receiveStopRef.current = null;
            }
        };
    }, [Allvalue.relayServer]);

    const toggleVoice = (next: boolean) => {
        patchAllvalue({ voiceEnabled: next });
        addLog('语音播报已' + (next ? '开启' : '静音'), 'info');
        if (next && 'speechSynthesis' in window) {
            // 播放一个静默语音激活语音合成（绕过浏览器 not-allowed 限制）
            window.speechSynthesis.speak(new SpeechSynthesisUtterance(''));
            notify.success('语音功能已启用');
        } else if (!next) {
            clearSpeechQueue();
        }
    };

    // 收起：只留一个圆形悬浮球，避免「关掉就再也找不回来」。
    // 悬浮球与标题栏一样可拖动（v26.10.07-v3）：拖动过就不要再展开面板。
    if (collapsed) {
        return (
            <Button
                {...dragHandlers}
                shape="circle"
                color="primary"
                variant="solid"
                title="拖动可移动位置，点击展开面板"
                onClick={() => {
                    // ⚠️ pointerdown 里的 preventDefault 并不能阻止 click（实测序列：拖拽为 pd|pm×N|pu|click），
                    //    故必须靠 consumeDrag() 把「拖拽尾巴」的那次 click 吃掉，否则拖完一松手就会展开。
                    if (consumeDrag()) return;
                    setCollapsed(false);
                }}
                style={{
                    width: 36,
                    height: 36,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
                    cursor: 'move',
                    userSelect: 'none',
                    touchAction: 'none',
                }}>
                <BrandIcon size={20} />
            </Button>
        );
    }

    // 四个入口的点击行为（key 与 PANEL_ACTIONS 对齐）
    const actionHandlers: Record<string, () => void> = {
        settings: () => setSettingsOpen(true),
        phrases: () => setPhrasesOpen(true),
        gallery: () => {
            if (!recvImages.length) {
                notify.info('暂无待存文件');
                return;
            }
            setGalleryOpen(true);
        },
        phone: () => setPhoneOpen(true),
    };

    return (
        <Card
            size="small"
            style={{ width: PANEL_WIDTH, boxShadow: '0 6px 24px rgba(0,0,0,0.18)' }}
            styles={{ body: { padding: 12 }, header: { padding: '8px 10px', minHeight: 46 } }}
            title={
                // 标题栏 = 拖拽手柄（唯一可抓取区）
                <div
                    {...dragHandlers}
                    style={{
                        cursor: 'move',
                        userSelect: 'none',
                        touchAction: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        // v26.10.07-v3 面板缩到 238px 后，标题栏内容实测 191px 而可用只有 189px（溢出 2px）。
                        // 间隙 8→6 收回 4px；标题再给 minWidth:0 + 省略号兜底 —— 字体渲染略有差异时
                        // 让标题自己省略，而不是把右侧的 ✕ 挤出去。
                        gap: 6,
                    }}
                    title="按住拖动面板">
                    <BrandIcon />
                    <span
                        style={{
                            fontWeight: 700,
                            fontSize: 15,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                        }}>
                        征纳互动监控
                    </span>
                    <span
                        style={{
                            background: '#e6f4ff',
                            color: '#1677ff',
                            borderRadius: 10,
                            padding: '1px 8px',
                            fontSize: 11,
                            fontWeight: 400,
                            flex: '0 0 auto',
                        }}>
                        v{GM_info.script.version}
                    </span>
                </div>
            }
            extra={
                <Button
                    type="text"
                    size="small"
                    title="收起面板（点圆形按钮可展开）"
                    onClick={() => setCollapsed(true)}>
                    ✕
                </Button>
            }>
            <style>{PANEL_CSS}</style>

            {/* 人数 + 状态 */}
            <div
                style={{
                    background: '#f7f8fa',
                    borderRadius: 10,
                    padding: '10px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 10,
                }}>
                <div>
                    <div style={{ fontSize: 12, color: '#8c8c8c' }}>当前等待人数</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                        <span style={{ fontSize: 30, fontWeight: 700, color: '#1677ff', lineHeight: 1.15 }}>
                            {mon.waiting === null ? '—' : mon.waiting}
                        </span>
                        <span style={{ fontSize: 12, color: '#8c8c8c' }}>人</span>
                    </div>
                </div>
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                        justifyContent: 'center',
                        fontSize: 12,
                    }}>
                    <div>
                        <Dot color={mon.online ? '#52c41a' : '#ff4d4f'} />
                        {mon.online ? '在线 · 正常监控' : '掉线'}
                    </div>
                    <div>
                        <Dot color="#1677ff" />
                        {mon.inWorkingHours ? '工作时段内' : '非工作时段'}
                    </div>
                </div>
            </div>

            {/* 语音播报开关 */}
            <div
                style={{
                    background: '#f7f8fa',
                    borderRadius: 10,
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                }}>
                <Space size={6}>
                    <span>{voiceEnabled ? '🔊' : '🔇'}</span>
                    <span style={{ fontSize: 13 }}>语音播报</span>
                </Space>
                <Switch checked={!!voiceEnabled} onChange={toggleVoice} />
            </div>

            {/* 四个入口合并到一行：宽度自适应（不够时只留图标），悬停给出完整文案 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
                {PANEL_ACTIONS.map((a) => (
                    <Tooltip key={a.key} title={a.label} placement="bottom">
                        <Button
                            className="znhd-panel-btn"
                            size="large"
                            style={{ padding: '0 4px' }}
                            onClick={actionHandlers[a.key]}>
                            <span style={{ fontSize: 13, lineHeight: 1 }}>{a.icon}</span>
                            <span className="znhd-panel-btn-text" style={{ fontSize: 11, marginLeft: 2 }}>
                                {a.label}
                            </span>
                        </Button>
                    </Tooltip>
                ))}
            </div>

            {/* 底部：上次播报 + 查看日志 */}
            <div
                style={{
                    marginTop: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 12,
                    color: '#8c8c8c',
                }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {lastSpeakText(mon.lastSpeak)}
                </span>
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setLogOpen(true)}>
                    查看日志 →
                </Button>
            </div>

            <SettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onOpenChangelog={() => setChangelogOpen(true)}
                workingHours={Allvalue.workingHours}
                onChangeWorkingHours={(wh: Allvalue['workingHours']) => {
                    patchAllvalue({ workingHours: wh });
                    addLog(
                        '监控时间段已更新：上午 ' +
                            hoursToHHmm(wh.morningStart) +
                            '-' +
                            hoursToHHmm(wh.morningEnd) +
                            '，下午 ' +
                            hoursToHHmm(wh.afternoonStart) +
                            '-' +
                            hoursToHHmm(wh.afternoonEnd),
                        'info'
                    );
                }}
                commonPhrasesUrl={Allvalue.commonPhrasesUrl}
                onChangeCommonPhrasesUrl={(url: string) => {
                    patchAllvalue({ commonPhrasesUrl: url });
                    addLogDebounced('commonPhrasesUrl', '常用语数据源已更新: ' + url, 'info');
                }}
                relayServer={Allvalue.relayServer || ''}
                onChangeRelayServer={(url: string) => {
                    patchAllvalue({ relayServer: url });
                    addLogDebounced('relayServer', '中继服务器已更新: ' + (url || '（空）'), 'info');
                }}
                useCdn={Allvalue.useCdn}
                onChangeUseCdn={(v: boolean) => {
                    patchAllvalue({ useCdn: !!v });
                    addLog('CDN 加速已' + (v ? '开启' : '关闭'), 'info');
                }}
            />

            <PhrasesDrawer
                open={phrasesOpen}
                onClose={() => setPhrasesOpen(false)}
                phrasesData={phrasesData}
                phrasesLoading={phrasesLoading}
                searchKeyword={searchKeyword}
                setSearchKeyword={setSearchKeyword}
                loadPhrasesData={loadPhrasesData}
                commonPhrasesUrl={Allvalue.commonPhrasesUrl}
            />

            <PhoneModal
                open={phoneOpen}
                onClose={() => setPhoneOpen(false)}
                relayServer={Allvalue.relayServer || ''}
                onChangeRelayServer={(url: string) => {
                    patchAllvalue({ relayServer: url });
                    addLogDebounced('relayServer', '中继服务器已更新: ' + (url || '（空）'), 'info');
                }}
            />

            <LogModal
                open={logOpen}
                onClose={() => setLogOpen(false)}
                logEntries={logEntries}
                onClear={clearLogs}
                autoRefresh={!!Allvalue.logAutoRefresh}
                onAutoRefreshChange={(v) => {
                    // 只改设置、不写日志：这是「看日志的方式」，不是被监控的业务动作，
                    // 记一条日志反而会在冻结列表时制造困惑。
                    patchAllvalue({ logAutoRefresh: !!v });
                }}
            />

            <ChangelogModal open={changelogOpen} onClose={() => setChangelogOpen(false)} />

            <RecvGalleryModal
                open={galleryOpen}
                onClose={() => setGalleryOpen(false)}
                images={recvImages}
                onRemove={(idx) =>
                    setRecvImages((prev) => {
                        const next = prev.slice();
                        const removed = next.splice(idx, 1)[0];
                        if (removed) {
                            try {
                                URL.revokeObjectURL(removed.previewUrl);
                            } catch (e) {
                                /* 忽略 */
                            }
                        }
                        return next;
                    })
                }
                onClear={() =>
                    setRecvImages((prev) => {
                        prev.forEach((it) => {
                            try {
                                URL.revokeObjectURL(it.previewUrl);
                            } catch (e) {
                                /* 忽略 */
                            }
                        });
                        return [];
                    })
                }
            />

            <RecvTextModal text={recvText} onClose={() => setRecvText(null)} />
        </Card>
    );
}
