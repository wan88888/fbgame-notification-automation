/**
 * 从 campaigns/content/*.csv 的 label 列生成 / 同步 schedule/*.schedule.csv。
 *
 * - label：来自内容表（保持顺序）
 * - send_time_strategy：固定为 Predicted Best Time
 * - date：若已有排期表且同名 label 有日期则保留；否则按行位次兜底保留；仍无则留空
 *
 * 用法：npm run gen-schedule
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { log } from './logger.js';
import { csvEscape } from './csv-utils.js';

const CONTENT_DIR = resolve(process.cwd(), 'campaigns/content');
const SCHEDULE_DIR = resolve(process.cwd(), 'campaigns/schedule');
const SCHEDULE_SUFFIX = '.schedule.csv';
const DEFAULT_STRATEGY = 'Predicted Best Time';

interface ExistingSchedule {
  /** label -> date（精确匹配优先）。 */
  byLabel: Map<string, string>;
  /** 按行顺序的 date 列表（label 改名时按位次兜底保留）。 */
  byIndex: string[];
}

function loadExistingSchedule(path: string): ExistingSchedule {
  const byLabel = new Map<string, string>();
  const byIndex: string[] = [];
  if (!existsSync(path)) return { byLabel, byIndex };

  try {
    const rows = parse(readFileSync(path, 'utf-8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as Record<string, string>[];

    for (const row of rows) {
      const label = (row['label'] ?? '').trim();
      const date = (row['date'] ?? '').trim();
      byIndex.push(date);
      if (label && date) byLabel.set(label, date);
    }
  } catch (e) {
    log.warn(`读取已有排期表失败（将重建）: ${path} — ${(e as Error).message}`);
  }
  return { byLabel, byIndex };
}

function extractLabels(contentPath: string): string[] {
  const rows = parse(readFileSync(contentPath, 'utf-8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const labels: string[] = [];
  for (const [i, row] of rows.entries()) {
    const label = (row['label'] ?? '').trim();
    if (!label) {
      log.warn(`${basename(contentPath)} 第 ${i + 2} 行缺少 label，已跳过`);
      continue;
    }
    labels.push(label);
  }
  return labels;
}

function writeSchedule(
  path: string,
  rows: { label: string; date: string; send_time_strategy: string }[],
): void {
  const lines = ['label,date,send_time_strategy'];
  for (const r of rows) {
    lines.push([csvEscape(r.label), csvEscape(r.date), csvEscape(r.send_time_strategy)].join(','));
  }
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8');
}

function main(): void {
  if (!existsSync(CONTENT_DIR)) {
    throw new Error(`找不到内容表目录: ${CONTENT_DIR}`);
  }
  mkdirSync(SCHEDULE_DIR, { recursive: true });

  const contentFiles = readdirSync(CONTENT_DIR)
    .filter(
      (f) =>
        f.toLowerCase().endsWith('.csv') &&
        !f.toLowerCase().endsWith('.example.csv') &&
        !f.toLowerCase().endsWith(SCHEDULE_SUFFIX),
    )
    .sort();

  if (contentFiles.length === 0) {
    log.warn('content/ 下没有可处理的内容表。');
    return;
  }

  let created = 0;
  let updated = 0;
  let preservedDates = 0;

  for (const file of contentFiles) {
    const name = basename(file, '.csv');
    const contentPath = join(CONTENT_DIR, file);
    const schedulePath = join(SCHEDULE_DIR, `${name}${SCHEDULE_SUFFIX}`);
    const existed = existsSync(schedulePath);

    const labels = extractLabels(contentPath);
    if (labels.length === 0) {
      log.warn(`跳过 ${file}：没有有效 label`);
      continue;
    }

    const existing = loadExistingSchedule(schedulePath);
    const rows = labels.map((label, i) => {
      const date = existing.byLabel.get(label) ?? existing.byIndex[i] ?? '';
      if (date) preservedDates += 1;
      return { label, date, send_time_strategy: DEFAULT_STRATEGY };
    });

    writeSchedule(schedulePath, rows);
    if (existed) {
      updated += 1;
      log.ok(`已同步 schedule/${name}${SCHEDULE_SUFFIX}（${labels.length} 条）`);
    } else {
      created += 1;
      log.ok(`已生成 schedule/${name}${SCHEDULE_SUFFIX}（${labels.length} 条）`);
    }
  }

  log.info(
    `完成：新建 ${created}，更新 ${updated}，保留已填日期 ${preservedDates} 处。` +
      `请只编辑 schedule/*.schedule.csv 的 date 列。`,
  );
}

main();
