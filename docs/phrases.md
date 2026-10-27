# 常用语 · 技术说明

> 面向 AI / 开发者。使用步骤见 [phrases-guide.md](phrases-guide.md)。
> 最后核对：2026-10-28（v26.10.27-v3）。

## 1. 职责与边界

读取**本页右侧栏「常用话术」**（会话人信息 tab 内），在独立侧滑弹窗里展示 / 搜索 / 一键填入。与坐席在页面里维护的话术永远一致，**零网络请求**（本地有缓存时）。

边界：不维护第二份数据；「飞书快捷短语」是另一条链路（见 [quick-reply.md](quick-reply.md)），两者只共用 TinyMCE 写入函数。

## 2. 模块地图

| 文件 | 关键导出 | 作用 |
|---|---|---|
| [`src/lib/phrasesZnhd.ts`](../src/lib/phrasesZnhd.ts) | `readPhrasesFromZnhd(): Promise<ZnhdPhrases>` | 程序化抓取右侧栏（唯一的抓取实现） |
| [`src/lib/storage.ts`](../src/lib/storage.ts) | `loadPhrasesCache()` / `savePhrasesCache()` | `localStorage` 键 `scriptCat_PhrasesCache`（`{time, data:{all,mine}}`） |
| [`src-vue/panel/PhrasesSheet.vue`](../src-vue/panel/PhrasesSheet.vue) | — | 侧滑弹窗 UI（`modal modal-end` 360px）：tabs / 搜索 / 卡片 / 悬停全文 |
| [`src-vue/panel/DialogHost.vue`](../src-vue/panel/DialogHost.vue) | — | 开窗时无缓存则调 `readPhrasesFromZnhd()`，`reload(true)` 强制重抓 |
| [`src/lib/tinymce.ts`](../src/lib/tinymce.ts) | `appendToTinyMCE()` | 点卡片后的写入（见 §5） |
| [`src/lib/clipboard.ts`](../src/lib/clipboard.ts) | `safeCopyText()` | 复制（GM_setClipboard 优先，降级 navigator.clipboard） |

## 3. 抓取链路（readPhrasesFromZnhd）

```
进会话页面 → 右侧栏存在
  → 合成 MouseEvent 点 TDesign tab → 切到「常用话术」
  → expandAllFolders()：每轮把「未展开文件夹」逐个点 span.t-folder-icon，
     上限 12 轮；上轮与本轮未展开数相同 ⇒ 点击未生效，早退（防死循环）
  → extractGroups()：.verbal-trink-main 下 .auxiliary-item = 全部话术；
     .main 下 .auxiliary-item = 我的话术
  → 切回「会话人信息」tab（任何一步失败也先切回再抛错）
```

- Vue 的 `@click` 监听合成事件 ⇒ `dispatchEvent(new MouseEvent('click'))` 即可驱动 TDesign，无需真实鼠标。
- **展开触发器是 `span.t-folder-icon`**（`trigger="expand"`），点 `.t-tree__label` 无效——首版踩过「秒失败」的坑。
- 文件夹 vs 叶子的判据：叶子 = `.t-tree__item.custom-rich-node`（其内的 `.t-folder-icon` 是空占位，**不能**用「有无 folder-icon」区分）。
- 性能约束：宿主低配实机，步进等待 300–500ms 短轮询，**绝不做组件树递归扫描**（曾把页面压崩）。

## 4. 缓存与触发时机

- 键 `scriptCat_PhrasesCache`，结构 `{time, data:{all,mine}}`，**无 TTL**：本地有缓存就零请求直读；只有「无缓存的开窗」与「手动刷新」才回源。
- 强制重抓 = 弹窗标题旁刷新按钮 → DialogHost `reload(true)`。
- 缓存结构非法（JSON 坏、缺数组）→ `loadPhrasesCache()` 返回 null，静默回源。

## 5. 写入输入框

`pick(text)`：`safeCopyText` → 关弹窗 → `appendToTinyMCE(text)` → 日志 + toast「添加文本: …」。

`pick(text)` 的三个副作用（改点击逻辑时别漏）：① `safeCopyText()` 复制（`GM_setClipboard` 优先，降级 `navigator.clipboard`）；② `playDidaSound()` 播提示音（`CONFIG.didaUrl` 指向 `dida.mp3`，**复用同一个 `Audio` 实例**避免重复解码，`volume 0.5`，地址为空或播放失败静默——不阻断填词）；③ 关弹窗后再写输入框。三者都在 [`src/lib/clipboard.ts`](../src/lib/clipboard.ts)。

`appendToTinyMCE`（`src/lib/tinymce.ts`）是**纯 JS API、无 DOM 兜底**：`tinymce.activeEditor` → 选区折到正文末尾 → `insertContent()`（转义后换行转 `<br>`，已有内容时前置 `<br>` 续行）→ `updateText()` 同步 Vue 的 `msg`。三条实测铁律见 [tinymce-send-doc.md](tinymce-send-doc.md)。

⚠️ 与快捷短语的差别：常用语 = **追加**（`appendToTinyMCE`）；快捷短语 = **整体替换**（`replaceToTinyMCE`）。写文档 / 改文案时别混。

## 6. UI 实现要点（PhrasesSheet.vue）

- 弹层用 `modal modal-end`（右侧贴边）而非 `drawer`：drawer 是整页 grid 三件套，套局部面板会撑布局。
- tabs = 官方 radio 式 `tabs-box`，`flex-1` 等分整宽、`--tab-height:2rem` 压到与搜索框同档。
- 卡片 3 行截断（`line-clamp-3`）；**长话术提示是自定义浮层**（`dialog` 直接子节点 + `position:fixed`），不能用 daisyUI `tooltip`/`data-tip`——伪元素落在 `.modal-box` 内会被它的 overflow 裁掉（实测只剩一条残影）。
- `useNativeDialog` 统一开合同步；关窗钩子里收起悬停提示。

## 7. 失败模式与日志

| 情况 | 现象 / 日志 |
|---|---|
| 未进会话（右侧栏不存在） | 「等待「…」超时（8000ms）——是否已进入会话页面？」error |
| 站点改版动话术树 | 「没有读到任何条目」或抓到 0 条；改 `phrasesZnhd.ts` 的三个选择器（`t-folder-icon` / `.t-tree__item--open` / `.auxiliary-item`） |
| 展开点击不生效 | 早退保护触发，返回已展开到的部分 |
| TinyMCE 未就绪 | toast「输入框未就绪」类提示，不静默丢内容 |

## 8. 改动须知（坑）

- 合成事件**绝对不能传 `view: window`**：油猴沙箱的 `window` 是代理对象，构造即抛；沙箱里这类异常永不暴露 ⇒ 假绿。统一用 `phrasesZnhd.ts` 的 `clickEl()`。
- 抓取期间右侧栏会被脚本切换 tab——文档与提示都要保留「请勿操作」的说法。
- 缓存无 TTL 是**刻意的**（话术低频变化 + 零请求体验），别当 bug 加过期时间；要 freshness 走刷新按钮。

## 9. 冒烟覆盖

`scripts/smoke/vue-panel.js`：`phrasesSheetOk`（弹层结构）、`phrasesTabsGeomOk`（两 tab 等宽）、`phrasesCardOk`（卡片 + 无旧输入栏）、`phrasesClampOk`（3 行截断）、`phrasesHoverOk`（悬停抬色规则）、`phrasesTipOk` / `phrasesTipHideOk`（悬停全文浮层出现/收起）、`toastOk`（点击反馈）。
