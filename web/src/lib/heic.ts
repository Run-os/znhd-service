/**
 * heic2any 懒加载（仅当用户真的选了 HEIC/HEIF 才下载，约 1.36MB）。
 * 与旧版页面同一套选源策略：fastly 首选、bootcdn 兜底，单源 15s 超时换源。
 */

const HEIC_URLS = [
    'https://fastly.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.js',
    'https://cdn.bootcdn.net/ajax/libs/heic2any/0.0.4/heic2any.js',
];

const SCRIPT_TIMEOUT = 15000;

let heicPromise: Promise<any> | null = null;

/** 依次尝试多个 URL 注入脚本；任一源让 isReady() 为真即成功，全失败回调 false */
function loadScriptChain(urls: string[], isReady: () => boolean, onDone: (ok: boolean) => void): void {
    let i = 0;
    const next = () => {
        if (isReady()) {
            onDone(true);
            return;
        }
        if (i >= urls.length) {
            onDone(false);
            return;
        }
        const url = urls[i++];
        const s = document.createElement('script');
        const timer = setTimeout(() => {
            s.onload = null;
            s.onerror = null;
            s.remove();
            next();
        }, SCRIPT_TIMEOUT);
        s.async = true;
        s.onload = () => {
            clearTimeout(timer);
            if (isReady()) onDone(true);
            else {
                s.remove();
                next();
            }
        };
        s.onerror = () => {
            clearTimeout(timer);
            s.remove();
            next();
        };
        s.src = url;
        document.head.appendChild(s);
    };
    next();
}

/**
 * 取得可用的 heic2any（复用同一个 Promise：连选多张 HEIC 不重复下载）。
 * 全部源失败时 resolve(null)，调用方回退「原图直传」。
 */
export function loadHeic2any(): Promise<any> {
    if (!heicPromise) {
        heicPromise = new Promise((resolve) => {
            loadScriptChain(HEIC_URLS, () => typeof (window as any).heic2any === 'function', (ok) => {
                resolve(ok ? (window as any).heic2any : null);
            });
        });
    }
    return heicPromise;
}
