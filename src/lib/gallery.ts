import { addLog } from '@/lib/logger';
import { copyImageToClipboard } from '@/lib/relay';
import { safeCopyText } from '@/lib/clipboard';

/**
 * 收到图片的九宫格画廊 + 文本弹窗（原 app.ts「收到图片」段）。
 * 模块化 P4：逐字迁移，仅加 export。
 * ⚠️ 弹窗 CSS / z-index / Viewer 接管逻辑是真实页面实测结论，禁止「顺手重构」。
 */

// ========== 收到图片：九宫格画廊弹窗（Viewer.js 放大查看） ==========
// 收到的图片累积进 receivedImages 列表，以 3 列九宫格缩略图展示（直接挂 document.documentElement，
// 不受 CAT_UI 面板 transform 影响）。单击缩略图用 Viewer.js 放大（缩放/旋转/多图左右切换），
// 每张图下方有「复制」按钮（点击手势触发，满足浏览器剪贴板策略）和右上角 × 移除。
const MAX_GALLERY = 27; // 画廊最多保留张数，超出丢最旧（释放其 objectURL）
/** 画廊中的一张图（previewUrl 是 objectURL，移除/淘汰时必须 revoke） */
export interface GalleryImage {
    blob: Blob;
    previewUrl: string;
    name?: string;
    mime?: string;
    ts?: number;
}

export const receivedImages: GalleryImage[] = [];
let galleryViewer: any = null; // Viewer.js 实例（重建画廊时先销毁）
let galleryViewerObserver: MutationObserver | null = null; // 监听 Viewer 全屏容器出现并移入画廊遮罩的 MutationObserver
let viewerCssInjected = false;

// 注入 Viewer.js 的 CSS：优先 @resource（GM_getResourceText），失败回退 CDN <link>
function ensureViewerCss() {
    if (viewerCssInjected) return;
    let baseInjected = false;
    try {
        const css = typeof GM_getResourceText === 'function' ? GM_getResourceText('VIEWER_CSS') : '';
        if (css) {
            GM_addStyle(css);
            baseInjected = true;
        }
    } catch (e) {
        /* 继续走 link 回退 */
    }
    if (!baseInjected) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.css';
        (document.head || document.documentElement).appendChild(link);
    }
    // 覆盖样式：Viewer.js 默认遮罩是半透明黑（rgba(0,0,0,0.5)），放大时会透出后面的画廊弹窗；
    // 改为纯黑不透明，彻底遮住背景（!important 保证无论加载顺序都生效）
    GM_addStyle(
        '.viewer-backdrop{background-color:#000 !important;}' + '.viewer-container{background-color:#000 !important;}'
    );
    viewerCssInjected = true;
}

/**
 * 生成下载文件名：优先原始文件名；无名或无扩展名时按 mime 补扩展名。
 * @param {string} name - 原始文件名（可空）
 * @param {string} mime - MIME 类型
 * @param {number} idx - 画廊序号（用于兜底命名）
 * @returns {string} 带扩展名的文件名
 */
function downloadFileName(name: any, mime: any, idx: any) {
    const extByMime: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'image/bmp': '.bmp',
    };
    let n = String(name || '').trim();
    if (!n) n = 'znhd-image-' + (idx + 1);
    if (!/\.[a-z0-9]{2,5}$/i.test(n)) n += extByMime[(mime || '').toLowerCase()] || '.jpg';
    return n;
}

// 对外入口（poll 回调调用）：新图入列并打开/刷新画廊弹窗
export function showImagePopup(img: any) {
    img.ts = Date.now();
    receivedImages.push(img);
    while (receivedImages.length > MAX_GALLERY) {
        const old = receivedImages.shift()!; // 上面 while 已保证长度 > MAX_GALLERY，不会取空
        try {
            URL.revokeObjectURL(old.previewUrl);
        } catch (e) {
            /* 忽略 */
        }
    }
    renderImageGallery();
}

function removeGalleryImage(idx: any) {
    const it = receivedImages.splice(idx, 1)[0];
    if (it) {
        try {
            URL.revokeObjectURL(it.previewUrl);
        } catch (e) {
            /* 忽略 */
        }
    }
    if (receivedImages.length === 0) closeImagePopup();
    else renderImageGallery();
}

export function renderImageGallery() {
    closeImagePopup(); // 重建（销毁旧 Viewer 实例与旧 DOM）
    installPopupKeyHandler(); // 安装全局 ESC 关闭（预览态→退出预览；画廊态→关弹窗）
    ensureViewerCss();
    const overlay = document.createElement('div');
    overlay.id = '__znhd_img_popup__';
    // 所有样式加 !important + 铺满 100vw/vh，隔绝任何外部 CSS（含扩展/页面）对弹窗的覆盖
    overlay.style.cssText =
        'position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,0.55)!important;opacity:1!important;font-family:sans-serif!important;';
    const box = document.createElement('div');
    box.style.cssText =
        'position:relative!important;z-index:1!important;width:min(560px,92vw)!important;max-height:88vh!important;background:#fff!important;opacity:1!important;border-radius:12px!important;padding:16px!important;box-shadow:0 8px 30px rgba(0,0,0,0.35)!important;display:flex!important;flex-direction:column!important;filter:none!important;backdrop-filter:none!important;isolation:isolate!important;';
    // 标题
    const title = document.createElement('div');
    title.textContent = '收到的图片（' + receivedImages.length + '）· 单击放大，最新图片在最后';
    title.style.cssText =
        'font-size:15px!important;font-weight:bold!important;color:#333!important;margin:0 0 10px 2px!important;';
    // 右上角关闭
    const close = document.createElement('div');
    close.textContent = '×';
    close.title = '关闭（图片保留，收到新图会再次弹出）';
    // 注意：box 是 display:flex 容器，标题作为 flex item 在层叠里等同 z-index:0 层；
    // 关闭按钮是 position:absolute（同属 z-index:auto 层），同层按 DOM 顺序——标题在关闭按钮之后 append，
    // 会画到关闭按钮之上并吃掉点击（视觉无重叠，但标题隐形盒子铺满整行）。故显式抬到 z-index:2 确保可点。
    close.style.cssText =
        'position:absolute!important;top:8px!important;right:10px!important;width:30px!important;height:30px!important;line-height:28px!important;text-align:center!important;font-size:22px!important;color:#fff!important;cursor:pointer!important;border-radius:50%!important;background:#e4393c!important;opacity:1!important;box-shadow:0 1px 4px rgba(0,0,0,0.3)!important;font-weight:bold!important;z-index:2!important;';
    close.onmouseenter = () => {
        close.style.background = '#c9302c';
    };
    close.onmouseleave = () => {
        close.style.background = '#e4393c';
    };
    close.onclick = () => closeImagePopup();
    // 九宫格容器（3 列，可滚动）
    const grid = document.createElement('div');
    grid.id = '__znhd_img_grid__';
    grid.style.cssText =
        'display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:10px!important;overflow-y:auto!important;padding:2px!important;max-height:60vh!important;filter:none!important;backdrop-filter:none!important;opacity:1!important;';
    receivedImages.forEach((it, idx) => {
        const cell = document.createElement('div');
        cell.style.cssText = 'position:relative!important;display:flex!important;flex-direction:column!important;';
        const thumbWrap = document.createElement('div');
        thumbWrap.style.cssText =
            'position:relative!important;width:100%!important;aspect-ratio:1/1!important;border-radius:8px!important;overflow:hidden!important;background:#f2f2f2!important;cursor:zoom-in!important;filter:none!important;backdrop-filter:none!important;opacity:1!important;';
        const imgEl = document.createElement('img');
        imgEl.src = it.previewUrl;
        imgEl.alt = it.name || 'image-' + (idx + 1);
        imgEl.style.cssText =
            'width:100%!important;height:100%!important;object-fit:cover!important;display:block!important;filter:none!important;opacity:1!important;';
        thumbWrap.appendChild(imgEl);
        // 单张移除 ×
        const del = document.createElement('div');
        del.textContent = '×';
        del.title = '移除这张';
        del.style.cssText =
            'position:absolute!important;top:4px!important;right:4px!important;width:20px!important;height:20px!important;line-height:18px!important;text-align:center!important;font-size:14px!important;color:#fff!important;cursor:pointer!important;border-radius:50%!important;background:rgba(0,0,0,0.55)!important;font-weight:bold!important;z-index:2!important;';
        del.onclick = (e) => {
            e.stopPropagation();
            removeGalleryImage(idx);
        };
        thumbWrap.appendChild(del);
        // 按钮行：复制（写剪贴板）+ 下载（存为文件）
        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex!important;gap:4px!important;margin-top:6px!important;';
        const copyBtn = document.createElement('button');
        copyBtn.textContent = '复制';
        copyBtn.style.cssText =
            'flex:1!important;padding:4px 0!important;border:none!important;border-radius:6px!important;background:#1890ff!important;color:#fff!important;font-size:12px!important;opacity:1!important;cursor:pointer!important;filter:none!important;backdrop-filter:none!important;';
        copyBtn.onclick = (e) => {
            e.stopPropagation();
            copyBtn.textContent = '复制中…';
            copyBtn.disabled = true;
            copyImageToClipboard(it.blob).then((ok) => {
                copyBtn.disabled = false;
                if (ok) {
                    copyBtn.textContent = '✓ 已复制';
                    copyBtn.style.background = '#52c41a';
                    addLog('图片已复制到剪贴板: ' + (it.name || ''), 'success');
                } else {
                    copyBtn.textContent = '复制失败';
                    copyBtn.style.background = '#e4393c';
                }
            });
        };
        const dlBtn = document.createElement('button');
        dlBtn.textContent = '下载';
        dlBtn.style.cssText =
            'flex:1!important;padding:4px 0!important;border:none!important;border-radius:6px!important;background:#722ed1!important;color:#fff!important;font-size:12px!important;opacity:1!important;cursor:pointer!important;filter:none!important;backdrop-filter:none!important;';
        dlBtn.onclick = (e) => {
            e.stopPropagation();
            try {
                const fname = downloadFileName(it.name, it.mime, idx);
                const a = document.createElement('a');
                const url = URL.createObjectURL(it.blob);
                a.href = url;
                a.download = fname;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                a.remove();
                setTimeout(() => {
                    try {
                        URL.revokeObjectURL(url);
                    } catch (e2) {
                        /* 忽略 */
                    }
                }, 3000);
                dlBtn.textContent = '✓ 已下载';
                dlBtn.style.background = '#52c41a';
                addLog('图片已下载: ' + fname, 'success');
            } catch (err) {
                dlBtn.textContent = '下载失败';
                dlBtn.style.background = '#e4393c';
                addLog('[下载] 失败：' + err.message, 'error', true);
            }
        };
        btnRow.appendChild(copyBtn);
        btnRow.appendChild(dlBtn);
        cell.appendChild(thumbWrap);
        cell.appendChild(btnRow);
        grid.appendChild(cell);
    });
    // 底部操作条
    const bar = document.createElement('div');
    bar.style.cssText =
        'display:flex!important;justify-content:center!important;gap:12px!important;margin-top:12px!important;';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空全部';
    clearBtn.style.cssText =
        'padding:7px 18px!important;border:none!important;border-radius:8px!important;background:#999!important;color:#fff!important;font-size:13px!important;cursor:pointer!important;filter:none!important;backdrop-filter:none!important;';
    clearBtn.onclick = () => {
        receivedImages.forEach((it) => {
            try {
                URL.revokeObjectURL(it.previewUrl);
            } catch (e) {
                /* 忽略 */
            }
        });
        receivedImages.length = 0;
        closeImagePopup();
    };
    bar.appendChild(clearBtn);
    box.appendChild(close);
    box.appendChild(title);
    box.appendChild(grid);
    box.appendChild(bar);
    overlay.appendChild(box);
    overlay.onclick = (e) => {
        if (e.target === overlay) closeImagePopup();
    };
    document.documentElement.appendChild(overlay); // 挂到 <html> 而非 <body>：避开 body 级 transform/filter 改写 fixed 包含块
    // 焦点隔离：弹窗内的 <button> 设为不可 Tab 聚焦，且点击时不抢占焦点。
    // 否则当脚本面板或税务页面自身的 arco 抽屉/弹窗（带 focus-lock 焦点锁）同时开着时，
    // 焦点在抽屉与弹窗按钮间来回“打架”，控制台会刷出 "FocusLock: focus-fighting detected"。
    // 鼠标点击仍正常触发 onClick，不影响复制/下载/清空功能。
    overlay.querySelectorAll('button').forEach(function (b) {
        b.tabIndex = -1;
        b.addEventListener('mousedown', function (e) {
            e.preventDefault();
        });
    });
    // 用 Viewer.js 绑定画廊：单击缩略图放大，多图可左右切换
    if (typeof Viewer === 'function') {
        try {
            galleryViewer = new Viewer(grid, {
                zIndex: 2147483647, // 盖住画廊遮罩（遮罩为 ...640）
                zoomRatio: 0.4,
                // ⚠️ 必须关掉过渡（v26.10.8-v1 修「点缩略图放大后有时长时间不出图 / 只有黑罩」）：
                // Viewer.js 的 shown()（设置 isShown=true、创建主图、执行 render()+bind()）**只由容器的
                // transitionend 触发**（viewer.js 的 show()：addListener(viewer,'transitionend',shown)）。
                // 而本文件下方那段 MutationObserver 会在容器刚出现时把它 appendChild 移进画廊 overlay，
                // **移动 DOM 节点会打断正在进行的 CSS 过渡** → transitionend 不再触发 → shown() 永不执行
                // → isShown 永远 false → 之后每次 view() 都在 `!this.isShown` 处提前 return，主图从不被创建；
                // 且 this.showing 卡在 true（只在 shown() 里清），反复点击同样无效。
                // 实测：默认过渡下 4 秒内 .viewer-canvas 始终为空；transition:false 后 22~29ms 出图。
                // 原理：transition:false 时 show() 走 else 分支**同步调用 shown()**，彻底不依赖过渡事件；
                // hide() 亦因未加 CLASS_TRANSITION 而走 hideImmediately() 同步收尾，连带消掉关闭侧残留容器风险。
                // 代价：失去放大/关闭的淡入淡出（换确定性，值得）。改前请读 AGENT.md 约束 3。
                transition: false,
                title: (image: any) => image.alt || '',
                toolbar: {
                    zoomIn: 1,
                    zoomOut: 1,
                    oneToOne: 1,
                    reset: 1,
                    prev: 1,
                    next: 1,
                    rotateLeft: 1,
                    rotateRight: 1,
                    flipHorizontal: 1,
                    flipVertical: 1,
                },
                filter(image: any) {
                    return true;
                },
            });
            // 关键：把 Viewer 全屏预览容器移入画廊遮罩内部，使其处于本弹窗的层叠上下文之上（高于白盒），
            // 避免与画廊遮罩（同为 2147483647）互相压制导致「预览跑到弹窗后面」或「关闭按钮被盖住」。
            // 否则在真实税务页面里 body 常被加 transform/filter 形成独立层叠上下文，把挂在 body 下的 Viewer
            // 困住，永远被画廊压在后面；且全屏 Viewer 容器与画廊遮罩等 z-index 时会盖住画廊右上角的 ×。
            // 移入后：全屏预览盖在白盒之上，由 Viewer 自带 × 关闭回到画廊（标准模态交互）。
            // 用 MutationObserver 监听 .viewer-container 出现即移入（Viewer.js 该构建的事件 API 不可靠，不依赖之）。
            if (window.MutationObserver) {
                if (galleryViewerObserver) {
                    try {
                        galleryViewerObserver.disconnect();
                    } catch (e) {
                        /* 忽略 */
                    }
                }
                // 移动成功后不再重复查询：本观察器监听整个 documentElement 的 subtree，
                // 税务页每次 DOM 变更都会触发回调，而真正要干的「移入 overlay」一辈子只成功一次。
                // 保留观察器（不断开）是为兼容可能重建容器的 Viewer 构建，代价只剩一次布尔判断。
                let viewerMoved = false;
                galleryViewerObserver = new MutationObserver(function () {
                    if (viewerMoved) return;
                    const vc = document.querySelector('.viewer-container') as HTMLElement | null;
                    if (vc && vc.parentNode !== overlay) {
                        overlay.appendChild(vc);
                        viewerMoved = true;
                        vc.style.zIndex = '2'; // 在画廊遮罩上下文内，高于白盒(z-index:1)
                        // 安全网：监听 Viewer 显隐（viewer-in 类的增删，不依赖其事件 API）。
                        // 显示时允许交互；隐藏后置 pointer-events:none，避免残留容器遮挡画廊关闭按钮/缩略图。
                        if (!(vc as any).__znhdWatched) {
                            (vc as any).__znhdWatched = true;
                            vc.style.pointerEvents = vc.className.indexOf('viewer-in') >= 0 ? 'auto' : 'none';
                            new MutationObserver(function () {
                                vc.style.pointerEvents = vc.className.indexOf('viewer-in') >= 0 ? 'auto' : 'none';
                            }).observe(vc, { attributes: true, attributeFilter: ['class'] });
                        }
                    }
                });
                galleryViewerObserver.observe(document.documentElement, { childList: true, subtree: true });
            }
        } catch (e) {
            addLog('[设备互联] Viewer 初始化失败：' + e.message, 'error', true);
        }
    } else {
        addLog('[设备互联] Viewer.js 未加载，单击放大不可用（缩略图仍可复制）', 'warning', true);
    }
}

function closeImagePopup() {
    if (galleryViewerObserver) {
        try {
            galleryViewerObserver.disconnect();
        } catch (e) {
            /* 忽略 */
        }
        galleryViewerObserver = null;
    }
    if (galleryViewer) {
        try {
            galleryViewer.destroy();
        } catch (e) {
            /* 忽略 */
        }
        galleryViewer = null;
    }
    const ex = document.getElementById('__znhd_img_popup__');
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
}

// 全局 ESC 关闭：图片预览（Viewer）可见时先退出预览回画廊；画廊态时关闭整个弹窗；
// 文本弹窗则直接关闭。Viewer.js 自带键盘监听在本脚本「把 .viewer-container 移入 overlay」的
// 特殊处理 + 真实税务页面 body 常被加 transform 的环境下常常失效，这里用独立监听兜底，确保 ESC 一定可用。
// 仅安装一次（自保护），内部按当前弹窗状态分支处理。
let _znhdPopupKeyInstalled = false;
function installPopupKeyHandler() {
    if (_znhdPopupKeyInstalled) return;
    _znhdPopupKeyInstalled = true;
    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' && e.keyCode !== 27) return;
        // 图片画廊弹窗优先
        const gallery = document.getElementById('__znhd_img_popup__');
        if (gallery) {
            const vc = document.querySelector('.viewer-container');
            const viewerVisible = vc && vc.className.indexOf('viewer-in') >= 0;
            if (viewerVisible && galleryViewer) {
                try {
                    galleryViewer.hide();
                } catch (err) {
                    /* 忽略 */
                }
            } else {
                closeImagePopup();
            }
            return;
        }
        const textPopup = document.getElementById('__znhd_text_popup__');
        if (textPopup) {
            closeTextPopup();
        }
    });
}

// 收到手机文本时，在网页正中弹出预览弹窗（与图片弹窗同一挂法：document.documentElement），
// 含文本展示区、复制到剪贴板按钮（复用 safeCopyText，满足浏览器剪贴板策略并记日志/提示音）、关闭按钮。
export function showTextPopup(txt: any) {
    closeTextPopup();
    installPopupKeyHandler(); // 安装全局 ESC 关闭（文本弹窗直接关闭）
    const overlay = document.createElement('div');
    overlay.id = '__znhd_text_popup__';
    overlay.style.cssText =
        'position:fixed!important;top:0!important;left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;background:rgba(0,0,0,0.55)!important;opacity:1!important;font-family:sans-serif!important;';
    const box = document.createElement('div');
    box.style.cssText =
        'position:relative!important;min-width:360px!important;min-height:200px!important;max-width:90vw!important;max-height:90vh!important;background:#fff!important;opacity:1!important;border-radius:12px!important;padding:16px!important;box-shadow:0 8px 30px rgba(0,0,0,0.35)!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;';
    const textEl = document.createElement('div');
    textEl.textContent = txt.text || '';
    textEl.style.cssText =
        'min-width:320px!important;min-height:120px!important;max-width:80vw!important;max-height:55vh!important;overflow:auto!important;white-space:pre-wrap!important;word-break:break-word!important;font-size:15px!important;line-height:1.6!important;color:#222!important;background:#f7f7f7!important;opacity:1!important;border:1px solid #eee!important;border-radius:8px!important;padding:12px!important;';
    const close = document.createElement('div');
    close.textContent = '×';
    close.title = '关闭';
    // 同上：box 为 display:flex 容器，标题/正文为 flex item（等同 z-index:0 层），需把关闭按钮抬到 z-index:2 才能被点中。
    close.style.cssText =
        'position:absolute!important;top:8px!important;right:10px!important;width:30px!important;height:30px!important;line-height:28px!important;text-align:center!important;font-size:22px!important;color:#fff!important;cursor:pointer!important;border-radius:50%!important;background:#e4393c!important;opacity:1!important;box-shadow:0 1px 4px rgba(0,0,0,0.3)!important;font-weight:bold!important;z-index:2!important;';
    close.onmouseenter = () => {
        close.style.background = '#c9302c';
    };
    close.onmouseleave = () => {
        close.style.background = '#e4393c';
    };
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '复制到剪贴板';
    copyBtn.style.cssText =
        'margin-top:14px!important;padding:8px 18px!important;border:none!important;border-radius:8px!important;background:#1890ff!important;color:#fff!important;font-size:14px!important;opacity:1!important;cursor:pointer!important;align-self:center!important;';
    copyBtn.onclick = () => {
        copyBtn.textContent = '复制中…';
        copyBtn.disabled = true;
        // 用 safeCopyText 的真实结果更新按钮文案：无可用复制途径/被拒绝时不再假显示「已复制」
        safeCopyText(txt.text || '', (ok) => {
            copyBtn.disabled = false;
            copyBtn.textContent = ok ? '✓ 已复制' : '复制失败，请长按文本手动复制';
            copyBtn.style.background = ok ? '#52c41a' : '#e4393c';
        });
    };
    close.onclick = () => closeTextPopup();
    overlay.onclick = (e) => {
        if (e.target === overlay) closeTextPopup();
    };
    box.appendChild(close);
    box.appendChild(textEl);
    box.appendChild(copyBtn);
    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);
    // 焦点隔离（同图片弹窗）：避免与 arco 抽屉/弹窗的焦点锁冲突刷出 focus-fighting 警告。
    // 按钮仍可鼠标点击触发 onClick。
    overlay.querySelectorAll('button').forEach(function (b) {
        b.tabIndex = -1;
        b.addEventListener('mousedown', function (e) {
            e.preventDefault();
        });
    });
}
function closeTextPopup() {
    const ex = document.getElementById('__znhd_text_popup__');
    if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
}
