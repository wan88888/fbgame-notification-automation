/** 内容表 CSV 健康检查与已知格式问题的安全自动修复。 */
import { parse } from 'csv-parse/sync';

/**
 * 已知安全修复：image_url / media_url 这类「未加引号的 URL」末尾多了一个右引号。
 * 例：`...,https://cdn/.../a.jpg",https://www.facebook.com/...`
 *     → `...,https://cdn/.../a.jpg,https://www.facebook.com/...`
 *
 * 不会动 JSON 字段里的 `""https://...jpg""`（双引号转义），因为模式要求 URL 前不是引号字符。
 */
export const STRAY_URL_QUOTE_RE =
  /(^|[^"])(https?:\/\/[^\s,"]+?\.(?:jpe?g|png|gif|webp))"(\s*,\s*https?:\/\/)/gi;

export interface ContentCsvIssue {
  /** 1-based 行号（按文本行，不是 CSV 逻辑行）。 */
  line: number;
  /** 简短描述。 */
  message: string;
  /** 是否可被 fixContentCsvText 自动修复。 */
  fixable: boolean;
}

export interface ContentCsvDiagnosis {
  ok: boolean;
  /** 解析得到的 label 列表（解析成功时才有）。 */
  labels: string[];
  issues: ContentCsvIssue[];
  /** 原始解析错误摘要（若有）。 */
  parseError?: string;
}

/** 统计文本中某正则的匹配，并给出行号。 */
export function findStrayUrlQuotes(text: string): ContentCsvIssue[] {
  const issues: ContentCsvIssue[] = [];
  const re = new RegExp(STRAY_URL_QUOTE_RE.source, STRAY_URL_QUOTE_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const line = text.slice(0, m.index).split(/\r?\n/).length;
    issues.push({
      line,
      message: `疑似 image_url 末尾多了一个不成对的引号（第 ${line} 行附近）。`,
      fixable: true,
    });
  }
  return issues;
}

/** 应用已知安全修复，返回新文本与修复次数。 */
export function fixContentCsvText(text: string): { text: string; fixed: number } {
  let fixed = 0;
  const next = text.replace(STRAY_URL_QUOTE_RE, (_all, prefix: string, url: string, sep: string) => {
    fixed += 1;
    return `${prefix}${url}${sep}`;
  });
  return { text: next, fixed };
}

/**
 * 诊断内容表：先扫已知坏模式，再尝试严格解析。
 * 解析成功且无已知坏模式 → ok。
 */
export function diagnoseContentCsv(raw: string): ContentCsvDiagnosis {
  const issues = findStrayUrlQuotes(raw);
  try {
    const rows = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: true,
    }) as Record<string, string>[];

    const labels: string[] = [];
    for (const row of rows) {
      const label = (row['label'] ?? '').trim();
      if (label) labels.push(label);
    }

    if (issues.length > 0) {
      // 极少见：坏模式存在但解析仍过了（列错位风险），仍标不 ok。
      return {
        ok: false,
        labels,
        issues,
        parseError: undefined,
      };
    }
    return { ok: true, labels, issues: [] };
  } catch (e) {
    const err = e as Error & { code?: string; lines?: number; column?: string };
    const where =
      err.lines != null
        ? `约第 ${err.lines} 行${err.column ? `（列 ${err.column}）` : ''}`
        : '';
    const parseError = `${err.code ? `[${err.code}] ` : ''}${err.message}${where ? ` @ ${where}` : ''}`;

    if (issues.length === 0) {
      issues.push({
        line: err.lines ?? 0,
        message: `内容表 CSV 无法解析：${parseError}`,
        fixable: false,
      });
    } else {
      issues.push({
        line: err.lines ?? 0,
        message: `内容表 CSV 无法解析：${parseError}（上面标 fixable 的可用 npm run fix-content-csv 尝试修复）`,
        fixable: false,
      });
    }
    return { ok: false, labels: [], issues, parseError };
  }
}
