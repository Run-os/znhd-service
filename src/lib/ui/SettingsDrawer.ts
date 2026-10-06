/**
 * 设置抽屉（原 app.ts 的 SettingsDrawer）：脚本链接、CDN 开关、监控时间段、常用语地址、中继地址、日志。
 * 模块化 P5：逐字迁移，仅加 export。
 * ⚠️ 时间输入与地址草稿的处理是真实页面实测结论（见块内注释），禁止顺手重构。
 */

import { DEFAULTS } from '@/lib/constants';
import { LogEntry } from '@/lib/logger';
import { hoursToHHmm, hhmmToHours } from '@/lib/utils';
import { LogPanel } from '@/lib/ui/LogPanel';

/** 监控时间段（十进制小时，13.5 表示 13:30） */
export interface WorkingHours {
    morningStart: number;
    morningEnd: number;
    afternoonStart: number;
    afternoonEnd: number;
}

/** SettingsDrawer 组件属性 */
export interface SettingsDrawerProps {
    visible: boolean;
    setVisible: (v: boolean) => void;
    logEntries: LogEntry[];
    workingHours: WorkingHours | null;
    onChangeWorkingHours: (wh: WorkingHours) => void;
    commonPhrasesUrl: string;
    onChangeCommonPhrasesUrl: (url: string) => void;
    relayServer: string;
    onChangeRelayServer: (url: string) => void;
    useCdn: boolean;
    onChangeUseCdn: (v: boolean) => void;
}

export function SettingsDrawer({
    visible,
    setVisible,
    logEntries,
    workingHours,
    onChangeWorkingHours,
    commonPhrasesUrl,
    onChangeCommonPhrasesUrl,
    relayServer,
    onChangeRelayServer,
    useCdn,
    onChangeUseCdn,
}: SettingsDrawerProps) {
    // 当前监控时间段（兜底默认值，避免未配置时报错）
    const wh = workingHours || { morningStart: 9, morningEnd: 12, afternoonStart: 13.5, afternoonEnd: 18 };
    // 更新单个时间段字段（入参为十进制小时）
    const updateWh = (field: any, dec: any) => {
        if (typeof dec !== 'number' || isNaN(dec)) return;
        onChangeWorkingHours({ ...wh, [field]: dec });
    };
    // 时间选择器 onChange 兼容：CAT_UI 未导出 TimePicker，此处用原生 <input type="time">，
    // 其 onChange 回传原生事件（val.target.value 为 "HH:mm"）；同时兼容 arco 的 (val, str) 形式
    const onTimeChange = (field: any) => (val: any, str: any) => {
        let s;
        if (val && val.target && typeof val.target.value === 'string') {
            s = val.target.value; // 原生 <input type="time">
        } else if (typeof str === 'string') {
            s = str; // arco (dayjsValue, timeString)
        } else if (val && typeof val.format === 'function') {
            s = val.format('HH:mm');
        } else if (typeof val === 'string') {
            s = val;
        } else {
            s = '';
        }
        const dec = hhmmToHours(s);
        if (dec !== null) updateWh(field, dec);
    };

    // 常用语数据源地址：草稿 + 失焦回填默认。
    // 旧逻辑 onChange 空串时立即提交默认地址，受控 Input 的 value 随之变回默认——
    // 用户清空后还没来得及输入/粘贴新地址，输入框就被自动填上默认值，体验很糟。
    // 现改为：输入框显示独立的 urlDraft 草稿（清空后保持为空），非空时逐字提交保存；
    // 仅当**失焦且草稿为空**时才把默认地址回填并提交（符合「点别处才恢复默认」的直觉）。
    // 地址可用性仍由使用时的加载校验兜底（loadPhrasesData 的 status/类型校验）。
    const DEFAULT_PHRASES_URL = DEFAULTS.commonPhrasesUrl;
    const [urlDraft, setUrlDraft] = CAT_UI.useState(commonPhrasesUrl || DEFAULT_PHRASES_URL);
    // 外部已保存值变化（提交、重开设置）时同步草稿；输入中不会触发（外部值未变），不打断打字
    CAT_UI.useEffect(() => {
        setUrlDraft(commonPhrasesUrl || DEFAULT_PHRASES_URL);
    }, [commonPhrasesUrl]);
    // 重开设置抽屉时丢弃上次未完成/未失焦的草稿，按已保存值展示
    CAT_UI.useEffect(() => {
        if (visible) setUrlDraft(commonPhrasesUrl || DEFAULT_PHRASES_URL);
    }, [visible]);
    const onUrlChange = (val: any) => {
        let url = typeof val === 'string' ? val : val && val.target ? val.target.value : '';
        url = (url || '').trim();
        setUrlDraft(url); // 草稿始终跟随输入（含清空），输入框保持为空，不回填默认
        if (url) onChangeCommonPhrasesUrl(url); // 非空逐字提交；空串延迟到失焦处理
    };
    // 失焦时从事件目标读最新 DOM 值（不依赖闭包快照）；为空则回填默认地址并提交
    const onUrlBlur = (e: any) => {
        const url = ((e && e.target && typeof e.target.value === 'string' ? e.target.value : urlDraft) || '').trim();
        if (!url) {
            onChangeCommonPhrasesUrl(DEFAULT_PHRASES_URL);
            setUrlDraft(DEFAULT_PHRASES_URL);
        }
    };

    return CAT_UI.Drawer(
        CAT_UI.createElement('div', { style: { textAlign: 'left' } }, [
            CAT_UI.Space(
                [
                    CAT_UI.Button('[脚本主页]', {
                        type: 'link',
                        onClick: () => {
                            window.open('https://scriptcat.org/zh-CN/script-show-page/3650', '_blank');
                        },
                        style: {
                            padding: '0 8px',
                            color: '#1890ff',
                            fontWeight: 'bold',
                        },
                    }),
                    CAT_UI.Button('[更新脚本]', {
                        type: 'link',
                        onClick: () => {
                            window.open((GM_info.scriptUpdateURL || GM_info.script.updateURL) as string, '_blank');
                        },
                        style: {
                            padding: '0 8px',
                            color: '#1890ff',
                            fontWeight: 'bold',
                        },
                    }),
                ],
                { direction: 'horizontal', size: 'small' }
            ),
            CAT_UI.Divider('其他设置'),
            // CDN 加速开关：控制项目内 GitHub 资源（常用语 YAML、提示音）是否经 jsDelivr 加速
            // 注意：① CAT_UI.Switch 运行时为 undefined；② 裸 createElement('input') 不在 CAT_UI 的
            // React 渲染器白名单内，会触发 React error #137（与 img 同类）。
            // 改用白名单内的 div 模拟勾选框（受控：样式随 useCdn 变化，点击触发 onChangeUseCdn 取反）。
            CAT_UI.Space(
                [
                    CAT_UI.Text('使用 CDN 加速（jsDelivr）加载资源', {
                        style: { display: 'block', fontWeight: 'bold' },
                    }),
                    CAT_UI.createElement(
                        'div',
                        {
                            onClick: () => {
                                if (typeof onChangeUseCdn === 'function') onChangeUseCdn(!useCdn);
                            },
                            style: {
                                width: '18px',
                                height: '18px',
                                cursor: 'pointer',
                                marginLeft: '8px',
                                boxSizing: 'border-box',
                                userSelect: 'none',
                                border: '1px solid ' + (useCdn ? '#1890ff' : '#d9d9d9'),
                                borderRadius: '3px',
                                background: useCdn ? '#1890ff' : '#fff',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#fff',
                                fontSize: '12px',
                                lineHeight: '1',
                            },
                        },
                        useCdn ? '✓' : ''
                    ),
                ],
                { direction: 'horizontal', size: 'small', style: { marginBottom: '8px' } }
            ),
            // 监控时间段配置（使用时间选择器）
            CAT_UI.Text('监控时间段（点击选择时间）', {
                style: { display: 'block', marginBottom: '8px', fontWeight: 'bold' },
            }),
            CAT_UI.Space(
                [
                    CAT_UI.Text('上午'),
                    CAT_UI.Input({
                        type: 'time',
                        value: hoursToHHmm(wh.morningStart),
                        onChange: onTimeChange('morningStart'),
                        style: { width: '110px' },
                    }),
                    CAT_UI.Text('至'),
                    CAT_UI.Input({
                        type: 'time',
                        value: hoursToHHmm(wh.morningEnd),
                        onChange: onTimeChange('morningEnd'),
                        style: { width: '110px' },
                    }),
                ],
                { direction: 'horizontal', size: 'small', style: { marginBottom: '8px', flexWrap: 'wrap' } }
            ),
            CAT_UI.Space(
                [
                    CAT_UI.Text('下午'),
                    CAT_UI.Input({
                        type: 'time',
                        value: hoursToHHmm(wh.afternoonStart),
                        onChange: onTimeChange('afternoonStart'),
                        style: { width: '110px' },
                    }),
                    CAT_UI.Text('至'),
                    CAT_UI.Input({
                        type: 'time',
                        value: hoursToHHmm(wh.afternoonEnd),
                        onChange: onTimeChange('afternoonEnd'),
                        style: { width: '110px' },
                    }),
                ],
                { direction: 'horizontal', size: 'small', style: { marginBottom: '8px', flexWrap: 'wrap' } }
            ),
            CAT_UI.createElement(
                'p',
                { style: { margin: '0 0 8px', color: '#999', fontSize: '12px', lineHeight: '1.5' } },
                '提示：将「下午开始」设为与「上午结束」相同（如都设为 12:00），即可午休时段也监控。'
            ),
            CAT_UI.Text('常用语数据地址（可自定义远程 YAML）', {
                style: { display: 'block', marginBottom: '8px', fontWeight: 'bold' },
            }),
            CAT_UI.Input({
                placeholder: 'https://.../commonPhrases.yaml',
                value: urlDraft,
                onChange: onUrlChange,
                onBlur: onUrlBlur,
                allowClear: true,
                style: { marginBottom: '8px', width: '100%' },
            }),
            CAT_UI.createElement(
                'p',
                { style: { margin: '0 0 8px', color: '#999', fontSize: '12px', lineHeight: '1.5' } },
                '修改后请在「常用语」面板点「重新加载常用语」生效；留空并点击其他区域（失焦）后恢复默认地址。'
            ),
            CAT_UI.Text('中继服务器地址', {
                style: { display: 'block', marginBottom: '8px', fontWeight: 'bold' },
            }),
            CAT_UI.Input({
                placeholder: 'https://你的服务器:端口',
                value: relayServer || '',
                onChange: (val: any) => {
                    let url = typeof val === 'string' ? val : val && val.target ? val.target.value : '';
                    url = (url || '').trim().replace(/\/+$/, ''); // 去掉末尾多余的 /（如用户粘贴 http://x:5689/ ）
                    // 逐字提交（不再逐键拦截非 http 前缀导致无法输入）；
                    // 「设备互联」自动接收侧另有 http(s) 前缀门控 + 800ms 防抖，避免输入过程中无效启停
                    onChangeRelayServer(url);
                },
                allowClear: true,
                style: { marginBottom: '8px', width: '100%' },
            }),
            CAT_UI.createElement(
                'p',
                { style: { margin: '0 0 8px', color: '#999', fontSize: '12px', lineHeight: '1.5' } },
                '用于「设备互联到电脑」：手机上传的图片经此服务器转发到本机剪贴板。需自行部署配套 relay-server（见项目说明）。'
            ),
            CAT_UI.Divider('日志内容'),
            CAT_UI.createElement(LogPanel, { logEntries }),
        ]),
        {
            title: '设置菜单',
            visible,
            width: 400,
            focusLock: true,
            autoFocus: false,
            zIndex: 10000,
            onOk: () => {
                setVisible(false);
            },
            onCancel: () => {
                setVisible(false);
            },
        }
    );
}
