/**
 * 征纳互动页面「常用话术」读取器（v26.10.18-v2 起为常用语唯一数据源）。
 *
 * 背景：常用语原从腾讯文档 / YAML 远程地址拉取；现改为直接读**本页**右侧栏
 * 「会话人信息 → 常用话术」的真实数据，保证与坐席看到的话术永远一致。
 *
 * 原理（方案1：纯程序化触发，无逆向、无直连接口）：
 *  - Vue 的 `@click` 监听的是**合成事件** ⇒ `dispatchEvent(new MouseEvent('click'))`
 *    即可驱动 TDesign 的 tab 切换与文件夹懒加载，不需要真实鼠标；
 *  - 话术正文是**懒加载**的（启动时只有组树和计数），必须逐个展开文件夹节点；
 *    ⚠️ 真正的展开触发器是**文件夹图标** `span.t-folder-icon`（其上有 trigger="expand"），
 *    点 `.t-tree__label` 一点反应都没有——v26.10.18-v2 首版就是踩了这个坑，
 *    页面上表现为「秒失败」，看着像没走抓取流程（见 2026-10-18 记忆）；
 *  - 读完后把右侧栏切回「会话人信息」tab，不干扰坐席操作。
 *
 * ⚠️ 性能约束：宿主是低配实机，每步之间用 300~500ms 的短轮询等待，绝不做
 *    组件树递归扫描（曾把页面压崩，见 .workbuddy/memory/2026-10-18.md）。
 */

/** 话术数据：全部话术（坐席组库）与我的人话术各一份字符串数组 */
export interface ZnhdPhrases {
    all: string[];
    mine: string[];
}

const POLL_INTERVAL = 300;
const POLL_TIMEOUT = 8000;
/** 展开轮次上限（每轮把所有「未展开的文件夹」点一遍） */
const MAX_EXPAND_ROUNDS = 12;
/** 单个文件夹点击后的等待（懒加载请求往返） */
const EXPAND_GAP = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 轮询等待某个条件成立；超时抛出带说明的错误 */
function waitFor<T>(what: string, probe: () => T | null | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const tick = () => {
            let hit: T | null | undefined = null;
            try {
                hit = probe();
            } catch {
                /* 探测本身的异常按未命中处理 */
            }
            if (hit) return resolve(hit);
            if (Date.now() - started > POLL_TIMEOUT) {
                return reject(new Error('等待「' + what + '」超时（' + POLL_TIMEOUT + 'ms）——是否已进入会话页面？'));
            }
            setTimeout(tick, POLL_INTERVAL);
        };
        tick();
    });
}

/**
 * 合成点击（Vue @click 监听合成事件即可触发，无需真实鼠标）。
 *
 * ⚠️ **绝对不能传 `view`**（v26.10.18-v4 踩过）：油猴 / ScriptCat 的沙箱里 `window`
 * 不是原生 `Window` 实例（是包装过的代理对象），`new MouseEvent('click', {view: window})`
 * 会在构造参数转换阶段直接抛
 * `Failed to construct 'MouseEvent': Failed to read the 'view' property from 'UIEventInit'`，
 * 抓取器连一个事件都发不出去。Vue 的 @click 处理器只用到 `event` 本身，不需要 `view`。
 * 冒烟跑在「无沙箱」的普通页面里 ⇒ 这个错在冒烟里永远复现不出来，故加了 try/catch 兜底。
 */
function clickEl(el: Element): void {
    const opts = { bubbles: true, cancelable: true };
    let ev: MouseEvent;
    try {
        ev = new MouseEvent('click', opts);
    } catch {
        // 极老宿主：连 MouseEvent 构造都不认，退到通用 Event（Vue 也能收到 click）
        ev = new Event('click', opts) as unknown as MouseEvent;
    }
    el.dispatchEvent(ev);
}

/** 在右侧栏里按文案找 tab 导航项 */
function findTabNav(text: string): HTMLElement | null {
    const label = [...document.querySelectorAll('.t-tabs__nav-item-text-wrapper')].find(
        (e) => e.textContent?.trim() === text
    );
    return (label?.closest('.t-tabs__nav-item') as HTMLElement) || null;
}

/** 切到指定 tab 并等它的面板出现 */
async function switchTab(text: string): Promise<void> {
    const nav = findTabNav(text);
    if (!nav) throw new Error('右侧栏没有「' + text + '」tab——是否已进入会话页面？');
    if (!nav.className.includes('active')) {
        clickEl(nav);
        await waitFor(text + ' tab 激活', () => (nav.className.includes('active') ? nav : null));
    }
}

/**
 * 展开「全部话术 / 我的话术」两棵树里所有还没展开的文件夹节点。
 *
 * TDesign 树的判定（2026-10-18 真机确认）：
 *  - 叶子节点 = `.t-tree__item.custom-rich-node`（话术条目，里面挂 `.auxiliary-item`）；
 *  - 文件夹节点 = 其余 `.t-tree__item`，展开态带 `.t-tree__item--open`；
 *  - 展开动作必须点节点内的 `span.t-folder-icon`（点 label 无效）；
 *  - 叶子节点的 `.t-folder-icon` 是空占位 span，所以**不能**用「有没有 .t-folder-icon」
 *    来区分文件夹，只能看 `custom-rich-node`。
 */
async function expandAllFolders(panel: HTMLElement): Promise<void> {
    let lastClosed = -1;
    for (let round = 0; round < MAX_EXPAND_ROUNDS; round++) {
        const closed = [...panel.querySelectorAll<HTMLElement>('.t-tree__item')].filter(
            (it) => !it.classList.contains('custom-rich-node') && !it.classList.contains('t-tree__item--open')
        );
        if (!closed.length) return;
        // 上一轮点完还是同样多没展开 ⇒ 点击没生效，别死循环
        if (closed.length === lastClosed) return;
        lastClosed = closed.length;
        for (const item of closed) {
            clickEl(item.querySelector('.t-folder-icon') || item);
            await sleep(EXPAND_GAP);
        }
        await sleep(500);
    }
}

/** 从面板的两个分组容器里提取话术文本 */
function extractGroups(panel: HTMLElement): ZnhdPhrases {
    // .verbal-trink-main = 全部话术（系统话术组库）；.main = 我的话术（个人组库）
    const read = (sel: string): string[] =>
        [...panel.querySelectorAll(sel + ' .auxiliary-item')]
            .map((i) => (i.firstElementChild?.textContent || '').trim())
            .filter(Boolean);
    return { all: read('.verbal-trink-main'), mine: read('.main') };
}

/**
 * 程序化读取本页「常用话术」。
 * 成功返回 `{all, mine}`；结束后右侧栏保证停在「会话人信息」tab。
 * 任何一步失败都会先尝试切回「会话人信息」再把错误抛出。
 */
export function readPhrasesFromZnhd(): Promise<ZnhdPhrases> {
    const restoreHome = () => {
        try {
            const home = findTabNav('会话人信息');
            if (home && !home.className.includes('active')) clickEl(home);
        } catch {
            /* 还原失败不影响主流程结果 */
        }
    };
    return (async () => {
        try {
            await switchTab('常用话术');
            // 面板里必须已经有组树节点，否则可能还是上一个 tab 的残留 DOM
            const panel = await waitFor(
                '话术面板',
                () =>
                    ([...document.querySelectorAll<HTMLElement>('.display-container')].find((e) =>
                        e.querySelector('.t-tree__item')
                    ) as HTMLElement) || null
            );
            await expandAllFolders(panel);
            const data = extractGroups(panel);
            if (!data.all.length && !data.mine.length) {
                throw new Error('话术面板里没有读到任何条目——可能是文件夹未展开或页面结构已变化');
            }
            return data;
        } finally {
            restoreHome();
        }
    })();
}
