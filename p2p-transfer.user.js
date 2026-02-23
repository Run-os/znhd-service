// ==UserScript==
// @name         局域网P2P传输工具 - 油猴脚本
// @namespace    https://github.com/runos/znhd-service
// @description  实现局域网内设备间的文本、文件快捷互传。通过WebRTC在局域网内直接传输，数据流不经过公网服务器。
// @version      1.0.0
// @author       runos
// @match        https://example.com/*
// @icon         data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">📡</text></svg>
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_setClipboard
// @connect      *
// ==/UserScript==

// ========================================
// 局域网P2P传输工具 - 油猴脚本版本
// 核心功能：通过 WebRTC 实现局域网内的高速数据传输
// 所有数据流仅在 192.168.x.x / 10.x.x.x 等内网网段传输
// ========================================

(function () {
    'use strict';

    // ========================================
    // 配置
    // ========================================
    const CONFIG = {
        // 信令服务器地址（部署到公网的服务器）
        // 请修改为您的公网服务器域名或IP
        signalingServer: 'drop.122050.xyz',  // 示例，请替换为实际服务器域名

        // UI配置
        ui: {
            buttonPosition: 'bottom-right',  // 按钮位置: bottom-right, bottom-left, top-right, top-left
            theme: 'light'  // 主题: light, dark
        }
    };

    // ========================================
    // 全局变量
    // ========================================
    let ws = null;  // WebSocket 连接
    let myId = null;  // 当前设备ID
    let myIp = null;  // 当前设备IP
    let isPrivate = false;  // 是否为内网地址
    let peerConnection = null;  // WebRTC 连接
    let dataChannel = null;  // 数据通道
    let config = null;  // WebRTC 配置
    let currentPartnerId = null;  // 当前配对设备ID
    let isInitiator = false;  // 是否为发起方
    let fileChunkSize = 16384;  // 文件分块大小（16KB）
    let currentFileTransfer = null;  // 当前文件传输状态
    let uiVisible = false;  // UI是否可见

    // ========================================
    // UI 元素引用
    // ========================================
    let panel = null;
    let panelBody = null;
    let toggleButton = null;

    // ========================================
    // 初始化
    // ========================================
    function init() {
        // 创建悬浮按钮
        createToggleButton();

        // 创建主面板
        createPanel();

        // 添加样式
        addStyles();

        // 初始化 WebSocket 连接
        initWebSocket();

        // 设置全局点击监听：点击窗口外部区域自动隐藏
        setupOutsideClickListener();

        console.log('[P2P] 局域网P2P传输工具已初始化');
        console.log('[P2P] 数据流安全说明：所有文件和文本数据仅通过 WebRTC 在局域网内直接传输，不会经过公网服务器');
    }

    // ========================================
    // WebSocket 连接管理
    // ========================================
    function initWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${CONFIG.signalingServer}/ws`;

        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                updateConnectionStatus(true);
                console.log('[P2P] WebSocket 连接成功');
                //// shownotification('已连接到信令服务器', 'success');
            };

            ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                handleMessage(message);
            };

            ws.onclose = () => {
                updateConnectionStatus(false);
                console.log('[P2P] WebSocket 连接断开');
                // 3秒后尝试重连
                setTimeout(initWebSocket, 3000);
            };

            ws.onerror = (error) => {
                console.error('[P2P] WebSocket 错误:', error);
            };
        } catch (error) {
            console.error('[P2P] WebSocket 初始化失败:', error);
            setTimeout(initWebSocket, 3000);
        }
    }

    // 处理服务器消息
    function handleMessage(message) {
        console.log('[P2P] 收到消息:', message.type, message);

        switch (message.type) {
            case 'welcome':
                handleWelcome(message);
                break;
            case 'client-list':
                handleClientList(message);
                break;
            case 'pair-request':
                handlePairRequest(message);
                break;
            case 'pair-success':
                handlePairSuccess(message);
                break;
            case 'pair-rejected':
                handlePairRejected(message);
                break;
            case 'pair-error':
                handlePairError(message);
                break;
            case 'webrtc-signal':
                handleWebRTCSignal(message);
                break;
            case 'partner-disconnected':
                handlePartnerDisconnected(message);
                break;
            default:
                console.warn('[P2P] 未知消息类型:', message.type);
        }
    }

    // 处理欢迎消息
    function handleWelcome(message) {
        myId = message.id;
        myIp = message.ip;
        isPrivate = message.isPrivate;

        updateDeviceInfo();

        // 通知服务器当前客户端类型
        sendToServer({
            type: 'update-type',
            clientType: 'userscript'
        });

        console.log('[P2P] 设备信息:', { myId, myIp, isPrivate });
    }

    // 处理客户端列表
    function handleClientList(message) {
        renderClientList(message.clients);
    }

    // 渲染客户端列表
    function renderClientList(clients) {
        const devicesList = document.getElementById('p2p-devices-list');
        if (!devicesList) return;

        if (!currentPartnerId && clients.length > 0) {
            devicesList.innerHTML = '';
            clients.forEach(client => {
                // 不显示自己
                if (client.id === myId) return;

                const deviceItem = document.createElement('div');
                deviceItem.className = 'p2p-device-item';
                deviceItem.innerHTML = `
                    <div class="p2p-device-info">
                        <span class="p2p-device-type">${client.type === 'userscript' ? '🦊' : '🌐'}</span>
                        <span class="p2p-device-id">${client.id}</span>
                    </div>
                    <div class="p2p-device-ip">${client.ip}</div>
                    <button class="p2p-btn p2p-btn-primary" data-client-id="${client.id}">配对</button>
                `;
                devicesList.appendChild(deviceItem);
            });

            // 绑定事件
            devicesList.querySelectorAll('button').forEach(btn => {
                btn.onclick = () => window.p2pRequestPair(btn.dataset.clientId);
            });
        } else if (currentPartnerId) {
            devicesList.innerHTML = '<p class="p2p-empty">已配对，列表已隐藏</p>';
        } else {
            devicesList.innerHTML = '<p class="p2p-empty">暂无可用设备</p>';
        }
    }

    // ========================================
    // 配对管理
    // ========================================
    let pendingPairRequest = null;
    let pairRequestTimeout = null;  // 配对请求超时定时器

    // ========================================
    // 配对超时处理
    // ========================================
    function clearPairRequestTimeout() {
        if (pairRequestTimeout) {
            clearTimeout(pairRequestTimeout);
            pairRequestTimeout = null;
        }
    }

    function setPairRequestTimeout() {
        // 30秒后自动取消配对请求
        clearPairRequestTimeout();
        pairRequestTimeout = setTimeout(() => {
            if (pendingPairRequest && !currentPartnerId) {
                console.warn('[P2P] 配对请求超时');
                showToast('配对请求超时，对方未响应', 'warning');
                cancelPairRequest();
            }
        }, 30000);  // 30秒超时
    }

    function cancelPairRequest() {
        clearPairRequestTimeout();
        pendingPairRequest = null;

        const pairRequestSection = document.getElementById('p2p-pair-request');
        const devicesSection = document.getElementById('p2p-devices-section');

        if (pairRequestSection) pairRequestSection.style.display = 'none';
        if (devicesSection) devicesSection.style.display = 'block';
    }

    // 请求配对（暴露给全局）
    window.p2pRequestPair = function (targetId) {
        // 防止重复请求
        if (currentPartnerId) {
            showToast('当前已配对，请先断开连接', 'warning');
            return;
        }

        // 防止重复请求同一设备
        if (pendingPairRequest === targetId) {
            showToast('已发送配对请求，请等待对方响应', 'info');
            return;
        }

        // 检查 WebSocket 连接状态
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            showToast('连接服务器中，请稍后再试', 'warning');
            return;
        }

        // 检查目标ID是否有效
        if (!targetId || targetId === myId) {
            showToast('无效的设备ID', 'error');
            return;
        }

        isInitiator = true;

        sendToServer({
            type: 'pair-request',
            targetId: targetId
        });

        showToast('已发送配对请求，请等待对方接受（30秒超时）', 'info');

        // 设置配对超时
        setPairRequestTimeout();
    };

    // 处理配对请求
    function handlePairRequest(message) {
        console.log('[P2P] 收到配对请求:', message);

        pendingPairRequest = message.requesterId;

        const pairRequestSection = document.getElementById('p2p-pair-request');
        const pairRequestInfo = document.getElementById('p2p-pair-request-info');
        const devicesList = document.getElementById('p2p-devices-list');

        // 检查可用设备数量（排除自己和当前配对伙伴）
        let availableDeviceCount = 0;
        if (devicesList) {
            const deviceItems = devicesList.querySelectorAll('.p2p-device-item');
            availableDeviceCount = deviceItems.length;
        }

        console.log('[P2P] 可用设备数量:', availableDeviceCount);

        // 自动接收配对：单设备场景
        if (availableDeviceCount === 1) {
            console.log('[P2P] 检测到唯一可用设备，自动接受配对:', message.requesterId);
            // 直接调用接受配对逻辑
            window.p2pAcceptPair();
            showToast('检测到唯一可用设备，已自动完成配对', 'success');
            return;
        }

        // 多设备场景，显示配对请求UI
        if (pairRequestSection && pairRequestInfo) {
            pairRequestInfo.textContent =
                `设备 ${message.requesterId} (${message.requesterType === 'userscript' ? '油猴脚本' : '网页'}) 请求与您配对`;
            pairRequestSection.style.display = 'block';

            // 隐藏可用设备列表
            const devicesSection = document.getElementById('p2p-devices-section');
            if (devicesSection) devicesSection.style.display = 'none';
        }

        // shownotification('收到配对请求', 'info');
    }

    // 接受配对
    window.p2pAcceptPair = function () {
        if (!pendingPairRequest) {
            showToast('没有待处理的配对请求', 'warning');
            return;
        }

        currentPartnerId = pendingPairRequest;
        isInitiator = false;

        // 清除超时
        clearPairRequestTimeout();

        sendToServer({
            type: 'pair-accept',
            requesterId: pendingPairRequest
        });

        const pairRequestSection = document.getElementById('p2p-pair-request');
        if (pairRequestSection) pairRequestSection.style.display = 'none';

        showToast('已接受配对请求，正在建立P2P连接...', 'success');

        // 接受方创建 PeerConnection 并等待信令
        createPeerConnection();
    };

    // 拒绝配对
    window.p2pRejectPair = function () {
        if (!pendingPairRequest) {
            showToast('没有待处理的配对请求', 'warning');
            return;
        }

        // 清除超时
        clearPairRequestTimeout();

        sendToServer({
            type: 'pair-reject',
            requesterId: pendingPairRequest,
            message: '配对请求被拒绝'
        });

        cancelPairRequest();

        showToast('已拒绝配对请求', 'warning');
    };

    // 处理配对成功
    function handlePairSuccess(message) {
        console.log('[P2P] 配对成功:', message);

        // 清除配对超时
        clearPairRequestTimeout();

        currentPartnerId = message.partnerId;

        updatePairStatus();

        const transferSection = document.getElementById('p2p-transfer-section');
        const devicesSection = document.getElementById('p2p-devices-section');
        const pairRequestSection = document.getElementById('p2p-pair-request');

        if (transferSection) transferSection.style.display = 'block';
        if (devicesSection) devicesSection.style.display = 'none';
        if (pairRequestSection) pairRequestSection.style.display = 'none';

        // 发起方创建 PeerConnection
        if (isInitiator) {
            console.log('[P2P] 作为发起方，创建PeerConnection');
            createPeerConnection();
        }

        showToast('配对成功！正在建立P2P连接...', 'success');
        // shownotification('P2P配对成功', 'success');

        // 已配对状态自动隐藏窗口，防止其他设备发起新的配对请求
        setTimeout(() => {
            if (panel && uiVisible) {
                panel.classList.add('p2p-hidden');
                uiVisible = false;
                console.log('[P2P] 配对成功，自动隐藏面板');
            }
        }, 1500);  // 延迟1.5秒隐藏，让用户看到配对成功的提示
    }

    // 处理配对拒绝
    function handlePairRejected(message) {
        console.warn('[P2P] 配对被拒绝:', message);

        currentPartnerId = null;
        isInitiator = false;
        pendingPairRequest = null;

        // 清除配对超时
        clearPairRequestTimeout();

        // 显示可用设备列表
        const devicesSection = document.getElementById('p2p-devices-section');
        if (devicesSection) devicesSection.style.display = 'block';

        // 根据消息显示不同提示
        const errorMsg = message.message || '配对请求被拒绝';
        showToast(errorMsg, 'error');
        // shownotification(errorMsg, 'warning');
    }

    // 处理配对错误
    function handlePairError(message) {
        console.error('[P2P] 配对错误:', message);

        currentPartnerId = null;
        isInitiator = false;
        pendingPairRequest = null;

        // 清除配对超时
        clearPairRequestTimeout();

        // 显示可用设备列表
        const devicesSection = document.getElementById('p2p-devices-section');
        if (devicesSection) devicesSection.style.display = 'block';

        const errorMsg = message.message || '配对失败';
        showToast(errorMsg, 'error');
        // shownotification(errorMsg, 'warning');
    }

    // 处理配对设备断开
    function handlePartnerDisconnected(message) {
        disconnectPeerConnection();
        showToast(message.reason || '对方已断开连接', 'warning');
        // shownotification('对方已断开连接', 'warning');
    }

    // 断开连接
    window.p2pDisconnect = function () {
        if (ws && currentPartnerId) {
            sendToServer({
                type: 'disconnect'
            });
            disconnectPeerConnection();
            showToast('已断开连接', 'info');
        } else if (currentPartnerId) {
            // 仅断开 P2P 连接，不发送服务器消息（如 WebSocket 未连接）
            disconnectPeerConnection();
            showToast('已断开连接', 'info');
        }
    };

    function disconnectPeerConnection() {
        if (dataChannel) {
            dataChannel.close();
            dataChannel = null;
        }

        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }

        currentPartnerId = null;
        isInitiator = false;

        const transferSection = document.getElementById('p2p-transfer-section');
        const devicesSection = document.getElementById('p2p-devices-section');

        if (transferSection) transferSection.style.display = 'none';
        if (devicesSection) devicesSection.style.display = 'block';

        updatePairStatus();
        updateP2PStatus(false);

        const receivedData = document.getElementById('p2p-received-data');
        if (receivedData) receivedData.innerHTML = '<p class="p2p-empty">暂无接收数据</p>';

        // 断开后恢复面板显示，允许重新发起/接收配对请求
        if (panel && !uiVisible) {
            panel.classList.remove('p2p-hidden');
            uiVisible = true;
            console.log('[P2P] 断开连接，自动显示面板');
        }
    }

    // ========================================
    // WebRTC 连接管理
    // ========================================
    function createPeerConnection() {
        // 注意：这里不使用 STUN/TURN 服务器，确保数据流仅在局域网传输
        config = {
            iceServers: []  // 空数组，强制使用本地候选者
        };

        peerConnection = new RTCPeerConnection(config);

        // ICE 候选者事件
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                // 安全校验：仅允许内网候选者
                if (!isPrivateIPEndpoint(event.candidate)) {
                    console.warn('[P2P] 忽略公网 ICE 候选者:', event.candidate);
                    return;
                }

                console.log('[P2P] 发送 ICE 候选者:', event.candidate);
                sendToServer({
                    type: 'webrtc-signal',
                    targetId: currentPartnerId,
                    signal: {
                        type: 'ice-candidate',
                        candidate: event.candidate
                    }
                });
            }
        };

        // ICE 连接状态变化
        peerConnection.oniceconnectionstatechange = () => {
            console.log('[P2P] ICE 状态:', peerConnection.iceConnectionState);

            if (peerConnection.iceConnectionState === 'connected' || peerConnection.iceConnectionState === 'completed') {
                updateP2PStatus(true);
                showToast('P2P连接已建立', 'success');
            } else if (peerConnection.iceConnectionState === 'disconnected' ||
                peerConnection.iceConnectionState === 'failed' ||
                peerConnection.iceConnectionState === 'closed') {
                updateP2PStatus(false);
            }
        };

        // 发起方创建数据通道
        if (isInitiator) {
            dataChannel = peerConnection.createDataChannel('data', {
                ordered: true  // 有序传输
            });

            setupDataChannel();

            // 创建 Offer
            peerConnection.createOffer()
                .then(offer => peerConnection.setLocalDescription(offer))
                .then(() => {
                    console.log('[P2P] 发送 Offer');
                    sendToServer({
                        type: 'webrtc-signal',
                        targetId: currentPartnerId,
                        signal: {
                            type: 'offer',
                            sdp: peerConnection.localDescription
                        }
                    });
                })
                .catch(error => {
                    console.error('[P2P] 创建 Offer 失败:', error);
                });
        } else {
            // 接受方监听数据通道
            peerConnection.ondatachannel = (event) => {
                dataChannel = event.channel;
                setupDataChannel();
            };
        }
    }

    // 设置数据通道
    function setupDataChannel() {
        dataChannel.onopen = () => {
            console.log('[P2P] 数据通道已打开');
            updateP2PStatus(true);
        };

        dataChannel.onclose = () => {
            console.log('[P2P] 数据通道已关闭');
            updateP2PStatus(false);
        };

        dataChannel.onerror = (error) => {
            console.error('[P2P] 数据通道错误:', error);
        };

        dataChannel.onmessage = (event) => {
            handleDataMessage(event.data);
        };
    }

    // 处理 WebRTC 信令
    function handleWebRTCSignal(message) {
        console.log('[P2P] 收到 WebRTC 信令:', message.signal.type);

        if (!peerConnection) {
            console.log('[P2P] PeerConnection 不存在，创建新的');
            createPeerConnection();
        }

        switch (message.signal.type) {
            case 'offer':
                handleOffer(message.signal);
                break;
            case 'answer':
                handleAnswer(message.signal);
                break;
            case 'ice-candidate':
                handleIceCandidate(message.signal);
                break;
        }
    }

    // 处理 Offer
    async function handleOffer(signal) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));

            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);

            console.log('[P2P] 发送 Answer');
            sendToServer({
                type: 'webrtc-signal',
                targetId: currentPartnerId,
                signal: {
                    type: 'answer',
                    sdp: answer
                }
            });
        } catch (error) {
            console.error('[P2P] 处理 Offer 失败:', error);
        }
    }

    // 处理 Answer
    async function handleAnswer(signal) {
        try {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } catch (error) {
            console.error('[P2P] 处理 Answer 失败:', error);
        }
    }

    // 处理 ICE 候选者
    async function handleIceCandidate(signal) {
        try {
            // 安全校验：仅允许内网候选者
            if (!isPrivateIPEndpoint(signal.candidate)) {
                console.warn('[P2P] 忽略公网 ICE 候选者:', signal.candidate);
                return;
            }

            await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (error) {
            console.error('[P2P] 添加 ICE 候选者失败:', error);
        }
    }

    // 安全校验：检查候选者是否为内网地址
    function isPrivateIPEndpoint(candidate) {
        if (!candidate || !candidate.candidate) return false;

        const candidateStr = candidate.candidate;

        // 检查 IP 地址
        const ipMatch = candidateStr.match(/(\d{1,3}\.){3}\d{1,3}/);
        if (ipMatch) {
            const ip = ipMatch[0];
            // 检查是否为私有IP
            const parts = ip.split('.').map(Number);
            if (parts[0] === 192 && parts[1] === 168) return true;  // 192.168.x.x
            if (parts[0] === 10) return true;  // 10.x.x.x
            if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;  // 172.16.x.x - 172.31.x.x
            if (parts[0] === 127) return true;  // 127.x.x.x

            return false;
        }

        // IPv6 链路本地地址
        if (candidateStr.includes('fe80:') || candidateStr.includes('fc00:') || candidateStr.includes('fd00:')) {
            return true;
        }

        return false;
    }

    // ========================================
    // 数据传输
    // ========================================

    // 发送文本
    window.p2pSendText = function () {
        const textInput = document.getElementById('p2p-text-input');
        const text = textInput ? textInput.value.trim() : '';

        if (!text) {
            showToast('请输入文本内容', 'warning');
            return;
        }

        if (dataChannel && dataChannel.readyState === 'open') {
            // 数据流仅在局域网传输，不经过公网服务器
            const message = {
                type: 'text',
                content: text,
                timestamp: Date.now()
            };

            dataChannel.send(JSON.stringify(message));
            if (textInput) textInput.value = '';
            showToast('文本已发送', 'success');

            // 显示在接收区域
            addReceivedItem({
                type: 'text',
                content: text,
                timestamp: Date.now(),
                isSelf: true
            });
        } else {
            showToast('P2P连接未建立，无法发送', 'error');
        }
    };

    // 发送文件
    window.p2pSendFile = function () {
        const fileInput = document.getElementById('p2p-file-input');
        const file = fileInput ? fileInput.files[0] : null;

        if (!file) {
            showToast('请选择文件', 'warning');
            return;
        }

        if (dataChannel && dataChannel.readyState === 'open') {
            sendFile(file);
            if (fileInput) fileInput.value = '';
        } else {
            showToast('P2P连接未建立，无法发送', 'error');
        }
    };

    // 发送文件
    function sendFile(file) {
        const fileId = generateFileId();
        const chunkSize = fileChunkSize;
        let offset = 0;

        // 数据流仅在局域网传输，不经过公网服务器
        const fileHeader = {
            type: 'file-header',
            fileId: fileId,
            name: file.name,
            size: file.size,
            type: file.type,
            chunks: Math.ceil(file.size / chunkSize),
            timestamp: Date.now()
        };

        dataChannel.send(JSON.stringify(fileHeader));

        const reader = new FileReader();

        reader.onload = (event) => {
            const chunk = event.target.result;

            // 发送分块
            dataChannel.send(chunk);

            offset += chunk.length;
            const progress = Math.round((offset / file.size) * 100);

            if (offset < file.size) {
                // 读取下一块
                readNextChunk(offset);
                showToast(`发送中: ${progress}%`, 'info');
            } else {
                // 发送完成
                dataChannel.send(JSON.stringify({
                    type: 'file-end',
                    fileId: fileId
                }));

                showToast('文件发送完成', 'success');

                // 显示在接收区域
                addReceivedItem({
                    type: 'file',
                    name: file.name,
                    size: file.size,
                    timestamp: Date.now(),
                    isSelf: true
                });
            }
        };

        function readNextChunk(offset) {
            const slice = file.slice(offset, offset + chunkSize);
            reader.readAsArrayBuffer(slice);
        }

        // 开始读取
        readNextChunk(0);
    }

    // 处理接收到的数据
    function handleDataMessage(data) {
        // 检查是否为文本消息（JSON）
        if (typeof data === 'string') {
            try {
                const message = JSON.parse(data);

                switch (message.type) {
                    case 'text':
                        addReceivedItem({
                            type: 'text',
                            content: message.content,
                            timestamp: message.timestamp,
                            isSelf: false
                        });
                        showToast('收到新文本', 'info');
                        // shownotification('收到新文本消息', 'info');
                        break;

                    case 'file-header':
                        // 初始化文件接收
                        currentFileTransfer = {
                            fileId: message.fileId,
                            name: message.name,
                            size: message.size,
                            type: message.type,
                            receivedChunks: 0,
                            totalChunks: message.chunks,
                            chunks: [],
                            startTime: Date.now()
                        };
                        showToast(`开始接收文件: ${message.name}`, 'info');
                        break;

                    case 'file-end':
                        // 文件接收完成
                        if (currentFileTransfer && currentFileTransfer.fileId === message.fileId) {
                            saveFile(currentFileTransfer);
                            currentFileTransfer = null;
                        }
                        break;
                }
            } catch (error) {
                console.error('[P2P] 解析消息失败:', error);
            }
        } else if (data instanceof ArrayBuffer) {
            // 处理文件分块
            if (currentFileTransfer) {
                currentFileTransfer.chunks.push(new Uint8Array(data));
                currentFileTransfer.receivedChunks++;

                const progress = Math.round((currentFileTransfer.receivedChunks / currentFileTransfer.totalChunks) * 100);

                if (currentFileTransfer.receivedChunks === currentFileTransfer.totalChunks) {
                    showToast('文件接收完成', 'success');
                } else {
                    showToast(`接收中: ${progress}%`, 'info');
                }
            }
        }
    }

    // 保存文件
    function saveFile(fileTransfer) {
        const blob = new Blob(fileTransfer.chunks, { type: fileTransfer.type });
        const url = URL.createObjectURL(blob);

        // 创建下载链接
        const a = document.createElement('a');
        a.href = url;
        a.download = fileTransfer.name;
        a.click();

        // 释放 URL
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        // 显示在接收区域
        addReceivedItem({
            type: 'file',
            name: fileTransfer.name,
            size: fileTransfer.size,
            timestamp: Date.now(),
            isSelf: false
        });

        // shownotification(`文件接收完成: ${fileTransfer.name}`, 'success');
    }

    // 添加接收项目到界面
    function addReceivedItem(item) {
        const receivedData = document.getElementById('p2p-received-data');
        if (!receivedData) return;

        const itemElement = document.createElement('div');
        itemElement.className = 'p2p-received-item';

        const time = new Date(item.timestamp).toLocaleTimeString();

        if (item.type === 'text') {
            itemElement.innerHTML = `
                <div class="p2p-received-item-header">
                    <span class="p2p-received-item-type text">文本</span>
                    <span class="p2p-received-item-time">${time} ${item.isSelf ? '(我发送)' : '(收到)'}</span>
                </div>
                <div class="p2p-received-item-content">${escapeHtml(item.content)}</div>
            `;
        } else if (item.type === 'file') {
            const sizeStr = formatFileSize(item.size);
            itemElement.innerHTML = `
                <div class="p2p-received-item-header">
                    <span class="p2p-received-item-type file">文件</span>
                    <span class="p2p-received-item-time">${time} ${item.isSelf ? '(我发送)' : '(收到)'}</span>
                </div>
                <div class="p2p-received-item-content">
                    <strong>${escapeHtml(item.name)}</strong> (${sizeStr})
                </div>
            `;
        }

        // 插入到列表顶部
        if (receivedData.querySelector('.p2p-empty')) {
            receivedData.innerHTML = '';
        }
        receivedData.insertBefore(itemElement, receivedData.firstChild);
    }

    // ========================================
    // UI 相关函数
    // ========================================

    // 创建悬浮按钮
    function createToggleButton() {
        toggleButton = document.createElement('div');
        toggleButton.id = 'p2p-toggle-btn';
        toggleButton.innerHTML = '📡';
        toggleButton.title = '局域网P2P传输';
        // 使用 mousedown 事件，与 handleGlobalClick 保持一致，避免事件冲突
        toggleButton.addEventListener('mousedown', (event) => {
            // 阻止事件传播，防止触发 handleGlobalClick
            event.stopPropagation();
            event.stopImmediatePropagation();
            togglePanel();
        }, true);
        document.body.appendChild(toggleButton);
    }

    // 创建主面板
    function createPanel() {
        panel = document.createElement('div');
        panel.id = 'p2p-panel';
        // 默认隐藏面板
        panel.classList.add('p2p-hidden');
        uiVisible = false;
        panel.innerHTML = `
            <!-- 删除标题栏，简化界面 -->
            <div class="p2p-panel-body">
                <!-- 设备信息区域：包含设备ID、配对状态和连接状态 -->
                <div class="p2p-section">
                    <h3>设备信息</h3>
                    <div class="p2p-info-card">
                        <div class="p2p-info-row">
                            <span class="p2p-label">ID：</span>
                            <span id="p2p-device-id">--</span>
                            <button class="p2p-copy-btn" id="p2p-copy-id" title="复制ID">📋</button>
                            <div class="p2p-status-bar-inline" style="margin-left: auto;">
                                <span id="p2p-status-indicator" class="p2p-status-indicator"></span>
                                <span id="p2p-status-text">未连接</span>
                            </div>
                        </div>
                        <div class="p2p-info-row">
                            <span class="p2p-label">配对：</span>
                            <span id="p2p-pair-status">未配对</span>
                            <button class="p2p-btn p2p-btn-danger p2p-disconnect-btn" id="p2p-disconnect-pair" style="display: none; margin-left: auto;">断开配对</button>
                        </div>
                    </div>
                </div>
                
                <!-- 配对请求 -->
                <div id="p2p-pair-request" class="p2p-pair-request" style="display: none;">
                    <div class="p2p-notification">
                        <p id="p2p-pair-request-info">--</p>
                        <div class="p2p-button-group">
                            <button class="p2p-btn p2p-btn-success" id="p2p-accept-pair">接受</button>
                            <button class="p2p-btn p2p-btn-danger" id="p2p-reject-pair">拒绝</button>
                        </div>
                    </div>
                </div>
                
                <!-- 可用设备 -->
                <div id="p2p-devices-section" class="p2p-section">
                    <h3>可用设备</h3>
                    <div id="p2p-devices-list" class="p2p-devices-list">
                        <p class="p2p-empty">暂无可用设备</p>
                    </div>
                </div>
                
                <!-- P2P传输区域 -->
                <div id="p2p-transfer-section" class="p2p-section" style="display: none;">
                    <h3>P2P 传输</h3>
                    
                    <!-- 发送区域 -->
                    <div class="p2p-send-section">
                        <h4>发送数据</h4>
                        <div class="p2p-input-group">
                            <textarea id="p2p-text-input" rows="3" placeholder="输入要发送的文本..."></textarea>
                            <button class="p2p-btn p2p-btn-primary" id="p2p-send-text">发送文本</button>
                        </div>
                        <div class="p2p-input-group">
                            <input type="file" id="p2p-file-input">
                            <button class="p2p-btn p2p-btn-primary" id="p2p-send-file">发送文件</button>
                        </div>
                    </div>
                    
                    <!-- 接收区域 -->
                    <div class="p2p-receive-section">
                        <h4>接收数据</h4>
                        <div id="p2p-received-data" class="p2p-received-data">
                            <p class="p2p-empty">暂无接收数据</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定事件监听器
        // 删除标题栏关闭按钮的事件绑定，因标题栏已删除
        document.getElementById('p2p-copy-id').onclick = () => window.p2pCopyId();
        document.getElementById('p2p-accept-pair').onclick = () => window.p2pAcceptPair();
        document.getElementById('p2p-reject-pair').onclick = () => window.p2pRejectPair();
        document.getElementById('p2p-send-text').onclick = () => window.p2pSendText();
        document.getElementById('p2p-send-file').onclick = () => window.p2pSendFile();
        document.getElementById('p2p-disconnect-pair').onclick = () => window.p2pDisconnect();
    }

    // 切换面板显示
    function togglePanel() {
        if (!panel) return;

        if (uiVisible) {
            panel.classList.add('p2p-hidden');
        } else {
            panel.classList.remove('p2p-hidden');
        }
        uiVisible = !uiVisible;
    }

    // 关闭面板
    window.p2pClosePanel = function () {
        if (panel) {
            panel.classList.add('p2p-hidden');
            uiVisible = false;
        }
    };

    // ========================================
    // 全局点击事件：点击窗口外部区域自动隐藏
    // ========================================
    function setupOutsideClickListener() {
        // 使用 mousedown 事件，比 click 响应更快
        document.addEventListener('mousedown', handleGlobalClick, true);
    }

    // 处理全局点击事件
    function handleGlobalClick(event) {
        if (!panel) return;

        // 如果面板不可见，不需要处理
        if (!uiVisible) return;

        // 检查点击目标是否在面板内
        // event.target 是实际被点击的元素
        const clickedElement = event.target;

        // 检查点击元素是否在面板 DOM 树内
        if (panel.contains(clickedElement)) {
            // 点击在面板内部，不隐藏
            return;
        }

        // 检查点击是否是悬浮按钮
        if (clickedElement === toggleButton || toggleButton.contains(clickedElement)) {
            // 点击悬浮按钮，不隐藏
            return;
        }

        // 点击在面板外部，隐藏面板
        console.log('[P2P] 点击面板外部，隐藏面板');
        panel.classList.add('p2p-hidden');
        uiVisible = false;
    }

    // 复制设备ID
    window.p2pCopyId = function () {
        if (myId) {
            GM_setClipboard(myId);
            showToast('设备ID已复制', 'success');
        }
    };

    // 更新设备信息
    // 更新设备信息（仅保留设备ID）
    function updateDeviceInfo() {
        const deviceId = document.getElementById('p2p-device-id');

        // 更新设备ID
        if (deviceId) {
            deviceId.textContent = myId || '--';
        }

        // 删除IP地址显示项，不再更新
        // 删除网络类型显示项，不再更新
    }

    // 更新连接状态
    function updateConnectionStatus(connected) {
        const indicator = document.getElementById('p2p-status-indicator');
        const text = document.getElementById('p2p-status-text');

        if (indicator && text) {
            if (connected) {
                indicator.className = 'p2p-status-indicator connected';
                text.textContent = '已连接';
            } else {
                indicator.className = 'p2p-status-indicator';
                text.textContent = '未连接';
            }
        }
    }

    // 更新配对状态
    function updatePairStatus() {
        const pairStatus = document.getElementById('p2p-pair-status');
        const disconnectPairBtn = document.getElementById('p2p-disconnect-pair');

        if (pairStatus) {
            pairStatus.textContent = currentPartnerId ? `${currentPartnerId}` : '未配对';
        }

        // 显示/隐藏"断开配对"按钮
        if (disconnectPairBtn) {
            if (currentPartnerId) {
                disconnectPairBtn.style.display = 'block';
            } else {
                disconnectPairBtn.style.display = 'none';
            }
        }
    }

    // 更新 P2P 状态
    function updateP2PStatus(connected) {
        const indicator = document.getElementById('p2p-p2p-indicator');
        const text = document.getElementById('p2p-p2p-status-text');

        if (indicator && text) {
            if (connected) {
                indicator.className = 'p2p-status-indicator connected';
                text.textContent = '已建立连接';
            } else {
                indicator.className = 'p2p-status-indicator disconnected';
                text.textContent = '未建立连接';
            }
        }
    }

    // 添加样式
    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* 悬浮按钮 */
            #p2p-toggle-btn {
                position: fixed;
                bottom: 20px;
                right: 20px;
                width: 56px;
                height: 56px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 24px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                z-index: 2147483647;
                transition: transform 0.2s, box-shadow 0.2s;
            }
            
            #p2p-toggle-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
            }
            
            /* 主面板 */
            #p2p-panel {
                position: fixed;
                top: 50%;
                right: 20px;
                transform: translateY(-50%);
                width: 380px;
                max-height: 80vh;
                background: white;
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
                z-index: 2147483646;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                transition: opacity 0.3s, transform 0.3s;
            }
            
            #p2p-panel.p2p-hidden {
                opacity: 0;
                transform: translateY(-50%) translateX(100%);
                pointer-events: none;
            }
            
            /* 面板头部 */
            .p2p-panel-header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 16px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .p2p-panel-title {
                font-size: 16px;
                font-weight: 600;
            }
            
            .p2p-close-btn {
                background: none;
                border: none;
                color: white;
                font-size: 24px;
                cursor: pointer;
                opacity: 0.8;
                transition: opacity 0.2s;
            }
            
            .p2p-close-btn:hover {
                opacity: 1;
            }
            
            /* 面板内容 */
            .p2p-panel-body {
                padding: 16px;
                overflow-y: auto;
                flex: 1;
            }
            
            /* 状态栏 - 原样式保留，用于向后兼容 */
            .p2p-status-bar {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 12px;
                background: #f5f5f5;
                border-radius: 8px;
                margin-bottom: 16px;
            }
            
            /* 行内状态栏 - 新增，用于设备信息区域右侧显示连接状态 */
            .p2p-status-bar-inline {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-left: auto;
                padding: 4px 8px;
                background: #f5f5f5;
                border-radius: 4px;
                font-size: 12px;
            }
            
            .p2p-status-bar-inline #p2p-status-text {
                font-size: 12px;
                color: #666;
            }
            
            .p2p-status-indicator {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                background: #ff4d4f;
                transition: background 0.3s;
            }
            
            .p2p-status-indicator.connected {
                background: #52c41a;
            }
            
            .p2p-status-indicator.disconnected {
                background: #ff4d4f;
            }
            
            /* Section */
            .p2p-section {
                margin-bottom: 16px;
            }
            
            .p2p-section h3 {
                font-size: 14px;
                font-weight: 600;
                margin-bottom: 10px;
                color: #333;
            }
            
            .p2p-section h4 {
                font-size: 13px;
                font-weight: 600;
                margin-bottom: 8px;
                color: #666;
            }
            
            /* 信息卡片 */
            .p2p-info-card {
                background: #f9f9f9;
                border-radius: 8px;
                padding: 12px;
            }
            
            .p2p-info-row {
                display: flex;
                align-items: center;
                padding: 6px 0;
                border-bottom: 1px solid #e8e8e8;
            }
            
            .p2p-info-row:last-child {
                border-bottom: none;
            }
            
            .p2p-label {
                font-weight: 500;
                min-width: 60px;
                color: #666;
            }
            
            .p2p-copy-btn {
                background: none;
                border: none;
                cursor: pointer;
                font-size: 14px;
                padding: 4px;
                opacity: 0.6;
                transition: opacity 0.2s;
            }
            
            .p2p-copy-btn:hover {
                opacity: 1;
            }
            
            /* 配对请求 */
            .p2p-pair-request {
                background: #fffbe6;
                border: 1px solid #ffe58f;
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 16px;
            }
            
            .p2p-notification p {
                margin: 0 0 12px 0;
                font-size: 14px;
                color: #d48806;
            }
            
            /* 按钮组 */
            .p2p-button-group {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
            }
            
            /* 按钮 */
            .p2p-btn {
                padding: 6px 12px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: all 0.2s;
            }
            
            .p2p-btn:hover {
                opacity: 0.9;
            }
            
            .p2p-btn-primary {
                background: #1890ff;
                color: white;
            }
            
            .p2p-btn-success {
                background: #52c41a;
                color: white;
            }
            
            .p2p-btn-danger {
                background: #ff4d4f;
                color: white;
            }
            
            .p2p-disconnect-btn {
                padding: 4px 12px;
                font-size: 12px;
                border-radius: 4px;
                border: none;
                cursor: pointer;
                transition: opacity 0.2s;
            }
            
            .p2p-disconnect-btn:hover {
                opacity: 0.8;
            }
            
            /* 设备列表 */
            .p2p-devices-list {
                max-height: 200px;
                overflow-y: auto;
            }
            
            .p2p-device-item {
                background: #f9f9f9;
                border-radius: 6px;
                padding: 12px;
                margin-bottom: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .p2p-device-info {
                flex: 1;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            
            .p2p-device-id {
                font-family: 'Courier New', monospace;
                font-weight: 600;
            }
            
            .p2p-device-ip {
                font-size: 12px;
                color: #999;
            }
            
            /* P2P传输区域 */
            .p2p-partner-info {
                background: #f9f9f9;
                border-radius: 6px;
                padding: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
            }
            
            .p2p-partner-info p {
                margin: 0;
                font-size: 14px;
            }
            
            .p2p-p2p-status {
                background: #f9f9f9;
                border-radius: 6px;
                padding: 10px 12px;
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 12px;
            }
            
            .p2p-p2p-status .p2p-status-indicator {
                width: 12px;
                height: 12px;
            }
            
            /* 发送区域 */
            .p2p-send-section {
                margin-bottom: 12px;
            }
            
            .p2p-input-group {
                background: #f9f9f9;
                border-radius: 6px;
                padding: 12px;
                margin-bottom: 8px;
            }
            
            .p2p-input-group textarea,
            .p2p-input-group input[type="file"] {
                width: 100%;
                padding: 8px;
                border: 1px solid #d9d9d9;
                border-radius: 4px;
                font-family: inherit;
                font-size: 13px;
                margin-bottom: 8px;
                resize: vertical;
            }
            
            .p2p-input-group textarea {
                min-height: 60px;
            }
            
            .p2p-input-group input[type="file"] {
                padding: 6px;
                background: white;
            }
            
            /* 接收区域 */
            .p2p-receive-section {
                margin-bottom: 12px;
            }
            
            .p2p-received-data {
                background: #f9f9f9;
                border-radius: 6px;
                padding: 12px;
                max-height: 200px;
                overflow-y: auto;
            }
            
            .p2p-received-item {
                background: white;
                border: 1px solid #e8e8e8;
                border-radius: 4px;
                padding: 10px;
                margin-bottom: 8px;
            }
            
            .p2p-received-item:last-child {
                margin-bottom: 0;
            }
            
            .p2p-received-item-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 6px;
            }
            
            .p2p-received-item-type {
                font-size: 11px;
                font-weight: 500;
                padding: 2px 6px;
                border-radius: 10px;
            }
            
            .p2p-received-item-type.text {
                background: #e6f7ff;
                color: #1890ff;
            }
            
            .p2p-received-item-type.file {
                background: #f6ffed;
                color: #52c41a;
            }
            
            .p2p-received-item-time {
                font-size: 11px;
                color: #999;
            }
            
            .p2p-received-item-content {
                font-size: 13px;
                word-break: break-all;
                max-height: 80px;
                overflow: hidden;
                text-overflow: ellipsis;
                background: #f5f5f5;
                padding: 6px;
                border-radius: 3px;
            }
            
            /* 空状态 */
            .p2p-empty {
                text-align: center;
                color: #999;
                padding: 16px;
                font-size: 13px;
            }
            
            /* Toast */
            .p2p-toast {
                position: fixed;
                top: 20px;
                right: 20px;
                background: white;
                padding: 12px 20px;
                border-radius: 4px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                z-index: 2147483647;
                animation: p2p-slideIn 0.3s;
                font-size: 14px;
            }
            
            .p2p-toast.success {
                border-left: 4px solid #52c41a;
            }
            
            .p2p-toast.error {
                border-left: 4px solid #ff4d4f;
            }
            
            .p2p-toast.warning {
                border-left: 4px solid #faad14;
            }
            
            .p2p-toast.info {
                border-left: 4px solid #1890ff;
            }
            
            @keyframes p2p-slideIn {
                from {
                    transform: translateX(100%);
                    opacity: 0;
                }
                to {
                    transform: translateX(0);
                    opacity: 1;
                }
            }
            
            /* 响应式 */
            @media (max-width: 480px) {
                #p2p-panel {
                    width: calc(100vw - 40px);
                    right: 20px;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ========================================
    // 工具函数
    // ========================================

    // 发送消息到服务器
    function sendToServer(message) {
        if (!ws) {
            console.error('[P2P] WebSocket未连接，无法发送消息:', message);
            showToast('WebSocket未连接，请检查网络', 'error');
            return false;
        }

        if (ws.readyState !== WebSocket.OPEN) {
            const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
            console.error('[P2P] WebSocket未就绪，当前状态:', stateNames[ws.readyState] || ws.readyState);
            console.error('[P2P] 尝试发送的消息:', message);
            showToast(`WebSocket未就绪 (${stateNames[ws.readyState] || ws.readyState})`, 'error');
            return false;
        }

        try {
            ws.send(JSON.stringify(message));
            console.log('[P2P] 消息已发送:', message);
            return true;
        } catch (error) {
            console.error('[P2P] 发送消息失败:', error, message);
            showToast('发送消息失败', 'error');
            return false;
        }
    }

    // 显示 Toast
    function showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `p2p-toast ${type}`;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'p2p-slideIn 0.3s reverse';
            setTimeout(() => {
                if (toast.parentNode) document.body.removeChild(toast);
            }, 300);
        }, 3000);
    }

    // 显示通知
    function // shownotification(text, type = 'info') {
        if (typeof GM_notification !== 'undefined') {
        GM_notification({
            text: text,
            highlight: type === 'error',
            timeout: 3000
        });
    }
}

    // 生成文件ID
    function generateFileId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// 格式化文件大小
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// 转义 HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// 启动
// ========================================
// 等待页面加载完成
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
}) ();
