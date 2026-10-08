/**
 * 手机端选图后的压缩 —— v26.10.08-v13 起**改用共享实现** `shared/image/prepare.ts`（与脚本端同一份）。
 *
 * ⚠️ 行为变化（有意，与脚本端统一）：**GIF 现在原样直传**。
 *    原先前端只排除 SVG、不排除 GIF，而 canvas 只取首帧 ⇒ 动图会被静默压成静态 JPEG；
 *    脚本端一直是跳过的。统一后两端同一张动图的行为一致。
 *
 * 这里只负责手机端**特有的一步**：把「HEIC 取库方式」注入进去 ——
 * 手机页是运行期按需注入 `<script>`（见 `./heic`），脚本端用的是 `@require` 进来的全局 heic2any。
 *
 * ⚠️ 本文件在 `web/` 里，可以 import 仓库根的 `shared/`；反过来**绝对不行**
 *    （共享层必须零宿主依赖，详见 `shared/image/compress.ts` 头部说明）。
 */
import { DEFAULT_MAX_DIM, DEFAULT_QUALITY, makeHeicConverter } from '../../../shared/image/compress';
import { prepareForTransfer, type PreparedTransfer } from '../../../shared/image/prepare';
import { loadHeic2any } from './heic';

/** 与脚本端共用同一组参数（值来自 shared/image/compress.ts，保留导出名以免调用方大改） */
export const MAX_DIM = DEFAULT_MAX_DIM;
export const QUALITY = DEFAULT_QUALITY;

/** 处理结果：blob/name/mime 为最终要上传的内容；compressed 表示是否发生过压缩/转码 */
export type PreparedImage = PreparedTransfer;

/** 把用户选的文件压成可直接上传的 JPEG（或原样返回） */
export async function prepareImage(file: File): Promise<PreparedImage> {
    return prepareForTransfer(file, {
        maxDim: MAX_DIM,
        quality: QUALITY,
        loadHeic: async (blob) => {
            const lib = await loadHeic2any();
            // 库不可用时 makeHeicConverter 会 reject，由 prepareForTransfer 兜成「原图直传」
            return makeHeicConverter(lib)(blob);
        },
    });
}
