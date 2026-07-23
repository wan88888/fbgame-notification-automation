import { describe, it, expect } from 'vitest';
import {
  toUsDate,
  isValidDate,
  normalizeDateKey,
  dateInputMatches,
  toIsoDate,
  parseFlexibleDate,
  generateDates,
  defaultStartDate,
} from '../src/date-utils.js';

describe('toUsDate', () => {
  it('把 ISO 日期（YYYY-MM-DD）转成无前导零的 M/D/YYYY', () => {
    expect(toUsDate('2026-07-19')).toBe('7/19/2026');
    expect(toUsDate('2026-12-01')).toBe('12/1/2026');
  });

  it('支持个位月份/日期的 ISO 写法', () => {
    expect(toUsDate('2026-1-5')).toBe('1/5/2026');
  });

  it('已是 M/D/YYYY 时去掉前导零后返回', () => {
    expect(toUsDate('7/19/2026')).toBe('7/19/2026');
    expect(toUsDate('07/09/2026')).toBe('7/9/2026');
  });

  it('无法识别的格式抛错', () => {
    expect(() => toUsDate('July 5, 2026')).toThrow();
    expect(() => toUsDate('2026/13/45')).toThrow();
    expect(() => toUsDate('19-07-2026')).toThrow();
    expect(() => toUsDate('')).toThrow();
  });
});

describe('isValidDate', () => {
  it('合法格式返回 true', () => {
    expect(isValidDate('2026-07-19')).toBe(true);
    expect(isValidDate('7/19/2026')).toBe(true);
  });

  it('非法格式返回 false', () => {
    expect(isValidDate('July 5')).toBe(false);
    expect(isValidDate('2026/13/45')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });
});

describe('normalizeDateKey', () => {
  it('把等价日期归一化成同一 key', () => {
    expect(normalizeDateKey('2026-07-19')).toBe('7/19/2026');
    expect(normalizeDateKey('07/19/2026')).toBe('7/19/2026');
    expect(normalizeDateKey('2026-07-19')).toBe(normalizeDateKey('7/19/2026'));
  });

  it('无法识别时原样返回（去首尾空格）', () => {
    expect(normalizeDateKey('  July 5  ')).toBe('July 5');
    expect(normalizeDateKey('')).toBe('');
  });
});

describe('dateInputMatches', () => {
  it('容忍前导零与分隔符差异', () => {
    expect(dateInputMatches('8/1/2026', '8/1/2026')).toBe(true);
    expect(dateInputMatches('08/01/2026', '8/1/2026')).toBe(true);
    expect(dateInputMatches(' 8/1/2026 ', '8/1/2026')).toBe(true);
  });

  it('值不一致或为空时返回 false', () => {
    expect(dateInputMatches('7/23/2026', '8/1/2026')).toBe(false);
    expect(dateInputMatches('', '8/1/2026')).toBe(false);
    expect(dateInputMatches('Aug 1, 2026', '8/1/2026')).toBe(false);
  });
});

describe('toIsoDate', () => {
  it('按本地时区补零格式化为 YYYY-MM-DD', () => {
    expect(toIsoDate(new Date(2026, 6, 5))).toBe('2026-07-05');
    expect(toIsoDate(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('parseFlexibleDate', () => {
  it('解析 ISO 与 US 两种格式到同一本地日期', () => {
    expect(toIsoDate(parseFlexibleDate('2026-07-29'))).toBe('2026-07-29');
    expect(toIsoDate(parseFlexibleDate('7/29/2026'))).toBe('2026-07-29');
  });

  it('非法格式抛错', () => {
    expect(() => parseFlexibleDate('July 5')).toThrow();
  });
});

describe('generateDates', () => {
  it('从起始日起生成连续 N 天（含起始日、含周末）', () => {
    expect(generateDates('2026-07-29', 7)).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ]);
  });

  it('count 为 0 时返回空数组', () => {
    expect(generateDates('2026-07-29', 0)).toEqual([]);
  });

  it('接受 Date 作为起始', () => {
    expect(generateDates(new Date(2026, 6, 29), 2)).toEqual(['2026-07-29', '2026-07-30']);
  });
});

describe('defaultStartDate', () => {
  it('返回运行日的次日（周二 → 周三）', () => {
    // 2026-07-28 是周二
    expect(toIsoDate(defaultStartDate(new Date(2026, 6, 28)))).toBe('2026-07-29');
  });

  it('跨月边界正确进位', () => {
    expect(toIsoDate(defaultStartDate(new Date(2026, 6, 31)))).toBe('2026-08-01');
  });
});
