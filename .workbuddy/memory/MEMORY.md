# znhd-service 项目长期记忆

## 项目概况
- `znhd.user.js`：征纳互动（税务）人数/在线监控油猴脚本，运行在 ScriptCat 扩展下，UI 依赖外部库
  CAT_UI（`@require` 自 scriptcat.org/lib/1167/1.0.0/脚本猫UI库.js）。库源码已备份在 `TMP/cat_ui_lib.tmp.js`。

## CAT_UI 库关键事实（极易踩坑，已多次验证）
- `window.CAT_UI = Object.assign(class{...}, { 整个 arco 组件库 })`：名义上导出了 arco 几十个组件
  （Affix/Alert/Image/Input/DatePicker/TimePicker/...），但**运行时其中大量组件是 undefined**，
  只有脚本实际用过的子集可靠（createPanel, createElement, useEffect, useState, useRef, Drawer,
  Icon, Typography, Space, Text, Input, Button, Divider, Select, Switch, Message，以及 LogPanel 用的
  裸 createElement('div'/'p') 等）。
- ⚠️ **用任何 CAT_UI 组件前必须运行时验证**，绝不能只 grep 库文本里出现过的名字！
  已实测 `TypeError: is not a function` 的：`CAT_UI.TimePicker`、`CAT_UI.Image`（arco 里虽有，但挂到
  CAT_UI 上时是 undefined）。`grep` 到 `Image: LY` / `TimePicker` 字样 ≠ 公开可用。
- 时间选择器：`CAT_UI.TimePicker` 不可用 → 用 `CAT_UI.Input({ type:"time" })`（arco Input 透传 type，
  带浏览器时间选择器，且在 Drawer 内稳定，不会被懒挂载崩溃）。
- 自定义图标（如网站 favicon）：`CAT_UI.Image` 不可用；且 CAT_UI 面板用的 React 渲染器**白名单不含 `img`**
  标签**（div/p/span 等可用，img 会触发 React error #137 "Element type is invalid: got img"）。
  正确做法：用 `CAT_UI.createElement('div', { style:{ width/height, backgroundImage:'url(...)"',
  backgroundSize:'contain', backgroundRepeat:'no-repeat', backgroundPosition:'center' } })` 显示图片。
- `createPanel` 的 options **不提供 onDrag 回调**（只认 point/header/render/onMin/onReady/style 等）。
  面板拖拽由内部 react-draggable 改写**内部层**的 `transform: translate`，根容器 left/top 不变。
- 面板渲染在 **Shadow DOM**（`attachShadow({mode:"open"})`，自定义元素 <cat-ui-plan> 挂 document.body），
  普通 `document.querySelectorAll` 穿不透，需遍历 `.shadowRoot`。
- **arco Drawer 懒挂载 children**（visible=false 时不挂载内容）；若 Drawer 内容在挂载时抛错，会连带
  整棵面板 React 树崩溃（面板消失）。设置类 Drawer 优先用 CAT_UI.* 封装组件；需要原生 input 时用
  `CAT_UI.Input({ type:... })` 形式（已在设置抽屉的时间选择验证稳定）。

## 面板位置持久化方案（已验证可用）
- 存储键 `scriptCat_PanelPoint`（与设置数据分离）；`Point` 选项 `point: loadPanelPoint()`。
- 定位：找标题含「征纳互动监控」且在 shadow 内的面板主体；用 `getBoundingClientRect` 读真实视口坐标；
  监听子树 style 变化 + mousedown/mousemove/mouseup 双保险保存；`point` 加载时恢复。
- 边界约束 `clampPoint`：可抓取区=顶部标题栏，故 minY=0（顶边不超出视口上方），maxY=vh-40；水平 MIN_VISIBLE=48。

## 版本号规范（硬性约定，必须遵守）
- 油猴脚本头 `@version` 格式：`YY.M.D-vN`（如 `26.7.18-v1`）。前半 `YY.M.D` = 修改日期（2位年.月.日），
  后半 `vN` = **当天累计的第 N 次更新**。
- 规则：对 `znhd.user.js` 的**任何代码改动（功能/修复/调整）都必须同步把版本号递增**
  （v1→v2→v3…）；若**跨天**（日期变了）则日期部分更新为当天、版本号**重置为 v1**。
- 此约定优先级高：所有改动都要带版本号递增，不可遗漏。
- ⚠️ **日期部分必须用「改动落地当天的真实日期」**，绝不是沿用上一次改动的旧日期！
  每次 bump 前先用当前系统时间（或问用户确认当天日期）算出 `YY.M.D`，再决定是 `+vN` 还是跨天重置 `v1`。
  - 反面案例：2026-07-27 完成的「双向互传」功能，被误写成 `@version 26.7.26-v25`（沿用了前一天 7/26 的日期），
    且违反跨天规则未重置——正确应为 `26.7.27-v1`。已事后更正。
  - 只改 `@version` 头即可；面板两处（line ~668 启动日志、line ~901 面板版本文本）都用 `GM_info.script.version`
    动态读取，无需同步改。

## 文档同步约定（硬性约定）
- 对 `znhd.user.js` 做代码改动后，**必须同步更新 `ReadMe.md`**：核心特性、配置说明（`CONFIG`/`DEFAULTS`
  要与实际代码一致，不能描述已删除/迁移的字段）、功能详解、更新日志（在顶部补新版本条目）、版本号示例。
- 维护历史中 ReadMe 曾多次滞后（CONFIG 还写着旧 `WORKING_HOURS`、版本号停在 v26.2.26），改动后务必核对。

## 已落地的功能改进
- 工作时间可配置：DEFAULTS.workingHours（morningStart/End, afternoonStart/End），缓存 cachedWorkingHours，
  isWorkingHours() 读缓存（无配置兜底 true）；SettingsDrawer 用原生 input[type=time] 选取。
- 启动/关键节点日志走 addLog 进设置面板日志窗口（setLogEntriesCallback 在 DM 挂载 effect 注册）。
- parseInt 加基数 `,10`；删除 isChecked 死字段；常用语搜索用 String(key)/String(value) 兜底。
