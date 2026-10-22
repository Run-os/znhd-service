# 征纳互动 · TinyMCE 编辑器 JS 发送文本开发文档

> 基于 2026-10-22 真实环境实测（v26.10.22-v4 时代，TinyMCE 6.4.2 + Vue 2 + TDesign）。  
> 所有代码均在「征纳互动」工作台页面（会话中）控制台验证通过。

## 1. 环境结构

| 层          | 定位方式                                       | 说明                                                   |
| ---------- | ------------------------------------------ | ---------------------------------------------------- |
| TinyMCE 实例 | `window.tinymce.activeEditor`              | v6.4.2，实例 id 形如 `#vue-tinymce-<时间戳>`                 |
| 编辑器挂载点     | `document.querySelector('.input-tinymce')` | 全页**仅 1 个**编辑器实例（`tinymce.editors.length === 1`）     |
| Vue 包装组件   | `.input-tinymce` 元素的 `__vue__`             | props：`content / setup / disabled / setting / debug` |
| 发送组件       | 包装组件的 `$parent`，组件名 **`Inputbox`**         | 持有 `msg` 数据与 `sendMsg / updateText` 方法               |
| 发送管线       | `$store.dispatch('chat/sendText', msg)`    | 最终调腾讯 IM SDK `_tim.sendText(群id, msg, …)`            |

## 2. 核心结论（实测）

### ⚠️ 只调 `setContent()` 是发不出去的

```js
tinymce.activeEditor.setContent('<p>你好</p>');
// ✗ 发送按钮仍然禁用！
```

原因：编辑器内容 → Vue 的同步靠 Inputbox 注册的 `updateText(content)` 回调  
（内部就是 `this.msg = content`）。`setContent()` 走程序化路径，**不触发**  
包装层监听的用户输入事件，`msg` 不会更新，发送按钮永远禁用。

### ✅ 正确姿势：setContent + updateText 两步

```js
const ed = window.tinymce.activeEditor;                       // 1. 拿编辑器
const ib = document.querySelector('.input-tinymce').__vue__.$parent;  // 2. 拿 Inputbox

ed.setContent('<p>要发送的内容，支持 HTML</p>');               // 3a. 写入编辑器
ib.updateText(ed.getContent());                               // 3b. 同步进 Vue（关键！）

// 发送（二选一）
document.querySelector('button.submit').click();              // 点真实发送按钮
ib.sendMsg();                                                 // 或直接调方法
```

- `updateText` 之后发送按钮**异步**点亮（Vue nextTick 后 DOM 才更新），  
  同步立刻读 `btn.disabled` 可能读到 `true`，等 100~300ms 再读/点击。
- **发送成功后编辑器与 `msg` 自动清空**（`ed.getContent() === ''`），无需手动清理。

### ✅ 纯文本最简版（不带 HTML）

```js
ed.setContent('<p>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>');
ib.updateText(ed.getContent());
ib.sendMsg();
```

纯文本必须先做 HTML 转义，否则用户输入里的 `<`、`&` 会被当标签解析。

## 3. 发送约束（来自 sendMsg 源码）

| 校验   | 阈值                                           | 超限行为                                        |
| ---- | -------------------------------------------- | ------------------------------------------- |
| 非空   | `msg.length !== 0`                           | 静默 return（按钮禁用同源）                           |
| 字节长度 | `computedByteLen(msg) < 0x1F40`（**8000 字节**） | `$message.warning('发送内容过长，发送失败！')` 并 return |

`computedByteLen` 按中文等宽字符计 2 字节——中文约 4000 字上限。

## 4. 超链接支持（实测 ✅）

**结论：全链路支持，收到的消息里是可直接点击的 `<a>`。**

实测链路（2026-10-22，真实会话发送）：

1. 编辑器层：`setContent('<p><a href="https://example.com/test">点击打开示例</a></p>')`  
   → `getContent()` 中 `<a>` 原样保留（编辑器无 `valid_elements` 白名单限制，默认放行）；
2. 管线层：`msg` 原样进 `chat/sendText` → `_tim.sendText`，**无 HTML 消毒/标签剥离**；
3. 渲染层：对端与本端气泡均用 `rich-text-content` 类的 span 做 HTML 渲染，  
   发送后气泡 DOM 实测为：

```html
<span class="rich-text-content is-right">
  <p>测试超链接：<a href="https://example.com/test">点击打开示例</a></p>
</span>
```

即接收方看到的就是真 `<a>` 元素，可直接点击打开。

发链接的推荐写法：

```js
const url = 'https://example.com/xxx';
ed.setContent(`<p>请点击链接：<a href="${url}" target="_blank" rel="noopener">${url}</a></p>`);
ib.updateText(ed.getContent());
ib.sendMsg();
```

### 4.1 链接颜色：**不要加任何颜色**

实测三态（2026-10-22）：

| 阶段 | 实测颜色 | 来源 |
|---|---|---|
| 发送前（编辑器内） | `rgb(0, 0, 238)` 蓝 | 浏览器默认链接色（TinyMCE 内容区未覆盖） |
| 发送后（自己气泡，`.is-right`） | `rgb(255, 255, 255)` 白 | 气泡容器文字色，`<a>` 继承 |
| 对方收到（对端气泡） | 黑 | 对端气泡自身 CSS，`<a>` 继承 |

也就是说**什么都不用加，默认就是你要的三态**——蓝色只在编辑期出现，发出去后由各自气泡的 CSS 决定。

⚠️ **千万别用内联 `style="color:…"`**：实测编辑器与发送管线都会原样保留该属性
（`getContent()` 返回 `style="color: #1677ff;"`，管线无 DOMPurify、无 HTML 消毒），
而气泡是 HTML 直出、内联样式优先级高于类名规则 ⇒ **两端都会被强成同一个颜色**，
白色 / 黑色效果直接失效。

### 4.2 新标签页打开：加 `target="_blank"`

默认 `<a>` 不带 `target`，点击即当前标签页跳走（会离开工作台）。

实测（2026-10-22）：

- `target="_blank"` 与 `rel="noopener"` 在编辑器 `getContent()` 中**完整保留**
  （`a[href|target|rel]` 不在任何白名单限制内）；
- 页面**没有**链接点击拦截：在气泡内注入 `<a href="about:blank" target="_blank">`
  实测点击后新开标签页、原工作台 URL 不变；
- 气泡渲染与发送内容**逐字节一致**（已发消息实测 `<p>…<a href="…">…</a></p>` 原样呈现），
  故 `target` 会在对端同样生效。

所以把 URL 生成函数固定成：

```js
const link = (url, text = url) =>
  `<a href="${url}" target="_blank" rel="noopener">${text}</a>`;
```

## 5. 追加文本（输入框已有内容时往后加）

`insertContent()` 插在**光标/选区处**，不是自动追加到末尾——实测若无脑调用，
内容会插到最前面（`setContent` 后光标停在开头）。正确做法是先把选区折叠到末尾：

```js
function appendText(html) {
    const ed = window.tinymce.activeEditor;
    const ib = document.querySelector('.input-tinymce').__vue__.$parent;
    ed.focus();
    ed.selection.select(ed.getBody(), true);   // 全选正文
    ed.selection.collapse(false);              // 折叠到末尾（false = 尾）
    ed.insertContent(html);                    // 现在才是真正的「追加」
    ib.updateText(ed.getContent());             // 同步给 Vue（否则发送按钮不亮）
}
```

实测：`<p>原始一段</p>` + 追加 `<p>末尾追加段</p>`
→ `<p>原始一段</p>\n<p>末尾追加段</p>` ✅

也可以用纯字符串拼接（更简单，但会保留 `\n` 分隔）：

```js
ed.setContent(ed.getContent() + '<p>追加段</p>');
ib.updateText(ed.getContent());
```

追加后的字节数仍受 **8000 字节**上限约束，批量追加时要自己累计判断。

### 5.1 哪些 API 会自动同步 Vue？（实测）

| API | 是否自动同步 `msg` | 说明 |
|---|---|---|
| `setContent(html)` | ❌ **不同步** | 实测 `msg` 保持旧值（空输入框时是 `''`），发送按钮不亮 |
| `insertContent(html)` | ✅ 自动 | 触发 TinyMCE 事件 → 包装层回调 `updateText` |
| `execCommand('mceInsertContent', …)` | ✅ 自动 | 遗留接口，效果同 `insertContent` |

结论：**用 `insertContent` 也要显式 `updateText()` 兜一次**——自动同步依赖包装层的事件监听，
显式同步才是确定性的（两条路径同时到位，改版后也不会出现「有字不能发」）。

## 6. 清空文本

`setContent('')` 只清编辑区，**不清 Vue 的 `msg`**——实测此时 `msg` 仍是旧内容，
按钮也仍可点（等于会把旧文本发出去）。必须两步：

```js
function clearInput() {
    const ed = window.tinymce.activeEditor;
    const ib = document.querySelector('.input-tinymce').__vue__.$parent;
    ed.setContent('');            // ① 清编辑区
    ed.undoManager.clear();        // ② 顺手清撤销栈（可选，防止 Ctrl+Z 把旧内容撤回）
    ib.updateText('');             // ③ 清 Vue 侧缓存（关键！）
}
```

实测：执行后 `getContent() === ''`、`ib.msg === ''`、发送按钮回到**禁用**态 ✅

「清空再写新内容」= 先 `clearInput()` 再走 §2 的两步发送法，或直接：

```js
ed.setContent(newHtml);   // setContent 本身就是整体覆盖，不必先清空
ib.updateText(ed.getContent());
```

## 7. 备选路径：纯 UI 键入（不碰 JS 内部结构）

编辑器正文在 iframe（`.tox-edit-area__iframe`，标题 "Rich Text Area"）里，  
自动化工具（如 CDP/Playwright）需先进入 iframe 定位 `body#tinymce`，再模拟逐字键入。  
键入路径会天然触发 `updateText`，无需手动同步；回车即发送（Shift+Enter 换行）。

- 优点：不依赖组件内部 API，版本升级更抗变；
- 缺点：慢、受输入法/焦点影响；HTML（含 `<a>`）无法直接键入产生。

## 8. 调试备忘（Agent/自动化场景）

- **bash 里调 `bsk evaluate` 传 JS 时，表达式必须用单引号包裹**：双引号会让  
  `vm.$parent` 被 shell 当作 `$parent` 变量展开成空串，报  
  `SyntaxError: Unexpected token '&&'/'||'`（\_$ 展开坑）。
- 组件链：气泡 `rich-text-content` ← `rich-text-item` ← `MsgBase` ← `MsgItem`。
- 消息是否发送成功可查 `$store.state.chat`（`groupInfoList / selectItem.imRoomId`）。
