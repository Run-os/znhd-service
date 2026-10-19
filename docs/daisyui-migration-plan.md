# daisyUI 全量迁移计划

> 状态：**待评审**。评审通过并确认第五节之前，不修改任何业务代码。
> 依据：daisyUI 官方 skill（`.agents/skills/daisyui`，v5.7.x）+ 对本仓库的实际扫描。
> 所有组件写法以 `skill/components/*.md` 为准，不凭印象手写类名。

---

## 一、范围

| 项 | 现状 | 迁移后 |
|---|---|---|
| UI 组件 | 24 组 shadcn-vue，113 个 `.vue`、139 个文件 | 删除，改为 daisyUI 类名 + 约 8 个薄包装 |
| 业务页面 | 21 个 `.vue` | 全部改用 daisyUI 类 |
| 主题 | `@theme` 自定义令牌，日间白蓝 / 夜间黑绿 | 官方 `wireframe`（日）/ `business`（夜） |
| 运行时依赖 | `reka-ui`、`class-variance-authority`、`clsx`、`tailwind-merge`、`vue-sonner`、`@lucide/vue` | 仅 `daisyui`（devDep）+ `@lucide/vue`（图标） |

---

## 二、主题方案（用户已指定）

### 2.1 配置（`src-vue/style.css`）

```css
@import 'tailwindcss';
@plugin 'daisyui' {
  themes: wireframe --default, business --prefersdark;
  root: ':host';
  exclude: rootscrollgutter;
}
```

- `root: ':host'`：daisyUI 默认把主题变量挂在 `:root`，但本项目的 CSS 是 `?inline` 注入 **shadowRoot**，`:root` 在影子树内匹配不到 → 必须改成 `:host`。**这一项是硬要求，否则整站无色**。
- `exclude: rootscrollgutter`：daisyUI 会给根元素加滚动条占位，宿主是第三方税务页，必须排除，否则会让宿主页面横向抖动。

### 2.2 主题切换

现有 `main.ts` 用 `document.documentElement.classList.toggle('dark')` + `:host(.dark)`。迁移后改为：

```ts
// 影子树内的挂载点加 data-theme，而不是 class
hostEl.dataset.theme = isDark ? 'business' : 'wireframe';
```

同时 `@custom-variant dark (&:where([data-theme=business], [data-theme=business] *))`，供少量仍需 `dark:` 的布局微调使用。

### 2.3 实测色值（已从官方主题文件读取）

| 令牌 | wireframe（日） | business（夜） |
|---|---|---|
| `--color-base-100` | `oklch(100% 0 0)` 纯白 | `oklch(24.35% 0 0)` 深灰 |
| `--color-base-200` | `oklch(97% 0 0)` | `oklch(22.65% 0 0)` |
| `--color-base-300` | `oklch(94% 0 0)` | `oklch(20.94% 0 0)` |
| `--color-base-content` | `oklch(20% 0 0)` | `oklch(84.87% 0 0)` |
| `--color-primary` | **`oklch(87% 0 0)` 浅灰** | `oklch(41.7% 0.099 251)` 暗蓝 |
| `--color-primary-content` | `oklch(26% 0 0)` | `oklch(88.3% 0.019 251)` |
| `--radius-selector` | `0rem` | `0rem` |
| `--radius-field` / `--radius-box` | `0.25rem` / `0.25rem` | 同 |
| `--depth` | `0` | `0` |

**⚠️ 三个必须确认的视觉后果：**

1. **wireframe 没有品牌主色。** `primary` / `secondary` / `accent` / `neutral` 四个令牌全是同一个浅灰 `oklch(87% 0 0)`。这意味着日间模式下 `btn-primary` 和普通 `btn` 几乎无法区分，全站没有蓝色强调，只剩 `info/success/warning/error` 四个语义色有彩度。这是"线框图"主题的设计本意。
2. **两个主题都是 `--depth: 0` + 方角。** 卡片、弹窗、下拉全部**没有阴影**，靠 `base-300` 边框分层。现在 `card` / `dialog` 的柔和投影会消失。
3. **`transfer/theme.ts` 的微信绿覆盖仍然可用。** daisyUI 的颜色同样是 CSS 变量，在窗口根节点覆盖 `--color-primary` / `--color-primary-content` 依然生效——但要把 `primary-foreground` 改名为 `primary-content`。

---

## 三、组件映射（依据 skill 文档逐条核对）

### 3.1 直接替换（11 组）

| shadcn | daisyUI | 写法要点（skill） |
|---|---|---|
| `button` | `btn` | `btn-outline` / `btn-ghost` / `btn-secondary` / `btn-error` / `btn-link`；尺寸 `btn-xs/sm/lg`，图标按钮用 `btn-square` |
| `input` | `input` | 与 `fieldset` + `label` 组合 |
| `textarea` | `textarea` | 同上 |
| `label` | `label` | fieldset 内作为描述文字 |
| `badge` | `badge` | 颜色 `badge-primary` 等 |
| `avatar` | `avatar` | 内部 `<div class="w-8 rounded-full">` |
| `progress` | `progress` | `progress-primary` + `value`/`max` |
| `separator` | `divider` | 水平/垂直由 `divider-horizontal` 控制 |
| `spinner` | `loading` | `loading-spinner` + `loading-xs/sm/md` |
| `checkbox` | `checkbox` | `checkbox-primary` |
| `switch` | `toggle` | `toggle-sm` 等 |

### 3.2 需要薄包装（4 组，约 200 行）

| shadcn | daisyUI | 包装原因（skill 语法约束） |
|---|---|---|
| `dialog` | `modal` + `<dialog>` | skill 要求 `dialog` 元素 + `<form method="dialog">` 关闭；Vue 里需要 `ref.showModal()/close()` 的 `v-model:open` 包装 |
| `dropdown-menu` | `dropdown` + `menu` | skill 规定 popover 方式**只能用 `<button>` + `dropdown`，不能用 `dropdown-content`**；`id` 与 `anchor-name` 必须同名且唯一 → 每个实例需要生成唯一 id |
| `tabs` | `tabs` + `tab` + `tab-active` | 用 `role="tablist"` + `<button role="tab" class="tab tab-active">` 可保持受控 v-model，不必改成 radio |
| `sonner` | `toast` | toast 只是定位容器，**没有命令式 API**，需要自写 `toast.success()` 队列（约 30 行） |

### 3.3 无对应组件（**需你决策**）

| shadcn | 实际情况 | 我的建议 |
|---|---|---|
| `message`（6 子组件：Message/Content/Header/Footer/Avatar/Group） | `chat` 只覆盖气泡+头像+头尾，**没有 MessageGroup 的消息分组语义** | 用 `chat` + 手写分组容器 |
| `message-scroller`（307 行：`ResizeObserver`、`autoscrolling` 贴底、`scrollToStart/End`） | **daisyUI 完全无对应** | **原样保留**为布局组件，内部不套 daisyUI 类 |
| `empty`（6 子组件） | 无 | 用 `hero` 包一层？还是手写 flex 空态区？ |
| `item`（10 子组件） | `list-row` 只覆盖"一行 + 主内容自适应" | 降级为 `list-row`，丢失 ItemSeparator/ItemActions 结构 |
| `field`（11 子组件） | `fieldset` + `label` + `validator` 覆盖约七成 | 缺 `FieldGroup` / `FieldSeparator`，需手写 |
| `bubble` | `chat-bubble` + `chat-start/end` + 颜色变体 | 基本可对应，`BubbleReactions` 需手写 |
| `marker`（Marker/Content/Icon） | 无 | 手写，或改用 `divider` + 文字 |
| `sheet`（局部抽屉，非整页） | 只有整页 `drawer` 和 `modal-bottom` | 建议改用 `modal modal-bottom` |
| `tooltip` | `tooltip` + `data-tip` | **仅 hover 触发，方向手写死，触屏无效**；项目有 6+ 处挂在图标按钮上 |

---

## 四、执行阶段

### P0 基建（不动业务代码）
1. `npm i -D daisyui@latest`
2. 改 `src-vue/style.css`：加 `@plugin`、删 `@theme` 里的 shadcn 令牌块、改 `@custom-variant dark`
3. 改主题切换逻辑（`classList.toggle('dark')` → `dataset.theme`）
4. 起一个空白面板，确认 shadowRoot 内 `bg-base-100` 生效、两主题可切
5. **验收**：`npm run dev:vue` 里一个测试块，切换日夜时背景/文字色正确

### P1 原子组件（11 组）
按"使用频次"顺序改：`button`(18) → `input`(6) → `card`(4) → `switch`(4) → `input-group`(4) → `badge`/`avatar`/`progress`/`checkbox`/`divider`/`spinner`
> `input-group` 映射到 `join`，需 4 处（PhrasesSheet / ChatComposer / 两个 SettingsDialog）

### P2 复合组件（4 组包装）
`modal` 包装 → `dropdown` 包装 → `tabs` → `toast`
**验收**：`npm run verify:vue` 的 dialog / dropdown / toast 断言通过

### P3 业务页（17 个文件，按依赖顺序）
1. `panel/MainPanel.vue`（入口，依赖最多）
2. `panel/AppDialog` → `SettingsDialog` → `LogDialog` → `ChangelogDialog` → `PhrasesSheet`
3. `sniff/SniffDialog.vue`
4. `transfer/ChatWindow` → `ChatTurn` → `ChatBubble` → `ChatComposer` → `PairPanel` → `FilesView` → `AboutDialog` → `DarkDialog`

### P4 清理
1. 删除 `src-vue/components/ui/`（139 文件）
2. 删除 `scripts/vendor-shadcn-vue.mjs`、`components.json`、`package.json` 的 `vendor:ui`
3. 移除依赖：`reka-ui`、`class-variance-authority`、`clsx`、`tailwind-merge`、`vue-sonner`、`tw-animate-css`
4. 更新 `scripts/smoke/vue-panel.js` 的选择器
5. 更新 `AGENT.md` / `ReadMe.md` 的技术栈描述

---

## 五、需要你确认的 9 个点

| # | 问题 | 选项 |
|---|---|---|
| 1 | wireframe **没有品牌主色**，日间主按钮是浅灰、全站无蓝色强调 | A 接受 / B 换主题 / C 用 `@plugin "daisyui/theme"` 局部覆盖 primary |
| 2 | `message-scroller` 无对应（307 行滚动逻辑） | A 原样保留 / B 手写简化版 |
| 3 | `empty` 无对应 | A 手写 flex 空态 / B 用 `hero` |
| 4 | `item` 10 子组件 → `list-row` 覆盖六成 | A 降级 / B 保留结构手写 |
| 5 | `field` 11 子组件 → `fieldset` 覆盖七成 | A 降级 / B 保留 FieldGroup |
| 6 | `sheet` 局部抽屉 → 只有整页 `drawer` | A 改 `modal-bottom` / B 用 `drawer` |
| 7 | `sonner` → `toast` 无命令式 API | A 自写队列 / B 换第三方 |
| 8 | `tooltip` 只支持 hover，触屏无效 | A 接受 / B 保留 reka tooltip |
| 9 | `message` 的 MessageGroup 分组语义 | A 手写 / B 不做分组 |

---

## 六、验证与回滚

- 开工前打 tag：`git tag pre-daisyui-migration`
- 全部改动在一个分支上，P0/P1/P2 各自可独立回滚
- 每阶段跑：`npm run typecheck:vue`、`npm run verify:vue`、`npm run build`
- 体积预期：`dist/znhd.user.js` 从 1013K 预计降到 700–800K（去掉 reka-ui 与 113 个组件源码，增加 daisyUI CSS 约 20–30K）

## 七、明确不做的事

- 不改 `relay-server/` 与 `web/`（手机上传页，不在本次范围）
- 不改业务逻辑、状态管理、WebSocket 协议
- 不为"好看"而手写自定义 CSS；daisyUI 类不够用时优先 Tailwind 工具类（skill usage 规则 2/3）
- 不引入 `tailwind.config.js`（Tailwind 4 已废弃，skill install 规则 2）
