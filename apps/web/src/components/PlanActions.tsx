import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Space, Typography } from 'antd';
import type { SopBatch } from '../../../shared/sop';
export type PlanAct = (
  path: string,
  body: unknown,
  label: string,
  method?: string,
) => Promise<unknown>;
export function PlanActions({
  batch,
  busy,
  dirty,
  act,
}: {
  batch: SopBatch;
  busy: boolean;
  dirty: boolean;
  act: PlanAct;
}) {
  const [mode, setMode] = useState<'duplicate' | 'cancel' | 'owner'>();
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [owner, setOwner] = useState('');
  const [remote, setRemote] = useState(false);
  const remoteRequired = Boolean(batch.jobId || batch.verificationNote);
  const open = (action: typeof mode) => {
    setMode(action);
    setOwner(batch.owner || '');
    setNote('');
    setRemote(false);
    const d = new Date(`${batch.weekOf}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    setDate(d.toISOString().slice(0, 10));
  };
  return (
    <>
      <Space wrap>
        <Button disabled={busy || dirty} onClick={() => open('duplicate')}>
          复制计划
        </Button>
        <Button disabled={busy} onClick={() => open('owner')}>
          {batch.owner ? `负责人：${batch.owner}` : '指定负责人'}
        </Button>
        <Button
          disabled={busy || dirty || ['publishing', 'reported', 'cancelled'].includes(batch.status)}
          onClick={() => open('cancel')}
        >
          取消计划
        </Button>
      </Space>
      <Modal
        title={
          { duplicate: '复制为新的周二计划', cancel: '取消计划并保留记录', owner: '计划负责人' }[
            mode || 'owner'
          ]
        }
        open={!!mode}
        onCancel={() => setMode(undefined)}
        okText={mode === 'duplicate' ? '创建副本' : mode === 'cancel' ? '确认取消' : '保存负责人'}
        cancelText="返回"
        confirmLoading={busy}
        okButtonProps={{
          disabled:
            mode === 'cancel'
              ? !note.trim() || (remoteRequired && !remote)
              : mode === 'duplicate'
                ? !date
                : false,
        }}
        onOk={async () => {
          const result = await act(
            `/batches/${batch.id}/${mode}`,
            mode === 'duplicate'
              ? { weekOf: date }
              : mode === 'owner'
                ? { owner }
                : { note, remoteCancelled: remote },
            mode === 'duplicate' ? '复制计划' : mode === 'owner' ? '更新负责人' : '取消计划',
            mode === 'owner' ? 'PUT' : 'POST',
          );
          if (result) setMode(undefined);
        }}
      >
        {mode === 'duplicate' && (
          <>
            <p>继承文案、模板、负责人和发送策略，生成新的文案标签；请重新审核活动有效期。</p>
            <Input
              aria-label="复制到周二日期"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </>
        )}
        {mode === 'owner' && (
          <>
            <Input
              aria-label="负责人姓名"
              placeholder="例如：小王"
              maxLength={80}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
            <p className="muted">
              负责人会显示在计划和群通知中。这是协作标记，不是个人权限或自动 @ 提醒。
            </p>
          </>
        )}
        {mode === 'cancel' && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert
              showIcon
              type="warning"
              message="取消会停止本计划的平台后续处理，保留文案、核验与效果记录。平台不会撤回 Facebook 通知。"
            />
            {remoteRequired && (
              <Checkbox checked={remote} onChange={(e) => setRemote(e.target.checked)}>
                我已在 Facebook 关闭或撤回该通知，并确认不会继续发送
              </Checkbox>
            )}
            <Input.TextArea
              aria-label="取消原因"
              placeholder="记录取消原因；已执行计划请同时写明后台处理情况"
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Typography.Text type="secondary">
              同一游戏同一周的记录仍保留。重新安排请复制到新的周二。
            </Typography.Text>
          </Space>
        )}
      </Modal>
    </>
  );
}
