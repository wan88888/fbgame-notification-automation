import { describe, it, expect } from 'vitest';
import { repadLabel } from '../src/relabel.js';

describe('repadLabel', () => {
  it('补零到指定位数', () => {
    expect(repadLabel('AHA_1', 2)).toBe('AHA_01');
    expect(repadLabel('AHA_8', 2)).toBe('AHA_08');
    expect(repadLabel('AHA_1', 3)).toBe('AHA_001');
  });

  it('已达位数时保持不变', () => {
    expect(repadLabel('AHA_01', 2)).toBe('AHA_01');
    expect(repadLabel('AHA_12', 2)).toBe('AHA_12');
  });

  it('数字位数超过目标时不截断', () => {
    expect(repadLabel('AHA_123', 2)).toBe('AHA_123');
    expect(repadLabel('AHA_10', 1)).toBe('AHA_10');
  });

  it('先去掉多余前导零再补零（可改变位数）', () => {
    expect(repadLabel('AHA_007', 2)).toBe('AHA_07');
    expect(repadLabel('AHA_001', 2)).toBe('AHA_01');
  });

  it('只改结尾连续数字，前缀内的数字不受影响', () => {
    expect(repadLabel('AB12CD34', 3)).toBe('AB12CD034');
    expect(repadLabel('Bus2_5', 2)).toBe('Bus2_05');
  });

  it('没有结尾数字时原样返回', () => {
    expect(repadLabel('AHA_final', 2)).toBe('AHA_final');
    expect(repadLabel('AHA', 2)).toBe('AHA');
  });

  it('纯数字 label 也能补零', () => {
    expect(repadLabel('7', 3)).toBe('007');
    expect(repadLabel('0', 2)).toBe('00');
  });
});
