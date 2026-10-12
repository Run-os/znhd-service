# src/lib/** 精简评审（2026-10-12）

> 触发：用户提问 m00002 ——「帮我看下 src/lib/** 业务逻辑，这部分代码是否存在可精简的地方，我的功能十分简单，按道理不应该使用这么多行代码才对」。
> 方式：4 个独立上下文 reviewer 分别通读 `src/lib/sniffer.ts`、`src/lib/relay.ts`、`src/lib/agent/**`、`src/lib/ui/**`（只读，未改任何文件），Lead 通读其余模块并实测量级。
> 状态：**纯分析，未修改任何代码，未跑构建**。

---

## 0. 一句话结论

`src/lib` 的 9457 行里 **62% 是 React + antd 的界面层**，另有 **20.6% 是决策注释**，真正「业务逻辑代码」只有约 1800 行。
**不存在死代码**（全量扫描 0 处），所以行数多不是「写了没用的东西」，而是**这个插件在宿主页里塞了一个完整的 React 应用**。
可安全压缩的量级是 **≈ 300–450 行（3–5%）**，其中约 250 行是零行为变化项。**期待「砍掉一半」是不现实的**，能砍的一半以上集中在 UI 共享层和样板去重。

---

## 1. 量级基线（实测，非估计）

| 分组 | 文件数 | 总行 | 代码行 | 注释行 | 空行 | 注释占比 |
|---|---|---|---|---|---|---|
| `src/lib/ui/**` | 20 | 5825 | 4530 | 978 | 317 | 16.8% |
| `src/lib/agent/**` | 3 | 854 | 576 | 189 | 89 | 22.1% |
| `src/lib/` 其余（核心逻辑） | 14 | 2778 | 1804 | 778 | 196 | **28.0%** |
| **合计** | **37** | **9457** | **6910** | **1945** | **602** | **20.6%** |
| （对照）`shared/**` | 6 | 435 | 239 | 165 | 31 | 37.9% |

- 注释 1945 行中：块注释/JSDoc **1581 行**、`//` 364 行；**JSDoc 块共 453 个**（平均 3.5 行/块）。
- 前 14 大文件（实测含空行）：`MainPanel.tsx` 860、`agent/AgentModal.tsx` 844、`sniffer.ts` 795、`PhoneModal.tsx` 700、`relay.ts` 625、`SniffModal.tsx` 576、`RecvHistoryModal.tsx` 459、`agent/api.ts` 392、`agent/types.ts` 345、`ui/panelHost.tsx` 319、`ui/icons.tsx` 291、`ui/agent/TaskPanel.tsx` 286、`ui/LogModal.tsx` 259、`monitor.ts` 214。
- 全 `src/` 9628 行 ⇒ `lib` 之外的入口层（`app.ts` 等）仅约 171 行，装配层本身已经很薄。
- **死代码扫描**：对 `src/**` 内 51 个「无外部引用」的导出逐个核对，**真正无人引用的为 0**；其余是「只在本文件使用却仍写了 `export`」（`sniffer.ts:142,194`、`ui/panelHost.tsx:77,104`、`ui/SniffModal.tsx:79`、`relay.ts:54-55` 等），只收窄 API 面，不减行。

---

## 2. 为什么会有这么多行（三个根因，都有证据）

**根因 A：界面层占了 62%，而「简单功能」的重活都在界面上。**
`src/lib/ui/**` 5825 行 = 10 个弹窗/抽屉 + 1 个主面板 + 拖拽宿主 + 图标集 + 样式隔离层。用户感知到的「功能」是 8 条，但每条都要一套 React 状态 + antd 组件 + 弹窗层级处理。平均下来核心逻辑只有 ~225 行代码/功能，这个密度并不算失控。

**根因 B：注释是决策日志，占 20.6%（核心逻辑里 28%）。**
`sniffer.ts:1-42` 的头部、`relay.ts` 的 CSP/手势段落、`panelHost.tsx:1-60`、`uiReset.ts` 全部在记录「**为什么不能那样写**」：税局页 CSP 禁 fetch、`clipboard.write()` 一旦失败也要重试会必然 `NotAllowedError`、老中继没有 `/health`、面板没有错误边界所以一颗异常会整块消失。这些是已修 bug 的固化，**删掉不减少真实复杂度，只减少可维护性**。

**根因 C：防御性代码密度高，且多数是必须的。**
`try/catch` 兜底、`iconst instanceof` 判型、协议降级、`ignoreGlobalStyles`、回调 ref —— 每条都能追到一次线上问题。4 份报告各自列出的「不要动」清单（合计约 60 条）基本都是这一类。

---

## 3. 可精简清单

### P0 —— 零行为变化 / 唯一一处真死代码（≈ 250 行）

| # | 位置 | 问题 | 省行 | 风险 |
|---|---|---|---|---|
| A1 | `src/lib/sniffer.ts:483-500`、`:685-688`、`:298-338` | **内联 SVG 整条路是死代码**：`:484-500` 把每个 `<svg>` 序列化成 `data:image/svg+xml,…` 并经 `:495` 的 `add()`；但 `:409` 的 `isExcludedName(sniffFileName(...))` 按 `.svg` 后缀（`constants`→`:129/:139`）直接丢弃，`:432` 产出的 kind 只有 `data/blob/http`，`'svg'` 永不产生 ⇒ `:685-688` 分支死、`svgDims/serializeSvg` 无调用方 | **~45** | 低（**唯一被判定为真死的路径**；删前先确认 `EXCLUDED_NAME_SUFFIXES` 里 `.svg` 是用户 2026-10-10 拍板的规则） |
| A2 | `ui/LogModal.tsx:150-153`、`ui/PhoneModal.tsx:455-458`、`ui/SettingsModal.tsx:88-92`、`ui/ChangelogModal.tsx:54-57`、`ui/RecvHistoryModal.tsx:417-420`、`ui/RecvTextModal.tsx:38-41`、`ui/SniffModal.tsx:428-431`（`ui/PhrasesDrawer.tsx:59-61` 同构） | 7 处逐字重复 `getContainer={getOverlayContainer}` + `styles={{body:{textAlign:'left'}}}` + `destroyOnHidden` + `footer={<Space><Button>关闭</Button></Space>}` ⇒ 抽 `<PanelModal>` / `<PanelDrawer>` | ~45 | 低（新增共享层，调用点行为不变） |
| A3 | `ui/SniffModal.tsx:295-299 / 306-323 / 525-542 / 234-237` 与 `ui/RecvHistoryModal.tsx:121-130 / 143-162 / 268-286 / 101-104` | 打印与图片预览这套东西**整份复制了两遍**：`useReactToPrint({ignoreGlobalStyles:true, documentTitle, pageStyle:PRINT_PAGE_STYLE})`、`printImage`（游离 `Image()` 探 naturalWidth → `buildA4ImageNode`）、`actionsRender` 工具栏、`syncPreviewMask` effect | ~65 | 低–中（调用点零行为变化，但打印/预览是交互敏感区，需按 `znhd-verify` 冒烟复核） |
| A4 | `src/lib/relay.ts:390-395 / 553-558 / 599-604`（第 4 处在 `ui/MainPanel.tsx:405-409`）、`:427-435` vs `:441-445`、`:375/407/414/433/443` | 三组样板：`try{JSON.parse}catch`、`onerror` 与 `catch` 分支同构、`if (opt.onStatus) opt.onStatus(x)` 重复 10+ 次 ⇒ 提 `parseJson` / 统一 `fail(msg,ms)` / 局部回调转发器 | ~45 | 低（纯样板；注意 `relay.ts` 的 `if(stopped)return` 与 `GM_xmlhttpRequest` 语义要原样保留） |
| A5 | `src/lib/agent/types.ts:100-110 / 157-167 / 209-219 / 221-236 / 243-249 / 263-270 / 293-300`、`api.ts:45-52 / 79-96 / 182-187` | 声明了但**全仓零消费**的类型字段与透传包装：`AgentModelSummary` 的 6 个字段、`AgentChatResult`、`AgentChatOptions`、`AgentToolDefinition`、`AgentConversation.chat()/save()/attach()`、`CatAgentAvailability.parts`（只服务一句 `missing` 文案）、纯透传的 `createConversation` | ~55 | 低（纯删除；但 `types.ts` 是宿主 API 快照，见「不要动」第 6 条） |

### P1 —— 结构性收敛（≈ 150–200 行，需迁移或动渲染路径）

| # | 位置 | 问题 | 省行 | 风险 |
|---|---|---|---|---|
| B1 | `src/lib/state.ts:10-23` | 逐字段冗余缓存 `_initAllvalue` 的 5 个键，而 `runtime.init` 已是同一份完整对象；且**已经漂移**：`logAutoRefresh` 缓存了、`sniffMinKB` 没缓存。改为 `export const runtime = loadAllvalue()` + 消费点读 `runtime.init.X`（`MainPanel.tsx:260-264` 的写回同步改） | ~15 | 低 |
| B2 | `src/lib/storage.ts:113-145` | 「为什么这么多行」的一个根因：`saveAllvalue` 存**整份快照**，于是 `loadAllvalue` 必须 `{...DEFAULTS,...parsed}` + `workingHours` 逐字段 `Number.isFinite` 校验(`112-131`) + LEGACY 迁移(`132-137`)。改成只落盘「与 DEFAULTS 有差异的键」后三段防御基本可删 | ~20–25 | **中**（存储格式变更，需要一次性迁移；不迁移则老用户配置被重置） |
| B3 | `src/lib/speech.ts:88 / 108 / 136 / 172` | 177 行自建 FIFO + TTL + 超时；`clearSpeechTimer`(172) 与内部 `clearTimer`(136) 重复，`pruneExpiredSpeechItems` 在 `speak` 与 `processSpeechQueue` 各调一次。浏览器 `speechSynthesis` 自带队列，自建部分只需保留「上限 10 / TTL 30s / onerror not-allowed 清空 / 超时保护」⇒ 薄封装 | ~40 | 中（播报队列是已修过的 bug 区，需回归「连续播报/静音/超时」） |
| B4 | `src/lib/tinymce.ts:29-32 / 75-76 / 104-105` | 同一串 iframe 选择器 `.input-box iframe.tox-edit-area__iframe` \|\| `iframe.tox-edit-area__iframe` \|\| `iframe[class*="tox"]` 出现 3 次（第 1、3 处还不一致），body 读取重复 2 次 ⇒ 提 `findEditorIframe()/readIframeBody()` | ~30 | 低–中 |
| B5 | `src/lib/qrcode.ts:19-60` | 内层 `setTimeout` 回调 + 内层 `try/catch` + 外层 `try/catch` 三层嵌套，holder 清理在 3 个分支重复 | ~25 | 低 |
| B6 | `ui/MainPanel.tsx:230-254`（+ `:556-567`、`:737-857`） | 7 个独立布尔开窗状态（`settingsOpen`…`agentOpen`）+ `historyOpen` 全是 `set*Open(true)` ⇒ 单个 `activeModal: string \| null` | ~15 | 中（改到 MainPanel 渲染路径；`scripts/smoke/znhd-smoke.html` 依赖按钮 `textContent`/`aria-label` 定位） |
| B7 | `ui/MainPanel.tsx:481-486/829-833/840-846`、`ui/PhoneModal.tsx:299-303/347-352`、`ui/RecvHistoryModal.tsx:200` | `URL.revokeObjectURL` 空 `try/catch` 六连 | ~20 | 低 |
| B8 | `src/lib/monitor.ts:57-92` | 手写发布订阅（`MonitorState`/`getMonitorState`/`setMonitorStateSink`/`publishState`，约 35 行）只为向面板推 `waiting/online/inWorkingHours/lastSpeak` | ~20 | 低–中 |
| B9 | `ui/SkillsPanel.tsx:16-32`、`ui/agent/TaskPanel.tsx:35-43`、`ui/agent/AgentModal.tsx:65-73` | 三份同族 `formatTime`/`chatTimeText`（各自重实现 `pad`）；`ui/SettingsModal.tsx:128-163` 四个 `<Input type="time">` 手写两遍；`ui/PhoneModal.tsx:134-151` 的 `Section` 样式在本文件被内联重写 4 次 | ~38 | 低 |
| B10 | `src/lib/utils.ts:91-113` + `ui/SettingsModal`/`ui/MainPanel` | `hoursToHHmm`/`hhmmToHours` 存在**只是**因为 `workingHours` 用十进制小时存；改存 `"HH:mm"` 可删两个函数与所有转换点（`MainPanel.tsx:284-301` 与 `:742-754` 拼同一句「上午 X-Y，下午 Z-W」两遍） | ~20 | 中（同 B2，需迁移） |
| B11 | `src/lib/changelog.ts:97-137` | `loadChangelog(done(entries, errMsg))` 回调风格与全仓 Promise 风格不一致 | ~10 | 低 |
| B12 | `src/lib/clipboard.ts:49-92` | `notify` 包装 + 成功/失败两段样板；`playDidaSound` 已不导出 | ~10 | 低 |
| B13 | `src/lib/agent/api.ts:277-310 / 256-271 / 344-357`、`ui/agent/TaskPanel.tsx:96-143` | `content_delta`/`thinking_delta` 同构、看门狗每分片新建 Promise+`setTimeout`、`runTaskAction` 失败既 `addLog(error)` 又 `throw` 让 UI 再 `notify.error`（一次失败两份日志）⇒ 改返回错误串可删 TaskPanel 4 处 `try/catch` | ~30 | 中（改错误传播路径，需回归任务面板失败提示） |

### P2 —— 明确不值得做

- `icons.tsx` 图标本体（几何数据）、`LogModal.tsx:24-29 TYPE_META`（已是表驱动）、`uiReset.ts` 重复 6 次的选择器模板常量。
- `agent/sessions.ts:102-117` 的 `upsert/remove/label` 内联只是搬运，总量不减且失去可测性。
- `PhoneModal.tsx:13/244/246/369/426` 的 `any` 标注：属类型干净度，删不掉行。
- 「把 `logger/storage/state/constants/utils` 五个小模块合并成 config.ts + log.ts」：能省 import 样板与 JSDoc 头，但会动到几乎每个文件的 import，收益/风险比差 —— **不建议**。

---

## 4. 不要动（各 reviewer 独立给出、且有实测依据）

1. **`uiReset.ts:1-138` 样式隔离层**：按容器加前缀的 reset 是「不改宿主税务页」的前提；注释里「模板字符串内不能出现反引号」是踩过的坑。
2. **`ui/panelHost.tsx:1-60`**：挂 `documentElement`、用 `left/top` 而非 `transform`、不用 Shadow DOM —— 有实测数据（body 带 transform 会困住 `fixed`；drawer rect 曾为 `[0,0,1000,117]`）。
3. **`ui/panelHost.tsx:234-318 usePanelDrag`**：`DRAG_THRESHOLD=4`、`consumeDrag`、贴边 `MIN_VISIBLE=48`、resize 重 clamp 并持久化（拖拽定位属仓库明令豁免项）。
4. **剪贴板与打印路径**（`relay.ts:197-262`、`RecvHistoryModal.tsx:59-62`、两份 `printImage` 的游离 `Image()` 探测、`ignoreGlobalStyles:true`）：`clipboard.write()` 一旦走完手势校验就消耗掉手势，「先试后重试」的合并必然让重试 `NotAllowedError`；`ignoreGlobalStyles` 关掉会把宿主页全部 CSS 抄进打印 iframe。
5. **`relay.ts` 的 `GM_xmlhttpRequest`（`:344,509`）、首次 1s `maxwait` 探活（`:369-379`）、`previewUrl` 用 objectURL（`:402-406`）、12MB 预检（`:42-51`）**：分别是「税局页 CSP connect-src 禁 fetch」「老中继没有 /health」「让 revokeObjectURL 生效」「与服务端 MAX_BODY 对齐」的直接结论。
6. **`agent/types.ts` 的三处 `[与文档不符]` 标注与 `src/global.d.ts:55` 的 `CAT` 声明**：宿主 d.ts/文档/实现三方不一致，是回看官方源码的唯一锚点；若把 `types.ts` 当长期契约快照维护，P0-A5 里属于宿主 API 快照的部分（Skill/Task 未用方法）应降级为「不动」。
7. **`agent/types.ts:80-96 thinkingToText`、`api.ts:190-194` 过滤 system 消息、`sessions.ts:53-75` 读索引全异常兜空**：面板**没有错误边界**，一颗异常整块消失（AGENT.md:186 记录过一次线上崩溃）。
8. **`sniffer.ts` 头部 42 行等决策注释、`utf8Bytes`/`dataUrlBytes`/`headerOf` 的手写实现、`isClearlyNotImage` 保留 octet-stream、`runPool` 的 `Math.max(1,…)`**：分别是仓库约定、GM 只能用原始头字符串、宁多留不误删、`total=0` 防死循环。
9. **`ui/MainPanel.tsx:80-138 PANEL_CSS` 的 `display:none`、各处「只靠 aria-label 定位、隐藏不卸载」**：冒烟夹具按 `textContent`/`aria-label` 找按钮。
10. **全仓中文注释**：删注释能最快把行数打下来，但那是把「为什么不能那样写」的知识资产换成没人敢改的代码 —— 不划算，不建议。

---

## 5. 建议执行顺序

1. **第一批（零行为变化，可独立验证）**：A2 Modal 外壳 → A3 打印/预览共享层 → A4 relay 样板 → A5 agent 死字段 → A1 sniffer 死 SVG 路。
   *预计 −255 行，公共导出签名不变，`npm run typecheck` + 三段冒烟即可判定。*
2. **第二批（内部收敛）**：B1 state → B7 revokeUrl → B9 formatTime/Section → B5 qrcode → B4 tinymce → B6 MainPanel `activeModal`。
   *预计 −120 行；B6 必须跑 `znhd-verify` 确认面板入口/关闭/遮罩层级。*
3. **第三批（要迁移，单独一版做）**：B2/B10 存储 delta + `"HH:mm"`。
   *这是唯一能真正「让代码变少」的结构性改动，但必须先写好老数据迁移，否则老用户配置会静默重置。*

**预期总量：≈ 300–450 行（9457 → ~9000），约 3–5%。**

---

## 6. 复现 / 核验方式

- 行数与注释统计：对 `src/lib/**` 逐文件按「空行 / 块注释 / `//` / 代码」分类计数（本报告表格即该脚本输出）。
- 死代码扫描：抽取 `src/lib/**` 全部 `export (function|const|class|interface|type|enum)` 名字，在 `src/**` 全文计数引用；外部引用为 0 的逐个人工核对是否属「仅本文件使用」。
- 4 份原始 reviewer 报告（relay / sniffer / agent / ui）由 4 个独立上下文 reviewer 只读产出，条目中的行号需在动手前用当前工作区再确认一次（文件在本轮之后可能被改动）。
- Lead 已独立复核：量级表、`sniffer.ts` 的 SVG 死路径（读 `:400-519`、`:678-700`）、`state.ts` 冗余缓存、`runtime.*` 的全部 15 个调用点、死代码扫描结论。
