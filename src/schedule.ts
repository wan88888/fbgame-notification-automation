import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { NotificationSchedule } from './types.js';
import { log } from './logger.js';

/** 排期表里可识别的列名（大小写、空格、下划线均不敏感）。 */
const LABEL_KEYS = ['label', 'labels', '文案', '文案label', 'name'];
const DATE_KEYS = [
  'date',
  'notificationdate',
  'notification_date',
  '日期',
  '推送日期',
  'scheduledate',
];
const STRATEGY_KEYS = [
  'sendtimestrategy',
  'send_time_strategy',
  'strategy',
  'sendtime',
  '推送类别',
  '类别',
  '发送策略',
  '发送时间策略',
];

function norm(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '');
}

function pick(row: Record<string, string>, candidates: string[]): string | undefined {
  const normalized = candidates.map(norm);
  for (const [k, v] of Object.entries(row)) {
    if (normalized.includes(norm(k)) && v !== undefined && v.trim() !== '') {
      return v.trim();
    }
  }
  return undefined;
}

/**
 * 解析运营的「排期表」CSV：至少包含 label 与 date 两列。
 * send_time_strategy（推送类别）为可选列，缺省即 Predicted Best Time；
 * 需要非默认策略时再手动加该列即可。列名大小写/中英文均兼容。
 *
 * 示例（常用，仅两列）：
 *   label,date
 *   AHA_001,2026-07-19
 *   AHA_002,2026-07-20
 */
export function parseScheduleSheet(path: string): NotificationSchedule[] {
  const abs = resolve(process.cwd(), path);
  let raw: string;
  try {
    raw = readFileSync(abs, 'utf-8');
  } catch {
    throw new Error(`无法读取排期表: ${abs}`);
  }

  let rows: Record<string, string>[];
  try {
    rows = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (e) {
    throw new Error(`排期表不是合法 CSV: ${abs}. ${(e as Error).message}`, { cause: e });
  }

  const result: NotificationSchedule[] = [];
  for (const [i, row] of rows.entries()) {
    const label = pick(row, LABEL_KEYS);
    const date = pick(row, DATE_KEYS);
    const strategy = pick(row, STRATEGY_KEYS);

    // 跳过完全空行；日期未填的行先跳过（方便运营逐步填排期）。
    if (!label && !date) continue;
    if (!label) throw new Error(`排期表 ${abs} 第 ${i + 2} 行缺少 label 列`);
    if (!date) {
      log.warn(`排期表 ${abs} 第 ${i + 2} 行 (${label}) 未填 date，已跳过`);
      continue;
    }

    result.push(strategy ? { label, date, sendTimeStrategy: strategy } : { label, date });
  }

  return result;
}
