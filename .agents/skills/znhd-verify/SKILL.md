---
name: znhd-verify
description: >
  Use when finishing any change in the znhd-service repo (Tampermonkey userscript + relay-server),
  before committing or reporting done. Runs the repo's verification gate and tells you exactly what
  each check must show. Triggers on: 改完代码/准备提交/收尾自检/验证/verify/构建/冒烟/
  "帮我把改动验证一遍" or any edit under src/, config/, scripts/smoke/, relay-server/, web/.
---

# znhd 收尾验证门禁（本仓库自有 Skill）

> 对应 antd 官方《如何用 AI 和 Skills 降低维护成本》的做法：**把仓库已确认的重复检查固化进 Skill，规则变了就跟着改这里**。
> 本文件与 `AGENT.md`「前置强制规则」「Agent修改代码强制约束」互为补充：AGENT.md 说"必须做"，这里说"怎么做、看到什么才算过"。

## 何时用

- 任何 `src/`、`config/`、`scripts/smoke/`、`relay-server/`、`web/` 下的改动完成之后；
- 准备 `git commit` / `git push` 之前（**未经用户明确许可不得 push**，见 AGENT.md 前置规则第 6 条）；
- 声称"改好了"之前。**不要只凭"命令没报错"就宣称完成**——本仓库出现过构建失败被输出截断掩盖、产物仍旧的情况。

## 必跑的四项（全部在仓库根执行）

```bash
npm run typecheck     # tsc --noEmit，strict；期望：无任何输出/0 错
npm run build         # = lint:fix + webpack prod；期望：compiled successfully，且产物确实更新
npm run check         # node --check 产物 + relay-server/*.js；期望：无输出
npm run verify        # 无头端到端冒烟（puppeteer）；期望：全绿 ALL-OK
```

- 改了 antd 代码再补一项：`cd web && npx -y @ant-design/cli lint ./src --format json` 或仓库根 `npx -y @ant-design/cli lint ./src --format json`，**必须 `issues: []`**。
- 改了 `web/`（手机页）再补：`npm run typecheck:web` + `npm run build:web`，并确认**内容**无漂移 —— ⚠️ 本机（Windows）`git status` 有 **stat 假阳性**，不要只看它：用 `git hash-object --path=<f> <f>` 与 `git rev-parse HEAD:<f>` 逐文件比对，或确认 `git diff --raw -- relay-server/public` 为空（原因见 AGENT.md 踩坑索引「本地 Windows 构建误报产物漂移」）。

## 每项必须亲眼确认的点（否则等于没跑）

1. **构建成功不能被截断的输出掩盖**：`npm run build` 后用 `Select-String -Pattern 'compiled|ERROR'` 之类看**结论行**，别只看最后一行。
2. **产物里真的包含本次改动**：改 JS 就搜个独有字符串、改 CSS 就搜对应属性名、改版本号就核对 `@version`。**只跑命令不验证产物 = 未验证。**
3. **脚本元信息完整**（开压缩后尤其重要）：`==UserScript==` 成对，`@version`/`@require`/`@grant`/`@match`/`@icon`/`@updateURL` 齐全——元信息被压掉脚本直接装不上。
4. **冒烟断言数只增不减**：当前 `run.js` **48 项**（另有 `relay.js` 13 项、`phone-page.js` 10 项）；新增功能应顺手加断言，而不是删掉碍事的断言。若某条断言因**被测对象消失**而失效（如组件被替换），要把它**改到同类对象上**而不是删除。
5. **DOM 断言前先 dump 真实类名**：antd v6 与 v5 的类名多处不同（`.ant-drawer-content`→`.ant-drawer-section`、`.ant-modal-content` 亦已改名）。优先用 v5/v6 通用的 `.ant-modal-body`/`.ant-modal-wrap`/`.ant-drawer-body`。
6. **失败先分清是产物问题还是测试问题**：本仓库多次出现「断言写错元素 → 假通过/假失败」（量外层 span 而非 svg、用旧类名）。**能反向验证就反向验证**（临时关掉修复 → 断言应变红），这是区分二者的最可靠手段。

## 假红 / 假绿的两种已知形态（先查这里，别改源码）

- **`npm run typecheck:web` 报一大堆与源码无关的错**（`TS2488 … must have a '[Symbol.iterator]()' method`、`ReactNode[]` 不可赋给 `ReactNode`、`Timeout` 不可赋给 `number`，而根 `typecheck` 与 `verify:web` 都是绿的）⇒ 十有八九是 `web/node_modules` 又被掏空（`typescript/lib` 文件缺失 ⇒ `Symbol.iterator` 从程序里消失）。先在 `web/src/` 放一个纯元组解构探针确认（也会报 TS2488），再 `npm --prefix web ci` 重装、复跑即绿；**不要为此改源码**。
- **`npm run verify:smoke` 全红、页面报 `Cannot access 'XXX' before initialization`** ⇒ 循环 import 的 TDZ（模块级常量读了 `panelHost` 的顶层 const）。const 必须放叶子模块 `src/lib/ui/panelIds.ts`；`typecheck` / `build` 都不会报，只有这条门禁抓得到。

## 输出要求

- 给用户的结论里必须包含：**跑了哪些检查、每项结果、以及没有覆盖到的部分**（例如真实税务页需登录，本地无法覆盖）。
- 任何一项没过，不得声称完成；必须说明失败原因与下一步。
- 与 `AGENT.md` 第 5 条「任务收尾自检」联动：验证通过后追加 `.workbuddy/memory/YYYY-MM-DD.md`。
