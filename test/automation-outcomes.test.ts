import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from 'playwright';
import type { AppConfig } from '../src/config.js';
import type { ResolvedGameJob } from '../src/types.js';
import { processGame, runAutomation } from '../src/main.js';
import { loadRunState } from '../src/run-state.js';
import {
  deleteCompletedNotifications,
  editNotification,
  turnOnNotification,
  uploadCsv,
} from '../src/steps.js';
import { connectBrowser, getPage } from '../src/playwright-utils.js';

vi.mock('../src/steps.js', () => ({
  navigateToNotifications: vi.fn(),
  uploadCsv: vi.fn(),
  editNotification: vi.fn(),
  turnOnNotification: vi.fn(),
  deleteCompletedNotifications: vi.fn().mockResolvedValue(0),
  deleteNotificationsByLabels: vi.fn(),
  writeSubsetCsv: vi.fn().mockReturnValue('/tmp/mock-subset.csv'),
  isSaveServerError: (message: string) => message.includes('SAVE_SERVER_ERROR'),
  waitForNotificationsListReady: vi.fn().mockResolvedValue(true),
}));
vi.mock('../src/adspower.js', () => ({
  isActive: vi.fn().mockResolvedValue(false),
  startBrowser: vi.fn().mockResolvedValue('mock-cdp'),
  stopBrowser: vi.fn(),
}));
vi.mock('../src/playwright-utils.js', () => ({
  connectBrowser: vi.fn(),
  getPage: vi.fn(),
  screenshotOnError: vi.fn(),
  isRowMissingError: () => false,
}));

let dir: string;
let cfg: AppConfig;
const page = {
  keyboard: { press: vi.fn().mockResolvedValue(undefined) },
  setDefaultTimeout: vi.fn(),
} as unknown as Page;
const game: ResolvedGameJob = {
  projectName: 'Test Game',
  csv: '/tmp/mock-content.csv',
  notifications: [
    { label: 'A_1', date: '2026-09-15' },
    { label: 'A_2', date: '2026-09-22' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(editNotification).mockReset();
  vi.mocked(turnOnNotification).mockReset();
  dir = mkdtempSync(join(tmpdir(), 'automation-outcomes-'));
  cfg = {
    autoTurnOn: true,
    noUpload: false,
    dryRun: false,
    humanize: { enabled: false },
    runStatePath: join(dir, 'state.json'),
    maxItemsPerRun: 0,
    stepTimeoutMs: 1000,
    metaAdminUrl: 'https://example.test',
  } as AppConfig;
  vi.mocked(getPage).mockResolvedValue(page);
  vi.mocked(connectBrowser).mockResolvedValue({
    close: vi.fn().mockResolvedValue(undefined),
  } as never);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function resumeContext() {
  return {
    state: loadRunState(cfg.runStatePath, 'test-batch'),
    path: cfg.runStatePath,
    skipUpload: false,
  };
}

describe('自动化完成结果', () => {
  it('SOP 模式遇到 active 上限不删除其他批次通知', async () => {
    cfg.sopSafeMode = true;
    cfg.deleteCompletedBeforeUpload = true;
    vi.mocked(turnOnNotification).mockRejectedValue(new Error('ACTIVE_LIMIT: no slots'));
    const { result } = await processGame(page, game, cfg, Infinity, resumeContext());
    expect(deleteCompletedNotifications).not.toHaveBeenCalled();
    expect(result.failedLabels).toHaveLength(2);
  });
  it('预算截断不能把整个游戏记为完成，未处理条目进入失败明细', async () => {
    const resume = resumeContext();
    const { result } = await processGame(page, game, cfg, 1, resume);
    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failedLabels).toEqual([
      { label: 'A_2', error: expect.stringContaining('RUN_LIMIT') },
    ]);
    expect(resume.state.games[game.projectName].completed).toBe(false);
  });

  it('预算用尽而未执行的后续游戏仍出现在失败结果中', async () => {
    cfg.maxItemsPerRun = 1;
    const results = await runAutomation(cfg, [
      { ...game, notifications: game.notifications.slice(0, 1) },
      { ...game, projectName: 'Next Game' },
    ]);
    expect(results).toHaveLength(2);
    expect(results[1].succeeded).toBe(0);
    expect(results[1].failedLabels).toHaveLength(2);
    expect(uploadCsv).toHaveBeenCalledTimes(1);
  });

  it.each([{ dryRun: true }, { autoTurnOn: false }])(
    '演练或仅保存不能污染正式完成状态 %j',
    async (override) => {
      Object.assign(cfg, override);
      const resume = resumeContext();
      await processGame(page, game, cfg, Infinity, resume);
      expect(resume.state.games[game.projectName].completed).toBe(false);
    },
  );

  it('完整执行保存与开启后才记 completed', async () => {
    const resume = resumeContext();
    const { result } = await processGame(page, game, cfg, Infinity, resume);
    expect(result.failedLabels).toEqual([]);
    expect(resume.state.games[game.projectName].completed).toBe(true);
  });

  it('补救保存成功但因 active 上限跳过开启，仍必须报告该条失败', async () => {
    vi.mocked(editNotification)
      .mockRejectedValueOnce(new Error('SAVE_SERVER_ERROR: broken import'))
      .mockResolvedValue(undefined);
    vi.mocked(turnOnNotification).mockRejectedValue(new Error('ACTIVE_LIMIT: no slots'));
    const { result } = await processGame(page, game, cfg, Infinity, resumeContext());
    expect(result.succeeded).toBe(0);
    expect(result.failedLabels.map((item) => item.label).sort()).toEqual(['A_1', 'A_2']);
    expect(result.failedLabels.find((item) => item.label === 'A_1')?.error).toContain('未 Turn On');
  });
});
