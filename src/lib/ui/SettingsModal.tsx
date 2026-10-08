import { useEffect, useState } from 'react';
import { Button, Divider, Input, Switch } from '../../../shared/ui/controls';
import { ConfirmFooter, Modal } from '../../../shared/ui/OverlayModal';
import { cn } from '../../../shared/ui/cn';
import { DEFAULTS } from '@/lib/constants';
import { hoursToHHmm, hhmmToHours } from '@/lib/utils';

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
    /** 打开「更新日志」弹窗（由 Modal 承载，不再是自拼 DOM） */
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

/** 链接型按钮：设置弹窗顶部那排 [脚本主页] [更新脚本] [更新日志] */
function LinkButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
    return (
        <Button variant="link" size="small" onClick={onClick}>
            {children}
        </Button>
    );
}

/** 分组小标题（次要说明文字的统一样式） */
function Hint({ children, className }: { children: React.ReactNode; className?: string }) {
    return <p className={cn('block text-xs leading-[18px] text-ink-3', className)}>{children}</p>;
}

/**
 * 设置弹窗（v26.10.06-v9 由 CAT_UI.Drawer 改为 Modal；v26.10.08-v14 改为自研 Modal 基座）。
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

    // 原生 <input type="time"> 被清空时 hhmmToHours 返回 null（换掉 TimePicker 后才有这个形态）：
    // 此时保持原值不动，避免把 undefined/NaN 写进配置。
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

    /** 一行「时间输入」：标签 + 两个输入框 + 「至」 */
    const timeRow = (label: string, from: keyof WorkingHours, to: keyof WorkingHours) => (
        <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-ink-2">{label}</span>
            <Input
                type="time"
                step={300}
                value={hoursToHHmm(wh[from])}
                onChange={(e) => updateWh(from, hhmmToHours(e.target.value))}
                className="w-[110px]"
            />
            <span className="text-[13px] text-ink-2">至</span>
            <Input
                type="time"
                step={300}
                value={hoursToHHmm(wh[to])}
                onChange={(e) => updateWh(to, hhmmToHours(e.target.value))}
                className="w-[110px]"
            />
        </div>
    );

    return (
        <Modal
            open={open}
            title="设置菜单"
            width={520}
            onClose={onClose}
            footer={<ConfirmFooter onCancel={onClose} onOk={onClose} />}>
            <div className="flex flex-wrap items-center gap-1">
                <LinkButton onClick={() => window.open('https://github.com/Run-os/znhd-service', '_blank')}>
                    [脚本主页]
                </LinkButton>
                <LinkButton
                    onClick={() =>
                        window.open((GM_info.scriptUpdateURL || GM_info.script.updateURL) as string, '_blank')
                    }>
                    [更新脚本]
                </LinkButton>
                <LinkButton onClick={() => onOpenChangelog()}>[更新日志]</LinkButton>
            </div>

            <Divider className="my-2">其他设置</Divider>

            {/* CDN 加速开关：控制项目内 GitHub 资源（常用语 YAML、提示音）是否经 CDN 镜像加速 */}
            <div className="mb-3 flex items-center gap-2">
                <span className="text-[13px] font-medium text-ink-1">使用 CDN 加速（Fastly 镜像）加载资源</span>
                <Switch checked={!!useCdn} onChange={(v) => onChangeUseCdn(v)} />
            </div>

            <p className="mb-2 block text-[13px] font-medium text-ink-1">监控时间段（点击选择时间）</p>
            {timeRow('上午', 'morningStart', 'morningEnd')}
            {timeRow('下午', 'afternoonStart', 'afternoonEnd')}
            <Hint>提示：将「下午开始」设为与「上午结束」相同（如都设为 12:00），即可午休时段也监控。</Hint>

            <p className="mb-2 block text-[13px] font-medium text-ink-1">常用语数据地址（可自定义远程 YAML）</p>
            <Input
                placeholder="https://.../commonPhrases.yaml"
                value={urlDraft}
                onChange={(e) => onUrlChange(e.target.value)}
                onBlur={onUrlBlur}
                className="mb-2"
            />
            <Hint>修改后请在「常用语」面板点「重新加载常用语」生效；留空并点击其他区域（失焦）后恢复默认地址。</Hint>

            <p className="mb-2 block text-[13px] font-medium text-ink-1">中继服务器地址</p>
            <Input
                placeholder="https://你的服务器:端口"
                value={relayServer || ''}
                onChange={(e) => onChangeRelayServer((e.target.value || '').trim().replace(/\/+$/, ''))}
                className="mb-2"
            />
            <Hint className="mb-0">
                用于「设备互联到电脑」：手机上传的图片经此服务器转发到本机剪贴板。需自行部署配套
                relay-server（见项目说明）。
            </Hint>
        </Modal>
    );
}
