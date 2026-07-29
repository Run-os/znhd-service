// ==UserScript==
// @name           征纳互动人数和在线监控v2
// @namespace      https://scriptcat.org/
// @description    实时监控征纳互动等待人数和在线状态，支持语音播报、自定义常用语
// @version        26.7.29-v4
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
// @grant          GM_getResourceText
// @connect        *
// @connect        znhd-service.zeabur.app
// @homepageURL    https://scriptcat.org/zh-CN/script-show-page/3650
// @updateURL      https://cdn.jsdelivr.net/gh/Run-os/znhd-service@refs/heads/main/znhd.user.js
// @downloadURL    https://cdn.jsdelivr.net/gh/Run-os/znhd-service@refs/heads/main/znhd.user.js
// @require        https://scriptcat.org/lib/1167/1.0.0/%E8%84%9A%E6%9C%AC%E7%8C%ABUI%E5%BA%93.js?sha384-jXdR3hCwnDJf53Ue6XHAi6tApeudgS/wXnMYBD/ZJcgge8Xnzu/s7bkEf2tPi2KS
// @require        https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@5/dist/fp.min.js
// @require        https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js
// @require        https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js
// @require        https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.js
// @resource       VIEWER_CSS https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.css
// ==/UserScript==

(function () {
    'use strict';

    // ==========配置==========
    // 配置对象，集中管理可配置项
    const CONFIG = {
        CHECK_INTERVAL: 3000,
        MAX_LOG_ENTRIES: 20,
        didaUrl: 'https://cdn.jsdelivr.net/gh/Run-os/znhd-service@refs/heads/main/public/dida.mp3',
        // 语音播报超时保护（毫秒），防止 onend/onerror 不触发导致队列卡死
        SPEECH_TIMEOUT: 15000,
        // 语音队列最大长度，超过时丢弃最早（最旧）的消息，防止内存堆积
        MAX_SPEECH_QUEUE: 10,
        // 语音队列消息有效期（毫秒），超过该时长的陈旧消息在入队/播放前被剔除，避免播报过时内容
        SPEECH_QUEUE_TTL: 30000,
    };

    // ==========日志管理==========
    // 全局日志状态管理
    let setLogEntriesCallback = null;
    // 存储上一次的日志文本（用于重复内容检测）
    let lastLogMessage = null;

    // 添加日志条目函数
    /**
     * 添加一条日志条目，输出到设置面板的日志窗口（通过回调写入 React 状态）。
     * 内置重复内容过滤：与上一条日志文本完全相同则忽略，避免刷屏。
     * @param {string} message - 日志正文
     * @param {('info'|'warning'|'success'|'error')} [type='info'] - 日志类型，决定着色
     * @param {boolean} [logenabled=false] - 是否同时输出到浏览器控制台（console.log）
     * @returns {void}
     */
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
    // 常用语缓存（2 小时内且 URL 未变则跳过网络请求，直接复用本地数据）
    const PHRASES_CACHE_KEY = 'scriptCat_PhrasesCache';
    const PHRASES_CACHE_TTL = 2 * 60 * 60 * 1000; // 缓存有效期：2 小时（毫秒）
    const DEFAULTS = {
        voiceEnabled: true,
        // 监控时间段（单位：小时，可含小数，如 13.5 表示 13:30）
        workingHours: {
            morningStart: 9,
            morningEnd: 12,
            afternoonStart: 13.5,
            afternoonEnd: 18
        },
        // 常用语数据源（可配置；留空或非法时回退此默认地址）
        commonPhrasesUrl: 'https://cdn.jsdelivr.net/gh/Run-os/znhd-service@refs/heads/main/public/commonPhrases.yaml',
        // 手机图片→电脑剪贴板 中继服务器地址（需为公网可访问的 http(s):// 地址，末尾不带 /）
        relayServer: 'https://znhd.122050.xyz'
    };

    // 读取面板保存的位置（无记录返回 null，由调用方兜底默认坐标）
    /**
     * 从 localStorage 读取上次保存的面板位置。
     * @returns {({x:number,y:number}|null)} 命中且坐标合法时返回 {x,y}，否则返回 null（由调用方兜底默认坐标）
     */
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
    /**
     * 保存面板位置到 localStorage（带 requestAnimationFrame 防抖，避免拖拽中高频写入）。
     * @param {{x:number,y:number}} point - 面板视口坐标
     * @returns {void}
     */
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

    // 读取常用语本地缓存（2 小时有效期内且 URL 一致则命中）
    /**
     * 从 localStorage 读取常用语本地缓存（含加载时间戳、数据源 URL 与数据本体）。
     * @returns {({time:number,url:string,data:object}|null)} 命中且结构合法时返回缓存对象，否则返回 null
     */
    function loadPhrasesCache() {
        try {
            const saved = localStorage.getItem(PHRASES_CACHE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed.time === 'number' && typeof parsed.url === 'string' && parsed.data) {
                    return parsed;
                }
            }
        } catch (error) {
            addLog('读取常用语缓存失败: ' + error.message, 'error', true);
        }
        return null;
    }

    // 保存常用语本地缓存（记录加载时间戳、数据源 URL 与数据本体）
    /**
     * 将常用语数据连同加载时间戳与数据源 URL 写入 localStorage 缓存。
     * @param {string} url - 数据源地址（用于后续判断缓存是否仍有效）
     * @param {object} data - 解析后的常用语数据（键值对）
     * @returns {void}
     */
    function savePhrasesCache(url, data) {
        try {
            localStorage.setItem(PHRASES_CACHE_KEY, JSON.stringify({
                time: Date.now(),
                url: url,
                data: data
            }));
        } catch (error) {
            addLog('保存常用语缓存失败: ' + error.message, 'error', true);
        }
    }

    // 从localStorage加载Allvalue数据
    /**
     * 从 localStorage 加载全部用户配置，并与 DEFAULTS 合并（已存储值覆盖默认值）。
     * 解析失败时回退到 DEFAULTS，保证调用方始终拿到完整配置对象。
     * @returns {object} 合并后的配置对象（含 voiceEnabled / workingHours / commonPhrasesUrl 等）
     */
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
    /**
     * 将全部用户配置写入 localStorage，并记录成功/失败日志。
     * @param {object} data - 待保存的配置对象
     * @returns {void}
     */
    function saveAllvalue(data) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            addLog('数据已保存到localStorage', 'success', true);
        } catch (error) {
            addLog('保存数据失败: ' + error.message, 'error', true);
            CAT_UI.Message.error('保存设置失败: ' + error.message);
        }
    }

    // ==========状态缓存==========
    // 一次性读取初始配置，避免重复解析 localStorage
    const _initAllvalue = loadAllvalue();
    // 缓存语音启用状态，避免每次播报都读取 localStorage
    let cachedVoiceEnabled = _initAllvalue.voiceEnabled;
    // 缓存监控时间段，避免每次轮询都读取 localStorage
    let cachedWorkingHours = _initAllvalue.workingHours;
    // 缓存常用语数据源地址，避免每次请求都读取 localStorage
    let cachedCommonPhrasesUrl = _initAllvalue.commonPhrasesUrl;

    // ==========工具函数==========
    // HTML 转义函数（复用单个 div 元素，避免重复创建）
    const _escapeHelper = document.createElement('div');
    /**
     * 对文本做 HTML 转义，防止常用语内容中的特殊字符破坏页面结构。复用单个隐藏 div 元素，避免重复创建。
     * @param {string} text - 待转义文本
     * @returns {string} 转义后的 HTML 安全字符串
     */
    function escapeHtml(text) {
        _escapeHelper.textContent = text;
        return _escapeHelper.innerHTML;
    }

    // 十进制小时(如 13.5) 与 "HH:mm" 字符串互转，供时间选择器使用
    /**
     * 将十进制小时（如 13.5）转换为 "HH:mm" 字符串，供时间选择器显示。
     * 非法输入或越界值会被收敛到 [00:00, 24:00]。
     * @param {number} h - 十进制小时
     * @returns {string} "HH:mm" 格式字符串
     */
    function hoursToHHmm(h) {
        if (typeof h !== 'number' || isNaN(h)) return '00:00';
        let total = Math.round(h * 60);
        if (total < 0) total = 0;
        if (total > 24 * 60) total = 24 * 60;
        const H = Math.floor(total / 60) % 24;
        const M = total % 60;
        return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0');
    }
    /**
     * 将 "HH:mm" 字符串解析为十进制小时（如 "13:30" -> 13.5），供时间选择器回写。
     * 格式非法或数值越界时返回 null。
     * @param {string} str - "HH:mm" 格式字符串
     * @returns {(number|null)} 成功返回十进制小时，失败返回 null
     */
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
    /**
     * 日志面板组件：按类型着色渲染日志条目列表。
     * @param {object} props - 组件属性
     * @param {Array<{timestamp:string,message:string,type:string}>} props.logEntries - 日志条目数组
     * @returns {object} CAT_UI React 元素
     */
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
    /**
     * 设置抽屉组件：提供监控时间段配置、常用语数据源地址配置、脚本链接与日志查看。
     * @param {object} props - 组件属性
     * @param {boolean} props.visible - 抽屉是否可见
     * @param {Function} props.setVisible - 设置可见性的回调
     * @param {Array} props.logEntries - 日志条目
     * @param {object} props.workingHours - 当前监控时间段
     * @param {Function} props.onChangeWorkingHours - 时间段变更回调（入参为完整 workingHours 对象）
     * @param {string} props.commonPhrasesUrl - 当前常用语数据源地址
     * @param {Function} props.onChangeCommonPhrasesUrl - 数据源地址变更回调（入参为 URL 字符串）
     * @returns {object} CAT_UI React 元素
     */
    function SettingsDrawer({ visible, setVisible, logEntries, workingHours, onChangeWorkingHours, commonPhrasesUrl, onChangeCommonPhrasesUrl, relayServer, onChangeRelayServer }) {
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

        // 常用语数据源地址变更处理：留空恢复默认；需以 http(s):// 开头
        const DEFAULT_PHRASES_URL = DEFAULTS.commonPhrasesUrl;
        const onUrlChange = (val) => {
            let url = (typeof val === 'string') ? val : (val && val.target ? val.target.value : '');
            url = (url || '').trim();
            if (!url) {
                onChangeCommonPhrasesUrl(DEFAULT_PHRASES_URL);
                return;
            }
            if (!/^https?:\/\//i.test(url)) {
                CAT_UI.Message.warning('数据源地址需以 http(s):// 开头');
                return;
            }
            onChangeCommonPhrasesUrl(url);
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
                CAT_UI.Text("常用语数据地址（可自定义远程 YAML）", {
                    style: { display: "block", marginBottom: "8px", fontWeight: "bold" }
                }),
                CAT_UI.Input({
                    placeholder: "https://.../commonPhrases.yaml",
                    value: commonPhrasesUrl || DEFAULTS.commonPhrasesUrl,
                    onChange: onUrlChange,
                    allowClear: true,
                    style: { marginBottom: "8px", width: "100%" }
                }),
                CAT_UI.createElement(
                    "p",
                    { style: { margin: "0 0 8px", color: "#999", fontSize: "12px", lineHeight: "1.5" } },
                    "修改后请在「常用语」面板点「重新加载常用语」生效；留空则恢复默认地址。"
                ),
                CAT_UI.Text("中继服务器地址", {
                    style: { display: "block", marginBottom: "8px", fontWeight: "bold" }
                }),
                CAT_UI.Input({
                    placeholder: "https://你的服务器:端口",
                    value: relayServer || '',
                    onChange: (val) => {
                        let url = (typeof val === 'string') ? val : (val && val.target ? val.target.value : '');
                        url = (url || '').trim().replace(/\/+$/, ''); // 去掉末尾多余的 /（如用户粘贴 http://x:5689/ ）
                        if (url && !/^https?:\/\//i.test(url)) {
                            CAT_UI.Message.warning('服务器地址需以 http(s):// 开头');
                            return;
                        }
                        onChangeRelayServer(url);
                    },
                    allowClear: true,
                    style: { marginBottom: "8px", width: "100%" }
                }),
                CAT_UI.createElement(
                    "p",
                    { style: { margin: "0 0 8px", color: "#999", fontSize: "12px", lineHeight: "1.5" } },
                    "用于「设备互联到电脑」：手机上传的图片经此服务器转发到本机剪贴板。需自行部署配套 relay-server（见项目说明）。"
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
    /**
     * 常用语抽屉组件：展示数据源、重新加载按钮、搜索框与常用语按钮列表。
     * 点击常用语会复制文本并追加到 TinyMCE 编辑器。
     * @param {object} props - 组件属性
     * @param {boolean} props.visible - 抽屉是否可见
     * @param {Function} props.setVisible - 设置可见性的回调
     * @param {object} props.phrasesData - 常用语数据（键值对）
     * @param {Function} props.setPhrasesData - 数据状态设置回调
     * @param {boolean} props.phrasesLoading - 是否加载中
     * @param {Function} props.setPhrasesLoading - 加载状态设置回调
     * @param {string} props.searchKeyword - 搜索关键字
     * @param {Function} props.setSearchKeyword - 搜索关键字设置回调
     * @param {Function} props.loadPhrasesData - 加载常用语函数（force 参数控制是否强制刷新）
     * @param {string} props.commonPhrasesUrl - 当前数据源地址
     * @returns {object} CAT_UI React 元素
     */
    function CommonPhrasesDrawer({
        visible,
        setVisible,
        phrasesData,
        setPhrasesData,
        phrasesLoading,
        setPhrasesLoading,
        searchKeyword,
        setSearchKeyword,
        loadPhrasesData,
        commonPhrasesUrl
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
                    `数据源: ${decodeURIComponent(commonPhrasesUrl || DEFAULTS.commonPhrasesUrl)}`
                ),
                // 重新加载按钮
                CAT_UI.Button("重新加载常用语", {
                    type: "primary",
                    loading: phrasesLoading,
                    onClick: () => loadPhrasesData(true),
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
    /**
     * 主面板组件（DM = Dashboard/Main）：组装语音开关、设置与常用语入口及两个抽屉，
     * 管理面板内全部状态（配置、日志、常用语数据等）。
     * @returns {object} CAT_UI React 元素
     */
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
            // 同步更新常用语数据源缓存
            cachedCommonPhrasesUrl = newValue.commonPhrasesUrl;
        };
        const patchAllvalue = (kv) => updateAllvalue({ ...Allvalue, ...kv });

        // 解构状态变量，方便后续使用
        const { voiceEnabled } = Allvalue;

        const voiceEnabledText = voiceEnabled ? "🔊 语音" : "🔇 静音";

        // 设置抽屉显示状态管理
        const [visible, setVisible] = CAT_UI.useState(false);
        // 常用语抽屉显示状态管理
        const [commonPhrasesVisible, setCommonPhrasesVisible] = CAT_UI.useState(false);
        // 设备互联抽屉显示状态
        const [phoneVisible, setPhoneVisible] = CAT_UI.useState(false);
        // 设备互联自动接收的停止函数（用 ref 避免重复启动）
        const receiveStopRef = CAT_UI.useRef(null);
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
        // force=true 时强制刷新（忽略缓存），如点击「重新加载」按钮；否则命中有效缓存则跳过网络请求
        const loadPhrasesData = (force) => {
            // 非强制刷新：命中 2 小时内的有效缓存（URL 一致）则直接复用本地数据，不发请求
            if (!force) {
                const cache = loadPhrasesCache();
                if (cache && cache.url === cachedCommonPhrasesUrl &&
                    (Date.now() - cache.time) < PHRASES_CACHE_TTL) {
                    setPhrasesData(cache.data);
                    const mins = Math.round((Date.now() - cache.time) / 60000);
                    addLog('常用语使用本地缓存（' + mins + ' 分钟前加载），已跳过网络请求', 'info');
                    CAT_UI.Message.success('常用语已加载（本地缓存）');
                    return;
                }
            }
            setPhrasesLoading(true);
            GM_xmlhttpRequest({
                method: 'GET',
                url: cachedCommonPhrasesUrl,
                onload: function (response) {
                    try {
                        const data = jsyaml.load(response.responseText);
                        setPhrasesData(data);
                        savePhrasesCache(cachedCommonPhrasesUrl, data);
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

        // 设备互联：中继服务器地址填好后，默认自动开始接收（无需点击按钮）
        // 收到图片即弹出网页居中的预览弹窗（含复制 / 关闭按钮，见 showImagePopup）
        CAT_UI.useEffect(() => {
            const s = (Allvalue.relayServer || '').trim().replace(/\/+$/, '');
            if (!s) return;
            if (receiveStopRef.current) return; // 已在接收，避免重复启动
            // 「已自动开始接收」日志在脚本**连上服务器时立即**显示（见 startPhoneReceive 的 onConnected，
            // 由首次 /recv 短轮询确认触发，约 1 秒内），不等待手机端发送图片。地址末尾的 / 已在上面归一。
            const stop = startPhoneReceive({
                server: s,
                uuid: getDeviceId(),
                onConnected: () => { addLog('[设备互联] 已自动开始接收（' + s + '）', 'info'); },
                onImage: (img) => {
                    addLog('[设备互联] 收到图片：' + (img.name || 'image') + '（' + (img.mime || 'image') + '）', 'success');
                    showImagePopup(img);
                },
                onText: (txt) => {
                    const t = (txt.text || '').replace(/\s+$/, '');
                    addLog('[设备互联] 收到文本：' + (t.length > 40 ? t.slice(0, 40) + '…' : t), 'success');
                    showTextPopup(txt);
                }
            });
            receiveStopRef.current = stop;
            return () => {
                if (receiveStopRef.current) { receiveStopRef.current(); receiveStopRef.current = null; }
            };
        }, [Allvalue.relayServer]);

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
                                } else if (!newVoiceEnabled) {
                                    // 关闭语音：立即清空队列，防止旧消息堆积、再次开启时集中涌出
                                    clearSpeechQueue();
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
                        CAT_UI.Space(
                            [
                                CAT_UI.Button("查看待存文件", {
                                    type: "primary",
                                    onClick: () => {
                                        if (!receivedImages.length) {
                                            CAT_UI.Message.info('暂无待存文件');
                                            return;
                                        }
                                        renderImageGallery();
                                    },
                                }),
                                CAT_UI.Button("设备互联", {
                                    type: "primary",
                                    onClick: () => setPhoneVisible(true),
                                }),
                            ],
                            {
                                direction: "horizontal",
                                size: "middle",
                            }
                        ),
                    ],
                    {
                        direction: "vertical",
                        size: "small",
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
                            },
                            commonPhrasesUrl: Allvalue.commonPhrasesUrl,
                            onChangeCommonPhrasesUrl: (url) => {
                                patchAllvalue({ commonPhrasesUrl: url });
                                addLog('常用语数据源已更新: ' + url, 'info');
                            },
                            relayServer: Allvalue.relayServer || '',
                            onChangeRelayServer: (url) => {
                                patchAllvalue({ relayServer: url });
                                addLog('中继服务器已更新: ' + (url || '（空）'), 'info');
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
                            loadPhrasesData,
                            commonPhrasesUrl: Allvalue.commonPhrasesUrl
                        }),
                        CAT_UI.createElement(PhoneImageDrawer, {
                            visible: phoneVisible,
                            setVisible: setPhoneVisible,
                            relayServer: Allvalue.relayServer || '',
                            onChangeRelayServer: (url) => {
                                patchAllvalue({ relayServer: url });
                                addLog('中继服务器已更新: ' + (url || '（空）'), 'info');
                            }
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
        /**
         * 收集页面上所有带有 open shadowRoot 的宿主元素（用于穿透 Shadow DOM 定位面板）。
         * @returns {Array<Element>} 带有 shadowRoot 的 DOM 元素数组
         */
        function getShadowHosts() {
            const hosts = [];
            document.querySelectorAll('*').forEach(el => { if (el.shadowRoot) hosts.push(el); });
            return hosts;
        }

        // 穿透 Shadow DOM 定位面板主体（shadow 内含本脚本标题、且带内联 left/top 的 div）
        /**
         * 穿透 Shadow DOM 定位面板主体：在带 shadowRoot 的宿主中查找含本脚本标题、且带内联 left/top 的 div。
         * @returns {(Element|null)} 找到返回面板主体元素，否则返回 null
         */
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
        /**
         * 在面板子树中查找当前被 react-draggable 施加 transform: translate 的拖拽层。
         * @param {Element} root - 面板根元素
         * @returns {(Element|null)} 找到返回拖拽层元素，否则返回 null
         */
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
        /**
         * 读取面板当前真实视口坐标：优先取被拖拽层（transform 后位置随之变化），否则取面板主体本身。
         * @param {Element} root - 面板根元素
         * @returns {{x:number,y:number}} 面板左上角的视口坐标（四舍五入）
         */
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

        /**
         * 将面板坐标约束在视口内，保证顶部标题栏（唯一可抓取区）始终可见、水平方向至少保留部分在视口内。
         * @param {{x:number,y:number}} pt - 待约束的坐标
         * @param {{w?:number,h?:number}} [size] - 面板尺寸（缺省按 320 宽估算）
         * @returns {{x:number,y:number}} 约束后的安全坐标
         */
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
        /**
         * 读取面板当前尺寸与可见矩形（用于精确计算边界）。
         * @param {Element} root - 面板根元素
         * @returns {{el:Element,rect:DOMRect,w:number,h:number}} 拖拽层元素、视口矩形及宽高
         */
        function getPanelRect(root) {
            const el = findDraggableNode(root) || root;
            const r = el.getBoundingClientRect();
            return { el: el, rect: r, w: r.width, h: r.height };
        }

        // 计算当前点 -> 裁剪到视口内 -> 保存；若越界则同时把拖拽层 transform 拉回边界，
        // 确保「视觉上」也始终留在可视范围（不止是存档安全）。
        /**
         * 计算当前面板坐标，裁剪到视口内后保存；若越界则同步把拖拽层 transform 拉回边界。
         * @param {Element} root - 面板根元素
         * @returns {{x:number,y:number}} 约束并保存后的坐标
         */
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

        /**
         * 对面板根元素安装位置跟踪：用 MutationObserver 监听 style 变化 + mousedown/move/up 双保险，实时裁剪并保存位置。
         * @param {Element} root - 面板根元素
         * @returns {void}
         */
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
    /**
     * 获取当前时间的十进制小时（如 13:30 -> 13.5），供工作时间判断。
     * @returns {number} 当前十进制小时
     */
    function getCurrentHour() {
        const now = new Date();
        return now.getHours() + now.getMinutes() / 60;
    }

    // 检查是否在工作时间内（读取用户可配置的时间段缓存）
    /**
     * 判断当前是否处于用户配置的监控工作时间段内（读取缓存，无配置则视为工作时间内）。
     * @returns {boolean} 在工作时间内返回 true，否则 false
     */
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
    /**
     * 检测 DOM 元素是否仍连接在文档中（用于清理失效的缓存元素引用）。
     * @param {Element} element - 待检测元素
     * @returns {boolean} 仍连接返回 true，否则 false
     */
    function isElementInDocument(element) {
        return element && element.isConnected;
    }

    // 记录上一次的等待人数，用于检测状态变化
    let lastWaitCount = null;

    // 记录上一次的工作时间状态，用于检测「进入/离开工作时间」的变化（仅在翻转时记日志）
    let lastWorkingState = null;

    // 修改主要检测函数
    /**
     * 主检测函数：每次轮询执行。判断工作时间、读取等待人数（状态变化时记录/播报），
     * 并检测掉线弹窗（发现时记录并语音告警）。
     * @returns {void}
     */
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
     * 向页面中第一个 TinyMCE 编辑器追加文本并立即生效。
     * 优先使用 TinyMCE API，失败时降级为直接操作 iframe DOM 并派发 input 事件；
     * 输入框非空时在内容前补 <br> 实现换行。
     * @param {string} [text2append='xxxxx'] - 要追加的文本
     * @returns {string} 追加后的编辑器完整纯文本
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
    // 语音队列：元素为 { utterance, enqueuedAt }，enqueuedAt 用于过期清理；
    // 队列长度受 CONFIG.MAX_SPEECH_QUEUE 限制，超出时丢弃最早（最旧）的消息。
    const speechQueue = [];
    let isSpeaking = false;
    let speechTimer = null;

    /**
     * 清空语音队列并中止当前播报，重置播放状态与超时定时器。
     * 主要用于语音开关关闭时，避免旧消息堆积、再次开启时集中涌出。
     * @returns {void}
     */
    function clearSpeechQueue() {
        speechQueue.length = 0;
        isSpeaking = false;
        if (speechTimer) {
            clearTimeout(speechTimer);
            speechTimer = null;
        }
        if ('speechSynthesis' in window) {
            try { window.speechSynthesis.cancel(); } catch (e) { /* 忽略中止异常 */ }
        }
    }

    /**
     * 移除队列中已过期的语音消息（入队时间距今超过 CONFIG.SPEECH_QUEUE_TTL）。
     * @returns {number} 被移除的过期消息条数
     */
    function pruneExpiredSpeechItems() {
        if (speechQueue.length === 0) return 0;
        const now = Date.now();
        const before = speechQueue.length;
        for (let i = speechQueue.length - 1; i >= 0; i--) {
            if (now - speechQueue[i].enqueuedAt > CONFIG.SPEECH_QUEUE_TTL) {
                speechQueue.splice(i, 1);
            }
        }
        return before - speechQueue.length;
    }

    /**
     * 语音播报：将文本加入语音队列并触发播放（受语音开关与浏览器能力限制）。
     * 入队时执行长度上限与过期清理：队列超过 CONFIG.MAX_SPEECH_QUEUE 时丢弃最早（最旧）消息，
     * 超过 CONFIG.SPEECH_QUEUE_TTL 的过期消息也会被剔除，避免播报过时内容。
     * @param {string} text - 要播报的文本
     * @returns {void}
     */
    function speak(text) {
        // 直接读取缓存的语音状态，避免每次读取 localStorage
        if (!cachedVoiceEnabled || !('speechSynthesis' in window)) { return; }

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'zh-CN';
        utterance.rate = 1.0;

        // 添加到队列，记录入队时间用于过期判断
        speechQueue.push({ utterance, enqueuedAt: Date.now() });

        // 长度上限：超过则丢弃最早（最旧）的消息，保留最新内容
        while (speechQueue.length > CONFIG.MAX_SPEECH_QUEUE) {
            speechQueue.shift();
            addLog('语音队列已满，丢弃最早的一条旧消息', 'warning', true);
        }

        // 过期清理：剔除超过有效期的陈旧消息
        const expired = pruneExpiredSpeechItems();
        if (expired > 0) {
            addLog(`语音队列已清理 ${expired} 条过期消息`, 'warning', true);
        }

        processSpeechQueue();
    }

    // 处理语音队列
    /**
     * 从语音队列中取出一条依次播放，带超时保护（防止 onend/onerror 不触发导致队列卡死）；
     * 播放前先剔除过期消息，避免播报过时内容。
     * @returns {void}
     */
    function processSpeechQueue() {
        if (isSpeaking) { return; }

        // 先清理过期消息，避免播报过时内容
        pruneExpiredSpeechItems();

        if (speechQueue.length === 0) { return; }

        isSpeaking = true;
        const item = speechQueue.shift();
        const utterance = item.utterance;

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
    /**
     * 启动监控：立即执行一次检测，并按 CHECK_INTERVAL 定时轮询 checkCount。
     * @returns {void}
     */
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
    /**
     * 播放提示音（dida.mp3）。复用 Audio 实例，避免重复解码。
     * @returns {void}
     */
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
    /**
     * 安全复制文本到剪贴板：优先 GM_setClipboard（无需焦点），降级到 navigator.clipboard；
     * 成功复制后播放提示音。失败时记录日志，不抛出。
     * @param {string} text - 待复制文本（空值直接返回）
     * @returns {void}
     */
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

    // ========== 手机图片 → 电脑剪贴板 ==========
    // 每台电脑/每个脚本安装实例一个稳定 deviceId（持久化，刷新不变），
    // 拼出上传链接 <relayServer>/u/<deviceId>；手机打开该链接上传，电脑端长轮询取走。
    const DEVICE_ID_KEY = 'znhd_device_id';
    /**
     * 取得本机稳定设备 ID：首次运行用 crypto.randomUUID() 生成并持久化（GM_setValue），
     * 之后刷新/重开都读同一值。用于区分不同电脑（A、B 各自不同链接）。
     * @returns {string} 设备 UUID 字符串
     */
    function getDeviceId() {
        let id = '';
        try { id = (typeof GM_getValue === 'function') ? (GM_getValue(DEVICE_ID_KEY, '') || '') : ''; } catch (e) { id = ''; }
        if (!id) {
            try {
                id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
                    : ('d' + Date.now().toString(16) + Math.random().toString(16).slice(2));
            } catch (e) { id = 'd' + Date.now().toString(16) + Math.random().toString(16).slice(2); }
            try { if (typeof GM_setValue === 'function') GM_setValue(DEVICE_ID_KEY, id); } catch (e) { /* 忽略 */ }
        }
        return id;
    }

    /**
     * 将 base64 字符串还原为 Blob（用于把中继返回的图片字节写剪贴板）。
     * @param {string} b64 - base64 文本
     * @param {string} mime - MIME 类型
     * @returns {Blob} 图片 Blob
     */
    function base64ToBlob(b64, mime) {
        const bin = atob(b64);
        const len = bin.length;
        const arr = new Uint8Array(len);
        for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime || 'image/jpeg' });
    }

    /**
     * 将图片 Blob 转成 PNG Blob（best-effort）。
     * 原因：异步 Clipboard API（navigator.clipboard.write + ClipboardItem）在部分
     * Chromium 内核里只可靠支持 image/png；手机传来的图多为 image/jpeg，
     * 直接以 image/jpeg 写入可能失败。统一转 PNG 可规避该限制。
     * 若环境不支持位图解码 / Canvas，则返回原 blob。
     * @param {Blob} blob
     * @returns {Promise<Blob>}
     */
    function blobToPng(blob) {
        return new Promise((resolve) => {
            if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') { resolve(blob); return; }
            try {
                createImageBitmap(blob).then(bmp => {
                    const cv = document.createElement('canvas');
                    cv.width = bmp.width; cv.height = bmp.height;
                    const ctx = cv.getContext('2d');
                    if (!ctx) { if (bmp.close) bmp.close(); resolve(blob); return; }
                    ctx.drawImage(bmp, 0, 0);
                    if (bmp.close) bmp.close();
                    cv.toBlob(b => { resolve(b || blob); }, 'image/png');
                }).catch(() => resolve(blob));
            } catch (e) { resolve(blob); }
        });
    }

    /**
     * 尝试把图片写入剪贴板：优先「页面主世界(unsafeWindow)」的 navigator.clipboard.write，
     * 失败再退回「隔离世界」的同名 API。两者都不行则返回 false。
     * 页面主世界路径是文档确认的、唯一能把图片真正写进系统剪贴板的可靠方式
     * （ScriptCat 隔离世界里 ClipboardItem 常缺失，且 ScriptCat 的 GM_setClipboard 仅支持文本，
     *  传 Blob 会静默无效——故图片复制不再依赖 GM_setClipboard）。
     * @param {Blob} data
     * @param {string} type
     * @returns {Promise<boolean>}
     */
    function attemptWriteImage(data, type) {
        const doWrite = (nav, CI) => new Promise((r) => {
            try {
                if (nav && nav.clipboard && nav.clipboard.write && typeof CI !== 'undefined') {
                    nav.clipboard.write([new CI({ [type]: data })])
                        .then(() => r(true))
                        .catch(() => r(false));
                    return;
                }
            } catch (e) { /* 忽略，走降级 */ }
            r(false);
        });
        const w = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        return doWrite(w && w.navigator, w && w.ClipboardItem).then(ok => {
            if (ok) return true;
            return doWrite(navigator, ClipboardItem);
        });
    }

    /**
     * 将图片 Blob 写入系统剪贴板（由一次「用户点击」触发，以保留浏览器要求的用户手势）。
     * 流程：
     *   1) 先用「原始 blob」直接写（此时点击手势最新鲜、无任何异步转换，成功率最高）；
     *   2) 若失败（多半因内核仅支持 image/png 而原图为 jpeg），再统一转 PNG 后重试；
     *   3) 写入一律走页面主世界的 navigator.clipboard.write（见 attemptWriteImage），
     *      不再依赖 GM_setClipboard（ScriptCat 该 API 仅支持文本，传 Blob 会静默无效导致"假成功"）。
     * @param {Blob} blob - 图片 Blob
     * @returns {Promise<boolean>} 成功返回 true，失败返回 false
     */
    function copyImageToClipboard(blob) {
        return new Promise((resolve) => {
            if (!blob) { addLog('[复制] 图片数据为空', 'error', true); resolve(false); return; }
            const type0 = (blob.type) ? blob.type : 'image/png';
            // 1) 原始 blob 直接写（手势最新鲜）
            attemptWriteImage(blob, type0).then(ok => {
                if (ok) { addLog('[复制] 图片已复制到剪贴板', 'success', true); resolve(true); return; }
                // 2) 转 PNG 后重试（规避内核仅支持 image/png 的限制）
                blobToPng(blob).then(png => {
                    const data = png || blob;
                    const type = (data.type) ? data.type : 'image/png';
                    attemptWriteImage(data, type).then(ok2 => {
                        if (ok2) { addLog('[复制] 图片已复制到剪贴板 (转PNG)', 'success', true); resolve(true); }
                        else { addLog('[复制] 所有复制方式均失败，请长按图片手动保存', 'error', true); resolve(false); }
                    });
                }).catch(() => {
                    addLog('[复制] PNG 转换失败', 'error', true); resolve(false);
                });
            });
        });
    }

    // ========== 收到图片：九宫格画廊弹窗（Viewer.js 放大查看） ==========
    // 收到的图片累积进 receivedImages 列表，以 3 列九宫格缩略图展示（直接挂 document.documentElement，
    // 不受 CAT_UI 面板 transform 影响）。单击缩略图用 Viewer.js 放大（缩放/旋转/多图左右切换），
    // 每张图下方有「复制」按钮（点击手势触发，满足浏览器剪贴板策略）和右上角 × 移除。
    const MAX_GALLERY = 27; // 画廊最多保留张数，超出丢最旧（释放其 objectURL）
    const receivedImages = []; // { blob, previewUrl, name, mime, ts }
    let galleryViewer = null;  // Viewer.js 实例（重建画廊时先销毁）
    let viewerCssInjected = false;

    // 注入 Viewer.js 的 CSS：优先 @resource（GM_getResourceText），失败回退 CDN <link>
    function ensureViewerCss() {
        if (viewerCssInjected) return;
        let baseInjected = false;
        try {
            const css = (typeof GM_getResourceText === 'function') ? GM_getResourceText('VIEWER_CSS') : '';
            if (css) { GM_addStyle(css); baseInjected = true; }
        } catch (e) { /* 继续走 link 回退 */ }
        if (!baseInjected) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.css';
            (document.head || document.documentElement).appendChild(link);
        }
        // 覆盖样式：Viewer.js 默认遮罩是半透明黑（rgba(0,0,0,0.5)），放大时会透出后面的画廊弹窗；
        // 改为纯黑不透明，彻底遮住背景（!important 保证无论加载顺序都生效）
        GM_addStyle('.viewer-backdrop{background-color:#000 !important;}' +
                    '.viewer-container{background-color:#000 !important;}');
        viewerCssInjected = true;
    }

    /**
     * 生成下载文件名：优先原始文件名；无名或无扩展名时按 mime 补扩展名。
     * @param {string} name - 原始文件名（可空）
     * @param {string} mime - MIME 类型
     * @param {number} idx - 画廊序号（用于兜底命名）
     * @returns {string} 带扩展名的文件名
     */
    function downloadFileName(name, mime, idx) {
        const extByMime = {
            'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
            'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp'
        };
        let n = String(name || '').trim();
        if (!n) n = 'znhd-image-' + (idx + 1);
        if (!/\.[a-z0-9]{2,5}$/i.test(n)) n += (extByMime[(mime || '').toLowerCase()] || '.jpg');
        return n;
    }

    // 对外入口（poll 回调调用）：新图入列并打开/刷新画廊弹窗
    function showImagePopup(img) {
        img.ts = Date.now();
        receivedImages.push(img);
        while (receivedImages.length > MAX_GALLERY) {
            const old = receivedImages.shift();
            try { URL.revokeObjectURL(old.previewUrl); } catch (e) { /* 忽略 */ }
        }
        renderImageGallery();
    }

    function removeGalleryImage(idx) {
        const it = receivedImages.splice(idx, 1)[0];
        if (it) { try { URL.revokeObjectURL(it.previewUrl); } catch (e) { /* 忽略 */ } }
        if (receivedImages.length === 0) closeImagePopup();
        else renderImageGallery();
    }

    function renderImageGallery() {
        closeImagePopup(); // 重建（销毁旧 Viewer 实例与旧 DOM）
        ensureViewerCss();
        const overlay = document.createElement('div');
        overlay.id = '__znhd_img_popup__';
        // 所有样式加 !important + 铺满 100vw/vh，隔绝任何外部 CSS（含扩展/页面）对弹窗的覆盖
        overlay.style.cssText = 'position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;z-index:2147483640!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,0.55)!important;opacity:1!important;font-family:sans-serif!important;';
        const box = document.createElement('div');
        box.style.cssText = 'position:relative!important;width:min(560px,92vw)!important;max-height:88vh!important;background:#fff!important;opacity:1!important;border-radius:12px!important;padding:16px!important;box-shadow:0 8px 30px rgba(0,0,0,0.35)!important;display:flex!important;flex-direction:column!important;';
        // 标题
        const title = document.createElement('div');
        title.textContent = '收到的图片（' + receivedImages.length + '）· 单击放大';
        title.style.cssText = 'font-size:15px!important;font-weight:bold!important;color:#333!important;margin:0 0 10px 2px!important;';
        // 右上角关闭
        const close = document.createElement('div');
        close.textContent = '×';
        close.title = '关闭（图片保留，收到新图会再次弹出）';
        close.style.cssText = 'position:absolute!important;top:8px!important;right:10px!important;width:30px!important;height:30px!important;line-height:28px!important;text-align:center!important;font-size:22px!important;color:#fff!important;cursor:pointer!important;border-radius:50%!important;background:#e4393c!important;opacity:1!important;box-shadow:0 1px 4px rgba(0,0,0,0.3)!important;font-weight:bold!important;';
        close.onmouseenter = () => { close.style.background = '#c9302c'; };
        close.onmouseleave = () => { close.style.background = '#e4393c'; };
        close.onclick = () => closeImagePopup();
        // 九宫格容器（3 列，可滚动）
        const grid = document.createElement('div');
        grid.id = '__znhd_img_grid__';
        grid.style.cssText = 'display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:10px!important;overflow-y:auto!important;padding:2px!important;max-height:60vh!important;';
        receivedImages.forEach((it, idx) => {
            const cell = document.createElement('div');
            cell.style.cssText = 'position:relative!important;display:flex!important;flex-direction:column!important;';
            const thumbWrap = document.createElement('div');
            thumbWrap.style.cssText = 'position:relative!important;width:100%!important;aspect-ratio:1/1!important;border-radius:8px!important;overflow:hidden!important;background:#f2f2f2!important;cursor:zoom-in!important;';
            const imgEl = document.createElement('img');
            imgEl.src = it.previewUrl;
            imgEl.alt = it.name || ('image-' + (idx + 1));
            imgEl.style.cssText = 'width:100%!important;height:100%!important;object-fit:cover!important;display:block!important;';
            thumbWrap.appendChild(imgEl);
            // 单张移除 ×
            const del = document.createElement('div');
            del.textContent = '×';
            del.title = '移除这张';
            del.style.cssText = 'position:absolute!important;top:4px!important;right:4px!important;width:20px!important;height:20px!important;line-height:18px!important;text-align:center!important;font-size:14px!important;color:#fff!important;cursor:pointer!important;border-radius:50%!important;background:rgba(0,0,0,0.55)!important;font-weight:bold!important;z-index:2!important;';
            del.onclick = (e) => { e.stopPropagation(); removeGalleryImage(idx); };
            thumbWrap.appendChild(del);
            // 按钮行：复制（写剪贴板）+ 下载（存为文件）
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex!important;gap:4px!important;margin-top:6px!important;';
            const copyBtn = document.createElement('button');
            copyBtn.textContent = '复制';
            copyBtn.style.cssText = 'flex:1!important;padding:4px 0!important;border:none!important;border-radius:6px!important;background:#1890ff!important;color:#fff!important;font-size:12px!important;opacity:1!important;cursor:pointer!important;';
            copyBtn.onclick = (e) => {
                e.stopPropagation();
                copyBtn.textContent = '复制中…'; copyBtn.disabled = true;
                copyImageToClipboard(it.blob).then(ok => {
                    copyBtn.disabled = false;
                    if (ok) {
                        copyBtn.textContent = '✓ 已复制';
                        copyBtn.style.background = '#52c41a';
                        addLog('图片已复制到剪贴板: ' + (it.name || ''), 'success');
                    } else {
                        copyBtn.textContent = '复制失败';
                        copyBtn.style.background = '#e4393c';
                    }
                });
            };
            const dlBtn = document.createElement('button');
            dlBtn.textContent = '下载';
            dlBtn.style.cssText = 'flex:1!important;padding:4px 0!important;border:none!important;border-radius:6px!important;background:#722ed1!important;color:#fff!important;font-size:12px!important;opacity:1!important;cursor:pointer!important;';
            dlBtn.onclick = (e) => {
                e.stopPropagation();
                try {
                    const fname = downloadFileName(it.name, it.mime, idx);
                    const a = document.createElement('a');
                    const url = URL.createObjectURL(it.blob);
                    a.href = url; a.download = fname; a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e2) { /* 忽略 */ } }, 3000);
                    dlBtn.textContent = '✓ 已下载';
                    dlBtn.style.background = '#52c41a';
                    addLog('图片已下载: ' + fname, 'success');
                } catch (err) {
                    dlBtn.textContent = '下载失败';
                    dlBtn.style.background = '#e4393c';
                    addLog('[下载] 失败：' + err.message, 'error', true);
                }
            };
            btnRow.appendChild(copyBtn);
            btnRow.appendChild(dlBtn);
            cell.appendChild(thumbWrap);
            cell.appendChild(btnRow);
            grid.appendChild(cell);
        });
        // 底部操作条
        const bar = document.createElement('div');
        bar.style.cssText = 'display:flex!important;justify-content:center!important;gap:12px!important;margin-top:12px!important;';
        const clearBtn = document.createElement('button');
        clearBtn.textContent = '清空全部';
        clearBtn.style.cssText = 'padding:7px 18px!important;border:none!important;border-radius:8px!important;background:#999!important;color:#fff!important;font-size:13px!important;cursor:pointer!important;';
        clearBtn.onclick = () => {
            receivedImages.forEach(it => { try { URL.revokeObjectURL(it.previewUrl); } catch (e) { /* 忽略 */ } });
            receivedImages.length = 0;
            closeImagePopup();
        };
        bar.appendChild(clearBtn);
        box.appendChild(close);
        box.appendChild(title);
        box.appendChild(grid);
        box.appendChild(bar);
        overlay.appendChild(box);
        overlay.onclick = (e) => { if (e.target === overlay) closeImagePopup(); };
        document.documentElement.appendChild(overlay); // 挂到 <html> 而非 <body>：避开 body 级 transform/filter 改写 fixed 包含块
        // 用 Viewer.js 绑定画廊：单击缩略图放大，多图可左右切换
        if (typeof Viewer === 'function') {
            try {
                galleryViewer = new Viewer(grid, {
                    zIndex: 2147483647,          // 盖住画廊遮罩（遮罩为 ...640）
                    zoomRatio: 0.4,
                    title: (image) => image.alt || '',
                    toolbar: { zoomIn: 1, zoomOut: 1, oneToOne: 1, reset: 1, prev: 1, next: 1, rotateLeft: 1, rotateRight: 1, flipHorizontal: 1, flipVertical: 1 },
                    filter(image) { return true; },
                });
            } catch (e) {
                addLog('[设备互联] Viewer 初始化失败：' + e.message, 'error', true);
            }
        } else {
            addLog('[设备互联] Viewer.js 未加载，单击放大不可用（缩略图仍可复制）', 'warning', true);
        }
    }

    function closeImagePopup() {
        if (galleryViewer) { try { galleryViewer.destroy(); } catch (e) { /* 忽略 */ } galleryViewer = null; }
        const ex = document.getElementById('__znhd_img_popup__');
        if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
    }

    // 收到手机文本时，在网页正中弹出预览弹窗（与图片弹窗同一挂法：document.documentElement），
    // 含文本展示区、复制到剪贴板按钮（复用 safeCopyText，满足浏览器剪贴板策略并记日志/提示音）、关闭按钮。
    function showTextPopup(txt) {
        closeTextPopup();
        const overlay = document.createElement('div');
        overlay.id = '__znhd_text_popup__';
        overlay.style.cssText = 'position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,0.55)!important;opacity:1!important;font-family:sans-serif!important;';
        const box = document.createElement('div');
        box.style.cssText = 'position:relative!important;min-width:360px!important;min-height:200px!important;max-width:90vw!important;max-height:90vh!important;background:#fff!important;opacity:1!important;border-radius:12px!important;padding:16px!important;box-shadow:0 8px 30px rgba(0,0,0,0.35)!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;';
        const textEl = document.createElement('div');
        textEl.textContent = txt.text || '';
        textEl.style.cssText = 'min-width:320px!important;min-height:120px!important;max-width:80vw!important;max-height:55vh!important;overflow:auto!important;white-space:pre-wrap!important;word-break:break-word!important;font-size:15px!important;line-height:1.6!important;color:#222!important;background:#f7f7f7!important;opacity:1!important;border:1px solid #eee!important;border-radius:8px!important;padding:12px!important;';
        const close = document.createElement('div');
        close.textContent = '×';
        close.title = '关闭';
        close.style.cssText = 'position:absolute!important;top:8px!important;right:10px!important;width:30px!important;height:30px!important;line-height:28px!important;text-align:center!important;font-size:22px!important;color:#fff!important;cursor:pointer!important;border-radius:50%!important;background:#e4393c!important;opacity:1!important;box-shadow:0 1px 4px rgba(0,0,0,0.3)!important;font-weight:bold!important;';
        close.onmouseenter = () => { close.style.background = '#c9302c'; };
        close.onmouseleave = () => { close.style.background = '#e4393c'; };
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '复制到剪贴板';
        copyBtn.style.cssText = 'margin-top:14px!important;padding:8px 18px!important;border:none!important;border-radius:8px!important;background:#1890ff!important;color:#fff!important;font-size:14px!important;opacity:1!important;cursor:pointer!important;align-self:center!important;';
        copyBtn.onclick = () => {
            safeCopyText(txt.text || '');
            copyBtn.textContent = '已复制';
            copyBtn.style.background = '#52c41a';
        };
        close.onclick = () => closeTextPopup();
        overlay.onclick = (e) => { if (e.target === overlay) closeTextPopup(); };
        box.appendChild(close);
        box.appendChild(textEl);
        box.appendChild(copyBtn);
        overlay.appendChild(box);
        document.documentElement.appendChild(overlay);
    }
    function closeTextPopup() {
        const ex = document.getElementById('__znhd_text_popup__');
        if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
    }

    /**
     * 用客户端 qrcodejs 库把文本（即上传链接）即时生成为 PNG dataURL，无需服务器参与。
     * qrcodejs 暴露全局 QRCode：new QRCode(div,{text,width,height}) 同步把二维码绘入 div 内的 canvas；
     * 读取其内部 canvas.toDataURL('image/png') 即得图片 dataURL。
     * CAT_UI 的 React 渲染器白名单不放行 <img>/<canvas>，故此处只产出 dataURL 字符串，
     * 由调用方用 backgroundImage div 显示（与收到图片预览同一招）。
     * 库未就绪（QRCode 未定义）时回退为空串（此时仍可手动复制链接文本）。
     * @param {string} text - 待编码文本（上传链接）
     * @returns {Promise<string>} PNG dataURL，失败返回 ''
     */
    function genQrDataUrl(text) {
        return new Promise((resolve) => {
            try {
                if (typeof QRCode === 'undefined' || typeof QRCode !== 'function') {
                    addLog('[二维码] qrcodejs 未加载，请手动复制链接', 'error', true);
                    resolve(''); return;
                }
                const holder = document.createElement('div');
                holder.style.position = 'absolute';
                holder.style.left = '-99999px';
                holder.style.top = '-99999px';
                document.body.appendChild(holder);
                new QRCode(holder, {
                    text: text,
                    width: 240,
                    height: 240,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
                // qrcodejs 同步把二维码绘入 canvas；延迟一拍确保绘制完成再读取
                setTimeout(() => {
                    try {
                        const canvas = holder.querySelector('canvas');
                        const url = canvas ? canvas.toDataURL('image/png') : '';
                        if (holder.parentNode) holder.parentNode.removeChild(holder);
                        if (url) resolve(url);
                        else { addLog('[二维码] 画布读取失败，请手动复制链接', 'error', true); resolve(''); }
                    } catch (e) {
                        if (holder.parentNode) holder.parentNode.removeChild(holder);
                        addLog('[二维码] 读取失败: ' + e.message, 'error', true);
                        resolve('');
                    }
                }, 0);
            } catch (e) {
                addLog('[二维码] 生成异常: ' + e.message, 'error', true);
                resolve('');
            }
        });
    }

    /**
     * 启动「设备互联」长轮询接收循环（直到 stop() 调用）。
     * 通过 GM_xmlhttpRequest 轮询中继服务器 /recv/<uuid>（绕过税务页面 CSP 对 connect-src 的限制）。
     * 收到图片时回调 onImage；状态变化回调 onStatus；网络异常自动重连。
     * @param {object} opt - { server, uuid, onStatus, onImage }
     * @returns {Function} stop() 停止接收
     */
    function startPhoneReceive(opt) {
        const server = (opt.server || '').trim().replace(/\/+$/, '');
        const uuid = opt.uuid;
        let stopped = false;
        let lastXhr = null;
        let connected = false;
        let loggedConnFail = false;
        let firstPoll = true;
        function markConnected() {
            if (connected) return;
            connected = true;
            if (opt.onConnected) { try { opt.onConnected(); } catch (e) { /* 忽略 */ } }
        }
        // 说明：不单独探测 /health。旧版中继可能没有该端点，会导致请求挂起并误报
        // 「连接服务器超时」，而真正的 /recv 接收始终正常（与用户报告的现象一致）。
        // 改用「首次 /recv 轮询用极短 maxwait」来快速确认已连上：服务器会很快返回空响应，
        // 从而 markConnected → onConnected 触发「已自动开始接收」日志（约 1 秒内）。
        function poll() {
            if (stopped) return;
            if (opt.onStatus) opt.onStatus('正在等待手机上传…');
            // 首次轮询用极短 maxwait 仅用于快速确认「已连上服务器」（服务器会很快返回空），
            // 让「已自动开始接收」日志尽快出现；后续轮询用长 maxwait 实时等待图片。
            const maxwait = firstPoll ? 1000 : 25000;
            firstPoll = false;
            const url = server + '/recv/' + encodeURIComponent(uuid) + '?maxwait=' + maxwait;
            try {
                lastXhr = GM_xmlhttpRequest({
                    method: 'GET',
                    url: url,
                    timeout: maxwait + 5000,
                    onload: function (resp) {
                        if (stopped) return;
                        markConnected(); // 首次成功收到服务器响应即视为已连上
                        let data = null;
                        try { data = JSON.parse(resp.responseText); } catch (e) { data = null; }
                        if (data && data.empty) { poll(); return; }
                        if (data && data.type === 'image' && data.data) {
                            const blob = base64ToBlob(data.data, data.mime || 'image/jpeg');
                            const previewUrl = 'data:' + (data.mime || 'image/jpeg') + ';base64,' + data.data;
                            if (opt.onStatus) opt.onStatus('收到图片：' + (data.name || 'image'));
                            if (opt.onImage) opt.onImage({ blob: blob, previewUrl: previewUrl, name: data.name, mime: data.mime });
                            poll(); // 继续接收下一张
                            return;
                        }
                        if (data && data.type === 'text' && typeof data.text === 'string') {
                            if (opt.onStatus) opt.onStatus('收到文本');
                            if (opt.onText) opt.onText({ text: data.text, ts: data.ts });
                            poll(); // 继续接收下一条
                            return;
                        }
                        setTimeout(poll, 1000); // 解析失败稍后重试
                    },
                    onerror: function () {
                        if (stopped) return;
                        if (!loggedConnFail) { loggedConnFail = true; addLog('[设备互联] 连接服务器失败，请检查中继地址/网络（' + server + '）', 'error'); }
                        if (opt.onStatus) opt.onStatus('连接中断，正在重连…');
                        setTimeout(poll, 2000);
                    },
                    ontimeout: function () {
                        if (stopped) return;
                        poll(); // 超时继续轮询
                    }
                });
            } catch (e) {
                if (stopped) return;
                if (opt.onStatus) opt.onStatus('请求异常，正在重连…');
                setTimeout(poll, 2000);
            }
        }
        poll();
        return function stop() {
            stopped = true;
            try { if (lastXhr && typeof lastXhr.abort === 'function') lastXhr.abort(); } catch (e) { /* 忽略 */ }
        };
    }

    /**
     * 电脑端 → 手机端 发送（图片或文本）。POST 到中继 /phone/send/<deviceId>。
     * 仅负责投递；手机是否在线由调用方先查 /phone/status 决定（离线时调用方直接拦截）。
     * @param {object} opt - { server, uuid, payload, onOk, onFail }
     *   payload: { text } 或 { name, mime, data(base64) }
     */
    function sendToPhone(opt) {
        const server = (opt.server || '').trim().replace(/\/+$/, '');
        const uuid = opt.uuid;
        const url = server + '/phone/send/' + encodeURIComponent(uuid);
        try {
            GM_xmlhttpRequest({
                method: 'POST',
                url: url,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(opt.payload),
                timeout: 20000,
                onload: function (resp) {
                    let j = null;
                    try { j = JSON.parse(resp.responseText); } catch (e) { j = null; }
                    if (j && j.ok) { if (opt.onOk) opt.onOk(); }
                    else { if (opt.onFail) opt.onFail((j && j.error) || ('HTTP ' + resp.status)); }
                },
                onerror: function () { if (opt.onFail) opt.onFail('网络错误，请检查中继地址'); },
                ontimeout: function () { if (opt.onFail) opt.onFail('发送超时'); }
            });
        } catch (e) {
            if (opt.onFail) opt.onFail(e.message);
        }
    }

    // 设备互联抽屉：展示本机上传链接 + 二维码（接收由脚本自动进行，收到图片弹窗预览）
    // 另含「发送到手机」区：检测手机在线状态，发送文本/图片到手机。
    /**
     * 设备互联抽屉组件：展示本机专属上传链接与二维码。
     * 接收由脚本自动进行（中继服务器填好后即生效），图片到达时弹出网页居中预览弹窗，弹窗内「复制到剪贴板」按钮（点击手势）真正写入剪贴板。
     * @param {object} props - 组件属性
     * @param {boolean} props.visible - 抽屉是否可见
     * @param {Function} props.setVisible - 设置可见性的回调
     * @param {string} props.relayServer - 当前中继服务器地址
     * @param {Function} props.onChangeRelayServer - 中继地址变更回调
     * @returns {object} CAT_UI React 元素
     */
    function PhoneImageDrawer({ visible, setVisible, relayServer, onChangeRelayServer }) {
        const deviceId = getDeviceId();
        const [qrUrl, setQrUrl] = CAT_UI.useState('');
        const [link, setLink] = CAT_UI.useState('');
        const [phoneOnline, setPhoneOnline] = CAT_UI.useState(false);
        const [sending, setSending] = CAT_UI.useState(false);
        const [sendText, setSendText] = CAT_UI.useState('');
        const copyLink = () => { if (link) safeCopyText(link); };

        // 计算链接 + 二维码（仅在打开抽屉或地址变化时）
        CAT_UI.useEffect(() => {
            const s = (relayServer || '').trim();
            if (!s) { setLink(''); setQrUrl(''); return; }
            const lk = s.replace(/\/+$/, '') + '/u/' + deviceId;
            setLink(lk);
            genQrDataUrl(lk).then(u => setQrUrl(u)).catch(e => { addLog('[二维码] 失败: ' + e.message, 'error', true); });
        }, [relayServer, visible]);

        // 轮询手机在线状态（每 5s），用于发送前判断是否可发
        CAT_UI.useEffect(() => {
            if (!visible || !relayServer) return;
            const server = relayServer.trim().replace(/\/+$/, '');
            let alive = true;
            const check = () => {
                if (!alive) return;
                try {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: server + '/phone/status/' + encodeURIComponent(deviceId),
                        timeout: 8000,
                        onload: (r) => {
                            if (!alive) return;
                            let j = null; try { j = JSON.parse(r.responseText); } catch (e) { j = null; }
                            setPhoneOnline(!!(j && j.online));
                        },
                        onerror: () => { if (alive) setPhoneOnline(false); }
                    });
                } catch (e) { if (alive) setPhoneOnline(false); }
            };
            check();
            const t = setInterval(check, 5000);
            return () => { alive = false; clearInterval(t); };
        }, [visible, relayServer, deviceId]);

        // 发送文本到手机
        const doSendText = () => {
            const t = (sendText || '').trim();
            if (!t) { addLog('[发送到手机] 文本为空', 'error', true); return; }
            if (!phoneOnline) { addLog('[发送到手机] 当前无在线设备，无法发送', 'error', true); return; }
            setSending(true);
            sendToPhone({
                server: relayServer, uuid: deviceId, payload: { text: t },
                onOk: () => { addLog('[发送到手机] 文本已发送', 'success'); setSendText(''); setSending(false); },
                onFail: (e) => { addLog('[发送到手机] 发送失败：' + e, 'error'); setSending(false); }
            });
        };

        // 选择图片到手机：选完仅加入「待发送」预览列表，不立即上传；点「发送」才真正发送。
        // 与手机端上传页（选图 → 下方预览 → 点发送）行为一致，避免误选即发的冲动操作。
        const [pendingImages, setPendingImages] = CAT_UI.useState([]);

        const pickImages = () => {
            if (!phoneOnline) { addLog('[发送到手机] 当前无在线设备，无法发送', 'error', true); return; }
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true; inp.style.display = 'none';
            document.body.appendChild(inp);
            inp.onchange = () => {
                const files = Array.prototype.slice.call(inp.files || []);
                inp.remove();
                if (!files.length) return;
                const arr = files.map(f => ({
                    file: f,
                    name: f.name || 'image.jpg',
                    mime: f.type || 'image/jpeg',
                    url: URL.createObjectURL(f)
                }));
                setPendingImages(prev => prev.concat(arr));
            };
            inp.click();
        };

        const removePendingImage = (i) => {
            const arr = pendingImages.slice();
            const removed = arr.splice(i, 1)[0];
            try { URL.revokeObjectURL(removed.url); } catch (e) { /* 忽略 */ }
            setPendingImages(arr);
        };

        // 真正发送：逐张顺序发送（一张成功再发下一张，保证到达顺序；失败即停并提示进度）。
        // 中继服务端手机收件通道已队列化（phonePending FIFO），连发不会互相覆盖。
        const confirmSendImage = () => {
            if (!pendingImages.length) return;
            if (!phoneOnline) { addLog('[发送到手机] 当前无在线设备，无法发送', 'error', true); return; }
            setSending(true);
            const list = pendingImages.slice();
            const total = list.length;
            let sent = 0;
            const sendNext = () => {
                if (sent >= total) {
                    addLog('[发送到手机] ' + total + ' 张图片已全部发送', 'success');
                    setSending(false);
                    setPendingImages([]);
                    return;
                }
                const it = list[sent];
                addLog('[发送到手机] 正在发送（' + (sent + 1) + '/' + total + '）：' + (it.name || 'image'), 'info');
                const rd = new FileReader();
                rd.onload = () => {
                    const b64 = (rd.result || '').split(',')[1] || '';
                    if (!b64) { addLog('[发送到手机] 第 ' + (sent + 1) + ' 张读取失败，已停止（已发 ' + sent + '/' + total + '）', 'error', true); setSending(false); return; }
                    sendToPhone({
                        server: relayServer, uuid: deviceId,
                        payload: { name: it.name, mime: it.mime, data: b64 },
                        onOk: () => { sent++; sendNext(); },
                        onFail: (e) => { addLog('[发送到手机] 第 ' + (sent + 1) + ' 张发送失败：' + e + '（已发 ' + sent + '/' + total + '）', 'error'); setSending(false); }
                    });
                };
                rd.onerror = () => { addLog('[发送到手机] 第 ' + (sent + 1) + ' 张读取失败，已停止（已发 ' + sent + '/' + total + '）', 'error', true); setSending(false); };
                rd.readAsDataURL(it.file);
            };
            sendNext();
        };

        return CAT_UI.Drawer(
            CAT_UI.createElement('div', { style: { textAlign: 'left' } }, [
                link ?
                    CAT_UI.createElement('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' } }, [
                        // 左侧：二维码
                        CAT_UI.createElement('div', { style: { flexShrink: '0' } }, [
                            qrUrl ?
                            CAT_UI.createElement('div', {
                                style: {
                                    width: '140px', height: '140px',
                                    backgroundImage: 'url("' + qrUrl + '")',
                                    backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center',
                                    border: '1px solid #eee', borderRadius: '8px'
                                }
                            }) :
                            CAT_UI.createElement('div', { style: { color: '#999', fontSize: '12px', width: '140px', textAlign: 'center' } }, '二维码生成中…（若长时间不出，请手动复制右侧链接）'),
                        ]),
                        // 右侧：链接文本 + 复制按钮
                        CAT_UI.createElement('div', { style: { flex: '1', minWidth: '180px' } }, [
                            CAT_UI.createElement('div', {
                                style: { fontSize: '12px', color: '#999', wordBreak: 'break-all', marginBottom: '8px' }
                            }, link),
                            CAT_UI.Button('复制链接', {
                                type: 'link',
                                onClick: copyLink,
                                style: { padding: '0 8px', color: '#1890ff', fontWeight: 'bold' }
                            }),
                        ]),
                    ]) :
                    CAT_UI.createElement('p', { style: { color: '#e4393c', fontSize: '13px', margin: '0' } }, '尚未配置中继服务器，请到「设置」填写。'),
                CAT_UI.Divider('发送到手机'),
                CAT_UI.createElement('p', {
                    style: { color: phoneOnline ? '#007e44' : '#e4393c', fontSize: '13px', margin: '0 0 10px', lineHeight: '1.5' }
                }, phoneOnline ? '🟢 手机已连接，可发送' : '⚪ 当前无在线设备，无法发送'),
                CAT_UI.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px' } }, [
                    CAT_UI.Input({
                        placeholder: '输入要发送到手机的文本…',
                        value: sendText,
                        onChange: (val) => {
                            const v = (typeof val === 'string') ? val : (val && val.target ? val.target.value : '');
                            setSendText(v);
                        },
                        style: { flex: '1', marginBottom: '0' }
                    }),
                    CAT_UI.Button('发送', {
                        type: 'primary',
                        disabled: !phoneOnline || sending,
                        onClick: doSendText,
                        style: { whiteSpace: 'nowrap' }
                    })
                ]),
                CAT_UI.Button('选择 / 添加图片（可多选）', {
                    disabled: !phoneOnline || sending,
                    onClick: pickImages,
                    style: { width: '100%', marginBottom: pendingImages.length ? '10px' : '0' }
                }),
                pendingImages.length > 0 ?
                    CAT_UI.createElement('div', { style: { marginBottom: '10px' } }, [
                        CAT_UI.createElement('div', {
                            style: { display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px', marginBottom: '10px' }
                        }, pendingImages.map((img, i) =>
                            CAT_UI.createElement('div', {
                                style: { position: 'relative', width: '100%', paddingBottom: '100%', backgroundImage: 'url("' + img.url + '")', backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: '8px' }
                            }, [
                                CAT_UI.Button('×', {
                                    type: 'link',
                                    onClick: () => removePendingImage(i),
                                    style: { position: 'absolute', top: '2px', right: '2px', padding: '0 6px', minWidth: '22px', height: '22px', lineHeight: '20px', fontSize: '16px', color: '#fff', background: 'rgba(0,0,0,0.55)', borderRadius: '50%' }
                                })
                            ])
                        )),
                        CAT_UI.Button(pendingImages.length > 1 ? ('发送 ' + pendingImages.length + ' 张图片到手机') : '发送图片到手机', {
                            type: 'primary',
                            disabled: !phoneOnline || sending,
                            onClick: confirmSendImage,
                            style: { width: '100%' }
                        })
                    ]) : null
            ]),
            {
                title: '手机互传',
                visible,
                width: 420,
                focusLock: true,
                autoFocus: false,
                zIndex: 10002,
                onOk: () => { setVisible(false); },
                onCancel: () => { setVisible(false); },
            }
        );
    }

    // ========== 页面启动 ==========

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMonitoring);
    } else {
        startMonitoring();
    }
})();
