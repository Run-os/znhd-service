import { useEffect, useRef, useState } from 'react';
import { App as AntApp, Button, Card, Space, Tag, Typography } from 'antd';
import { DEFAULTS, PHRASES_CACHE_TTL } from '@/lib/constants';
import { addLog, addLogDebounced, setLogEntriesSink, clearLogs } from '@/lib/logger';
import { loadPhrasesCache, savePhrasesCache, saveAllvalue } from '@/lib/storage';
import { runtime } from '@/lib/state';
import { resolveGithubUrl, hoursToHHmm } from '@/lib/utils';
import { getDeviceId, startPhoneReceive } from '@/lib/relay';
import { renderImageGallery, receivedImages, showImagePopup, showTextPopup } from '@/lib/gallery';
import { clearSpeechQueue } from '@/lib/speech';
import { notify } from '@/lib/ui/notify';
import { usePanelDrag } from '@/lib/ui/panelHost';
import SettingsModal from '@/lib/ui/SettingsModal';
import PhrasesModal from '@/lib/ui/PhrasesModal';
import PhoneModal from '@/lib/ui/PhoneModal';
import LogModal from '@/lib/ui/LogModal';

const { Text } = Typography;

// 常用语请求序号（loadPhrasesData 用）：仅最新一次请求可落地结果，防慢的旧响应后到覆盖新数据
let phrasesRequestSeq = 0;

/** 面板宽度（与旧 CAT_UI 面板一致，位置存档的边界裁剪按它估算） */
const PANEL_WIDTH = 320;

interface MainPanelProps {
    /** 面板宿主元素：拖拽时改写它的 left/top */
    host: HTMLElement;
}

/**
 * 主面板（v26.10.06-v9：由 CAT_UI 改写为 React + Ant Design）。
 * 逻辑逐字保留（装配/监控/常用语加载/设备互联自动接收），只替换渲染层与消息提示。
 */
export default function MainPanel({ host }: MainPanelProps) {
    const drag = usePanelDrag(host);

    // 惰性初始化：useState(loadAllvalue()) 的实参每次渲染都会求值，而本组件因 logEntries 频繁重渲染，
    // 等于反复白读 localStorage。顶层 runtime.init 已是启动时读好的同一份数据。
    const [Allvalue, setAllvalue] = useState<any>(() => runtime.init);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [phrasesOpen, setPhrasesOpen] = useState(false);
    const [phoneOpen, setPhoneOpen] = useState(false);
    const [logOpen, setLogOpen] = useState(false);
    const [logEntries, setLogEntries] = useState<any[]>([]);
    const [phrasesData, setPhrasesData] = useState<Record<string, string>>({});
    const [phrasesLoading, setPhrasesLoading] = useState(false);
    const [searchKeyword, setSearchKeyword] = useState('');
    const receiveStopRef = useRef<null | (() => void)>(null);

    const updateAllvalue = (newValue: any) => {
        setAllvalue(newValue);
        saveAllvalue(newValue);
        runtime.voiceEnabled = newValue.voiceEnabled;
        runtime.workingHours = newValue.workingHours;
        runtime.commonPhrasesUrl = newValue.commonPhrasesUrl;
        runtime.useCdn = !!newValue.useCdn;
    };
    const patchAllvalue = (kv: any) => updateAllvalue({ ...Allvalue, ...kv });

    const { voiceEnabled } = Allvalue;
    const voiceEnabledText = voiceEnabled ? '🔊 语音' : '🔇 静音';

    // 日志写入回调
    useEffect(() => {
        setLogEntriesSink(setLogEntries as any);
        return () => setLogEntriesSink(null);
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
        // 面板位置由宿主自行恢复，这里只记录一句便于排查
        addLog('面板位置：已恢复/使用默认位置', 'info');
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
            onerror: function (error: any) {
                if (seq !== phrasesRequestSeq) return;
                const errMsg = error && error.message ? error.message : typeof error === 'string' ? error : '网络错误';
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
                onImage: (img: any) => {
                    addLog(
                        '[设备互联] 收到图片：' + (img.name || 'image') + '（' + (img.mime || 'image') + '）',
                        'success'
                    );
                    showImagePopup(img);
                },
                onText: (txt: any) => {
                    const t = (txt.text || '').replace(/\s+$/, '');
                    addLog('[设备互联] 收到文本：' + (t.length > 40 ? t.slice(0, 40) + '…' : t), 'success');
                    showTextPopup(txt);
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

    const toggleVoice = () => {
        const next = !voiceEnabled;
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

    return (
        <Card
            size="small"
            style={{ width: PANEL_WIDTH, boxShadow: '0 4px 16px rgba(0,0,0,0.18)' }}
            styles={{ body: { padding: 12 } }}
            title={
                // 标题栏 = 拖拽手柄（唯一可抓取区）
                <div {...drag} style={{ cursor: 'move', userSelect: 'none', touchAction: 'none' }} title="按住拖动面板">
                    <Space size={6}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>征纳互动监控</span>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            v{GM_info.script.version}
                        </Text>
                    </Space>
                </div>
            }>
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Space size={8}>
                    <Text style={{ fontSize: 13 }}>语音播报状态:</Text>
                    <Button
                        onClick={toggleVoice}
                        style={{
                            fontWeight: 'bold',
                            backgroundColor: voiceEnabled ? '#007e44' : '#990018',
                            borderColor: voiceEnabled ? '#007e44' : '#990018',
                            color: '#fff',
                        }}>
                        {voiceEnabledText}
                    </Button>
                </Space>

                <Space size={8} wrap>
                    <Button color="primary" variant="solid" onClick={() => setSettingsOpen(true)}>
                        设置
                    </Button>
                    <Button color="primary" variant="solid" onClick={() => setPhrasesOpen(true)}>
                        常用语
                    </Button>
                    <Button color="primary" variant="solid" onClick={() => setLogOpen(true)}>
                        日志
                    </Button>
                    <Button
                        color="primary"
                        variant="solid"
                        onClick={() => {
                            if (!receivedImages.length) {
                                notify.info('暂无待存文件');
                                return;
                            }
                            renderImageGallery();
                        }}>
                        历史文件
                    </Button>
                    <Button color="primary" variant="solid" onClick={() => setPhoneOpen(true)}>
                        设备互联
                    </Button>
                </Space>
            </Space>

            <SettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                workingHours={Allvalue.workingHours}
                onChangeWorkingHours={(wh: any) => {
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

            <PhrasesModal
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
        </Card>
    );
}
