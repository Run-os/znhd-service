// ==UserScript==
// @name        征纳互动人数和在线监控v2
// @namespace   https://scriptcat.org/
// @description 实施监控征纳互动等待人数和在线状态，支持语音播报、自定义常用语
// @version     26.2.23
// @author      runos
// @match       https://znhd.hunan.chinatax.gov.cn:8443/*
// @match       https://example.com/*
// @icon        https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico
// @grant       GM_addStyle
// @grant       unsafeWindow
// @grant       GM_xmlhttpRequest
// @grant       GM_setClipboard
// @grant       GM_notification
// @grant       GM_getValue
// @grant       GM_setValue
// @connect     *
// @connect     znhd-service.zeabur.app
// @connect     122050.xyz
// @connect     drop.122050.xyz
// @homepageURL    https://scriptcat.org/zh-CN/script-show-page/3650
// @require     https://scriptcat.org/lib/1167/1.0.0/%E8%84%9A%E6%9C%AC%E7%8C%ABUI%E5%BA%93.js?sha384-jXdR3hCwnDJf53Ue6XHAi6tApeudgS/wXnMYBD/ZJcgge8Xnzu/s7bkEf2tPi2KS
// @require     https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@5/dist/fp.min.js
// ==/UserScript==


// ==========配置==========
// 配置对象，集中管理可配置项
const CONFIG = {
    CHECK_INTERVAL: 3000,
    MAX_LOG_ENTRIES: 20,
    WORKING_HOURS: {
        MORNING: { START: 9, END: 12 },
        AFTERNOON: { START: 13.5, END: 18 }
    },
    didaUrl: 'https://gitee.com/runos/znhd-service/raw/master/public/dida.mp3',
    commonPhrasesUrl: 'https://gitee.com/runos/znhd-service/raw/master/public/%E5%B8%B8%E7%94%A8%E8%AF%AD.json',
    p2pConfig: {
        signalingServer: 'drop.122050.xyz',
    }
};

// ==========日志管理==========
// 全局日志状态管理
let setLogEntriesCallback = null;
// 存储上一次的日志文本（用于重复内容检测）
let lastLogMessage = null;

// 添加日志条目函数
function addLog(message, type = 'info', logenabled = false) {
    const timestamp = new Date().toTimeString().slice(0, 8);

    // 检查是否为重复内容（忽略事件等动态信息）
    const pureMessage = message;
    if (lastLogMessage && pureMessage === lastLogMessage) {
        // 如果内容相同（忽略事件），不输出本次内容
        console.log('[监控] 重复日志，已忽略:', message);
        return;
    }

    // 更新上一次的日志文本
    lastLogMessage = pureMessage;

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
const DEFAULTS = {
    voiceEnabled: true,
    isChecked: false,
};

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

// ==========UI部分==========
// 抽屉/模态框组件示例
function DM() {
    // 使用加载的数据初始化Allvalue
    const [Allvalue, setAllvalue] = CAT_UI.useState(loadAllvalue());

    // 包装setAllvalue函数，实现自动保存
    const updateAllvalue = (newValue) => {
        setAllvalue(newValue);
        // 自动保存到localStorage
        saveAllvalue(newValue);
    };
    const patchAllvalue = (kv) => updateAllvalue({ ...Allvalue, ...kv });

    // 解构状态变量，方便后续使用
    const { voiceEnabled, isChecked } = Allvalue;

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
    // P2P连接状态
    const [p2pStatus, setP2pStatus] = CAT_UI.useState({
        connected: false,
        wsConnected: false,
        deviceId: null,
        deviceName: null,
        peers: [],
        currentPartner: null
    });
    // P2P抽屉显示状态
    const [p2pDrawerVisible, setP2pDrawerVisible] = CAT_UI.useState(false);
    // P2P发送文本
    const [p2pText, setP2pText] = CAT_UI.useState('');

    // P2P状态监听
    CAT_UI.useEffect(() => {
        const handleP2PStatus = (event) => {
            setP2pStatus(event.detail);
        };
        window.addEventListener('p2pStatusChange', handleP2PStatus);
        if (window.p2pTransferClient) {
            const status = window.p2pTransferClient.getStatus();
            setP2pStatus(status);
        }
        return () => {
            window.removeEventListener('p2pStatusChange', handleP2PStatus);
        };
    }, []);

    // 设置日志回调函数
    CAT_UI.useEffect(() => {
        setLogEntriesCallback = setLogEntries;
        return () => {
            setLogEntriesCallback = null;
        };
    }, []);

    // 加载常用语数据的函数
    const loadPhrasesData = () => {
        setPhrasesLoading(true);
        GM_xmlhttpRequest({
            method: 'GET',
            url: CONFIG.commonPhrasesUrl,
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText);
                    setPhrasesData(data);
                    CAT_UI.Message.success('常用语加载成功');
                } catch (error) {
                    addLog('JSON 解析失败: ' + error.message, 'error', true);
                    CAT_UI.Message.error('JSON 解析失败: ' + error.message);
                    setPhrasesData({});
                } finally {
                    setPhrasesLoading(false);
                }
            },
            onerror: function (error) {
                addLog('加载常用语失败: ' + (error.message || error), 'error', true);
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
                    CAT_UI.Text("P2P状态: "),
                    CAT_UI.Button(
                        p2pStatus.currentPartner
                            ? (p2pStatus.deviceId || 'P2P')
                            : '未连接',
                        {
                            type: "primary",
                            onClick: () => setP2pDrawerVisible(true),
                            style: {
                                fontWeight: "bold",
                                backgroundColor: p2pStatus.wsConnected ? "#52c41a" : "#8c8c8c",
                                borderColor: p2pStatus.wsConnected ? "#52c41a" : "#8c8c8c"
                            }
                        }
                    ),
                ],
                {
                    direction: "horizontal",
                    size: "middle",
                    style: { marginBottom: "8px" }
                }
            ),

            CAT_UI.Space(
                [
                    CAT_UI.Text("语音播报状态: "),
                    CAT_UI.Button(voiceEnabledText, {
                        type: "primary",
                        onClick: () => {
                            const newVoiceEnabled = !voiceEnabled;
                            patchAllvalue({ voiceEnabled: newVoiceEnabled });  // 更新状态，触发重新渲染

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
                            //字体加粗
                            fontWeight: "bold",
                            backgroundColor: !voiceEnabled ? "#990018" : "#007e44",
                            borderColor: !voiceEnabled ? "#990018" : "#007e44",
                        }
                    }),

                ],
                {
                    direction: "horizontal", // 横向排列（默认值，可省略）
                    size: "middle", // 元素间间距（可选：small/middle/large，默认middle）
                    style: { marginBottom: "8px" } // 可选：给这一行加底部间距，避免与下方元素拥挤
                }
            ),
            CAT_UI.Space(
                [
                    CAT_UI.Button("设置", {
                        type: "primary",
                        onClick: () => setVisible(true),  // 显示抽屉
                    }),
                    CAT_UI.Button("常用语", {
                        type: "primary",
                        onClick() {
                            setCommonPhrasesVisible(true);
                        },
                    }),

                ],

                {
                    direction: "horizontal", // 横向排列（默认值，可省略）
                    size: "middle", // 元素间间距（可选：small/middle/large，默认middle）
                }
            ),

            //抽屉
            CAT_UI.Space(
                [
                    // 设置抽屉组件
                    CAT_UI.Drawer(
                        // 抽屉内容
                        CAT_UI.createElement("div", { style: { textAlign: "left" } }, [
                            CAT_UI.Space(
                                [
                                    CAT_UI.Button("[脚本主页]", {
                                        type: "link",
                                        onClick: () => {
                                            window.open('https://scriptcat.org/zh-CN/script-show-page/3650', '_blank');
                                        },
                                        style: {
                                            padding: "0 8px"
                                            //蓝色字体
                                            , color: "#1890ff", fontWeight: "bold"
                                        }
                                    }),
                                    CAT_UI.Button("[使用教程]", {
                                        type: "link",
                                        onClick: () => {
                                            window.open('https://flowus.cn/runos/share/e48623a2-f273-4327-8597-639e08902be8?code=1YD5Z5', '_blank');
                                        },
                                        style: {
                                            padding: "0 8px"
                                            //蓝色字体
                                            , color: "#1890ff", fontWeight: "bold"
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

                            CAT_UI.Divider("其他设置"),  // 带文本的分隔线

                            CAT_UI.Divider("日志内容"),  // 日志标题分隔线
                            CAT_UI.createElement(
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
                                    // 根据日志类型定义颜色
                                    const colorMap = {
                                        info: "#1890ff",      // 蓝色
                                        warning: "#faad14",   // 橙黄色
                                        success: "#52c41a",   // 绿色
                                        error: "#ff4d4f"      // 红色
                                    };
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
                                                fontWeight: "bold"  // 加粗
                                            }
                                        },
                                        `${entry.timestamp} - ${entry.message}`
                                    );
                                })
                            ),
                        ]),
                        // 抽屉属性
                        {
                            title: "设置菜单",  // 抽屉标题
                            visible,  // 控制显示/隐藏
                            width: 400,  // 抽屉宽度（像素）
                            focusLock: true,  // 聚焦锁定
                            autoFocus: false,  // 禁用自动聚焦
                            zIndex: 10000,  // 层级
                            onOk: () => { setVisible(false); },  // 确定按钮回调
                            onCancel: () => { setVisible(false); },  // 取消按钮回调
                        }
                    ),
                    // 常用语抽屉组件
                    CAT_UI.Drawer(
                        // 抽屉内容
                        CAT_UI.createElement("div", { style: { textAlign: "left" } }, [
                            // 显示当前JsonUrl
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
                            CAT_UI.Divider("常用语列表"),
                            // 动态生成常用语按钮
                            phrasesLoading ?
                                CAT_UI.createElement("div", { style: { textAlign: "center", padding: "20px" } }, "加载中...") :
                                (Object.keys(phrasesData).length === 0 ?
                                    CAT_UI.createElement("div", { style: { textAlign: "center", padding: "20px", color: "#999" } }, "暂无常用语数据，请点击上方按钮加载") :
                                    CAT_UI.Space(
                                        Object.entries(phrasesData).map(([key, value]) =>
                                            CAT_UI.Button(key, {
                                                type: "default",
                                                onClick() {
                                                    safeCopyText(value);
                                                    //CAT_UI.Message.success("已复制: " + key);
                                                    setCommonPhrasesVisible(false);
                                                    // 2. 把 value 追加到 TinyMCE 已有内容后面
                                                    appendToTinyMCE(value);
                                                    addLog(`添加文本: ${value}`, 'success');
                                                    CAT_UI.Message.success("添加文本: " + value);
                                                },
                                                style: { marginBottom: "8px", width: "100%" }
                                            })
                                        ),
                                        { direction: "vertical", style: { width: "100%" } }
                                    )
                                ),
                            CAT_UI.Divider(""),
                        ]),
                        // 抽屉属性
                        {
                            title: "常用语",
                            visible: commonPhrasesVisible,
                            width: 400,
                            focusLock: true,
                            autoFocus: false,
                            zIndex: 10001,  // 比设置抽屉层级高一点
                            onOk: () => { setCommonPhrasesVisible(false); },
                            onCancel: () => { setCommonPhrasesVisible(false); },
                        }
                    ),
                    // P2P传输抽屉组件
                    CAT_UI.Drawer(
                        CAT_UI.createElement("div", { style: { textAlign: "left" } }, [
                            CAT_UI.Divider("连接状态"),
                            CAT_UI.createElement("div", { style: { marginBottom: "16px" } }, [
                                CAT_UI.Space([
                                    CAT_UI.Text("设备ID: "),
                                    CAT_UI.Text(p2pStatus.deviceId || '--', { style: { fontWeight: "bold" } }),
                                    CAT_UI.Button("复制", {
                                        type: "link",
                                        onClick: () => {
                                            if (p2pStatus.deviceId) {
                                                safeCopyText(p2pStatus.deviceId);
                                                CAT_UI.Message.success('已复制设备ID');
                                            }
                                        }
                                    })
                                ], { direction: "horizontal" })
                            ]),
                            CAT_UI.Space([
                                CAT_UI.Text("配对: "),
                                p2pStatus.currentPartner ? [
                                    CAT_UI.Text(
                                        p2pStatus.dataChannelReady
                                            ? p2pStatus.currentPartner
                                            : "连接中...",
                                        {
                                            style: {
                                                fontWeight: "bold",
                                                color: p2pStatus.dataChannelReady ? "#52c41a" : "#faad14"
                                            }
                                        }
                                    ),
                                    CAT_UI.Button("断开连接", {
                                        type: "danger",
                                        size: "small",
                                        onClick: () => {
                                            if (window.p2pTransferClient) {
                                                window.p2pTransferClient.disconnect();
                                            }
                                        }
                                    })
                                ] : [
                                    CAT_UI.Text("未连接", {
                                        style: { color: "#ff4d4f" }
                                    })
                                ],
                            ], { direction: "horizontal", style: { marginBottom: "16px" } }),

                            CAT_UI.Divider("可用设备"),
                            p2pStatus.peers?.length > 0 ?
                                CAT_UI.Space(
                                    p2pStatus.peers.map(peer =>
                                        CAT_UI.createElement("div", {
                                            style: {
                                                padding: "10px",
                                                background: "#f5f5f5",
                                                borderRadius: "4px",
                                                marginBottom: "8px",
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center"
                                            }
                                        }, [
                                            CAT_UI.Text(peer.name || peer.id),
                                            CAT_UI.Button("配对", {
                                                type: "primary",
                                                size: "small",
                                                onClick: () => {
                                                    if (window.p2pTransferClient) {
                                                        window.p2pTransferClient.requestPair(peer.id);
                                                    }
                                                },
                                                disabled: !!p2pStatus.currentPartner
                                            })
                                        ])
                                    ),
                                    { direction: "vertical", style: { width: "100%" } }
                                ) :
                                CAT_UI.createElement("div", {
                                    style: { textAlign: "center", padding: "20px", color: "#999" }
                                }, "暂无可用设备"),

                            p2pStatus.currentPartner ? [
                                CAT_UI.createElement("div", { style: { marginBottom: "12px" } }, [
                                    CAT_UI.createElement("textarea", {
                                        rows: 3,
                                        placeholder: p2pStatus.dataChannelReady ? "输入要发送的文本..." : "等待P2P连接建立...",
                                        disabled: !p2pStatus.dataChannelReady,
                                        value: p2pText,
                                        onChange: (e) => setP2pText(e.target.value),
                                        style: {
                                            width: "100%",
                                            padding: "8px",
                                            border: "1px solid #d9d9d9",
                                            borderRadius: "4px",
                                            fontSize: "13px",
                                            resize: "vertical",
                                            backgroundColor: p2pStatus.dataChannelReady ? "#fff" : "#f5f5f5"
                                        }
                                    }),
                                    CAT_UI.Button("发送文本", {
                                        type: "primary",
                                        disabled: !p2pStatus.dataChannelReady,
                                        style: { marginTop: "8px", width: "100%" },
                                        onClick: () => {
                                            if (window.p2pTransferClient && p2pText.trim()) {
                                                window.p2pTransferClient.sendText(p2pText);
                                                setP2pText('');
                                            }
                                        }
                                    })
                                ]),
                            ] : null,
                        ]),
                        {
                            title: "P2P局域网传输",
                            visible: p2pDrawerVisible,
                            width: 400,
                            focusLock: true,
                            autoFocus: false,
                            zIndex: 10002,
                            onOk: () => { setP2pDrawerVisible(false); },
                            onCancel: () => { setP2pDrawerVisible(false); },
                        }
                    ),
                ],
                {
                    direction: "horizontal", // 横向排列（默认值，可省略）
                    size: "middle", // 元素间间距（可选：small/middle/large，默认middle）
                }
            ),
        ],
        { direction: "vertical" }  // 垂直排列
    );
}

CAT_UI.createPanel({
    // 强制固定Drawer和Panel位置

    header: {
        title: CAT_UI.Space(
            [
                CAT_UI.Icon.ScriptCat({
                    style: { width: "24px", verticalAlign: "middle" },
                    draggable: "false",
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

    // 面板初始位置
    point: {
        x: window.screen.width - 500,  // 距离右侧400px
        y: 20  // 距离顶部20px
    },

});

// ==========监控部分==========
// 工具函数：获取当前小时（支持小数）
function getCurrentHour() {
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60;
}

// 检查是否在工作时间内
function isWorkingHours() {
    const currentHour = getCurrentHour();
    return (currentHour >= CONFIG.WORKING_HOURS.MORNING.START && currentHour <= CONFIG.WORKING_HOURS.MORNING.END) ||
        (currentHour >= CONFIG.WORKING_HOURS.AFTERNOON.START && currentHour <= CONFIG.WORKING_HOURS.AFTERNOON.END);
}

// 缓存DOM元素引用
const domCache = {
    ocurrentElement: null,
    offlineElement: null
};

// 检测DOM元素是否仍然存在于文档中
function isElementInDocument(element) {
    return element && element.isConnected;
}

// 修改主要检测函数
function checkCount() {
    if (!isWorkingHours()) {
        //addLog('当前不在工作时间，已停止脚本', 'warning');
        return;
    }

    try {
        // 获取等待人数 - 使用更灵活的选择器
        // 检查缓存的元素是否还存在，不存在则重新查找
        if (!isElementInDocument(domCache.ocurrentElement)) {
            domCache.ocurrentElement = null;
        }
        if (!domCache.ocurrentElement) {
            domCache.ocurrentElement = document.querySelector('.count:nth-child(2)');
        }

        if (!isElementInDocument(domCache.offlineElement)) {
            domCache.offlineElement = null;
        }
        if (!domCache.offlineElement) {
            domCache.offlineElement = document.querySelector('.t-dialog__body__icon');
        }

        const ocurrentElement = domCache.ocurrentElement;
        if (!ocurrentElement) {
            addLog('找不到人数元素', 'warning');
            speak("找不到人数元素");
            return;
        }

        const currentCount = parseInt(ocurrentElement.textContent.trim());
        // 检查currentCount是否为有效数字
        if (isNaN(currentCount)) {
            addLog(`无法解析等待人数，元素内容: "${ocurrentElement.textContent.trim()}"`, 'warning');
            return;
        }

        // 更新人数状态日志和语音提示
        if (currentCount === 0) {
            addLog('当前等待人数为0', 'success');
        } else if (currentCount < 10) {
            addLog(`当前等待人数: ${currentCount}`, 'info');
            speak("征纳互动有人来了");
        } else {
            // 添加更多人数的情况处理
            addLog(`当前等待人数: ${currentCount}`, 'info');
        }

        const offlineEl = domCache.offlineElement;
        if (offlineEl?.textContent.includes('掉线')) {
            addLog('征纳互动已掉线', 'error');
            speak("征纳互动已掉线");
            return;  // 移除返回值
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
    // HTML转义函数
    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

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
    addLog('已使用<br>换行追加并同步: ' + finalText, 'success', true);
    return finalText;
}


// 语音播报函数
const speechQueue = [];
let isSpeaking = false;

function speak(text) {
    // 从localStorage获取语音状态
    const savedData = loadAllvalue();
    const voiceEnabled = savedData.voiceEnabled;

    if (!voiceEnabled || !('speechSynthesis' in window)) { return; }

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

    utterance.onend = () => {
        isSpeaking = false;
        processSpeechQueue();
    };

    utterance.onerror = (event) => {
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
});


// 播放提示音函数
function playDidaSound() {
    if (!CONFIG.didaUrl) return;
    try {
        const player = new Audio();
        player.src = CONFIG.didaUrl;
        player.volume = 0.5;
        player.play().catch(() => { });
    } catch (e) { }
}

// 安全复制工具：仅在页面聚焦且支持 clipboard 时尝试复制
function safeCopyText(text) {
    if (!text) return;
    // 1) 优先使用 GM_setClipboard（无需焦点）
    if (typeof GM_setClipboard === 'function') {
        try {
            GM_setClipboard(text);
            CAT_UI.Message.info(text);
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
            CAT_UI.Message.info(text);
            addLog('[复制] 已复制到剪贴板 (navigator.clipboard)', 'success', true);
            playDidaSound();
        }).catch(err => {
            addLog('[复制] 复制到剪贴板失败: ' + err.message, 'error', true);
        });
        return;
    }
}

// 格式化字节大小为易读单位（通用函数）
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function isBase64ImageString(text) {
    if (typeof text !== 'string') { return false; }
    const trimmed = text.trim();
    if (trimmed.startsWith('data:image/') && trimmed.includes(';base64,')) { return true; }
    if (trimmed.length < 100) { return false; }
    const cleaned = trimmed.replace(/\s+/g, '');
    return /^[A-Za-z0-9+/]+={0,2}$/.test(cleaned);
}

function buildDataUrlFromBase64(text) {
    if (text.startsWith('data:image/')) { return text; }
    return `data:image/png;base64,${text}`;
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function convertImageBlobToPng(blob) {
    try {
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } catch (err) {
        addLog('[复制] 转换图片为 PNG 失败: ' + err.message, 'error', true);
        return blob; // 退化：返回原始 blob 继续尝试
    }
}

// 图片复制函数（通用版本，用于监控部分）
async function copyBase64ImageToClipboard(text) {
    try {
        const dataUrl = buildDataUrlFromBase64(text.trim());
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const pngBlob = await convertImageBlobToPng(blob);
        const mime = 'image/png';

        // 首选 Clipboard API（强制使用 PNG 以兼容多数实现）
        if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && typeof window.ClipboardItem === 'function') {
            try {
                await navigator.clipboard.write([new ClipboardItem({ [mime]: pngBlob })]);
                playDidaSound();
                addLog('图片已复制到剪贴板', 'success');
                return true;
            } catch (clipErr) {
                addLog('[复制] Clipboard API 图片写入失败: ' + clipErr.message, 'error', true);
            }
        }

        // 退化方案：尝试 GM_setClipboard 写入 dataURL
        if (typeof GM_setClipboard === 'function') {
            try {
                const b64DataUrl = await blobToBase64(pngBlob);
                GM_setClipboard(b64DataUrl, { type: 'image', mimetype: mime });
                playDidaSound();
                addLog('图片已复制到剪贴板 (GM_setClipboard)', 'success');
                return true;
            } catch (gmErr) {
                addLog('[复制] GM_setClipboard 图片写入失败: ' + gmErr.message, 'error', true);
            }
        }

        addLog('当前环境不支持图片剪贴板写入', 'warning');
        return false;
    } catch (err) {
        addLog('[复制] 复制图片到剪贴板失败: ' + err.message, 'error', true);
        addLog(`复制图片到剪贴板失败: ${err && err.message ? err.message : '未知错误'}`, 'error');
        return false;
    }
}

// ========== P2P局域网传输功能 ==========
class P2PTransferClient {
    constructor() {
        this.ws = null;
        this.deviceId = null;
        this.deviceName = null;
        this.wsConnected = false;
        this.peers = [];
        this.currentPartner = null;
        this.isInitiator = false;
        this.peerConnection = null;
        this.dataChannel = null;
        this.fileChunkSize = 16384;
        this.currentFileTransfer = null;
        this.heartbeatTimer = null;
        this.reconnecting = false;
        this.init();
    }

    init() {
        this.deviceId = null;
        this.deviceName = this.getDeviceName();
        this.connectWebSocket();
    }

    getDeviceName() {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = 'ZNHD-';
        for (let i = 0; i < 6; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    getWebSocketURL() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${CONFIG.p2pConfig.signalingServer}/ws`;
    }

    connectWebSocket() {
        if (this.reconnecting) {
            return;
        }
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            return;
        }

        this.reconnecting = false;

        try {
            console.log('[P2P] 尝试连接WebSocket...');
            this.ws = new WebSocket(this.getWebSocketURL());
            this.ws.onopen = () => {
                console.log('[P2P] WebSocket已连接');
                this.reconnecting = false;
                this.wsConnected = true;
                this.send({ type: 'register', deviceId: this.deviceId, deviceName: this.deviceName });
                this.startHeartbeat();
                this.updateStatus();
            };
            this.ws.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
            this.ws.onclose = () => {
                console.log('[P2P] WebSocket断开');
                this.reconnecting = false;
                this.wsConnected = false;
                this.stopHeartbeat();

                // 仅当之前已连接时才清理配对（区分主动断开和异常断开）
                if (this.deviceId) {
                    this.cleanupAfterDisconnect();
                }

                this.updateStatus();
                this.reconnecting = true;
                setTimeout(() => this.connectWebSocket(), 5000);
            };
            this.ws.onerror = (error) => {
                console.error('[P2P] WebSocket错误:', error);
            };
        } catch (error) {
            console.error('[P2P] WebSocket连接失败:', error);
            this.reconnecting = true;
            setTimeout(() => this.connectWebSocket(), 5000);
        }
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping' });
            }
        }, 30000);
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    handleMessage(message) {
        switch (message.type) {
            case 'welcome':
                if (message.id) {
                    this.deviceId = message.id;
                    this.updateStatus();
                }
                break;
            case 'client-list':
                this.peers = message.clients.filter(c => c.id !== this.deviceId);
                this.updateStatus();
                break;
            case 'pong':
                break;
            case 'pair-request':
                this.handlePairRequest(message);
                break;
            case 'pair-success':
                this.currentPartner = message.partnerId;
                this.isInitiator = true;
                this.createPeerConnection();
                this.updateStatus();
                break;
            case 'pair-accept':
                this.currentPartner = message.requesterId;
                this.isInitiator = false;
                this.createPeerConnection();
                this.updateStatus();
                break;
            case 'pair-rejected':
            case 'pair-error':
                CAT_UI.Message.warning(message.message || '配对请求被拒绝');
                this.updateStatus();
                break;
            case 'webrtc-signal':
                this.handleWebRTCSignal(message.signal);
                break;
            case 'partner-disconnected':
                this.disconnectPeer();
                CAT_UI.Message.warning('对方已断开连接');
                break;
            case 'client-disconnected':
                if (message.clientId === this.currentPartner) {
                    this.cleanupAfterDisconnect();
                }
                break;
        }
    }

    handlePairRequest(message) {
        if (this.peers.length === 1) {
            this.send({ type: 'pair-accept', requesterId: message.requesterId });
        } else {
            CAT_UI.Message.info(`收到来自 ${message.requesterId} 的配对请求`);
            this.send({ type: 'pair-accept', requesterId: message.requesterId });
        }
    }

    requestPair(targetId) {
        if (this.currentPartner) {
            CAT_UI.Message.warning('当前已配对，请先断开');
            return;
        }
        this.send({ type: 'pair-request', targetId: targetId });
        CAT_UI.Message.info('已发送配对请求');
    }

    createPeerConnection() {
        const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        this.peerConnection = new RTCPeerConnection(config);

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.send({ type: 'webrtc-signal', targetId: this.currentPartner, signal: { type: 'ice-candidate', candidate: event.candidate } });
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            if (this.peerConnection.connectionState === 'connected') {
                CAT_UI.Message.success('P2P连接已建立');
            }
        };

        if (this.isInitiator) {
            this.dataChannel = this.peerConnection.createDataChannel('data', { ordered: true });
            this.setupDataChannel();
            this.peerConnection.createOffer().then(offer => this.peerConnection.setLocalDescription(offer))
                .then(() => {
                    this.send({ type: 'webrtc-signal', targetId: this.currentPartner, signal: { type: 'offer', sdp: this.peerConnection.localDescription } });
                });
        } else {
            this.peerConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannel();
            };
        }
    }

    setupDataChannel() {
        this.dataChannel.onopen = () => {
            console.log('[P2P] 数据通道已打开');
            CAT_UI.Message.success('数据通道已打开');
            this.updateStatus();
        };
        this.dataChannel.onmessage = (e) => this.handleDataMessage(e.data);
        this.dataChannel.onclose = () => {
            console.log('[P2P] 数据通道已关闭');
            CAT_UI.Message.warning('数据通道已关闭');
            this.updateStatus();
        };
    }

    handleWebRTCSignal(signal) {
        if (!this.peerConnection) {
            this.createPeerConnection();
        }

        if (signal.type === 'offer') {
            this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp))
                .then(() => this.peerConnection.createAnswer())
                .then(answer => this.peerConnection.setLocalDescription(answer))
                .then(() => {
                    this.send({ type: 'webrtc-signal', targetId: this.currentPartner, signal: { type: 'answer', sdp: this.peerConnection.localDescription } });
                });
        } else if (signal.type === 'answer') {
            if (this.peerConnection.signalingState === 'have-local-offer') {
                this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
            }
        } else if (signal.type === 'ice-candidate') {
            if (this.peerConnection.remoteDescription) {
                this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
            }
        }
    }

    handleDataMessage(data) {
        if (typeof data === 'string') {
            try {
                const message = JSON.parse(data);
                if (message.type === 'text') {
                    this.handleReceivedText(message.content);
                } else if (message.type === 'file-header') {
                    this.currentFileTransfer = {
                        name: message.name,
                        size: message.size,
                        chunks: [],
                        receivedBytes: 0
                    };
                    CAT_UI.Message.info(`开始接收文件: ${message.name}`);
                }
            } catch (e) { }
        } else if (data instanceof ArrayBuffer) {
            if (this.currentFileTransfer) {
                this.currentFileTransfer.chunks.push(new Uint8Array(data));
                this.currentFileTransfer.receivedBytes += data.byteLength;
                if (this.currentFileTransfer.receivedBytes >= this.currentFileTransfer.size) {
                    this.saveReceivedFile();
                }
            }
        }
    }

    async handleReceivedText(text) {
        const success = await safeCopyText(text);
        if (success) {
            CAT_UI.Message.success('收到文本，已复制到剪贴板');
            playDidaSound();
        }
    }

    saveReceivedFile() {
        const blob = new Blob(this.currentFileTransfer.chunks);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = this.currentFileTransfer.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        CAT_UI.Message.success(`文件已下载: ${this.currentFileTransfer.name}`);
        this.currentFileTransfer = null;
    }

    sendText(text) {
        if (!this.currentPartner) {
            CAT_UI.Message.warning('未配对设备');
            return;
        }
        if (!this.peerConnection) {
            CAT_UI.Message.warning('P2P连接正在建立中，请稍候');
            return;
        }
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify({ type: 'text', content: text }));
            CAT_UI.Message.success('文本已发送');
        } else {
            CAT_UI.Message.warning('数据通道未就绪，请稍候再试');
        }
    }

    disconnect() {
        this.disconnectPeer();
        this.send({ type: 'disconnect' });
        CAT_UI.Message.info('已断开连接');
    }

    disconnectPeer() {
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        this.currentPartner = null;
        this.isInitiator = false;
        this.updateStatus();
    }

    cleanupAfterDisconnect() {
        console.log('[P2P] 清理配对连接');
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        this.currentPartner = null;
        this.isInitiator = false;
        this.updateStatus();
    }

    updateStatus() {
        const status = this.getStatus();
        window.dispatchEvent(new CustomEvent('p2pStatusChange', { detail: status }));
    }

    getStatus() {
        return {
            connected: this.wsConnected && !!this.currentPartner,
            wsConnected: this.wsConnected,
            deviceId: this.deviceId,
            deviceName: this.deviceName,
            peers: this.peers,
            currentPartner: this.currentPartner,
            dataChannelReady: !!(this.dataChannel && this.dataChannel.readyState === 'open')
        };
    }
}

let p2pTransferClient = null;

function initP2PTransfer() {
    p2pTransferClient = new P2PTransferClient();
    window.p2pTransferClient = p2pTransferClient;
    addLog('[P2P] P2P传输功能已启动', 'success', true);
}

// ========== 页面启动 ==========
initP2PTransfer();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMonitoring);
} else {
    startMonitoring();
}
