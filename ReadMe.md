# 征纳互动人数和在线监控 v2

## 项目简介

**征纳互动人数和在线监控** 是一个油猴用户脚本（UserScript），用于实时监控 [征纳互动平台](https://znhd.hunan.chinatax.gov.cn:8443/) 的等待人数和在线状态。当有纳税人等待时自动语音播报提醒，支持自定义常用语快速回复，帮助坐席人员及时响应。

### 核心特性

- **实时人数监控**：每 3 秒自动检测等待人数，有人等待时语音播报提醒
- **掉线检测**：自动检测平台掉线弹窗，及时语音告警
- **语音播报**：基于 Web Speech API，支持一键开关，带语音队列管理避免播报冲突
- **常用语管理**：从远程 YAML 配置文件加载常用语，数据源地址可在设置面板自定义，支持关键字搜索过滤，一键复制并填入 TinyMCE 编辑器；内置 2 小时本地缓存，相同数据源在有效期内打开抽屉不再重复请求
- **工作时间限定**：仅在工作时间段（默认上午 9:00-12:00，下午 13:30-18:00，可在设置面板调整）内执行监控，非工作时间自动暂停
- **设备互联到电脑（图片→剪贴板）**：手机扫码或打开本机专属链接，选图（前端自动压缩）后图片经中继服务器转发到本机，点「复制到剪贴板」即可在征纳互动 Ctrl+V 粘贴；每台电脑有稳定独立的设备 ID，A、B 各自链接互不影响
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
├── relay-server/                 # 设备互联配套中继服务（Node，需自行部署到公网）
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

### 设备互联到电脑（图片→剪贴板）

适用场景：坐席在手机上有纳税人发来的图片（如身份证、资料截图），想快速发到电脑剪贴板，直接在征纳互动聊天框 Ctrl+V 粘贴。

**工作流程**：
1. 每台电脑首次运行脚本时用 `crypto.randomUUID()` 生成并持久化一个**稳定设备 ID**（存在 `GM_setValue`，刷新/重开不变）；
2. 面板「设备互联」抽屉展示本机专属上传链接 `https://<中继服务器>/u/<设备ID>` 及对应二维码（**二维码由脚本端 qrcodejs 本地生成，无需服务器参与**）；
3. 手机浏览器打开该链接（或直接扫二维码）→ 选图/拍照（**支持多选，张数不限**，九宫格预览、可单张删除）→ 手机端用 canvas 逐张自动压缩（最大边 1600px、JPEG 质量 0.75；**SVG 例外：跳过压缩原样直传**，保留矢量与 `image/svg+xml` 类型；**HEIC/HEIF 例外：手机端用 heic2any（公共 CDN）解码转 JPEG 后同样铺白底压缩直传**，确保电脑端含 Windows 无需额外编解码器即可打开，库缺失时回退原样直传）→ 逐张按序上传到中继服务器（服务端按设备维护 FIFO 队列，内存保护上限 100 条）；**处理失败时状态栏会显示具体原因**（如「IMG.heic：图片解析失败 / 压缩失败」），便于排查。
4. 电脑端脚本在「中继服务器」填好后**默认自动**用 `GM_xmlhttpRequest` **长轮询** `/recv/<设备ID>` 取回图片（无需点击按钮；长轮询而非 WebSocket 是为了绕过征纳互动页面的 CSP 对 connect-src 的限制）；
5. 收到图片后即在**网页正中弹出九宫格画廊弹窗**（3 列缩略图，收到的图片自动累积、最多保留 27 张，直接挂到 `<html>`，不受面板 transform 影响）：**单击缩略图用 [Viewer.js](https://github.com/fengyuanchen/viewerjs) 放大查看**（缩放/旋转/多图左右切换），每张图下方「复制」按钮把图片写入系统剪贴板（此步必须由一次点击触发，满足浏览器安全策略）→ 去征纳互动 Ctrl+V 即可；「下载」按钮把原图存为文件（自动按原名/MIME 补扩展名）；每张右上角 × 可单独移除，底部「清空全部」，弹窗右上角关闭（图片保留，收到新图会再次弹出）。

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
    commonPhrasesUrl: 'https://cdn.jsdelivr.net/gh/Run-os/znhd-service@refs/heads/main/public/commonPhrases.yaml',
    relayServer: ''        // 设备互联中继服务器公网地址（如 https://你的服务器:端口），留空则功能不可用
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
| [relay-server](relay-server/server.js:1)                                            | 设备互联配套中继服务：纯 Node 内置 `http`（零依赖），手机上传页内联、电脑端长轮询取图；需部署到公网 |

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

1. 检查网络是否能访问 `github.com`（常用语配置文件托管在 github）
2. 打开浏览器开发者工具（F12）→ Console 查看具体错误信息
3. 尝试点击常用语抽屉中的"重新加载常用语"按钮

### 监控不工作

1. 确认当前时间是否在工作时间内（上午 9:00-12:00，下午 13:30-18:00）
2. 确认征纳互动平台页面已完全加载
3. 打开设置抽屉查看日志面板，了解详细状态

### 设备互联功能用不了
1. 确认已在「设置 → 中继服务器」填写公网可访问的服务器地址（如 `https://你的服务器:端口`，末尾不带 `/`）
2. 中继服务器需自行部署：进入 `relay-server/` 目录执行 `node server.js`（纯 Node 内置模块、零依赖，默认端口 3000，可用 `PORT` 环境变量修改；注：Node 端仍零依赖，仅手机端转换 HEIC 时需从公共 CDN 加载 heic2any，断网时 HEIC 回退原样直传）
3. 该服务器必须能从手机浏览器公网访问；仅本机 `localhost` 时手机无法连上
4. 打开「设备互联」抽屉后，用手机扫二维码或打开链接上传；中继地址填好后**脚本自动开始接收**（无需点按钮），收到后弹窗点「复制到剪贴板」
5. **中继服务更新后必须重启**才会生效（它常驻后台进程，不会自动热更）。若改过 `relay-server/server.js`，请先停掉旧进程再 `node server.js`（PM2/`systemd`/`docker` 对应 `restart`）。
6. **同一设备 ID 在多个标签页/浏览器同时开着会各自接收**：中继现已「广播」——每张图会同时推给所有在等待的接收端（你正在看的那个标签页一定会弹窗）。若只想在一个页面弹窗，关掉其余跑了脚本的标签页即可（例如调试用的 example.com）。

### 常用语点击后未填入编辑器

1. 确认页面中存在 TinyMCE 编辑器（输入区域）
2. 检查浏览器控制台是否有 iframe 跨域相关错误
3. 脚本会自动降级处理：优先使用 TinyMCE API，失败后直接操作 DOM

## 更新日志

### znhd.user.js v26.7.29-v11
- **支持 ESC 键关闭图片预览/文本弹窗**：图片放大预览（Viewer.js）弹出后，Viewer.js 自带的键盘监听在本脚本「把 `.viewer-container` 移入 `overlay`」的特殊处理 + 真实税务页面 body 常被加 transform 的环境下常常失效，导致 ESC 关不掉预览。新增一个独立的全局 `keydown` 监听兜底：① 预览（Viewer）可见时按 ESC 先退出预览回到画廊九宫格；② 画廊态按 ESC 直接关闭整个图片弹窗；③ 文本弹窗按 ESC 直接关闭。监听仅安装一次（自保护），按当前弹窗状态分支处理，与 Viewer.js 自带 ESC 互不冲突（幂等）。`@version`→`26.7.29-v11`。

### znhd.user.js v26.7.29-v10
- **修复收到图片弹窗「点缩略图放大后预览跑到弹窗后面 / 右上角关闭按钮消失」**：
  - 预览跑到弹窗后面：画廊 `overlay`（`z-index:2147483647`）与 Viewer 全屏预览容器（同样 `2147483647`）互相压制——Viewer 默认挂在 `body` 下、画廊挂在 `documentElement` 下，谁压谁取决于页面的层叠上下文（真实税务页面 body 常被加 transform/filter 形成独立层叠上下文，把挂 body 的 Viewer 困住，永远被画廊压后面）。修复：用 `MutationObserver` 监听 `.viewer-container` 出现即移入画廊 `overlay` 内部，使其处于本弹窗的层叠上下文之上（`vc.style.zIndex='2'`，高于白盒的 `1`），预览必定盖在白盒之上、且不受外部页面层叠上下文干扰；全屏预览时由 Viewer 自带 × 关闭回到画廊（标准模态交互）。（注：Viewer.js 该构建无 `on`/`addListener` 事件 API，故不依赖事件，改用 DOM 观察。）
  - 关闭按钮"消失/点不到"：① 全屏 Viewer 容器与画廊等 z-index 时会盖住画廊右上角的 ×——随预览移入 overlay 一并解决；并加安全网：监听 Viewer 显隐（`viewer-in` 类增删），隐藏后置 `pointer-events:none`，确保残留容器不遮挡画廊关闭按钮/缩略图。② **预存布局 bug**：box 是 `display:flex` 容器，标题作为 flex item 在层叠里等同 `z-index:0` 层，而关闭按钮是 `position:absolute`（同属 z-index:auto 层），同层按 DOM 顺序——标题在关闭按钮之后 append，会画到关闭按钮之上并吃掉点击（视觉无重叠，但标题隐形盒子铺满整行）。给图片画廊与文本弹窗的关闭按钮都加 `z-index:2!important` 抬到正 z-index 层修复。浏览器实测：预览在顶层、关闭后关闭按钮可点中均通过。`@version`→`26.7.29-v10`。

### znhd.user.js v26.7.29-v9
- **修复收到图片弹窗内缩略图/按钮被灰蒙蒙遮罩覆盖的问题**：通过浏览器实测复现确认，弹窗自身 CSS 干净（白底、图片/按钮 `opacity:1`、`filter:none`、无伪元素遮罩）。灰蒙蒙来自**宿主页面的某个 z-index 高于 `2147483640` 的半透明灰层**（可能是翻译/深色模式/阅读模式类扩展，或税务站自身的高层级遮罩）盖到了弹窗内容上方。修复：将弹窗 `overlay` 的 `z-index` 提升到 CSS 最大值 `2147483647`；给白盒 `box` 增加 `isolation:isolate`、`filter:none`、`backdrop-filter:none`、`z-index:1`；并对 `grid` / `thumbWrap` / `img` / 所有按钮显式声明 `filter:none`、`backdrop-filter:none`、`opacity:1`，最大限度隔绝外部滤镜与高级别遮罩的渗透。`@version`→`26.7.29-v9`。

### znhd.user.js v26.7.29-v8
- **消除图片/文本预览弹窗的 `FocusLock: focus-fighting detected` 告警**：预览弹窗（`renderImageGallery`/`showTextPopup`，裸 DOM 挂 `documentElement`）内的 `<button>`（复制/下载/清空）是焦点可夺取元素。当脚本面板的 arco 抽屉（设置/常用语/手机传图）或税务页面自身的 arco 弹窗同时开着时，arco 的 focus-lock 焦点锁发现焦点跑到弹窗按钮上又拉不回，反复打架刷此告警。修复：弹窗挂载后对其内所有 `button` 设 `tabIndex=-1` 且 `mousedown` 时 `preventDefault()`（阻止抢占焦点，鼠标点击 `onClick` 仍正常）。`@version`→`26.7.29-v8`。

### znhd.user.js v26.7.29-v7
- **二次修复 CDN 开关（裸 `input` 仍触发 React #137）**：上一版改用裸 `createElement('input')` 报错 `React error #137; got input`——证实 CAT_UI 的 React 渲染器白名单**连 `input` 也不支持**（与 `img` 同类）。再次改为白名单内的 `div` 模拟勾选框：受控样式（`useCdn` 为真时蓝底白勾、假时灰框），点击 `onClick` 调 `onChangeUseCdn(!useCdn)` 取反。`@version`→`26.7.29-v7`。

### znhd.user.js v26.7.29-v6
- **修复设置抽屉崩溃（`CAT_UI.Switch is not a function`）**：实测 `CAT_UI.Switch` 运行时为 `undefined`（库清单误列，与 `TimePicker`/`Image` 同类陷阱），导致打开「设置」即报错。改用原生 `<input type="checkbox">`（受控，配合 `onChange` 写回 `useCdn`），视觉与交互不变。默认开启 CDN 的逻辑不受影响（`loadAllvalue` 以 `{...DEFAULTS, ...parsed}` 合并，`useCdn` 缺省由 `DEFAULTS.useCdn:true` 兜底）。`@version`→`26.7.29-v6`。

### znhd.user.js v26.7.29-v5
- **新增「使用 CDN 加速」配置 + `resolveGithubUrl()` 转换函数**：设置抽屉新增开关「使用 CDN 加速（jsDelivr）加载资源」（默认开启，存于 `Allvalue.useCdn`）。新增模块级函数 `resolveGithubUrl(githubUrl)`：输入一个 GitHub 文件链接，开启 CDN 时输出 `https://cdn.jsdelivr.net/gh/用户名/仓库名@分支/文件路径`，关闭时输出原始 `raw.githubusercontent.com` 链接；非 GitHub 链接（如 npm CDN）原样返回。分支含斜杠（如 `refs/heads/main`）用单次捕获正则正确转换。已接入：① `commonPhrasesUrl` 默认值改为 GitHub 网页链接、取用时经该函数解析（常用语抽屉「数据源」也显示解析后实际地址）；② `CONFIG.didaUrl` 改为 GitHub 链接、`playDidaSound` 取用时解析。Viewer.js 的 npm CDN 链接不属 GitHub 资源，维持原样。`@version`→`26.7.29-v5`。

### znhd.user.js v26.7.29-v4
- **「本机上传链接」区二维码与链接左右对调**：用户要求二维码放在左侧。修正了上一版（v3）嵌套错误导致二维码与链接实际未左右并列的问题——现 flex 容器两个子节点严格左「二维码（`140×140px`，带边框圆角）」、右「链接文本 + 复制链接按钮」；二维码未生成时左侧显示占位提示，抽屉窄时自动换行。`@version`→`26.7.29-v4`。

### znhd.user.js v26.7.29-v3
- **「本机上传链接」区改为左历史*：原「链接 + 复制按钮」与二维码纯上下堆叠，现改为 flex 左右历史左侧显示链接文本与「历史」按钮，右侧显示二维码（`140×140px`，带 1px 浅灰历史角）；二维码尚未生成时右侧显示占位提示。抽屉较窄或移动端自动换行（`flexWrap: 'wrap'`）。`@version`→`26.7.29-v3`。

### znhd.user.js v26.7.29-v2
- **面板按钮重排 + 新增「查看待存文件」入口**：面板按钮区改为两行——第一行「设置、常用语」，第二行「查看待存文件、设备互联」（「查看待存文件」在「设置」正下方、「设备互联」在「常用语」正下方）。点击「查看待存文件」随时打开**已收到图片的画廊**（复用 `receivedImages` + `renderImageGallery`，与收到新图时弹出的画廊一致，含复制/下载/清空；列表未清空前可反复查看，空列表时提示「暂无待存文件」）。`@version`→`26.7.29-v2`。

### relay-server v26.7.29-v4
- **手机端收图弹窗视觉与脚本端完全一致**：把 `#recvPopup` 从「深色全屏遮罩+纯图片网格」改为脚本端同款**白底圆角卡片**——标题「收到的图片（N）· 单击放大」+ 红色 × 关闭 + 3 列缩略图（每张带「复制 / 下载」按钮 + 单张移除 ×）+ 底部「清空全部」；点击缩略图仍由 Viewer.js 接管放大/旋转/多图切换（遮罩压黑 `!important`，`zIndex:99999` 盖住卡片）。复制/下载走 `dataURL→Blob`（`ClipboardItem` 复制图片、`<a download>` 保存），CDN 不可达时退回 `openRecvImage` 单图查看。relay `package.json` version→`26.7.29-v4`。

### relay-server v26.7.29-v8
- **修复多选非 HEIC 图片卡死**：先前把 `compressFile` 重构为 `compressBlob` 时漏删一行残留 `reader.readAsDataURL(f)`（`reader` 已移入 `compressBlob` 内部、`compressFile` 作用域不再存在）。非 HEIC 多选时该残留行抛 `ReferenceError` 中断 `files.forEach` 循环，致后续图片不处理、`doneCount` 永远小于总数、状态永久卡在「处理中…」；HEIC 分支因提前 `return` 规避报错故不卡。已删除残留行。relay `package.json` version→`26.7.29-v8`。⚠️ 须重启 `node server.js`（容器内 `docker restart znhd`）生效。

### relay-server v26.7.29-v7
- **HEIC 改用 heic2any（公共 CDN）转 JPEG 后再压缩直传**：手机上传页 `<head>` 引入 `https://cdn.bootcdn.net/ajax/libs/heic2any/0.0.4/heic2any.js`；`compressFile` 对 HEIC/HEIF 走 `heic2any({blob, toType:'image/jpeg'})` 解码转 JPEG，`toBlob` 前先 `fillStyle='#fff';fillRect` 铺白底（防透明区黑底），成功后再 canvas 压成 JPEG 上传；库缺失/转换失败时回退原样直传兜底。确保 HEIC 在电脑端（含 Windows，无需额外编解码器）能直接打开。relay `package.json` version→`26.7.29-v7`。

### relay-server v26.7.29-v6
- **HEIC 支持（原样直传回退）+ 失败原因可见**：`compressFile` 新增 `isHeic` 检测（mime `image/heic`/`image/heif` 或文件名 `.heic`/`.heif`）；浏览器可解码 HEIC（如 iOS Safari）仍压 JPEG，不可解码（`img.onerror`）或 canvas 压缩失败（`toBlob` 返回 null）时改为**原样直传**避免整张被跳过。同步把多选失败提示从笼统「N 张处理失败已跳过」改为显示具体「文件名：原因」（如 `IMG.heic：图片解析失败` / `压缩失败` / `读取文件失败`）。relay `package.json` version→`26.7.29-v6`。

### relay-server v26.7.29-v5
- **压缩图铺白底，透明 PNG 不再黑底**：`compressFile` 在 canvas `drawImage` 前先 `fillStyle='#fff';fillRect(0,0,cw,ch)` 铺白。修复手机选带透明圆角/透明背景的 PNG 被压成 JPEG 后透出黑色背景的问题（透明像素在 JPEG 无透明通道、canvas 默认黑底所致）。relay `package.json` version→`26.7.29-v5`。

### znhd.user.js v26.7.29-v1
- **「发送到手机」选图改为先预览后发送（与手机端一致）**：原选完图片立即上传，现改为选图仅加入「待发送」预览列表（抽屉内 3 列缩略图网格，单张 × 移除、可继续添加），点「发送 N 张到手机」才真正逐张顺序上传；避免误选即发的冲动操作。发送逻辑与之前一致（逐张顺序、失败即停、进度日志）。`@version`→`26.7.29-v1`。

### relay-server v26.7.29-v3
- **手机端收图改用真·Viewer.js（与脚本端一致）**：`<head>` 通过 `https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.js` + 对应 CSS 引入 Viewer.js；画廊渲染后用 `new Viewer(recvGrid, {...})` 绑定，点击缩略图即弹出 Viewer.js 查看（缩放/旋转/翻转/多图左右切换），`zIndex:99999` 确保弹窗盖在画廊遮罩之上；CDN 不可达时 `recvViewer=null`，缩略图点击退回 `openRecvImage` 自定义单图查看兜底。relay `package.json` version→`26.7.29-v3`。

### relay-server v26.7.29-v1
- **手机端收图改为弹窗查看（真用 Viewer.js，与脚本端一致）**：原「电脑发送到手机」的图片收进页面底部内联九宫格，现改为收到即自动弹出**画廊弹窗**（固定全屏遮罩 + 3 列缩略图），点击缩略图用 **Viewer.js**（`https://cdn.jsdelivr.net/npm/viewerjs/dist/viewer.min.js`）弹出放大/旋转/多图左右切换，与脚本端完全一致；CDN 不可达时退回 `openRecvImage` 自定义单图查看。点弹窗空白/× 关闭；关闭后底部保留「🖼 收到的图片（N）」按钮可重新打开。文本仍走独立弹层。
- 纯中继手机页改动；relay `package.json` version→`26.7.29-v1`；渲染后手机页脚本 `new Function` 语法校验通过。⚠️ 须重启 `node server.js`（容器内 `docker restart znhd` 即生效，手机页由中继同源托管）。

### v26.7.28-v3
- **画廊新增「下载」按钮**：每张缩略图下方按钮区改为「复制 + 下载」两键并排，下载把原图 blob 存为文件（优先原始文件名，无扩展名时按 MIME 自动补 `.jpg/.png/.svg` 等）。
- **「发送到手机」支持多选图片**：文件选择器加 `multiple`，逐张顺序发送（一张成功再发下一张，日志显示进度 `n/总数`，失败即停并提示已发张数）。需配合 relay v26.7.28-v5 的手机收件队列，否则连发会互相覆盖。

### relay-server v26.7.28-v6
- **手机端"来自电脑"的图片改为九宫格画廊**（与脚本端 Viewer.js 画廊对齐）：原实现每收到一张图就弹一个独立全屏弹窗，多选连发时多个弹窗叠在一起、看不到九宫格。现改为把电脑发来的图片统一收进 `#recvGrid` 九宫格（3 列缩略图、多张累积、带序号角标），**点击缩略图才放大查看**（全屏遮罩 +「长按保存」）；文本仍弹独立弹层。已验证：渲染页内联脚本 `new Function()` 语法 OK、`/\.svg$/i` 反斜杠未被模板字符串吞掉、`recvGrid`/`renderRecvGrid`/`openRecvImage` 均就位。⚠️ 需重新部署，`curl /health` 看到 `26.7.28-v6` 即生效。

### relay-server v26.7.28-v5
- **修复 SVG 图片兼容问题**：手机上传页原对所有图片走 canvas 压缩，SVG 常光栅化失败（无固有尺寸时画布为 0 / 部分 WebView 直接 onerror），导致无法预览也无法发送。现 SVG（按 MIME 或 `.svg` 扩展名识别）跳过压缩**原样直传**，并强制修正 blob 类型为 `image/svg+xml`——手机预览、电脑端画廊显示、放大查看均正常（注意：SVG「复制到剪贴板」受浏览器限制可能失败，可用「下载」按钮代替）。
- **删除手机端 9 张选图上限**：`MAX_PICK` 移除，选图张数不限；服务端每设备暂存队列上限从 9 提高到 100（纯内存保护，正常收发不会触顶）。
- **电脑 → 手机收件通道队列化**：`phonePending` 从单槽改为 FIFO 队列（同 `pending`，上限 100、超出丢最旧记 `[丢弃]` 日志），支持电脑端多选图片连发不丢图。已端到端验证：连发 3 条按序取回、第 4 次返回 `empty`；SVG mime 全链路透传无损。⚠️ 需重新部署，`curl /health` 看到 `26.7.28-v5` 即生效。

### v26.7.28-v2
- **修复：Viewer.js 放大图片时背景半透明**——Viewer 默认遮罩为 `rgba(0,0,0,0.5)`，放大时会透出后面的画廊弹窗（"收到的图片 · 单击放大"）。现注入覆盖样式把 `.viewer-backdrop` / `.viewer-container` 改为纯黑不透明，放大查看时完全遮住背景。

### v26.7.28-v1
- **接收端图片改为九宫格画廊 + Viewer.js 放大**：原来"每收一张弹一个单图弹窗、新图顶掉旧图"，现在收到的图片累积进画廊弹窗，以 3 列九宫格缩略图展示（最多保留 27 张，超出丢最旧并释放内存）。
  - **单击缩略图即用 Viewer.js 放大查看**：支持滚轮缩放、旋转、翻转、1:1、多图左右切换（`@require` jsdelivr 的 `viewer.min.js`，CSS 经 `@resource` + `GM_getResourceText` 注入，失败自动回退 CDN `<link>`；Viewer 未加载时缩略图和复制功能不受影响）。
  - 每张缩略图下方独立「复制」按钮（保留点击手势写剪贴板），右上角 × 单独移除；底部「清空全部」；关闭弹窗不清空列表，收到新图会带着历史图片再次弹出。
  - 新增授权：`GM_getResourceText`。配合 relay v26.7.28-v4 的手机端 9 张多选上传食用最佳。

### relay-server v26.7.28-v4
- **手机上传页支持多选图片（最多 9 张）**：`<input>` 加 `multiple`，选图后九宫格缩略图预览（可单张 × 删除、可分多次追加，合计上限 9 张）；发送时逐张压缩上传并显示进度（`发送中…（n/总数）`），某张失败即停、剩余保留可点按钮重试。
- **中继服务端暂存改为 FIFO 队列**：原 `pending` 为每设备单槽，连发多张且电脑端未及时取走时会互相覆盖丢图。现改为每设备队列（上限 9 条，超出丢弃最旧并记 `[丢弃]` 日志），`/recv` 长轮询每次投递队头一条，电脑端收到即自动再轮询取下一条——**电脑端油猴脚本无需任何改动**。
- 已本地端到端验证：连发 3 条按序取回、第 4 次取返回 `empty`、连发 10 条时最旧一条被正确丢弃；渲染后内联脚本 `new Function()` 语法校验通过。⚠️ 需重新部署中继服务，`curl /health` 看到 `26.7.28-v4` 即生效。

### v26.7.27-v1
- **版本号日期修正（跨天重置）**：上一轮「双向互传」功能实于 2026-07-27 完成，但 `@version` 误写为 `26.7.26-v25`（沿用了前一天日期）。按版本号约定——跨天须将日期部分改为当天、序号重置为 v1——现更正为 `26.7.27-v1`。功能内容与 `v26.7.26-v25` 完全一致（电脑端↔手机端双向互传），无其它代码改动。⚠️ 仍须**两端同步更新并重启 `node server.js`**。

### v26.7.26-v25
- **新增「电脑端 → 手机端」发送（双向互传）**：脚本端现在也能把文本/图片发回手机。
- **中继服务器 `server.js`**：新增反向通道内存表 `phoneOnline`/`phonePending`/`phoneWaiting` 与 `PHONE_TTL=20s`；新增 4 条路由——
  - `POST /phone/heartbeat/<id>`（手机报活）、`GET /phone/status/<id>`（返回 `{online}`，电脑端据此判断是否可发）、`POST /phone/send/<id>`（电脑发图/文，镜像 `/u`）、`GET /phone/recv/<id>`（手机长轮询收件，镜像 `/recv`）。
- **手机上传页（内联）**：打开即每 8s 心跳报活；长轮询 `/phone/recv`，收到图片**自动弹出与脚本端一致的白底卡片画廊弹窗**（标题「收到的图片（N）· 单击放大」+ 红色 × + 3 列缩略图，每张带「复制 / 下载」按钮 + 单张移除 ×，底部「清空全部」），**点击缩略图用 Viewer.js 放大查看**（缩放/旋转/多图切换，与脚本端一致）、CDN 不可达时退回自定义单图查看+「长按保存」；收到文本展示+「复制文本」；关闭弹窗后底部保留「收到的图片（N）」按钮可重新打开；顶部加在线状态指示。
- **电脑端 `znhd.user.js`**：`PhoneImageDrawer` 扩为「手机互传」抽屉——轮询 `/phone/status` 显示 🟢已连接/⚪无在线设备；文本输入框+发送按钮、**图片选完先在下方的 3 列缩略图网格预览、点「发送 N 张到手机」才真正上传**（与手机端上传页行为一致，单张 × 可移除、可继续添加）；离线时发送按钮置灰并提示「当前无在线设备，无法发送」；发送成功/失败写面板日志。新增 `sendToPhone` 辅助（GM_xmlhttpRequest POST `/phone/send`）。
- 纯前端+中继改动；`@version`→`26.7.26-v25`；两文件 `node -c` 通过。⚠️ 须**两端同步更新并重启 `node server.js`**；手机页由中继同源托管，重启后即含心跳+收件箱。

### v26.7.26-v24
- **文本弹窗固定最小尺寸**：原先 `box`/`textEl` 只设 `max-*` 无下限，文本很短时弹窗会缩得很小、观感差。现给 `box` 加 `min-width:360px;min-height:200px`，给文本区 `textEl` 加 `min-width:320px;min-height:120px`；文字多时仍按 `max-*` 正常放大不截断。
- 纯 UI 调整；`@version`→`26.7.26-v24`；语法 `node -c` 通过。

### v26.7.26-v23
- **移除弹窗右下角的版本号标记**：图片预览窗与文本预览窗原本在右下角显示 `znhd vX.Y.Z`，因版本号已在脚本面板中统一展示，属多余信息，已删除（两处弹窗的 `ver` 元素及其 `appendChild` 一并移除）。
- 纯 UI 清理，无功能变化；`@version`→`26.7.26-v23`；语法 `node -c` 通过。

### v26.7.26-v22
- **新增「手机发送文本到电脑」功能**（与发图并行）：手机上传页新增文本输入框 + 「发送文本到电脑」按钮；中继服务器 `/u/<id>` 的 POST 现同时支持 `{text}`（文本）与 `{data,mime,name}`（图片），并以 `type` 字段区分。
- **中继服务端**：`pending` 条目统一带 `type`（`image`/`text`）；`deliverToAll` 改为回传整条（含 type），由电脑端按类型分流，广播机制对文本同样生效（多标签同时接收互不丢）。
- **电脑端 `znhd.user.js`**：`startPhoneReceive` 的 `/recv` 轮询按 `data.type` 分流——`image` 走 `onImage`（弹图片预览窗），`text` 走新增的 `onText`（弹文本预览窗）。`onText` 在弹窗前写一条 `成功` 日志（含前 40 字），并调用新增 `showTextPopup`：网页正中弹窗展示文本 + 「复制到剪贴板」按钮（复用 `safeCopyText`，含日志与提示音）+ 关闭按钮，点遮罩空白也可关闭。
- 版本标记右下角 → `v22`，`@version`→`26.7.26-v22`；语法 `node -c` 两文件均通过。
- ⚠️ 两端需同步更新并**重启中继服务器**（`node server.js`）才生效；手机页由中继同源托管，重启后即含文本框。

### v26.7.26-v21
- **手机收到图片时写入面板日志**：`onImage` 回调原先只弹出预览窗、不记日志，导致"脚本确实收到了图"在设置面板日志里看不到证据。
- 改动 `znhd.user.js`：`onImage` 在 `showImagePopup` 之前新增 `addLog('[设备互联] 收到图片：' + 文件名 + '（' + MIME + '）', 'success')`，日志进入设置面板「日志」区，`onImage` 信息中明确文件名与类型。
- 版本标记右下角 → `v21`，`@version`→`26.7.26-v21`；语法 `node -c` 通过。

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
- **中继服务器地址填写时自动去尾斜杠（请求 #3）**：设置输入框 `onChange` 在校验前加 `url = url.trim().replace(/\/+$/, '')`——用户粘贴 `http://x:5689/` 这类带 `/` 的地址会被即时处理为 `http://x:5689` 再保存/显示。`startPhoneReceive` 与设备互联抽屉拼链接处本就归一，显示链接始终干净。
- 版本标记右下角 → `v19`，`@version`→`26.7.26-v19`；语法 `node -c` 通过。

### v26.7.26-v18
- **「已自动开始接收」日志时机再修正**：v17 改为"连上服务器（首次轮询 `onload`）才显示"，但长轮询即便未收到图片也会在 `maxwait` 后返回空响应，导致该日志仍会在脚本一启动轮询（约 25s 内）就打出，并非手机发送后。
  - 现改为：日志移到 `onImage` **首次真正收到手机图片** 时才 `addLog`，即**手机端点击发送之后**才显示「`[设备互联] 已自动开始接收（…）`」。用 `firstImageLogged` 标记去重，避免后续每张图都刷该日志。
  - 自动接收 `useEffect` 删除 `onConnected` 用法（该回调改为不再用于此日志）。
- 版本标记右下角 → `v18`，`@version`→`26.7.26-v18`；语法 `node -c` 通过。

### v26.7.26-v17
- **设置面板排版调整**：删除「常用语数据源」「中继服务器（设备互联）」两个分隔标题（Divider）；「常用语数据地址」与「中继服务器地址」两项内容直接并入「其他设置」分组之下（去掉各自标题、保留说明文字与输入框）。
- **「已自动开始接收」日志改为"连上服务器后才显示"**：原逻辑在 `relayServer` 一填好就立刻 `addLog('[设备互联] 已自动开始接收…')`，此时其实还没连通服务器，属误报。
  - `startPhoneReceive` 新增 `onConnected` 回调：长轮询首次 `onload`（真正收到服务器响应）时 `markConnected()` 触发一次 → 仅此时才打「已自动开始接收」日志（含服务器地址）。
  - 顺带：连不上时（`onerror`）打**一次性**「[设备互联] 连接服务器失败，请检查中继地址/网络（…）」错误日志（`loggedConnFail` 去重，避免 2s 轮询刷爆），不再静默让用户误以为已连。
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
- 「设备互联」改为**默认自动接收**：「设置 → 中继服务器」填好公网地址（默认 `http://45.207.199.216:5689`）后脚本即自动长轮询取图，**移除「开始/停止接收」按钮**，无需手动点击
- 收到图片时在**网页正中弹出预览弹窗**（直接挂到 `document.body`，不受 CAT_UI 面板 transform 影响）：含底部「复制到剪贴板」按钮与右上角关闭按钮
- `@version` 按 `YY.M.D-vN` 规范递增为 `26.7.26-v3`

### v26.7.26-v2
- 「设备互联」二维码改为**脚本端本地生成**：引入客户端库 qrcodejs（`@require`），抽屉内用 `new QRCode` 渲染后读取 `canvas.toDataURL()` 显示，二维码本地秒出、不再依赖服务器
- 中继服务器 `relay-server` 移除 `/qr` 端点与 `qrcode` 依赖，现为**纯 Node 内置 http、零依赖**，仅保留手机上传页、`/recv` 长轮询取图、`/health`
- `@version` 按 `YY.M.D-vN` 规范递增为 `26.7.26-v2`

### v26.7.26-v1
- 新增「设备互联到电脑」功能：手机图片经中继服务器转发到本机剪贴板（在征纳互动聊天框 Ctrl+V 粘贴）
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
- 常用语数据源地址现可在设置面板自定义（「设置 → 常用语数据源」），默认仍为 github 上的 commonPhrases.yaml
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
- **项目地址**：https://github.com/runos/znhd-service
- **脚本主页**：https://scriptcat.org/zh-CN/script-show-page/3650
- **使用教程**：https://flowus.cn/runos/share/e48623a2-f273-4327-8597-639e08902be8?code=1YD5Z5

## 贡献

欢迎提交 Issue 和 Pull Request！