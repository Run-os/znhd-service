# 征纳互动人数和在线监控 v2

## 项目简介

**征纳互动人数和在线监控** 是一个油猴用户脚本（UserScript），用于实时监控 [征纳互动平台](https://znhd.hunan.chinatax.gov.cn:8443/) 的等待人数和在线状态。当有纳税人等待时自动语音播报提醒，支持自定义常用语快速回复，帮助坐席人员及时响应。

### 核心特性

- **实时人数监控**：每 3 秒自动检测等待人数，有人等待时语音播报提醒
- **掉线检测**：自动检测平台掉线弹窗，及时语音告警
- **语音播报**：基于 Web Speech API，支持一键开关，带语音队列管理避免播报冲突
- **常用语管理**：从远程 YAML 配置文件加载常用语，数据源地址可在设置面板自定义，支持关键字搜索过滤，一键复制并填入 TinyMCE 编辑器
- **工作时间限定**：仅在工作时间段（默认上午 9:00-12:00，下午 13:30-18:00，可在设置面板调整）内执行监控，非工作时间自动暂停
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
4. 支持"重新加载"按钮手动刷新常用语数据
5. 常用语数据源地址可在「设置 → 常用语数据源」中自定义：粘贴你自己的 YAML 地址即可让团队使用各自的常用语；修改后需点"重新加载常用语"生效，留空则恢复默认地址

### 日志系统

- 设置抽屉内嵌日志查看器，最多保留 20 条记录
- 日志按类型着色：
  - 🔵 信息（info）
  - 🟠 警告（warning）
  - 🟢 成功（success）
  - 🔴 错误（error）
- 自动过滤连续重复日志，避免刷屏

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
    commonPhrasesUrl: 'https://gitee.com/runos/znhd-service/raw/master/public/commonPhrases.yaml'
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

### 常用语点击后未填入编辑器

1. 确认页面中存在 TinyMCE 编辑器（输入区域）
2. 检查浏览器控制台是否有 iframe 跨域相关错误
3. 脚本会自动降级处理：优先使用 TinyMCE API，失败后直接操作 DOM

## 更新日志

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