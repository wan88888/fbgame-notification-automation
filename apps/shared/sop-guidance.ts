import type { SopBatch } from './sop.js';

export function nextAction(batch: SopBatch, now = new Date()) {
  if (batch.status === 'cancelled')
    return {
      title: '计划已取消',
      detail: batch.cancellationNote || '平台已停止此计划的后续处理。',
      view: 'overview' as const,
      action: '查看计划记录',
    };
  if (batch.status === 'failed')
    return {
      title: '先核查后台，再决定续跑',
      detail:
        '执行结果可能已部分生效。确认同标签通知是否存在；存在时可仅重试编辑与开启，避免重复上传。',
      view: 'copy' as const,
      action: '处理执行异常',
    };
  if (
    ['draft', 'ready'].includes(batch.status) &&
    new Date(
      batch.settings.timingMode === 'predicted' ? `${batch.weekOf}T00:00:00Z` : batch.scheduledAt,
    ) <= now
  )
    return {
      title: '排期已过期，需要重新安排',
      detail: '请使用「复制计划」选择未来周二，复核文案有效期。不要继续执行过期排期。',
      view: 'copy' as const,
      action: '检查并重新安排',
    };
  if (batch.status === 'draft')
    return {
      title: batch.variants.length ? '审核文案并准备 CSV' : '先为本周准备文案',
      detail: batch.variants.length
        ? '选定一条文案、核实活动与奖励，保存后导入模板并准备 CSV。'
        : '使用 AI 或模板起稿，再选择并编辑本周发送内容。',
      view: 'copy' as const,
      action: '继续文案与排期',
    };
  if (batch.status === 'ready')
    return {
      title: '完成执行前检查',
      detail:
        batch.settings.timingMode === 'fixed'
          ? '检查通过后下载 CSV，在 Facebook 设置固定时刻并开启通知，最后回平台记录核验。'
          : '检查账号、文案和日期后执行后台排期。系统不会在计划时间自动启动。',
      view: 'copy' as const,
      action: '检查并安排推送',
    };
  if (batch.status === 'publishing')
    return {
      title: '后台正在执行',
      detail: '完成后将进入人工核验；请勿重复执行或同时操作同一浏览器。',
      view: 'copy' as const,
      action: '查看执行进度',
    };
  if (batch.status === 'verification')
    return {
      title: '执行结束，等待人工核验',
      detail: '到 Facebook 核对通知内容、日期、策略、开启状态和 Publish 结果，再填写核验记录。',
      view: 'copy' as const,
      action: '记录后台核验',
    };
  if (batch.error)
    return {
      title: '效果处理需要协助',
      detail: '检查数据服务连接或导入效果 CSV，然后重新生成周报。原始错误可在技术详情中查看。',
      view: 'results' as const,
      action: '处理效果数据',
    };
  if (batch.nextBatchDiscardedAt && batch.report)
    return {
      title: '周报已完成，下周草稿已永久删除',
      detail: '平台不会自动重建这份草稿；如需重新安排，请使用「复制计划」并选择未来周二。',
      view: 'results' as const,
      action: '查看周报',
    };
  if (batch.report)
    return {
      title: '周报已完成，准备下一轮',
      detail: '查看保留和暂停建议，再创建下一周草稿。新草稿仍需审核。',
      view: 'results' as const,
      action: '查看周报与下一周',
    };
  const due = new Date(
    new Date(batch.scheduledAt).getTime() + (batch.settings.observationHours ?? 144) * 3600_000,
  );
  return {
    title: batch.metrics.length ? '效果数据已导入，可生成周报' : '排期已核验，等待效果数据',
    detail: batch.metrics.length
      ? '已关联数据不等于平台独立确认送达，请按来源核对统计口径。'
      : `建议收集时间：${due.toLocaleString('zh-CN', { timeZone: batch.settings.timezone, hour12: false })}（${batch.settings.timezone}）。排期核验不代表已经送达。`,
    view: 'results' as const,
    action: '查看数据与周报',
  };
}
