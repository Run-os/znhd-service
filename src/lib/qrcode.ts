import { addLog } from '@/lib/logger';

/**
 * 用客户端 qrcodejs 生成二维码 dataURL（原 app.ts 的 genQrDataUrl）。
 * 模块化 P4：逐字迁移，仅加 export。
 */

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
export function genQrDataUrl(text: string): Promise<string> {
    return new Promise((resolve) => {
        try {
            if (typeof QRCode === 'undefined' || typeof QRCode !== 'function') {
                addLog('[二维码] qrcodejs 未加载，请手动复制链接', 'error', true);
                resolve('');
                return;
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
                correctLevel: QRCode.CorrectLevel.M,
            });
            // qrcodejs 同步把二维码绘入 canvas；延迟一拍确保绘制完成再读取
            setTimeout(() => {
                try {
                    const canvas = holder.querySelector('canvas');
                    const url = canvas ? canvas.toDataURL('image/png') : '';
                    if (holder.parentNode) holder.parentNode.removeChild(holder);
                    if (url) resolve(url);
                    else {
                        addLog('[二维码] 画布读取失败，请手动复制链接', 'error', true);
                        resolve('');
                    }
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
