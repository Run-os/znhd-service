const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

// 存储连接的客户端
// 结构: { id: { ws, type, ip, pairedWith } }
const clients = new Map();

// 生成唯一ID
function generateId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// 校验IP是否为内网地址
function isPrivateIP(ip) {
    if (!ip) return false;
    // IPv4 私有网段检查
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Pattern.test(ip)) {
        const parts = ip.split('.').map(Number);
        // 192.168.x.x
        if (parts[0] === 192 && parts[1] === 168) return true;
        // 10.x.x.x
        if (parts[0] === 10) return true;
        // 172.16.x.x - 172.31.x.x
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        // 127.x.x.x (本地回环)
        if (parts[0] === 127) return true;
    }
    // IPv6 私有地址检查 (fe80::/10 链路本地, fc00::/7 唯一本地)
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
    if (ipv6Pattern.test(ip)) {
        if (ip.startsWith('fe80') || ip.startsWith('fc00') || ip.startsWith('fd00')) return true;
        if (ip === '::1') return true;
    }
    return false;
}

// 检查两个IP是否在同一网段
function isSameNetwork(ip1, ip2) {
    if (!ip1 || !ip2) return false;

    // IPv4 网段检查
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Pattern.test(ip1) && ipv4Pattern.test(ip2)) {
        const parts1 = ip1.split('.').map(Number);
        const parts2 = ip2.split('.').map(Number);

        // 检查是否为同一 /24 网段（前三段相同）
        if (parts1[0] === parts2[0] && parts1[1] === parts2[1] && parts1[2] === parts2[2]) {
            return true;
        }

        // 特殊情况：10.x.x.x 范围较大，检查前两段
        if (parts1[0] === 10 && parts2[0] === 10) {
            if (parts1[1] === parts2[1]) return true;
        }
    }

    return false;
}

// Express 应用
const app = express();

// 提供静态文件（网页客户端）
app.use(express.static('public'));

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({ status: 'ok', clients: clients.size });
});

// 创建 HTTP 服务器
const server = http.createServer(app);

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ server, path: '/ws' });

// WebSocket 连接处理
wss.on('connection', (ws, req) => {
    const clientId = generateId();

    // 获取客户端IP
    const clientIp = req.socket.remoteAddress || req.headers['x-forwarded-for'];

    // 提取真实IP（处理 ::ffff: 前缀）
    const realIp = clientIp.startsWith('::ffff:') ? clientIp.slice(7) : clientIp;

    // 初始化客户端信息
    clients.set(clientId, {
        ws,
        id: clientId,
        type: 'unknown',
        ip: realIp,
        pairedWith: null,
        isPrivate: isPrivateIP(realIp)
    });

    console.log(`[${new Date().toISOString()}] 新连接: ${clientId}, IP: ${realIp}, 私有: ${clients.get(clientId).isPrivate}`);

    // 发送欢迎消息和客户端ID
    sendToClient(ws, {
        type: 'welcome',
        id: clientId,
        ip: realIp,
        isPrivate: clients.get(clientId).isPrivate
    });

    // 广播客户端列表
    broadcastClientList();

    // 处理消息
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(clientId, message);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] 消息解析错误:`, error);
        }
    });

    // 处理连接关闭
    ws.on('close', () => {
        const client = clients.get(clientId);
        if (client && client.pairedWith) {
            // 通知配对客户端
            const partner = clients.get(client.pairedWith);
            if (partner) {
                sendToClient(partner.ws, {
                    type: 'partner-disconnected',
                    reason: '对方已断开连接'
                });
                partner.pairedWith = null;
            }
        }
        clients.delete(clientId);
        console.log(`[${new Date().toISOString()}] 连接断开: ${clientId}`);
        broadcastClientList();
    });

    // 处理错误
    ws.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] WebSocket 错误:`, error);
    });
});

// 处理客户端消息
function handleMessage(clientId, message) {
    const client = clients.get(clientId);
    if (!client) return;

    switch (message.type) {
        case 'update-type':
            client.type = message.clientType;
            broadcastClientList();
            break;

        case 'pair-request':
            handlePairRequest(clientId, message);
            break;

        case 'pair-accept':
            handlePairAccept(clientId, message);
            break;

        case 'pair-reject':
            handlePairReject(clientId, message);
            break;

        case 'webrtc-signal':
            handleWebRTCSignal(clientId, message);
            break;

        case 'disconnect':
            handleDisconnect(clientId);
            break;

        default:
            console.warn(`[${new Date().toISOString()}] 未知消息类型: ${message.type}`);
    }
}

// 处理配对请求
function handlePairRequest(requesterId, message) {
    const requester = clients.get(requesterId);
    const target = clients.get(message.targetId);

    if (!requester || !target) {
        sendToClient(requester.ws, {
            type: 'pair-error',
            message: '目标客户端不存在'
        });
        return;
    }

    // 安全校验：仅允许内网地址之间建立连接
    if (!requester.isPrivate || !target.isPrivate) {
        sendToClient(requester.ws, {
            type: 'pair-error',
            message: '仅允许内网地址之间的连接'
        });
        console.warn(`[${new Date().toISOString()}] 配对拒绝: 非内网地址尝试连接`, {
            requester: requester.ip,
            target: target.ip
        });
        return;
    }

    // 网段校验：确保在同一局域网
    if (!isSameNetwork(requester.ip, target.ip)) {
        sendToClient(requester.ws, {
            type: 'pair-error',
            message: '仅允许同一局域网内的设备建立连接'
        });
        console.warn(`[${new Date().toISOString()}] 配对拒绝: 不同网段尝试连接`, {
            requester: requester.ip,
            target: target.ip
        });
        return;
    }

    // 检查是否已配对
    if (requester.pairedWith || target.pairedWith) {
        sendToClient(requester.ws, {
            type: 'pair-error',
            message: '对方已配对或您已配对'
        });
        return;
    }

    console.log(`[${new Date().toISOString()}] 配对请求: ${requesterId} -> ${message.targetId}`);

    // 转发配对请求给目标
    sendToClient(target.ws, {
        type: 'pair-request',
        requesterId: requesterId,
        requesterType: requester.type,
        requesterIp: requester.ip
    });
}

// 处理配对接受
function handlePairAccept(targetId, message) {
    const target = clients.get(targetId);
    const requester = clients.get(message.requesterId);

    if (!target || !requester) return;

    // 建立配对关系
    target.pairedWith = requester.id;
    requester.pairedWith = target.id;

    console.log(`[${new Date().toISOString()}] 配对成功: ${message.requesterId} <-> ${targetId}`);

    // 通知双方配对成功
    sendToClient(target.ws, {
        type: 'pair-success',
        partnerId: requester.id,
        partnerType: requester.type,
        partnerIp: requester.ip
    });

    sendToClient(requester.ws, {
        type: 'pair-success',
        partnerId: target.id,
        partnerType: target.type,
        partnerIp: target.ip
    });

    broadcastClientList();
}

// 处理配对拒绝
function handlePairReject(targetId, message) {
    const target = clients.get(targetId);
    const requester = clients.get(message.requesterId);

    if (requester) {
        sendToClient(requester.ws, {
            type: 'pair-rejected',
            message: message.message || '对方拒绝了配对请求'
        });
    }
}

// 处理 WebRTC 信令
function handleWebRTCSignal(senderId, message) {
    const sender = clients.get(senderId);
    const target = clients.get(message.targetId);

    if (!sender || !target || !sender.pairedWith || sender.pairedWith !== target.id) {
        console.warn(`[${new Date().toISOString()}] WebRTC 信令错误: 无效的配对关系`);
        return;
    }

    // 转发 WebRTC 信令给目标
    sendToClient(target.ws, {
        type: 'webrtc-signal',
        senderId: senderId,
        signal: message.signal
    });
}

// 处理断开连接
function handleDisconnect(clientId) {
    const client = clients.get(clientId);
    if (client && client.pairedWith) {
        const partner = clients.get(client.pairedWith);
        if (partner) {
            sendToClient(partner.ws, {
                type: 'partner-disconnected',
                reason: '对方已断开连接'
            });
            partner.pairedWith = null;
        }
        client.pairedWith = null;
    }
    broadcastClientList();
}

// 发送消息给指定客户端
function sendToClient(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

// 广播客户端列表（排除已配对的客户端）
function broadcastClientList() {
    const clientList = [];

    clients.forEach((client) => {
        // 仅广播未配对的客户端
        if (!client.pairedWith) {
            clientList.push({
                id: client.id,
                type: client.type,
                ip: client.ip,
                isPrivate: client.isPrivate
            });
        }
    });

    const message = {
        type: 'client-list',
        clients: clientList
    };

    // 发送给所有客户端
    clients.forEach((client) => {
        sendToClient(client.ws, message);
    });
}

// 启动服务器
server.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`  P2P 传输信令服务器`);
    console.log(`  监听端口: ${PORT}`);
    console.log(`  WebSocket: ws://0.0.0.0:${PORT}/ws`);
    console.log(`  网页客户端: http://0.0.0.0:${PORT}`);
    console.log(`========================================`);
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，正在关闭服务器...');
    wss.clients.forEach((ws) => {
        ws.close();
    });
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});
