import { useEffect, useState } from 'react';
import { Modal, Button, Divider, Input, Space, Switch, Typography } from 'antd';
import { DEFAULTS } from '@/lib/constants';
import { hoursToHHmm, hhmmToHours } from '@/lib/utils';
import { getOverlayContainer } from '@/lib/ui/panelHost';

const { Text } = Typography;

/** 监控时间段（十进制小时，13.5 表示 13:30） */
export interface WorkingHours {
    morningStart: number;
    morningEnd: number;
    afternoonStart: number;
    afternoonEnd: number;
}

export interface SettingsModalProps {
    open: boolean;
    onClose: () => void;
    /** 打开「更新日志」弹窗（v26.10.06-v13 起由 antd Modal 承载，不再是自拼 DOM） */
    onOpenChangelog: () => void;
    workingHours: WorkingHours | null;
    onChangeWorkingHours: (wh: WorkingHours) => void;
    commonPhrasesUrl: string;
    onChangeCommonPhrasesUrl: (url: string) => void;
    relayServer: string;
    onChangeRelayServer: (url: string) => void;
    useCdn: boolean;
    onChangeUseCdn: (v: boolean) => void;
}

/**
 * 设置弹窗（v26.10.06-v9：由 CAT_UI.Drawer 侧边抽屉改为 antd Modal 弹窗）。
 * ⚠️ 时间输入与地址草稿的处理是真实页面实测结论（见块内注释），禁止顺手重构。
 */
export default function SettingsModal({
    open,
    onClose,
    onOpenChangelog,
    workingHours,
    onChangeWorkingHours,
    commonPhrasesUrl,
    onChangeCommonPhrasesUrl,
    relayServer,
    onChangeRelayServer,
    useCdn,
    onChangeUseCdn,
}: SettingsModalProps) {
    const wh = workingHours || { morningStart: 9, morningEnd: 12, afternoonStart: 13.5, afternoonEnd: 18 };

    // 原生 <input type="time"> 被清空时 hhmmToHours 返回 null（v26.10.06-v16 换掉 antd TimePicker 后
    // 才有这个形态）：此时保持原值不动，避免把 undefined/NaN 写进配置。
    const updateWh = (field: keyof WorkingHours, dec: number | null) => {
        if (dec === null || typeof dec !== 'number' || isNaN(dec)) return;
        onChangeWorkingHours({ ...wh, [field]: dec });
    };

    // 常用语数据源地址：草稿 + 失焦回填默认。
    // 旧问题：onChange 空串时立即提交默认地址，受控 Input 会被拉回默认值，用户清空后没法输入新地址。
    // 现改为：输入框显示独立草稿（清空后保持为空），非空时逐字提交；仅「失焦且草稿为空」才回填默认。
    const DEFAULT_PHRASES_URL = DEFAULTS.commonPhrasesUrl;
    const [urlDraft, setUrlDraft] = useState(commonPhrasesUrl || DEFAULT_PHRASES_URL);
    useEffect(() => {
        setUrlDraft(commonPhrasesUrl || DEFAULT_PHRASES_URL);
    }, [commonPhrasesUrl, DEFAULT_PHRASES_URL]);
    useEffect(() => {
        if (open) setUrlDraft(commonPhrasesUrl || DEFAULT_PHRASES_URL);
    }, [open, commonPhrasesUrl, DEFAULT_PHRASES_URL]);

    const onUrlChange = (val: string) => {
        const url = (val || '').trim();
        setUrlDraft(url); // 草稿始终跟随输入（含清空）
        if (url) onChangeCommonPhrasesUrl(url);
    };
    const onUrlBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        const url = ((e.target.value as string) || '').trim();
        if (!url) {
            onChangeCommonPhrasesUrl(DEFAULT_PHRASES_URL);
            setUrlDraft(DEFAULT_PHRASES_URL);
        }
    };

    return (
        <Modal
            open={open}
            title="设置菜单"
            onCancel={onClose}
            getContainer={getOverlayContainer}
            width={520}
            // 显式左对齐：宿主页面常有全局 text-align:center（税务页就是），不设会整屏居中
            styles={{ body: { textAlign: 'left' } }}
            destroyOnHidden
            footer={
                <Space>
                    <Button onClick={onClose}>取消</Button>
                    <Button color="primary" variant="solid" onClick={onClose}>
                        确定
                    </Button>
                </Space>
            }>
            <Space size={4} wrap>
                <Button type="link" onClick={() => window.open('https://github.com/Run-os/znhd-service', '_blank')}>
                    [脚本主页]
                </Button>
                <Button
                    type="link"
                    onClick={() =>
                        window.open((GM_info.scriptUpdateURL || GM_info.script.updateURL) as string, '_blank')
                    }>
                    [更新脚本]
                </Button>
                <Button type="link" onClick={() => onOpenChangelog()}>
                    [更新日志]
                </Button>
            </Space>

            <Divider style={{ margin: '8px 0' }}>其他设置</Divider>

            {/* CDN 加速开关：控制项目内 GitHub 资源（常用语 YAML、提示音）是否经 CDN 镜像加速 */}
            <Space size={8} style={{ marginBottom: 12 }}>
                <Text strong>使用 CDN 加速（Fastly 镜像）加载资源</Text>
                <Switch checked={!!useCdn} onChange={(v) => onChangeUseCdn(v)} />
            </Space>

            <Text strong style={{ display: 'block', marginBottom: 8 }}>
                监控时间段（点击选择时间）
            </Text>
            <Space size={8} wrap style={{ marginBottom: 8 }}>
                <Text>上午</Text>
                <Input
                    type="time"
                    step={300}
                    value={hoursToHHmm(wh.morningStart)}
                    onChange={(e) => updateWh('morningStart', hhmmToHours(e.target.value))}
                    style={{ width: 110 }}
                />
                <Text>至</Text>
                <Input
                    type="time"
                    step={300}
                    value={hoursToHHmm(wh.morningEnd)}
                    onChange={(e) => updateWh('morningEnd', hhmmToHours(e.target.value))}
                    style={{ width: 110 }}
                />
            </Space>
            <Space size={8} wrap style={{ marginBottom: 8 }}>
                <Text>下午</Text>
                <Input
                    type="time"
                    step={300}
                    value={hoursToHHmm(wh.afternoonStart)}
                    onChange={(e) => updateWh('afternoonStart', hhmmToHours(e.target.value))}
                    style={{ width: 110 }}
                />
                <Text>至</Text>
                <Input
                    type="time"
                    step={300}
                    value={hoursToHHmm(wh.afternoonEnd)}
                    onChange={(e) => updateWh('afternoonEnd', hhmmToHours(e.target.value))}
                    style={{ width: 110 }}
                />
            </Space>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                提示：将「下午开始」设为与「上午结束」相同（如都设为 12:00），即可午休时段也监控。
            </Text>

            <Text strong style={{ display: 'block', marginBottom: 8 }}>
                常用语数据地址（可自定义远程 YAML）
            </Text>
            <Input
                placeholder="https://.../commonPhrases.yaml"
                value={urlDraft}
                onChange={(e) => onUrlChange(e.target.value)}
                onBlur={onUrlBlur}
                allowClear
                style={{ marginBottom: 8 }}
            />
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
                修改后请在「常用语」面板点「重新加载常用语」生效；留空并点击其他区域（失焦）后恢复默认地址。
            </Text>

            <Text strong style={{ display: 'block', marginBottom: 8 }}>
                中继服务器地址
            </Text>
            <Input
                placeholder="https://你的服务器:端口"
                value={relayServer || ''}
                onChange={(e) => onChangeRelayServer((e.target.value || '').trim().replace(/\/+$/, ''))}
                allowClear
                style={{ marginBottom: 8 }}
            />
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                用于「设备互联到电脑」：手机上传的图片经此服务器转发到本机剪贴板。需自行部署配套
                relay-server（见项目说明）。
            </Text>
        </Modal>
    );
}
