/**
 * 主面板组件（原 app.ts 的 MainPanel）：语音开关、设置/常用语/历史文件/设备互联入口与各抽屉装配。
 * 模块化 P5：逐字迁移，仅加 export；phrasesRequestSeq 随 loadPhrasesData 一并搬来。
 */

import { DEFAULTS, PHRASES_CACHE_TTL } from '@/lib/constants';
import { addLog, addLogDebounced, setLogEntriesSink, clearLogs } from '@/lib/logger';
import { loadPanelPoint, loadPhrasesCache, savePhrasesCache, saveAllvalue } from '@/lib/storage';
import { runtime } from '@/lib/state';
import { resolveGithubUrl, hoursToHHmm } from '@/lib/utils';
import { getDeviceId, startPhoneReceive } from '@/lib/relay';
import { receivedImages, showImagePopup, renderImageGallery, showTextPopup } from '@/lib/gallery';
import { clearSpeechQueue } from '@/lib/speech';
import { SettingsDrawer } from '@/lib/ui/SettingsDrawer';
import { CommonPhrasesDrawer } from '@/lib/ui/CommonPhrasesDrawer';
import { PhoneImageDrawer } from '@/lib/ui/PhoneImageDrawer';
import { LogDrawer } from '@/lib/ui/LogDrawer';

// 常用语请求序号（loadPhrasesData 用）：仅最新一次请求可落地结果，防慢的旧响应后到覆盖新数据
let phrasesRequestSeq = 0;

export function MainPanel() {
    // 使用加载的数据初始化Allvalue
    // 惰性初始化：useState(loadAllvalue()) 的实参每次渲染都会求值，而本组件因 logEntries
    // 每 3 秒+ 就重渲染一次，等于反复白读 localStorage + JSON.parse。顶层 runtime.init
    // 已是启动时读好的同一份数据（本会话内设置改动都会同步写回它）。
    const [Allvalue, setAllvalue] = CAT_UI.useState(() => runtime.init);

    // 包装setAllvalue函数，实现自动保存
    const updateAllvalue = (newValue: any) => {
        setAllvalue(newValue);
        // 自动保存到localStorage
        saveAllvalue(newValue);
        // 同步更新语音状态缓存
        runtime.voiceEnabled = newValue.voiceEnabled;
        // 同步更新监控时间段缓存
        runtime.workingHours = newValue.workingHours;
        // 同步更新常用语数据源缓存
        runtime.commonPhrasesUrl = newValue.commonPhrasesUrl;
        // 同步更新 CDN 加速开关缓存
        runtime.useCdn = !!newValue.useCdn;
    };
    const patchAllvalue = (kv: any) => updateAllvalue({ ...Allvalue, ...kv });

    // 解构状态变量，方便后续使用
    const { voiceEnabled } = Allvalue;

    const voiceEnabledText = voiceEnabled ? '🔊 语音' : '🔇 静音';

    // 设置抽屉显示状态管理
    const [visible, setVisible] = CAT_UI.useState(false);
    // 常用语抽屉显示状态管理
    const [commonPhrasesVisible, setCommonPhrasesVisible] = CAT_UI.useState(false);
    // 设备互联抽屉显示状态
    const [phoneVisible, setPhoneVisible] = CAT_UI.useState(false);
    // 日志抽屉显示状态（v26.10.06-v8：从设置抽屉独立出来）
    const [logVisible, setLogVisible] = CAT_UI.useState(false);
    // 设备互联自动接收的停止函数（用 ref 避免重复启动）
    const receiveStopRef = CAT_UI.useRef(null);
    // 日志条目状态管理
    const [logEntries, setLogEntries] = CAT_UI.useState([]);
    // 常用语数据状态管理
    const [phrasesData, setPhrasesData] = CAT_UI.useState({});
    // 常用语加载状态
    const [phrasesLoading, setPhrasesLoading] = CAT_UI.useState(false);
    // 常用语搜索关键字状态管理
    const [searchKeyword, setSearchKeyword] = CAT_UI.useState('');

    // 设置日志回调函数
    CAT_UI.useEffect(() => {
        setLogEntriesSink(setLogEntries);
        return () => {
            setLogEntriesSink(null);
        };
    }, []);

    // 脚本启动日志：首次挂载时输出一次到设置面板日志窗口
    CAT_UI.useEffect(() => {
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
        const savedPoint = loadPanelPoint();
        addLog(
            savedPoint
                ? '面板位置：已恢复上次位置 (' + Math.round(savedPoint.x) + ', ' + Math.round(savedPoint.y) + ')'
                : '面板位置：使用默认位置',
            'info'
        );
    }, []);

    // 加载常用语数据的函数
    // force=true 时强制刷新（忽略缓存），如点击「重新加载」按钮；否则命中有效缓存则跳过网络请求
    const loadPhrasesData = (force = false) => {
        // 非强制刷新：命中 2 小时内的有效缓存（URL 一致）则直接复用本地数据，不发请求
        if (!force) {
            const cache = loadPhrasesCache();
            if (cache && cache.url === runtime.commonPhrasesUrl && Date.now() - cache.time < PHRASES_CACHE_TTL) {
                setPhrasesData(cache.data || {}); // 防 cache.data 为 undefined/null（历史上可能存过空值）
                const mins = Math.round((Date.now() - cache.time) / 60000);
                addLog('常用语使用本地缓存（' + mins + ' 分钟前加载），已跳过网络请求', 'info');
                // 缓存命中不弹成功 toast（每次开抽屉都弹会打扰；日志已说明，仅新加载时提示）
                return;
            }
        }
        const seq = ++phrasesRequestSeq; // 请求序号：仅最新一次请求可落地结果，防旧响应后到覆盖新数据
        setPhrasesLoading(true);
        GM_xmlhttpRequest({
            method: 'GET',
            // 存值被清空时回退 DEFAULTS 默认直链，避免「空地址」静默失败（旧逻辑此处直接用可能为空的缓存值）
            url: resolveGithubUrl(runtime.commonPhrasesUrl || DEFAULTS.commonPhrasesUrl),
            timeout: 15000, // raw.githubusercontent 在国内常被黑洞，无超时会让 phrasesLoading 永久卡 true
            onload: function (response) {
                if (seq !== phrasesRequestSeq) return; // 已过期请求（期间又发起了新加载），丢弃
                try {
                    // HTTP 状态 + 类型双重校验：404/错误页的纯文本可能是「合法 YAML」（标量/键值对），
                    // 直接 setPhrasesData 会渲染垃圾按钮并把垃圾写进 2h 缓存（v26.9.6-v7 起因）；
                    // 必须 200 且解析结果是「纯键值对象」才算成功。
                    if (response.status !== 200) throw new Error('数据源返回 HTTP ' + response.status);
                    const data = jsyaml.load(response.responseText);
                    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                        throw new Error('数据源不是有效的键值对象（可能返回了网页/错误页）');
                    }
                    setPhrasesData(data);
                    savePhrasesCache(runtime.commonPhrasesUrl, data);
                    addLog('常用语加载成功，共 ' + Object.keys(data).length + ' 条', 'success');
                    CAT_UI.Message.success('常用语加载成功');
                } catch (error) {
                    // 失败时保留已加载的旧数据（若有），用户仍可用；仅提示失败原因
                    const hasOld = Object.keys(phrasesData).length > 0;
                    addLog(
                        '常用语加载失败: ' + error.message + (hasOld ? '，仍显示上次加载的内容' : ''),
                        'error',
                        true
                    );
                    CAT_UI.Message.error('常用语加载失败' + (hasOld ? '，仍显示上次内容' : ''));
                } finally {
                    setPhrasesLoading(false);
                }
            },
            onerror: function (error: any) {
                if (seq !== phrasesRequestSeq) return;
                // 统一处理 error 参数（可能是 Error 对象、字符串或事件）
                const errMsg = error && error.message ? error.message : typeof error === 'string' ? error : '网络错误';
                // 网络失败时保留已加载的旧数据（若有），断网/服务器故障期间仍可使用上次的常用语
                const hasOld = Object.keys(phrasesData).length > 0;
                addLog('加载常用语失败: ' + errMsg + (hasOld ? '，仍显示上次加载的内容' : ''), 'error', true);
                CAT_UI.Message.error('加载常用语失败' + (hasOld ? '，仍显示上次内容' : ''));
                setPhrasesLoading(false);
            },
            ontimeout: function () {
                if (seq !== phrasesRequestSeq) return;
                // 请求挂起超时（如数据源被墙/无响应）：同样复位 loading、保留旧数据，抽屉可再次点重载
                const hasOld = Object.keys(phrasesData).length > 0;
                addLog('加载常用语超时（15s），已取消' + (hasOld ? '，仍显示上次加载的内容' : ''), 'error', true);
                CAT_UI.Message.error('常用语加载超时' + (hasOld ? '，仍显示上次内容' : ''));
                setPhrasesLoading(false);
            },
        });
    };

    // 常用语抽屉打开时自动加载数据
    CAT_UI.useEffect(() => {
        if (commonPhrasesVisible) {
            loadPhrasesData();
        }
    }, [commonPhrasesVisible]);

    // 设备互联：中继服务器地址填好后，默认自动开始接收（无需点击按钮）
    // 收到图片即弹出网页居中的预览弹窗（含复制 / 关闭按钮，见 showImagePopup）
    CAT_UI.useEffect(() => {
        const s = (Allvalue.relayServer || '').trim().replace(/\/+$/, '');
        // 门控 + 防抖：设置里逐字输入时 relayServer 连续变化，立即启停会造成无效轮询抖动；
        // 仅当地址以 http(s):// 开头且停顿 800ms 未再变化时才（重新）开始接收。
        if (!s || !/^https?:\/\//i.test(s)) return;
        const timer = setTimeout(() => {
            if (receiveStopRef.current) return; // 已在接收，避免重复启动
            // 「已自动开始接收」日志在脚本**连上服务器时立即**显示（见 startPhoneReceive 的 onConnected，
            // 由首次 /recv 短轮询确认触发，约 1 秒内），不等待手机端发送图片。地址末尾的 / 已在上面归一。
            const stop = startPhoneReceive({
                server: s,
                uuid: getDeviceId(),
                onConnected: () => {
                    addLog('[设备互联] 已自动开始接收（' + s + '）', 'info');
                },
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

    // =========主UI布局==========

    return CAT_UI.Space(
        [
            CAT_UI.Space(
                [
                    CAT_UI.Text('语音播报状态: '),
                    CAT_UI.Button(voiceEnabledText, {
                        type: 'primary',
                        onClick: () => {
                            const newVoiceEnabled = !voiceEnabled;
                            patchAllvalue({ voiceEnabled: newVoiceEnabled });
                            addLog('语音播报已' + (newVoiceEnabled ? '开启' : '静音'), 'info');

                            // 启用语音时，初始化语音合成（解决浏览器not-allowed限制）
                            if (newVoiceEnabled && 'speechSynthesis' in window) {
                                // 播放一个静默语音来激活语音功能
                                const testUtterance = new SpeechSynthesisUtterance('');
                                window.speechSynthesis.speak(testUtterance);
                                CAT_UI.Message.success('语音功能已启用');
                            } else if (!newVoiceEnabled) {
                                // 关闭语音：立即清空队列，防止旧消息堆积、再次开启时集中涌出
                                clearSpeechQueue();
                            }
                        },
                        // 动态样式：根据静音状态切换颜色
                        style: {
                            fontWeight: 'bold',
                            backgroundColor: !voiceEnabled ? '#990018' : '#007e44',
                            borderColor: !voiceEnabled ? '#990018' : '#007e44',
                        },
                    }),
                ],
                {
                    direction: 'horizontal',
                    size: 'middle',
                    style: { marginBottom: '8px' },
                }
            ),
            CAT_UI.Space(
                [
                    CAT_UI.Space(
                        [
                            CAT_UI.Button('设置', {
                                type: 'primary',
                                onClick: () => setVisible(true),
                            }),
                            CAT_UI.Button('常用语', {
                                type: 'primary',
                                onClick() {
                                    setCommonPhrasesVisible(true);
                                },
                            }),
                            // 日志入口（紧挨「常用语」，与它同级；v26.10.06-v8 起日志独立成抽屉）
                            CAT_UI.Button('日志', {
                                type: 'primary',
                                onClick() {
                                    setLogVisible(true);
                                },
                            }),
                        ],
                        {
                            direction: 'horizontal',
                            size: 'middle',
                        }
                    ),
                    CAT_UI.Space(
                        [
                            CAT_UI.Button('历史文件', {
                                type: 'primary',
                                onClick: () => {
                                    if (!receivedImages.length) {
                                        CAT_UI.Message.info('暂无待存文件');
                                        return;
                                    }
                                    renderImageGallery();
                                },
                            }),
                            CAT_UI.Button('设备互联', {
                                type: 'primary',
                                onClick: () => setPhoneVisible(true),
                            }),
                        ],
                        {
                            direction: 'horizontal',
                            size: 'middle',
                        }
                    ),
                ],
                {
                    direction: 'vertical',
                    size: 'small',
                }
            ),

            //抽屉
            CAT_UI.Space(
                [
                    CAT_UI.createElement(SettingsDrawer, {
                        visible,
                        setVisible,
                        workingHours: Allvalue.workingHours,
                        onChangeWorkingHours: (wh: any) => {
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
                        },
                        commonPhrasesUrl: Allvalue.commonPhrasesUrl,
                        onChangeCommonPhrasesUrl: (url: any) => {
                            patchAllvalue({ commonPhrasesUrl: url });
                            addLogDebounced('commonPhrasesUrl', '常用语数据源已更新: ' + url, 'info');
                        },
                        relayServer: Allvalue.relayServer || '',
                        onChangeRelayServer: (url: any) => {
                            patchAllvalue({ relayServer: url });
                            addLogDebounced('relayServer', '中继服务器已更新: ' + (url || '（空）'), 'info');
                        },
                        useCdn: Allvalue.useCdn,
                        onChangeUseCdn: (v: any) => {
                            patchAllvalue({ useCdn: !!v });
                            addLog('CDN 加速已' + (v ? '开启' : '关闭'), 'info');
                        },
                    }),
                    CAT_UI.createElement(CommonPhrasesDrawer, {
                        visible: commonPhrasesVisible,
                        setVisible: setCommonPhrasesVisible,
                        phrasesData,
                        setPhrasesData,
                        phrasesLoading,
                        setPhrasesLoading,
                        searchKeyword,
                        setSearchKeyword,
                        loadPhrasesData,
                        commonPhrasesUrl: Allvalue.commonPhrasesUrl,
                    }),
                    CAT_UI.createElement(PhoneImageDrawer, {
                        visible: phoneVisible,
                        setVisible: setPhoneVisible,
                        relayServer: Allvalue.relayServer || '',
                        onChangeRelayServer: (url: any) => {
                            patchAllvalue({ relayServer: url });
                            addLogDebounced('relayServer', '中继服务器已更新: ' + (url || '（空）'), 'info');
                        },
                    }),
                    // 日志抽屉：日志列表（含版本号文本）只在 visible 时才渲染，避免与面板版本号串台
                    CAT_UI.createElement(LogDrawer, {
                        visible: logVisible,
                        setVisible: setLogVisible,
                        logEntries,
                        onClear: clearLogs,
                    }),
                ],
                {
                    direction: 'horizontal',
                    size: 'middle',
                }
            ),
        ],
        { direction: 'vertical' }
    );
}
