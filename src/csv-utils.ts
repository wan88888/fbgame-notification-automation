/** CSV 相关的共享工具。 */

/**
 * 简单 CSV 字段转义：字段含逗号 / 引号 / 换行时用双引号包裹，
 * 内部的双引号翻倍（`"` -> `""`），符合 RFC 4180。
 */
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
