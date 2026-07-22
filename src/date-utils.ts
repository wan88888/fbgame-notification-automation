/** 日期相关的纯工具（无浏览器依赖，便于在 --validate-only 阶段复用）。 */

/**
 * 将日期规整为后台日期框接受的 "M/D/YYYY"（无前导零，匹配截图里的 7/20/2026）。
 * 支持输入 "YYYY-MM-DD" 或 "M/D/YYYY" / "MM/DD/YYYY"。
 * 无法识别时抛错。
 */
export function toUsDate(input: string): string {
  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${Number(m)}/${Number(d)}/${y}`;
  }
  const us = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${Number(m)}/${Number(d)}/${y}`;
  }
  throw new Error(`无法识别的日期格式: "${input}"（请用 YYYY-MM-DD 或 M/D/YYYY）`);
}

/** date 是否为 toUsDate 可识别的合法格式。 */
export function isValidDate(input: string): boolean {
  try {
    toUsDate(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * 归一化日期用于「同日」比较：合法日期统一成 M/D/YYYY，
 * 这样 "2026-07-19" 与 "7/19/2026" 会被视为同一天；无法识别的原样返回（去首尾空格）。
 */
export function normalizeDateKey(input: string): string {
  const trimmed = (input ?? '').trim();
  try {
    return toUsDate(trimmed);
  } catch {
    return trimmed;
  }
}
