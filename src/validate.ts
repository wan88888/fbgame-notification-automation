import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { isValidDate, normalizeDateKey } from './date-utils.js';

/** 内容表校验结果。errors 会阻断上传；warnings 仅提示。 */
export interface ValidationResult {
  errors: string[];
  warnings: string[];
  /** 解析到的数据行数（不含表头）。 */
  rowCount: number;
  /** 内容表里出现的全部 label（按出现顺序）。 */
  labels: string[];
}

/**
 * 检查排期里是否有「同一天多条」——Meta 规则：同一天只允许 1 条 active Single Send，
 * 否则第 2 条起保存会报「You cannot have more than 1 active Single Send notification
 * scheduled in one day」。返回 date -> labels（仅含冲突的日期）。
 */
export function findSameDayConflicts(
  notifications: { label: string; date: string }[],
): Map<string, string[]> {
  const byDate = new Map<string, string[]>();
  for (const n of notifications) {
    // 先归一化日期，使 "2026-07-19" 与 "7/19/2026" 视为同一天。
    const date = normalizeDateKey(n.date);
    if (!date) continue;
    const arr = byDate.get(date) ?? [];
    arr.push(n.label);
    byDate.set(date, arr);
  }
  const conflicts = new Map<string, string[]>();
  for (const [date, labels] of byDate) {
    if (labels.length > 1) conflicts.set(date, labels);
  }
  return conflicts;
}

/**
 * 校验排期里每条 date 是否为可识别的格式（YYYY-MM-DD 或 M/D/YYYY）。
 * 尽早在 --validate-only / 上传前拦掉非法日期，避免跑到编辑某条时才因 toUsDate 抛错中断。
 * 返回错误信息列表（为空表示全部合法）。
 */
export function validateScheduleDates(notifications: { label: string; date: string }[]): string[] {
  const errors: string[] = [];
  for (const n of notifications) {
    if (!isValidDate(n.date)) {
      errors.push(
        `排期条目「${n.label}」的日期「${n.date}」格式非法（请用 YYYY-MM-DD 或 M/D/YYYY）。`,
      );
    }
  }
  return errors;
}

/** Meta 支持的「非语言」列（其余需是 notification_title_/notification_body_ 前缀）。 */
const SUPPORTED_BASE_COLUMNS = new Set([
  'label',
  'media_url',
  'payload',
  'bot_message_payload_elements',
]);

const TITLE_PREFIX = 'notification_title_';
const BODY_PREFIX = 'notification_body_';

function isJsonParsable(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验一份「内容表」CSV 是否符合 Meta「Create from CSV」的基本要求，
 * 尽量在上传前拦掉会导致「Trying to create N notifications, and 0 are created」的问题。
 *
 * 可选传入 scheduleLabels（排期表里的 label），用于交叉检查两边是否对得上。
 */
export function validateContentCsv(csvPath: string, scheduleLabels?: string[]): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const abs = resolve(process.cwd(), csvPath);

  if (!existsSync(abs)) {
    return { errors: [`内容表不存在: ${abs}`], warnings, rowCount: 0, labels: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(abs, 'utf-8');
  } catch (e) {
    return {
      errors: [`无法读取内容表: ${abs}（${(e as Error).message}）`],
      warnings,
      rowCount: 0,
      labels: [],
    };
  }

  // 先按「表头行」拿到列名，用于检测空列名（表尾多余逗号）。
  let header: string[];
  try {
    const headerRows = parse(raw, { toLine: 1, bom: true, relax_column_count: true }) as string[][];
    header = headerRows[0] ?? [];
  } catch (e) {
    return {
      errors: [`内容表不是合法 CSV: ${abs}（${(e as Error).message}）`],
      warnings,
      rowCount: 0,
      labels: [],
    };
  }

  const emptyHeaderCount = header.filter((h) => h.trim() === '').length;
  if (emptyHeaderCount > 0) {
    warnings.push(
      `表头有 ${emptyHeaderCount} 个空列名（多半是行尾多余逗号造成），建议清理以免个别解析器报错。`,
    );
  }

  const namedCols = header.map((h) => h.trim()).filter((h) => h !== '');
  const hasLabel = namedCols.includes('label');
  if (!hasLabel) {
    errors.push('缺少必填列 label。');
  }

  // 语言列检查：至少要有一对 title/body 语言列。
  const titleLangs = new Set(
    namedCols.filter((c) => c.startsWith(TITLE_PREFIX)).map((c) => c.slice(TITLE_PREFIX.length)),
  );
  const bodyLangs = new Set(
    namedCols.filter((c) => c.startsWith(BODY_PREFIX)).map((c) => c.slice(BODY_PREFIX.length)),
  );
  const pairedLangs = [...titleLangs].filter((l) => bodyLangs.has(l));
  if (pairedLangs.length === 0) {
    errors.push(
      `缺少成对的语言列（至少要有一组 ${TITLE_PREFIX}<语言> 和 ${BODY_PREFIX}<语言>，如 ${TITLE_PREFIX}English / ${BODY_PREFIX}English）。`,
    );
  }

  // 不受支持的列 → 警告（Meta 通常忽略多余列，但提示更清晰）。
  const unsupported = namedCols.filter(
    (c) =>
      !SUPPORTED_BASE_COLUMNS.has(c) && !c.startsWith(TITLE_PREFIX) && !c.startsWith(BODY_PREFIX),
  );
  if (unsupported.length > 0) {
    warnings.push(
      `存在 Meta 不支持的列（会被忽略）：${unsupported.join(', ')}。图片列请用 media_url。`,
    );
  }

  // 解析数据行做逐行检查。
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
    errors.push(`内容表数据行解析失败: ${(e as Error).message}`);
    return { errors, warnings, rowCount: 0, labels: [] };
  }

  const labels: string[] = [];
  const seen = new Map<string, number>();
  const jsonCols = ['bot_message_payload_elements', 'payload'].filter((c) => namedCols.includes(c));

  rows.forEach((row, idx) => {
    const lineNo = idx + 2; // 含表头
    const label = (row['label'] ?? '').trim();

    if (hasLabel) {
      if (!label) {
        errors.push(`第 ${lineNo} 行 label 为空。`);
      } else {
        labels.push(label);
        const prev = seen.get(label);
        if (prev !== undefined) {
          errors.push(
            `label 重复：「${label}」出现在第 ${prev} 行和第 ${lineNo} 行（重复 label 会导致整批 0 created）。`,
          );
        } else {
          seen.set(label, lineNo);
        }
      }
    }

    // 每行至少一种语言 title+body 同时非空。
    if (pairedLangs.length > 0) {
      const ok = pairedLangs.some(
        (l) =>
          (row[`${TITLE_PREFIX}${l}`] ?? '').trim() !== '' &&
          (row[`${BODY_PREFIX}${l}`] ?? '').trim() !== '',
      );
      if (!ok) {
        errors.push(
          `第 ${lineNo} 行 (${label || '无 label'}) 没有任何一种语言同时填了 title 和 body。`,
        );
      }
    }

    // JSON 列若有内容则校验能否解析。
    for (const c of jsonCols) {
      const v = (row[c] ?? '').trim();
      if (v && !isJsonParsable(v)) {
        warnings.push(`第 ${lineNo} 行 (${label || '无 label'}) 的 ${c} 不是合法 JSON。`);
      }
    }
  });

  if (rows.length === 0) {
    errors.push('内容表没有数据行。');
  }

  // 与排期表双向交叉检查（集中在此一处输出）。
  if (scheduleLabels && scheduleLabels.length > 0 && labels.length > 0) {
    const contentSet = new Set(labels);
    const scheduleSet = new Set(scheduleLabels);

    // 方向一：排期里有、内容表里没有 → 自动化会定位不到行（阻断性错误）。
    const missingInContent = scheduleLabels.filter((l) => !contentSet.has(l));
    if (missingInContent.length > 0) {
      errors.push(
        `排期表里的这些 label 在内容表中找不到（自动化会定位不到行）：${missingInContent.join(', ')}。`,
      );
    }

    // 方向二：内容表里有、但排期未安排日期 → 本次不会处理（仅提示）。
    const notScheduled = labels.filter((l) => !scheduleSet.has(l));
    if (notScheduled.length > 0) {
      warnings.push(
        `内容表里这些 label 未在排期表中安排日期（本次不会被处理）：${notScheduled.join(', ')}。`,
      );
    }
  }

  return { errors, warnings, rowCount: rows.length, labels };
}
