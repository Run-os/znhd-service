# 待办提醒 · 技术说明

> 面向 AI / 开发者。使用说明见 [todo-guide.md](todo-guide.md)。
> 最后核对：2026-10-28（v26.10.27-v3）。v26.10.24-v1 引入，真机校正两轮（v3 / v5）。

## 1. 职责与边界

监听工作台左侧待办卡片（`.message-item`）里「**待处理留言**」「**待处理预约**」的数量：> 0 时给整张卡片加红色呼吸样式，归 0 撤掉。**注入的是站点页面的 light DOM**（不是自己的 Shadow DOM），纯展示层（`pointer-events: none` 不适用——样式只加类，不挡点击）。

边界：无开关、无配置、不语音、不弹窗；只认这两个标题关键词。

## 2. 模块地图

| 文件 | 关键导出 | 作用 |
|---|---|---|
| [`src-vue/lib/todoBadge.ts`](../src-vue/lib/todoBadge.ts) | `startTodoBadge()` / `stopTodoBadge()` | 全部实现（~160 行，自注入 `<style>`） |
| [`src-vue/app.ts`](../src-vue/app.ts) | `boot()` 启动链 | 模块启动（启动失败不影响后续模块） |

## 3. 数据流

```
startTodoBadge()
  ├─ scan() 首扫（try/catch 吞异常，只 console.warn）
  └─ MutationObserver(subtree + childList + characterData)
        → 300ms 防抖 → scheduleScan() → scan()
scan():
  ① 回收：document.querySelectorAll('[data-znhd-todo]')
     closest('.message-item') 数量为 0/取不到 ⇒ 移类 + 摘标记
  ② 补新：XPath '//div[contains(@class,"title")][contains(., "待处理留言"|"待处理预约")]'
     → closest('.message-item') → countOf(card) > 0 ⇒ 加类 + 打标记
```

- `countOf` 读卡片的 `.count` 文本 `parseInt`，坏值按 0。
- 标记打在**标题元素**（`data-znhd-todo`），回收时用它反查卡片，保证「处理完红框一定撤掉」。

## 4. 关键实现细节

- **DOM 事实**（2026-10-24 真机实测）：

  ```html
  <div class="message-item">
    <div class="count">2</div>   <!-- 零时也占位显示 0 -->
    <div class="title">待处理留言</div>
  </div>
  ```

- **为什么自带 `<style>` 而不用 Tailwind 类**：注入目标是站点页面的 light DOM，站点没加载 Tailwind，工具类不生效。keyframes 前缀 `znhdTodo` 防冲突。
- **形态演进**（两次被真机否掉，别走回头路）：v1 标题旁小 badge（与原有红数字重复）→ v2 只把 `.count` 做成胶囊（不够显眼）→ **v3 定版：整卡** 浅红底 `#ffe6e6` + 2px 边 `#e5484d` + 圆角 + 外圈光晕呼吸；首次出现再叠一圈 `::after` 扩散描边（`animation ... 1 both`，跑一次停在透明）。
- **呼吸周期 3.2s**（≈19 次/分，贴近静息呼吸）：1.4s 被使用者判为「太快」；调整区间只能在 2.6~4s。**底色/描边不许调淡**（`#fff1f1` 在 175% 缩放实机上与素白同色）。
- 站点 scoped 样式 `.message-item[data-v-xxx]` 特异性高 ⇒ 覆盖必须 `!important`。
- 扫描用 **XPath 原生匹配**（C++ 实现，比 JS 全页遍历便宜）；`characterData` 必须监听——站点是 Vue 就地改文本，不重建节点。
- `startTodoBadge()` 里 `document.body` 缺失时**不置 started**（留给调用方重试）；置位后永不重启是老坑。

## 5. 失败模式与日志

模块异常只 `console.warn('[待办提醒] …')`，不进运行日志、不 toast——它是纯视觉增强，失败不应打扰使用者。日志「模块启动清单」里会有它的启动记录。

## 6. 改动须知（坑）

- 关键词、标记属性、卡片类的常量都在文件头部，别散落魔法字符串。
- 「看不到红卡」的排查入口：`[data-znhd-todo]` 是否存在——不存在 = 实例没跑到该模块（刷新即恢复），不是样式丢了。
- 别给卡片加 `opacity`/明暗整体闪动：卡内有文字和数字，整体闪晃眼；光晕（box-shadow）只在外围起伏。

## 7. 冒烟覆盖

`scripts/smoke/vue-panel.js`：`todoBadgesOk`——向夹具页注入带数量的「待处理留言」卡片，断言标红类挂上；再把数量改 0，断言类被撤掉（回收路径）。
