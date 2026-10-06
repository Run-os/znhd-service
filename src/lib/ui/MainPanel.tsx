import { useEffect, useRef, useState } from 'react';
import { Button, Card, Space, Switch } from 'antd';
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
import { usePanelDrag } from '@/lib/ui/panelHost';
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
    return <img src={BRAND_ICON} alt="" style={{ ...box, display: 'block' }} onError={() => setFailed(true)} />;
}

/** 面板宽度（位置存档的边界裁剪按它估算） */
const PANEL_WIDTH = 340;

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
 * 版式对齐参考图：头部（图标+标题+版本+收起）、人数/状态卡、语音开关行、2×2 按钮、底部「查看日志」。
 */
export default function MainPanel({ host }: MainPanelProps) {
    const drag = usePanelDrag(host);

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

    // 收起：只留一个圆形按钮，避免「关掉就再也找不回来」
    if (collapsed) {
        return (
            <Button
                shape="circle"
                color="primary"
                variant="solid"
                title="展开监控面板"
                onClick={() => setCollapsed(false)}
                style={{ width: 36, height: 36, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}>
                <BrandIcon size={20} />
            </Button>
        );
    }

    return (
        <Card
            size="small"
            style={{ width: PANEL_WIDTH, boxShadow: '0 6px 24px rgba(0,0,0,0.18)' }}
            styles={{ body: { padding: 12 }, header: { padding: '8px 10px', minHeight: 46 } }}
            title={
                // 标题栏 = 拖拽手柄（唯一可抓取区）
                <div
                    {...drag}
                    style={{
                        cursor: 'move',
                        userSelect: 'none',
                        touchAction: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                    }}
                    title="按住拖动面板">
                    <BrandIcon />
                    <span style={{ fontWeight: 700, fontSize: 15 }}>征纳互动监控</span>
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

            {/* 2×2 按钮 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Button color="primary" variant="solid" size="large" onClick={() => setSettingsOpen(true)}>
                    ⚙️ 设置
                </Button>
                <Button size="large" onClick={() => setPhrasesOpen(true)}>
                    💬 常用语
                </Button>
                <Button
                    size="large"
                    onClick={() => {
                        if (!recvImages.length) {
                            notify.info('暂无待存文件');
                            return;
                        }
                        setGalleryOpen(true);
                    }}>
                    🖼️ 历史文件
                </Button>
                <Button size="large" onClick={() => setPhoneOpen(true)}>
                    💻 设备互联
                </Button>
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

            <LogModal open={logOpen} onClose={() => setLogOpen(false)} logEntries={logEntries} onClear={clearLogs} />

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
