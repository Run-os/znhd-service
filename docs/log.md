# 运行日志 · 技术说明

> 面向 AI / 开发者。使用步骤见 [log-guide.md](log-guide.md)。
> 最后核对：2026-10-28（v26.10.27-v3）。

## 1. 职责与边界

- 全局单例日志总线：任何模块 `addLog(msg, type)` 即入列，UI 侧 `LogDialog` 只做展示。
- **只在内存里**：`logEntries` 是 `DialogHost.vue` 的 `ref`，刷新页面/重载脚本即清零，**不落盘**（唯一持久化的是「自动刷新」开关）。
- 边界：不做日志聚合/上报、不写 localStorage、不做时间戳格式化以外的时间处理。

## 2. 模块地图

| 文件 | 关键导出 | 作用 |
|---|---|---|
| [`src/lib/logger.ts`](../src/lib/logger.ts) | `addLog()` / `addLogDebounced()` / `clearLogs()` / `setLogEntriesSink()` / `LogEntry` / `LogType` | 单例写入管线 + 去重窗口 + 上限裁剪 |
| [`src-vue/panel/LogDialog.vue`](../src-vue/panel/LogDialog.vue) | 默认导出组件 | 纯展示：类型筛选、冻结快照、滚底 |
| [`src-vue/panel/DialogHost.vue`](../src-vue/panel/DialogHost.vue) | — | 持有 `logEntries` ref；挂载时 `setLogEntriesSink(...)`、卸载时 `setLogEntriesSink(null)`；持久化 `logAutoRefresh` |
| [`src/lib/constants.ts`](../src/lib/constants.ts) | `CONFIG.MAX_LOG_ENTRIES = 20`、`DEFAULTS.logAutoRefresh = true` | 上限与开关默认值 |
| [`src/lib/state.ts`](../src/lib/state.ts) | `runtime.logAutoRefresh` | 开关的内存镜像（避免每帧读 localStorage） |

## 3. 数据流

```
addLog(msg, type, logenabled?)
  ├─ timestamp = new Date().toTimeString().slice(0, 8)      // HH:MM:SS
  ├─ 去重：recentLogMessages(窗口 5 条) 里出现过 ⇒ console 提示后 return
  ├─ 推入窗口并滚动丢弃最旧（> 5 条 shift）
  └─ setLogEntriesCallback(prev => [item, ...prev] 超 20 条 pop())
       └─ DialogHost.logEntries（ref，最新在前）
            └─ LogDialog.shown = source.filter(类型勾选)
                 └─ rows = shown.slice().reverse()           // 视觉：最旧在上
```

**写入顺序是「最新在前」**，`LogDialog` 渲染前 `slice().reverse()` 成「最旧在上、最新在下」，因此容器用 `flex-col` 而**不是** `column-reverse`（后者会翻转滚动原点与阅读方向）。任何直接在 `logEntries` 上做 `reverse()`/`sort()` 的改动都会污染源数组。

## 4. 关键实现细节

- **去重窗口是 5 条滚动窗口，不是「只比上一条」**：3 秒轮询类日志（「找不到人数元素」）会与其它日志交错出现，只比上一条等于没去重。
- **去重按 `message` 纯文本**，与 `type`/时间无关 ⇒ 同样的文案换类型也会被吞。
- **`clearLogs()` 必须连 `recentLogMessages` 一起清**：否则清空后同样内容被去重静默丢弃，用户会以为「清空之后不再记日志」。
- **`--enable` 语义（第三参 `logenabled`）**：默认 `false`，只进面板不进控制台；高频轮询类消息传 `true` 会污染控制台，只有少数诊断点开。
- **`setLogEntriesSink()` 用函数注入而不是导出一个可写变量**：ES module 的 import 绑定只读，调用方无法赋值。卸载时必须传 `null`，否则模块单例持有已销毁组件的 ref 更新函数。
- **`addLogDebounced(key, msg, type)`**：同一 `key` 400ms 内只保留最后一次。用于逐字输入类设置项（如填地址）——每键一条会瞬间刷满 20 条上限，只剩中间态。
- **筛选状态唯一事实源是 `filter`（四个布尔）**，「全部」是 `allMode = TYPES.every(...)` 的派生状态。历史上曾是「四布尔 + 独立 allMode」两套状态，`toggleType` 里写反导致勾选后 `allMode` 变 true、筛选完全不生效。
- **冻结快照**：`autoRefresh` 由 true→false 的瞬间把 `props.logEntries` 存进 `snapshot`，此后 `source` 切到快照。若只切 `source` 不存快照，列表会立刻清空。
- **滚底条件 `open && autoRefresh`**：冻结态不滚动是正确行为，别为了「打开就看最新」去掉 `autoRefresh` 判断。

## 5. 存储与配置

| 项 | 键 / 位置 | 说明 |
|---|---|---|
| 自动刷新开关 | `localStorage` 键 `scriptCat_Allvalue` 的 `logAutoRefresh` | 默认 `true`；`DialogHost.patchAllvalue()` 落库并同步 `runtime` |
| 日志条目 | 组件内存（`DialogHost.logEntries`） | **不持久化**，刷新即空 |
| 上限 / 去重窗口 | `CONFIG.MAX_LOG_ENTRIES = 20` / `RECENT_LOG_COUNT = 5`（logger.ts 内私有） | 只读代码常量 |

## 6. 失败模式与日志

| 情况 | 表现 |
|---|---|
| `sink` 未注入（DialogHost 未挂载 / 已卸载） | `addLog` 静默丢弃（只保留去重窗口副作用）；面板看不到任何新日志 |
| 去重把关键日志吞掉 | 控制台仍有 `[监控] 重复日志，已忽略: …`（**这条是无条件打印的**，是排查「日志去哪了」的第一落点） |
| 20 条上限 | 最旧的被 `pop()`，`LogDialog` 底部状态栏「共 N 条」永远 ≤ 20 |
| 筛选后空列表 | 文案区分三种：「暂无日志」/「没有符合当前筛选条件的日志」/「未选择任何类型」 |

## 7. 改动须知（坑）

- 别改「最新在前 + 渲染时 reverse」这套约定；也别在 `LogDialog` 里对 `source` 原地排序。
- 别把 `MAX_LOG_ENTRIES` 调大来解决「日志不够看」——20 条是为 360px 高面板定的；要看全量请开控制台。
- 新增高频日志先想清楚去重：同文案会被 5 条窗口吞；不同文案会刷屏挤掉关键行。逐字变化用 `addLogDebounced`。
- `logEntries` 是**组件内 ref**，别在 `logger.ts` 里另存一份副本（两份状态必然不同步）。
- 类型着色全部走主题语义色（`text-info/success/warning/error` + `border-l-*`），不要在模板里写死 hex。

## 8. 冒烟覆盖

`scripts/smoke/vue-panel.js`：

- `logDialogOk` —— 标题「运行日志」、≥3 行、终端底色 = `--color-neutral`、自动刷新开关、筛选行（4 个 checkbox + 可见的「全部」按钮）；内含墓碑子项 `footerGone`（旧版页脚 `.modal-action`「关闭」按钮不得回来）。
- `logFilterOk` —— 点单个类型 → 该类型取消、「全部」变灭；点「全部」两次 → 全灭 / 全亮，验证「唯一事实源 + 派生 allMode」没有退回两套状态。
- `noPageError` —— 页面无脚本自身报错。

日志的写入管线（`addLog` 去重/上限）不进无头断言：它依赖 sink 注入、无 DOM 行为，属于纯逻辑，改它请靠反向验证而非冒烟。
