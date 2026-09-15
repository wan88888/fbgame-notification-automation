import { useState } from 'react';
import { Alert, Button, Card, Input, Space, Switch, Table, Tag, Typography } from 'antd';
import type { SopOverview } from '../../../shared/sop';
import type { PlanAct } from './PlanActions';
export function NotificationSettings({
  value,
  busy,
  act,
}: {
  value: SopOverview['notifications'];
  busy: boolean;
  act: PlanAct;
}) {
  const [enabled, setEnabled] = useState(value.enabled);
  const [label, setLabel] = useState(value.recipientLabel);
  return (
    <Card
      title="飞书协作通知"
      extra={
        <Tag color={value.enabled && value.configured ? 'success' : 'default'}>
          {value.enabled && value.configured ? '已开启' : '未开启'}
        </Tag>
      }
    >
      <p>
        通知事件：即将到期仍未执行、后台执行失败、需要人工核验、自动复盘异常、周报生成和下周草稿生成。
      </p>
      <p className="muted">
        发送到管理员配置的机器人所在群；负责人姓名会随消息显示。接收群名称用于识别，不会改变机器人实际接收群。
      </p>
      {!value.configured && (
        <Alert type="info" showIcon message="尚未配置 SOP 专用机器人，请联系管理员完成高级设置。" />
      )}
      <Space wrap>
        <Input
          aria-label="通知接收群名称"
          placeholder="接收群名称，例如：游戏运营群"
          value={label}
          maxLength={100}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Switch
          aria-label="飞书通知开关"
          checked={enabled}
          disabled={!value.configured && !enabled}
          onChange={setEnabled}
        />
        <Button
          disabled={busy || (enabled && (!label.trim() || !value.configured))}
          onClick={() =>
            void act('/notifications', { enabled, recipientLabel: label }, '保存通知设置', 'PUT')
          }
        >
          保存通知设置
        </Button>
      </Space>
      <p className="muted">
        开启后只通知新事件；关闭会取消待发通知。执行机运行时每分钟检查，失败间隔 5 分钟重试，最多 3
        次。网络超时重试可能产生重复消息。
      </p>
      <Table
        rowKey="id"
        size="small"
        dataSource={value.records}
        pagination={{ pageSize: 5, hideOnSinglePage: true }}
        scroll={{ x: 600 }}
        locale={{ emptyText: '还没有通知记录；不会为测试自动发送消息' }}
        columns={[
          { title: '事件', dataIndex: 'title' },
          {
            title: '创建时间',
            dataIndex: 'createdAt',
            render: (v: string) => new Date(v).toLocaleString('zh-CN'),
          },
          {
            title: '状态',
            render: (_, r) => (
              <Space direction="vertical">
                <Tag
                  color={
                    r.status === 'sent' ? 'success' : r.status === 'failed' ? 'error' : 'default'
                  }
                >
                  {
                    {
                      pending: '等待发送',
                      sent: '机器人已接收',
                      failed: '未确认送达',
                      cancelled: '已取消',
                    }[r.status]
                  }
                </Tag>
                {r.error && <Typography.Text type="secondary">{r.error}</Typography.Text>}
              </Space>
            ),
          },
        ]}
      />
    </Card>
  );
}
