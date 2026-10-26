import { printA4Image } from './print';

/**
 * 征纳互动站点「图片右键菜单」注入【打印】项（v26.10.22-v6）。
 *
 * 站点的图片右键菜单是它自己的 Vue 组件（`ImageItem` + v-contextmenu 库），没有
 * 对外注册菜单项的 API（纯 slot 渲染）。这里走 DOM 注入：往每个图片菜单 `<ul>`
 * 尾部补一个与原生项同构的 `<li>`，点击后调脚本自己的 A4 打印（`printA4Image`）。
 *
 * 实测（2026-10-22，浏览器实机）得出的要点：
 *  · 菜单 `<ul>` 直挂 body（light DOM），实例与图片消息 **1:1** —— 新消息会产生
 *    新 ul，用 MutationObserver（防抖）兜新增；
 *  · Vue 的 patch 不动 ul 尾部的额外节点（对 VContextmenu / ImageItem / 其父组件
 *    三层 `$forceUpdate` 后注入项仍在）；但**别依赖组件 API**：`show()` 只置
 *    `visible` 标记，历史消息实例实测点了也不显示；
 *  · 识别图片菜单不靠 Vue（沙箱里 `__vue__` 要走 unsafeWindow），靠菜单项文本：
 *    含「转存到内网」且 ≥3 项（文字菜单是「复制选中/复制全部」，置顶菜单只有一项）；
 *  · 原生项点击后由库自动收菜单，注入项没这层 —— 点击后自己收起（v26.10.26-v6：
 *    `vm.hide()` + `vm.visible=false` + `display:none !important` 三层兜底，见 hideMenus）；
 *  · 作用域属性（`data-v-*`）**从原生项现拷、不写死 hash** —— 站点换版本 hash 会变，
 *    写死就丢样式（实测克隆后 padding/height/色/cursor 与原生项逐项一致）。
 */

const PRINT_MARK = 'data-znhd-print';

/** 图片菜单的识别锚点：四项里独有「转存到内网」 */
const IMAGE_MENU_KEY = '转存到内网';
/** 图片菜单至少的原生项数（防站点加单项时误伤其它菜单） */
const MIN_ITEMS = 3;

/** 最近一次右键命中的图片（capture 阶段记录，站点 `preventDefault` 也拦不住） */
let lastImage: { src: string; name: string } | null = null;

let started = false;
let observer: MutationObserver | null = null;
let scanTimer: number | null = null;

/** 沙箱里 DOM 元素上的页面 expando（`__vue__`）只有 unsafeWindow 侧可见（同 sniffConv 的路数） */
function pageDoc(): Document {
    const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
    return (w as unknown as { document: Document }).document || document;
}

function guessName(src: string): string {
    try {
        const name = new URL(src, location.href).pathname.split('/').pop() || '';
        return decodeURIComponent(name) || '图片';
    } catch {
        return '图片';
    }
}

function onContextMenuCapture(e: MouseEvent): void {
    const t = e.target as Element | null;
    if (!t || t.nodeType !== 1) return;
    const img =
        t.tagName === 'IMG'
            ? (t as HTMLImageElement)
            : ((t.closest?.('.image-item')?.querySelector('img') as HTMLImageElement | null) ?? null);
    if (!img) return;
    const src = img.currentSrc || img.src;
    if (!src) return;
    // 站点图是带 sign 的签名 URL，会过期 —— 只在这里实时取，不缓存到别处
    lastImage = { src, name: img.alt || guessName(src) };
}

/**
 * 收起所有站点右键菜单（v26.10.26-v6 重写）。
 *
 * ⚠️ 上一版（v26.10.22-v6）的写法有个致命的短路：`hideAll()` 只要能调**就算成功**（置
 * `hidden = true`），于是「display:none」这条兜底被跳过。真机反馈（2026-10-26）：点【打印】
 * 后菜单不收起 —— 库的 `hideAll` 并不保证把**当前这个**实例置为不可见（它按注册表遍历，
 * 当前实例可能还没登记 / 只清其它实例），而 `visible` 仍为 true ⇒ v-show 保持显示。
 * 现在改成三层，全部执行、不短路：
 *   ① `vm.hide()`（单实例收起；函数不存在就跳过）
 *   ② `vm.visible = false`（v-show 的真正开关 —— 直接改响应式字段，库下一帧就会隐藏）
 *   ③ 仍然可见（拿不到 vm / 站点改了实现）⇒ 行内 `display:none !important`
 *      （用 important 是为了压过站点可能存在的 `!important` 显示规则；下次右键时 v-show
 *       把它写回 `display:''`，所以不会把菜单永久弄坏）
 */
function hideMenus(): void {
    let uls: NodeListOf<Element>;
    try {
        uls = pageDoc().querySelectorAll('ul.v-contextmenu');
    } catch {
        return;
    }
    uls.forEach((u) => {
        const vm = (u as unknown as { __vue__?: { visible?: boolean; hide?: () => void } }).__vue__;
        if (!vm) return;
        try {
            if (typeof vm.hide === 'function') vm.hide();
        } catch {
            /* 站点内部实现变动：继续走下面的兜底 */
        }
        try {
            vm.visible = false;
        } catch {
            /* 非响应式 / 只读：兜底 */
        }
    });
    uls.forEach((u) => {
        if (getComputedStyle(u).display === 'none') return;
        (u as HTMLElement).style.setProperty('display', 'none', 'important');
    });
}

function onPrintClick(): void {
    const ctx = lastImage;
    hideMenus();
    // 站点自己的 document 点击委托会在我们之后跑，可能把菜单又置回可见（真机反馈的另一种成因）。
    // 这里补两枪（微任务后 + 350ms 后），hideMenus 幂等，且不影响下次右键正常打开。
    window.setTimeout(hideMenus, 0);
    window.setTimeout(hideMenus, 350);
    if (!ctx?.src) return;
    printA4Image(ctx.src, ctx.name);
}

function isImageMenu(ul: Element): boolean {
    const texts = [...ul.querySelectorAll('li > .menu-text')].map((s) => (s.textContent || '').trim());
    return texts.length >= MIN_ITEMS && texts.includes(IMAGE_MENU_KEY);
}

function injectInto(ul: HTMLUListElement): void {
    if (ul.querySelector(`[${PRINT_MARK}]`)) return;
    const first = ul.querySelector('li');
    if (!first) return;
    const li = document.createElement('li');
    // 只继承作用域属性（data-v-*），菜单项样式全靠它命中站点 scoped CSS
    for (const a of [...first.attributes]) {
        if (a.name !== 'class' && a.name !== 'id') li.setAttribute(a.name, a.value);
    }
    li.className = 'v-contextmenu-item';
    li.setAttribute(PRINT_MARK, '');
    const span = document.createElement('span');
    span.className = 'menu-text';
    span.textContent = '打印';
    li.appendChild(span);
    li.addEventListener('click', onPrintClick);
    // hover 底色不是 CSS :hover 伪类：v-contextmenu 库靠 mouseenter/mouseleave
    // 给 li 切换 `v-contextmenu-item--hover` class（实测 unpkg dist 源码），站点
    // scoped CSS 的蓝色底也挂在这个 class 上。createElement 出来的 li 没有库的
    // 事件绑定，必须自己补一份，否则悬浮时和原生项不一致（v26.10.23-v6 修复）。
    li.addEventListener('mouseenter', () => li.classList.add('v-contextmenu-item--hover'));
    li.addEventListener('mouseleave', () => li.classList.remove('v-contextmenu-item--hover'));
    ul.appendChild(li);
}

function scan(): void {
    pageDoc()
        .querySelectorAll('ul.v-contextmenu')
        .forEach((ul) => {
            if (isImageMenu(ul)) injectInto(ul as HTMLUListElement);
        });
}

/** DOM 变化防抖后重扫（聊天页消息频繁变动，裸扫会抖爆；querySelectorAll 本身很便宜） */
function scheduleScan(): void {
    if (scanTimer !== null) return;
    scanTimer = window.setTimeout(() => {
        scanTimer = null;
        try {
            scan();
        } catch (e) {
            console.warn('[打印] 右键菜单注入失败:', e);
        }
    }, 300);
}

export function startImageContextMenu(): void {
    if (started) return;
    started = true;
    document.addEventListener('contextmenu', onContextMenuCapture, true);
    scan();
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, { childList: true, subtree: true });
}

export function stopImageContextMenu(): void {
    if (!started) return;
    started = false;
    document.removeEventListener('contextmenu', onContextMenuCapture, true);
    observer?.disconnect();
    observer = null;
    if (scanTimer !== null) {
        window.clearTimeout(scanTimer);
        scanTimer = null;
    }
}
