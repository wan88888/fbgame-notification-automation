import { useState } from 'react';
import { Button, Input, Modal, Select, Typography } from 'antd';
import type { SopBatch } from '../../../shared/sop';
import type { PlanAct } from './PlanActions';
export function PlanSettings({
  batch,
  disabled,
  act,
}: {
  batch: SopBatch;
  disabled: boolean;
  act: PlanAct;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(batch.settings);
  return (
    <>
      <Button
        disabled={disabled}
        onClick={() => {
          setValue(batch.settings);
          setOpen(true);
        }}
      >
        编辑本计划策略
      </Button>
      <Modal
        title="编辑本计划策略"
        open={open}
        onCancel={() => setOpen(false)}
        okText="保存策略"
        cancelText="返回"
        okButtonProps={{ disabled }}
        onOk={async () => {
          if (await act(`/batches/${batch.id}/settings`, value, '保存本计划策略', 'PUT'))
            setOpen(false);
        }}
      >
        <Typography.Paragraph type="secondary">
          仅修改本计划，保存后需重新准备 CSV。改变语言后请重新审核文案和模板语言列。
        </Typography.Paragraph>
        <label className="sop-field">
          发送模式
          <Select
            value={value.timingMode}
            options={[
              { value: 'fixed', label: '固定时刻（人工后台排期）' },
              { value: 'predicted', label: 'Facebook 最佳时间（UTC 日期）' },
            ]}
            onChange={(v) => setValue({ ...value, timingMode: v })}
          />
        </label>
        {value.timingMode === 'fixed' && (
          <div className="form-grid">
            <label className="sop-field">
              发送时刻
              <Input
                type="time"
                value={value.sendTime}
                onChange={(e) => setValue({ ...value, sendTime: e.target.value })}
              />
            </label>
            <label className="sop-field">
              时区
              <Select
                value={value.timezone}
                options={[
                  { value: 'Asia/Shanghai', label: '北京时间 UTC+8' },
                  { value: 'UTC', label: 'UTC' },
                ]}
                onChange={(v) => setValue({ ...value, timezone: v })}
              />
            </label>
          </div>
        )}
        <label className="sop-field">
          文案语言
          <Input
            value={value.language}
            maxLength={80}
            onChange={(e) => setValue({ ...value, language: e.target.value })}
          />
        </label>
        <label className="sop-field">
          目标人群
          <Input
            value={value.audience}
            maxLength={500}
            onChange={(e) => setValue({ ...value, audience: e.target.value })}
          />
        </label>
        <label className="sop-field">
          活动信息与要求
          <Input.TextArea
            rows={4}
            value={value.brief}
            maxLength={4000}
            onChange={(e) => setValue({ ...value, brief: e.target.value })}
          />
        </label>
      </Modal>
    </>
  );
}
