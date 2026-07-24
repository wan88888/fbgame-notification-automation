import { isValidDate, normalizeDateKey } from './date-utils.js';

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
 * 运行时在编辑前拦掉非法日期，避免跑到编辑某条时才因 toUsDate 抛错中断。
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
