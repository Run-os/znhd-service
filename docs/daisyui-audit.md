# daisyUI 5 规范符合性审计

> 审计时间：2026-10-20 · 依据：`.agents/skills/daisyui`（v5.7.x，SKILL.md + usage + colors + config + components/*.md）
> 审计范围：脚本端 `src-vue/**`（含 `style.css`）、客户端 `web/src/**`；`node_modules`/`dist` 不计。
> 方法：读全部规范文档 → 用脚本抽出项目实际使用的 111 个 daisyUI 类名 → 逐个组件比对官方语法与规则 → 人工复核模板结构。

---

## 一、总体结论

**基础和主干完全合规**：主题配置、语义色体系、组件骨架（modal / chat / tabs / list / input / fieldset / swap / progress / toast …）都严格照 `components/*.md` 写，且关键偏离处都在代码注释里写了原因。

**没有 P0/P1 问题**（无失效类名、无结构错乱、无主题失效风险）。发现 **4 项 P2 规范偏离** 与 **6 项 P3 清理项**，全部属于「一致性 / 可维护性」，不影响当前视觉与功能。

| 级别 | 数量 | 说明 |
|---|---|---|
| P0 阻断 | 0 | — |
| P1 功能/视觉缺陷 | 0 | — |
| P2 规范偏离（建议修） | 4 | filter 语义、dropdown 旧写法、markdown 表格、alert 缺 role |
| P3 清理（可选） | 6 | 死代码/死依赖、组件覆写写法、硬编码色、静态内联样式、客户端壳未用 card |

---

## 二、安装与配置（`install/` + `config/`）

| 检查项 | 结论 | 证据 |
|---|---|---|
| daisyUI 5.7.x | ✅ | `daisyui: ^5.7.50`（根 + `web/`） |
| 通过 Tailwind v4 `@plugin "daisyui"` 引入 | ✅ | `src-vue/style.css:17`、`web/src/style.css:26` |
| 主题显式声明 | ✅ | 脚本端 `wireframe --default, business --prefersdark`；客户端 `business --default` |
| 主题挂载点 | ✅ | `data-theme` 写在影子树内 `#app`（官方允许嵌套主题）；`root: ':host'` 是影子树必需的重挂 |
| `exclude: rootscrollgutter` | ✅ | 两处都排除（宿主页不被撑出滚动条占位） |
| 改内置主题只覆盖必要变量 | ✅ | `web/src/style.css:31` 只覆盖 `--color-primary` / `--color-primary-content`，符合 colors 文档「Change a built-in theme」 |
| 组件全局改动用 `@utility` | ⚠️ P3 | `src-vue/style.css:98/105/115/143` 用 `.toggle/.checkbox/.btn/.input` 普通选择器覆写 `--radius-*`，usage 文档给的写法是 `@utility btn { @apply rounded-full }`。功能等价，但属于文档未推荐的方式 |
| `@custom-variant dark` | ⚠️ P3 | `src-vue/style.css:24` 定义了，但全仓已 **0 处** `dark:` 用法 ⇒ 死配置 |
| `tw-animate-css` | ⚠️ P3 | `package.json:56` + `style.css:2` 引入，全仓 **0 处** `animate-in/fade-in/...` ⇒ 死依赖（本项目依赖面极窄，建议删） |

---

## 三、颜色规则（`colors/`）

| # | 规则 | 结论 | 说明 |
|---|---|---|---|
| 1-3 | 语义色即 Tailwind 色彩名、可带透明度修饰、随主题变化 | ✅ | 大量 `bg-base-100 / text-base-content/60 / border-base-300 / text-error` |
| 4 | 不用 `dark:` 配 daisyUI 色 | ✅ | 全仓 0 处 `dark:` |
| 5 | 尽量只用 daisyUI 色名 | ⚠️ P3 | 硬编码：`#ff7875` ×3（`transfer/FilesView.vue:133,194`、`components/media/ImageActions.vue:29`）、`text-white`（同文件）、`ring-[rgb(34,34,34)]`（`web/src/App.vue:113`）、`#1e1e1e`/`#141414`（`web/src/app.css`） |
| 6-7 | Tailwind 色恒色 vs daisyUI 色随主题 | ✅ | 除上条外无 Tailwind 调色板色 |
| 8 | 避免 Tailwind 色做文字 | ✅ | 仅图片预览用 `text-white/70`（图上固定色，属规则 11 允许） |
| 9 | `*-content` 与本体对比清晰 | ✅ | 只用官方主题自带配对，未自造 |
| 10 | 以 `base-*` 为主、`primary` 只用于最重要元素（只用一次） | ⚠️ 有意偏离 | `primary` 类共 15 处（`text-primary` 6、`chat-bubble-primary` 3、`progress-primary` 2、`btn-primary` 2 …）。品牌色贯穿状态图标/进度条/我方气泡，是用户定版设计，非误用 |
| 11 | 极少数需要恒定色时可用 Tailwind 色 | ✅ | 图片预览遮罩上的白字、`font-mono` 日志区 |

---

## 四、用法规则（`usage/` 12 条）

| # | 规则 | 结论 | 说明 |
|---|---|---|---|
| 1 | 加组件类 + 对应 part/modifier | ✅ | 逐组件核对见第五节 |
| 2 | 组件类不够时用 Tailwind 工具类 | ✅ | 广泛且克制（`chat-bubble max-w-[74%]`、`modal-box w-[360px]`） |
| 3 | 必须时才用 `!` 强制 | ✅ | 模板 **0 处** `xxx!`（仅 `main.ts` 对宿主 div 用内联 `!important` 防御页面 CSS，与 daisyUI 无关） |
| 4 | 无对应组件时自己用工具类搭 | ✅ | 传输助手三栏、文件宫格 |
| 5 | flex/grid 布局加响应式前缀 | N/A | 全仓 0 个 `sm:/md:/lg:` —— 面板固定 360px、客户端窗口固定尺寸，响应式前缀无意义；客户端「手机/桌面」两态由 `layoutMode.ts` + CSS 类切换，非断点 |
| 6 | 只用现行类名 | ✅ | 脚本扫描出 111 个 daisyUI 类名（含少量来自注释/变量名的误报），去重核对后**无拼错、无废弃类名** |
| 7 | 不必要就不写自定义 CSS | ⚠️ P3 | `web/src/app.css` 骨架样式（合理，但含硬编码色）、`.scrollbar-thin`（daisyUI `scrollbar` 基础模块已覆盖）、`src-vue/style.css:65-86` 自定义细滚动条（同上）、**10 处静态内联样式**：`AboutDialog.vue:28,32,45,55,59`（`flex:0 0 92px` → `basis-[92px]`）、`ChatComposer.vue:95`（→ `min-h-14 shadow-none`）、`MainPanel.vue:237`（→ `min-h-[46px]`）、`PairPanel.vue:47`（→ `max-w-[560px] mx-auto`）、`FilesView.vue:143,150,164`（→ `grid-cols-[…]`、`aspect-square`） |
| 8 | 占位图用 picsum | N/A | 无占位图（头像是 DiceBear 生成图，非占位） |
| 9 | 不必就不加自定义字体 | ✅ | 系统字体栈 + `font-mono` 日志区，无 webfont |
| 10 | 不必就不给 body 加 `bg-base-100 text-base-content` | ✅ | `body` 未加；`MainPanel` 根 div 加（合理，面板自带底色） |
| 11 | 设计决策参考 Refactoring UI | ✅（人工判断） | 层次靠 `base-100/200/300` + 半透明文字，无刺眼色块 |
| 12 | 未要求变体就用默认 | ⚠️ 有意 | `btn-primary`（发送，唯一主操作）、`btn-error`（清空/删除）语义正确；`btn-outline/btn-ghost` 混用较多但都有层级含义 |

---

## 五、组件结构逐个核查

图例：✅ 与官方语法一致 · ⚠️ 有偏离（附原因）· N/A 未使用

| 组件 | 结论 | 核查要点 |
|---|---|---|
| modal | ✅ | 5 个 `<dialog class="modal">`（`AppDialog` / `DarkDialog` / `ChatWindow` / `PhrasesSheet`(modal-end) / `ImagePreview`）全部 `showModal()/close()` + `.modal-box` + `<form method="dialog" class="modal-backdrop"><button>close</button></form>` |
| modal（图片预览） | ⚠️ 有意 | `ImagePreview.vue:135` 故意不用 `modal-box`/`modal-backdrop`（要满屏出血，避开 `modal-box` 底色/圆角/内边距），已注释；层级靠 `dialog` top layer |
| tab / tabs | ✅ | `<div role="tablist" class="tabs tabs-box"><input type="radio" class="tab" aria-label>`，正是官方 radio 语法 |
| chat | ✅ | `ChatTurn` = `div.chat.chat-start|chat-end` > `chat-image avatar` + 插槽（`chat-header` / `chat-bubble` / `chat-footer`），placement 必填 |
| avatar | ✅ | `chat-image avatar` > `div.w-10.rounded-full` > `img`；尺寸用 `w-*`（官方允许），形状用 `rounded-full` 而非 `mask-*`（Tailwind 工具类，规则 2 允许） |
| list | ✅ | `ul.list` > `li.list-row`；`list-row` 只有 1 个子元素，用 `[grid-template-columns:minmax(0,1fr)]` 覆写默认列宽（已注释） |
| input | ✅ | 单元素直接 `input.input`；带图标时 `label.input` 包裹（多元素用父元素的官方写法） |
| textarea | ✅ | `textarea.textarea`（ChatComposer） |
| toggle | ✅ | `input[type=checkbox].toggle` |
| checkbox | ✅ | `input[type=checkbox].checkbox`（含 `checkbox-sm`） |
| fieldset / label | ✅ | `fieldset` > `legend.fieldset-legend` + 控件 + `p.label` 描述 |
| divider | ✅ | `div.divider`（带文字）；无 `<hr>` 误用 |
| hero | ✅ | `div.hero` > `div.hero-content`（空态） |
| loading | ✅ | `span.loading.loading-spinner.loading-md` |
| progress | ✅ | `progress.progress.progress-*` 且 **value + max 都给了** |
| swap | ✅ | `label.swap.swap-rotate` > `input[type=checkbox]` + `.swap-on` + `.swap-off` |
| theme-controller | ✅ | `input[type=checkbox].theme-controller value="business"`（值合法）。注：`root:has()` 无法穿透影子树，实际主题由 `lib/theme.ts` 驱动，类本身仍是合法用法 |
| tooltip | ✅ | `div.tooltip.tooltip-bottom[data-tip]` 包裹触发器，仅用 placement 修饰 |
| toast | ✅ | `div.toast.toast-top.toast-center` > `div[role=alert].alert.alert-*`（官方堆叠容器 + alert） |
| alert | ⚠️ P2 | `lib/toast.ts` 两端口径都带 `role="alert"` ✅；但 `src-vue/transfer/SettingsDialog.vue:93` 的 `alert alert-error alert-soft alert-vertical` **缺 `role="alert"`**（官方语法要求） |
| menu | ✅ | `ul.menu` > `li` > `button` |
| card | ✅ / ⚠️ | `PairPanel.vue:49` `card` > `card-body` ✅；**客户端窗口壳**（`web/src/App.vue:109-114`）自拼 `flex flex-col bg-black ring-[rgb(34,34,34)]` 未用 `card`（P3） |
| badge | ✅ | `span.badge.badge-sm.badge-outline`（客户端版本号另加 `rounded-full` 做正胶囊） |
| dropdown | ⚠️ P2 | `ChatComposer.vue:101`、`ChatWindow.vue:343` 用 **focus + tabindex** 旧法（`div.dropdown` > `[role=button][tabindex]` + `ul.dropdown-content`），并靠 JS `blur()` 收起。官方 skill 只列 **popover API** 与 **details/summary** 两种语法 |
| filter | ⚠️ P2 | `LogDialog.vue:112` 用 `form.filter` 装 **checkbox** + 一个普通 `button`（「全部」）。filter 官方定义是 **radio 组 + `filter-reset`**；多选筛选其实不该套 filter 组件 |
| table | ⚠️ P2 | `transfer/markdown.ts:249` 的 Markdown 表格用 `h('table', { style: { borderCollapse, fontSize } })` + 逐格内联 `padding/border/background`，未用 `table` / `table-xs` 组件类 |
| drawer | N/A | 右侧弹层用 `modal-end`（官方 placement），注释里说明了不用 drawer 的原因 |
| join / indicator / kbd / stat / steps / timeline / navbar / dock / fab / mask / skeleton / status / rating / otp / range / select / calendar / carousel / collapse / accordion / breadcrumbs / mockup / diff / hover-* / aura | N/A | 未使用 |

---

## 六、问题清单（按优先级）

### P2 — 建议修（4 项）

| # | 位置 | 现状 | 建议 |
|---|---|---|---|
| 1 | `src-vue/transfer/SettingsDialog.vue:93` | `alert` 缺 `role="alert"` | 补 `role="alert"`（与 `lib/toast.ts` 一致） **— ✅ 已在 v26.10.20-v20 修复** |
| 2 | `src-vue/panel/LogDialog.vue:112-133` | `form.filter` + checkbox + 普通 button | 二选一：① 改回官方语义（radio + `filter-reset`，但会变成单选，丢失「多类型同时看」）② 保留多选但去掉 `filter` 组件类，用 `join`/`btn` 组自拼（推荐 ②，行为不变且不再冒用组件语义） |
| 3 | `ChatComposer.vue:101`、`ChatWindow.vue:343` | focus + tabindex 式 dropdown，JS `blur()` 收起 | 改 `<details class="dropdown">` + `<summary class="btn">`（官方语法，零 JS 收起逻辑）；或 popover API（需 Chrome 114+，**超出 Chrome 88 基线**，不推荐） |
| 4 | `transfer/markdown.ts:249` | Markdown 表格用内联样式 | 表格加 `table table-xs`，边框/表头色改用 `border-base-300` / `bg-base-200`（气泡内需对比度的场景保留 palette 变量即可） |

### P3 — 清理（6 项）

| # | 位置 | 现状 | 建议 |
|---|---|---|---|
| 5 | `src-vue/style.css:98-153` | `.toggle/.checkbox/.btn/.input` 覆写 `--radius-*` + 硬编码品牌蓝/绿（`rgb(67,116,186)`、`rgb(53,210,141)`） | 改用 `@utility btn { --radius-field: 9999px }` 等官方写法；品牌色收敛成主题变量（`@plugin 'daisyui/theme'` 覆写 `--color-primary`） |
| 6 | `web/src/style.css:45-51` | `--tw-*` 五个变量**已无任何消费方**（`ChatComposer` 已改 daisyUI 组件），注释还引用已删除的 `src-vue/transfer/theme.ts` | 整块删除 + 修注释 **— ✅ 已在 v26.10.20-v20 修复** |
| 7 | `src-vue/style.css:24`、`package.json:56` | `@custom-variant dark` 与 `tw-animate-css` 均为死配置/死依赖 | 删除（依赖面收窄符合项目「新增 npm 依赖默认不批」的取向） **— ✅ 已在 v26.10.20-v20 修复** |
| 8 | `web/src/app.css`（`html,body` 与 `.znhd-phone-chat`、`.znhd-window-layer`） | 骨架定位（fixed + visualViewport 变量）**必要且合理**；但底色/文字色写死 `#1e1e1e` / `#141414` / `rgba(255,255,255,.9)`，绕过主题令牌 | 改用 `bg-base-100` / `bg-base-200` / `text-base-content`（或落到 `--color-*` 变量）。自定义细滚动条本身可保留 —— daisyUI 的 `scrollbar` 基础模块只给 `scrollbar-color`，不给 `scrollbar-width: thin` |
| 9 | 10 处静态内联样式 | 见第四节第 7 条清单 | 改 Tailwind 任意值类（`basis-[92px]` / `min-h-14` / `aspect-square` / `grid-cols-[repeat(auto-fill,minmax(96px,1fr))]`） **— ✅ 已在 v26.10.20-v20 修复（10 处静态内联样式已清零，仅余动态 `:style`）** |
| 10 | `web/src/App.vue:109-114` | 窗口壳自拼 flex 容器 + `bg-black` + `ring-[rgb(34,34,34)]`，未用 `card` | 若保留纯黑微信风，至少把描边/底色换成主题变量（`--color-base-300`）；或改用 `card` + `card-body`（需重排三段结构） |

---

## 七、建议修复顺序

1. **第一批（零视觉风险，可立即做）**：#1 role、#6 死变量、#7 死配置/死依赖、#9 内联样式等价改写。
2. **第二批（有轻微视觉差异，需浏览器复核）**：#5 `@utility` 重写、#8 滚动条与硬编码底色、#10 客户端壳色板语义化、#4 表格组件化。
3. **第三批（交互实现变更，需回归冒烟）**：#2 filter、#3 dropdown。

> 每批改完照旧跑 `typecheck / lint / build / verify`；触及 `src-vue/transfer/**` 或 `src-vue/components/**` 必须 `npm run build:web` 并 bump relay 版本。
