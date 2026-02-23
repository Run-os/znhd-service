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
// @homepageURL    https://scriptcat.org/zh-CN/script-show-page/3650
// @require     https://scriptcat.org/lib/1167/1.0.0/%E8%84%9A%E6%9C%AC%E7%8C%ABUI%E5%BA%93.js?sha384-jXdR3hCwnDJf53Ue6XHAi6tApeudgS/wXnMYBD/ZJcgge8Xnzu/s7bkEf2tPi2KS
// @require     https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@5/dist/fp.min.js
// @require     https://fastly.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js
// ==/UserScript==


// ==========配置==========
// 配置对象，集中管理可配置项
const CONFIG = {
    // 检查间隔（毫秒）
    CHECK_INTERVAL: 3000,
    // 最大日志条目数
    MAX_LOG_ENTRIES: 20,
    WORKING_HOURS: {
        MORNING: { START: 9, END: 12 },
        AFTERNOON: { START: 13.5, END: 18 }
    },
    didaUrl: 'https://cdn.jsdelivr.net/gh/Run-os/UserScript/%E5%B7%A5%E4%BD%9C%E7%9B%B8%E5%85%B3/znhd/dida.mp3',
    commonPhrasesUrl: 'https://gitee.com/runos/other/raw/master/znhd/%E5%B8%B8%E7%94%A8%E8%AF%AD.json',
    // 麒麟传送相关配置（局域网P2P服务）
    qilinConfig: {
        host: 'drop.122050.xyz',
        //可选：qilindrop.cn || node-snapdrop.onrender.com || drop.122050.xyz
    }
};

// ==========麒麟传送二维码显示函数==========
function showQilinQRCode() {
    // 生成二维码URL（使用qilinConfig.host）
    const host = CONFIG.qilinConfig.host;
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const qrUrl = `${protocol}//${host}`;

    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.id = 'temp-qr-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:99999;display:flex;align-items:center;justify-content:center;';

    // 创建内容容器
    const content = document.createElement('div');
    content.id = 'temp-qr-content';
    content.style.cssText = 'background:white;padding:20px;border-radius:8px;text-align:center;max-width:320px;position:relative;cursor:default;';

    // 添加关闭按钮
    const closeBtn = document.createElement('span');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = 'position:absolute;top:8px;right:12px;font-size:24px;cursor:pointer;color:#999;line-height:1;';
    closeBtn.title = '点击关闭';
    closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        document.body.removeChild(overlay);
    });
    content.appendChild(closeBtn);

    // 添加标题
    const title = document.createElement('h3');
    title.textContent = '麒麟传送连接二维码';
    title.style.cssText = 'margin:0 0 15px;font-size:16px;color:#333;';
    content.appendChild(title);

    // 二维码和URL
    const qrDiv = document.createElement('div');
    qrDiv.id = 'temp-qrcode';
    content.appendChild(qrDiv);

    const urlText = document.createElement('p');
    urlText.style.cssText = 'margin:15px 0 0;font-size:13px;color:#666;word-break:break-all;';
    urlText.textContent = qrUrl;
    content.appendChild(urlText);

    // 5秒后关闭提示
    const tip = document.createElement('p');
    tip.style.cssText = 'margin:15px 0 0;font-size:12px;color:#999;';
    tip.textContent = '5秒后自动关闭';
    content.appendChild(tip);

    // 点击遮罩层关闭
    overlay.addEventListener('click', function (e) {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });

    overlay.appendChild(content);
    document.body.appendChild(overlay);

    // 生成二维码
    if (typeof QRCode !== 'undefined') {
        new QRCode(qrDiv, {
            text: qrUrl,
            width: 200,
            height: 200,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
        addLog(`[麒麟传送] 显示连接二维码: ${qrUrl}`, 'info', true);
    } else {
        content.innerHTML += '<p style="color:red;">二维码库未加载</p>';
    }

    // 5秒后自动关闭
    setTimeout(() => {
        if (document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    }, 5000);
}

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
    // qilindrop相关默认值
    qilindropEnabled: true,          // 启用qilindrop局域网传输
    autoCopyEnabled: true,           // 自动复制图片/文本到剪贴板
    autoDownloadEnabled: true,       // 自动下载其他文件
    iframeEnabled: true,            // 启用iframe嵌入
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
    // 麒麟传送连接状态
    const [qilinStatus, setQilinStatus] = CAT_UI.useState({ connected: false, peerCount: 0 });

    // 监听麒麟传送连接状态变化
    CAT_UI.useEffect(() => {
        const handleStatusChange = (event) => {
            // 获取最新状态
            const status = window.qilinClient ? window.qilinClient.getStatus() : null;
            setQilinStatus({
                connected: event.detail.connected,
                peerCount: event.detail.peerCount || 0,
                displayName: status?.displayName || ''
            });
        };
        window.addEventListener('qilinConnectionStatusChange', handleStatusChange);
        // 初始状态
        if (window.qilinClient) {
            const status = window.qilinClient.getStatus();
            setQilinStatus({
                connected: status.connected,
                peerCount: status.peers.length,
                displayName: status.displayName || ''
            });
        }
        return () => {
            window.removeEventListener('qilinConnectionStatusChange', handleStatusChange);
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
                    CAT_UI.Text("麒麟传送: "),
                    CAT_UI.Button(
                        qilinStatus.connected
                            ? `已连接(${qilinStatus.displayName || '未知'})`
                            : '未连接',
                        {
                            type: "primary",
                            onClick: () => showQilinQRCode(),
                            style: {
                                fontWeight: "bold",
                                backgroundColor: qilinStatus.connected ? "#52c41a" : "#ff4d4f",
                                borderColor: qilinStatus.connected ? "#52c41a" : "#ff4d4f"
                            }
                        }
                    ),
                ],
                {
                    direction: "horizontal", // 横向排列（默认值，可省略）
                    size: "middle", // 元素间间距（可选：small/middle/large，默认middle）
                    style: { marginBottom: "8px" } // 可选：给这一行加底部间距，避免与下方元素拥挤
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

                            CAT_UI.Checkbox("自动复制图片/文本到剪贴板", {
                                checked: Allvalue.autoCopyEnabled !== false,
                                onChange(checked) {
                                    patchAllvalue({ autoCopyEnabled: checked });
                                    addLog(`自动复制: ${checked}`, 'info');
                                }
                            }),

                            CAT_UI.Checkbox("自动下载其他文件", {
                                checked: Allvalue.autoDownloadEnabled !== false,
                                onChange(checked) {
                                    patchAllvalue({ autoDownloadEnabled: checked });
                                    addLog(`自动下载: ${checked}`, 'info');
                                }
                            }),
                            // 日志显示区域
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
        addLog('当前不在工作时间，已停止脚本', 'warning');
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


// 安全复制工具：仅在页面聚焦且支持 clipboard 时尝试复制
function safeCopyText(text) {
    if (!text) return;
    // 1) 优先使用 GM_setClipboard（无需焦点）
    if (typeof GM_setClipboard === 'function') {
        try {
            GM_setClipboard(text);
            addLog('[复制] 已复制到剪贴板 (GM_setClipboard)', 'success', true);
            const player = new Audio();
            player.src = CONFIG.didaUrl;
            player.play();
            return;
        } catch (e) {
            addLog('[复制] GM_setClipboard 失败: ' + e.message, 'error', true);
        }
    }

    // 2) 浏览器异步 clipboard API
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(() => {
            addLog('[复制] 已复制到剪贴板 (navigator.clipboard)', 'success', true);
            const player = new Audio();
            player.src = CONFIG.didaUrl;
            player.play();
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
                const player = new Audio();
                player.src = CONFIG.didaUrl;
                player.play();
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
                const player = new Audio();
                player.src = CONFIG.didaUrl;
                player.play();
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

// ========== qilindrop 局域网传输功能 ==========

// 存储键名
const DEVICE_NAME_KEY = 'qilindrop_deviceName';

// 获取设备名（优先使用自定义，否则生成默认）
function getDeviceName() {
    const saved = localStorage.getItem(DEVICE_NAME_KEY);
    if (saved && saved.trim()) {
        return saved.trim();
    }
    // 生成随机设备名
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'ZNHD-';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    localStorage.setItem(DEVICE_NAME_KEY, result);
    return result;
}

// ========== 麒麟传送（P2P局域网传输） ==========
let qilinClient = null;

// 麒麟传送工具函数
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

// 麒麟传送音效函数
function qilinPlaySound() {
    if (!CONFIG.didaUrl) return;
    try {
        const audio = new Audio(CONFIG.didaUrl);
        audio.volume = 0.5;
        audio.play().catch(err => {
            // 静默处理自动播放限制等常见错误
        });
    } catch (err) {
        // 静默处理
    }
}

// 麒麟传送安全复制文本函数
async function qilinSafeCopyText(text) {
    if (!text) return false;
    if (typeof GM_setClipboard === 'function') {
        try {
            GM_setClipboard(text);
            addLog('[麒麟传送] 文本已复制 (GM_setClipboard)', 'success', true);
            qilinPlaySound();
            return true;
        } catch (e) {
            addLog('[麒麟传送] GM_setClipboard 失败: ' + e.message, 'error', true);
        }
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(text);
            addLog('[麒麟传送] 文本已复制 (navigator.clipboard)', 'success', true);
            qilinPlaySound();
            return true;
        } catch (err) {
            addLog('[麒麟传送] navigator.clipboard 失败: ' + err.message, 'error', true);
        }
    }
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const success = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (success) {
            addLog('[麒麟传送] 文本已复制 (execCommand)', 'success', true);
            qilinPlaySound();
            return true;
        }
    } catch (err) {
        addLog('[麒麟传送] execCommand 失败: ' + err.message, 'error', true);
    }
    return false;
}

// 麒麟传送复制图片到剪贴板函数
async function qilinCopyImageToClipboard(blob, originalFilename = '') {
    try {
        const pngBlob = await convertImageBlobToPng(blob);
        const mime = 'image/png';
        if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && typeof window.ClipboardItem === 'function') {
            try {
                await navigator.clipboard.write([new ClipboardItem({ [mime]: pngBlob })]);
                addLog('[麒麟传送] 图片已复制 (Clipboard API)', 'success', true);
                qilinPlaySound();
                return true;
            } catch (clipErr) {
                addLog('[麒麟传送] Clipboard API 失败: ' + clipErr.message, 'error', true);
            }
        }
        if (typeof GM_setClipboard === 'function') {
            try {
                const dataUrl = await blobToBase64(pngBlob);
                GM_setClipboard(dataUrl, { type: 'image', mimetype: mime });
                addLog('[麒麟传送] 图片已复制 (GM_setClipboard)', 'success', true);
                qilinPlaySound();
                return true;
            } catch (gmErr) {
                addLog('[麒麟传送] GM_setClipboard 图片失败: ' + gmErr.message, 'error', true);
            }
        }
        addLog('[麒麟传送] 当前环境不支持图片剪贴板，降级为下载', 'warning', true);
        return false;
    } catch (err) {
        addLog('[麒麟传送] 复制图片失败: ' + err.message, 'error', true);
        return false;
    }
}

// 麒麟传送复制Base64图片到剪贴板函数
async function qilinCopyBase64ImageToClipboard(text) {
    try {
        const dataUrl = buildDataUrlFromBase64(text.trim());
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return await qilinCopyImageToClipboard(blob);
    } catch (err) {
        addLog('[麒麟传送] 复制 Base64 图片失败: ' + err.message, 'error', true);
        return false;
    }
}

// 麒麟传送客户端类
class QilinDropClient {
    constructor() {
        this.socket = null;
        this.peerId = null;
        this.connected = false;
        this.peers = new Map();
        this.rtcPeers = new Map();
        this.currentFile = null;
        this.displayName = null;  // 保存显示名称
        this.init();
    }

    async init() {
        this.peerId = await this.getPeerId();
        addLog('[麒麟传送] 设备ID: ' + this.peerId, 'info', true);
        this.connect();
    }

    generateUUID() {
        let uuid = '';
        for (let ii = 0; ii < 32; ii++) {
            switch (ii) {
                case 8:
                case 20:
                    uuid += '-';
                    uuid += (Math.random() * 16 | 0).toString(16);
                    break;
                case 12:
                    uuid += '-';
                    uuid += '4';
                    break;
                case 16:
                    uuid += '-';
                    uuid += (Math.random() * 4 | 8).toString(16);
                    break;
                default:
                    uuid += (Math.random() * 16 | 0).toString(16);
            }
        }
        return uuid;
    }

    async getPeerId() {
        let peerId = GM_getValue('qilin_peer_id');
        if (!peerId) {
            peerId = this.generateUUID();
            GM_setValue('qilin_peer_id', peerId);
        }
        return peerId;
    }

    getWebSocketURL() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const port = CONFIG.qilinConfig.port ? `:${CONFIG.qilinConfig.port}` : '';
        const isRtcSupported = !!(window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection);
        const nortc = isRtcSupported ? '' : '/nortc';
        return `${protocol}//${CONFIG.qilinConfig.host}${port}${nortc}`;
    }

    connect() {
        addLog('[麒麟传送] 正在连接服务器...', 'info', true);
        try {
            this.socket = new WebSocket(this.getWebSocketURL());
            this.socket.binaryType = 'arraybuffer';
            this.socket.onopen = () => {
                addLog('[麒麟传送] WebSocket 已连接', 'success', true);
                this.connected = true;
                this.updateConnectionStatus();
                this.showNotification('已连接到麒麟传送', 'success');
            };
            this.socket.onmessage = (e) => this.handleMessage(e.data);
            this.socket.onclose = () => {
                addLog('[麒麟传送] 连接已断开', 'warning', true);
                this.connected = false;
                this.updateConnectionStatus();
                this.peers.clear();
                this.rtcPeers.forEach(peer => {
                    if (peer.conn) peer.conn.close();
                });
                this.rtcPeers.clear();
                this.showNotification('连接已断开，5秒后重连...', 'warning');
                setTimeout(() => this.connect(), 5000);
            };
            this.socket.onerror = (error) => {
                addLog('[麒麟传送] 连接错误: ' + error.message, 'error', true);
            };
        } catch (error) {
            addLog('[麒麟传送] 无法连接: ' + error.message, 'error', true);
            this.showNotification(`连接失败: ${error.message}`, 'error');
        }
    }

    updateConnectionStatus() {
        // 触发UI更新
        window.dispatchEvent(new CustomEvent('qilinConnectionStatusChange', {
            detail: { connected: this.connected, peerCount: this.peers.size }
        }));
    }

    handleMessage(data) {
        if (data instanceof ArrayBuffer) {
            this.handleFileChunk(data);
            return;
        }
        try {
            const message = JSON.parse(data);
            switch (message.type) {
                case 'peers':
                    this.handlePeers(message.peers);
                    break;
                case 'peer-joined':
                    this.handlePeerJoined(message.peer);
                    break;
                case 'peer-left':
                    this.handlePeerLeft(message.peerId);
                    break;
                case 'signal':
                    this.handleSignal(message);
                    break;
                case 'ping':
                    this.send({ type: 'pong' });
                    break;
                case 'display-name':
                    this.handleDisplayName(message);
                    break;
            }
        } catch (error) {
            addLog('[麒麟传送] 消息解析错误: ' + error.message, 'error', true);
        }
    }

    handlePeers(peers) {
        addLog(`[麒麟传送] 发现 ${peers.length} 个在线设备`, 'info', true);
        this.peers.clear();
        peers.forEach(peer => {
            this.peers.set(peer.id, peer);
            //addLog(`  - ${peer.name.displayName} (${peer.name.deviceName})`, 'info', true);
            if (peer.rtcSupported && window.RTCPeerConnection) {
                this.createRTCConnection(peer.id, peer, true);
            }
        });
        this.updateConnectionStatus();
        if (peers.length > 0) {
            this.showNotification(`发现 ${peers.length} 个设备`, 'success');
        }
    }

    handlePeerJoined(peer) {
        addLog(`[麒麟传送] 设备加入: ${peer.name.displayName}`, 'info', true);
        this.peers.set(peer.id, peer);
        this.updateConnectionStatus();
        this.showNotification(`${peer.name.displayName} 加入`, 'info');
        if (peer.rtcSupported && window.RTCPeerConnection) {
            this.createRTCConnection(peer.id, peer, true);
        }
    }

    handlePeerLeft(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            addLog(`[麒麟传送] 设备离开: ${peer.name.displayName}`, 'warning', true);
            this.showNotification(`${peer.name.displayName} 离开`, 'warning');
        }
        this.peers.delete(peerId);
        this.updateConnectionStatus();
        const rtcPeer = this.rtcPeers.get(peerId);
        if (rtcPeer) {
            if (rtcPeer.conn) rtcPeer.conn.close();
            this.rtcPeers.delete(peerId);
        }
    }

    createRTCConnection(peerId, peer, isCaller = false) {
        // 避免快速重复创建连接（用于重建时的防抖）
        const recentRecreate = this._recentRecreateMap?.get(peerId);
        if (recentRecreate && Date.now() - recentRecreate < 3000) {
            addLog(`[麒麟传送] 3秒内跳过重建连接: ${peer.name.displayName}`, 'warning', true);
            return null;
        }
        // 记录重建时间
        if (!this._recentRecreateMap) this._recentRecreateMap = new Map();
        this._recentRecreateMap.set(peerId, Date.now());

        // 检查是否存在旧连接，如果存在则先关闭
        const existingPeer = this.rtcPeers.get(peerId);
        if (existingPeer) {
            addLog(`[麒麟传送] 关闭旧 RTC 连接: ${peer.name.displayName}`, 'warning', true);
            if (existingPeer.conn) {
                existingPeer.conn.close();
            }
            if (existingPeer.channel) {
                existingPeer.channel.close();
            }
            this.rtcPeers.delete(peerId);
        }
        const config = {
            sdpSemantics: 'unified-plan',
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        };
        const conn = new RTCPeerConnection(config);
        let channel = null;
        conn.onconnectionstatechange = () => {
            switch (conn.connectionState) {
                case 'connected':
                    this.showNotification(`已连接: ${peer.name.displayName}`, 'success');
                    break;
                case 'disconnected':
                case 'failed':
                    setTimeout(() => {
                        if (this.peers.has(peerId)) {
                            this.rtcPeers.delete(peerId);
                            this.createRTCConnection(peerId, peer, isCaller);
                        }
                    }, 3000);
                    break;
                case 'closed':
                    addLog(`[麒麟传送] 连接关闭，3秒后尝试重连: ${peer.name.displayName}`, 'warning', true);
                    setTimeout(() => {
                        if (this.peers.has(peerId)) {
                            this.rtcPeers.delete(peerId);
                            this.createRTCConnection(peerId, peer, isCaller);
                        }
                    }, 3000);
                    break;
            }
        };
        conn.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal(peerId, { ice: event.candidate });
            }
        };
        const setupChannel = (ch) => {
            channel = ch;
            channel.binaryType = 'arraybuffer';
            channel.onopen = () => {
                addLog(`[麒麟传送] 数据通道已打开: ${peer.name.displayName}`, 'success', true);
            };
            channel.onmessage = (e) => {
                // 只在开始和结束时输出简洁日志
                if (e.data instanceof ArrayBuffer) {
                    // 文件块 - 只在接收完成后输出
                    this.handlePeerMessage(peerId, e.data);
                } else {
                    // JSON 消息
                    try {
                        const msg = JSON.parse(e.data);
                        if (msg.type === 'header' || msg.type === 'transfer-complete') {
                            addLog(`[麒麟传送] ${msg.type}: ${msg.name || ''}`, 'info', true);
                        }
                    } catch (err) { }
                    this.handlePeerMessage(peerId, e.data);
                }
            };
            channel.onclose = () => {
                addLog(`[麒麟传送] 数据通道已关闭: ${peer.name.displayName}`, 'warning', true);
            };
        };
        if (isCaller) {
            channel = conn.createDataChannel('data-channel', { ordered: true, reliable: true });
            setupChannel(channel);
            conn.createOffer().then(offer => conn.setLocalDescription(offer))
                .then(() => { this.sendSignal(peerId, { sdp: conn.localDescription }); })
                .catch(error => { addLog('[麒麟传送] 创建 offer 失败: ' + error.message, 'error', true); });
        } else {
            conn.ondatachannel = (event) => {
                addLog(`[麒麟传送] 收到数据通道: ${peer.name.displayName}`, 'info', true);
                setupChannel(event.channel);
            };
        }
        const rtcPeer = { conn, channel, peer, isCaller };
        this.rtcPeers.set(peerId, rtcPeer);
        return rtcPeer;
    }

    handleSignal(signal) {
        const senderId = signal.sender;
        let rtcPeer = this.rtcPeers.get(senderId);
        if (!rtcPeer) {
            const peer = this.peers.get(senderId);
            if (!peer) {
                addLog(`[麒麟传送] 收到信令但未找到对应设备: ${senderId}`, 'warning', true);
                return;
            }
            rtcPeer = this.createRTCConnection(senderId, peer, false);
        }
        const conn = rtcPeer.conn;
        if (signal.sdp) {
            const currentState = conn.signalingState;
            // 检查 SDP 顺序是否匹配
            if (signal.sdp.type === 'answer' && currentState !== 'have-local-offer') {
                addLog(`[麒麟传送] SDP 状态不匹配，忽略 answer（当前: ${currentState}）`, 'warning', true);
                // 检查是否在3秒重建期内，是则跳过
                const recentRecreate = this._recentRecreateMap?.get(senderId);
                if (recentRecreate && Date.now() - recentRecreate < 3000) {
                    addLog('[麒麟传送] 3秒内跳过重建', 'warning', true);
                    return;
                }
                // 尝试重建连接
                this.rtcPeers.delete(senderId);
                const peer = this.peers.get(senderId);
                if (peer) {
                    this.createRTCConnection(senderId, peer, false);
                }
                return;
            }
            if (signal.sdp.type === 'offer' && currentState !== 'stable' && currentState !== 'have-remote-answer') {
                addLog(`[麒麟传送] SDP 状态不匹配，忽略 offer（当前: ${currentState}）`, 'warning', true);
                // 检查是否在3秒重建期内，是则跳过
                const recentRecreate = this._recentRecreateMap?.get(senderId);
                if (recentRecreate && Date.now() - recentRecreate < 3000) {
                    addLog('[麒麟传送] 3秒内跳过重建', 'warning', true);
                    return;
                }
                // 尝试重建连接
                this.rtcPeers.delete(senderId);
                const peer = this.peers.get(senderId);
                if (peer) {
                    this.createRTCConnection(senderId, peer, false);
                }
                return;
            }
            conn.setRemoteDescription(new RTCSessionDescription(signal.sdp))
                .then(() => {
                    if (signal.sdp.type === 'offer') {
                        return conn.createAnswer();
                    }
                })
                .then(answer => {
                    if (answer) {
                        return conn.setLocalDescription(answer);
                    }
                })
                .then(() => {
                    if (signal.sdp.type === 'offer') {
                        this.sendSignal(senderId, { sdp: conn.localDescription });
                    }
                })
                .catch(error => { addLog('[麒麟传送] SDP 处理失败: ' + error.message, 'error', true); });
        } else if (signal.ice) {
            // 检查连接状态是否准备好接收 ICE candidate
            if (conn.remoteDescription && conn.iceConnectionState !== 'closed') {
                conn.addIceCandidate(new RTCIceCandidate(signal.ice))
                    .catch(error => { addLog('[麒麟传送] ICE 添加失败（可能状态不一致）: ' + error.message, 'warning', true); });
            }
        }
    }

    sendSignal(peerId, signal) {
        signal.type = 'signal';
        signal.to = peerId;
        this.send(signal);
    }

    handlePeerMessage(peerId, data) {
        if (data instanceof ArrayBuffer) {
            this.handleFileChunk(data, peerId);
            return;
        }
        try {
            const message = JSON.parse(data);
            switch (message.type) {
                case 'text':
                    this.handleTextReceived(message);
                    break;
                case 'header':
                    this.handleFileHeader(message, peerId);
                    break;
                case 'partition':
                    this.sendToPeer(peerId, { type: 'partition-received', offset: message.offset });
                    break;
                case 'progress':
                    addLog(`[麒麟传送] 对方接收进度: ${(message.progress * 100).toFixed(1)}%`, 'info', true);
                    break;
                case 'transfer-complete':
                    addLog('[麒麟传送] 对方接收完成', 'success', true);
                    break;
            }
        } catch (error) {
            addLog('[麒麟传送] 对等消息解析错误: ' + error.message, 'error', true);
        }
    }

    sendToPeer(peerId, message) {
        const rtcPeer = this.rtcPeers.get(peerId);
        if (rtcPeer && rtcPeer.channel && rtcPeer.channel.readyState === 'open') {
            rtcPeer.channel.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    handleDisplayName(message) {
        const displayName = message.message?.displayName || message.displayName;
        const deviceName = message.message?.deviceName || message.deviceName;
        // 保存显示名称
        this.displayName = displayName;
        // 保存设备名称到配置
        CONFIG.qilinConfig.deviceName = deviceName;
        addLog(`[麒麟传送] 本机设备名: ${displayName} (${deviceName})`, 'success', true);
        this.showNotification(`已连接: ${displayName}`, 'success');
        // 触发状态更新事件，让UI刷新
        this.updateConnectionStatus();
    }

    async handleTextReceived(message) {
        try {
            const text = decodeURIComponent(atob(message.text));
            addLog('[麒麟传送] 收到文本: ' + text, 'info', true);
            if (isBase64ImageString(text)) {
                const success = await qilinCopyBase64ImageToClipboard(text);
                if (success) {
                    this.showNotification('🖼️ 图片已复制到剪贴板', 'success');
                } else {
                    this.showNotification('⚠️ 图片复制失败，已作为文本处理', 'warning');
                    await this.copyText(text);
                }
            } else {
                await this.copyText(text);
            }
        } catch (error) {
            addLog('[麒麟传送] 文本处理错误: ' + error.message, 'error', true);
            this.showNotification('文本处理失败', 'error');
        }
    }

    async copyText(text) {
        const success = await qilinSafeCopyText(text);
        if (success) {
            this.showNotification('📋 文本已复制到剪贴板', 'success');
        } else {
            this.showNotification('⚠️ 复制失败，请手动复制', 'warning');
            prompt('[麒麟传送] 请手动复制:', text);
        }
    }

    handleFileHeader(message, peerId) {
        addLog('[麒麟传送] 收到文件头: ' + message.name + ' 来自: ' + peerId, 'info', true);
        this.currentFile = {
            name: message.name,
            mime: message.mime,
            size: message.size,
            chunks: [],
            receivedBytes: 0,
            senderId: peerId
        };
        const type = message.mime.startsWith('image/') ? '图片' : '文件';
        const size = formatSize(message.size);
        this.showNotification(`正在接收${type}: ${message.name} (${size})`, 'info');
    }

    handleFileChunk(chunk, peerId) {
        if (!this.currentFile) {
            addLog('[麒麟传送] 收到文件块但没有文件头（来自: ' + peerId + '）', 'warning', true);
            return;
        }
        this.currentFile.chunks.push(chunk);
        this.currentFile.receivedBytes += chunk.byteLength;
        const progress = (this.currentFile.receivedBytes / this.currentFile.size * 100).toFixed(1);
        if (Math.floor(progress) % 20 === 0) {
            addLog(`[麒麟传送] 接收进度: ${progress}%`, 'info', true);
        }
        if (this.currentFile.receivedBytes >= this.currentFile.size) {
            this.completeFileDownload();
        }
    }

    async completeFileDownload() {
        try {
            const fileInfo = {
                name: this.currentFile.name,
                mime: this.currentFile.mime,
                chunks: this.currentFile.chunks,
                senderId: this.currentFile.senderId
            };
            this.currentFile = null;
            const blob = new Blob(fileInfo.chunks, { type: fileInfo.mime });
            const url = URL.createObjectURL(blob);
            if (fileInfo.mime.startsWith('image/')) {
                await this.handleImageFile(blob, url, fileInfo.name);
            } else {
                this.downloadFile(url, fileInfo.name);
            }
            this.showNotification(`✅ 接收完成: ${fileInfo.name}`, 'success');

            // ✅ 向发送端发送传输完成确认（解决第二次无法传输问题）
            if (fileInfo.senderId) {
                this.sendToPeer(fileInfo.senderId, { type: 'transfer-complete' });
                addLog('[麒麟传送] 已发送传输完成确认给发送端', 'success', true);
            }
        } catch (error) {
            addLog('[麒麟传送] 文件处理错误: ' + error.message, 'error', true);
            this.showNotification('文件处理失败', 'error');
            this.currentFile = null;
        }
    }

    async handleImageFile(blob, url, filename) {
        addLog('[麒麟传送] 处理图片文件...', 'info', true);
        const success = await qilinCopyImageToClipboard(blob, filename?.name || filename);
        if (success) {
            this.showNotification('🖼️ 图片已复制到剪贴板', 'success');
            setTimeout(() => URL.revokeObjectURL(url), 100);
        } else {
            addLog('[麒麟传送] 无法复制图片，改为下载', 'warning', true);
            this.downloadFile(url, filename?.name || filename);
        }
    }

    downloadFile(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
        qilinPlaySound();
        this.showNotification(`📥 文件已下载: ${filename}`, 'success');
    }

    send(message) {
        if (!this.connected || !this.socket) {
            addLog('[麒麟传送] 未连接，无法发送', 'warning', true);
            return;
        }
        this.socket.send(JSON.stringify(message));
    }

    showNotification(message, type = 'info') {
        const colors = {
            success: '#4CAF50',
            error: '#f44336',
            warning: '#ff9800',
            info: '#2196F3'
        };
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${colors[type]};
            color: white;
            padding: 15px 20px;
            border-radius: 4px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            z-index: 999999;
            font-size: 14px;
            max-width: 300px;
            animation: slideIn 0.3s ease-out;
            font-family: Arial, sans-serif;
        `;
        notification.textContent = message;
        const show = () => {
            document.body.appendChild(notification);
            setTimeout(() => {
                notification.style.animation = 'slideOut 0.3s ease-out';
                setTimeout(() => notification.remove(), 300);
            }, 3000);
        };
        if (document.body) {
            show();
        } else {
            document.addEventListener('DOMContentLoaded', show);
        }
    }

    getStatus() {
        const rtcStatus = [];
        this.rtcPeers.forEach((peer, id) => {
            rtcStatus.push({
                name: peer.peer.name.displayName,
                connectionState: peer.conn.connectionState,
                signalingState: peer.conn.signalingState,
                iceState: peer.conn.iceConnectionState,
                channelState: peer.channel?.readyState || 'none'
            });
        });
        return {
            connected: this.connected,
            peerId: this.peerId,
            displayName: this.displayName,
            deviceName: CONFIG.qilinConfig.deviceName,
            peers: Array.from(this.peers.values()).map(p => p.name.displayName),
            rtcConnections: this.rtcPeers.size,
            rtcStatus,
            currentFile: this.currentFile ? {
                name: this.currentFile.name,
                size: formatSize(this.currentFile.size),
                progress: `${(this.currentFile.receivedBytes / this.currentFile.size * 100).toFixed(1)}%`
            } : null
        };
    }
}

// 初始化麒麟传送
function initQilinDrop() {
    // 添加CSS动画样式
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(400px); opacity: 0; }
        }
    `;
    if (document.head) {
        document.head.appendChild(style);
    }

    qilinClient = new QilinDropClient();
    unsafeWindow.qilinClient = qilinClient;
    window.qilinClient = qilinClient;  // 同时设置到window，供CAT_UI面板访问
    addLog('[麒麟传送] 🦄 麒麟传送助手已启动', 'success', true);
}

// 获取麒麟传送状态
function getQilinStatus() {
    if (qilinClient) {
        return qilinClient.getStatus();
    }
    return { connected: false, peerId: null, peers: [], rtcConnections: 0 };
}

// ========== 页面启动 ==========
// 麒麟传送初始化（立即启动，无需等待DOM）
initQilinDrop();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMonitoring);
} else {
    startMonitoring();
}
