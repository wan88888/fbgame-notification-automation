/** 运行结束后向飞书（Lark）自定义机器人推送本次批处理结果。 */
import { createHmac } from 'node:crypto';
import type { GameResult } from './types.js';
import { log } from './logger.js';

/** 飞书通知配置（对应 .env 里的 FEISHU_* 项）。 */
export interface FeishuConfig {
  /** 自定义机器人 Webhook 地址。留空则完全跳过通知。 */
  webhookUrl: string;
  /** 若机器人开启了「签名校验」，填写签名密钥；否则留空。 */
  signSecret: string;
  /** 发送请求的超时（毫秒）。 */
  timeoutMs: number;
}

/** 一次运行的结果摘要，用于拼装通知内容。 */
export interface RunSummary {
  results: GameResult[];
  /** 是否存在失败（整体失败或有失败条目）。 */
  hasFailure: boolean;
  /** 本次运行日志文件路径（可能为 null）。 */
  logFile: string | null;
  /** 运行起止时间，用于展示耗时。 */
  startedAt: Date;
  finishedAt: Date;
  /** dry-run 模式标记（消息里注明，避免误读为真的发了推送）。 */
  dryRun: boolean;
}

/** 把毫秒时长格式化成 "Xm Ys" / "Ys"。 */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** 生成飞书签名：base64(HmacSHA256(key = `${timestamp}\n${secret}`, data = ""))。 */
function genSign(timestamp: number, secret: string): string {
  const stringToSign = `${timestamp}\n${secret}`;
  return createHmac('sha256', stringToSign).update('').digest('base64');
}

/** 转义 lark_md 里可能干扰渲染的字符（错误信息中常见）。 */
function escapeMd(s: string): string {
  return s.replace(/[*_~`]/g, (c) => `\\${c}`);
}

/** 单条推送结果对应的一行 lark_md 文本（带状态色）。 */
function gameLine(r: GameResult): string {
  if (r.skipped) {
    return `🔘 <font color='grey'>**${r.projectName}**：续跑跳过（上一批次已完成）</font>`;
  }
  if (r.gameError) {
    return `🔴 <font color='red'>**${r.projectName}**：整体失败</font> — ${escapeMd(r.gameError)}`;
  }
  if (r.failedLabels.length) {
    const details = r.failedLabels
      .map((f) => `    • ${escapeMd(f.label)}: ${escapeMd(f.error)}`)
      .join('\n');
    return (
      `🟠 <font color='orange'>**${r.projectName}**：成功 ${r.succeeded}/${r.total}，` +
      `失败 ${r.failedLabels.length} 条</font>\n${details}`
    );
  }
  return `🟢 <font color='green'>**${r.projectName}**：成功 ${r.succeeded}/${r.total}</font>`;
}

/** 飞书交互卡片结构（仅覆盖用到的字段）。 */
export interface FeishuCard {
  config: { wide_screen_mode: boolean };
  header: { template: string; title: { tag: 'plain_text'; content: string } };
  elements: unknown[];
}

/** 把运行摘要拼成飞书交互卡片（彩色标题 + 分区明细）。 */
export function buildFeishuCard(summary: RunSummary): FeishuCard {
  const { results, hasFailure, logFile, startedAt, finishedAt, dryRun } = summary;

  const processed = results.filter((r) => !r.skipped);
  const totalItems = processed.reduce((n, r) => n + r.total, 0);
  const totalOk = processed.reduce((n, r) => n + r.succeeded, 0);
  const totalFailed = processed.reduce(
    (n, r) => n + (r.gameError ? r.total : r.failedLabels.length),
    0,
  );
  const duration = formatDuration(finishedAt.getTime() - startedAt.getTime());

  const overview =
    `**总览：** 成功 <font color='green'>${totalOk}</font>/${totalItems} 条` +
    (totalFailed > 0 ? `，失败 <font color='red'>${totalFailed}</font> 条` : '') +
    `\n**耗时：** ${duration}` +
    (dryRun ? `\n<font color='grey'>（DRY-RUN 模式：未真正 Save / Turn On）</font>` : '');

  const elements: unknown[] = [
    { tag: 'div', text: { tag: 'lark_md', content: overview } },
    { tag: 'hr' },
    { tag: 'div', text: { tag: 'lark_md', content: results.map(gameLine).join('\n') } },
  ];

  const noteContents: unknown[] = [
    { tag: 'plain_text', content: `完成时间：${finishedAt.toLocaleString('zh-CN')}` },
  ];
  if (logFile) noteContents.push({ tag: 'plain_text', content: `日志：${logFile}` });
  elements.push({ tag: 'note', elements: noteContents });

  return {
    config: { wide_screen_mode: true },
    header: {
      template: dryRun ? 'grey' : hasFailure ? 'red' : 'green',
      title: {
        tag: 'plain_text',
        content: hasFailure ? '⚠️ Meta 游戏推送：部分失败' : '✅ Meta 游戏推送：全部完成',
      },
    },
    elements,
  };
}

/**
 * 向飞书自定义机器人推送本次运行结果（交互卡片）。
 * - 未配置 webhookUrl 时静默跳过（不影响主流程）。
 * - 任何网络/接口错误只记 warn，不抛出，避免影响退出码。
 */
export async function notifyFeishu(cfg: FeishuConfig, summary: RunSummary): Promise<void> {
  if (!cfg.webhookUrl) return;

  const body: Record<string, unknown> = {
    msg_type: 'interactive',
    card: buildFeishuCard(summary),
  };
  if (cfg.signSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    body.timestamp = String(timestamp);
    body.sign = genSign(timestamp, cfg.signSecret);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    // 飞书即便参数有误也可能返回 HTTP 200，但 body.code !== 0，需一并检查。
    const data = (await res.json().catch(() => ({}))) as { code?: number; msg?: string };
    if (!res.ok || (data.code !== undefined && data.code !== 0)) {
      log.warn(`飞书通知发送失败：HTTP ${res.status}${data.msg ? ` - ${data.msg}` : ''}`);
    } else {
      log.info('已发送飞书通知。');
    }
  } catch (e) {
    const err = e as Error;
    const reason = err.name === 'AbortError' ? `请求超时（${cfg.timeoutMs}ms）` : err.message;
    log.warn(`飞书通知发送异常：${reason}`);
  } finally {
    clearTimeout(timer);
  }
}
