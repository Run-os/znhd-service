// ==UserScript==
// @name           征纳互动人数和在线监控v2
// @namespace      https://scriptcat.org/
// @description    实施监控征纳互动等待人数和在线状态，支持语音播报、自定义常用语
// @version        26.2.26
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
    commonPhrasesUrl: 'https://gitee.com/runos/znhd-service/raw/master/public/commonPhrases.yaml'
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
    // 常用语搜索关键字状态管理
    const [searchKeyword, setSearchKeyword] = CAT_UI.useState("");


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
                    const data = jsyaml.load(response.responseText);
                    setPhrasesData(data);
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
                                                key.toLowerCase().includes(keyword) ||
                                                value.toLowerCase().includes(keyword)
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
                                                            setCommonPhrasesVisible(false);
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
        x: window.screen.width * 0.55,
        y: window.screen.height * 0.01
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

// 缓存DOM元素引用（只缓存稳定元素）
const domCache = {
    ocurrentElement: null
    // 注意：offlineElement 不缓存，每次重新查询
};

// 检测DOM元素是否仍然存在于文档中
function isElementInDocument(element) {
    return element && element.isConnected;
}

// 修改主要检测函数
function checkCount() {
    if (!isWorkingHours()) return;

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

        const currentCount = parseInt(ocurrentElement.textContent.trim());
        if (isNaN(currentCount)) {
            addLog(`无法解析等待人数: "${ocurrentElement.textContent.trim()}"`, 'warning');
            return;
        }

        // 人数状态处理
        if (currentCount === 0) {
            addLog('当前等待人数为0', 'success');
        } else {
            speak("征纳互动有人来了");
            addLog(`当前等待人数: ${currentCount}`, 'info');
        }

        // ========== 关键修复：离线检测 ==========
        // 每次重新查询，不缓存（弹窗元素动态创建/销毁）
        const offlineEl = document.querySelector('.t-dialog__body__icon:nth-child(2)') ||
            document.querySelector('.t-dialog__body__icon:nth-of-type(2)');

        if (offlineEl) {
            const text = (offlineEl.innerText || offlineEl.textContent || '').trim();

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
