/**
 * 清洗 campaigns/content/*.csv，使其更贴近 Meta「Create from CSV」可接受的格式：
 *
 *  - 删除表尾空列名（多余逗号产生的空列）
 *  - 删除 Meta 不支持的列（如 Date、Json_template、url 等工作用列）
 *  - 把 image_url 重命名为 media_url（Meta 的图片列）
 *  - 保留：label、media_url、payload、bot_message_payload_elements、
 *          以及所有 notification_title_<语言> / notification_body_<语言>
 *
 * 原始文件会先备份到 campaigns/content-raw/（仅首次，不覆盖已存在的备份）。
 *
 * 用法：npm run clean-content
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { log } from './logger.js';

const CONTENT_DIR = resolve(process.cwd(), 'campaigns/content');
const BACKUP_DIR = resolve(process.cwd(), 'campaigns/content-raw');

const SUPPORTED_BASE = new Set(['label', 'media_url', 'payload', 'bot_message_payload_elements']);
const TITLE_PREFIX = 'notification_title_';
const BODY_PREFIX = 'notification_body_';
const RENAME: Record<string, string> = { image_url: 'media_url' };

function isKept(col: string): boolean {
  const c = col.trim();
  if (c === '') return false;
  const mapped = RENAME[c] ?? c;
  return (
    SUPPORTED_BASE.has(mapped) || mapped.startsWith(TITLE_PREFIX) || mapped.startsWith(BODY_PREFIX)
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function cleanOne(file: string): { removed: string[]; renamed: string[]; kept: number; rows: number } {
  const path = join(CONTENT_DIR, file);
  const raw = readFileSync(path, 'utf-8');

  // 用数组模式拿表头（保留原始顺序、含空列）。
  const headerRow = (parse(raw, { toLine: 1, bom: true, relax_column_count: true }) as string[][])[0] ?? [];

  // 记录保留的原始列名及其输出列名。
  const keptCols: { src: string; out: string }[] = [];
  const removed: string[] = [];
  const renamed: string[] = [];
  for (const col of headerRow) {
    if (isKept(col)) {
      const out = RENAME[col.trim()] ?? col.trim();
      keptCols.push({ src: col, out });
      if (out !== col.trim()) renamed.push(`${col.trim()} -> ${out}`);
    } else if (col.trim() !== '') {
      removed.push(col.trim());
    }
  }

  // 用对象模式读数据行（csv-parse 自动处理引号/换行/逗号）。
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const lines = [keptCols.map((k) => csvEscape(k.out)).join(',')];
  for (const rec of records) {
    lines.push(keptCols.map((k) => csvEscape((rec[k.src] ?? '').toString())).join(','));
  }

  writeFileSync(path, `${lines.join('\n')}\n`, 'utf-8');
  return { removed, renamed, kept: keptCols.length, rows: records.length };
}

function main(): void {
  if (!existsSync(CONTENT_DIR)) throw new Error(`找不到内容表目录: ${CONTENT_DIR}`);
  mkdirSync(BACKUP_DIR, { recursive: true });

  const files = readdirSync(CONTENT_DIR)
    .filter((f) => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().endsWith('.example.csv'))
    .sort();

  if (files.length === 0) {
    log.warn('content/ 下没有可清洗的内容表。');
    return;
  }

  for (const file of files) {
    // 首次备份原始文件。
    const backup = join(BACKUP_DIR, file);
    if (!existsSync(backup)) {
      copyFileSync(join(CONTENT_DIR, file), backup);
    }

    const { removed, renamed, kept, rows } = cleanOne(file);
    const parts: string[] = [`保留 ${kept} 列 / ${rows} 行`];
    if (renamed.length) parts.push(`重命名: ${renamed.join('，')}`);
    if (removed.length) parts.push(`删除: ${[...new Set(removed)].join(', ')}`);
    log.ok(`已清洗 content/${file}（${parts.join('；')}）`);
  }

  log.info(`完成。原始文件已备份到 ${BACKUP_DIR}（首次运行时）。`);
}

main();
