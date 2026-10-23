import { addLog } from '@/lib/logger';
import { escapeHtml } from '@/lib/utils';

/**
 * TinyMCE 编辑器写入（常用语 → 会话输入框）。
 *
 * ── v26.10.22-v5 重写：只走 JS API，不留任何 DOM 兜底 ──────────────────────────
 * 依据实测（见 `docs/tinymce-send-doc.md`）：
 *   · 编辑器实例：`window.tinymce.activeEditor`（页面全页仅 1 个实例）；
 *   · 追加位置：**必须先把选区折叠到正文末尾**，否则 `insertContent()` 插在光标处
 *     （`setContent` 之后光标停在开头 ⇒ 追加会跑到最前面，实测踩过）；
 *   · 内容同步：编辑器的 HTML 要进 Vue 的 `Inputbox.msg`，发送按钮才会亮、发出的才是新内容。
 *     `insertContent / execCommand` 会触发 TinyMCE 事件、由包装层自动同步；
 *     `setContent` **不会**（实测 msg 保持旧值）。这里统一再显式同步一次，保证确定生效。
 *
 * 已彻底删除的旧实现（勿加回）：
 *   ① iframe DOM 兜底（`iframe.tox-edit-area__iframe` + `body.innerHTML` + 派发 input）；
 *   ② 旧 API 组合 `editor.save() / setDirty(true) / execCommand('mceInsertContent')`。
 * 前者的跨域/时序问题多且难排查，后者在 TinyMCE 6 已是遗留接口。
 */

/** 页面主世界的 window（拿不到就退回隔离世界的，两者 DOM 相同） */
function pageWin(): any {
    try {
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch (e) {
        /* 沙箱代理拦截时退回下面的 window */
    }
    return window;
}

/** 取 TinyMCE 编辑器实例（JS API，全页只有一个） */
function getEditor(): any | null {
    const ed = pageWin()?.tinymce?.activeEditor;
    return ed && typeof ed.insertContent === 'function' ? ed : null;
}

/**
 * 把编辑器当前 HTML 同步进 Vue 的输入框状态（`Inputbox.msg`）。
 *
 * 为什么要碰 Vue 实例：`.input-tinymce` 只是 TinyMCE 的挂载点，真正的发送逻辑在它的父组件
 * `Inputbox` 上（`updateText(content)` 内部就是 `this.msg = content`，`sendMsg()` 直接读 msg）。
 * 不同步 ⇒ 输入框看着有字、发送按钮却是灰的，或发出上一次的旧内容（均实测复现）。
 *
 * 找不到就返回 false（只记日志，不降级到任何其它写入方式）。
 */
function syncInputbox(html: string): boolean {
    const el = pageWin()?.document?.querySelector('.input-tinymce') as any;
    let vm = el?.__vue__;
    for (let i = 0; i < 6 && vm; i++) {
        if (typeof vm.updateText === 'function') {
            vm.updateText(html);
            return true;
        }
        vm = vm.$parent;
    }
    return false;
}

/**
 * 用一段文本**整体替换**会话输入框内容（快捷回复按钮点击用，v26.10.23）。
 *
 * 与 `appendToTinyMCE` 的差别只有写入方式：`setContent` 覆盖而非 `insertContent` 追加，
 * 因此不需要先折叠选区（折叠是为了控制插入位置，覆盖写入没有位置概念）。
 *
 * ⚠️ `setContent()` **不会**触发包装层监听的输入事件 ⇒ 必须显式 `syncInputbox()`，
 *    否则输入框里有字但发送按钮是灰的（`docs/tinymce-send-doc.md` 第 2 节实测）。
 *
 * @param {string} text - 要写入的纯文本（内部转义后换行转 <br>）
 * @returns {string} 成功返回写入后的输入框纯文本；找不到编辑器返回空字符串
 */
export function replaceToTinyMCE(text = ''): string {
    const editor = getEditor();
    if (!editor) {
        addLog('找不到 TinyMCE 编辑器（页面未就绪？）', 'error', true);
        return '';
    }

    const html = escapeHtml(text).replace(/\n/g, '<br>');
    editor.setContent(html);

    const content = editor.getContent();
    if (!syncInputbox(content)) {
        addLog('未能同步输入框状态（未找到 Inputbox 组件）', 'warning', true);
    }

    const finalText = editor.getContent({ format: 'text' });
    addLog('已替换输入框文本: ' + finalText, 'success', true);
    return finalText;
}

/**
 * 向会话输入框追加一段文本（常用语点击用）。
 *
 * @param {string} [text2append=''] - 要追加的纯文本（默认空串，避免掩盖漏传参数的 bug）
 * @returns {string} 成功返回追加后的输入框纯文本；找不到编辑器返回空字符串
 */
export function appendToTinyMCE(text2append = ''): string {
    const editor = getEditor();
    if (!editor) {
        addLog('找不到 TinyMCE 编辑器（页面未就绪？）', 'error', true);
        return '';
    }

    const body = editor.getBody();
    const isEmpty = !(body?.textContent || '').trim();

    // 纯文本 → HTML：转义后换行转 <br>；输入框已有内容时在前面补一个 <br> 续行（原行为）
    const html = escapeHtml(text2append).replace(/\n/g, '<br>');
    const payload = isEmpty ? html : '<br>' + html;

    // 选区折叠到正文末尾，再做插入（不折叠会插在光标处，可能落在开头）
    editor.focus();
    editor.selection.select(body, true);
    editor.selection.collapse(false);
    editor.insertContent(payload);

    const content = editor.getContent();
    if (!syncInputbox(content)) {
        addLog('未能同步输入框状态（未找到 Inputbox 组件）', 'warning', true);
    }

    const finalText = editor.getContent({ format: 'text' });
    addLog('已追加文本并同步: ' + finalText, 'success', true);
    return finalText;
}
