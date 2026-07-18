# znhd.user.js 代码审查与改进建议

> 审查时间：2026-07-18  
> 审查范围：znhd.user.js 全部 1208 行

---

## 一、Bug / 逻辑缺陷

### 1.1 日志去重逻辑过于简单
**位置**: [`addLog()`](znhd.user.js:47)  
**问题**: 只比较相邻两条日志是否相同，无法防止间隔性重复（如每3秒报一次"找不到人数元素"）。  
**建议**: 改用「最近N条日志」或「带时间窗口的去重」：

```javascript
// 改进：检查最近 N 条日志是否已有相同内容
const RECENT_LOG_COUNT = 5;
function isDuplicate(message) {
    return logEntries.slice(0, RECENT_LOG_COUNT).some(e => e.message === message);
}
```

### 1.2 `appendToTinyMCE` 返回值不一致
**位置**: [`appendToTinyMCE()`](znhd.user.js:974)  
**问题**: 部分路径返回空字符串 `''`，部分路径返回 `finalText`，`editor` 不存在且无 iframe 时函数隐式返回 `undefined`。  
**建议**: 统一所有路径都有明确的 return 值，或改为不需要返回值的副作用函数。

### 1.3 参数默认值不合理
**位置**: [`appendToTinyMCE(text2append = 'xxxxx')`](znhd.user.js:974)  
**问题**: 默认参数 `'xxxxx'` 没有实际意义，调用方都会传参，这个默认值会掩盖漏传参数的 bug。  
**建议**: 改为 `(text2append = '')` 或去掉默认值。

### 1.4 语音队列无上限
**位置**: [`speak()`](znhd.user.js:1067) → [`speechQueue.push()`](znhd.user.js:1076)  
**问题**: 如果快速产生多条播报，队列可能无限增长。用户关闭语音后队列不清空，再次开启时旧消息会突然涌出。  
**建议**: 
  - 给队列设上限（如最多10条）
  - 语音开关关闭时清空队列

---

## 二、内存泄漏风险

### 2.1 MutationObserver 未清理
**位置**: [`applyTracking()`](znhd.user.js:826) 中 `new MutationObserver()`  
**问题**: 创建后从未调用 `disconnect()`，虽然面板长期存在影响不大，但最佳实践应在 `beforeunload` 中清理。  
**建议**:
```javascript
const observer = new MutationObserver(() => { ... });
window.addEventListener('beforeunload', () => observer.disconnect());
```

### 2.2 resize 监听器未清理
**位置**: [第862行](znhd.user.js:862)  
**问题**: `window.addEventListener('resize', ...)` 在 `beforeunload` 中没有对应的 `removeEventListener`。

### 2.3 mousedown 中的事件监听器可能泄漏
**位置**: [第835-844行](znhd.user.js:835)  
**问题**: 如果用户在面板上 `mousedown` 后将鼠标移到面板外释放，且 `mouseup` 事件冒泡到 `document` 之外（理论上不会），监听器可能残留。  
**建议**: 考虑添加 `mouseleave` 作为取消条件，或使用 `{ once: true }` 等模式。

---

## 三、性能优化

### 3.1 `getShadowHosts()` 效率低
**位置**: [第736-739行](znhd.user.js:736)  
**问题**: `document.querySelectorAll('*')` 遍历整个 DOM 树查找 `shadowRoot`，页面元素多时性能差。  
**建议**: 缓存已知的面板宿主元素，或使用更精确的选择器：
```javascript
function getShadowHosts() {
    // 直接查找 scriptCat 面板的宿主元素，避免全树遍历
    return document.querySelectorAll('[data-scriptcat-panel]');
    // 或缓存首次找到的 host
}
```

### 3.2 常用语每次打开都重新加载
**位置**: [`useEffect` 依赖 `commonPhrasesVisible`](znhd.user.js:569)  
**问题**: 每次打开常用语抽屉都会发起网络请求，即使数据未变化。  
**建议**: 添加缓存策略——如果已加载过且 URL 未变，跳过请求：
```javascript
useEffect(() => {
    if (commonPhrasesVisible && Object.keys(phrasesData).length === 0) {
        loadPhrasesData();
    }
}, [commonPhrasesVisible]);
```

### 3.3 监控可考虑用 MutationObserver 替代轮询
**位置**: [`setInterval(checkCount, CONFIG.CHECK_INTERVAL)`](znhd.user.js:1138)  
**现状**: 每3秒轮询一次 DOM 检查人数变化。  
**建议**: 如果目标元素 `.count:nth-child(2)` 会随人数变化而更新内容，可以用 `MutationObserver` 监听该元素的 `characterData` 变化，只在变化时触发检查，更高效。不过考虑到3秒间隔已经很低频，这是一个可选优化。

---

## 四、代码质量与可维护性

### 4.1 `DM` 组件命名不直观
**位置**: [第478行](znhd.user.js:478) `function DM()`  
**建议**: 改为 `MainPanel` 或 `App`，提高可读性。

### 4.2 `playDidaSound` 错误被静默吞掉
**位置**: [第1170行](znhd.user.js:1170) `catch (e) { }`  
**建议**: 至少记录一条 warning 日志：
```javascript
catch (e) {
    addLog('播放提示音失败: ' + e.message, 'warning', true);
}
```

### 4.3 `escapeHtml` 函数名有歧义
**位置**: [第168行](znhd.user.js:168)  
**问题**: 该函数实际上是通过 `textContent` 赋值来转义 HTML，函数名准确但用法上可能让人误以为它返回的是转义后的 HTML 字符串而非安全文本。  
**建议**: 添加 JSDoc 注释说明其行为。

### 4.4 离线检测选择器冗余
**位置**: [第951-952行](znhd.user.js:951)  
**问题**: 用了两个选择器 `:nth-child(2)` 和 `:nth-of-type(2)`，逻辑上是"或"关系，但实际上这两个选择器在大多数情况下会命中同一个元素。  
**建议**: 合并为一个更精确的选择器，或确认两个选择器的互补场景后添加注释说明。

### 4.5 缺少 JSDoc 注释
**问题**: 大部分函数缺少参数类型、返回值类型、用途说明的 JSDoc 注释。  
**建议**: 为公共函数（`speak`、`checkCount`、`appendToTinyMCE`、`safeCopyText` 等）添加 JSDoc。

---

## 五、功能增强建议

### 5.1 语音播报音量可调
**现状**: 语音语速固定 `rate = 1.0`，无音量控制。  
**建议**: 在设置面板中添加语速/音量滑块，存入 `Allvalue`。

### 5.2 人数变化时的声音区分
**现状**: 人数 > 0 统一播报"征纳互动有人来了"，不区分是新增还是已有。  
**建议**: 当人数增加时播报"有人来了"，人数不变时不重复播报（当前已实现），人数减少时不播报（当前也已实现）。

### 5.3 常用语面板增加分类/分组
**现状**: 常用语平铺展示，数据量大时难以查找。  
**建议**: 如果 YAML 格式支持嵌套，可以按分类分组展示。

### 5.4 日志导出功能
**建议**: 在设置面板中添加"导出日志"按钮，方便排查问题。

---

## 六、安全相关

### 6.1 `GM_xmlhttpRequest` 的 `@connect *`
**位置**: [第17行](znhd.user.js:17) `// @connect *`  
**问题**: 允许连接任意域名，虽然油猴脚本常用此配置，但存在潜在安全风险。  
**建议**: 如果只连接 gitee 和自建服务，可以限制为具体域名：
```
// @connect        gitee.com
// @connect        znhd-service.zeabur.app
```

### 6.2 `example.com` 匹配规则
**位置**: [第8行](znhd.user.js:8) `// @match https://example.com/*`  
**问题**: 这明显是开发调试用的匹配规则，发布版本应移除。  
**建议**: 删除此行。

---

## 优先级总结

| 优先级  | 编号 | 改进项                      |
|---------|------|-----------------------------|
| 🔴 高   | 6.2  | 移除 example.com 匹配规则   |
| 🔴 高   | 6.1  | 限制 @connect 域名          |
| 🟡 中   | 1.1  | 日志去重逻辑改进            |
| 🟡 中   | 1.4  | 语音队列加上限 + 关闭时清空 |
| 🟡 中   | 1.2  | appendToTinyMCE 返回值统一  |
| 🟡 中   | 1.3  | 移除无意义的默认参数        |
| 🟡 中   | 2.1  | MutationObserver 清理       |
| 🟡 中   | 3.2  | 常用语缓存                  |
| 🟢 低   | 4.1  | DM 重命名                   |
| 🟢 低   | 4.2  | playDidaSound 错误日志      |
| 🟢 低   | 3.1  | Shadow DOM 查询优化         |
| 🟢 低   | 4.5  | 补充 JSDoc                  |
| 🔵 可选 | 5.1  | 语音音量可调                |
| 🔵 可选 | 5.3  | 常用语分组                  |
| 🔵 可选 | 5.4  | 日志导出                    |
