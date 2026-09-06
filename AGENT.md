# agent.md — AI 专属内部心智文档

> 本文件仅供 AI 编码助手使用。**禁止与 `ReadMe.md` 重复内容**：凡终端用户或维护者日常会查的信息（功能、配置、技术栈、FAQ、更新日志）一律归 ReadMe，本文件只做【引用】，需要时由 AI 去读 ReadMe.md。

---

## 前置强制规则

1. **文件定位区分**
   - `agent.md` = AI 专属内部文档，只记录：代码内部组织事实、复用代码溯源、内部执行流程、关键数据结构、代码修改强制约束、技术债务、历史踩坑索引（一句话规则 + 指向 ReadMe 版本条目）。
   - `ReadMe.md` = 对外文档：功能详解、配置说明、技术栈、FAQ、更新日志（唯一的对外版本档案）。

2. **文档写入决策流程（每次更新文档前，按顺序判断）**
   1. **读者是谁**：终端用户/维护者日常会查（使用、配置、排障、部署运维）→ 写 **ReadMe**；只有 AI 改代码时才需要的导航/约束 → 写 **agent.md**。
   2. **ReadMe 是否已有该主题**（功能详解/配置说明/技术栈/FAQ/更新日志）：已有 → 只引用其章节，不重复编写。
   3. **是否 ReadMe 写错/过时**：**直接修正 ReadMe**（以代码为准），禁止在 agent.md 另存一份「正确对照表」。
   4. **两边都需要**：正文写 ReadMe，agent.md 只留约束或一句引用指针。
   5. **版本号与更新日志正文永远只进 ReadMe**；agent.md 不复制 changelog，只记版本指针。
   6. 拿不准时先问自己：这段话若删掉，改代码时是否还能正确干活？能 → 别写。

3. **读取顺序**：① 完整读 `agent.md`；② 本文件提示需对外信息时，读 `ReadMe.md`（如版本规则见其「更新日志」开头、技术栈/功能细节见其对应章节）；③ 缺历史上下文读 `.workbuddy/memory/`（见下）；④ 看源码；⑤ 部署相关以 `.github/workflows/deploy.yml` 注释为准。

4. **更新要求**：新增依赖/核心逻辑变动/约束变更/新增坑点时更新；不写宣传话术；**【Agent修改代码强制约束】章节为最高优先级，不得删减**。

5. **任务收尾自检（必做，否则视为任务未完成）**：完成实质性工作（改代码、改文档、排查得出结论、调整约定）后，**必须**按「工作区记忆」规则写入 `.workbuddy/memory/YYYY-MM-DD.md`（当日文件不存在则新建，按时间追加，不覆盖）；跨 30 天的日志同步蒸馏进 `MEMORY.md`。仅当用户明确说「不用记」时才跳过。

---

## 工作区记忆（读写）

- **位置**：`{workspace}/.workbuddy/memory/`
- **文件**：
  - `YYYY-MM-DD.md`：每日工作日志（**追加式**）
  - `MEMORY.md`：长期项目笔记（3,000 字符/会话）
- **用途**：项目特定上下文，AI 在后续会话中恢复项目知识。
- **记忆写入规则**：
  1. 完成实质性工作后必须写入；
  2. 每日日志**追加式**，不覆盖；
  3. 长期记忆按主题整理；
  4. **30 天以上**的日志整理归档进 `MEMORY.md`。

---

## 核心文件职责与代码组织

对外功能、用途说明见 ReadMe「项目结构 / 功能详解」。以下只记录 ReadMe 未写的**代码内部组织事实**（AI 导航代码用）：

| 文件 | AI 需知的事实 |
|---|---|
| `znhd.user.js` | 单文件 IIFE（`'use strict'`）；用 `// ==========` 注释分区导航；每个具名函数有 JSDoc。头部 `@version` 即脚本版本。 |
| `relay-server/server.js` | `uploadPageHtml()` 返回整页内联 HTML/JS（手机上传页），同源托管。`PORT = process.env.PORT \|\| 5689`。版本读 `package.json`（`VERSION`），`/health` 返回。 |
| `relay-server/package.json` | 零依赖；`version` 是服务端版本唯一来源。 |
| `.github/workflows/deploy.yml` | 部署真源。**注意：`appleboy/ssh-action` 不会把顶层 `env` 注入远程 shell，脚本内变量是硬编码的**；容器名/路径改动要改脚本内与 env 两处。自带详尽注释（bind 失联背景等），勿在别处再维护第二份流程说明。 |

## 复用代码溯源

- **手机页收图画廊 ≈ 脚本端画廊**：`server.js` 内联页 `#recvPopup`/`renderRecvGrid` 与 `znhd.user.js` `renderImageGallery`/`showImagePopup` 是同一套交互的两份独立实现。**改一侧需评估另一侧是否同步**。
- **正反向通道已在服务端统一**：`server.js` 把 `/u`+`/recv`（手机→电脑）与 `/phone/send`+`/phone/recv`（电脑→手机）抽成 `createChannel()` 工厂，实例化为 `forwardChannel`/`reverseChannel`，入队/投递/长轮询共用（relay v26.9.6-v1 消除的历史逐行镜像，修一处即两处；语义见 `createChannel` 注释）。**仍需人工同步的是跨端合约**：`znhd.user.js`（脚本收图/发图）↔ `server.js` 内联手机页（上传/收件）各自实现。
- **剪贴板结论跨端复用**：「Chromium 只可靠支持 PNG / 需页面主世界 write / 保留点击手势」先在脚本端踩出，后被手机页 `copyRecvImage` 复用简化版。

## 内部执行流程

### 数据转发循环（内部视角；用户流程见 ReadMe「设备互联」）
1. 脚本端 `getDeviceId()`：`GM_getValue` 持久化 `crypto.randomUUID()` → 每台电脑稳定 `deviceId`。
2. 手机 GET `/u/<id>` 拿内联上传页 → 前端压缩/HEIC 转码 → POST `/u/<id>` 入 `forwardChannel`（FIFO，超 `MAX_QUEUE` 丢最旧）。
3. 服务端 `forwardChannel` 入队即投递：把队头一条**广播**给所有在等连接（各一份拷贝）；无连接等待时条目留队列。
4. 电脑端 `GM_xmlhttpRequest` 长轮询 `/recv/<id>`（绕过税务页 CSP），按 `type` 分流 image/text 弹窗。
5. 反向：手机每 8s POST `/phone/heartbeat` 报活；电脑先 `GET /phone/status` 判在线再 `POST /phone/send`；服务端每 5s 扫描超 `PHONE_TTL` 判离线（只告警一次）。

### 监控/语音（内部要点；对外细节见 ReadMe）
- `startMonitoring` 每 `CHECK_INTERVAL=3000ms`；非工作时段跳过；人数取自 `.count:nth-child(2)`。
- 语音走 `speak` + `processSpeechQueue`（去重 / TTL 30s / 上限 10 / 开关切换清空）。

### 部署/生效（指针，勿另写流程）
- 生产：push `main` → `deploy.yml` 自动同步并重启容器，**不热更**；本地调试改 `server.js` 后 `docker restart znhd`。
- 生效验证：`curl http://127.0.0.1:5689/health` 的 `version` 与 `relay-server/package.json` 一致即生效（ReadMe FAQ 第 5 条有运维说明）。
- 机制细节（tar 管道直写 `/app`、bind 失联背景、嵌套 .git 清理等）以 `deploy.yml` 注释为准；容器 restart 不重绑 bind 挂载，故别依赖「restart 即重挂载」的旧说法。

## 关键数据结构（ReadMe 未系统性覆盖，AI 修改服务端必读）

`server.js` 内存态，按 `deviceId` 为键，**无持久化**：
| 结构 | 含义 |
|---|---|
| `forwardChannel` / `reverseChannel` | `createChannel()` 工厂两个实例（正向/反向）；各自闭包内持 `pending`（FIFO 条目队列，上限 100）+ `waiting`（长轮询在等连接 `Set<res>`，广播目标）+ `sweepExpired()` |
| `phoneOnline` / `phoneWasOnline` | 手机最近心跳时间 / 曾在线集合（离线只告警一次） |

条目 `Item = {type:'image'|'text', name?, mime?, data?, text?, ts}`；常量 `PENDING_TTL=60s`、`MAX_BODY=12MB`（超限回 413）、`PHONE_TTL=20s`、`MAX_QUEUE=100`。

脚本端 localStorage 键（ReadMe 只提及 `scriptCat_Allvalue`，其余在此补全）：
- `scriptCat_PanelPoint`：面板位置（防抖写）。
- `scriptCat_PhrasesCache`：`{time,url,data}`，2h TTL。
- 弹窗/画廊 DOM：挂 `document.documentElement`，`z-index:2147483647`；`.viewer-container` 由 MutationObserver 移入画廊 overlay 内。

---

## Agent修改代码强制约束（最高优先级）

1. **版本号 `YY.M.D-vN`，跨天序号重置 v1**（规范详见 ReadMe「更新日志」开头）。改脚本 → 递增头部 `@version`；改 `relay-server/server.js` → 递增 `relay-server/package.json` 的 `version`；每次改动在 ReadMe「更新日志」顶部补一条。
2. **禁止给 `relay-server` 增加 npm 依赖/构建步骤**（部署无 npm install）。
3. **不得无理由重构可运行逻辑**（尤其弹窗 CSS、长轮询/广播机制、CAT_UI 用法）。改前先读 ReadMe 更新日志对应条目——多数"诡异写法"是真实浏览器实测结论。
4. **新依赖必须记录**：同步更新 ReadMe「技术栈」与「项目结构」（依赖清单唯一归属 ReadMe，agent 不另存）。
5. **硬编码尽量迁移配置**：脚本端用户可配置项进 `DEFAULTS`，常量进 `CONFIG`。
6. **GitHub 资源引用存「GitHub 网页链接」**，运行时经 `resolveGithubUrl()` + `useCdn` 转 jsDelivr/raw；勿在 `DEFAULTS` 存 CDN 成品链接。
7. **新增 GM API 必须补 `@grant`**；`@match` 含税务页与 example.com（调试宿主），勿乱动。
8. **保持现有风格**：中文注释/日志、语义前缀（`[监控]` `[设备互联]` 等）、JSDoc；提交前 `node --check <file>` 两文件均需通过。
9. **双向互传类改动 = 两端同步 + 重启 + 版本说明**（脚本 `@version`、服务端 version 各自递增）。
10. 涉及部署/容器/路径以 `.github/workflows/deploy.yml` 为准，勿硬编码别处。
11. **发现 ReadMe 与代码不符 → 直接修 ReadMe**（本仓库文档已多次过期），不在 agent.md 建长期对照表；修正后改代码处如有注释也一并更新。

## 历史踩坑索引（完整来龙去脉见 ReadMe 更新日志对应版本，此处只留指针 + 一句规则）

| 领域 | 一句话规则 | 详见 ReadMe 版本条目 |
|---|---|---|
| 弹窗层叠/透字/半透明 | 挂 `documentElement` + `z-index:2147483647` + `!important`；遮罩半透明用 `background:rgba()` 而**非** `opacity`（会把子元素带透） | v26.7.26-v12~v16、v26.7.29-v9~v10 |
| Viewer.js 预览层级 | 预览容器由 MutationObserver 移入本弹窗 overlay 内（页面 body transform 会困住挂 body 的 Viewer） | v26.7.29-v10 |
| CAT_UI 组件白名单 | `Switch`/`TimePicker`/`Image` 实为 undefined，裸 `input`/`img` 触发 React #137；开关用受控 checkbox/div 模拟 | v26.7.29-v6/v7 |
| 图片复制 | `GM_setClipboard(blob)` 在 ScriptCat 静默无效（仅文本）；唯一可靠路径 = 页面主世界 `unsafeWindow.navigator.clipboard.write`（PNG） | v26.7.26-v4~v8 |
| server.js 内联模板串 | 反斜杠（`\.svg`）易被吞；残留引用导致线上静默异常；改后 `node --check` + 渲染脚本 `new Function` 自检 | relay v26.7.28-v6、v26.7.29-v8 |
| arco focus-lock 打架 | 弹窗内 button 设 `tabIndex=-1` + mousedown `preventDefault` | v26.7.29-v8 |
| bind 挂载失联 | git reset 更新挂载源会替换 inode 使 bind 失联，stop/start/restart 都不重绑；正解 = tar 管道直写容器 `/app` 再 restart | deploy.yml 注释 |

## 技术债务

- **FingerprintJS**：`@require` 引入（fp@5）但代码无调用点 → 遗留依赖，可整行删除（ReadMe「技术栈」已不再列出）。
- **画廊两端重复实现**（脚本端 / server.js 手机页）：无共享模块，改动成本翻倍（见「复用代码溯源」）。
- **无自动化测试**：仅 `node --check` 语法校验 + 人工/浏览器实测；服务端无类型声明。（服务端正反向逐行镜像已由 `createChannel()` 工厂消除，relay v26.9.6-v1。）
