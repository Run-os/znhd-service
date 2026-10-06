/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 全局声明：webpack DefinePlugin 注入的编译期常量 + 由 @require 注入的第三方全局。
 * Tampermonkey 的 GM_* / unsafeWindow / GM_info 由 @types/tampermonkey 提供，此处不再重复声明。
 */
declare global {
    /** webpack DefinePlugin 注入：是否为生产构建 */
    const PRODUCTION: boolean;
    /** webpack DefinePlugin 注入（仅开发构建）：产物文件名 */
    const FILENAME: string;

    /** @require js-yaml 注入 */
    const jsyaml: {
        load: (input: string) => any;
    };

    /** @require qrcodejs 注入（构造器 + 静态 CorrectLevel） */
    const QRCode: {
        new (
            el: HTMLElement | string,
            options: {
                text: string;
                width?: number;
                height?: number;
                colorDark?: string;
                colorLight?: string;
                correctLevel?: number;
            }
        ): {
            clear: () => void;
            makeCode: (text: string) => void;
            makeImage: () => void;
        };
        CorrectLevel: { L: number; M: number; Q: number; H: number };
    };

    /** @require viewerjs 注入 */
    const Viewer: any;

    /**
     * @require heic2any 注入：把 HEIC/HEIF 解码转成 JPEG。
     * 桌面 Chrome 原生不支持 HEIC/HEIF，故「发送到手机」必须先经它转码再压缩。
     */
    const heic2any: any;

    interface Window {
        /** 页面注入的 TinyMCE 全局（税务页编辑器）；实例结构随页面版本变化，按 any 处理 */
        tinymce?: any;
    }
}

export {};
