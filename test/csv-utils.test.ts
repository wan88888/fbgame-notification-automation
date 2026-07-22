import { describe, it, expect } from 'vitest';
import { csvEscape } from '../src/csv-utils.js';

describe('csvEscape', () => {
  it('不含特殊字符时原样返回', () => {
    expect(csvEscape('hello')).toBe('hello');
    expect(csvEscape('AHA_001')).toBe('AHA_001');
    expect(csvEscape('')).toBe('');
  });

  it('含逗号时用双引号包裹', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('含双引号时翻倍并包裹', () => {
    expect(csvEscape('quote"inside')).toBe('"quote""inside"');
    expect(csvEscape('"')).toBe('""""');
  });

  it('含换行符（\\n / \\r）时包裹', () => {
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"');
    expect(csvEscape('cr\rreturn')).toBe('"cr\rreturn"');
  });

  it('同时含逗号和引号时正确转义', () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
  });
});
