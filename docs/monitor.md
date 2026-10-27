# 监控与语音播报 · 技术说明

> 面向 AI / 开发者。使用步骤见 [monitor-guide.md](monitor-guide.md)。
> 最后核对：2026-10-28（v26.10.27-v3）。

## 1. 职责与边界

- 每 3 秒轮询：读页面「等待人数」元素 + 查「掉线」弹窗；变化时经语音队列播报。
- 时段闸门：非监控时段（默认 9–12 / 13.5–18，十进制小时）**不读页面、不播报**，只做时间判断并记一次翻转日志。
- 边界：不监听网络层、不重试登录、不做任何 UI 展示（主面板已删，`MonitorState` 仅内部记录，可见出口只剩日志）。

## 2. 模块地图

| 文件 | 关键导出 | 作用 |
|---|---|---|
| [`src/lib/monitor.ts`](../src/lib/monitor.ts) | `startMonitoring()` / `stopMonitoring()` / `resetWaitCountBaseline()` / `getMonitorState()` / `setMonitorStateSink()` | 轮询与判定；`MonitorState`（waiting/online/inWorkingHours/lastSpeak）内部维护 |
| [`src/lib/speech.ts`](../src/lib/speech.ts) | `speak()` / `clearSpeechQueue()` / `clearSpeechTimer()` | 语音队列 FIFO + 防卡死保护 |
| [`src/lib/constants.ts`](../src/lib/constants.ts) | `CONFIG` / `DEFAULTS` | 检测间隔 3000ms、队列上限 10、TTL 30s、超时 15s；时段默认值 |
| [`src/lib/state.ts`](../src/lib/state.ts) | `runtime` | `voiceEnabled` / `workingHours` 的内存缓存（避免每轮读 localStorage） |
| [`src-vue/panel/DialogHost.vue`](../src-vue/panel/DialogHost.vue) | `toggleVoice()` | 语音开关**唯一**落库点：写 Allvalue + 播空 utterance 解锁 + 复位基线 / 清队列 |
| [`src-vue/panel/NavBarControls.vue`](../src-vue/panel/NavBarControls.vue) | — | 标题栏开关 UI；状态/事件经 `uiBus` 与 DialogHost 接力（`voiceToggler`） |

## 3. 数据流

```
setInterval(3000) → checkCount()
  ├─ isWorkingHours()  翻转时记日志；不在 ⇒ return
  ├─ .count:nth-child(2)  → parseInt → publishState({waiting})
  │    ├─ ===0 且上次非 0 → 日志「当前等待人数为0」(success)
  │    └─ >0 且 !== lastWaitCount → speak('征纳互动有人来了')（上升沿）
  └─ .t-dialog__body__icon 含「掉线」
       ├─ 首次出现 → speak('征纳互动已掉线') + lastOfflineAnnounced=true
       └─ 消失 → lastOfflineAnnounced=false，online=true
```

## 4. 关键实现细节

- **人数元素缓存**：`.count:nth-child(2)` 相对稳定，缓存引用；每轮先查 `isConnected`，脱离文档即重查（SPA 换壳兼容）。
- **掉线弹窗不缓存**（动态创建/销毁），且两个选择器 `.t-dialog__body__icon:nth-child(2)` 与 `:nth-of-type(2)` 是**互补兜底**不是冗余：不同版本页面在图标前插入的额外节点会让两者命中不同元素。
- **播报判上升沿**（`currentCount !== lastWaitCount`，首读 `null` 也播）：否则 3s 轮询会把语音队列（上限 10）塞满同一句话，真正的掉线提醒排到 10 句之后、超过 30s TTL 被丢 ⇒ 掉线永远播不出去。
- **静音期间 `speak()` 直接 return**（`src/lib/speech.ts`）——该轮上升沿被无声吃掉，因此 `toggleVoice(true)` 时**必须** `resetWaitCountBaseline()`，并播一条空 `SpeechSynthesisUtterance('')` 解除浏览器 `not-allowed`；关闭时 `clearSpeechQueue()` 防旧消息堆积。
- 语音队列三重保护：超 10 条丢最旧；入队/播放前剔除超 30s 的陈旧消息；单条 15s 超时兜底（Chrome `onend/onerror` 可能不触发）。`onerror` 收到 `not-allowed` 时清空整个队列。

## 5. 存储与配置

| 项 | 键 / 位置 | 说明 |
|---|---|---|
| 语音开关 / 监控时段 | `localStorage` 键 `scriptCat_Allvalue`（`voiceEnabled` / `workingHours`） | DialogHost 是唯一读写点；`workingHours` 有字段级校验（storage.ts），坏值回退默认 |
| 常量 | `CONFIG.CHECK_INTERVAL` 等 | 只读代码常量，设置里不可改 |

## 6. 失败模式与日志

| 情况 | 日志（类型） |
|---|---|
| 进入/离开工作时段 | success / info（仅翻转时） |
| 找不到人数元素 / 数字解析失败 | warning（每 3s 去重后仍会刷屏，属于站点改版信号） |
| 掉线 | error「掉线提示： …」 |
| 语音队列满 / 过期清理 / 播报超时 | warning（仅 console，`logenabled=true` 不上面板） |
| 检测过程抛异常 | error「检测错误: …」 |

## 7. 改动须知（坑）

- 别把「人数没变不播报」改成「每轮播报」——见第 4 节上升沿理由。
- 别删掉 `:nth-of-type(2)` 的双写法。
- `stopMonitoring()` / `clearSpeechTimer()` 在页面卸载时必须被调用（`beforeunload` 链），否则复活定时器。
- 语音开关逻辑改在 `toggleVoice()`（DialogHost），NavBarControls 只是壳——别在导航条里另写落库。

## 8. 冒烟覆盖

`scripts/smoke/vue-panel.js`：`navVoiceOk`（开关存在且受控）、`noPageError`（页面无脚本自身报错）、`versionOk`。监控轮询本身不进无头断言（依赖站点 DOM）。
