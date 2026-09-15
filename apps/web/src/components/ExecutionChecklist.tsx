import { useState } from 'react';
import { Alert, App, Button, Checkbox, Space, Tag, Typography } from 'antd';
import type { PreflightResult, SopBatch } from '../../../shared/sop';
import { sopRequest } from '../api';

export function ExecutionChecklist({
  batch,
  dirty,
  busy,
  onExecute,
}: {
  batch: SopBatch;
  dirty: boolean;
  busy: boolean;
  onExecute: (checks: {
    account: boolean;
    content: boolean;
    schedule: boolean;
  }) => Promise<unknown>;
}) {
  const { message, modal } = App.useApp();
  const [result, setResult] = useState<PreflightResult>();
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const currentRevision = JSON.stringify([
    batch.id,
    batch.settings,
    batch.variants,
    batch.csvTemplate,
    batch.status,
  ]);
  const fresh =
    revision === currentRevision &&
    result &&
    Date.now() - new Date(result.checkedAt).getTime() < 300_000;
  const confirmed = fresh && checked.length === 3;
  const manual = batch.settings.timingMode === 'fixed';
  const disabledReason = dirty
    ? '请先保存文案修改。'
    : batch.status !== 'ready'
      ? '请先校验并准备 CSV；执行后无需重复提交。'
      : !fresh
        ? '先点击检查；结果有效期为 5 分钟。'
        : !result.canExecute && !manual
          ? '请先处理下方未通过项，再重新检查。'
          : !confirmed
            ? '请完成人工复核勾选。'
            : manual
              ? '固定时刻请下载 CSV 并在 Facebook 人工排期。'
              : '执行时会再次检查，确认后上传并开启真实通知。';
  return (
    <div className="preflight-panel">
      <Space wrap>
        <Button
          disabled={busy || dirty || batch.status !== 'ready'}
          loading={loading}
          onClick={async () => {
            setLoading(true);
            setChecked([]);
            try {
              const value = await sopRequest<PreflightResult>(`/batches/${batch.id}/preflight`, {});
              setResult(value);
              setRevision(currentRevision);
            } catch (e) {
              message.error((e as Error).message);
            } finally {
              setLoading(false);
            }
          }}
        >
          执行前检查
        </Button>
        <Typography.Text type="secondary">检查不会上传或发送推送。</Typography.Text>
      </Space>
      {result && (
        <>
          <p className="muted">
            检查时间：{new Date(result.checkedAt).toLocaleTimeString('zh-CN')} ·
            修改文案或策略后需重新检查
          </p>
          {result.checks.map((c) => (
            <div className="check-row" key={c.key}>
              <Tag
                color={
                  { pass: 'success', blocked: 'error', manual: 'blue', warning: 'warning' }[
                    c.status
                  ]
                }
              >
                {
                  { pass: '已通过', blocked: '未通过', manual: '人工确认', warning: '需留意' }[
                    c.status
                  ]
                }
              </Tag>
              <div>
                <strong>{c.title}</strong>
                <p>{c.detail}</p>
              </div>
            </div>
          ))}
          <Checkbox.Group
            value={fresh ? checked : []}
            onChange={(v) => setChecked(v as string[])}
            disabled={!fresh || busy}
          >
            <Space direction="vertical">
              <Checkbox value="account">我已确认 Facebook 登录账号及游戏正确</Checkbox>
              <Checkbox value="content">我已审核所选文案，奖励和活动在发送时有效</Checkbox>
              <Checkbox value="schedule">我已核对发送日期、策略和时区</Checkbox>
            </Space>
          </Checkbox.Group>
        </>
      )}
      <div className="section-actions">
        <Button
          type="primary"
          disabled={busy || loading || dirty || !confirmed || !result?.canExecute}
          onClick={() =>
            modal.confirm({
              title: '执行本计划的真实 Facebook 排期',
              content: `${batch.name} · ${batch.variants.find((v) => v.selected)?.title}。确认后会上传并开启通知，完成后请核验后台。`,
              okText: '确认并执行',
              cancelText: '返回检查',
              onOk: async () => {
                const success = await onExecute({ account: true, content: true, schedule: true });
                if (!success) throw new Error('执行未启动，请查看错误并重新检查');
                setResult(undefined);
              },
            })
          }
        >
          执行后台排期
        </Button>
        <Typography.Text type="secondary">{disabledReason}</Typography.Text>
      </div>
      {manual && fresh && (
        <Alert
          type={result.checks.some((c) => c.status === 'blocked') ? 'warning' : 'info'}
          showIcon
          message="完成检查后，请使用上方下载按钮，在 Facebook 人工排期；完成后填写下方核验记录。"
        />
      )}
    </div>
  );
}
