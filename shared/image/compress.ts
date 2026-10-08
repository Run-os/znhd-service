/**
 * 图片压缩核心 —— 脚本端与手机上传页**共用一份**（v26.10.08-v13 起）。
 *
 * 为什么抽出来：两端原本各有一份**几乎逐行等价**的 canvas 压缩实现，连参数（最大边 1600 / JPEG 0.75）
 * 也是两份、靠注释「与另一端保持一致」人肉同步 —— 结果已经漂移：脚本端跳过 GIF（canvas 只取首帧，
 * 会把动图压成静态图），手机端没跳过，同一张动图两端行为不同。抽成一份后，参数、解码兜底、
 * 「为什么要跳过」这些理由只有一处，两端差异改用**显式选项**表达（见 `prepare.ts`）。
 *
 * ⚠️ **共享层的硬约束**（改这个文件前务必先读 `AGENT.md` 的「共享层」小节）：
 *   · 禁止 import 任何宿主相关模块（`GM_*` / `@/lib/logger` / `panelHost` / `react-to-print` …）：
 *     手机端 tsconfig 是 `types: ["vite/client"]`，出现 `GM_xmlhttpRequest` 这类全局会直接 typecheck 失败；
 *   · 手机端开着 `isolatedModules` + `noUnusedLocals` + `noUnusedParameters`，`target` 为 **es2020**
 *     ⇒ 共享代码必须按**最严的那一套**写（类型再导出用 `export type`、不留未使用变量、不超出 ES2020）；
 *   · 手机端没装 `@ant-design/icons`、`react-to-print`（未声明）⇒ 只有两端都有的依赖才能 import。
 */

/** 「发送到手机 / 上传到电脑」的压缩参数：两端共用同一组默认值 */
export const DEFAULT_MAX_DIM = 1600;
export const DEFAULT_QUALITY = 0.75;

/** 解码结果：可绘制源 + 原始尺寸 + 释放钩子（createImageBitmap 与 <img> 两条路径统一） */
export interface DecodedImage {
    source: CanvasImageSource;
    width: number;
    height: number;
    release: () => void;
}

/** HEIC/HEIF 判定：MIME 可能为空串或 application/octet-stream，故扩展名也算 */
export function isHeicLike(lowerMime: string, lowerName: string): boolean {
    return (
        lowerMime === 'image/heic' ||
        lowerMime === 'image/heif' ||
        lowerMime === 'image/heic-sequence' ||
        lowerMime === 'image/heif-sequence' ||
        /\.(heic|heif)$/.test(lowerName)
    );
}

/** SVG 判定：canvas 无法可靠光栅化，且会丢矢量 ⇒ 一律原样直传 */
export function isSvgLike(lowerMime: string, lowerName: string): boolean {
    return lowerMime === 'image/svg+xml' || /\.svg$/.test(lowerName);
}

/** GIF 判定：canvas 只取首帧，会把动图压成静态图 ⇒ 默认也原样直传 */
export function isGifLike(lowerMime: string, lowerName: string): boolean {
    return lowerMime === 'image/gif' || /\.gif$/.test(lowerName);
}

/**
 * 解码：`createImageBitmap` 优先，失败回退 `<img>`（部分内核/格式上前者不可用或直接抛）。
 * 失败时 reject，由调用方决定回退策略。
 */
export function decodeToCanvasSource(blob: Blob): Promise<DecodedImage> {
    const decodeViaImg = () =>
        new Promise<DecodedImage>((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () =>
                resolve({
                    source: img,
                    width: img.naturalWidth,
                    height: img.naturalHeight,
                    release: () => URL.revokeObjectURL(url),
                });
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('图片解析失败'));
            };
            img.src = url;
        });

    if (typeof createImageBitmap !== 'function') return decodeViaImg();
    return createImageBitmap(blob)
        .then((bmp) => ({
            source: bmp as CanvasImageSource,
            width: bmp.width,
            height: bmp.height,
            release: () => {
                if (bmp.close) bmp.close();
            },
        }))
        .catch(() => decodeViaImg());
}

/**
 * canvas 等比缩放到最大边 → 铺白底 → 导出 JPEG。
 *
 * JPEG 无透明通道，**必须先铺白底**，否则透明 PNG 会被压成黑底。
 * 解码/编码失败一律 resolve(null)（不 reject）：两端调用方都按「失败就原样直传」处理，绝不阻断传输。
 */
export async function resizeToJpeg(
    blob: Blob,
    opt: { maxDim?: number; quality?: number } = {}
): Promise<Blob | null> {
    const maxDim = opt.maxDim && opt.maxDim > 0 ? opt.maxDim : DEFAULT_MAX_DIM;
    const quality = typeof opt.quality === 'number' ? opt.quality : DEFAULT_QUALITY;
    let dec: DecodedImage | null = null;
    try {
        dec = await decodeToCanvasSource(blob);
        const w = Number(dec.width) || 0;
        const h = Number(dec.height) || 0;
        if (!w || !h) return null;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const cv = document.createElement('canvas');
        cv.width = cw;
        cv.height = ch;
        const ctx = cv.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(dec.source, 0, 0, cw, ch);
        return await new Promise<Blob | null>((resolve) => {
            cv.toBlob((b) => resolve(b || null), 'image/jpeg', quality);
        });
    } catch {
        return null;
    } finally {
        // createImageBitmap 的位图要显式 close，否则大图会短暂占住内存
        if (dec) dec.release();
    }
}

/**
 * 把「注入进来的 heic2any」包成统一形态的转码器。
 * 两端获取库的方式天生不同（脚本端用 `@require` 的全局，手机页按需注入 `<script>`），故只共享调用方式。
 */
export function makeHeicConverter(
    heic2any: unknown,
    quality = 0.9
): (blob: Blob) => Promise<Blob> {
    return (blob: Blob) => {
        if (typeof heic2any !== 'function') return Promise.reject(new Error('heic2any 未加载'));
        return Promise.resolve(
            (heic2any as (o: { blob: Blob; toType: string; quality: number }) => Promise<unknown>)({
                blob,
                toType: 'image/jpeg',
                quality,
            })
        ).then((out) => {
            // 多图 HEIC 会返回数组，取首帧
            const b = Array.isArray(out) ? out[0] : out;
            if (b) return b as Blob;
            throw new Error('heic2any 未产出图片');
        });
    };
}
