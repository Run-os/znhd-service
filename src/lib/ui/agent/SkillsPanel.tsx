import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, List, Popconfirm, Spin, Tag, Tooltip, Typography } from 'antd';
import { addLog } from '@/lib/logger';
import { agentErrorMessage, listSkills, removeSkill, skillToolSummary } from '@/lib/agent/api';
import { notify } from '@/lib/ui/notify';
import type { AgentSkillSummary, CatAgentApi } from '@/lib/agent/types';

export interface SkillsPanelProps {
    api: CatAgentApi;
    /** 外部递增的刷新信号（切换页签等场景） */
    version: number;
    /** 列表发生变更后通知父组件 */
    onChange: () => void;
}

function formatTime(value?: number): string {
    if (!value || !Number.isFinite(value)) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (num: number) => String(num).padStart(2, '0');
    return (
        date.getFullYear() +
        '-' +
        pad(date.getMonth() + 1) +
        '-' +
        pad(date.getDate()) +
        ' ' +
        pad(date.getHours()) +
        ':' +
        pad(date.getMinutes())
    );
}

/**
 * 已安装技能列表（v26.10.10-v10）。
 *
 * 定位：**只做只读盘点 + 卸载**。技能的安装属于 ScriptCat 自己那套流程（技能市场 / 管理页），
 * 在面板里再实现一套「粘贴 skillMd 安装」既重复又容易与官方流程打架，故此处不放安装入口，
 * 只在没有技能时把「去哪儿装」写清楚。对话页创建会话时用的是 `skills: 'auto'`，
 * 也就是已启用的技能会被 Agent 自动加载并自行决定何时调用，不需要在这里逐个勾选。
 */
export default function SkillsPanel({ api, version, onChange }: SkillsPanelProps) {
    const [skills, setSkills] = useState<AgentSkillSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const list = await listSkills(api);
            setSkills(list);
            setError('');
        } catch (err) {
            setError(agentErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [api]);

    useEffect(() => {
        void reload();
    }, [reload, version]);

    const handleRemove = useCallback(
        async (name: string) => {
            try {
                await removeSkill(api, name);
                notify.success('已卸载技能 ' + name);
                addLog('[Agent] 已卸载技能 ' + name, 'info');
                await reload();
                onChange();
            } catch (err) {
                const message = agentErrorMessage(err);
                notify.error('卸载失败：' + message);
                addLog('[Agent] 卸载技能失败: ' + message, 'error');
            }
        },
        [api, reload, onChange]
    );

    if (error) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Alert type="error" showIcon message={'读取技能失败：' + error} />
                <Button size="small" onClick={() => void reload()}>
                    重试
                </Button>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {'已安装 ' + skills.length + ' 个技能；对话时已启用的技能会自动加载。'}
                </Typography.Text>
                <Button size="small" loading={loading} onClick={() => void reload()}>
                    刷新
                </Button>
            </div>

            {loading && !skills.length ? (
                <div style={{ padding: '24px 0', textAlign: 'center' }}>
                    <Spin size="small" />
                </div>
            ) : skills.length ? (
                <List
                    size="small"
                    bordered
                    dataSource={skills}
                    style={{ maxHeight: 380, overflowY: 'auto' }}
                    renderItem={(skill) => (
                        <List.Item
                            actions={[
                                <Popconfirm
                                    key="remove"
                                    title={'卸载技能 ' + skill.name + '？'}
                                    description="卸载后 Agent 不再使用该技能。"
                                    okText="卸载"
                                    cancelText="取消"
                                    onConfirm={() => void handleRemove(skill.name)}>
                                    <Button type="link" size="small" danger>
                                        卸载
                                    </Button>
                                </Popconfirm>,
                            ]}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <Typography.Text strong style={{ fontSize: 13 }}>
                                        {skill.name}
                                    </Typography.Text>
                                    {skill.version ? (
                                        <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                                            v{skill.version}
                                        </Tag>
                                    ) : null}
                                    <Tag color={skill.enabled ? 'green' : 'default'} style={{ marginInlineEnd: 0 }}>
                                        {skill.enabled ? '已启用' : '已停用'}
                                    </Tag>
                                    {skill.hasConfig ? (
                                        <Tooltip title="该技能有可配置项，请在 ScriptCat 的技能设置里调整">
                                            <Tag style={{ marginInlineEnd: 0 }}>可配置</Tag>
                                        </Tooltip>
                                    ) : null}
                                </div>
                                {skill.description ? (
                                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                        {skill.description}
                                    </Typography.Text>
                                ) : null}
                                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                    {'工具：' +
                                        skillToolSummary(skill) +
                                        (skill.referenceNames?.length
                                            ? '　参考资料：' + skill.referenceNames.length + ' 份'
                                            : '') +
                                        (formatTime(skill.updatetime)
                                            ? '　更新于 ' + formatTime(skill.updatetime)
                                            : '')}
                                </Typography.Text>
                            </div>
                        </List.Item>
                    )}
                />
            ) : (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                        <span style={{ fontSize: 12 }}>
                            还没有安装任何技能。技能可在 ScriptCat 的技能市场 / 管理页安装，装好后回到这里刷新即可。
                        </span>
                    }
                />
            )}

            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                提示：技能由 ScriptCat 统一管理，本面板只做盘点与卸载，不提供安装入口（避免与官方流程重复）。
            </Typography.Text>
        </div>
    );
}
