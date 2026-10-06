import { loadHeic2any } from './heic';

/**
 * 手机端选图后的压缩（从旧版页面 compressFile 逐条移植，参数/兜底行为完全一致）：
 * canvas 等比缩放到最大边 MAX_DIM，铺白底后导出 JPEG(QUALITY)。
 *  - SVG 跳过压缩（canvas 无法可靠光栅化，且会丢矢量）；
 *  - HEIC/HEIF 先用 heic2any 转 JPEG 再走同一条压缩链，库缺失/失败则原样直传；
 *  - 解码失败也原样直传，绝不阻断上传。
 */

export const MAX_DIM = 1600;
export const QUALITY = 0.75;

export interface PreparedImage {
    blob: Blob;
    name: string;
    mime: string;
}

function isHeic(file: File): boolean {
    const mime = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    return (
        mime === 'image/heic' ||
        mime === 'image/heif' ||
        mime === 'image/heic-sequence' ||
        mime === 'image/heif-sequence' ||
        /\.(heic|heif)$/.test(name)
    );
}

/** canvas 压缩：解码（createImageBitmap 优先，失败回退 <img>）→ 缩放 → 白底 → JPEG */
function compressBlob(src: Blob): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const decodeViaImg = () =>
            new Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }>(
                (rs, rj) => {
                    const url = URL.createObjectURL(src);
                    const img = new Image();
                    img.onload = () =>
                        rs({
                            source: img,
                            width: img.naturalWidth,
                            height: img.naturalHeight,
                            release: () => URL.revokeObjectURL(url),
                        });
                    img.onerror = () => {
                        URL.revokeObjectURL(url);
                        rj(new Error('图片解析失败'));
                    };
                    img.src = url;
                }
            );

        const decoded =
            typeof createImageBitmap === 'function'
                ? createImageBitmap(src)
                      .then((bmp) => ({
                          source: bmp as CanvasImageSource,
                          width: bmp.width,
                          height: bmp.height,
                          release: () => bmp.close(),
                      }))
                      .catch(() => decodeViaImg())
                : decodeViaImg();

        decoded
            .then((dec) => {
                const scale = Math.min(1, MAX_DIM / Math.max(dec.width, dec.height));
                const cw = Math.max(1, Math.round(dec.width * scale));
                const ch = Math.max(1, Math.round(dec.height * scale));
                const cv = document.createElement('canvas');
                cv.width = cw;
                cv.height = ch;
                const ctx = cv.getContext('2d');
                if (!ctx) {
                    dec.release();
                    reject(new Error('压缩失败'));
                    return;
                }
                // JPEG 无透明通道：先铺白底，避免透明 PNG 被压成黑背景
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, cw, ch);
                ctx.drawImage(dec.source, 0, 0, cw, ch);
                dec.release();
                cv.toBlob(
                    (b) => (b ? resolve(b) : reject(new Error('压缩失败'))),
                    'image/jpeg',
                    QUALITY
                );
            })
            .catch(reject);
    });
}

/** 把用户选的文件压成可直接上传的 JPEG（或原样返回） */
export async function prepareImage(file: File): Promise<PreparedImage> {
    const name = file.name || 'image.jpg';
    const mime = file.type || 'image/jpeg';
    const passthrough: PreparedImage = { blob: file, name, mime };

    const lowerName = name.toLowerCase();
    if (mime.toLowerCase() === 'image/svg+xml' || /\.svg$/.test(lowerName)) {
        return passthrough; // 保留矢量
    }

    let source: Blob = file;
    if (isHeic(file)) {
        const lib = await loadHeic2any();
        if (!lib) return passthrough; // 解码库不可用：原图直传，交由电脑端处理
        try {
            const out = await lib({ blob: file, toType: 'image/jpeg', quality: 0.9 });
            const jpg = Array.isArray(out) ? out[0] : out;
            if (jpg) source = jpg;
            else return passthrough;
        } catch {
            return passthrough; // 转换失败：原样直传
        }
    }

    try {
        const jpeg = await compressBlob(source);
        // 压不小就原样发（小图/已高压缩图，重新编码反而更大）
        if (jpeg.size >= file.size && !isHeic(file)) return passthrough;
        return { blob: jpeg, name: name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg' };
    } catch {
        return passthrough; // 解析/压缩失败：原样直传（电脑端仍可收到）
    }
}
