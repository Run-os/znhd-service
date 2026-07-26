# 征纳互动人数和在线监控 v2

## 项目简介

**征纳互动人数和在线监控** 是一个油猴用户脚本（UserScript），用于实时监控 [征纳互动平台](https://znhd.hunan.chinatax.gov.cn:8443/) 的等待人数和在线状态。当有纳税人等待时自动语音播报提醒，支持自定义常用语快速回复，帮助坐席人员及时响应。

### 核心特性

- **实时人数监控**：每 3 秒自动检测等待人数，有人等待时语音播报提醒
- **掉线检测**：自动检测平台掉线弹窗，及时语音告警
- **语音播报**：基于 Web Speech API，支持一键开关，带语音队列管理避免播报冲突
- **常用语管理**：从远程 YAML 配置文件加载常用语，数据源地址可在设置面板自定义，支持关键字搜索过滤，一键复制并填入 TinyMCE 编辑器；内置 2 小时本地缓存，相同数据源在有效期内打开抽屉不再重复请求
- **工作时间限定**：仅在工作时间段（默认上午 9:00-12:00，下午 13:30-18:00，可在设置面板调整）内执行监控，非工作时间自动暂停
- **手机传图到电脑（图片→剪贴板）**：手机扫码或打开本机专属链接，选图（前端自动压缩）后图片经中继服务器转发到本机，点「复制到剪贴板」即可在征纳互动 Ctrl+V 粘贴；每台电脑有稳定独立的设备 ID，A、B 各自链接互不影响
- **操作日志**：面板内嵌日志查看器，按类型（信息/警告/成功/错误）着色显示
- **提示音反馈**：复制常用语时播放提示音，提供操作确认

## 项目结构

```
znhd-service/
├── public/
│   ├── commonPhrases.yaml       # 常用语配置文件（YAML 格式，当前使用）
│   ├── 常用语.json              # 常用语配置文件（JSON 格式，已废弃）
│   └── dida.mp3                 # 操作提示音文件
├── ReadMe.md                    # 项目说明文档
├── relay-server/                 # 手机传图配套中继服务（Node，需自行部署到公网）
│   ├── server.js               # 中继服务器：手机上传页 + 长轮询取图（纯 Node 内置 http，零依赖）
│   └── package.json          # 零依赖，运行：node server.js
└── znhd.user.js                 # 油猴脚本主文件
```

## 快速开始

### 1. 安装油猴扩展

在浏览器中安装 [Tampermonkey](https://www.tampermonkey.net/) 或 [ScriptCat（脚本猫）](https://scriptcat.org/) 扩展。

### 2. 安装脚本

**方式一：在线安装（推荐）**

访问脚本主页 [https://scriptcat.org/zh-CN/script-show-page/3650](https://scriptcat.org/zh-CN/script-show-page/3650)，点击"安装此脚本"按钮。

**方式二：手动安装**

1. 打开 [`znhd.user.js`](znhd.user.js:1) 文件，复制全部内容
2. 点击油猴扩展图标 → 创建新脚本
3. 粘贴内容并保存（Ctrl+S）

### 3. 开始使用

1. 访问征纳互动平台：https://znhd.hunan.chinatax.gov.cn:8443/
2. 脚本自动启动，右下角出现"征纳互动监控"浮动面板
3. 面板显示当前版本号、语音播报开关、设置和常用语入口

## 功能详解

### 监控面板

脚本在页面右下角创建一个可拖拽的浮动面板，包含：

| 元素              | 说明                                                             |
|-------------------|------------------------------------------------------------------|
| 版本号            | 显示当前脚本版本（如 `v26.7.18`）                                |
| 🔊 语音 / 🔇 静音 | 一键切换语音播报状态，按钮颜色随状态变化（绿色=开启，红色=静音） |
| 设置              | 打开设置抽屉，可配置工作时间、常用语数据源地址，查看日志和脚本链接 |
| 常用语            | 打开常用语抽屉，加载并搜索常用语                                 |

### 人数监控与掉线检测

- **等待人数检测**：通过 DOM 选择器 `.count:nth-child(2)` 获取当前等待人数
  - 人数为 0：记录成功日志
  - 人数 > 0：触发语音播报"征纳互动有人来了"
- **掉线检测**：检测 `.t-dialog__body__icon` 弹窗元素
  - 发现"掉线"文本时：记录错误日志并语音播报"征纳互动已掉线"
- **工作时间限定**：非工作时间自动跳过检测，节省资源

### 语音播报

- 基于浏览器 `SpeechSynthesis` API，语言为 `zh-CN`，语速 `1.0`
- 内置**语音队列**：多条播报按顺序排队播放，避免同时播放导致冲突
- 静音状态下自动跳过播报，不清空队列
- 开启语音时自动初始化语音合成，解决浏览器 `not-allowed` 限制

### 常用语功能

1. 点击"常用语"按钮打开抽屉，自动从**设置面板中配置的常用语数据源**加载（默认 [`public/commonPhrases.yaml`](public/commonPhrases.yaml:1)，可在「设置 → 常用语数据源」处修改地址）
2. 支持**关键字搜索**：可按按键名称或内容过滤常用语
3. 点击常用语按钮后：
   - 自动复制文本到剪贴板（优先使用 `GM_setClipboard`，降级到 `navigator.clipboard`）
   - 播放提示音（`dida.mp3`）
   - 将文本追加到页面 TinyMCE 编辑器中（自动处理换行和空输入框场景）
4. 支持"重新加载"按钮手动刷新常用语数据（强制跳过缓存）
5. **本地缓存**：加载成功后缓存数据、数据源 URL 与时间戳；2 小时内再次打开抽屉（且数据源 URL 未变）直接复用缓存、不发网络请求，面板日志会提示「使用本地缓存」；修改数据源地址或点击"重新加载"会重新拉取
5. 常用语数据源地址可在「设置 → 常用语数据源」中自定义：粘贴你自己的 YAML 地址即可让团队使用各自的常用语；修改后需点"重新加载常用语"生效，留空则恢复默认地址

### 日志系统

- 设置抽屉内嵌日志查看器，最多保留 20 条记录
- 日志按类型着色：
  - 🔵 信息（info）
  - 🟠 警告（warning）
  - 🟢 成功（success）
  - 🔴 错误（error）
- 自动过滤连续重复日志，避免刷屏

### 手机传图到电脑（图片→剪贴板）

适用场景：坐席在手机上有纳税人发来的图片（如身份证、资料截图），想快速发到电脑剪贴板，直接在征纳互动聊天框 Ctrl+V 粘贴。

**工作流程**：
1. 每台电脑首次运行脚本时用 `crypto.randomUUID()` 生成并持久化一个**稳定设备 ID**（存在 `GM_setValue`，刷新/重开不变）；
2. 面板「手机传图」抽屉展示本机专属上传链接 `https://<中继服务器>/u/<设备ID>` 及对应二维码（**二维码由脚本端 qrcodejs 本地生成，无需服务器参与**）；
3. 手机浏览器打开该链接（或直接扫二维码）→ 选图/拍照 → 手机端用 canvas 自动压缩（最大边 1600px、JPEG 质量 0.75）→ 上传到中继服务器；
4. 电脑端脚本在「中继服务器」填好后**默认自动**用 `GM_xmlhttpRequest` **长轮询** `/recv/<设备ID>` 取回图片（无需点击按钮；长轮询而非 WebSocket 是为了绕过征纳互动页面的 CSP 对 connect-src 的限制）；
5. 收到图片后即在**网页正中弹出预览弹窗**（直接挂到 `document.body`，不受面板 transform 影响），点击弹窗内「复制到剪贴板」→ 浏览器把图片写入系统剪贴板（此步必须由一次点击触发，满足浏览器安全策略）→ 去征纳互动 Ctrl+V 即可；弹窗右上角可关闭。

**按用户隔离**：设备 ID 是每台电脑随机生成、几乎不可猜测的 UUID，因此 A 的电脑、B 的电脑各自持有不同链接与二维码，图片只进对应那台电脑，互不串。

**前置条件**：须自行部署配套 `relay-server`（见上方项目结构）。在「设置 → 中继服务器」填写该服务的公网地址（如 `https://你的服务器:端口`，末尾不带 `/`）后，抽屉内的链接与二维码才会生成。

## 配置说明

### 脚本内部配置

[`znhd.user.js`](znhd.user.js:32) 中的 `CONFIG` 对象（只读的运行参数）：

```javascript
const CONFIG = {
    CHECK_INTERVAL: 3000,    // 监控检查间隔（毫秒）
    MAX_LOG_ENTRIES: 20,     // 面板最大日志条目数
    didaUrl: '.../dida.mp3', // 提示音文件地址
    SPEECH_TIMEOUT: 15000    // 单条语音播报超时保护（毫秒），防止队列卡死
};
```

可用户配置项（工作时间、常用语数据源、语音开关）存放在 `DEFAULTS` 中，运行时存于 `localStorage`（键 `scriptCat_Allvalue`），可在设置面板直接修改，无需改代码：

```javascript
const DEFAULTS = {
    voiceEnabled: true,   // 语音播报开关
    workingHours: {       // 监控时间段（单位：十进制小时，13.5 = 13:30）
        morningStart: 9, morningEnd: 12,
        afternoonStart: 13.5, afternoonEnd: 18
    },
    commonPhrasesUrl: 'https://gitee.com/runos/znhd-service/raw/master/public/commonPhrases.yaml',
    relayServer: ''        // 手机传图中继服务器公网地址（如 https://你的服务器:端口），留空则功能不可用
};
```

### 常用语配置

常用语配置文件为 [`public/commonPhrases.yaml`](public/commonPhrases.yaml:1)，采用 YAML 格式。每个键为按钮显示名称，值为点击后填入编辑器的文本内容。

配置示例：

```yaml
未办理税务登记: |
  【未办理税务登记】
  ●打开 https://etax.hunan.chinatax.gov.cn:8443/xxbg/view/ztxxbg/qssbswzxblwkyqs ，自行打印清税证明
  ●如果上述方法无法正常打印，这边可以给您出具一个未涉税事项证明，需要您通过法人身份登录征纳互动，并将营业执照和法人身份证发送过来

已办理税务登记: |
  【已办理税务登记】
  ●请先和您的税管员取得联系，税管员同意之后，进入电子税务局电脑端，搜索清税申报（税务注销办理）即可，详细操作流程：https://mp.weixin.qq.com/s/JqIEoAqo-BqWqSCrQYGuMQ
```


## 技术栈

| 技术                                                                              | 用途                                                                                                  |
|-----------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| JavaScript (ES6+)                                                                 | 脚本主语言                                                                                            |
| [脚本猫UI库](https://scriptcat.org/lib/1167)                                      | 浮动面板、抽屉、按钮等 UI 组件                                                                        |
| [js-yaml](https://github.com/nodeca/js-yaml)                                      | 解析 YAML 格式的常用语配置文件                                                                        |
| [FingerprintJS](https://github.com/fingerprintjs/fingerprintjs)                   | 浏览器指纹识别                                                                                        |
| [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) | 语音合成播报                                                                                          |
| [GM API](https://www.tampermonkey.net/documentation.php)                          | `GM_xmlhttpRequest`、`GM_setClipboard`、`GM_notification`、`GM_getValue`/`GM_setValue` 等油猴扩展 API |
| [relay-server](relay-server/server.js:1)                                            | 手机传图配套中继服务：纯 Node 内置 `http`（零依赖），手机上传页内联、电脑端长轮询取图；需部署到公网 |

## 浏览器兼容性

- Chrome / Edge 88+
- Firefox 85+
- Safari 14+

> 需要安装 Tampermonkey 或 ScriptCat 扩展以提供 GM API 支持。

## 常见问题

### 语音播报不工作

1. 检查浏览器是否支持 Web Speech API（在控制台输入 `'speechSynthesis' in window` 应返回 `true`）
2. 确认面板上语音按钮显示为"🔊 语音"（绿色），而非"🔇 静音"（红色）
3. 浏览器可能需要用户首次交互后才能播放语音，尝试点击页面任意位置后再试

### 常用语加载失败

1. 检查网络是否能访问 `gitee.com`（常用语配置文件托管在 Gitee）
2. 打开浏览器开发者工具（F12）→ Console 查看具体错误信息
3. 尝试点击常用语抽屉中的"重新加载常用语"按钮

### 监控不工作

1. 确认当前时间是否在工作时间内（上午 9:00-12:00，下午 13:30-18:00）
2. 确认征纳互动平台页面已完全加载
3. 打开设置抽屉查看日志面板，了解详细状态

### 手机传图功能用不了
1. 确认已在「设置 → 中继服务器」填写公网可访问的服务器地址（如 `https://你的服务器:端口`，末尾不带 `/`）
2. 中继服务器需自行部署：进入 `relay-server/` 目录执行 `node server.js`（纯 Node 内置模块、零依赖，默认端口 3000，可用 `PORT` 环境变量修改）
3. 该服务器必须能从手机浏览器公网访问；仅本机 `localhost` 时手机无法连上
4. 打开「手机传图」抽屉后，用手机扫二维码或打开链接上传，电脑端点「开始接收」，收到后点「复制到剪贴板」

### 常用语点击后未填入编辑器

1. 确认页面中存在 TinyMCE 编辑器（输入区域）
2. 检查浏览器控制台是否有 iframe 跨域相关错误
3. 脚本会自动降级处理：优先使用 TinyMCE API，失败后直接操作 DOM

## 更新日志

### v26.7.26-v7
- **加快大图复制**：原 `blobToPng` 对整张原图（手机常 4000px+）做全分辨率解码 + canvas + PNG 无损编码，大图点击「复制」后卡顿明显。
- 改为 `prepareClipboardImage`：写入前先降采样到**最大边 1600px** 再编码 PNG，像素数降至约 1/6，解码/内存/PNG 编码同步变快；已在限制内的小图不降采样。仅当「原图直写」失败（内核仅支持 image/png）时才走此预处理。
- 仍零客户端依赖；若追求极致速度，可在中继服务器用 `sharp`(libvips) 在上传时预处理，使电脑端收到即小图、无需任何客户端编码（需给 relay-server 加原生依赖，按需启用）。

### v26.7.26-v6
- **修复「复制成功但剪贴板无图」假成功**：根因是旧实现把 `GM_setClipboard(blob, type)` 作为图片复制首选项——而 ScriptCat 的 `GM_setClipboard(data:string)` 仅支持文本，传 Blob 时**不报错也不真正写图**，导致 `resolve(true)` 误报成功。
- 改为：图片复制**唯一可靠路径 = 页面主世界 `unsafeWindow.navigator.clipboard.write`**（先拿原始 blob 直接写以保留点击手势，失败再统一转 PNG 重试）；隔离世界同名 API 作兜底；**彻底移除不可靠的 `GM_setClipboard` 图片分支**。
- 弹窗「复制到剪贴板」按钮文案随真实结果变化（成功→绿色"已复制，去 Ctrl+V"；失败→"复制失败，请长按图片保存"）。

### v26.7.26-v15
- **真正修复弹窗「透出文字」（浏览器实测坐实）**：在连着的真实 Chrome 里测量运行中的弹窗，发现遮罩 `overlayComputedOpacity = 0.8`（实测 `runningPopupVersionMarker = "znhd v26.7.26-v14"`），即**弹窗遮罩自身带 `opacity:0.8`**——黑底只盖 80%，故透出后面文字。关键 CSS 机制：`opacity<1` 会把元素与其**全部子元素（白框/图片/按钮）整体压成同透明度一起半透明**，所以一透全透。
- 同时实测：遮罩 `overlayRect = {0,0,1774,950}` 已**铺满视口**、`bodyTransform=none`、挂到 `<html>` 也正常——证明「`body` 的 transform 改写 fixed 包含块」**并非本例真因**（旧推断被实测推翻）。
- 修复：给弹窗 `overlay`/`box`/`ver`/`close`/`copyBtn` 全部内联加 `opacity:1!important`（内联 `!important` 优先级最高，能压过任何旧副本或全局 CSS）。**现场验证**：在运行中的旧弹窗上注入 `opacity:1!important`，计算透明度即时由 `0.8 → 1`，证明修复有效。
- 教训：此前多版推断（半透明遮罩背景、`body` transform、CAT_UI 污染、旧脚本未重载）均被实测数据逐一排除；最终靠"测量运行中弹窗的计算样式"而非"读代码猜"才定位。版本标记右下角同步改为 `v15`。

### v26.7.26-v16
- **遮罩改回半透明、但弹窗与图片保持不透明（标准模态效果）**：用户要求背景半透明（能隐约看到页面），但白色弹窗框与图片本身不透明。
- 关键 CSS 机制（v15 已确认）：`opacity<1` 会令元素与**其全部子元素**一起半透明，故**不能**用 `overlay{opacity:0.55}` 实现。正确做法：`overlay` 保持 `opacity:1!important`，只让**背景色**用半透明 `rgba(0,0,0,0.55)!important`——这样只有"背景那层黑"是透的，而 `box`(白底 `#fff`)/`img`(JPEG 不透明) 各有自己的不透明背景，互不影响，弹窗与图片完全不透明。
- 改动 `znhd.user.js`：`overlay` 背景由 v15 的纯黑 `#000!important` 改回 `background:rgba(0,0,0,0.55)!important`；`overlay`/`box`/`ver`/`close`/`copyBtn` 的 `opacity:1!important` 全部保留。版本标记右下角 → `v16`，`@version`→`26.7.26-v16`；语法 `node -c` 通过。

### v26.7.26-v20
- **修复"连上服务器"日志误报「连接服务器超时」**：v19 用 `/health` 即时探测触发 `onConnected`，但用户运行的是**旧版中继**（无 `/health` 路由），该探测请求一直挂起、5 秒后超时报「连接服务器超时」；而真正的 `/recv` 接收始终正常，所以图片照收、`markConnected` 仍通过 `/recv` 的 `onload` 触发了「已自动开始接收」——两条日志同秒出现即此矛盾。
  - 彻底**删除 `checkConnectivity()` 与 `/health` 探测**（本身脆弱，依赖服务器有该端点）。
  - 改用「**首次 `/recv` 长轮询用极短 `maxwait=1000`**」快速确认已连上：服务器很快返回空响应即 `markConnected` → `onConnected` 触发「已自动开始接收」日志（约 1 秒内），后续轮询恢复 `maxwait=25000` 实时等待图片。
  - 真正的「连接服务器失败」仅在 `/recv` 首次 `onerror`（网络真不可达）时一次性提示，不再有矛盾的超时误报。
- 版本标记右下角 → `v20`，`@version`→`26.7.26-v20`；语法 `node -c` 通过。

### v26.7.26-v19
- **「已自动开始接收」日志时机再定为"连上服务器即立即显示"（推翻 v18）**：用户澄清——日志应在**脚本连上服务器时立即**出现，而非手机发送/收到图片之后。v18 的 `onImage` 写法被撤销。
  - `startPhoneReceive` 新增 **`/health` 即时连通性探测**（`checkConnectivity()`，在 `poll()` 前调用）：GM_xhr `GET /health`，**一旦服务器响应就 `markConnected()` 触发 `onConnected` → 日志立即显示**。此方案在 v20 被推翻（见下）。
  - 长轮询 `onload` 内的 `markConnected()` 保留作兜底（`connected` 标记去重，不会重复打日志）。
  - 自动接收 `useEffect` 把该 `addLog` 重新移回 `onConnected` 回调（与 v17 一致），地址末尾 `/` 一并归一 `replace(/\/+$/,'')`。
- **中继服务器地址填写时自动去尾斜杠（请求 #3）**：设置输入框 `onChange` 在校验前加 `url = url.trim().replace(/\/+$/, '')`——用户粘贴 `http://x:5689/` 这类带 `/` 的地址会被即时处理为 `http://x:5689` 再保存/显示。`startPhoneReceive` 与手机传图抽屉拼链接处本就归一，显示链接始终干净。
- 版本标记右下角 → `v19`，`@version`→`26.7.26-v19`；语法 `node -c` 通过。

### v26.7.26-v18
- **「已自动开始接收」日志时机再修正**：v17 改为"连上服务器（首次轮询 `onload`）才显示"，但长轮询即便未收到图片也会在 `maxwait` 后返回空响应，导致该日志仍会在脚本一启动轮询（约 25s 内）就打出，并非手机发送后。
  - 现改为：日志移到 `onImage` **首次真正收到手机图片** 时才 `addLog`，即**手机端点击发送之后**才显示「`[手机传图] 已自动开始接收（…）`」。用 `firstImageLogged` 标记去重，避免后续每张图都刷该日志。
  - 自动接收 `useEffect` 删除 `onConnected` 用法（该回调改为不再用于此日志）。
- 版本标记右下角 → `v18`，`@version`→`26.7.26-v18`；语法 `node -c` 通过。

### v26.7.26-v17
- **设置面板排版调整**：删除「常用语数据源」「中继服务器（手机传图）」两个分隔标题（Divider）；「常用语数据地址」与「中继服务器地址」两项内容直接并入「其他设置」分组之下（去掉各自标题、保留说明文字与输入框）。
- **「已自动开始接收」日志改为"连上服务器后才显示"**：原逻辑在 `relayServer` 一填好就立刻 `addLog('[手机传图] 已自动开始接收…')`，此时其实还没连通服务器，属误报。
  - `startPhoneReceive` 新增 `onConnected` 回调：长轮询首次 `onload`（真正收到服务器响应）时 `markConnected()` 触发一次 → 仅此时才打「已自动开始接收」日志（含服务器地址）。
  - 顺带：连不上时（`onerror`）打**一次性**「[手机传图] 连接服务器失败，请检查中继地址/网络（…）」错误日志（`loggedConnFail` 去重，避免 2s 轮询刷爆），不再静默让用户误以为已连。
  - 自动接收 `useEffect` 把该 `addLog` 从「启动前」移入 `onConnected` 回调内。版本标记右下角 → `v17`，`@version`→`26.7.26-v17`；语法 `node -c` 通过。

### v26.7.26-v14
- 弹窗加固（防御性，但**非本 bug 真因**，实测推翻）：遮罩改挂到 `document.documentElement`（`<html>` 而非 `<body>`），以规避个别 SPA 在 `body` 施加 `transform`/`filter`/`will-change`/`contain` 改写 `position:fixed` 包含块、导致遮罩偏移的可能；并加 `!important` + 铺满 `100vw/vh` 双保险、右下角显版本标记、加自动诊断日志。
- ⚠️ 事后实测（v15）表明：本例真实页面 `bodyTransform=none` 且遮罩已铺满视口，故 transform 偏移理论**不成立**；真因是遮罩自身 `opacity:0.8`（见 v15）。v14 的 `documentElement` 挂载与 `!important` 仍保留作为防御层。

### v26.7.26-v13
- **弹窗透字自动诊断**：用户确认 ScriptCat 实际运行的是 v12（排除"旧版半透明遮罩"假设）。v12 遮罩 `#000`+`!important`+铺满 `100vw/vh` 且 CAT_UI 样式隔离，逻辑上不应透字，故"仍透字"只可能来自外部：①更高/同级半透明元素遮挡；②祖先 `transform` 把 `position:fixed` 限制住、遮罩未真正铺满视口。
- 新增**弹窗出现即自动诊断**：在 Console 打印 `[znhd弹窗诊断]` 一行，含视口/遮罩尺寸、computed 背景色、`document.elementsFromPoint` 中心点元素栈（顶→底），并据此 warn：遮罩非最顶层(有遮挡) / 背景非纯黑(被外部样式覆盖) / 遮罩未铺满视口(疑祖先 transform 限制)。用户重装后看一行日志即可定位。

### v26.7.26-v12
- **排查"弹窗仍半透明"**：经核查 CAT_UI 库源码，其样式**全部带 `.ar.co-` 前缀且面板在 Shadow DOM 内**，页面级无任何无前缀全局规则（`adoptedStyleSheets` 0 次、`document.head` 仅用于加载脚本），故**面板半透明不会影响挂在 `document.body` 的弹窗**。
- 弹窗仍透字的最大可能 = **ScriptCat 实际跑的仍是旧版遮罩 `rgba(0,0,0,0.55)`**（与面板半透明是两回事）。
- 加固：① 弹窗全部样式加 `!important`、遮罩铺满 `100vw/vh`，隔绝任何外部 CSS 覆盖；② 弹窗右下角显示版本号 `znhd v26.7.26-v12`，一眼确认加载版本，终结"改了却没生效"的扯皮。

### v26.7.26-v11
- **加固弹窗遮罩必定铺满全屏**：遮罩定位由 `inset:0` 简写改为显式 `top/left/right/bottom:0`，规避个别内核不识别 `inset` 导致遮罩未铺满、从而露出底层页面文字的可能；背景保持 `#000` 实心不透明。

### v26.7.26-v10
- **图片弹窗遮罩改为完全不透明**：原遮罩背景为 `rgba(0,0,0,0.55)`（半透明，会透出底层页面），现改为纯黑 `#000` 不透明，弹窗显示时不再透出后面页面内容。

### v26.7.26-v8
- **修复「复制到剪贴板」点击后长时间等待**：根因是 PNG 重编码（`createImageBitmap`+`canvas.toBlob`）发生在**点击时**，卡在点击与「已复制」之间。改为**图片到达弹窗显示时即在后台预转换好 PNG**，点击直接写入、零转换、即时响应。同时移除「先尝试原图 jpeg」的浪费分支（ScriptCat 内核仅可靠支持 `image/png`，该尝试必失败再转 PNG）。`prepareClipboardImage` 对已是 PNG 的图直接复用、不再重编码。

### v26.7.26-v7
- **大图复制提速（客户端降采样）**：`blobToPng` 改为 `prepareClipboardImage`，在退回 PNG 时先按最大边 1600px 降采样再编码，解码内存/Canvas 分配/PNG 编码同步变快；小图不降采样。仅在「原图直写」失败（内核仅支持 `image/png`）时触发。

### v26.7.26-v6
- **修复图片复制「假成功」**：旧代码把 `GM_setClipboard(blob, type)` 放最优先，而 ScriptCat 该 API 仅支持文本，传 Blob 会静默无效且 `resolve(true)` 报成功、剪贴板却为空。改为**唯一可靠路径 = 页面主世界 `unsafeWindow.navigator.clipboard.write`**（先试原始 blob 直写以保留点击手势，失败再转 PNG 重试），彻底移除假成功的 `GM_setClipboard` 图片分支。

### v26.7.26-v5
- **图片复制再加固（依据异步 Clipboard API 文档）**：文档指出 Chromium 内核 `navigator.clipboard.write` 对图片**只可靠支持 `image/png`**，而中继转发的是手机原图（多为 `image/jpeg`）。新增 `blobToPng()`（用 `createImageBitmap`+Canvas 转 PNG，best‑effort）在写入前统一转 PNG，规避该限制。各级兜底（GM_setClipboard / unsafeWindow 页面主世界 / 隔离世界）均改为写 PNG。

### v26.7.26-v4
- **修复手机图片复制到剪贴板失败**：原 `copyImageToClipboard` 只走 `navigator.clipboard.write`，而 ScriptCat 隔离世界里 `ClipboardItem` 全局常不存在 → 直接判定失败。改为三级兜底：①`GM_setClipboard(blob,type)`（扩展特权）②**页面主世界 `unsafeWindow.navigator.clipboard.write` + `unsafeWindow.ClipboardItem`**（HTTPS 页面下必定可用，保留点击手势）③原隔离世界写法。
- **图片弹窗关闭按钮美化**：右上角「×」改为红底白字圆形按钮（`#e4393c`，hover 加深为 `#c9302c`）。

### v26.7.26-v3
- 「手机传图」改为**默认自动接收**：「设置 → 中继服务器」填好公网地址（默认 `http://45.207.199.216:5689`）后脚本即自动长轮询取图，**移除「开始/停止接收」按钮**，无需手动点击
- 收到图片时在**网页正中弹出预览弹窗**（直接挂到 `document.body`，不受 CAT_UI 面板 transform 影响）：含底部「复制到剪贴板」按钮与右上角关闭按钮
- `@version` 按 `YY.M.D-vN` 规范递增为 `26.7.26-v3`

### v26.7.26-v2
- 「手机传图」二维码改为**脚本端本地生成**：引入客户端库 qrcodejs（`@require`），抽屉内用 `new QRCode` 渲染后读取 `canvas.toDataURL()` 显示，二维码本地秒出、不再依赖服务器
- 中继服务器 `relay-server` 移除 `/qr` 端点与 `qrcode` 依赖，现为**纯 Node 内置 http、零依赖**，仅保留手机上传页、`/recv` 长轮询取图、`/health`
- `@version` 按 `YY.M.D-vN` 规范递增为 `26.7.26-v2`

### v26.7.26-v1
- 新增「手机传图到电脑」功能：手机图片经中继服务器转发到本机剪贴板（在征纳互动聊天框 Ctrl+V 粘贴）
- 每台电脑生成稳定设备 ID（`GM_setValue` 持久化），拼出独立上传链接 `/u/<ID>` 与二维码，实现 A/B 按用户隔离
- 中继服务器 `relay-server/server.js`（纯 Node 内置模块 + qrcode）：托管手机上传页（前端 canvas 压缩）、`/recv/<ID>` 长轮询取图、`/qr` 服务端生成二维码
- 电脑端用 `GM_xmlhttpRequest` 长轮询取图（绕过税务页面 CSP 对 connect-src 的限制），收到后「复制到剪贴板」按钮触发 `navigator.clipboard.write` 写图片
- 设置面板新增「中继服务器」地址配置项；`@version` 按 `YY.M.D-vN` 规范递增为 `26.7.26-v1`

### v26.7.19-v2
- 语音队列增加长度上限（`CONFIG.MAX_SPEECH_QUEUE=10`）：连续产生大量播报时，超出部分丢弃最早（最旧）的消息，避免内存堆积
- 新增过期清理：队列消息超过 `CONFIG.SPEECH_QUEUE_TTL=30s` 视为过期，`speak()` 入队与 `processSpeechQueue()` 播放前均会剔除，避免播报过时内容
- 新增 `clearSpeechQueue()`：语音开关从开启切换为关闭时立即清空队列（并 `speechSynthesis.cancel()` 中止当前播报），防止旧消息堆积、再次开启时集中涌出
- 队列元素结构调整：由直接存 `SpeechSynthesisUtterance` 改为 `{ utterance, enqueuedAt }`，`enqueuedAt` 用于过期判断；语法校验通过

### v26.7.19-v1
- 为脚本内全部 32 个具名公开函数补全 JSDoc 注释：统一包含 `@description` 用途说明、`@param`（含名称/类型/说明，可选参数用 `[name]` 语法）、`@returns`（类型与说明）
- 覆盖范围：日志/存储管理、工具函数（时间/HTML 转义）、四个 UI 组件（LogPanel/SettingsDrawer/CommonPhrasesDrawer/DM）、面板位置跟踪模块、监控检测（checkCount/isWorkingHours 等）、语音播报（speak/processSpeechQueue）、复制与提示音（safeCopyText/playDidaSound）等
- 纯注释补充，不改变运行时行为；语法校验通过

### v26.7.18-v4
- 常用语新增本地缓存策略：加载成功后缓存数据、数据源 URL 与时间戳
- 打开常用语抽屉时，若 2 小时内已加载且数据源 URL 未变，直接复用本地缓存、跳过网络请求（面板日志提示「使用本地缓存」）
- 「重新加载常用语」按钮改为强制刷新（忽略缓存）；修改数据源地址也会触发重新拉取

### v26.7.18-v3
- 常用语数据源地址现可在设置面板自定义（「设置 → 常用语数据源」），默认仍为 gitee 上的 commonPhrases.yaml
- 数据源支持留空回退默认地址，并校验必须以 http(s):// 开头
- 同期累积改进（v1→v3）：面板位置拖拽持久化与边界约束、工作时间段可在设置面板配置、工作时间控件改为时间选择器、面板标题改用站点 favicon、确立 `YY.M.D-vN` 版本号规范

### v26.2.26
- 新增操作提示音功能（`dida.mp3`），复制常用语时播放
- 新增安全复制机制：优先 `GM_setClipboard`，降级 `navigator.clipboard`
- 常用语新增关键字搜索过滤功能
- 优化 TinyMCE 文本追加逻辑：自动检测输入框是否为空，智能处理换行
- 语音播报新增队列管理，避免多条播报冲突
- 日志系统新增重复内容过滤

### v26.2.23
- 删除 P2P 传输功能
- 删除图片复制功能
- 常用语数据源从 JSON 格式改为 YAML 格式

## 免责声明

本项目所有代码及脚本仅供学习、研究与个人非商业使用。

使用者需自行遵守所在网络环境及相关法律法规，严禁用于非法用途、商业用途或侵犯他人权益的场景。

使用本脚本所产生的一切风险、后果及法律责任均由使用者自行承担，项目作者不承担任何直接或间接责任。

如侵犯到您的权益，请联系项目维护者进行处理。

## 许可证

MIT License

## 联系方式

- **作者**：runos
- **项目地址**：https://gitee.com/runos/znhd-service
- **脚本主页**：https://scriptcat.org/zh-CN/script-show-page/3650
- **使用教程**：https://flowus.cn/runos/share/e48623a2-f273-4327-8597-639e08902be8?code=1YD5Z5

## 贡献

欢迎提交 Issue 和 Pull Request！