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

/** 全角空格（用转义，避免触发 no-irregular-whitespace；渲染出可见缩进）。 */
const FW = '\u3000';

/** 单条推送结果对应的一行 lark_md 文本（只给「概览」用，不含逐条明细）。 */
function gameLine(r: GameResult): string {
  if (r.skipped) {
    return `🔘 <font color='grey'>**${r.projectName}**${FW}续跑跳过</font>`;
  }
  if (r.gameError) {
    return `🔴 <font color='red'>**${r.projectName}**${FW}整体失败</font>`;
  }
  if (r.failedLabels.length) {
    return (
      `🟠 **${r.projectName}**${FW}成功 <font color='green'>${r.succeeded}</font>/${r.total}` +
      `，失败 <font color='red'>${r.failedLabels.length}</font>`
    );
  }
  return `🟢 **${r.projectName}**${FW}成功 <font color='green'>${r.succeeded}</font>/${r.total}`;
}

/** 失败原因分类：用于把明细按原因归组，给出统一的处理建议。 */
type FailCategory = 'active_limit' | 'save_error' | 'game_error' | 'other';

interface CategoryMeta {
  icon: string;
  title: string;
  /** 给运营的一句话操作建议。 */
  advice: string;
}

const CATEGORY_ORDER: FailCategory[] = ['active_limit', 'save_error', 'game_error', 'other'];

const CATEGORY_META: Record<FailCategory, CategoryMeta> = {
  active_limit: {
    icon: '🚫',
    title: '已达 active 上限（每个 app 最多 10 条）',
    advice: '先到后台把过期/多余的通知 Turn Off 或删除，再运行 `npm start -- --resume` 补跑。',
  },
  save_error: {
    icon: '🧩',
    title: 'Meta 保存报错（Something went wrong）',
    advice: '工具已「删除+重传」自动补救仍失败，多为该条数据问题；可到后台手动重建，或稍后重跑。',
  },
  game_error: {
    icon: '🛑',
    title: '整个游戏失败（导航 / 上传阶段）',
    advice: '常见于未登录或页面结构变化；确认 AdsPower 已登录后重跑，仍失败见截图/日志。',
  },
  other: {
    icon: '❓',
    title: '其它错误',
    advice: '详见运行日志与 screenshots/ 截图。',
  },
};

function categorize(error: string): FailCategory {
  if (/ACTIVE_LIMIT|more than 10 active/i.test(error)) return 'active_limit';
  if (/SAVE_SERVER_ERROR|Something went wrong|noncoercible|补救/i.test(error)) return 'save_error';
  return 'other';
}

interface FailItem {
  project: string;
  label: string;
}

/** 把所有失败按原因归组（gameError 归到 game_error）。 */
function groupFailures(results: GameResult[]): Map<FailCategory, FailItem[]> {
  const groups = new Map<FailCategory, FailItem[]>();
  const add = (cat: FailCategory, item: FailItem): void => {
    const arr = groups.get(cat) ?? [];
    arr.push(item);
    groups.set(cat, arr);
  };
  for (const r of results) {
    if (r.skipped) continue;
    if (r.gameError) {
      add('game_error', { project: r.projectName, label: '（整体）' });
      continue;
    }
    for (const f of r.failedLabels) add(categorize(f.error), { project: r.projectName, label: f.label });
  }
  return groups;
}

const MAX_ITEMS_PER_GROUP = 20;

/** 一个失败分组渲染成一段 lark_md（标题 + 建议 + 受影响条目）。 */
function renderGroup(cat: FailCategory, items: FailItem[]): string {
  const meta = CATEGORY_META[cat];
  const shown = items.slice(0, MAX_ITEMS_PER_GROUP);
  const more = items.length - shown.length;
  const list = shown
    .map((it) => `${FW}• <font color='grey'>${escapeMd(it.project)}</font> · ${escapeMd(it.label)}`)
    .join('\n');
  const tail = more > 0 ? `\n${FW}… 等共 ${items.length} 条` : '';
  return (
    `**${meta.icon} ${meta.title}** · <font color='red'>${items.length}</font> 条\n` +
    `<font color='grey'>👉 ${meta.advice}</font>\n${list}${tail}`
  );
}

/** 三列统计（成功 / 失败 / 耗时），一眼看清整体。 */
function statColumns(totalOk: number, totalItems: number, totalFailed: number, duration: string) {
  const col = (content: string): unknown => ({
    tag: 'column',
    width: 'weighted',
    weight: 1,
    vertical_align: 'top',
    elements: [{ tag: 'div', text: { tag: 'lark_md', content } }],
  });
  return {
    tag: 'column_set',
    flex_mode: 'stretch',
    background_style: 'default',
    columns: [
      col(`**✅ 成功**\n<font color='green'>**${totalOk}**</font> / ${totalItems}`),
      col(
        totalFailed > 0
          ? `**❌ 失败**\n<font color='red'>**${totalFailed}**</font>`
          : `**❌ 失败**\n**0**`,
      ),
      col(`**⏱ 耗时**\n${duration}`),
    ],
  };
}

/** 飞书交互卡片结构（仅覆盖用到的字段）。 */
export interface FeishuCard {
  config: { wide_screen_mode: boolean };
  header: { template: string; title: { tag: 'plain_text'; content: string } };
  elements: unknown[];
}

/** 把运行摘要拼成飞书交互卡片（大号统计 + 每游戏概览 + 失败按原因分组 + 操作建议）。 */
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

  const elements: unknown[] = [];

  if (dryRun) {
    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: "<font color='grey'>🧪 DRY-RUN 演练：未真正 Save / Turn On。</font>",
      },
    });
  }

  // 大号三列统计。
  elements.push(statColumns(totalOk, totalItems, totalFailed, duration));

  // 每游戏一行概览。
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'div',
    text: { tag: 'lark_md', content: results.map(gameLine).join('\n') },
  });

  // 失败按原因分组 + 操作建议。
  if (totalFailed > 0) {
    const groups = groupFailures(results);
    elements.push({ tag: 'hr' });
    elements.push({
      tag: 'div',
      text: { tag: 'lark_md', content: '**🔎 失败明细（按原因分组）**' },
    });
    for (const cat of CATEGORY_ORDER) {
      const items = groups.get(cat);
      if (items && items.length > 0) {
        elements.push({ tag: 'div', text: { tag: 'lark_md', content: renderGroup(cat, items) } });
      }
    }
  }

  const noteContents: unknown[] = [
    { tag: 'plain_text', content: `完成时间：${finishedAt.toLocaleString('zh-CN')}` },
  ];
  if (logFile) noteContents.push({ tag: 'plain_text', content: `日志：${logFile}` });
  elements.push({ tag: 'note', elements: noteContents });

  const title = dryRun
    ? '🧪 Meta 游戏推送 · 演练完成'
    : hasFailure
      ? '⚠️ Meta 游戏推送 · 部分失败'
      : '✅ Meta 游戏推送 · 全部完成';

  return {
    config: { wide_screen_mode: true },
    header: {
      template: dryRun ? 'grey' : hasFailure ? 'red' : 'green',
      title: { tag: 'plain_text', content: title },
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
