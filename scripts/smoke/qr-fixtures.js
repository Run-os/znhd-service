/**
 * 常用语快捷按钮的冒烟夹具（v26.10.23）。
 *
 * 由 `vue-panel.js` 以内联 HTML 模板里的 `<script src="/qr-fixtures.js">` 引入 ——
 * 之所以独立成文件、而不是塞进模板字符串：夹具里有大量正则与转义（`\s`、`\n`、`<br>`），
 * 写在 JS 模板字符串里会被二次转义，出错后极难排查（本次迁移差点踩）。
 *
 * 装 four 类东西，时序不同：
 *   ⓪ **同步**（本文件被 <script src> 加载时，早于 znhd.user.js）：输入区 DOM +
 *      Inputbox 桩（`.input-tinymce.__vue__.$parent.$el`）—— 挂载发生在脚本加载后的
 *      1s 轮询里，__vue__ 桩必须在那之前就位，否则按钮条按兜底锚点挂错位置；
 *   ① 33500ms：会话文本 `#app.__vue__.$store.state.chat.messageList`
 *      （lib/feishu/convText.ts 从这里读对话；此时 sniff 的 Vuex 夹具已切换完毕、不会互相覆盖）；
 *   ①b 33500ms：主管税务机关 `chat.selectItem.taxguideRecord.swjgMc`（v26.10.26-v2）——
 *      convText.readOrg() 把它追加进匹配文本，隐私表 p2 只靠它命中；
 *   ② 33500ms：TinyMCE 桩 `window.tinymce.activeEditor` —— replaceToTinyMCE 走 setContent + getContent；
 *   ③ Inputbox 桩里的 `updateText` —— 只调 setContent 不同步的话发送按钮是灰的
 *      （docs/tinymce-send-doc.md 第 2 节），断言必须看到同步值非空。
 *
 * 规则缓存（主表 4 条 + 隐私表 3 条）不在这里：它必须早于 znhd.user.js 加载就位，
 * 由 vue-panel.js 的 GM 桩（`window.__store`）预置，与 GM_getValue/GM_setValue 桩同一处。
 *
 * 采样：37500ms 采样 + 点两个按钮（主栏第一个 = 「整体替换」；隐私行「办公电话」= 隐私段可填），
 * 结果挂 `window.__qrSnap`，由 vue-panel.js 读取。
 */
(function () {
    'use strict';

    // ---------- ⓪ 同步部分：输入区 DOM + Inputbox 桩 ----------
    // 结构复刻真实页面：Inputbox 组件根元素（#smoke-inputbox）里包含工具栏 + TinyMCE 挂载点。
    // v26.10.23-v2 起按钮条挂在 **Inputbox 根元素之前**（= 输入区含工具栏的外面上方），
    // 而不是 `.input-tinymce` 之前（那会卡在工具栏和编辑器中间，看着像长在输入框里）。
    var composer = document.getElementById('smoke-composer');
    var inputbox = document.getElementById('smoke-inputbox');
    if (composer && !inputbox) {
        inputbox = document.createElement('div');
        inputbox.id = 'smoke-inputbox';
        var toolbar = document.createElement('div');
        toolbar.className = 'composer-toolbar';
        var inp = document.createElement('div');
        inp.className = 'input-tinymce';
        inputbox.appendChild(toolbar);
        inputbox.appendChild(inp);
        composer.appendChild(inputbox);
    }
    if (inputbox) {
        var tinymceEl = inputbox.querySelector('.input-tinymce');
        if (tinymceEl && !tinymceEl.__vue__) {
            window.__tinymceSynced = '';
            // 形状对齐真实页面：.input-tinymce 的 __vue__ 是 TinyMCE 包装组件，
            // $parent 是 Inputbox，$el 是「工具栏 + 编辑器」的根元素
            tinymceEl.__vue__ = {
                $parent: { $el: inputbox },
                updateText: function (t) {
                    window.__tinymceSynced = String(t == null ? '' : t);
                },
            };
        }
    }

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

        // ① 对话文本（v26.10.26-v3：只取**最新 10 条有文本的消息**，图片不占槽）：
        //    共 14 条，其中 1 条图片 —— 不占槽；文本共 13 条，窗口盖住最新 10 条（= 文本第 4~13 条）。
        //    · 「注销」刻意放在**文本第 4 条**（距最新正好第 10 条）⇒ 它是**窗口边界探针**：
        //      10 条窗口 ⇒ 在窗口内 ⇒ 规则 C 显示；哪天窗口退回 6 条 ⇒ 落在窗口外 ⇒ C 消失 ⇒
        //      `quickReplyBarOk`（期望 3 个按钮）如期打红。**这是本次唯一能区分 6 与 10 的断言**。
        //    · 「解非」在窗口内 ⇒ 规则 A 显示；
        //    · 「申报 … 已申报」在窗口内 ⇒ B 命中关键词但被剔除关键词拦掉（剔除优先）。
        //    · 窗口外的 3 条（之前的事情 / 在吗 / 稍等一下）不带任何关键词，纯占位。
        //    ⚠️ 剔除关键词必须是「已申报」这种**完整子串**：匹配是纯子串判断，
        //       写成「已经申报」就匹配不上「已申报」（首版夹具就是这么写错的，断言如期打红）。
        app.__vue__.$store.state.chat.messageList = [
            { payload: { text: '之前的事情先记着' } },
            { payload: { text: '在吗' } },
            { payload: { text: '稍等一下' } },
            { payload: { text: '之前聊的注销流程先放一放' } },
            { type: 'TIMImageElem', payload: {} },
            { payload: { text: '我看下消息' } },
            { payload: { text: '好的没问题' } },
            { payload: { text: '嗯嗯好的' } },
            { payload: { text: '收到' } },
            { payload: { text: '麻烦看下' } },
            { payload: { text: '辛苦了' } },
            { payload: { text: '这边等你' } },
            { payload: { text: '你好，我这边解非了' } },
            { payload: { text: '申报也做过了，已申报' } },
        ];

        // ①b 主管税务机关（v26.10.26-v2）：lib/feishu/convText.ts 的 readOrg() 读
        //     chat.selectItem.taxguideRecord.swjgMc，并追加到匹配文本末尾（不占 10 条配额）。
        //     隐私表 p2 只写了标签「税源管理股」⇒ 它能否出现，就是「org 并入匹配」的端到端证据
        //     （readOrg 取不到时恒返回空串，p2 就一定不显示）。
        //     ⚠️ 挂到已有的 state.chat 上，不要整体替换（否则 messageList 丢）。
        app.__vue__.$store.state.chat.selectItem = {
            taxguideRecord: { swjgMc: '国家税务总局衡阳市南岳区税务局税源管理股' },
        };

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
        return true;
    };

    setTimeout(function () {
        window.__qrInstalled = window.__installQuickReplyFixtures();
    }, 33500);

    setTimeout(function () {
        var host = document.getElementById('__znhd_quick_reply_host__');
        var sr = host && host.shadowRoot;
        var btns = sr ? Array.prototype.slice.call(sr.querySelectorAll('[data-znhd="quick-reply-btn"]')) : [];
        // 隐私行（v26.10.26-v2）：常显 + 匹配命中两类按钮共用这个钩子
        var privacyBtns = sr
            ? Array.prototype.slice.call(sr.querySelectorAll('[data-znhd="quick-reply-privacy-btn"]'))
            : [];
        var textOf = function (b) {
            return (b.textContent || '').trim();
        };
        var snap = {
            installed: !!window.__qrInstalled,
            mounted: !!host,
            // 挂载位置：必须在 composer 里、紧挨在 **Inputbox 根元素**之前
            //（= 工具栏 + 编辑器整块的外面上方，v26.10.23-v2）
            inComposer: !!host && !!host.parentElement && host.parentElement.id === 'smoke-composer',
            beforeInput:
                !!host && !!host.nextElementSibling && host.nextElementSibling.id === 'smoke-inputbox',
            barPresent: !!(sr && sr.querySelector('[data-znhd="quick-reply-bar"]')),
            labels: btns.map(textOf),
            privacyLabels: privacyBtns.map(textOf),
            // 隐私行是否真的渲染（有 privacyPinned 或 privacy 任一段有内容才出现）
            privacyRowPresent: privacyBtns.length > 0,
        };
        // 点第一个主栏按钮：验证「整体替换输入框内容」+「setContent 之后同步进 Inputbox」两条链路
        if (btns[0]) {
            btns[0].click();
            snap.afterClickText = window.__tinymceText || '';
            snap.synced = window.__tinymceSynced || '';
        }
        // 再点隐私行里标题为「办公电话」的常显按钮：验证隐私段同样能填入内容
        // （放在主栏点击之后，免得覆盖 afterClickText 的判据）
        for (var i = 0; i < privacyBtns.length; i++) {
            if (textOf(privacyBtns[i]) === '办公电话') {
                privacyBtns[i].click();
                snap.privacyPickText = window.__tinymceText || '';
                snap.privacyPickSynced = window.__tinymceSynced || '';
                break;
            }
        }
        window.__qrSnap = snap;
    }, 37500);
})();
