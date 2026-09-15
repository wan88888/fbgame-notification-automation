import { useState } from 'react';
import { Button, Input, Select, Space, Table, Tag, Typography, App } from 'antd';
import type { BatchStatus, SopBatch } from '../../../shared/sop';

export const statuses: Record<BatchStatus, { text: string; color: string }> = {
  draft: { text: '文案草稿', color: 'default' },
  ready: { text: 'CSV 已准备', color: 'blue' },
  publishing: { text: '后台执行中', color: 'processing' },
  verification: { text: '待人工核验', color: 'orange' },
  scheduled: { text: '人工已核验排期', color: 'cyan' },
  failed: { text: '执行需处理', color: 'error' },
  reported: { text: '复盘已完成', color: 'success' },
  cancelled: { text: '已取消', color: 'default' },
};
export function Status({ value }: { value: BatchStatus }) {
  return <Tag color={statuses[value].color}>{statuses[value].text}</Tag>;
}
export function PlanList({
  batches,
  disabled,
  onOpen,
  onDelete,
}: {
  batches: SopBatch[];
  disabled: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const { modal, message } = App.useApp();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<BatchStatus>();
  const [project, setProject] = useState<string>();
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [deleting, setDeleting] = useState(false);
  const removable = (b: SopBatch) =>
    ['draft', 'ready'].includes(b.status) && !b.jobId && !b.verificationNote;
  const filtered = batches.filter(
    (b) =>
      (!status || b.status === status) &&
      (!project || b.projectKey === project) &&
      `${b.name} ${b.owner || ''}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const eligible = filtered.filter((b) => selected.includes(b.id) && removable(b));
  return (
    <>
      <Space wrap>
        <Input
          aria-label="搜索计划"
          placeholder="搜索游戏、日期或负责人"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected([]);
          }}
          allowClear
        />
        <Select
          aria-label="按游戏筛选"
          placeholder="全部游戏"
          allowClear
          style={{ minWidth: 140 }}
          value={project}
          onChange={(v) => {
            setProject(v);
            setSelected([]);
          }}
          options={[
            ...new Map(
              batches.map((b) => [b.projectKey, { value: b.projectKey, label: b.projectName }]),
            ).values(),
          ]}
        />
        <Select
          aria-label="按状态筛选"
          placeholder="全部状态"
          allowClear
          style={{ minWidth: 150 }}
          value={status}
          onChange={(v) => {
            setStatus(v);
            setSelected([]);
          }}
          options={Object.entries(statuses).map(([value, s]) => ({ value, label: s.text }))}
        />
        <Button
          danger
          disabled={disabled || !eligible.length || deleting}
          loading={deleting}
          onClick={() =>
            modal.confirm({
              title: `将 ${eligible.length} 个未执行计划移入回收站？`,
              content: '可从回收站恢复；平台不会操作 Facebook。',
              okText: '移入回收站',
              cancelText: '保留',
              onOk: async () => {
                setDeleting(true);
                try {
                  let successes = 0;
                  for (const b of eligible) if (await onDelete(b.id)) successes++;
                  message.info(
                    `已删除 ${successes} / ${eligible.length} 个计划；失败项保留，请检查最新状态。`,
                  );
                  setSelected([]);
                } finally {
                  setDeleting(false);
                }
              },
            })
          }
        >
          批量删除{eligible.length ? ` (${eligible.length})` : ''}
        </Button>
      </Space>
      <Table<SopBatch>
        rowKey="id"
        dataSource={filtered}
        size="small"
        scroll={{ x: 620 }}
        pagination={{ pageSize: 8, hideOnSinglePage: true, showSizeChanger: false }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: setSelected,
          getCheckboxProps: (b) => ({ disabled: disabled || deleting || !removable(b) }),
        }}
        columns={[
          {
            title: '计划',
            render: (_, b) => (
              <Button type="link" disabled={disabled || deleting} onClick={() => onOpen(b.id)}>
                {b.name}
              </Button>
            ),
          },
          {
            title: '负责人',
            render: (_, b) => b.owner || <Typography.Text type="secondary">未指定</Typography.Text>,
          },
          { title: '状态', render: (_, b) => <Status value={b.status} /> },
        ]}
      />
      <Typography.Text type="secondary">
        批量删除仅适用于未执行草稿；已执行计划请在详情中处理取消。
      </Typography.Text>
    </>
  );
}
