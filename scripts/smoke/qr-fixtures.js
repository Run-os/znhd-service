/**
 * 常用语快捷按钮的冒烟夹具（v26.10.23）。
 *
 * 由 `vue-panel.js` 以内联 HTML 模板里的 `<script src="/qr-fixtures.js">` 引入 ——
 * 之所以独立成文件、而不是塞进模板字符串：夹具里有大量正则与转义（`\s`、`\n`、`<br>`），
 * 写在 JS 模板字符串里会被二次转义，出错后极难排查（本次迁移差点踩）。
 *
 * 装三类东西，缺一不可：
 *   ① 会话文本：`#app.__vue__.$store.state.chat.messageList` —— lib/feishu/convText.ts 从这里读对话；
 *   ② TinyMCE 桩：`window.tinymce.activeEditor` —— replaceToTinyMCE 走 setContent + getContent；
 *   ③ Inputbox 桩：`.input-tinymce.__vue__.updateText` —— 只调 setContent 不同步的话发送按钮是灰的
 *      （docs/tinymce-send-doc.md 第 2 节），断言必须看到同步值非空。
 *
 * 时序：33500ms 装（此时 sniff 的 Vuex 夹具已切换完毕、不会互相覆盖），37500ms 采样 +
 * 点一次按钮验证「整体替换」。采样结果挂 `window.__qrSnap`，由 vue-panel.js 读取。
 */
(function () {
    'use strict';

    window.__installQuickReplyFixtures = function () {
        // 本冒烟页没有 Vue 应用（不含 sniff 的会话分组夹具），#app 需要自己造：
        // lib/feishu/convText.ts 只认 `#app.__vue__.$store.state.chat.messageList` 这一个入口，
        // 形状必须与真实页面的 Vue2 + Vuex 一致。
        var app = document.getElementById('app');
        if (!app) {
            app = document.createElement('div');
            app.id = 'app';
            document.body.appendChild(app);
        }
        if (!app.__vue__) app.__vue__ = { $store: { state: { chat: { messageList: [] } } } };

        // ① 对话文本：含「解非」（命中 A）、含「申报」与「已申报」（B 命中关键词但被排除词拦掉）、
        //    不含「注销」（C 不命中）。
        //    ⚠️ 排除词必须是「已申报」这种**完整子串**：匹配是纯子串判断，
        //       写成「已经申报」就匹配不上「已申报」（首版夹具就是这么写错的，断言如期打红）。
        app.__vue__.$store.state.chat.messageList = [
            { type: 'TIMTextElem', payload: { text: '你好，我这边解非了，申报也做过了，已申报' } },
        ];

        // ② TinyMCE 桩：只实现 replaceToTinyMCE 真正会用到的方法
        window.__tinymceText = '';
        var ed = {
            _html: '',
            getBody: function () {
                var d = document.createElement('div');
                d.textContent = window.__tinymceText || '';
                return d;
            },
            focus: function () {},
            selection: { select: function () {}, collapse: function () {} },
            setContent: function (html) {
                ed._html = String(html || '');
                window.__tinymceText = ed._html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
            },
            insertContent: function (html) {
                ed.setContent(ed._html + String(html || ''));
            },
            getContent: function (opts) {
                return opts && opts.format === 'text' ? window.__tinymceText : ed._html;
            },
        };
        window.tinymce = { activeEditor: ed };

        // ③ Inputbox 桩：syncInputbox 从 .input-tinymce.__vue__ 往上找 updateText
        var inp = document.querySelector('.input-tinymce');
        if (inp) {
            window.__tinymceSynced = '';
            inp.__vue__ = {
                updateText: function (t) {
                    window.__tinymceSynced = String(t == null ? '' : t);
                },
            };
        }
        return true;
    };

    setTimeout(function () {
        window.__qrInstalled = window.__installQuickReplyFixtures();
    }, 33500);

    setTimeout(function () {
        var host = document.getElementById('__znhd_quick_reply_host__');
        var sr = host && host.shadowRoot;
        var btns = sr ? Array.prototype.slice.call(sr.querySelectorAll('[data-znhd="quick-reply-btn"]')) : [];
        var snap = {
            installed: !!window.__qrInstalled,
            mounted: !!host,
            // 挂载位置：必须挂在 composer 里、且紧挨在输入框**之前**（= 视觉上在输入框上方）
            inComposer: !!host && !!host.parentElement && host.parentElement.id === 'smoke-composer',
            beforeInput:
                !!host &&
                !!host.nextElementSibling &&
                host.nextElementSibling.className.indexOf('input-tinymce') >= 0,
            barPresent: !!(sr && sr.querySelector('[data-znhd="quick-reply-bar"]')),
            labels: btns.map(function (b) {
                return (b.textContent || '').trim();
            }),
        };
        // 点第一个按钮：验证「整体替换输入框内容」+「setContent 之后同步进 Inputbox」两条链路
        if (btns[0]) {
            btns[0].click();
            snap.afterClickText = window.__tinymceText || '';
            snap.synced = window.__tinymceSynced || '';
        }
        window.__qrSnap = snap;
    }, 37500);
})();
