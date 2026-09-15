import { createHmac, randomUUID } from 'node:crypto';
import type { NotificationRecord, SopBatch } from '../../shared/sop.js';

export interface NotificationState {
  enabled: boolean;
  recipientLabel: string;
  records: NotificationRecord[];
}
const eventTitles: Record<string, string> = {
  execution_completed: '后台执行完成，请核验排期',
  execution_failed: '后台执行失败，需要处理',
  automation_attention: '自动复盘需要处理',
  report_generated: '运营周报已生成',
  next_cycle: '下一周草稿已创建，请审核',
  schedule_attention: '计划即将到期或已过期，请处理',
};
export const notificationConfigured = () => Boolean(process.env.OPS_FEISHU_WEBHOOK_URL);

export function queueNotification(
  state: NotificationState,
  batch: SopBatch,
  action: string,
  at: string,
) {
  const title = eventTitles[action];
  if (!state.enabled || !notificationConfigured() || !title) return;
  state.records.push({
    id: randomUUID(),
    batchId: batch.id,
    title,
    createdAt: at,
    status: 'pending',
    attempts: 0,
    // 不发送原始异常、接口地址或后台日志，避免把密钥和技术日志带到群中。
    text: `PushLoop · ${title}\n计划：${batch.name}\n负责人：${batch.owner || '未指定'}\n请在运营平台查看该计划并处理。排期完成不代表实际送达。`,
  });
}

/** 持久化发送记录；超时可能已被远端接收，有限重试可能产生重复消息。 */
export async function flushNotifications(
  state: NotificationState,
  now: Date,
  request: typeof fetch,
  persist: () => void,
) {
  if (!state.enabled || !notificationConfigured()) return;
  const pending = state.records
    .filter(
      (r) =>
        (r.status === 'pending' || r.status === 'failed') &&
        r.attempts < 3 &&
        (!r.lastAttemptAt || now.getTime() - new Date(r.lastAttemptAt).getTime() >= 300_000),
    )
    .slice(0, 3);
  for (const record of pending) {
    if (!state.enabled) break;
    record.attempts++;
    record.lastAttemptAt = now.toISOString();
    record.status = 'failed';
    record.error = '发送结果尚未确认；服务中断后会按重试次数限制处理。';
    persist();
    try {
      const url = new URL(process.env.OPS_FEISHU_WEBHOOK_URL!);
      if (
        url.protocol !== 'https:' ||
        !['open.feishu.cn', 'open.larksuite.com'].includes(url.hostname)
      )
        throw new Error('请由管理员配置有效的飞书机器人 HTTPS Webhook');
      const body: Record<string, unknown> = { msg_type: 'text', content: { text: record.text } };
      if (process.env.OPS_FEISHU_SIGN_SECRET) {
        const timestamp = String(Math.floor(now.getTime() / 1000));
        body.timestamp = timestamp;
        body.sign = createHmac('sha256', `${timestamp}\n${process.env.OPS_FEISHU_SIGN_SECRET}`)
          .update('')
          .digest('base64');
      }
      const response = await request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      const result = (await response.json()) as { code?: number; StatusCode?: number };
      if (!response.ok || (result.code ?? result.StatusCode) !== 0)
        throw new Error('飞书机器人未确认接收，请检查机器人权限、安全设置和配置');
      record.status = 'sent';
      record.error = undefined;
    } catch {
      record.status = 'failed';
      record.error =
        record.attempts >= 3
          ? '通知未确认送达，已停止重试。请联系管理员并在平台处理计划。'
          : '通知未确认送达，5 分钟后重试；可能出现重复消息。';
    }
    persist();
  }
}
