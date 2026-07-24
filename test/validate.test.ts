import { describe, it, expect } from 'vitest';
import { findSameDayConflicts, validateScheduleDates } from '../src/validate.js';

describe('findSameDayConflicts', () => {
  it('无冲突时返回空 Map', () => {
    const conflicts = findSameDayConflicts([
      { label: 'a', date: '2026-07-19' },
      { label: 'b', date: '2026-07-20' },
    ]);
    expect(conflicts.size).toBe(0);
  });

  it('同一天多条时返回该日期及其 labels（key 为归一化后的 M/D/YYYY）', () => {
    const conflicts = findSameDayConflicts([
      { label: 'a', date: '2026-07-19' },
      { label: 'b', date: '2026-07-19' },
      { label: 'c', date: '2026-07-20' },
    ]);
    expect(conflicts.size).toBe(1);
    expect(conflicts.get('7/19/2026')).toEqual(['a', 'b']);
  });

  it('忽略空日期的行', () => {
    const conflicts = findSameDayConflicts([
      { label: 'a', date: '' },
      { label: 'b', date: '  ' },
      { label: 'c', date: '2026-07-19' },
    ]);
    expect(conflicts.size).toBe(0);
  });

  it('归一化后 ISO 与 US 写法视为同一天', () => {
    const conflicts = findSameDayConflicts([
      { label: 'a', date: '2026-07-19' },
      { label: 'b', date: '7/19/2026' },
      { label: 'c', date: '07/19/2026' },
    ]);
    expect(conflicts.size).toBe(1);
    const [labels] = [...conflicts.values()];
    expect(labels).toEqual(['a', 'b', 'c']);
  });
});

describe('validateScheduleDates', () => {
  it('全部合法时返回空数组', () => {
    expect(
      validateScheduleDates([
        { label: 'a', date: '2026-07-19' },
        { label: 'b', date: '7/20/2026' },
      ]),
    ).toEqual([]);
  });

  it('非法日期逐条报错', () => {
    const errors = validateScheduleDates([
      { label: 'a', date: '2026-07-19' },
      { label: 'b', date: '2026/13/45' },
      { label: 'c', date: 'July 5' },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('b');
    expect(errors[1]).toContain('c');
  });
});
