import { describe, it, expect } from 'vitest';
import { buildFeishuCard, type RunSummary } from '../src/notify.js';
import type { GameResult } from '../src/types.js';

function summary(results: GameResult[], over: Partial<RunSummary> = {}): RunSummary {
  return {
    results,
    hasFailure: results.some((r) => r.gameError || r.failedLabels.length > 0),
    logFile: '/tmp/run.log',
    startedAt: new Date('2026-07-24T10:00:00Z'),
    finishedAt: new Date('2026-07-24T10:07:59Z'),
    dryRun: false,
    ...over,
  };
}

/** 递归收集卡片里所有字符串叶子并拼接，便于断言（不经过 JSON 转义翻倍）。 */
function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) for (const x of node) collectText(x, out);
  else if (node && typeof node === 'object')
    for (const v of Object.values(node)) collectText(v, out);
  return out;
}

const flatten = (card: ReturnType<typeof buildFeishuCard>): string =>
  collectText(card.elements).join('\n');

describe('buildFeishuCard', () => {
  it('全部成功：绿色标题，无失败明细区', () => {
    const card = buildFeishuCard(
      summary([{ projectName: 'AHA', total: 7, succeeded: 7, failedLabels: [] }]),
    );
    expect(card.header.template).toBe('green');
    expect(card.header.title.content).toContain('全部完成');
    expect(flatten(card)).not.toContain('失败明细');
  });

  it('有失败：红色标题 + 出现失败明细区', () => {
    const card = buildFeishuCard(
      summary([
        {
          projectName: 'AHA',
          total: 7,
          succeeded: 3,
          failedLabels: [{ label: 'AHA_04', error: 'ACTIVE_LIMIT: 已达上限' }],
        },
      ]),
    );
    expect(card.header.template).toBe('red');
    expect(flatten(card)).toContain('失败明细');
  });

  it('active 上限归到「已达 active 上限」组并给出补跑建议', () => {
    const card = buildFeishuCard(
      summary([
        {
          projectName: 'AHA',
          total: 7,
          succeeded: 3,
          failedLabels: [
            { label: 'AHA_04', error: 'ACTIVE_LIMIT: 已达上限' },
            { label: 'AHA_05', error: 'You cannot have more than 10 active notification settings' },
          ],
        },
      ]),
    );
    const s = flatten(card);
    expect(s).toContain('已达 active 上限');
    expect(s).toContain('--resume');
    // label 中的下划线会被转义为 \_（避免 lark_md 误渲染成斜体）。
    expect(s).toContain('AHA\\_04');
    expect(s).toContain('AHA\\_05');
  });

  it('Save 服务端错误归到「Meta 保存报错」组', () => {
    const card = buildFeishuCard(
      summary([
        {
          projectName: 'OHO',
          total: 7,
          succeeded: 6,
          failedLabels: [{ label: 'OHO_05', error: 'SAVE_SERVER_ERROR: Something went wrong' }],
        },
      ]),
    );
    expect(flatten(card)).toContain('Meta 保存报错');
  });

  it('整体失败归到「整个游戏失败」组', () => {
    const card = buildFeishuCard(
      summary([{ projectName: 'X', total: 5, succeeded: 0, failedLabels: [], gameError: '导航失败' }]),
    );
    const s = flatten(card);
    expect(s).toContain('整个游戏失败');
  });

  it('dry-run：灰色标题 + 演练提示', () => {
    const card = buildFeishuCard(
      summary([{ projectName: 'AHA', total: 1, succeeded: 1, failedLabels: [] }], {
        dryRun: true,
        hasFailure: false,
      }),
    );
    expect(card.header.template).toBe('grey');
    expect(card.header.title.content).toContain('演练');
    expect(flatten(card)).toContain('DRY-RUN');
  });
});
