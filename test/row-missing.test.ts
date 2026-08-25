import { describe, expect, it } from 'vitest';
import { isRowMissingError } from '../src/playwright-utils.js';

describe('isRowMissingError', () => {
  it('matches the scroll-not-found message', () => {
    expect(isRowMissingError('滚动列表后仍未找到 label「Arrow_1」所在行。请确认该 label 已成功创建。')).toBe(
      true,
    );
  });

  it('matches the row-menu miss message', () => {
    expect(isRowMissingError('未能定位到「Arrow_1」行的「...」菜单按钮。')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isRowMissingError('ACTIVE_LIMIT: 已达上限')).toBe(false);
    expect(isRowMissingError('SAVE_SERVER_ERROR: Something went wrong')).toBe(false);
  });
});
