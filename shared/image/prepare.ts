/**
 * 「把用户选的图片处理成可直接传输的载荷」—— 脚本端与手机上传页**共用一份**（v26.10.08-v13 起）。
 *
 * 统一后的行为（两端差异全部变成显式选项）：
 *   · SVG 原样直传（canvas 无法可靠光栅化，会丢矢量）；
 *   · **GIF 也原样直传**（canvas 只取首帧，会把动图压成静态图）—— 原先只有脚本端这么做，
 *     手机端会压成静态图；这次统一为「跳过」，顺手修掉两端行为不一致；
 *   · HEIC/HEIF 先转 JPEG 再走同一条压缩链（**转码器由调用方注入**：两端取库方式不同）；
 *     ⚠️ HEIC 的「转码」本身就是目的（既压体积，也修掉安卓端不显示 HEIC 的兼容问题），
 *     故即使 JPEG 没比原始 HEIC 小也照样发 JPEG；其它格式仍遵循「压不小就不压」；
 *   · 任何失败都回退原图直传，绝不阻断传输。
 */

import {
    DEFAULT_MAX_DIM,
    DEFAULT_QUALITY,
    isGifLike,
    isHeicLike,
    isSvgLike,
    resizeToJpeg,
} from './compress';

/** 处理结果：blob/name/mime 为最终要传输的内容；compressed 表示是否发生过压缩/转码 */
export interface PreparedTransfer {
    blob: Blob;
    name: string;
    mime: string;
    compressed: boolean;
}

/** 入参：浏览器选出来的 File 或脚本里构造的 Blob（脚本端允许没有 name） */
export type TransferSource = Blob & { name?: string };

export interface PrepareTransferOptions {
    /** 最长边（默认 1600，与两端历史值一致） */
    maxDim?: number;
    /** JPEG 质量（默认 0.75） */
    quality?: number;
    /** SVG 是否原样直传（默认 true） */
    skipSvg?: boolean;
    /** GIF 是否原样直传（默认 true，见文件头说明） */
    skipGif?: boolean;
    /**
     * HEIC/HEIF 转码器（**必须注入**）：拿到 Blob、返回 JPEG Blob；不可用或失败时抛错即可，
     * 调用方会兜成「原图直传」。脚本端传 `makeHeicConverter(全局 heic2any)`，
     * 手机端传 `async (b) => makeHeicConverter(await loadHeic2any())(b)`。
     */
    loadHeic?: (blob: Blob) => Promise<Blob>;
}

/**
 * 把用户选的图片处理成可直接传输的载荷。
 * 与历史行为逐条对齐（含「压完反而更大就不压」的兜底），失败一律原样直传。
 */
export async function prepareForTransfer(
    file: TransferSource,
    opt: PrepareTransferOptions = {}
): Promise<PreparedTransfer> {
    const name = String(file && file.name ? file.name : 'image.jpg');
    const mime = String((file && file.type) || 'image/jpeg');
    const original: PreparedTransfer = { blob: file, name, mime, compressed: false };
    const lowerName = name.toLowerCase();
    const lowerMime = mime.toLowerCase();

    if ((opt.skipSvg === undefined ? true : opt.skipSvg) && isSvgLike(lowerMime, lowerName)) return original;
    if ((opt.skipGif === undefined ? true : opt.skipGif) && isGifLike(lowerMime, lowerName)) return original;

    const heic = isHeicLike(lowerMime, lowerName);
    let source: Blob = file;
    if (heic) {
        if (!opt.loadHeic) return original; // 库不可用：原图直传，交由接收端处理
        try {
            const jpg = await opt.loadHeic(file);
            if (!jpg) return original;
            source = jpg;
        } catch {
            return original; // 转码失败：原样直传
        }
    }

    const out = await resizeToJpeg(source, {
        maxDim: opt.maxDim === undefined ? DEFAULT_MAX_DIM : opt.maxDim,
        quality: opt.quality === undefined ? DEFAULT_QUALITY : opt.quality,
    });
    if (!out) return original; // 解码/编码失败
    if (!heic && out.size >= (file.size || 0)) return original; // 非 HEIC 且压不小 ⇒ 原样发
    return {
        blob: out,
        name: name.replace(/\.[a-z0-9]+$/i, '') + '.jpg',
        mime: 'image/jpeg',
        compressed: true,
    };
}
