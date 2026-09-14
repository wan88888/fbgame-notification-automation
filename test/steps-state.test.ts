import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import type { AppConfig } from '../src/config.js';
import { turnOnNotification, waitForNotificationsListReady } from '../src/steps.js';
import { clickByText, openRowMenu } from '../src/playwright-utils.js';

vi.mock('../src/playwright-utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/playwright-utils.js')>()),
  openRowMenu: vi.fn(),
  clickByText: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());

describe('上传完成确认', () => {
  function uploadPage(uploadVisible: () => boolean): Page {
    return {
      getByText: (text: string) => ({
        first: () => ({
          waitFor: vi.fn().mockResolvedValue(undefined),
          isVisible: async () => text !== 'User Notifications' && uploadVisible(),
        }),
      }),
      waitForTimeout: async (ms: number) => vi.advanceTimersByTime(ms),
    } as unknown as Page;
  }

  it('上传区一直可见时，即使列表标题可见也不能报告成功', async () => {
    expect(
      await waitForNotificationsListReady(
        uploadPage(() => true),
        1000,
      ),
    ).toBe(false);
  });

  it('上传区消失且列表标题可见后才成功', async () => {
    expect(
      await waitForNotificationsListReady(
        uploadPage(() => Date.now() < 500),
        1000,
      ),
    ).toBe(true);
  });
});

describe('开启状态回读', () => {
  const cfg = { stepTimeoutMs: 1000, humanize: { enabled: false } } as AppConfig;
  const notif = { label: 'BATCH_A_1', date: '2026-09-15' };

  function menuPage(
    initiallyEnabled: boolean,
    enabledAfterClick: boolean,
    activeLimit = false,
  ): Page {
    let enabled = initiallyEnabled;
    const turnOff = {
      isVisible: async () => enabled,
      waitFor: async () => {
        if (!enabled) throw new Error('Turn Off never became visible');
      },
    };
    vi.mocked(clickByText).mockImplementation(async () => {
      enabled = enabledAfterClick;
    });
    return {
      getByText: (text: string | RegExp) => ({
        first: () => turnOff,
        count: async () => (text instanceof RegExp && activeLimit ? 1 : 0),
      }),
      keyboard: { press: vi.fn().mockResolvedValue(undefined) },
      waitForTimeout: async (ms: number) => vi.advanceTimersByTime(ms),
    } as unknown as Page;
  }

  it('点击没有报错，但菜单仍未显示 Turn Off 时失败', async () => {
    await expect(turnOnNotification(menuPage(false, false), notif, cfg)).rejects.toThrow(
      'TURN_ON_UNVERIFIED',
    );
  });

  it('重开同一 Label 菜单确认 Turn Off 后成功', async () => {
    const page = menuPage(false, true);
    await expect(turnOnNotification(page, notif, cfg)).resolves.toBeUndefined();
    expect(openRowMenu).toHaveBeenCalledTimes(2);
    expect(openRowMenu).toHaveBeenNthCalledWith(2, page, notif.label, 1000, cfg.humanize);
  });

  it('已开启的通知在续跑时直接确认，不重复点击 Turn On', async () => {
    await expect(turnOnNotification(menuPage(true, true), notif, cfg)).resolves.toBeUndefined();
    expect(clickByText).not.toHaveBeenCalled();
  });

  it('保留 active 上限错误，供上层区分补救', async () => {
    await expect(turnOnNotification(menuPage(false, false, true), notif, cfg)).rejects.toThrow(
      'ACTIVE_LIMIT',
    );
  });
});
