import { useState } from 'react';
import { Alert, App, Button, Empty, Modal, Space, Typography } from 'antd';
import type { SopBatch } from '../../../shared/sop';
import { sopRequest } from '../api';

export function TrashDialog({
  open,
  batches,
  busy,
  restoreDisabled,
  onClose,
  onRefresh,
  onRestore,
}: {
  open: boolean;
  batches: SopBatch[];
  busy: boolean;
  restoreDisabled: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onRestore: (id: string) => Promise<unknown>;
}) {
  const { modal, message } = App.useApp();
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState('');
  function confirmPurge(targets: SopBatch[], all: boolean) {
    modal.confirm({
      title: all ? `清空回收站中的 ${targets.length} 个计划？` : `永久删除「${targets[0].name}」？`,
      content:
        '将永久删除所选计划的文案、模板、操作记录、通知记录和本地生成文件，删除后无法恢复。此操作不会撤回或删除 Facebook 通知。',
      okText: all ? '确认清空' : '确认永久删除',
      cancelText: '保留计划',
      okType: 'danger',
      onOk: async () => {
        setWorking(true);
        setFailure('');
        try {
          const result = await sopRequest<{
            purgedIds: string[];
            failed: { id: string; error: string }[];
          }>(
            all ? '/trash' : `/trash/${targets[0].id}`,
            { ids: targets.map((b) => b.id) },
            'DELETE',
          );
          await onRefresh();
          if (result.failed.length) {
            setFailure(
              result.failed
                .map((f) => `${targets.find((b) => b.id === f.id)?.name || '计划'}：${f.error}`)
                .join('\n'),
            );
            message.warning(
              `已永久删除 ${result.purgedIds.length} 个，${result.failed.length} 个失败，请查看回收站提示。`,
            );
          } else
            message.success(
              result.purgedIds.length
                ? `已永久删除 ${result.purgedIds.length} 个计划`
                : '这些计划已被删除，列表已刷新',
            );
        } catch (e) {
          setFailure((e as Error).message);
          await onRefresh();
          throw e;
        } finally {
          setWorking(false);
        }
      },
    });
  }
  return (
    <Modal
      open={open}
      title="计划回收站"
      width={660}
      onCancel={() => {
        if (!working) onClose();
      }}
      footer={null}
    >
      <Typography.Paragraph type="secondary">
        恢复后需重新检查排期并准备 CSV。永久删除会清理计划及其本地文件，无法恢复。
      </Typography.Paragraph>
      {failure && (
        <Alert
          type="error"
          showIcon
          message="部分操作未完成"
          description={<span style={{ whiteSpace: 'pre-wrap' }}>{failure}</span>}
        />
      )}
      <div className="trash-toolbar">
        <Typography.Text type="secondary">共 {batches.length} 个未执行计划</Typography.Text>
        <Button
          danger
          disabled={busy || working || !batches.length}
          onClick={() => confirmPurge([...batches], true)}
        >
          清空回收站
        </Button>
      </div>
      {!batches.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="回收站为空" />
      ) : (
        batches.map((batch) => (
          <div className="trash-row" key={batch.id}>
            <div>
              <strong>{batch.name}</strong>
              <div>
                <Typography.Text type="secondary">
                  删除于 {new Date(batch.deletedAt!).toLocaleString('zh-CN', { hour12: false })}
                </Typography.Text>
              </div>
            </div>
            <Space wrap>
              <Button
                disabled={busy || working || restoreDisabled}
                title={restoreDisabled ? '请先保存当前文案，再恢复其他计划' : undefined}
                onClick={() => void onRestore(batch.id)}
              >
                恢复
              </Button>
              <Button
                danger
                disabled={busy || working}
                onClick={() => confirmPurge([batch], false)}
              >
                永久删除
              </Button>
            </Space>
          </div>
        ))
      )}
    </Modal>
  );
}
