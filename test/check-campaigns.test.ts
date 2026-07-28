import { describe, it, expect } from 'vitest';
import { resolveCoverage } from '../src/check-campaigns.js';

describe('resolveCoverage', () => {
  it('缺少条目：无直达 URL', () => {
    expect(resolveCoverage(undefined).hasUrl).toBe(false);
  });

  it('字符串条目（仅显示名）：无直达 URL', () => {
    const c = resolveCoverage('AHA 游戏');
    expect(c.hasUrl).toBe(false);
    expect(c.displayName).toBe('AHA 游戏');
  });

  it('带 appId：有直达 URL', () => {
    const c = resolveCoverage({ name: 'Arrow Jam', appId: '917168621016707' });
    expect(c.hasUrl).toBe(true);
    expect(c.appId).toBe('917168621016707');
    expect(c.displayName).toBe('Arrow Jam');
  });

  it('带整条 url：有直达 URL', () => {
    expect(resolveCoverage({ url: 'https://example.com' }).hasUrl).toBe(true);
  });

  it('对象但既无 appId 也无 url：无直达 URL', () => {
    expect(resolveCoverage({ name: 'X' }).hasUrl).toBe(false);
  });
});
