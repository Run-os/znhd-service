// ==UserScript==
// @name        征纳互动人数和在线监控
// @namespace   https://scriptcat.org/
// @description 实施监控征纳互动等待人数和在线状态，支持语音播报、webhook推送文本和图片、自定义常用语
// @version     26.1.12
// @author      runos
// @match       https://znhd.hunan.chinatax.gov.cn:8443/*
// @match       https://example.com/*
// @icon        https://znhd.hunan.chinatax.gov.cn:8443/favicon.ico
// @grant       GM_addStyle
// @grant       unsafeWindow
// @grant       GM_xmlhttpRequest
// @grant       GM_setClipboard
// @grant       GM_notification
// @connect     *
// @homepage    https://scriptcat.org/zh-CN/script-show-page/3650
// @require     https://scriptcat.org/lib/1167/1.0.0/%E8%84%9A%E6%9C%AC%E7%8C%ABUI%E5%BA%93.js?sha384-jXdR3hCwnDJf53Ue6XHAi6tApeudgS/wXnMYBD/ZJcgge8Xnzu/s7bkEf2tPi2KS
// @require     https://cdn.jsdelivr.net/npm/@fingerprintjs/fingerprintjs@5/dist/fp.min.js
// ==/UserScript==

// ==========配置==========
// 配置对象，集中管理可配置项
const CONFIG = {
    // 检查间隔（毫秒）
    CHECK_INTERVAL: 3000,
    // 最大日志条目数
    MAX_LOG_ENTRIES: 10,
    WORKING_HOURS: {
        MORNING: { START: 9, END: 12 },
        AFTERNOON: { START: 13.5, END: 18 }
    },
    didaUrl: 'https://cdn.jsdelivr.net/gh/Run-os/UserScript/znhd/dida.mp3',
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
    getwebhookStatus: true,
    webhookUrl: "",
    webhookToken: "",
    postToken: "",
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
        console.error('加载存储数据失败:', error);
    }
    // 返回默认值
    return { ...DEFAULTS };
}

// 保存Allvalue数据到localStorage
function saveAllvalue(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        console.log('数据已保存到localStorage');
    } catch (error) {
        console.error('保存数据失败:', error);
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
    const { voiceEnabled, getwebhookStatus, webhookUrl, webhookToken, postToken, isChecked } = Allvalue;

    const voiceEnabledText = voiceEnabled ? "🔊 语音" : "🔇 静音";
    const getwebhookStatusText = getwebhookStatus ? "▶️ 运行中" : "⏸️ 已停止";

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


    // 设置日志回调函数
    CAT_UI.useEffect(() => {
        setLogEntriesCallback = setLogEntries;
        return () => {
            setLogEntriesCallback = null;
        };
    }, []);

    // 初始化时检测webhook配置是否为空，为空则自动生成
    CAT_UI.useEffect(() => {
        // 检测webhookUrl和webhookToken是否为空，且isChecked为true
        // 同时检查是否曾经有过有效配置（通过检查postToken是否为空来判断）
        if (isChecked && (!webhookUrl || !webhookToken)) {
            const hadPreviousConfig = postToken && postToken.length > 0;
            if (hadPreviousConfig) {
                // 用户曾经配置过，尝试从localStorage恢复
                addLog('检测到配置丢失，尝试从localStorage恢复', 'warning');
                const savedData = loadAllvalue();
                if (savedData.webhookUrl && savedData.webhookToken) {
                    patchAllvalue({
                        webhookUrl: savedData.webhookUrl,
                        webhookToken: savedData.webhookToken,
                        postToken: savedData.postToken
                    });
                    addLog('配置已从localStorage恢复', 'success');
                } else {
                    // localStorage中也没有有效配置，才生成新配置
                    generateNewWebhookConfig();
                }
            } else {
                // 从未配置过，生成新配置
                generateNewWebhookConfig();
            }
        }
    }, []);

    // ========== 指纹管理 ==========
    const FINGERPRINT_KEY = 'scriptCat_Fingerprint';

    // 初始化 FingerprintJS
    async function initFingerprint() {
        try {
            // 检查 FingerprintJS 是否可用
            if (typeof FingerprintJS === 'undefined') {
                throw new Error('FingerprintJS 未加载');
            }
            const fp = await FingerprintJS.load();
            const result = await fp.get();
            return result.visitorId;
        } catch (error) {
            console.error('FingerprintJS 初始化失败:', error);
            // 生成一个基于时间和随机数的备选指纹
            return 'fallback_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        }
    }

    // 获取或生成设备指纹
    async function getOrCreateFingerprint() {
        // 尝试从存储获取
        const saved = localStorage.getItem(FINGERPRINT_KEY);
        if (saved) return saved;

        // 获取新指纹
        const fingerprint = await initFingerprint();
        localStorage.setItem(FINGERPRINT_KEY, fingerprint);
        return fingerprint;
    }

    // 统一的生成webhook配置函数
    async function generateNewWebhookConfig() {
        const newWebhookUrl = "https://znhd-service.zeabur.app";
        const fingerprint = await getOrCreateFingerprint();
        const newWebhookToken = fingerprint;
        const newPostToken = btoa(newWebhookToken);
        patchAllvalue({ webhookUrl: newWebhookUrl, webhookToken: newWebhookToken, postToken: newPostToken });
        addLog('webhook配置已基于设备指纹生成', 'info');
    }

    // webhook 配置变化时自动应用最新连接状态
    CAT_UI.useEffect(() => {
        if (!getwebhookStatus) {
            initwebhookCatDevice(false);
            return;
        }
        if (webhookUrl && webhookToken) {
            initwebhookCatDevice(true, webhookUrl, webhookToken);
        }
    }, [getwebhookStatus, webhookUrl, webhookToken]);

    // 加载常用语数据的函数
    const loadPhrasesData = () => {

        setPhrasesLoading(true);
        GM_xmlhttpRequest({
            method: 'GET',
            url: "https://file.122050.xyz/directlink/1/znhdText.json",
            onload: function (response) {
                try {
                    const data = JSON.parse(response.responseText);
                    setPhrasesData(data);
                    CAT_UI.Message.success('常用语加载成功');
                } catch (error) {
                    console.error('JSON 解析失败:', error);
                    CAT_UI.Message.error('JSON 解析失败: ' + error.message);
                    setPhrasesData({});
                } finally {
                    setPhrasesLoading(false);
                }
            },
            onerror: function (error) {
                console.error('加载常用语失败:', error);
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

    // 主UI布局
    return CAT_UI.Space(
        [
            // 水平排列按钮和抽屉

            // webhook状态
            CAT_UI.Space(
                [
                    CAT_UI.Text("webhook运行状态: "),
                    CAT_UI.Button(getwebhookStatusText, {
                        type: "primary",
                        onClick() {
                            const newgetwebhookStatus = !getwebhookStatus;
                            patchAllvalue({ getwebhookStatus: newgetwebhookStatus });
                            initwebhookCatDevice(newgetwebhookStatus, webhookUrl, webhookToken);
                        },
                        style: {
                            //字体加粗
                            fontWeight: "bold",
                            // 动态样式：根据运行状态切换颜色
                            backgroundColor: !getwebhookStatus ? "#990018" : "#007e44",
                            borderColor: !getwebhookStatus ? "#990018" : "#007e44",
                        }
                    }),
                ],
                {
                    direction: "horizontal", // 横向排列（默认值，可省略）
                    size: "middle", // 元素间间距（可选：small/middle/large，默认middle）
                    style: { marginBottom: "8px" } // 可选：给这一行加底部间距，避免与下方元素拥挤
                }
            ),

            // 语音播报状态
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
            // 按钮
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
                    CAT_UI.Button("post网页", {
                        type: "primary",
                        onClick: () => {
                            // 生成二维码并显示
                            // https://znhd-service.zeabur.app/?url=https://znhd-service.zeabur.app/message?token=a2oyZTZtNTU3MXA%3D
                            const url = "https://znhd-service.zeabur.app/?url=" + webhookUrl.replace(/\/$/, '') + '/message?token=' + encodeURIComponent(postToken);

                            // 创建模态框显示二维码（使用原生DOM方法）
                            const modalOverlay = document.createElement('div');
                            modalOverlay.id = 'qrCodeModal';
                            modalOverlay.style.cssText = `
                                                position: fixed;
                                                top: 0;
                                                left: 0;
                                                width: 100%;
                                                height: 100%;
                                                backgroundColor: rgba(0, 0, 0, 0.5);
                                                display: flex;
                                                justify-content: center;
                                                align-items: center;
                                                z-index: 9999;
                                                border-radius: 8px;
                                            `;

                            const modalContent = document.createElement('div');
                            modalContent.style.cssText = `
                                                backgroundColor: white;
                                                padding: 20px;
                                                border-radius: 8px;
                                                text-align: center;
                                            `;

                            const modalTitle = document.createElement('h3');
                            modalTitle.textContent = '点击即可关闭';
                            modalTitle.style.cssText = 'margin-bottom: 20px;';

                            // 创建二维码容器
                            const qrContainer = document.createElement('div');
                            qrContainer.id = 'qrCodeContainer';
                            qrContainer.style.cssText = 'width:200px;height:200px;margin:0 auto;';

                            // 动态加载 QRCode 库
                            const script = document.createElement('script');
                            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
                            script.onload = () => {
                                // 生成二维码
                                new QRCode(qrContainer, {
                                    text: url,
                                    width: 200,
                                    height: 200
                                });
                            };
                            document.head.appendChild(script);

                            // 组装模态框
                            modalContent.appendChild(modalTitle);
                            modalContent.appendChild(qrContainer);
                            modalOverlay.appendChild(modalContent);

                            // 点击模态框任意位置关闭并复制二维码URL到剪贴板
                            modalOverlay.addEventListener('click', () => {
                                // 复制二维码对应的URL到剪贴板
                                safeCopyText(url);
                                // 显示复制成功提示
                                CAT_UI.Message.success("URL已复制到剪贴板");

                                // 关闭模态框
                                if (document.getElementById('qrCodeModal')) {
                                    document.body.removeChild(modalOverlay);
                                }
                            });

                            // 添加到页面
                            document.body.appendChild(modalOverlay);

                            // 5秒后自动关闭
                            setTimeout(() => {
                                if (document.getElementById('qrCodeModal')) {
                                    document.body.removeChild(modalOverlay);
                                }
                            }, 5000);
                        }
                    }
                    ),
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

                                    CAT_UI.Button("[生成配置]", {
                                        type: "link",
                                        onClick: () => {
                                            // 使用统一的配置生成函数
                                            generateNewWebhookConfig();
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
                                "1. 配置好webhookUrl，webhookToken（即clientToken），postToken（即appToken）后，点击运行状态按钮启动webhook推送监听\n2. 🔘[使用教程]里面可查看脚本详细介绍\n3. 🔘[生成配置]根据设备指纹生成唯一标识，用于设备识别和消息推送\n",
                            ),
                            CAT_UI.Divider("webhook设置"),  // 带文本的分隔线
                            CAT_UI.Checkbox("如果配置为空，自动生成配置", {
                                checked: isChecked,
                                onChange(checked) {
                                    patchAllvalue({ isChecked: checked });
                                    addLog(`复选框状态: ${checked}`, 'info');
                                }
                            }),
                            CAT_UI.createElement(
                                "div",
                                {
                                    style: {
                                        display: "flex",          // 弹性布局
                                        justifyContent: "space-between",  // 水平方向两端对齐
                                        alignItems: "center",     // 垂直方向居中对齐
                                    },
                                },
                                [   // 子元素数组
                                    CAT_UI.Text("webhookUrl："),  // 文本提示
                                    CAT_UI.Input({          // 输入框
                                        value: webhookUrl,
                                        onChange(val) {
                                            patchAllvalue({ webhookUrl: val });
                                        },
                                        style: { flex: 1, marginBottom: "8px" }   // 占满剩余空间并加底部间距
                                    }),
                                ]
                            ),
                            CAT_UI.createElement(
                                "div",
                                {
                                    style: {
                                        display: "flex",          // 弹性布局
                                        justifyContent: "space-between",  // 水平方向两端对齐
                                        alignItems: "center",     // 垂直方向居中对齐
                                    },
                                },
                                [   // 子元素数组
                                    CAT_UI.Text("webhookToken："),  // 文本提示
                                    CAT_UI.Input({          // 输入框
                                        value: webhookToken,
                                        onChange(val) {
                                            patchAllvalue({ webhookToken: val });
                                        },
                                        style: { flex: 1, marginBottom: "8px" }   // 占满剩余空间并加底部间距
                                    }),
                                ]
                            ),


                            CAT_UI.createElement(
                                "div",
                                {
                                    style: {
                                        display: "flex",          // 弹性布局
                                        justifyContent: "space-between",  // 水平方向两端对齐
                                        alignItems: "center",     // 垂直方向居中对齐
                                    },
                                },
                                [   // 子元素数组
                                    CAT_UI.Text("postToken："),  // 文本提示
                                    CAT_UI.Input({          // 输入框
                                        value: postToken,
                                        onChange(val) {
                                            patchAllvalue({ postToken: val });
                                        },
                                        style: { flex: 1, marginBottom: "8px" }   // 占满剩余空间并加底部间距
                                    }),
                                ]
                            ),

                            CAT_UI.Divider("其他设置"),  // 带文本的分隔线
                            // 日志显示区域
                            CAT_UI.Divider("日志内容"),  // 日志标题分隔线
                            CAT_UI.createElement(
                                "div",
                                {
                                    style: {
                                        whiteSpace: "pre-wrap",
                                        wordBreak: "break-word",
                                        maxHeight: "300px",
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
                                "数据源: https://file.122050.xyz/directlink/1/znhdText.json"
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
        addLog(`检测错误: ${error.message}`, 'error'); // 使用error级别记录错误
        console.error('checkCount函数执行出错:', error); // 添加控制台错误日志
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
                console.warn('无法访问iframe内容', e);
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
            console.error('❌ 找不到 TinyMCE iframe');
            return '';
        }

        try {
            const body = iframe.contentDocument.body;
            if (!body) {
                console.error('❌ 找不到 body');
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
            console.error('❌ 无法访问 iframe 内容', e);
            return '';
        }
    }

    const finalText = editor ? editor.getContent({ format: 'text' })
        : document.querySelector('body#tinymce')?.textContent ?? '';
    console.log('✅ 已使用<br>换行追加并同步：', finalText);
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


// ========== webhook WebSocket 推送集成 ==========
let webhookWS = null;
let webhookReconnectTimer = null;
const webhook_RECONNECT_INTERVAL = 3000;
const webhook_MAX_RECONNECT_ATTEMPTS = 10; // 最大重连次数
let webhookReconnectAttempts = 0; // 当前重连次数
let webhookEnabled = false; // 控制是否允许重连
let webhookConfigKey = '';

// 安全复制工具：仅在页面聚焦且支持 clipboard 时尝试复制
function safeCopyText(text) {
    if (!text) return;
    // 1) 优先使用 GM_setClipboard（无需焦点）
    if (typeof GM_setClipboard === 'function') {
        try {
            GM_setClipboard(text);
            console.log('[webhook] 已复制到剪贴板 (GM_setClipboard)');
            const player = new Audio();
            player.src = CONFIG.didaUrl;
            player.play();
            return;
        } catch (e) {
            console.error('[webhook] GM_setClipboard 失败，尝试浏览器 API:', e);
        }
    }

    // 2) 浏览器异步 clipboard API
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(() => {
            console.log('[webhook] 已复制到剪贴板 (navigator.clipboard)');
            const player = new Audio();
            player.src = CONFIG.didaUrl;
            player.play();
        }).catch(err => {
            console.error('[webhook] 复制到剪贴板失败，结束:', err);
        });
        return;
    }
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
        console.error('[webhook] 转换图片为 PNG 失败:', err);
        return blob; // 退化：返回原始 blob 继续尝试
    }
}

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
                console.error('[webhook] Clipboard API 图片写入失败:', clipErr);
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
                console.error('[webhook] GM_setClipboard 图片写入失败:', gmErr);
            }
        }

        addLog('当前环境不支持图片剪贴板写入', 'warning');
        return false;
    } catch (err) {
        console.error('[webhook] 复制图片到剪贴板失败:', err);
        addLog(`复制图片到剪贴板失败: ${err && err.message ? err.message : '未知错误'}`, 'error');
        return false;
    }
}

function connectwebhookWebSocket(webhookUrl, webhookToken) {
    if (webhookReconnectTimer) {
        clearTimeout(webhookReconnectTimer);
        webhookReconnectTimer = null;
    }
    if (!webhookUrl || !webhookToken) {
        webhookEnabled = false;
        CAT_UI.Message.warning('未配置 webhook webhookUrl 或 webhookToken，跳过推送监听');
        console.warn('未配置 webhook webhookUrl 或 webhookToken，跳过推送监听');
        // 关闭可能存在的旧连接，避免使用过期配置重连
        if (webhookWS) {
            try { webhookWS.close(1000, '配置缺失，停止推送'); } catch (e) { }
            webhookWS = null;
        }
        return;
    }
    const configKey = `${webhookUrl}|${webhookToken}`;
    // 如果当前配置已在连接中或已连接，避免重复创建导致的闪断
    if (webhookWS && (webhookWS.readyState === WebSocket.CONNECTING || webhookWS.readyState === WebSocket.OPEN) && webhookConfigKey === configKey) {
        return;
    }

    webhookEnabled = true;
    webhookConfigKey = configKey;
    // 关闭已有连接
    if (webhookWS) {
        try { webhookWS.close(1000, '重连'); } catch (e) { }
        webhookWS = null;
    }
    // 构造 ws 地址
    try {
        const urlObj = new URL('/stream', webhookUrl.replace(/\/$/, ''));
        urlObj.protocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
        urlObj.searchParams.set('token', webhookToken);
        webhookWS = new window.WebSocket(urlObj.href);
        console.log('[webhook] 尝试连接: ', urlObj.href);
    } catch (e) {
        console.error('[webhook] 地址格式错误:', e);
        return;
    }
    webhookWS.onopen = () => {
        CAT_UI.Message.success('webhook WebSocket 连接成功');
        console.log('[webhook] WebSocket 连接成功');
        addLog('webhook 推送监听已启动', 'success');
    };
    // 二进制数据传输状态管理
    let binaryTransfer = null;

    webhookWS.onmessage = async (event) => {
        try {
            // 判断是否为二进制数据
            if (event.data instanceof Blob) {
                if (binaryTransfer && binaryTransfer.dataChunks) {
                    // 收集二进制数据块
                    binaryTransfer.dataChunks.push(event.data);
                    binaryTransfer.receivedSize += event.data.size;
                    console.log(`[webhook] 收到二进制数据块 ${binaryTransfer.dataChunks.length}, 已接收 ${binaryTransfer.receivedSize}/${binaryTransfer.totalSize} bytes`);
                } else {
                    console.log('[webhook] 收到意外的二进制数据，没有活跃的传输任务');
                }
                return;
            }

            // 解析 JSON 消息
            const msg = JSON.parse(event.data);
            const { id, title, message: text, priority, date, type, data_type, filename, size, content_type, transfer_id } = msg;
            console.log('[webhook] 收到消息:', msg);

            // 处理二进制传输开始
            if (type === 'binary_start' && data_type === 'image') {
                console.log(`[webhook] 开始接收二进制图片: ${filename}, 大小: ${size} bytes`);
                binaryTransfer = {
                    transfer_id: transfer_id,
                    filename: filename,
                    content_type: content_type || 'image/jpeg',
                    totalSize: size,
                    receivedSize: 0,
                    dataChunks: [],
                    startTime: Date.now()
                };
                return;
            }

            // 处理二进制传输结束
            if (type === 'binary_end' && binaryTransfer && binaryTransfer.transfer_id === transfer_id) {
                const elapsed = Date.now() - binaryTransfer.startTime;
                console.log(`[webhook] 二进制图片接收完成, 耗时: ${elapsed}ms, 共 ${binaryTransfer.dataChunks.length} 个数据块, 实际接收 ${binaryTransfer.receivedSize}/${binaryTransfer.totalSize} bytes`);

                // 合并所有数据块
                if (binaryTransfer.dataChunks.length > 0) {
                    const blob = new Blob(binaryTransfer.dataChunks, { type: binaryTransfer.content_type });
                    console.log(`[webhook] 合并后的Blob大小: ${blob.size} bytes`);

                    // 转换为 Base64 并复制到剪贴板
                    const base64 = await blobToBase64(blob);
                    const copied = await copyBase64ImageToClipboard(base64);

                    if (copied) {
                        CAT_UI.Message.success(`webhook消息：图片已复制到剪贴板 (${binaryTransfer.filename}, ${(binaryTransfer.totalSize / 1024).toFixed(2)}KB)`, 'success');
                        addLog(`webhook消息：图片已复制到剪贴板 - ${binaryTransfer.filename} (${(binaryTransfer.totalSize / 1024).toFixed(2)}KB)`, 'success');
                    } else {
                        CAT_UI.Message.warning('webhook消息：图片复制失败', 'warning');
                        addLog(`webhook消息：图片复制失败 - ${binaryTransfer.filename}`, 'warning');
                    }
                } else {
                    CAT_UI.Message.warning(`webhook消息：未收到任何图片数据 - ${binaryTransfer.filename}`, 'warning');
                    addLog(`webhook消息：未收到任何图片数据 - ${binaryTransfer.filename}`, 'warning');
                }

                binaryTransfer = null;
                return;
            }

            // 处理旧版 Base64 图片消息（向后兼容）
            if (text && isBase64ImageString(text)) {
                const copied = await copyBase64ImageToClipboard(text);
                if (copied && text) {
                    CAT_UI.Message.success('webhook消息：图片已复制到剪贴板', 'success');
                    addLog('webhook消息：图片已复制到剪贴板', 'success');
                } else if (!copied && text) {
                    CAT_UI.Message.warning(`webhook消息：图片复制失败，已保留原文：${text}`);
                    addLog(`webhook消息：图片复制失败，已保留原文：${text}`, 'warning');
                }
                return;
            }

            // 处理文本消息
            if (text) {
                safeCopyText(text);
                appendToTinyMCE(text);
                addLog(`webhook消息：${text}`, 'success');
            }
        } catch (err) {
            console.error('[webhook] 消息解析失败:', err, event.data);
        }
    };
    webhookWS.onerror = (error) => {
        console.error('[webhook] WebSocket 错误:', error);
        addLog('webhook WebSocket 发生错误，将尝试重连', 'warning');
        // 错误发生后尝试重连
        webhookWS = null;
        if (webhookEnabled && !webhookReconnectTimer && webhookReconnectAttempts < webhook_MAX_RECONNECT_ATTEMPTS) {
            webhookReconnectAttempts++;
            addLog(`WebSocket 重连尝试 ${webhookReconnectAttempts}/${webhook_MAX_RECONNECT_ATTEMPTS}`, 'warning');
            webhookReconnectTimer = setTimeout(() => connectwebhookWebSocket(webhookUrl, webhookToken), webhook_RECONNECT_INTERVAL);
        } else if (webhookReconnectAttempts >= webhook_MAX_RECONNECT_ATTEMPTS) {
            addLog('WebSocket 重连次数已达上限，请手动重新连接', 'error');
        }
    };
    webhookWS.onclose = (event) => {
        CAT_UI.Message.error('webhook WebSocket 连接关闭');
        addLog('webhook WebSocket 连接关闭', 'warning');
        webhookWS = null;
        if (!webhookEnabled) { return; }
        if (webhookReconnectTimer) clearTimeout(webhookReconnectTimer);
        if (webhookReconnectAttempts < webhook_MAX_RECONNECT_ATTEMPTS) {
            webhookReconnectAttempts++;
            addLog(`WebSocket 重连尝试 ${webhookReconnectAttempts}/${webhook_MAX_RECONNECT_ATTEMPTS}`, 'warning');
            webhookReconnectTimer = setTimeout(() => connectwebhookWebSocket(webhookUrl, webhookToken), webhook_RECONNECT_INTERVAL);
        } else {
            addLog('WebSocket 重连次数已达上限，请手动重新连接', 'error');
        }
    };
}

// 初始化 webhook 监听（根据配置）
function initwebhookCatDevice(enabled, webhookUrl, webhookToken) {
    if (!enabled) {
        webhookEnabled = false;
        webhookConfigKey = '';
        webhookReconnectAttempts = 0; // 重置重连计数
        if (webhookWS) {
            try { webhookWS.close(1000, '手动关闭'); } catch (e) { }
            webhookWS = null;
        }
        if (webhookReconnectTimer) {
            clearTimeout(webhookReconnectTimer);
            webhookReconnectTimer = null;
        }
        return;
    }

    if (!webhookUrl || !webhookToken) {
        webhookEnabled = false;
        webhookConfigKey = '';
        webhookReconnectAttempts = 0; // 重置重连计数
        CAT_UI.Message.warning('未配置 webhook webhookUrl 或 webhookToken，未启动推送监听');
        if (webhookWS) {
            try { webhookWS.close(1000, '配置缺失，停止推送'); } catch (e) { }
            webhookWS = null;
        }
        if (webhookReconnectTimer) {
            clearTimeout(webhookReconnectTimer);
            webhookReconnectTimer = null;
        }
        return;
    }

    // 重置重连计数
    webhookReconnectAttempts = 0;
    connectwebhookWebSocket(webhookUrl, webhookToken);
}

// 页面关闭时断开连接
window.addEventListener('unload', () => {
    if (webhookWS) try { webhookWS.close(1000, '页面关闭'); } catch (e) { }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startMonitoring);
} else {
    startMonitoring();

}
