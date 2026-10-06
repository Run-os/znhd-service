import { addLog } from '@/lib/logger';
import { escapeHtml } from '@/lib/utils';

/**
 * TinyMCE 编辑器写入（原 app.ts 中的 appendToTinyMCE）。
 * 模块化 P3：逐字迁移，仅加 export。
 */

/**
 * 向页面中第一个 TinyMCE 编辑器追加文本并立即生效。
 * 优先使用 TinyMCE API，失败时降级为直接操作 iframe DOM 并派发 input 事件；
 * 输入框非空时在内容前补 <br> 实现换行。
 * @param {string} [text2append=''] - 要追加的文本（默认空串，避免掩盖漏传参数的 bug）
 * @returns {string} 成功返回追加后的编辑器完整纯文本；找不到编辑器/iframe 等失败场景返回空字符串
 */
export function appendToTinyMCE(text2append: any = '') {
    /* 1. 拿到编辑器实例（动态匹配，不依赖 id） */
    const editors = window.tinymce?.editors ?? []; // 所有 TinyMCE 实例
    const ed = editors.find((e: any) => e.inline === false); // 先拿第一个非 inline 的
    // 如果上面没拿到，再随便拿一个
    const editor = ed || editors[0];

    // 检查输入框是否为空
    let isInputEmpty = true;
    if (editor) {
        const body = editor.getBody();
        isInputEmpty = !body.textContent.trim();
    } else {
        const iframe: HTMLIFrameElement | null =
            document.querySelector('.input-box iframe.tox-edit-area__iframe') ||
            document.querySelector('iframe.tox-edit-area__iframe') ||
            document.querySelector('iframe[class*="tox"]');
        if (iframe) {
            try {
                const body = iframe.contentDocument!.querySelector('body#tinymce') || iframe.contentDocument!.body;
                isInputEmpty = !body.textContent!.trim();
            } catch (e) {
                addLog('无法访问iframe内容: ' + e.message, 'warning', true);
            }
        }
    }

    /* 2. 使用<br>换行处理 */
    // 转义文本并将换行符替换为<br>
    const escapedText = escapeHtml(text2append);
    let processedContent = escapedText.replace(/\n/g, '<br>');

    // 如果输入框不为空，在内容前添加<br>实现换行
    if (!isInputEmpty) {
        processedContent = '<br>' + processedContent;
    }

    /* 3. 真正干活 */
    if (editor) {
        const body = editor.getBody(); // 等同于 iframe.body

        if (isInputEmpty) {
            // 输入框为空时直接设置内容（不加额外换行）
            editor.setContent(processedContent);
        } else {
            // 输入框不为空时使用处理后的内容
            editor.execCommand('mceInsertContent', false, processedContent);
        }

        editor.save(); // 同步回 textarea
        editor.setDirty(true); // 标记脏
        editor.selection.select(body, true); // 把光标放末尾
        editor.selection.collapse(false);
    } else {
        /* 4. 兜底：直接改 DOM + 触发事件 */
        const iframe: HTMLIFrameElement | null =
            document.querySelector('iframe.tox-edit-area__iframe') || document.querySelector('iframe[class*="tox"]');
        if (!iframe) {
            addLog('找不到 TinyMCE iframe', 'error', true);
            return '';
        }

        try {
            const body = iframe.contentDocument!.body;
            if (!body) {
                addLog('找不到 body', 'error', true);
                return '';
            }
            if (isInputEmpty) {
                body.innerHTML = processedContent;
            } else {
                body.insertAdjacentHTML('beforeend', processedContent);
            }
            // 触发单个 input 事件即可
            body.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {
            addLog('无法访问 iframe 内容: ' + e.message, 'error', true);
            return '';
        }
    }

    // 兜底路径：body#tinymce 位于 iframe 内部，主 document 查询永远为 null，
    // 须先定位 iframe 再读其 contentDocument 的 body 文本（与上面 DOM 兜底写入的是同一个 body）
    const fallbackIframe: HTMLIFrameElement | null =
        document.querySelector('iframe.tox-edit-area__iframe') || document.querySelector('iframe[class*="tox"]');
    const finalText = editor
        ? editor.getContent({ format: 'text' })
        : fallbackIframe?.contentDocument?.body?.textContent ?? '';
    addLog('已追加文本并同步: ' + finalText, 'success', true);
    return finalText;
}
