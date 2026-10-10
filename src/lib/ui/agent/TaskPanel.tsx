import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Empty, Form, Input, List, Popconfirm, Spin, Tag, Typography, theme } from 'antd';
import { agentErrorMessage, buildTaskInput, listTasks, runTaskAction, validateCrontab } from '@/lib/agent/api';
import { notify } from '@/lib/ui/notify';
import type { AgentTask, AgentTaskInput, CatAgentApi } from '@/lib/agent/types';

export interface TaskPanelProps {
    api: CatAgentApi;
    version: number;
    onChange: () => void;
}

const STATUS_COLOR: Record<string, string> = {
    success: 'green',
    failed: 'red',
    running: 'blue',
};

const STATUS_TEXT: Record<string, string> = {
    success: '成功',
    failed: '失败',
    running: '运行中',
    skipped: '已跳过',
};

function statusColor(status?: string): string {
    return (status && STATUS_COLOR[status]) || 'default';
}

function statusText(status?: string): string {
    if (!status) return '未运行';
    return STATUS_TEXT[status] || status;
}

function formatTime(value?: number): string {
    if (!value || !Number.isFinite(value)) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const pad = (num: number) => String(num).padStart(2, '0');
    return (
        pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes())
    );
}

/**
 * 定时任务面板（v26.10.10-v10）。
 *
 * 任务由 ScriptCat 的 TaskScheduler 在后台按 crontab 触发，即便这个弹窗关着、甚至宿主页关掉，
 * 到点仍会执行（`mode: 'internal'`）。所以这里只负责「增删改查 + 立即跑一次」。
 *
 * 时间显示一律用本地时区（`new Date(ms)`），因为用户填的 crontab 也是本地时间语义。
 */
export default function TaskPanel({ api, version, onChange }: TaskPanelProps) {
    const { token } = theme.useToken();
    const [tasks, setTasks] = useState<AgentTask[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [form] = Form.useForm<{ name: string; crontab: string; prompt: string }>();
    const [submitting, setSubmitting] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const list = await listTasks(api);
            setTasks(list);
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

    const handleCreate = useCallback(
        async (values: { name: string; crontab: string; prompt: string }) => {
            const cronError = validateCrontab(values.crontab);
            if (cronError) {
                notify.warning(cronError);
                return;
            }
            const payload: AgentTaskInput = buildTaskInput(values);
            if (!payload.name) {
                notify.warning('请填写任务名称');
                return;
            }
            if (!payload.prompt) {
                notify.warning('请填写任务要执行的内容');
                return;
            }
            setSubmitting(true);
            try {
                await runTaskAction(api, '创建', (task) => task.create(payload));
                notify.success('已创建定时任务 ' + payload.name);
                form.resetFields();
                await reload();
                onChange();
            } catch (err) {
                notify.error('创建失败：' + agentErrorMessage(err));
            } finally {
                setSubmitting(false);
            }
        },
        [api, form, reload, onChange]
    );

    const patchTask = useCallback(
        async (id: string, patch: Partial<AgentTaskInput>, action: string) => {
            try {
                await runTaskAction(api, action, (task) => task.update(id, patch));
                await reload();
                onChange();
            } catch (err) {
                notify.error(action + '失败：' + agentErrorMessage(err));
            }
        },
        [api, reload, onChange]
    );

    const handleRunNow = useCallback(
        async (task: AgentTask) => {
            try {
                await runTaskAction(api, '立即执行', (apiTask) => apiTask.runNow(task.id));
                notify.success('已触发「' + task.name + '」，结果会写进运行日志');
            } catch (err) {
                notify.error('触发失败：' + agentErrorMessage(err));
            }
        },
        [api]
    );

    const handleRemove = useCallback(
        async (task: AgentTask) => {
            try {
                await runTaskAction(api, '删除', (apiTask) => apiTask.remove(task.id));
                notify.success('已删除任务 ' + task.name);
                await reload();
                onChange();
            } catch (err) {
                notify.error('删除失败：' + agentErrorMessage(err));
            }
        },
        [api, reload, onChange]
    );

    if (error) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Alert type="error" showIcon message={'读取定时任务失败：' + error} />
                <Button size="small" onClick={() => void reload()}>
                    重试
                </Button>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Form
                form={form}
                layout="vertical"
                size="small"
                requiredMark={false}
                onFinish={(values) => void handleCreate(values)}>
                <Form.Item
                    name="name"
                    label="任务名称"
                    rules={[{ required: true, message: '请填写任务名称' }]}
                    style={{ marginBottom: 8 }}>
                    <Input placeholder="例如：每天上班前提醒我检查监控" maxLength={40} />
                </Form.Item>
                <Form.Item
                    name="crontab"
                    label="执行时间（crontab：分 时 日 月 周）"
                    rules={[{ required: true, message: '请填写 crontab' }]}
                    extra="例：9 点整 → 0 9 * * *　；每个工作日 8:30 → 30 8 * * 1-5"
                    style={{ marginBottom: 8 }}>
                    <Input placeholder="0 9 * * *" />
                </Form.Item>
                <Form.Item
                    name="prompt"
                    label="让 Agent 做什么"
                    rules={[{ required: true, message: '请填写要执行的内容' }]}
                    extra="任务到点会把这句话交给 Agent 执行，结果写进运行日志。"
                    style={{ marginBottom: 8 }}>
                    <Input.TextArea
                        placeholder="例如：汇总当前页面上的等待人数并提醒我"
                        autoSize={{ minRows: 2, maxRows: 4 }}
                    />
                </Form.Item>
                <Button type="primary" htmlType="submit" size="small" loading={submitting}>
                    创建任务
                </Button>
            </Form>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {'已有 ' + tasks.length + ' 个任务'}
                </Typography.Text>
                <Button size="small" loading={loading} onClick={() => void reload()}>
                    刷新
                </Button>
            </div>

            {loading && !tasks.length ? (
                <div style={{ padding: '24px 0', textAlign: 'center' }}>
                    <Spin size="small" />
                </div>
            ) : tasks.length ? (
                <List
                    size="small"
                    bordered
                    dataSource={tasks}
                    style={{ maxHeight: 300, overflowY: 'auto' }}
                    renderItem={(task) => (
                        <List.Item
                            actions={[
                                <Button key="run" type="link" size="small" onClick={() => void handleRunNow(task)}>
                                    立即执行
                                </Button>,
                                <Button
                                    key="toggle"
                                    type="link"
                                    size="small"
                                    onClick={() =>
                                        void patchTask(
                                            task.id,
                                            { enabled: !task.enabled },
                                            task.enabled ? '停用' : '启用'
                                        )
                                    }>
                                    {task.enabled ? '停用' : '启用'}
                                </Button>,
                                <Popconfirm
                                    key="remove"
                                    title={'删除任务 ' + task.name + '？'}
                                    description="删除后不再按计划执行。"
                                    okText="删除"
                                    cancelText="取消"
                                    onConfirm={() => void handleRemove(task)}>
                                    <Button type="link" size="small" danger>
                                        删除
                                    </Button>
                                </Popconfirm>,
                            ]}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <Typography.Text strong style={{ fontSize: 13 }}>
                                        {task.name}
                                    </Typography.Text>
                                    <Tag color={task.enabled ? 'blue' : 'default'} style={{ marginInlineEnd: 0 }}>
                                        {task.crontab}
                                    </Tag>
                                    <Tag color={statusColor(task.lastRunStatus)} style={{ marginInlineEnd: 0 }}>
                                        {statusText(task.lastRunStatus)}
                                    </Tag>
                                </div>
                                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                    {'上次：' +
                                        formatTime(task.lastruntime) +
                                        '　下次：' +
                                        formatTime(task.nextruntime) +
                                        (task.lastRunError ? '　错误：' + task.lastRunError : '')}
                                </Typography.Text>
                            </div>
                        </List.Item>
                    )}
                />
            ) : (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span style={{ fontSize: 12 }}>还没有定时任务，用上面的表单建一个。</span>}
                />
            )}

            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                <span style={{ color: token.colorTextTertiary }}>
                    {'任务由 ScriptCat 在后台按计划触发，关闭本弹窗或关掉网页也会照常执行。'}
                </span>
            </Typography.Text>
        </div>
    );
}
