// ==UserScript==
// @name           征纳互动人数和在线监控v2
// @namespace      https://scriptcat.org/
// @description    实时监控征纳互动等待人数和在线状态，支持语音播报、自定义常用语
// @version        26.7.18-v2
// @author         runos
// @match          https://znhd.hunan.chinatax.gov.cn:8443/*
// @match          https://example.com/*
// @icon           https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico
// @grant          GM_addStyle
// @grant          unsafeWindow
// @grant          GM_xmlhttpRequest
// @grant          GM_setClipboard
// @grant          GM_notification
// @grant          GM_getValue
// @grant          GM_setValue
// @connect        *
// @connect        znhd-service.zeabur.app
// @connect        122050.xyz
// @connect        drop.122050.xyz
// @homepageURL    https://scriptcat.org/zh-CN/script-show-page/3650
// @updateURL      https://gitee.com/runos/znhd-service/raw/master/znhd.user.js
// @downloadURL    https://gitee.com/runos/znhd-service/raw/master/znhd.user.js
// @require        https://scriptcat.org/lib/1167/1.0.0/%E8%84%9A%E6%9C%AC%E7%8C%ABUI%E5%BA%93.js?sha384-jXdR3hCwnDJf53Ue6XHAi6tApeudgS/wXnMYBD/ZJcgge8Xnzu/s7bkEf2tPi2KS
// @require        https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@5/dist/fp.min.js
// @require        https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js
// ==/UserScript==

(function () {
    'use strict';

    // ==========配置==========
    // 配置对象，集中管理可配置项
    const CONFIG = {
        CHECK_INTERVAL: 3000,
        MAX_LOG_ENTRIES: 20,
        didaUrl: 'https://gitee.com/runos/znhd-service/raw/master/public/dida.mp3',
        commonPhrasesUrl: 'https://gitee.com/runos/znhd-service/raw/master/public/commonPhrases.yaml',
        // 语音播报超时保护（毫秒），防止 onend/onerror 不触发导致队列卡死
        SPEECH_TIMEOUT: 15000,
    };

    // ==========日志管理==========
    // 全局日志状态管理
    let setLogEntriesCallback = null;
    // 存储上一次的日志文本（用于重复内容检测）
    let lastLogMessage = null;

    // 添加日志条目函数
    function addLog(message, type = 'info', logenabled = false) {
        const timestamp = new Date().toTimeString().slice(0, 8);

        // 检查是否为重复内容
        if (lastLogMessage && message === lastLogMessage) {
            // 如果内容相同，不输出本次内容
            console.log('[监控] 重复日志，已忽略:', message);
            return;
        }

        // 更新上一次的日志文本
        lastLogMessage = message;

        const logItem = { timestamp, message, type };

        // 更新React状态
        if (setLogEntriesCallback) {
            setLogEntriesCallback(prevEntries => {
                const newEntries = [logItem, ...prevEntries];
                if (newEntries.length > CONFIG.MAX_LOG_ENTRIES) {
                    newEntries.pop();
                }
                return newEntries;
            });
        }
        if (logenabled) {
            console.log(`[监控] ${timestamp} ${message}`);
        }
    }

    // ==========存储管理==========
    // 存储键名
    const STORAGE_KEY = 'scriptCat_Allvalue';
    // 面板位置单独存储（与设置数据解耦，避免拖拽频繁写入设置）
    const PANEL_POINT_KEY = 'scriptCat_PanelPoint';
    const DEFAULTS = {
        voiceEnabled: true,
        // 监控时间段（单位：小时，可含小数，如 13.5 表示 13:30）
        workingHours: {
            morningStart: 9,
            morningEnd: 12,
            afternoonStart: 13.5,
            afternoonEnd: 18
        }
    };

    // 读取面板保存的位置（无记录返回 null，由调用方兜底默认坐标）
    function loadPanelPoint() {
        try {
            const saved = localStorage.getItem(PANEL_POINT_KEY);
            if (saved) {
                const p = JSON.parse(saved);
                if (typeof p.x === 'number' && typeof p.y === 'number') {
                    return p;
                }
            }
        } catch (error) {
            addLog('读取面板位置失败: ' + error.message, 'error', true);
        }
        return null;
    }

    // 保存面板位置（带防抖，避免拖拽过程中高频写 localStorage）
    let _savePointTimer = null;
    function savePanelPoint(point) {
        if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') return;
        if (_savePointTimer) return; // 已计划在下一帧保存，跳过重复
        _savePointTimer = requestAnimationFrame(() => {
            _savePointTimer = null;
            try {
                localStorage.setItem(PANEL_POINT_KEY, JSON.stringify({
                    x: Math.round(point.x),
                    y: Math.round(point.y)
                }));
            } catch (error) {
                addLog('保存面板位置失败: ' + error.message, 'error', true);
            }
        });
    }

    // 从localStorage加载Allvalue数据
    function loadAllvalue() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                return { ...DEFAULTS, ...parsed };
            }
        } catch (error) {
            addLog('加载存储数据失败: ' + error.message, 'error', true);
        }
        // 返回默认值
        return { ...DEFAULTS };
    }

    // 保存Allvalue数据到localStorage
    function saveAllvalue(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            addLog('数据已保存到localStorage', 'success', true);
        } catch (error) {
            addLog('保存数据失败: ' + error.message, 'error', true);
            CAT_UI.Message.error('保存设置失败: ' + error.message);
        }
    }

    // ==========语音状态缓存==========
    // 缓存语音启用状态，避免每次播报都读取 localStorage
    let cachedVoiceEnabled = loadAllvalue().voiceEnabled;

    // 缓存监控时间段，避免每次轮询都读取 localStorage
    let cachedWorkingHours = loadAllvalue().workingHours;

    // ==========工具函数==========
    // HTML 转义函数（复用单个 div 元素，避免重复创建）
    const _escapeHelper = document.createElement('div');
    function escapeHtml(text) {
        _escapeHelper.textContent = text;
        return _escapeHelper.innerHTML;
    }

    // 十进制小时(如 13.5) 与 "HH:mm" 字符串互转，供时间选择器使用
    function hoursToHHmm(h) {
        if (typeof h !== 'number' || isNaN(h)) return '00:00';
        let total = Math.round(h * 60);
        if (total < 0) total = 0;
        if (total > 24 * 60) total = 24 * 60;
        const H = Math.floor(total / 60) % 24;
        const M = total % 60;
        return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0');
    }
    function hhmmToHours(str) {
        if (typeof str !== 'string') return null;
        const m = /^(\d{1,2}):(\d{2})$/.exec(str.trim());
        if (!m) return null;
        const H = parseInt(m[1], 10);
        const M = parseInt(m[2], 10);
        if (H < 0 || H > 23 || M < 0 || M > 59) return null;
        return H + M / 60;
    }

    // ==========UI部分==========
    // 日志面板组件
    function LogPanel({ logEntries }) {
        // 根据日志类型定义颜色
        const colorMap = {
            info: "#1890ff",      // 蓝色
            warning: "#faad14",   // 橙黄色
            success: "#52c41a",   // 绿色
            error: "#ff4d4f"      // 红色
        };

        return CAT_UI.createElement(
            "div",
            {
                style: {
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: "500px",
                    overflowY: "auto",
                    backgroundColor: "#f5f5f5",
                    padding: "10px",
                    borderRadius: "4px",
                    fontFamily: "monospace",
                    fontSize: "12px"
                }
            },
            logEntries.map((entry, index) => {
                const color = colorMap[entry.type] || "#333333";
                return CAT_UI.createElement(
                    "div",
                    {
                        key: index,
                        style: {
                            color: color,
                            marginBottom: "4px",
                            borderLeft: `3px solid ${color}`,
                            paddingLeft: "8px",
                            fontWeight: "bold"
                        }
                    },
                    `${entry.timestamp} - ${entry.message}`
                );
            })
        );
    }

    // 设置抽屉组件
    function SettingsDrawer({ visible, setVisible, logEntries, workingHours, onChangeWorkingHours }) {
        // 当前监控时间段（兜底默认值，避免未配置时报错）
        const wh = workingHours || { morningStart: 9, morningEnd: 12, afternoonStart: 13.5, afternoonEnd: 18 };
        // 更新单个时间段字段（入参为十进制小时）
        const updateWh = (field, dec) => {
            if (typeof dec !== 'number' || isNaN(dec)) return;
            onChangeWorkingHours({ ...wh, [field]: dec });
        };
        // 时间选择器 onChange 兼容：CAT_UI 未导出 TimePicker，此处用原生 <input type="time">，
        // 其 onChange 回传原生事件（val.target.value 为 "HH:mm"）；同时兼容 arco 的 (val, str) 形式
        const onTimeChange = (field) => (val, str) => {
            let s;
            if (val && val.target && typeof val.target.value === 'string') {
                s = val.target.value;                 // 原生 <input type="time">
            } else if (typeof str === 'string') {
                s = str;                              // arco (dayjsValue, timeString)
            } else if (val && typeof val.format === 'function') {
                s = val.format('HH:mm');
            } else if (typeof val === 'string') {
                s = val;
            } else {
                s = '';
            }
            const dec = hhmmToHours(s);
            if (dec !== null) updateWh(field, dec);
        };

        return CAT_UI.Drawer(
            CAT_UI.createElement("div", { style: { textAlign: "left" } }, [
                CAT_UI.Space(
                    [
                        CAT_UI.Button("[脚本主页]", {
                            type: "link",
                            onClick: () => {
                                window.open('https://scriptcat.org/zh-CN/script-show-page/3650', '_blank');
                            },
                            style: {
                                padding: "0 8px",
                                color: "#1890ff", fontWeight: "bold"
                            }
                        }),
                        CAT_UI.Button("[更新脚本]", {
                            type: "link",
                            onClick: () => {
                                window.open(GM_info.scriptUpdateURL || GM_info.script.updateURL, '_blank');
                            },
                            style: {
                                padding: "0 8px",
                                color: "#1890ff", fontWeight: "bold"
                            }
                        }),
                    ],
                    { direction: "horizontal", size: "small" }
                ),
                CAT_UI.Divider("注意事项"),
                CAT_UI.createElement(
                    "p",
                    {
                        style: {
                            marginBottom: "16px",
                            color: "#666",
                            lineHeight: "1.6",
                            textAlign: "left",
                            whiteSpace: "pre-line"
                        }
                    },
                    "1. 🔘[使用教程]里面可查看脚本详细介绍\n",
                ),
                CAT_UI.Divider("其他设置"),
                // 监控时间段配置（使用时间选择器）
                CAT_UI.Text("监控时间段（点击选择时间）", {
                    style: { display: "block", marginBottom: "8px", fontWeight: "bold" }
                }),
                CAT_UI.Space(
                    [
                        CAT_UI.Text("上午"),
                        CAT_UI.Input({ type: "time", value: hoursToHHmm(wh.morningStart), onChange: onTimeChange('morningStart'), style: { width: "110px" } }),
                        CAT_UI.Text("至"),
                        CAT_UI.Input({ type: "time", value: hoursToHHmm(wh.morningEnd), onChange: onTimeChange('morningEnd'), style: { width: "110px" } }),
                    ],
                    { direction: "horizontal", size: "small", style: { marginBottom: "8px", flexWrap: "wrap" } }
                ),
                CAT_UI.Space(
                    [
                        CAT_UI.Text("下午"),
                        CAT_UI.Input({ type: "time", value: hoursToHHmm(wh.afternoonStart), onChange: onTimeChange('afternoonStart'), style: { width: "110px" } }),
                        CAT_UI.Text("至"),
                        CAT_UI.Input({ type: "time", value: hoursToHHmm(wh.afternoonEnd), onChange: onTimeChange('afternoonEnd'), style: { width: "110px" } }),
                    ],
                    { direction: "horizontal", size: "small", style: { marginBottom: "8px", flexWrap: "wrap" } }
                ),
                CAT_UI.createElement(
                    "p",
                    { style: { margin: "0 0 8px", color: "#999", fontSize: "12px", lineHeight: "1.5" } },
                    "提示：将「下午开始」设为与「上午结束」相同（如都设为 12:00），即可午休时段也监控。"
                ),
                CAT_UI.Divider("日志内容"),
                CAT_UI.createElement(LogPanel, { logEntries }),
            ]),
            {
                title: "设置菜单",
                visible,
                width: 400,
                focusLock: true,
                autoFocus: false,
                zIndex: 10000,
                onOk: () => { setVisible(false); },
                onCancel: () => { setVisible(false); },
            }
        );
    }

    // 常用语抽屉组件
    function CommonPhrasesDrawer({
        visible,
        setVisible,
        phrasesData,
        setPhrasesData,
        phrasesLoading,
        setPhrasesLoading,
        searchKeyword,
        setSearchKeyword,
        loadPhrasesData
    }) {
        return CAT_UI.Drawer(
            CAT_UI.createElement("div", { style: { textAlign: "left" } }, [
                // 显示当前数据源
                CAT_UI.createElement(
                    "div",
                    {
                        style: {
                            marginBottom: "16px",
                            color: "#666",
                            fontSize: "12px",
                            wordBreak: "break-all"
                        }
                    },
                    `数据源: ${decodeURIComponent(CONFIG.commonPhrasesUrl)}`
                ),
                // 重新加载按钮
                CAT_UI.Button("重新加载常用语", {
                    type: "primary",
                    loading: phrasesLoading,
                    onClick: loadPhrasesData,
                    style: { marginBottom: "16px", width: "100%" }
                }),
                // 搜索框
                CAT_UI.Input({
                    placeholder: "搜索常用语(按键名称或内容)",
                    value: searchKeyword,
                    onChange: setSearchKeyword,
                    allowClear: true,
                    style: { marginBottom: "16px", width: "100%" }
                }),
                // 动态生成常用语按钮
                phrasesLoading ?
                    CAT_UI.createElement("div", { style: { textAlign: "center", padding: "20px" } }, "加载中...") :
                    (Object.keys(phrasesData).length === 0 ?
                        CAT_UI.createElement("div", { style: { textAlign: "center", padding: "20px", color: "#999" } }, "暂无常用语数据，请点击上方按钮加载") :
                        (() => {
                            // 根据搜索关键字过滤常用语
                            const keyword = searchKeyword.trim().toLowerCase();
                            const filteredEntries = keyword ?
                                Object.entries(phrasesData).filter(([key, value]) =>
                                    String(key).toLowerCase().includes(keyword) ||
                                    String(value).toLowerCase().includes(keyword)
                                ) :
                                Object.entries(phrasesData);

                            return filteredEntries.length === 0 ?
                                CAT_UI.createElement("div", { style: { textAlign: "center", padding: "20px", color: "#999" } }, "没有匹配的常用语") :
                                CAT_UI.Space(
                                    filteredEntries.map(([key, value]) =>
                                        CAT_UI.Button(key, {
                                            type: "default",
                                            onClick() {
                                                safeCopyText(value);
                                                setVisible(false);
                                                appendToTinyMCE(value);
                                                addLog(`添加文本: ${value}`, 'success');
                                                CAT_UI.Message.success("添加文本: " + value);
                                            },
                                            style: { marginBottom: "8px", width: "100%" }
                                        })
                                    ),
                                    { direction: "vertical", style: { width: "100%" } }
                                );
                        })()
                    ),
                CAT_UI.Divider(""),
            ]),
            {
                title: "常用语",
                visible,
                width: 400,
                focusLock: true,
                autoFocus: false,
                zIndex: 10001,
                onOk: () => { setVisible(false); },
                onCancel: () => { setVisible(false); },
            }
        );
    }

    // 主抽屉/模态框组件
    function DM() {
        // 使用加载的数据初始化Allvalue
        const [Allvalue, setAllvalue] = CAT_UI.useState(loadAllvalue());

        // 包装setAllvalue函数，实现自动保存
        const updateAllvalue = (newValue) => {
            setAllvalue(newValue);
            // 自动保存到localStorage
            saveAllvalue(newValue);
            // 同步更新语音状态缓存
            cachedVoiceEnabled = newValue.voiceEnabled;
            // 同步更新监控时间段缓存
            cachedWorkingHours = newValue.workingHours;
        };
        const patchAllvalue = (kv) => updateAllvalue({ ...Allvalue, ...kv });

        // 解构状态变量，方便后续使用
        const { voiceEnabled } = Allvalue;

        const voiceEnabledText = voiceEnabled ? "🔊 语音" : "🔇 静音";

        // 设置抽屉显示状态管理
        const [visible, setVisible] = CAT_UI.useState(false);
        // 常用语抽屉显示状态管理
        const [commonPhrasesVisible, setCommonPhrasesVisible] = CAT_UI.useState(false);
        // 日志条目状态管理
        const [logEntries, setLogEntries] = CAT_UI.useState([]);
        // 常用语数据状态管理
        const [phrasesData, setPhrasesData] = CAT_UI.useState({});
        // 常用语加载状态
        const [phrasesLoading, setPhrasesLoading] = CAT_UI.useState(false);
        // 常用语搜索关键字状态管理
        const [searchKeyword, setSearchKeyword] = CAT_UI.useState("");

        // 设置日志回调函数
        CAT_UI.useEffect(() => {
            setLogEntriesCallback = setLogEntries;
            return () => {
                setLogEntriesCallback = null;
            };
        }, []);

        // 脚本启动日志：首次挂载时输出一次到设置面板日志窗口
        CAT_UI.useEffect(() => {
            addLog('脚本已启动，版本 v' + (GM_info.script.version || '?'), 'success');
            const wh = Allvalue.workingHours || cachedWorkingHours;
            if (wh) {
                addLog('监控时间段：上午 ' + hoursToHHmm(wh.morningStart) + '-' + hoursToHHmm(wh.morningEnd) +
                    '，下午 ' + hoursToHHmm(wh.afternoonStart) + '-' + hoursToHHmm(wh.afternoonEnd), 'info');
            }
            addLog('语音播报：' + (cachedVoiceEnabled ? '已开启' : '已静音'), 'info');
            const savedPoint = loadPanelPoint();
            addLog(savedPoint ? ('面板位置：已恢复上次位置 (' + Math.round(savedPoint.x) + ', ' + Math.round(savedPoint.y) + ')')
                : '面板位置：使用默认位置', 'info');
        }, []);

        // 加载常用语数据的函数
        const loadPhrasesData = () => {
            setPhrasesLoading(true);
            GM_xmlhttpRequest({
                method: 'GET',
                url: CONFIG.commonPhrasesUrl,
                onload: function (response) {
                    try {
                        const data = jsyaml.load(response.responseText);
                        setPhrasesData(data);
                        addLog('常用语加载成功，共 ' + Object.keys(data || {}).length + ' 条', 'success');
                        CAT_UI.Message.success('常用语加载成功');
                    } catch (error) {
                        addLog('YAML 解析失败: ' + error.message, 'error', true);
                        CAT_UI.Message.error('YAML 解析失败: ' + error.message);
                        setPhrasesData({});
                    } finally {
                        setPhrasesLoading(false);
                    }
                },
                onerror: function (error) {
                    // 统一处理 error 参数（可能是 Error 对象、字符串或事件）
                    const errMsg = (error && error.message) ? error.message
                        : (typeof error === 'string' ? error : '网络错误');
                    addLog('加载常用语失败: ' + errMsg, 'error', true);
                    CAT_UI.Message.error('加载常用语失败');
                    setPhrasesLoading(false);
                    setPhrasesData({});
                }
            });
        };

        // 常用语抽屉打开时自动加载数据
        CAT_UI.useEffect(() => {
            if (commonPhrasesVisible) {
                loadPhrasesData();
            }
        }, [commonPhrasesVisible]);

        // =========主UI布局==========

        return CAT_UI.Space(
            [
                CAT_UI.Space(
                    [
                        CAT_UI.Text("语音播报状态: "),
                        CAT_UI.Button(voiceEnabledText, {
                            type: "primary",
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
                                }
                            },
                            // 动态样式：根据静音状态切换颜色
                            style: {
                                fontWeight: "bold",
                                backgroundColor: !voiceEnabled ? "#990018" : "#007e44",
                                borderColor: !voiceEnabled ? "#990018" : "#007e44",
                            }
                        }),
                    ],
                    {
                        direction: "horizontal",
                        size: "middle",
                        style: { marginBottom: "8px" }
                    }
                ),
                CAT_UI.Space(
                    [
                        CAT_UI.Button("设置", {
                            type: "primary",
                            onClick: () => setVisible(true),
                        }),
                        CAT_UI.Button("常用语", {
                            type: "primary",
                            onClick() {
                                setCommonPhrasesVisible(true);
                            },
                        }),
                    ],
                    {
                        direction: "horizontal",
                        size: "middle",
                    }
                ),

                //抽屉
                CAT_UI.Space(
                    [
                        CAT_UI.createElement(SettingsDrawer, {
                            visible,
                            setVisible,
                            logEntries,
                            workingHours: Allvalue.workingHours,
                            onChangeWorkingHours: (wh) => {
                                patchAllvalue({ workingHours: wh });
                                addLog('监控时间段已更新：上午 ' + hoursToHHmm(wh.morningStart) + '-' + hoursToHHmm(wh.morningEnd) +
                                    '，下午 ' + hoursToHHmm(wh.afternoonStart) + '-' + hoursToHHmm(wh.afternoonEnd), 'info');
                            }
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
                            loadPhrasesData
                        }),
                    ],
                    {
                        direction: "horizontal",
                        size: "middle",
                    }
                ),
            ],
            { direction: "vertical" }
        );
    }

    try {
        CAT_UI.createPanel({
            header: {
                title: CAT_UI.Space(
                    [
                        CAT_UI.createElement("div", {
                            style: {
                                width: "24px",
                                height: "24px",
                                verticalAlign: "middle",
                                borderRadius: "4px",
                                display: "inline-block",
                                backgroundImage: 'url("https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico")',
                                backgroundSize: "contain",
                                backgroundRepeat: "no-repeat",
                                backgroundPosition: "center"
                            },
                        }),
                        CAT_UI.Text("征纳互动监控", {
                            style: { fontSize: "16px" },
                        }),
                        // 获取并显示版本号
                        CAT_UI.Text(`v${GM_info.script.version}`, {
                            style: {
                                fontSize: "12px",
                                color: "#999",
                                marginLeft: "8px"
                            },
                        }),
                    ],
                    { style: { marginLeft: "5px" } }
                ),
                style: {
                    borderBottom: "1px solid var(--color-neutral-3)"
                },
            },
            render: DM,

            // 面板初始位置：优先使用上次保存的位置，否则用默认坐标
            point: loadPanelPoint() || {
                x: window.screen.width * 0.55,
                y: window.screen.height * 0.01
            },
        });
    } catch (error) {
        // UI 面板创建失败时，至少不连累监控逻辑（两者同处一个 IIFE）
        console.error('[监控] 面板创建失败:', error);
        if (typeof addLog === 'function') {
            addLog('面板创建失败: ' + (error && error.message), 'error', true);
        }
    }

    // ==========面板位置保存==========
    // 关键事实（已核对 CAT_UI 源码）：
    //  1) createPanel 不提供 onDrag 回调，位置恢复只能靠 point 选项（已在上面用 loadPanelPoint 实现）。
    //  2) 面板渲染在 Shadow DOM 内（attachShadow open），普通 document 选择器穿不透，必须走 shadowRoot。
    //  3) 面板由 react-draggable 实现拖拽，拖拽时改写内部层的 transform: translate(x,y)。
    // 本模块只负责「保存」：定位 shadow 内的面板 → 监听拖拽 → 用 getBoundingClientRect 存真实视口坐标。
    // 下次加载时 createPanel 的 point 即读取该存档，形成闭环。
    (function setupPanelPositionTracking() {
        const PDBG = false; // 诊断开关：验证通过后可改 false

        // 收集页面上所有带 open shadowRoot 的宿主元素
        function getShadowHosts() {
            const hosts = [];
            document.querySelectorAll('*').forEach(el => { if (el.shadowRoot) hosts.push(el); });
            return hosts;
        }

        // 穿透 Shadow DOM 定位面板主体（shadow 内含本脚本标题、且带内联 left/top 的 div）
        function findPanelRoot() {
            for (const host of getShadowHosts()) {
                const sr = host.shadowRoot;
                if (!sr || !sr.textContent || !sr.textContent.includes('征纳互动监控')) continue;
                const divs = sr.querySelectorAll('div');
                for (const el of divs) {
                    if (el.style && el.style.left && el.style.top) return el;
                }
                const container = sr.querySelector('.container');
                if (container) return container;
            }
            return null;
        }

        // 在面板内找当前带 transform: translate 的拖拽层（react-draggable 施加）
        function findDraggableNode(root) {
            const all = root.querySelectorAll('*');
            for (const el of all) {
                const t = el.style && el.style.transform || '';
                if (t.indexOf('translate') !== -1) return el;
            }
            return null;
        }

        // 读取面板当前真实视口坐标：优先取被拖拽的层（transform 后位置随之变化），
        // 否则取面板主体本身。getBoundingClientRect 与 createPanel 的 point 同坐标系。
        function getCurrentPoint(root) {
            const el = findDraggableNode(root) || root;
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top) };
        }

        // 边界约束：面板只有顶部标题栏可拖动，必须保证该「可抓取区域」始终可见，
        // 否则拖出后就无法再抓回来。
        //  - 水平方向：至少保留 MIN_VISIBLE 像素在视口内（标题栏为整条宽度，露出一段即可抓取）。
        //  - 垂直方向：顶边不允许移出视口上方(minY=0)；且至少保留 HANDLE_MIN 高的标题栏在视口内(maxY)。
        const MIN_VISIBLE = 48;
        const HANDLE_MIN = 40; // 标题栏（可抓取区）至少保留的高度

        function clampPoint(pt, size) {
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const w = (size && size.w) ? size.w : 320;
            const minX = -(w - MIN_VISIBLE);
            const maxX = vw - MIN_VISIBLE;
            const minY = 0;            // 顶边不超出视口上方，标题栏始终可见
            const maxY = vh - HANDLE_MIN; // 至少保留一条标题栏高度在视口内，可抓取
            return {
                x: Math.min(Math.max(pt.x, minX), maxX),
                y: Math.min(Math.max(pt.y, minY), maxY)
            };
        }

        // 读取面板当前尺寸与可见矩形（用于精确计算边界）
        function getPanelRect(root) {
            const el = findDraggableNode(root) || root;
            const r = el.getBoundingClientRect();
            return { el: el, rect: r, w: r.width, h: r.height };
        }

        // 计算当前点 -> 裁剪到视口内 -> 保存；若越界则同时把拖拽层 transform 拉回边界，
        // 确保「视觉上」也始终留在可视范围（不止是存档安全）。
        function persistAndClamp(root) {
            const info = getPanelRect(root);
            const pt = { x: info.rect.left, y: info.rect.top };
            const clamped = clampPoint(pt, { w: info.w, h: info.h });
            if (clamped.x !== pt.x || clamped.y !== pt.y) {
                const dx = clamped.x - pt.x;
                const dy = clamped.y - pt.y;
                const el = info.el;
                const t = el.style.transform || '';
                const m = /translate\(\s*([-\d.]+)px\s*,\s*([-\d.]+)px\s*\)/.exec(t);
                if (m) {
                    const nx = (parseFloat(m[1]) + dx).toFixed(1);
                    const ny = (parseFloat(m[2]) + dy).toFixed(1);
                    el.style.transform = t.replace(/translate\([^)]*\)/, 'translate(' + nx + 'px, ' + ny + 'px)');
                } else if (t.indexOf('translate') === -1) {
                    el.style.transform = (t ? t + ' ' : '') + 'translate(' + dx.toFixed(1) + 'px, ' + dy.toFixed(1) + 'px)';
                }
            }
            savePanelPoint(clamped);
            return clamped;
        }

        function applyTracking(root) {
            // 监听整棵子树的 style 变化（transform 可能加在任意内部层）
            const observer = new MutationObserver(() => {
                const pt = persistAndClamp(root);
                if (PDBG) console.log('[面板位置] 检测到移动，保存坐标:', pt);
            });
            observer.observe(root, { attributes: true, attributeFilter: ['style'], subtree: true });

            // 双保险：拖拽过程（mousedown→mousemove→mouseup）中实时裁剪并保存最终位置
            root.addEventListener('mousedown', () => {
                const onMove = () => persistAndClamp(root);
                const onUp = () => {
                    persistAndClamp(root);
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }

        let tries = 0;
        const timer = setInterval(() => {
            tries++;
            const root = findPanelRoot();
            if (root) {
                clearInterval(timer);
                // 加载即裁剪：若存档位置（或默认位置）已越界，立即拉回并写回根容器 left/top
                const info = getPanelRect(root);
                const clamped = clampPoint({ x: info.rect.left, y: info.rect.top }, { w: info.w, h: info.h });
                root.style.left = Math.round(clamped.x) + 'px';
                root.style.top = Math.round(clamped.y) + 'px';
                savePanelPoint(clamped);
                if (PDBG) console.log('[面板位置] 已定位面板(Shadow DOM)，初始坐标:', clamped);
                applyTracking(root);
                // 视口尺寸变化时重新裁剪，防止面板被挤出可视范围
                window.addEventListener('resize', () => persistAndClamp(root));
            } else if (tries > 80) {
                clearInterval(timer);
                if (PDBG) console.warn('[面板位置] 未找到面板(已尝试穿透 Shadow DOM)，放弃位置跟踪');
            }
        }, 150);
    })();

    // ==========监控部分==========
    // 工具函数：获取当前小时（支持小数）
    function getCurrentHour() {
        const now = new Date();
        return now.getHours() + now.getMinutes() / 60;
    }

    // 检查是否在工作时间内（读取用户可配置的时间段缓存）
    function isWorkingHours() {
        const wh = cachedWorkingHours;
        // 兜底：若未配置则视为工作时间内，避免完全停止监控
        if (!wh) return true;
        const currentHour = getCurrentHour();
        return (currentHour >= wh.morningStart && currentHour <= wh.morningEnd) ||
            (currentHour >= wh.afternoonStart && currentHour <= wh.afternoonEnd);
    }

    // 缓存DOM元素引用（只缓存稳定元素）
    const domCache = {
        ocurrentElement: null
        // 注意：offlineElement 不缓存，每次重新查询
    };

    // 检测DOM元素是否仍然存在于文档中
    function isElementInDocument(element) {
        return element && element.isConnected;
    }

    // 记录上一次的等待人数，用于检测状态变化
    let lastWaitCount = null;

    // 记录上一次的工作时间状态，用于检测「进入/离开工作时间」的变化（仅在翻转时记日志）
    let lastWorkingState = null;

    // 修改主要检测函数
    function checkCount() {
        // 工作时间状态变化时记录日志（进入/离开），仅在翻转时输出，避免刷屏
        const inWork = isWorkingHours();
        if (inWork !== lastWorkingState) {
            lastWorkingState = inWork;
            addLog(inWork ? '已进入工作时间，开始监控征纳互动' : '已离开工作时间，暂停监控', inWork ? 'success' : 'info');
        }
        if (!inWork) return;

        try {
            // 清理缓存中已失效的人数元素
            if (!isElementInDocument(domCache.ocurrentElement)) {
                domCache.ocurrentElement = null;
            }

            // 重新查找人数元素（相对稳定，可以缓存）
            if (!domCache.ocurrentElement) {
                domCache.ocurrentElement = document.querySelector('.count:nth-child(2)');
            }

            const ocurrentElement = domCache.ocurrentElement;
            if (!ocurrentElement) {
                addLog('找不到人数元素', 'warning');
                return;
            }

            const currentCount = parseInt(ocurrentElement.textContent.trim(), 10);
            if (isNaN(currentCount)) {
                addLog(`无法解析等待人数: "${ocurrentElement.textContent.trim()}"`, 'warning');
                return;
            }

            // 人数状态处理：仅在状态变化时记录日志，避免日志被重复内容填满
            if (currentCount === 0) {
                // 仅在从 >0 变为 0 时记录
                if (lastWaitCount !== 0) {
                    addLog('当前等待人数为0', 'success');
                }
            } else {
                speak("征纳互动有人来了");
                addLog(`当前等待人数: ${currentCount}`, 'info');
            }
            lastWaitCount = currentCount;

            // ========== 离线检测 ==========
            // 每次重新查询，不缓存（弹窗元素动态创建/销毁）
            const offlineEl = document.querySelector('.t-dialog__body__icon:nth-child(2)') ||
                document.querySelector('.t-dialog__body__icon:nth-of-type(2)');

            if (offlineEl) {
                // 使用可选链安全读取文本
                const text = (offlineEl?.innerText ?? offlineEl?.textContent ?? '').trim();

                if (text.includes('掉线')) {
                    addLog(`掉线提示：${text}`, 'error');
                    speak("征纳互动已掉线");
                }
            }

        } catch (error) {
            addLog(`检测错误: ${error.message}`, 'error', true);
        }
    }

    /**
     * 向【页面里第一个 TinyMCE】追加文本并立即生效
     * @param {string} text2append  要追加的文本
     * @returns {string}            追加后的完整纯文本
     */
    function appendToTinyMCE(text2append = 'xxxxx') {
        /* 1. 拿到编辑器实例（动态匹配，不依赖 id） */
        const editors = window.tinymce?.editors ?? [];   // 所有 TinyMCE 实例
        const ed = editors.find(e => e.inline === false); // 先拿第一个非 inline 的
        // 如果上面没拿到，再随便拿一个
        const editor = ed || editors[0];

        // 检查输入框是否为空
        let isInputEmpty = true;
        if (editor) {
            const body = editor.getBody();
            isInputEmpty = !body.textContent.trim();
        } else {
            const iframe = document.querySelector('.input-box iframe.tox-edit-area__iframe') ||
                document.querySelector('iframe.tox-edit-area__iframe') ||
                document.querySelector('iframe[class*="tox"]');
            if (iframe) {
                try {
                    const body = iframe.contentDocument.querySelector('body#tinymce') ||
                        iframe.contentDocument.body;
                    isInputEmpty = !body.textContent.trim();
                } catch (e) {
                    addLog('无法访问iframe内容: ' + e.message, 'warning', true);
                }
            }
        }

        /* 2. 使用<br>换行处理 */
        // 转义文本并将换行符替换为<br>
        const escapedText = escapeHtml(text2append);
        let processedContent = escapedText.replace(/\n/g, '<br>');

        // 如果输入框不为空，在内容前添加<br>实现换行
        if (!isInputEmpty) {
            processedContent = '<br>' + processedContent;
        }

        /* 3. 真正干活 */
        if (editor) {
            const body = editor.getBody();          // 等同于 iframe.body

            if (isInputEmpty) {
                // 输入框为空时直接设置内容（不加额外换行）
                editor.setContent(processedContent);
            } else {
                // 输入框不为空时使用处理后的内容
                editor.execCommand('mceInsertContent', false, processedContent);
            }

            editor.save();                          // 同步回 textarea
            editor.setDirty(true);                  // 标记脏
            editor.selection.select(body, true);    // 把光标放末尾
            editor.selection.collapse(false);
        } else {
            /* 4. 兜底：直接改 DOM + 触发事件 */
            const iframe = document.querySelector('iframe.tox-edit-area__iframe') ||
                document.querySelector('iframe[class*="tox"]');
            if (!iframe) {
                addLog('找不到 TinyMCE iframe', 'error', true);
                return '';
            }

            try {
                const body = iframe.contentDocument.body;
                if (!body) {
                    addLog('找不到 body', 'error', true);
                    return '';
                }
                if (isInputEmpty) {
                    body.innerHTML = processedContent;
                } else {
                    body.insertAdjacentHTML('beforeend', processedContent);
                }
                // 触发单个 input 事件即可
                body.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (e) {
                addLog('无法访问 iframe 内容: ' + e.message, 'error', true);
                return '';
            }
        }

        const finalText = editor ? editor.getContent({ format: 'text' })
            : document.querySelector('body#tinymce')?.textContent ?? '';
        addLog('已追加文本并同步: ' + finalText, 'success', true);
        return finalText;
    }


    // 语音播报函数
    const speechQueue = [];
    let isSpeaking = false;
    let speechTimer = null;

    function speak(text) {
        // 直接读取缓存的语音状态，避免每次读取 localStorage
        if (!cachedVoiceEnabled || !('speechSynthesis' in window)) { return; }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1.0;

        // 添加到队列
        speechQueue.push(utterance);
        processSpeechQueue();
    }

    // 处理语音队列
    function processSpeechQueue() {
        if (isSpeaking || speechQueue.length === 0) { return; }

        isSpeaking = true;
        const utterance = speechQueue.shift();

        // 清理上一次的超时定时器
        if (speechTimer) { clearTimeout(speechTimer); }

        // 超时保护：防止 onend/onerror 不触发导致队列卡死（Chrome 已知 bug）
        speechTimer = setTimeout(() => {
            addLog('语音播报超时，强制继续队列', 'warning', true);
            isSpeaking = false;
            speechTimer = null;
            processSpeechQueue();
        }, CONFIG.SPEECH_TIMEOUT);

        const clearTimer = () => {
            if (speechTimer) {
                clearTimeout(speechTimer);
                speechTimer = null;
            }
        };

        utterance.onend = () => {
            clearTimer();
            isSpeaking = false;
            processSpeechQueue();
        };

        utterance.onerror = (event) => {
            clearTimer();
            isSpeaking = false;
            // 如果是not-allowed错误，清空队列避免堆积
            if (event.error === 'not-allowed') {
                speechQueue.length = 0;
            } else {
                processSpeechQueue();
            }
        };

        // 在播放前确保语音合成已恢复（某些浏览器会暂停）
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
    }


    // 全局定时器引用，用于清理
    let monitoringInterval = null;

    // 页面加载完成后启动监控
    function startMonitoring() {
        // 立即执行一次检查
        checkCount();
        // 启动定时检查
        monitoringInterval = setInterval(checkCount, CONFIG.CHECK_INTERVAL);
    }

    // 页面关闭时清理定时器
    window.addEventListener('beforeunload', () => {
        if (monitoringInterval) {
            clearInterval(monitoringInterval);
            monitoringInterval = null;
        }
        if (speechTimer) {
            clearTimeout(speechTimer);
            speechTimer = null;
        }
    });


    // 复用的音频播放器实例（避免每次创建新对象）
    let didaAudioPlayer = null;

    // 播放提示音函数
    function playDidaSound() {
        if (!CONFIG.didaUrl) return;
        try {
            // 复用 Audio 实例，避免重复解码
            if (!didaAudioPlayer) {
                didaAudioPlayer = new Audio();
                didaAudioPlayer.src = CONFIG.didaUrl;
                didaAudioPlayer.volume = 0.5;
            }
            // 重置播放位置并播放
            didaAudioPlayer.currentTime = 0;
            didaAudioPlayer.play().catch(() => { });
        } catch (e) { }
    }

    // 安全复制工具：仅在页面聚焦且支持 clipboard 时尝试复制
    function safeCopyText(text) {
        if (!text) return;
        // 1) 优先使用 GM_setClipboard（无需焦点）
        if (typeof GM_setClipboard === 'function') {
            try {
                GM_setClipboard(text);
                addLog('[复制] 已复制到剪贴板 (GM_setClipboard)', 'success', true);
                playDidaSound();
                return;
            } catch (e) {
                addLog('[复制] GM_setClipboard 失败: ' + e.message, 'error', true);
            }
        }

        // 2) 浏览器异步 clipboard API
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(text).then(() => {
                addLog('[复制] 已复制到剪贴板 (navigator.clipboard)', 'success', true);
                playDidaSound();
            }).catch(err => {
                addLog('[复制] 复制到剪贴板失败: ' + err.message, 'error', true);
            });
            return;
        }
    }

    // ========== 页面启动 ==========

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMonitoring);
    } else {
        startMonitoring();
    }
})();
