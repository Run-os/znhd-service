import { buildA4ImageNode, PRINT_PAGE_STYLE } from '../../shared/preview/print';

/**
 * A4 打印原图（v26.10.18-v5，Vue 版）。
 *
 * React 侧用 `react-to-print`；Vue 侧没必要为这一个动作再引一个依赖 —— 它的核心就是
 * 「建一个隐藏 iframe、把节点塞进 iframe 文档、调 `print()`」，这里照做即可。
 *
 * ⚠️ 两个必须保留的细节（与 React 版同一套结论，见 `shared/preview/print.ts` 头注）：
 *   · `PRINT_PAGE_STYLE` 里 `@page{margin:0}` 是**为了不给浏览器页眉页脚留位置**；
 *   · 打印节点必须 `doc.importNode` 后挂进 iframe 文档 —— 直接 `appendChild` 跨文档会抛错，
 *     而把主文档里的节点隐藏起来打印则打不出内容（iframe 文档里没有那段 DOM）。
 */
export function printA4Image(src: string, title: string): void {
    const run = (natural?: { width: number; height: number }) => {
        const node = buildA4ImageNode(src, title, natural);
        const frame = document.createElement('iframe');
        // id 与 React 版 react-to-print 保持一致：`scripts/smoke/phone-page.js` 靠它观察打印文档
        frame.id = 'printWindow';
        frame.setAttribute('aria-hidden', 'true');
        // 宽高为 0 但**不能 display:none**（部分浏览器会跳过不可见 iframe 的打印任务）
        frame.style.cssText =
            'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
        document.body.appendChild(frame);

        const doc = frame.contentDocument;
        if (!doc) {
            frame.remove();
            return;
        }
        const safeTitle = title.replace(/[<>&"]/g, (c) =>
            c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;'
        );
        doc.open();
        doc.write(
            '<!doctype html><html><head><meta charset="utf-8"><title>' +
                safeTitle +
                '</title><style>' +
                PRINT_PAGE_STYLE +
                '</style></head><body></body></html>'
        );
        doc.close();
        doc.body.appendChild(doc.importNode(node, true));

        const fire = () => {
            try {
                frame.contentWindow?.focus();
                frame.contentWindow?.print();
            } catch (e) {
                /* 用户可能已取消：静默 */
            }
            // 打印对话框是模态的，print() 返回时通常已关闭；留足兜底时间再移除
            window.setTimeout(() => frame.remove(), 60000);
        };
        const img = doc.body.querySelector('img');
        if (img && !img.complete) {
            img.addEventListener('load', fire, { once: true });
            img.addEventListener('error', fire, { once: true });
        } else {
            window.setTimeout(fire, 80);
        }
    };

    const probe = new Image();
    probe.onload = () => run({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.onerror = () => run();
    probe.src = src;
}
