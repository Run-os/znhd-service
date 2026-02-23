// ==UserScript==
// @name         P2P文件文本传输工具
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  通过二维码实现浏览器与本地设备的P2P文件/文本传输
// @author       You
// @match        *://*/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @require      https://cdn.bootcdn.net/ajax/libs/qrcodejs/1.0.0/qrcode.min.js
// @require      https://cdn.bootcdn.net/ajax/libs/socket.io/4.7.2/socket.io.min.js
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // 全局变量
    let localServerPort = 3000;
    let localIp = '45.207.199.216';
    let socket = null;
    let qrCodeContainer = null;

    // 1. 获取本地IP地址
    function getLocalIP() {
        return new Promise((resolve) => {
            const RTCPeerConnection = window.RTCPeerConnection || window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
            if (!RTCPeerConnection) {
                alert("你的浏览器不支持WebRTC，无法获取本地IP");
                resolve(null);
                return;
            }

            const pc = new RTCPeerConnection({ iceServers: [] });
            pc.createDataChannel('');
            pc.createOffer().then(offer => pc.setLocalDescription(offer));

            pc.onicecandidate = function (event) {
                if (!event.candidate) return;
                const ipRegex = /([0-9]{1,3}(\.[0-9]{1,3}){3})/;
                const match = event.candidate.candidate.match(ipRegex);
                if (match && match[1] && !match[1].startsWith('127.')) {
                    localIp = match[1];
                    pc.close();
                    resolve(localIp);
                }
            };
        });
    }

    // 2. 创建二维码容器
    function createQRCodeContainer(url) {
        // 移除旧的二维码容器
        if (qrCodeContainer) {
            qrCodeContainer.remove();
        }

        // 创建新容器
        qrCodeContainer = document.createElement('div');
        qrCodeContainer.style.position = 'fixed';
        qrCodeContainer.style.top = '20px';
        qrCodeContainer.style.right = '20px';
        qrCodeContainer.style.zIndex = '999999';
        qrCodeContainer.style.backgroundColor = 'white';
        qrCodeContainer.style.padding = '15px';
        qrCodeContainer.style.borderRadius = '8px';
        qrCodeContainer.style.boxShadow = '0 0 15px rgba(0,0,0,0.2)';

        // 关闭按钮
        const closeBtn = document.createElement('button');
        closeBtn.innerText = '关闭';
        closeBtn.style.position = 'absolute';
        closeBtn.style.top = '5px';
        closeBtn.style.right = '5px';
        closeBtn.style.padding = '2px 8px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.onclick = () => qrCodeContainer.remove();
        qrCodeContainer.appendChild(closeBtn);

        // 二维码元素
        const qrCodeDiv = document.createElement('div');
        qrCodeDiv.id = 'p2p-qrcode';
        qrCodeContainer.appendChild(qrCodeDiv);

        // 提示文本
        const tipText = document.createElement('p');
        tipText.innerText = '扫描二维码连接传输服务';
        tipText.style.textAlign = 'center';
        tipText.style.margin = '10px 0 0 0';
        qrCodeContainer.appendChild(tipText);

        document.body.appendChild(qrCodeContainer);

        // 生成二维码
        new QRCode(document.getElementById('p2p-qrcode'), {
            text: url,
            width: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    // 3. 启动本地传输服务
    async function startTransferService() {
        try {
            // 获取本地IP
            localIp = await getLocalIP();
            if (!localIp) return;

            const localUrl = `http://${localIp}:${localServerPort}`;

            // 提示用户需要先启动本地Node.js服务
            alert(`请先在本地启动Node.js服务：\n1. 创建server.js文件（见下方代码）\n2. 执行：npm install express socket.io cors\n3. 执行：node server.js\n\n你的连接地址：${localUrl}`);

            // 生成二维码
            createQRCodeContainer(localUrl);

            // 连接到本地socket服务
            socket = io(`http://${localIp}:${localServerPort}`);

            // 监听连接成功
            socket.on('connect', () => {
                console.log('已连接到本地传输服务');
            });

            // 监听接收文本
            socket.on('receiveText', (data) => {
                alert(`收到文本：\n${data}`);
            });

            // 监听接收文件
            socket.on('receiveFile', (fileData) => {
                // 创建下载链接
                const blob = new Blob([fileData.content], { type: fileData.type });
                const downloadLink = document.createElement('a');
                downloadLink.href = URL.createObjectURL(blob);
                downloadLink.download = fileData.name;
                downloadLink.click();
                URL.revokeObjectURL(downloadLink.href);
                alert(`收到文件：${fileData.name}`);
            });

        } catch (error) {
            console.error('启动传输服务失败：', error);
            alert('启动传输服务失败，请检查网络设置');
        }
    }

    // 4. 发送文本
    function sendText() {
        const text = prompt('请输入要发送的文本：');
        if (text && socket) {
            socket.emit('sendText', text);
            alert('文本发送成功');
        }
    }

    // 5. 发送文件
    function sendFile() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file && socket) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    socket.emit('sendFile', {
                        name: file.name,
                        type: file.type,
                        content: event.target.result
                    });
                    alert(`文件 ${file.name} 发送成功`);
                };
                reader.readAsArrayBuffer(file);
            }
        };
        fileInput.click();
    }

    // 注册油猴菜单命令
    GM_registerMenuCommand("启动P2P传输服务", startTransferService);
    GM_registerMenuCommand("发送文本", sendText);
    GM_registerMenuCommand("发送文件", sendFile);

})();