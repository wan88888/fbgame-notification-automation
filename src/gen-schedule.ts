/**
 * 从 campaigns/content/*.csv 的 label 列生成 / 同步 schedule/*.schedule.csv。
 *
 * - label：来自内容表（保持顺序）
 * - send_time_strategy：固定为 Predicted Best Time
 * - date：默认自动填充「起始日起连续 N 天（每个 label 一天，含周末）」。
 *         起始日默认为「运行日次日」（运营周二跑 → 周三起）；
 *         可用 --start-date YYYY-MM-DD 或环境变量 SCHEDULE_START_DATE 覆盖。
 *         传 --keep-dates 时退回旧行为：保留已填日期、不自动生成。
 *
 * 用法：
 *   npm run gen-schedule                         # 自动填充：次日起连续 7 天
 *   npm run gen-schedule -- --start-date 2026-07-29
 *   SCHEDULE_START_DATE=2026-07-29 npm run gen-schedule
 *   npm run gen-schedule -- --keep-dates         # 只同步 label，不动日期
 */
import 'dotenv/config';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { log } from './logger.js';
import { csvEscape } from './csv-utils.js';
import { defaultStartDate, generateDates, isValidDate, toIsoDate } from './date-utils.js';

const CONTENT_DIR = resolve(process.cwd(), 'campaigns/content');
const SCHEDULE_DIR = resolve(process.cwd(), 'campaigns/schedule');
const SCHEDULE_SUFFIX = '.schedule.csv';
const DEFAULT_STRATEGY = 'Predicted Best Time';

interface GenOptions {
  /** true 时保留已填日期、不自动生成（旧行为）。 */
  keepDates: boolean;
  /** 排期起始日（YYYY-MM-DD）；未指定则取运行日次日。 */
  startDate: string;
}

function parseArgs(argv: string[]): GenOptions {
  const opts: GenOptions = { keepDates: false, startDate: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--keep-dates') {
      opts.keepDates = true;
    } else if (arg === '--start-date') {
      const val = argv[++i];
      if (!val) throw new Error('--start-date 需要一个日期参数（如 2026-07-29）');
      opts.startDate = val;
    } else {
      throw new Error(`未知参数: ${arg}（支持 --start-date <YYYY-MM-DD> / --keep-dates）`);
    }
  }
  return opts;
}

/** 决定本次的排期起始日：CLI > 环境变量 > 运行日次日。校验合法性。 */
function resolveStartDate(opts: GenOptions): string {
  const raw = opts.startDate || process.env['SCHEDULE_START_DATE'] || '';
  if (raw) {
    if (!isValidDate(raw)) {
      throw new Error(`起始日期格式非法: "${raw}"（请用 YYYY-MM-DD 或 M/D/YYYY）`);
    }
    return raw;
  }
  return toIsoDate(defaultStartDate());
}

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
  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(CONTENT_DIR)) {
    throw new Error(`找不到内容表目录: ${CONTENT_DIR}`);
  }
  mkdirSync(SCHEDULE_DIR, { recursive: true });

  const startDate = opts.keepDates ? '' : resolveStartDate(opts);
  if (opts.keepDates) {
    log.info('--keep-dates：仅同步 label，保留已填日期，不自动生成。');
  } else {
    log.info(`自动填充排期起始日: ${startDate}（每个 label 递增一天，含周末）。`);
  }

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
    const autoDates = opts.keepDates ? [] : generateDates(startDate, labels.length);
    const rows = labels.map((label, i) => {
      let date: string;
      if (opts.keepDates) {
        // 旧行为：保留已填日期（label 精确匹配优先，其次按行位次兜底）。
        date = existing.byLabel.get(label) ?? existing.byIndex[i] ?? '';
        if (date) preservedDates += 1;
      } else {
        date = autoDates[i];
      }
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

  if (opts.keepDates) {
    log.info(
      `完成：新建 ${created}，更新 ${updated}，保留已填日期 ${preservedDates} 处。` +
        `请只编辑 schedule/*.schedule.csv 的 date 列。`,
    );
  } else {
    log.info(
      `完成：新建 ${created}，更新 ${updated}，已自动填充日期（起始 ${startDate}）。` +
        `如需手动调整，可编辑 schedule/*.schedule.csv 的 date 列后再运行。`,
    );
  }
}

main();
