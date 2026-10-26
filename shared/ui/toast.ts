/**
 * 卡片式全局提示 —— **两端唯一实现**（v26.10.26-v9）。
 *
 * 历史：`src-vue/lib/toast.ts`（脚本端）与 `web/src/lib/toast.ts`（手机上传页）此前是
 * 两份逐字重复的实现，区别只有「容器挂哪儿」。改一处观感要动两个文件，且行为只有
 * 「建个 div → 3.2s 后 remove」：没有入场/退场动画、悬停不能暂停、不能手动关、
 * 重复调用会叠一堆、没有条数上限、没有 loading 态。v9 把全部逻辑收敛到这里，
 * 两端只保留一层「宿主适配」薄封装（见两个 lib/toast.ts 的头部说明）。
 *
 * ── 为什么是 `createToast(getHost)` 而不是直接摸 document ──────────────────
 * 共享层**零宿主依赖**（见 `shared/image/compress.ts` 头部说明与 AGENT.md 的 shared/ 行）：
 * 不许 import `src-vue/lib/shadow.ts`，也不许写 `document.body` —— 脚本端没有 body 可用
 * （页面样式被关在影子树里，容器必须挂在影子树内的 `#app` 下才能取到
 * `#app[data-theme]` 提供的主题变量），客户端则是普通文档。所以宿主由调用方以
 * **取容器的函数**注入：`() => HTMLElement | ShadowRoot | null`（见 `ToastHost`），返回 null
 * 时本模块静默 no-op。
 * 除 `setTimeout` / `requestAnimationFrame` / `Date.now` 这类通用 API 外不碰任何宿主全局。
 *
 * ── 为什么是卡片而不是整块高饱和 alert ───────────────────────────────────
 * `alert-success` / `alert-error` 会给整条铺满高饱和底色，一条红底在页面里非常刺眼，
 * 多条叠起来更像报错面板。这里改为「素色卡片 + 彩色小图标 + 阴影 + 小圆角 + 无边框」：
 *
 *   <div class="toast toast-top toast-center z-[9999]" data-znhd="toast">
 *     <div class="alert … bg-base-100 shadow-lg rounded-lg border-0" data-znhd-kind="error">
 *       <svg class="h-5 w-5 shrink-0 text-error">…</svg>
 *       <div class="min-w-0 flex-1 break-words">文案</div>
 *     </div>
 *   </div>
 *
 * 所有颜色一律走**主题 token**（`bg-base-100` / `text-base-content` / `text-success`…），
 * 不写死 hex、也不写 `bg-white`：主题是**两端各自配置**且已经换过几轮 —— 当前两端都是
 * cupcake 浅色（客户端 v26.10.21-v1 同步为 cupcake；脚本端夜间主题 v26.10.21-v5 已删），
 * 更早则是脚本端 wireframe/business、客户端 business 暗色。任一端将来再上暗色时，
 * 写死的白卡会立刻突兀发亮，所以一律走 token。
 *
 * ⚠️ 两条项目级禁令（都会突破浏览器基线 Chrome 88）：
 *   ① 不用 `bg-base-100/80`、`text-base-content/60` 这类**带 `/xx` 的透明修饰符** ——
 *      Tailwind v4 会把它编译成 `color-mix(in oklab, …)`，基线 Chrome 88 不支持，
 *      整条声明失效（卡片会变透明/文字发灰死掉）。要半透明一律用 `opacity-*` 工具类。
 *   ② 不用 `:has()`（Chrome 105+），本项目所有交互态靠 JS 类名切换。
 */

/** 提示类型；`loading` 是 v9 新增的「不会自动消失」形态（必须手动 close / update） */
export type ToastKind = 'success' | 'error' | 'warning' | 'info' | 'loading';

/** 向后兼容：string = 纯消息；对象可带 title 标题 + msg 正文 */
export type ToastInput = string | { title?: string; msg: string };

/**
 * `update()` 的入参：传字符串等价于「只换正文」；传对象可换 kind / title / msg。
 * 典型用法（loading → 结果）：
 *   const h = toast.loading('正在上传');
 *   …
 *   h.update({ kind: 'success', msg: '上传完成' });
 */
export type ToastUpdate = string | { kind?: ToastKind; title?: string; msg?: string };

/** 每条提示的句柄：close 幂等（第二次是 no-op），update 可换类型/文案 */
export interface ToastHandle {
    /** 手动关闭（播退场动画后移除）；重复调用幂等 */
    close(): void;
    /** 就地更新类型/标题/正文；换到 loading 会停表，换出 loading 会按新类型重新计时 */
    update(next: ToastUpdate): void;
}

/** 对外 API：与原实现同名同参，`toast.success('x')` 这类既有调用点零改动 */
export interface ToastApi {
    success(input: ToastInput): ToastHandle;
    error(input: ToastInput): ToastHandle;
    warning(input: ToastInput): ToastHandle;
    info(input: ToastInput): ToastHandle;
    loading(input: ToastInput): ToastHandle;
}

/**
 * 容器宿主：正常情况是元素（脚本端影子树内的 `#app`、客户端 `document.body`），
 * 影子树里找不到 `#app` 时脚本端会退到 ShadowRoot 本身（DocumentFragment 也能 appendChild），
 * 所以这里把两种都收下 —— 但**绝不**自己去判断是哪种端。
 */
export type ToastHost = HTMLElement | ShadowRoot;

/** 普通提示停留时长（ms） */
const DURATION = 3200;
/** error 停留更久：里面通常带失败原因，3.2s 读不完 */
const DURATION_ERROR = 4200;
/** 退场过渡时长（与 `duration-200` 对齐，多留 20ms 兜底） */
const EXIT_MS = 220;
/** 悬停暂停后恢复计时，剩余时间最少给这么多（否则一移开就瞬间消失） */
const MIN_REMAIN = 300;
/** 同屏最多几条；超出把最旧的一条直接摘掉（不播退场，否则「清得比来得慢」） */
const MAX_VISIBLE = 3;

/** 容器类：顶部居中 + 最高层级。`data-znhd="toast"` 是既有约定，冒烟与业务都在用 */
const CONTAINER_CLASS = 'toast toast-top toast-center z-[9999]';

/**
 * 单条入场/退场的**两个初始态类**：初始 `opacity-0 -translate-y-2`，
 * append 后下一帧移除 ⇒ transition 把卡片从上方滑入；退场时加回去 ⇒ 反向滑出。
 */
const ENTER_CLASSES = ['opacity-0', '-translate-y-2'] as const;

/**
 * 单条基础类。注意几处「压掉 daisyUI alert 默认值」的显式覆盖：
 *  · `alert` 自带 `bg-base-200` + `border` + `rounded-box` + `p-4` ⇒ 依次被
 *    `bg-base-100` / `border-0` / `rounded-lg` / `px-3 py-2` 覆盖；
 *  · `items-start` 压掉 alert 的 `align-items: center`（带标题时图标要与首行对齐）；
 *  · `w-72`（18rem）+ `max-w-[calc(100vw-2rem)]` 保证窄屏不顶到屏幕边缘。
 */
const ITEM_BASE =
    'alert pointer-events-auto flex items-start gap-2 w-72 max-w-[calc(100vw-2rem)] ' +
    'rounded-lg border-0 bg-base-100 px-3 py-2 text-sm text-base-content shadow-lg ' +
    'cursor-pointer transition-all duration-200 ease-out';

/** 无障碍角色：失败/警告会打断读屏（alert），其余走 status（不打断） */
const KIND_ROLE: Record<ToastKind, 'alert' | 'status'> = {
    success: 'status',
    error: 'alert',
    warning: 'alert',
    info: 'status',
    loading: 'status',
};

/** 图标尺寸类（v9 由 `h-6 w-6` 收到 `h-5 w-5`，与 14px 正文更协调） */
const ICON_CLASS = 'h-5 w-5 shrink-0 stroke-current';

/** Heroicons outline 的 path（与 daisyUI 官方 alert 示例同源，仅内联 SVG，零自定义样式） */
const ICON_PATH: Record<Exclude<ToastKind, 'loading'>, string> = {
    success: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    error: 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z',
    warning:
        'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    info: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
};

/** 图标颜色类（主题 token；写死 hex 会在日/夜主题之间失效） */
const ICON_COLOR: Record<Exclude<ToastKind, 'loading'>, string> = {
    success: 'text-success',
    error: 'text-error',
    warning: 'text-warning',
    info: 'text-info',
};

/** 拼一条图标 SVG（常量字符串，用 innerHTML 注入是安全的：不含任何外部输入） */
function iconSvg(kind: Exclude<ToastKind, 'loading'>): string {
    return (
        `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" ` +
        `class="${ICON_CLASS} ${ICON_COLOR[kind]}" aria-hidden="true">` +
        `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${ICON_PATH[kind]}"/>` +
        `</svg>`
    );
}

/** 每种类型的自动消失时长；null = 不自动消失（loading 必须手动收） */
function durationOf(kind: ToastKind): number | null {
    if (kind === 'loading') return null;
    return kind === 'error' ? DURATION_ERROR : DURATION;
}

/** 容器取不到时返回的空句柄（静默 no-op，不抛错、不留下半条 DOM） */
const NOOP_HANDLE: ToastHandle = {
    close: () => undefined,
    update: () => undefined,
};

/** 一条提示的全部运行时状态 */
interface Entry {
    /** 卡片根节点（`.alert`） */
    el: HTMLDivElement;
    kind: ToastKind;
    title: string;
    msg: string;
    /** 去重键 = kind + '\u0000' + msg */
    key: string;
    /** 自动消失计时器；null = 当前没在计时（悬停暂停 / loading） */
    timer: ReturnType<typeof setTimeout> | null;
    /** 本轮计时的起点（Date.now） */
    startedAt: number;
    /** 本轮还剩多少毫秒（悬停暂停时按真实流逝扣减，而不是重置成完整时长） */
    remain: number;
    /** 鼠标是否停在上面（悬停期间起的表一律先按住，等 mouseleave 再跑） */
    hovered: boolean;
    /** 已进入退场：close() 幂等的唯一判据 */
    closing: boolean;
    /** 退场结束后的移除计时器 */
    exitTimer: ReturnType<typeof setTimeout> | null;
    /** 返回给调用方的句柄 */
    handle: ToastHandle;
}

/**
 * 创建一个绑定到某个宿主的 toast 实例。
 *
 * @param getHost 每次需要弹提示时调用，返回**容器应挂到哪个宿主上**（元素或影子树）；
 *                返回 null 表示宿主未就绪（如影子树还没挂载）⇒ 本次调用静默 no-op。
 * @returns 与旧实现同名的 5 个方法；每个方法返回 `{ close, update }` 句柄。
 */
export function createToast(getHost: () => ToastHost | null): ToastApi {
    /** 模块级容器引用（每个实例一份）；宿主重挂载后靠 isConnected/parentElement 判失效 */
    let container: HTMLElement | null = null;
    /** 当前在册的提示（含正在退场、尚未移除的那 220ms） */
    const entries: Entry[] = [];

    /** 清掉自动消失计时器（不清 remain，调用方自己决定怎么重开） */
    function clearAutoTimer(entry: Entry): void {
        if (entry.timer !== null) {
            clearTimeout(entry.timer);
            entry.timer = null;
        }
    }

    /** 把一条提示从 DOM 和册子里彻底摘掉；容器空了就一并回收（保持旧实现的行为） */
    function dispose(entry: Entry): void {
        clearAutoTimer(entry);
        if (entry.exitTimer !== null) {
            clearTimeout(entry.exitTimer);
            entry.exitTimer = null;
        }
        entry.el.remove();
        const index = entries.indexOf(entry);
        if (index >= 0) entries.splice(index, 1);
        if (container && container.childElementCount === 0) {
            container.remove();
            container = null;
        }
    }

    /**
     * 取（必要时重建）容器。
     *  · 宿主拿不到 ⇒ null（调用方 no-op）；
     *  · 容器还在、且父节点就是当前宿主 ⇒ 复用；
     *  · 脚本重挂载（影子树被换掉 / 宿主被移除）⇒ 旧容器和它名下的提示都已失效，
     *    整批丢弃后重建，避免把新提示塞进一个不在文档里的容器。
     */
    function ensureContainer(): HTMLElement | null {
        const host = getHost();
        if (!host) return null;
        // parentNode（而不是 parentElement）：挂到 ShadowRoot 本身时 parentElement 是 null
        if (container && container.isConnected && container.parentNode === host) return container;
        if (container) {
            for (const entry of entries.slice()) dispose(entry);
            container.remove();
            container = null;
        }
        // 宿主自带的 document（影子树里的节点也属于主文档）；拿不到就不动 DOM
        const doc = host.ownerDocument;
        if (!doc) return null;
        const box = doc.createElement('div');
        box.className = CONTAINER_CLASS;
        box.setAttribute('data-znhd', 'toast');
        host.appendChild(box);
        container = box;
        return box;
    }

    /** 按当前的 kind / title / msg 重建卡片内容（update 与首次渲染共用） */
    function render(entry: Entry): void {
        const doc = entry.el.ownerDocument;
        const el = entry.el;
        el.setAttribute('data-znhd-kind', entry.kind);
        el.setAttribute('role', KIND_ROLE[entry.kind]);
        el.setAttribute('aria-atomic', 'true');
        el.title = '点击关闭';

        // 图标是固定常量（不含任何外部输入），可以走 innerHTML；文案一律 textContent 防注入
        const kind = entry.kind;
        el.textContent = '';
        if (kind === 'loading') {
            const spinner = doc.createElement('span');
            // ⚠️ 用 opacity-60 而不是 text-base-content/60：后者是 `/xx` 透明修饰符
            //    （Tailwind v4 会编译成 color-mix），超出 Chrome 88 基线。
            spinner.className = 'loading loading-spinner loading-sm shrink-0 opacity-60';
            spinner.setAttribute('aria-hidden', 'true');
            el.appendChild(spinner);
        } else {
            el.insertAdjacentHTML('afterbegin', iconSvg(kind));
        }

        // min-w-0 让中文长串能在 18rem 内换行（否则 flex 子项的最小内容宽度会撑破卡片）
        const wrap = doc.createElement('div');
        wrap.className = 'min-w-0 flex-1 break-words';
        if (entry.title) {
            const head = doc.createElement('div');
            head.className = 'font-semibold leading-5';
            head.textContent = entry.title;
            wrap.appendChild(head);
            const body = doc.createElement('div');
            body.className = 'text-xs leading-5 opacity-70';
            body.textContent = entry.msg;
            wrap.appendChild(body);
        } else {
            const body = doc.createElement('div');
            body.className = 'leading-5';
            body.textContent = entry.msg;
            wrap.appendChild(body);
        }
        el.appendChild(wrap);
    }

    /** 开表：从完整时长开始，记录起点，供悬停暂停时扣减 */
    function startAutoTimer(entry: Entry, ms: number): void {
        clearAutoTimer(entry);
        entry.remain = ms;
        entry.startedAt = Date.now();
        entry.timer = setTimeout(() => {
            entry.timer = null;
            closeEntry(entry);
        }, ms);
    }

    /** 按类型重新计时（loading 停表；鼠标正停在上面时先按住，等移开再跑） */
    function restartTimer(entry: Entry): void {
        const ms = durationOf(entry.kind);
        if (ms === null) {
            clearAutoTimer(entry);
            entry.remain = 0;
            return;
        }
        if (entry.hovered) {
            // 悬停中拿到新时长（典型：悬停着 loading 被 update 成 success）——先记账不跑表
            clearAutoTimer(entry);
            entry.remain = ms;
            return;
        }
        startAutoTimer(entry, ms);
    }

    /** 悬停暂停（**剩余时间**语义）：记住已经流逝的毫秒数，移开后只补剩下的 */
    function pauseAutoTimer(entry: Entry): void {
        if (entry.timer === null) return;
        clearAutoTimer(entry);
        const elapsed = Date.now() - entry.startedAt;
        entry.remain = Math.max(MIN_REMAIN, entry.remain - elapsed);
    }

    /** 移开恢复：把剩余时间（最少 MIN_REMAIN）接着计时，不当成「重新给一份完整时长」 */
    function resumeAutoTimer(entry: Entry): void {
        if (entry.timer !== null || entry.closing) return;
        // loading 本来就没有表：鼠标扫过一下不能让它 300ms 后自己跑掉
        if (durationOf(entry.kind) === null) return;
        const ms = Math.max(MIN_REMAIN, entry.remain);
        entry.remain = ms;
        entry.startedAt = Date.now();
        entry.timer = setTimeout(() => {
            entry.timer = null;
            closeEntry(entry);
        }, ms);
    }

    /** 重播入场：加回初始态类 → 强制一次样式计算 → 下一帧移除（否则两帧被合并，看不到动画） */
    function replayEnter(el: HTMLElement): void {
        el.classList.add(...ENTER_CLASSES);
        void el.offsetWidth;
        requestAnimationFrame(() => {
            if (el.isConnected) el.classList.remove(...ENTER_CLASSES);
        });
    }

    /** 关闭：播退场（加回初始态类）→ EXIT_MS 后移除。重复调用幂等 */
    function closeEntry(entry: Entry): void {
        if (entry.closing) return;
        entry.closing = true;
        clearAutoTimer(entry);
        if (!entry.el.isConnected) {
            dispose(entry);
            return;
        }
        entry.el.classList.add(...ENTER_CLASSES);
        entry.exitTimer = setTimeout(() => {
            entry.exitTimer = null;
            dispose(entry);
        }, EXIT_MS);
    }

    /** 就地更新：换 kind / title / msg，重建内容并按新类型重新计时 */
    function updateEntry(entry: Entry, next: ToastUpdate): void {
        // 已经在退场的句柄不再复活（close 之后 update 视为 no-op，语义最不容易出意外）
        if (entry.closing) return;
        if (typeof next === 'string') {
            entry.msg = next;
        } else {
            if (next.kind) entry.kind = next.kind;
            if (typeof next.msg === 'string') entry.msg = next.msg;
            if (typeof next.title === 'string') entry.title = next.title;
        }
        entry.key = entry.kind + '\u0000' + entry.msg;
        render(entry);
        restartTimer(entry);
    }

    /** 弹一条提示（内部唯一入口） */
    function show(kind: ToastKind, input: ToastInput): ToastHandle {
        const title = typeof input === 'string' ? '' : (input.title ?? '');
        const msg = typeof input === 'string' ? input : input.msg;
        const key = kind + '\u0000' + msg;

        // 同文案去重：连点按钮不该刷出一屏，改成「重置计时 + 重播入场」
        const existing = entries.find((entry) => entry.key === key);
        if (existing) {
            existing.title = title;
            render(existing);
            if (existing.closing) {
                // 正在退场的同文案：撤销退场，直接滑回来（比新建一条更连贯）
                existing.closing = false;
                if (existing.exitTimer !== null) {
                    clearTimeout(existing.exitTimer);
                    existing.exitTimer = null;
                }
                existing.el.classList.remove(...ENTER_CLASSES);
            } else {
                replayEnter(existing.el);
            }
            restartTimer(existing);
            return existing.handle;
        }

        const box = ensureContainer();
        if (!box) return NOOP_HANDLE;

        const el = box.ownerDocument.createElement('div');
        el.className = `${ITEM_BASE} ${ENTER_CLASSES.join(' ')}`;

        const entry: Entry = {
            el,
            kind,
            title,
            msg,
            key,
            timer: null,
            startedAt: 0,
            remain: 0,
            hovered: false,
            closing: false,
            exitTimer: null,
            handle: NOOP_HANDLE,
        };
        entry.handle = {
            close: () => closeEntry(entry),
            update: (next) => updateEntry(entry, next),
        };

        render(entry);

        // 整条可点关闭（cursor-pointer + title 提示已是可见线索）
        el.addEventListener('click', () => closeEntry(entry));
        // 悬停暂停：鼠标停在上面说明在读，别让它自己消失（按剩余时间，不重置）
        el.addEventListener('mouseenter', () => {
            entry.hovered = true;
            pauseAutoTimer(entry);
        });
        el.addEventListener('mouseleave', () => {
            entry.hovered = false;
            resumeAutoTimer(entry);
        });

        box.appendChild(el);
        entries.push(entry);

        // 同屏上限：超出就把最旧的一条**直接摘掉**（不播退场，否则清得比来得慢）
        while (entries.length > MAX_VISIBLE) dispose(entries[0]);

        // 入场：下一帧移除初始态类，transition 把卡片从上方滑入
        requestAnimationFrame(() => {
            if (el.isConnected) el.classList.remove(...ENTER_CLASSES);
        });

        restartTimer(entry);
        return entry.handle;
    }

    return {
        success: (input: ToastInput) => show('success', input),
        error: (input: ToastInput) => show('error', input),
        warning: (input: ToastInput) => show('warning', input),
        info: (input: ToastInput) => show('info', input),
        loading: (input: ToastInput) => show('loading', input),
    };
}
