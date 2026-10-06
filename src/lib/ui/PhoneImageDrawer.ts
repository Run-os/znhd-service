/**
 * 设备互联抽屉（原 app.ts 的 PhoneImageDrawer）：本机上传链接 + 二维码 + 发送到手机。
 * 模块化 P5：逐字迁移，仅加 export。
 */

import { addLog } from '@/lib/logger';
import { safeCopyText } from '@/lib/clipboard';
import { RELAY_MAX_BODY, imagePayloadBytes, getDeviceId, sendToPhone } from '@/lib/relay';
import { genQrDataUrl } from '@/lib/qrcode';

/** PhoneImageDrawer 组件属性 */
export interface PhoneImageDrawerProps {
    visible: boolean;
    setVisible: (v: boolean) => void;
    relayServer: string;
    onChangeRelayServer: (url: string) => void;
}

export function PhoneImageDrawer({ visible, setVisible, relayServer, onChangeRelayServer }: PhoneImageDrawerProps) {
    const deviceId = getDeviceId();
    const [qrUrl, setQrUrl] = CAT_UI.useState('');
    const [link, setLink] = CAT_UI.useState('');
    const [phoneOnline, setPhoneOnline] = CAT_UI.useState(false);
    const [sending, setSending] = CAT_UI.useState(false);
    const [sendText, setSendText] = CAT_UI.useState('');
    const copyLink = () => {
        if (link) safeCopyText(link);
    };

    // 计算链接 + 二维码（仅在打开抽屉或地址变化时；非 http(s) 前缀即设置输入中途，不生成）
    CAT_UI.useEffect(() => {
        const s = (relayServer || '').trim().replace(/\/+$/, '');
        if (!/^https?:\/\//i.test(s)) {
            setLink('');
            setQrUrl('');
            return;
        }
        const lk = s + '/u/' + deviceId;
        setLink(lk);
        genQrDataUrl(lk)
            .then((u) => setQrUrl(u))
            .catch((e) => {
                addLog('[二维码] 失败: ' + e.message, 'error', true);
            });
    }, [relayServer, visible]);

    // 轮询手机在线状态（每 5s），用于发送前判断是否可发
    CAT_UI.useEffect(() => {
        const server = (relayServer || '').trim().replace(/\/+$/, '');
        if (!visible || !/^https?:\/\//i.test(server)) return; // 非法前缀（设置里逐字输入中）不发起请求
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
                        let j = null;
                        try {
                            j = JSON.parse(r.responseText);
                        } catch (e) {
                            j = null;
                        }
                        setPhoneOnline(!!(j && j.online));
                    },
                    onerror: () => {
                        if (alive) setPhoneOnline(false);
                    },
                });
            } catch (e) {
                if (alive) setPhoneOnline(false);
            }
        };
        check();
        const t = setInterval(check, 5000);
        return () => {
            alive = false;
            clearInterval(t);
        };
    }, [visible, relayServer, deviceId]);

    // 发送文本到手机
    const doSendText = () => {
        const t = (sendText || '').trim();
        if (!t) {
            addLog('[发送到手机] 文本为空', 'error', true);
            return;
        }
        if (!phoneOnline) {
            addLog('[发送到手机] 当前无在线设备，无法发送', 'error', true);
            return;
        }
        setSending(true);
        sendToPhone({
            server: relayServer,
            uuid: deviceId,
            payload: { text: t },
            onOk: () => {
                addLog('[发送到手机] 文本已发送', 'success');
                setSendText('');
                setSending(false);
            },
            onFail: (e: any) => {
                addLog('[发送到手机] 发送失败：' + e, 'error');
                setSending(false);
            },
        });
    };

    // 选择图片到手机：选完仅加入「待发送」预览列表，不立即上传；点「发送」才真正发送。
    // 与手机端上传页（选图 → 下方预览 → 点发送）行为一致，避免误选即发的冲动操作。
    const [pendingImages, setPendingImages] = CAT_UI.useState([]);

    const pickImages = () => {
        if (!phoneOnline) {
            addLog('[发送到手机] 当前无在线设备，无法发送', 'error', true);
            return;
        }
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.multiple = true;
        inp.style.display = 'none';
        document.body.appendChild(inp);
        // 取消选择（对话框关闭但未选文件）也要移除隐藏 input：'cancel' 事件非标准，
        // 用「对话框关闭后 window 恢复焦点」兜底清理，避免反复取消在 body 累积 input
        const cleanupFocus = () => {
            window.removeEventListener('focus', cleanupFocus);
            try {
                inp.remove();
            } catch (e) {
                /* 已移除 */
            }
        };
        inp.onchange = () => {
            const files = Array.prototype.slice.call(inp.files || []);
            window.removeEventListener('focus', cleanupFocus);
            inp.remove();
            if (!files.length) return;
            const arr = files.map((f) => ({
                file: f,
                name: f.name || 'image.jpg',
                mime: f.type || 'image/jpeg',
                url: URL.createObjectURL(f),
            }));
            setPendingImages((prev: any) => prev.concat(arr));
        };
        window.addEventListener('focus', cleanupFocus);
        inp.click();
    };

    const removePendingImage = (i: any) => {
        if (sending) return; // 发送中禁止移除：发送按快照进行，移除会导致界面与实际发送不一致
        const arr = pendingImages.slice();
        const removed = arr.splice(i, 1)[0];
        try {
            URL.revokeObjectURL(removed.url);
        } catch (e) {
            /* 忽略 */
        }
        setPendingImages(arr);
    };

    // 真正发送：逐张顺序发送（一张成功再发下一张，保证到达顺序；失败即停并提示进度）。
    // 中继服务端手机收件通道已队列化（phonePending FIFO），连发不会互相覆盖。
    const confirmSendImage = () => {
        if (!pendingImages.length) return;
        if (!phoneOnline) {
            addLog('[发送到手机] 当前无在线设备，无法发送', 'error', true);
            return;
        }
        setSending(true);
        const list = pendingImages.slice();
        const total = list.length;
        let sent = 0;
        const sendNext = () => {
            if (sent >= total) {
                // 发送成功后释放所有待发送图片的 objectURL，防止 blob URL 累积泄漏
                list.forEach((it: any) => {
                    try {
                        URL.revokeObjectURL(it.url);
                    } catch (e) {
                        /* 忽略 */
                    }
                });
                addLog('[发送到手机] ' + total + ' 张图片已全部发送', 'success');
                setSending(false);
                setPendingImages([]);
                return;
            }
            const it = list[sent];
            // 体积预检：base64 膨胀后若超服务端单请求上限，直接友好报错停止（不盲目传一半再被 413）
            if (imagePayloadBytes(it.file, it.name, it.mime) > RELAY_MAX_BODY) {
                addLog(
                    '[发送到手机] 第 ' +
                        (sent + 1) +
                        ' 张过大（单张约 12MB 上限），已停止，请压缩后再试（已发 ' +
                        sent +
                        '/' +
                        total +
                        '）',
                    'error',
                    true
                );
                setSending(false);
                return;
            }
            addLog('[发送到手机] 正在发送（' + (sent + 1) + '/' + total + '）：' + (it.name || 'image'), 'info');
            const rd = new FileReader();
            rd.onload = () => {
                const b64 = ((rd.result as string) || '').split(',')[1] || '';
                if (!b64) {
                    addLog(
                        '[发送到手机] 第 ' + (sent + 1) + ' 张读取失败，已停止（已发 ' + sent + '/' + total + '）',
                        'error',
                        true
                    );
                    setSending(false);
                    return;
                }
                sendToPhone({
                    server: relayServer,
                    uuid: deviceId,
                    payload: { name: it.name, mime: it.mime, data: b64 },
                    onOk: () => {
                        sent++;
                        sendNext();
                    },
                    onFail: (e: any) => {
                        addLog(
                            '[发送到手机] 第 ' +
                                (sent + 1) +
                                ' 张发送失败：' +
                                e +
                                '（已发 ' +
                                sent +
                                '/' +
                                total +
                                '）',
                            'error'
                        );
                        setSending(false);
                    },
                });
            };
            rd.onerror = () => {
                addLog(
                    '[发送到手机] 第 ' + (sent + 1) + ' 张读取失败，已停止（已发 ' + sent + '/' + total + '）',
                    'error',
                    true
                );
                setSending(false);
            };
            rd.readAsDataURL(it.file);
        };
        sendNext();
    };

    return CAT_UI.Drawer(
        CAT_UI.createElement('div', { style: { textAlign: 'left' } }, [
            link
                ? CAT_UI.createElement(
                      'div',
                      { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', flexWrap: 'wrap' } },
                      [
                          // 左侧：二维码
                          CAT_UI.createElement('div', { style: { flexShrink: '0' } }, [
                              qrUrl
                                  ? CAT_UI.createElement('div', {
                                        style: {
                                            width: '140px',
                                            height: '140px',
                                            backgroundImage: 'url("' + qrUrl + '")',
                                            backgroundSize: 'contain',
                                            backgroundRepeat: 'no-repeat',
                                            backgroundPosition: 'center',
                                            border: '1px solid #eee',
                                            borderRadius: '8px',
                                        },
                                    })
                                  : CAT_UI.createElement(
                                        'div',
                                        {
                                            style: {
                                                color: '#999',
                                                fontSize: '12px',
                                                width: '140px',
                                                textAlign: 'center',
                                            },
                                        },
                                        '二维码生成中…（若长时间不出，请手动复制右侧链接）'
                                    ),
                          ]),
                          // 右侧：链接文本 + 复制按钮
                          CAT_UI.createElement('div', { style: { flex: '1', minWidth: '180px' } }, [
                              CAT_UI.createElement(
                                  'div',
                                  {
                                      style: {
                                          fontSize: '12px',
                                          color: '#999',
                                          wordBreak: 'break-all',
                                          marginBottom: '8px',
                                      },
                                  },
                                  link
                              ),
                              CAT_UI.Button('复制链接', {
                                  type: 'link',
                                  onClick: copyLink,
                                  style: { padding: '0 8px', color: '#1890ff', fontWeight: 'bold' },
                              }),
                          ]),
                      ]
                  )
                : CAT_UI.createElement(
                      'p',
                      { style: { color: '#e4393c', fontSize: '13px', margin: '0' } },
                      '尚未配置中继服务器，请到「设置」填写。'
                  ),
            CAT_UI.Divider('发送到手机'),
            CAT_UI.createElement(
                'p',
                {
                    style: {
                        color: phoneOnline ? '#007e44' : '#e4393c',
                        fontSize: '13px',
                        margin: '0 0 10px',
                        lineHeight: '1.5',
                    },
                },
                phoneOnline ? '🟢 手机已连接，可发送' : '⚪ 当前无在线设备，无法发送'
            ),
            CAT_UI.createElement('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px' } }, [
                CAT_UI.Input({
                    placeholder: '输入要发送到手机的文本…',
                    value: sendText,
                    onChange: (val: any) => {
                        const v = typeof val === 'string' ? val : val && val.target ? val.target.value : '';
                        setSendText(v);
                    },
                    style: { flex: '1', marginBottom: '0' },
                }),
                CAT_UI.Button('发送', {
                    type: 'primary',
                    disabled: !phoneOnline || sending,
                    onClick: doSendText,
                    style: { whiteSpace: 'nowrap' },
                }),
            ]),
            CAT_UI.Button('选择 / 添加图片（可多选）', {
                disabled: !phoneOnline || sending,
                onClick: pickImages,
                style: { width: '100%', marginBottom: pendingImages.length ? '10px' : '0' },
            }),
            pendingImages.length > 0
                ? CAT_UI.createElement('div', { style: { marginBottom: '10px' } }, [
                      CAT_UI.createElement(
                          'div',
                          {
                              style: {
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(3,1fr)',
                                  gap: '6px',
                                  marginBottom: '10px',
                              },
                          },
                          pendingImages.map((img: any, i: any) =>
                              CAT_UI.createElement(
                                  'div',
                                  {
                                      style: {
                                          position: 'relative',
                                          width: '100%',
                                          paddingBottom: '100%',
                                          backgroundImage: 'url("' + img.url + '")',
                                          backgroundSize: 'cover',
                                          backgroundPosition: 'center',
                                          borderRadius: '8px',
                                      },
                                  },
                                  [
                                      CAT_UI.Button('×', {
                                          type: 'link',
                                          disabled: sending, // 发送中禁止移除（removePendingImage 内也有守卫）
                                          onClick: () => removePendingImage(i),
                                          style: {
                                              position: 'absolute',
                                              top: '2px',
                                              right: '2px',
                                              padding: '0 6px',
                                              minWidth: '22px',
                                              height: '22px',
                                              lineHeight: '20px',
                                              fontSize: '16px',
                                              color: '#fff',
                                              background: 'rgba(0,0,0,0.55)',
                                              borderRadius: '50%',
                                          },
                                      }),
                                  ]
                              )
                          )
                      ),
                      CAT_UI.Button(
                          pendingImages.length > 1
                              ? '发送 ' + pendingImages.length + ' 张图片到手机'
                              : '发送图片到手机',
                          {
                              type: 'primary',
                              disabled: !phoneOnline || sending,
                              onClick: confirmSendImage,
                              style: { width: '100%' },
                          }
                      ),
                  ])
                : null,
        ]),
        {
            title: '手机互传',
            visible,
            width: 420,
            focusLock: true,
            autoFocus: false,
            zIndex: 10002,
            onOk: () => {
                setVisible(false);
            },
            onCancel: () => {
                setVisible(false);
            },
        }
    );
}
