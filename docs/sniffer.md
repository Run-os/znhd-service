# 图片嗅探 · 技术说明

> 面向 AI / 开发者。使用步骤见 [sniffer-guide.md](sniffer-guide.md)。
> 最后核对：2026-10-28（v26.10.27-v3）。

## 1. 职责与边界

扫描**当前页面**上的图片（`<img>` / 懒加载属性 / CSS 背景图；内联 SVG 也采集但默认被后缀规则排除），测体积、按会话归组、预览 / 下载 / A4 打印。

边界：**不发起批量抓取页面外资源**——体积测量能零请求就零请求；视频在扫描阶段排除，gif 按图片保留。

## 2. 模块地图

| 文件 | 关键导出 | 作用 |
|---|---|---|
| [`src/lib/sniffer.ts`](../src/lib/sniffer.ts) | `collectCandidates()` / `resolveSizes()` / `downloadImage()` / `downloadBatch()` | 收集（`MAX_SNIFF` 300 张、`CSS_SCAN_LIMIT` 3000 条规则）与测体积（`SizeVia: perf/local/head/range/unknown`） |
| 同上 | `isExcludedName()` / `EXCLUDED_NAME_PATTERNS` / `EXCLUDED_NAME_SUFFIXES` | 扫描期排除：名字含 `znhd-sniff`/`user-woman`/`user-man` 或 `.svg` 结尾 |
| [`src/lib/snifferPerf.ts`](../src/lib/snifferPerf.ts) | — | 启动即扩容 performance 资源缓冲 + observer 持续抄录（同源图零请求拿字节数） |
| [`src/lib/snifferPre.ts`](../src/lib/snifferPre.ts) | `setPreMeasureEnabled()` / `preMeasureStatus()` | 后台预测量：启动 5s 后量一轮，之后每 60s 补新图；并发 2、每轮净请求 ≤60 |
| [`src/lib/sniffConv.ts`](../src/lib/sniffConv.ts) | `getCurrentConv()` / `buildConvContext()` / `groupByConversation()` / `AliasTable` / `timeOfItem()` | 读 Vuex 会话消息，按文件名主干归组 + 持久索引 |
| [`src-vue/sniff/SniffDialog.vue`](../src-vue/sniff/SniffDialog.vue) | — | 弹窗 UI（828px）：阈值行 / 全选 / 批量下载 / 分组网格 / ImagePreview |

## 3. 数据流

```
开窗 → collectCandidates()（DOM/懒加载/CSS，排除站点图标与 .svg）
     → resolveSizes()：perf 资源表 → 本地测量 → HEAD → Range → unknown
     → 过滤阈值（sniffMinKB，只影响显示与全选，不影响请求）
     → groupByConversation()：Vuex「当前会话+消息列表」按文件名主干归属
     → 组内按 timeOfItem 从新到旧；取不到时间排组尾、文件名标红
```

## 4. 会话归组（sniffConv.ts）

- 「文件名 → 会话」映射持久化 `localStorage` 键 `scriptCat_SniffConvIndex`：**只存映射不存 URL**（im-cos 直链带签名会过期，存了下次就是裂图）。上限 2000 条 / 别名 200 条 / TTL 30 天（`CONFIG`）。
- `AliasTable`（显示名 → 真实会话 ID）+ 回退键后置合并：保证同一会话不拆成同名两组；名字匹配不唯一时**宁可放弃（拆组）也不误合**。
- **时间兜底链**：`time`（数值）→ `systemTime` / `talkTime`（`2026-10-26 14:56:39` 文本，本地时区）→ `timestamp`。⚠️ 2026-10-26 真机实测站点已把 `time` 字段整个去掉（11/11 条 `typeof time === 'undefined'`），只认 `time` 的旧实现会让每张图都判无时间——v26.10.26-v6 修复。索引里旧的 `time: null` 记录要等该会话再被打开重读消息才补上。
- 已知限制：工作台一次只给当前会话的消息——别的会话的图要么当时还在页面、要么点开那个会话再扫。

## 5. 体积测量（零请求优先）

1. 资源表预收（`snifferPerf`，脚本启动即开始）；
2. `decodedBodySize → encodedBodySize → transferSize` 零请求取值；
3. 查不到才 HEAD / Range；
4. 后台预测量（`snifferPre`，设置项 `sniffPreMeasure`，默认开）：开窗时直接复用缓存。只有「跨域且资源表拿不到字节数」的图会在不开窗时被请求。
5. **大小未知的图不丢**：跨域读不到字节数的大图往往正是目标，折叠保留、照常预览/下载/打印。

## 6. 下载与打印

- **单张**：跨域图走 `GM_xmlhttpRequest` 取二进制（`<a download>` 对跨域会被忽略、变成导航）。
- **批量** `downloadBatch()`：两段式流水线（并发预取 + 串行间隔触发——浏览器对同页连续下载有节流，太快静默丢文件）；失败自动重试，永久错误不重试。范围 = 可选集合 ∩ 选中集，阈值过滤掉的图绝不下。
- **A4 打印**：`shared/preview/print.ts`，纵向无页眉页脚；横图自动旋转 90°；打印后收右键菜单（v26.10.26-v6）。
- 预览共用 `ImagePreview`（Teleport 进 shadowRoot）：缩放 / 旋转 / 多图切换 / Esc / 打印。

## 7. 存储与配置

| 项 | 位置 | 说明 |
|---|---|---|
| 阈值 | `Allvalue.sniffMinKB`（消费点兜非正数回退 20） | 只影响显示与全选 |
| 预测量开关 | `Allvalue.sniffPreMeasure` | 改开关即时生效（`setPreMeasureEnabled`），不需要重扫 |
| 归属索引 | `scriptCat_SniffConvIndex` | 只记映射，30 天过期 |

## 8. 失败模式与日志

| 情况 | 现象 / 日志 |
|---|---|
| 直链签名过期 | 缩略图裂 / 下载 403 —— 重扫即恢复 |
| 全部被过滤 | 「扫描到 N 个候选，但都被阈值或类型过滤掉了」 |
| 批量下载个别失败 | 「批量下载完成： ok/total」error 注明失败张数 |
| Vuex 结构变化 | 归组退化成「未归属会话」——查 `sniffConv.ts` 的字段读取 |

## 9. 改动须知（坑）

- 阈值是「显示/下载过滤」不是「请求策略」——扫描阶段一律测量，别改成先探测再决定请求。
- `minKb` prop 名只能小写 b（`:min-kb` 推导规则），写成 `minKB` 绑定不生效（vue-tsc 会报）。
- 排除规则（图标头像 / `.svg`）在**扫描期**生效，加新排除项改 `EXCLUDED_NAME_*`，不要在 UI 层再滤一遍。
- 归组匹配宁可拆组不可误合（`AliasTable` 的约定），别「优化」成模糊匹配。

## 10. 冒烟覆盖

`scripts/smoke/vue-panel.js`：`sniffDialogOk`（弹窗结构）、`sniffSelectOk`（全选）、`sniffPreviewOk`（预览）、`sniffEscOnlyPreviewOk` / `sniffBlankClickOnlyPreviewOk`（Esc/空白点击只关预览、嗅探窗仍开——判据 `dialog[open] [data-sniff-card]`）、`sniffNoTimeNameOk`（无时间图排组尾 + 文件名标红）、`sniffUnknownExpandOk`（未知体积折叠）、`sniffStubBytesOk`（资源表桩护栏）、`printMenuOk` / `printMenuHideOk`（打印菜单出现/收起）。
