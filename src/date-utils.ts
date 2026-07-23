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

/** 将 Date 按「本地时区」格式化为 YYYY-MM-DD（排期表统一用这个格式）。 */
export function toIsoDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 把用户输入的日期解析为「本地零点」的 Date。
 * 接受 "YYYY-MM-DD" 或 "M/D/YYYY"（复用 toUsDate 的识别与校验）。
 * 无法识别时抛错。
 */
export function parseFlexibleDate(input: string): Date {
  const us = toUsDate(input); // 抛错即为非法格式
  const [m, d, y] = us.split('/').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 从起始日起生成 count 个「连续自然日」的 YYYY-MM-DD 列表（含起始日、含周末）。
 * 用于排期表自动填充：周三起连续推 7 天到下周二。
 * start 可为 Date 或可被 parseFlexibleDate 解析的字符串。
 */
export function generateDates(start: Date | string, count: number): string[] {
  const base = typeof start === 'string' ? parseFlexibleDate(start) : new Date(start);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    out.push(toIsoDate(dt));
  }
  return out;
}

/**
 * 计算默认排期起始日 = 给定「运行日」的次日（本地零点）。
 * 运营固定周二运行，则起始日为周三；不传则以今天为运行日。
 */
export function defaultStartDate(runDay: Date = new Date()): Date {
  return new Date(runDay.getFullYear(), runDay.getMonth(), runDay.getDate() + 1);
}

/**
 * 判断「日期输入框回显值」是否与目标 M/D/YYYY 一致。
 * 按数字序列比较，容忍前导零与分隔符差异（"08/01/2026" ≈ "8/1/2026"）。
 * 用于写入日期后回读校验，尽早发现「输入未生效」。
 */
export function dateInputMatches(shown: string, usDate: string): boolean {
  const nums = (s: string): string =>
    ((s ?? '').match(/\d+/g) ?? []).map((n) => String(Number(n))).join('/');
  const target = nums(usDate);
  return target !== '' && nums(shown) === target;
}
