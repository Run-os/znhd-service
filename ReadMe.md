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
4. 电脑端脚本用 `GM_xmlhttpRequest` **长轮询**中继服务器的 `/recv/<设备ID>` 取回图片（长轮询而非 WebSocket，是为了绕过征纳互动页面的 CSP 对 connect-src 的限制）；
5. 收到图片后在抽屉内预览，点击「复制到剪贴板」→ 浏览器把图片写入系统剪贴板（此步必须由一次点击触发，满足浏览器安全策略）→ 去征纳互动 Ctrl+V 即可。

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