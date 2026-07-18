# znhd-service 项目长期记忆

## 项目概况
- `znhd.user.js`：征纳互动（税务）人数/在线监控油猴脚本，运行在 ScriptCat 扩展下，UI 依赖外部库
  CAT_UI（`@require` 自 scriptcat.org/lib/1167/1.0.0/脚本猫UI库.js）。库源码已备份在 `TMP/cat_ui_lib.tmp.js`。

## CAT_UI 库关键事实（极易踩坑）
- **公开导出只有这 18 个**：createPanel, createElement(el), useEffect, useState, useRef, Router,
  Draggable, Icon, Typography, Input, Button, Checkbox, Select, Space, Divider, Drawer, Table。
- 库内部虽有 arco 的 TimePicker/DatePicker 等组件，但**未挂到 CAT_UI 公开接口**，直接 `CAT_UI.TimePicker`
  会 `TypeError: is not a function`。需要时间选择器时用原生 `CAT_UI.createElement('input', { type:"time" })`。
- `createPanel` 的 options **不提供 onDrag 回调**（只认 point/header/render/onMin/onReady/style 等）。
  面板拖拽由内部 react-draggable 改写**内部层**的 `transform: translate`，根容器 left/top 不变。
- 面板渲染在 **Shadow DOM**（`attachShadow({mode:"open"})`，自定义元素 <cat-ui-plan> 挂 document.body），
  普通 `document.querySelectorAll` 穿不透，需遍历 `.shadowRoot`。
- **arco Drawer 懒挂载 children**（visible=false 时不挂载内容）；若 Drawer 内容在挂载时抛错，会连带
  整棵面板 React 树崩溃（面板消失）。**Drawer 内不要直接放裸原生 DOM 元素**（如 createElement('input')），
  要用 CAT_UI.* 封装组件；需要原生 input 时用 `CAT_UI.Input({ type:"time" })`（type 会被透传，带时间选择器）。

## 面板位置持久化方案（已验证可用）
- 存储键 `scriptCat_PanelPoint`（与设置数据分离）；`Point` 选项 `point: loadPanelPoint()`。
- 定位：找标题含「征纳互动监控」且在 shadow 内的面板主体；用 `getBoundingClientRect` 读真实视口坐标；
  监听子树 style 变化 + mousedown/mousemove/mouseup 双保险保存；`point` 加载时恢复。
- 边界约束 `clampPoint`：可抓取区=顶部标题栏，故 minY=0（顶边不超出视口上方），maxY=vh-40；水平 MIN_VISIBLE=48。

## 已落地的功能改进
- 工作时间可配置：DEFAULTS.workingHours（morningStart/End, afternoonStart/End），缓存 cachedWorkingHours，
  isWorkingHours() 读缓存（无配置兜底 true）；SettingsDrawer 用原生 input[type=time] 选取。
- 启动/关键节点日志走 addLog 进设置面板日志窗口（setLogEntriesCallback 在 DM 挂载 effect 注册）。
- parseInt 加基数 `,10`；删除 isChecked 死字段；常用语搜索用 String(key)/String(value) 兜底。
