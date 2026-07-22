import { describe, it, expect } from 'vitest';
import { toUsDate, isValidDate, normalizeDateKey } from '../src/date-utils.js';

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
