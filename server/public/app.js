// ========================================
// 局域网P2P传输 - 网页客户端
// 核心功能：通过 WebRTC 实现局域网内的高速数据传输
// 所有数据流仅在 192.168.x.x / 10.x.x.x 等内网网段传输
// ========================================

// 全局变量
let ws = null; // WebSocket 连接
let myId = null; // 当前设备ID
let myIp = null; // 当前设备IP
let isPrivate = false; // 是否为内网地址
let peerConnection = null; // WebRTC 连接
let dataChannel = null; // 数据通道
let config = null; // WebRTC 配置
let currentPartnerId = null; // 当前配对设备ID
let isInitiator = false; // 是否为发起方
let fileChunkSize = 16384; // 文件分块大小（16KB）
let heartbeatTimer = null; // 心跳定时器
const HEARTBEAT_INTERVAL = 25000; // 心跳间隔（毫秒），小于服务器超时时间

// DOM 元素
const elements = {
    statusIndicator: document.getElementById('statusIndicator'),
    statusText: document.getElementById('statusText'),
    deviceId: document.getElementById('deviceId'),
    deviceIp: document.getElementById('deviceIp'),
    networkType: document.getElementById('networkType'),
    pairStatus: document.getElementById('pairStatus'),
    pairRequestSection: document.getElementById('pairRequestSection'),
    pairRequestInfo: document.getElementById('pairRequestInfo'),
    acceptPairBtn: document.getElementById('acceptPairBtn'),
    rejectPairBtn: document.getElementById('rejectPairBtn'),
    availableDevicesSection: document.getElementById('availableDevicesSection'),
    devicesList: document.getElementById('devicesList'),
    transferArea: document.getElementById('transferArea'),
    partnerInfo: document.getElementById('partnerInfo'),
    disconnectPairBtn: document.getElementById('disconnectPairBtn'),
    p2pStatus: document.getElementById('p2pStatus'),
    p2pIndicator: document.getElementById('p2pIndicator'),
    p2pStatusText: document.getElementById('p2pStatusText'),
    textInput: document.getElementById('textInput'),
    sendTextBtn: document.getElementById('sendTextBtn'),
    fileInput: document.getElementById('fileInput'),
    sendFileBtn: document.getElementById('sendFileBtn'),
    receivedData: document.getElementById('receivedData'),
    copyIdBtn: document.getElementById('copyIdBtn')
};

// ========================================
// WebSocket 连接管理
// ========================================

// 初始化 WebSocket 连接
function initWebSocket() {
    // 获取当前协议和主机
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws`;

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            updateConnectionStatus(true);
            console.log('WebSocket 连接成功');

            // 启动心跳
            startHeartbeat();

            // 发送客户端类型
            sendToServer({
                type: 'update-type',
                clientType: 'web'
            });
            
            // 如果已有设备ID，重连时发送register保持ID
            if (myId) {
                console.log('[P2P] 重连时注册设备ID:', myId);
                sendToServer({
                    type: 'register',
                    deviceId: myId,
                    deviceName: 'web-' + myId
                });
            }
        };

        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            handleMessage(message);
        };

        ws.onclose = () => {
            updateConnectionStatus(false);
            // 停止心跳
            stopHeartbeat();
            console.log('WebSocket 连接断开');
            // 3秒后尝试重连
            setTimeout(initWebSocket, 3000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket 错误:', error);
        };
    } catch (error) {
        console.error('WebSocket 初始化失败:', error);
        setTimeout(initWebSocket, 3000);
    }
}

// 处理服务器消息
function handleMessage(message) {
    console.log('收到消息:', message.type);

    switch (message.type) {
        case 'welcome':
            handleWelcome(message);
            break;
        case 'client-list':
            handleClientList(message);
            break;
        case 'client-disconnected':
            // 收到服务器发来的客户端断开通知，不需要特殊处理
            // 设备列表会在下次收到client-list时自动更新
            console.log('[P2P] 收到客户端断开通知:', message.clientId);
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
        case 'pong':
            // 收到服务器pong响应，心跳正常
            console.log('[P2P] 收到心跳响应');
            break;
        default:
            console.warn('未知消息类型:', message.type);
    }
}

// 处理欢迎消息
// 处理欢迎消息
function handleWelcome(message) {
    myId = message.id;
    myIp = message.ip;
    isPrivate = message.isPrivate;

    elements.deviceId.textContent = myId;
    // 删除IP地址显示项，不再更新
    // 删除网络类型显示项，不再更新

    // 通知服务器当前客户端类型
    sendToServer({
        type: 'update-type',
        clientType: 'web'
    });

    console.log('设备信息:', { myId, myIp, isPrivate });
}

// 处理客户端列表
function handleClientList(message) {
    const clients = message.clients;
    renderClientList(clients);
}

// 渲染客户端列表
function renderClientList(clients) {
    if (!currentPartnerId && clients.length > 0) {
        let html = '';
        clients.forEach(client => {
            // 不显示自己
            if (client.id === myId) return;

            html += `
                <div class="device-item">
                    <div class="device-item-info">
                        <h4>
                            <span class="device-type-badge ${client.type}">${client.type === 'userscript' ? '油猴脚本' : '网页'}</span>
                            ${client.id}
                        </h4>
                        <!-- 删除IP和网络信息显示 -->
                    </div>
                    <button class="btn btn-primary" onclick="requestPair('${client.id}')">请求配对</button>
                </div>
            `;
        });
        elements.devicesList.innerHTML = html || '<p class="empty">暂无可用设备</p>';
    } else if (currentPartnerId) {
        elements.devicesList.innerHTML = '<p class="empty">已配对，列表已隐藏</p>';
    } else {
        elements.devicesList.innerHTML = '<p class="empty">暂无可用设备</p>';
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

    const pairRequestSection = document.getElementById('pairRequestSection');
    const devicesSection = document.getElementById('availableDevicesSection');

    if (pairRequestSection) pairRequestSection.style.display = 'none';
    if (devicesSection) devicesSection.style.display = 'block';
}

// 请求配对
function requestPair(targetId) {
    console.log('[P2P] 请求配对，目标ID:', targetId);

    // 防止重复请求
    if (currentPartnerId) {
        console.warn('[P2P] 当前已配对，无法发起新配对');
        showToast('当前已配对，请先断开连接', 'warning');
        return;
    }

    // 防止重复请求同一设备
    if (pendingPairRequest === targetId) {
        console.warn('[P2P] 已发送配对请求，请等待对方响应');
        showToast('已发送配对请求，请等待对方响应', 'info');
        return;
    }

    // 检查 WebSocket 连接状态
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.error('[P2P] WebSocket 未连接，无法发送配对请求');
        showToast('连接服务器中，请稍后再试', 'warning');
        return;
    }

    // 检查目标ID是否有效
    if (!targetId || targetId === myId) {
        console.error('[P2P] 无效的设备ID:', targetId);
        showToast('无效的设备ID', 'error');
        return;
    }

    isInitiator = true;

    console.log('[P2P] 发送配对请求消息');
    sendToServer({
        type: 'pair-request',
        targetId: targetId
    });

    showToast('已发送配对请求，请等待对方接受（30秒超时）', 'info');

    // 设置配对超时
    setPairRequestTimeout();
}

// 处理配对请求
function handlePairRequest(message) {
    console.log('[P2P] 收到配对请求:', message);

    pendingPairRequest = message.requesterId;

    // 检查可用设备数量（排除自己和当前配对伙伴）
    const deviceItems = elements.devicesList.querySelectorAll('.device-item');
    const availableDeviceCount = deviceItems.length;

    console.log('[P2P] 可用设备数量:', availableDeviceCount);

    // 自动接收配对：单设备场景
    if (availableDeviceCount === 1) {
        console.log('[P2P] 检测到唯一可用设备，自动接受配对:', message.requesterId);
        // 直接调用接受配对逻辑
        acceptPairRequest();
        showToast('检测到唯一可用设备，已自动完成配对', 'success');
        return;
    }

    // 多设备场景，显示配对请求UI
    elements.pairRequestInfo.textContent =
        `设备 ${message.requesterId} (${message.requesterType === 'userscript' ? '油猴脚本' : '网页'}) 请求与您配对`;
    elements.pairRequestSection.style.display = 'block';

    // 隐藏可用设备列表
    elements.availableDevicesSection.style.display = 'none';
}

// 接受配对（内部函数）
function acceptPairRequest() {
    if (!pendingPairRequest) {
        console.warn('[P2P] 没有待处理的配对请求');
        showToast('没有待处理的配对请求', 'warning');
        return;
    }

    console.log('[P2P] 接受配对请求，配对方ID:', pendingPairRequest);

    currentPartnerId = pendingPairRequest;
    isInitiator = false;

    // 清除超时（如果是作为发起方发送的请求超时）
    clearPairRequestTimeout();

    console.log('[P2P] 发送配对接受消息');
    sendToServer({
        type: 'pair-accept',
        requesterId: pendingPairRequest
    });

    pendingPairRequest = null;
    elements.pairRequestSection.style.display = 'none';

    showToast('已接受配对请求，正在建立P2P连接...', 'success');

    // 接受方创建 PeerConnection 并等待信令
    createPeerConnection();
}

// 接受配对按钮事件
elements.acceptPairBtn.addEventListener('click', () => {
    acceptPairRequest();
});

// 拒绝配对
elements.rejectPairBtn.addEventListener('click', () => {
    if (!pendingPairRequest) {
        console.warn('[P2P] 没有待处理的配对请求');
        showToast('没有待处理的配对请求', 'warning');
        return;
    }

    console.log('[P2P] 拒绝配对请求，配对方ID:', pendingPairRequest);

    sendToServer({
        type: 'pair-reject',
        requesterId: pendingPairRequest,
        message: '配对请求被拒绝'
    });

    pendingPairRequest = null;
    elements.pairRequestSection.style.display = 'none';
    elements.availableDevicesSection.style.display = 'block';
    showToast('已拒绝配对请求', 'warning');
});

// 处理配对成功
function handlePairSuccess(message) {
    console.log('[P2P] 配对成功:', message);

    // 清除配对超时
    clearPairRequestTimeout();

    currentPartnerId = message.partnerId;
    elements.pairStatus.textContent = `${message.partnerId}`;
    elements.transferArea.style.display = 'block';
    elements.availableDevicesSection.style.display = 'none';
    elements.pairRequestSection.style.display = 'none';
    elements.disconnectPairBtn.style.display = 'inline-block';

    // 发起方创建 PeerConnection
    if (isInitiator) {
        console.log('[P2P] 作为发起方，创建PeerConnection');
        createPeerConnection();
    }

    showToast('配对成功！正在建立P2P连接...', 'success');
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
    elements.availableDevicesSection.style.display = 'block';

    const errorMsg = message.message || '配对请求被拒绝';
    showToast(errorMsg, 'error');

    renderClientList(getCurrentClientList());
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
    elements.availableDevicesSection.style.display = 'block';

    const errorMsg = message.message || '配对失败';
    showToast(errorMsg, 'error');

    renderClientList(getCurrentClientList());
}

// 处理配对设备断开
function handlePartnerDisconnected(message) {
    disconnectPeerConnection();
    showToast(message.reason || '对方已断开连接', 'warning');
}

// 断开配对（设备信息区域）
elements.disconnectPairBtn.addEventListener('click', () => {
    if (ws && currentPartnerId) {
        sendToServer({
            type: 'disconnect'
        });
        disconnectPeerConnection();
        elements.disconnectPairBtn.style.display = 'none';
        showToast('已断开配对', 'info');
    }
});

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
    elements.transferArea.style.display = 'none';
    elements.availableDevicesSection.style.display = 'block';
    elements.pairStatus.textContent = '未配对';
    elements.disconnectPairBtn.style.display = 'none';
    updateP2PStatus(false);
    elements.receivedData.innerHTML = '<p class="empty">暂无接收数据</p>';
}

// ========================================
// WebRTC 连接管理
// ========================================

// 创建 WebRTC PeerConnection
function createPeerConnection() {
    // 注意：这里不使用 STUN/TURN 服务器，确保数据流仅在局域网传输
    config = {
        iceServers: [] // 空数组，强制使用本地候选者
    };

    peerConnection = new RTCPeerConnection(config);

    // ICE 候选者事件
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            // 安全校验：仅允许内网候选者
            if (!isPrivateIPEndpoint(event.candidate)) {
                console.warn('忽略公网 ICE 候选者:', event.candidate);
                return;
            }

            console.log('发送 ICE 候选者:', event.candidate);
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
        console.log('ICE 状态:', peerConnection.iceConnectionState);

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
            ordered: true // 有序传输
        });

        setupDataChannel();

        // 创建 Offer
        peerConnection.createOffer()
            .then(offer => peerConnection.setLocalDescription(offer))
            .then(() => {
                console.log('发送 Offer');
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
                console.error('创建 Offer 失败:', error);
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
        console.log('数据通道已打开');
        updateP2PStatus(true);
    };

    dataChannel.onclose = () => {
        console.log('数据通道已关闭');
        updateP2PStatus(false);
    };

    dataChannel.onerror = (error) => {
        console.error('数据通道错误:', error);
    };

    dataChannel.onmessage = (event) => {
        handleDataMessage(event.data);
    };
}

// 处理 WebRTC 信令
function handleWebRTCSignal(message) {
    console.log('收到 WebRTC 信令:', message.signal.type);

    if (!peerConnection) {
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

        console.log('发送 Answer');
        sendToServer({
            type: 'webrtc-signal',
            targetId: currentPartnerId,
            signal: {
                type: 'answer',
                sdp: answer
            }
        });
    } catch (error) {
        console.error('处理 Offer 失败:', error);
    }
}

// 处理 Answer
async function handleAnswer(signal) {
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    } catch (error) {
        console.error('处理 Answer 失败:', error);
    }
}

// 处理 ICE 候选者
async function handleIceCandidate(signal) {
    try {
        // 安全校验：仅允许内网候选者
        if (!isPrivateIPEndpoint(signal.candidate)) {
            console.warn('忽略公网 ICE 候选者:', signal.candidate);
            return;
        }

        await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
    } catch (error) {
        console.error('添加 ICE 候选者失败:', error);
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
        if (parts[0] === 192 && parts[1] === 168) return true; // 192.168.x.x
        if (parts[0] === 10) return true; // 10.x.x.x
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.x.x - 172.31.x.x
        if (parts[0] === 127) return true; // 127.x.x.x

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

// 当前正在传输的文件
let currentFileTransfer = null;

// 发送文本
elements.sendTextBtn.addEventListener('click', () => {
    const text = elements.textInput.value.trim();
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
        elements.textInput.value = '';
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
});

// 发送文件
elements.sendFileBtn.addEventListener('click', () => {
    const file = elements.fileInput.files[0];
    if (!file) {
        showToast('请选择文件', 'warning');
        return;
    }

    if (dataChannel && dataChannel.readyState === 'open') {
        sendFile(file);
        elements.fileInput.value = '';
    } else {
        showToast('P2P连接未建立，无法发送', 'error');
    }
});

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
            console.error('解析消息失败:', error);
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
}

// 添加接收项目到界面
function addReceivedItem(item) {
    const itemElement = document.createElement('div');
    itemElement.className = 'received-item';

    const time = new Date(item.timestamp).toLocaleTimeString();

    if (item.type === 'text') {
        itemElement.innerHTML = `
            <div class="received-item-header">
                <span class="received-item-type text">文本</span>
                <span class="received-item-time">${time} ${item.isSelf ? '(我发送)' : '(收到)'}</span>
            </div>
            <div class="received-item-content">${escapeHtml(item.content)}</div>
        `;
    } else if (item.type === 'file') {
        const sizeStr = formatFileSize(item.size);
        itemElement.innerHTML = `
            <div class="received-item-header">
                <span class="received-item-type file">文件</span>
                <span class="received-item-time">${time} ${item.isSelf ? '(我发送)' : '(收到)'}</span>
            </div>
            <div class="received-item-content">
                <strong>${escapeHtml(item.name)}</strong> (${sizeStr})
            </div>
        `;
    }

    // 插入到列表顶部
    if (elements.receivedData.querySelector('.empty')) {
        elements.receivedData.innerHTML = '';
    }
    elements.receivedData.insertBefore(itemElement, elements.receivedData.firstChild);
}

// ========================================
// 工具函数
// ========================================

// 发送消息到服务器
function sendToServer(message) {
    if (!ws) {
        console.error('[P2P] WebSocket 未连接，无法发送消息:', message);
        showToast('WebSocket未连接，请检查网络', 'error');
        return false;
    }

    if (ws.readyState !== WebSocket.OPEN) {
        const stateNames = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
        console.error('[P2P] WebSocket 未就绪，当前状态:', stateNames[ws.readyState] || ws.readyState);
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

// 更新连接状态
function updateConnectionStatus(connected) {
    if (connected) {
        elements.statusIndicator.className = 'status-indicator connected';
        elements.statusText.textContent = '已连接';
    } else {
        elements.statusIndicator.className = 'status-indicator';
        elements.statusText.textContent = '未连接';
    }
}

// 更新 P2P 状态
function updateP2PStatus(connected) {
    if (connected) {
        elements.p2pIndicator.className = 'status-indicator connected';
        elements.p2pStatusText.textContent = '已建立连接';
    } else {
        elements.p2pIndicator.className = 'status-indicator disconnected';
        elements.p2pStatusText.textContent = '未建立连接';
    }
}

// 显示 Toast 提示
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s reverse';
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
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
// 心跳机制
// ========================================
function startHeartbeat() {
    // 清除已有的心跳定时器
    stopHeartbeat();

    // 定时发送心跳
    heartbeatTimer = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendToServer({ type: 'ping' });
        }
    }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }
}

// 获取当前客户端列表（临时存储）
let currentClientList = [];
function getCurrentClientList() {
    return currentClientList;
}
function handleClientList(message) {
    currentClientList = message.clients;
    renderClientList(message.clients);
}

// 复制设备ID
elements.copyIdBtn.addEventListener('click', () => {
    if (myId) {
        navigator.clipboard.writeText(myId).then(() => {
            showToast('设备ID已复制', 'success');
        }).catch(() => {
            showToast('复制失败', 'error');
        });
    }
});

// ========================================
// 初始化
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    // 初始化 WebSocket 连接
    initWebSocket();

    console.log('局域网P2P传输工具已初始化');
    console.log('数据流安全说明：所有文件和文本数据仅通过 WebRTC 在局域网内直接传输，不会经过公网服务器');
});
