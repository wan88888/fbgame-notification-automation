import { describe, expect, it } from 'vitest';
import { buildReport, parseMetricsCsv } from '../apps/api/src/sop-analytics.js';
import type { CopyVariant, MetricRow, SopBatch, Theme } from '../apps/shared/sop.js';

const variant = (label: string, theme: Theme = 'recall', selected = true): CopyVariant => ({
  id: label,
  label,
  theme,
  title: `Title ${label}`,
  body: 'Body',
  selected,
  origin: 'template',
});
const metric = (label = 'A', overrides: Partial<MetricRow> = {}): MetricRow => ({
  label,
  sent: 1000,
  opened: 300,
  clicked: 100,
  recalled: 100,
  recallEligible: 1000,
  windowHours: 168,
  ...overrides,
});
const batch = (overrides: Partial<SopBatch> = {}): SopBatch => ({
  id: 'current',
  name: 'Weekly',
  projectKey: 'game',
  projectName: 'Game',
  weekOf: '2026-09-07',
  scheduledAt: '2026-09-08T04:00:00.000Z',
  status: 'reported',
  createdAt: '',
  updatedAt: '',
  audit: [],
  variants: [variant('A')],
  metrics: [metric()],
  settings: {
    projectKey: 'game',
    timezone: 'Asia/Shanghai',
    sendTime: '12:00',
    timingMode: 'fixed',
    language: 'en',
    audience: 'inactive',
    brief: '',
    themes: ['recall', 'reward', 'challenge'],
    variants: 3,
    minSample: 100,
    autoCollect: false,
    autoNextDraft: false,
  },
  ...overrides,
});
function history(recallRates = [0.3, 0.35], otherRates = [0.1, 0.15]): SopBatch[] {
  return [...recallRates, ...otherRates].map((value, i) => {
    const label = `old-${i}`;
    return batch({
      id: label,
      weekOf: ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'][i],
      variants: [variant(label, i < recallRates.length ? 'recall' : 'reward')],
      metrics: [metric(label, { recalled: Math.round(value * 1000) })],
    });
  });
}

describe('parseMetricsCsv', () => {
  it('keeps missing values distinct from zero and documents a seven-day default', () => {
    const rows = parseMetricsCsv(
      'label,sent,opened,clicked,recalled,recall_eligible\nA,100,0,,,0',
      [variant('A')],
    );
    expect(rows).toEqual([
      metric('A', { sent: 100, opened: 0, clicked: null, recalled: null, recallEligible: 0 }),
    ]);
    expect(buildReport(batch({ metrics: rows })).markdown).toContain('默认 168 小时');
  });

  it('accepts BOM, quoted labels, Chinese aliases, and explicit decimal windows', () => {
    expect(
      parseMetricsCsv(
        '\uFEFF文案标签,发送量,打开量,点击量,回流人数,可召回人数,观察窗口小时\n"A,1",20,10,2,1,5,24.5',
        [variant('A,1')],
      )[0],
    ).toEqual(
      metric('A,1', {
        sent: 20,
        opened: 10,
        clicked: 2,
        recalled: 1,
        recallEligible: 5,
        windowHours: 24.5,
      }),
    );
  });

  it.each(['', '-1', '0.5', '1e3', 'Infinity', '9007199254740992', 'abc'])(
    'rejects invalid sent: %s',
    (sent) => {
      expect(() => parseMetricsCsv(`label,sent\nA,${sent}`, [variant('A')])).toThrow();
    },
  );

  it.each(['-1', '0', 'Infinity', '1e3', 'abc'])('rejects invalid windows: %s', (window) => {
    expect(() => parseMetricsCsv(`label,sent,window_hours\nA,1,${window}`, [variant('A')])).toThrow(
      'window_hours',
    );
  });

  it.each([
    'label,sent,opened\nA,10,11',
    'label,sent,clicked\nA,10,11',
    'label,sent,recalled,recall_eligible\nA,10,6,5',
    'label,sent,clicked\nA,10,-1',
    'label,sent\nA,1\nA,2',
    'label,sent\nA,1\nunknown,2',
    'label,sent\nA,1\nB,2',
    'label,sent\n,1',
    'label,clicked\nA,1',
    'label,sent,发送量\nA,1,1',
    'label,sent\nA,1,2',
    'label,sent',
    '',
  ])('rejects the complete CSV for invalid rows or headers', (csv) => {
    expect(() => parseMetricsCsv(csv, [variant('A'), variant('B', 'reward', false)])).toThrow();
  });

  it('accepts unknown recall denominator without fabricating zero or a rate', () => {
    const rows = parseMetricsCsv('label,sent,recalled\nA,10,2', [variant('A')]);
    expect(rows[0].recallEligible).toBeNull();
    expect(buildReport(batch({ metrics: rows })).performance[0].recallRate).toBeNull();
  });
});

describe('buildReport', () => {
  it('uses sum-weighted rates rather than an average of rates', () => {
    const report = buildReport(
      batch({
        variants: [variant('A'), variant('B')],
        metrics: [
          metric('A', { sent: 100, opened: 90, clicked: 50, recalled: 20, recallEligible: 100 }),
          metric('B', { sent: 900, opened: 90, clicked: 90, recalled: 40, recallEligible: 400 }),
        ],
      }),
    );
    expect(report.totals).toEqual({
      sent: 1000,
      opened: 180,
      clicked: 140,
      recalled: 60,
      recallEligible: 500,
      openRate: 0.18,
      ctr: 0.14,
      recallRate: 0.12,
    });
  });

  it('propagates any missing metric and preserves true zero rates', () => {
    const report = buildReport(
      batch({
        variants: [variant('A'), variant('B')],
        metrics: [
          metric('A', { opened: null, clicked: 0, recalled: null }),
          metric('B', { opened: 0, clicked: 0, recalled: 0 }),
        ],
      }),
    );
    expect(report.totals.opened).toBeNull();
    expect(report.totals.openRate).toBeNull();
    expect(report.totals.ctr).toBe(0);
    expect(report.totals.recallRate).toBeNull();
    expect(report.totals.recallEligible).toBe(2000);
  });

  it('never computes a rate with a zero denominator and handles empty data', () => {
    const zero = buildReport(
      batch({
        metrics: [metric('A', { sent: 0, opened: 0, clicked: 0, recalled: 0, recallEligible: 0 })],
      }),
    );
    expect(zero.totals).toMatchObject({
      sent: 0,
      opened: 0,
      openRate: null,
      ctr: null,
      recallRate: null,
    });
    const empty = buildReport(batch({ metrics: [] }));
    expect(empty.totals).toMatchObject({ sent: 0, opened: null, ctr: null });
    expect(empty.performance).toEqual([]);
    expect(empty.markdown).toContain('尚无结果数据');
  });

  it('flags partial batch coverage and mixed windows', () => {
    const report = buildReport(
      batch({
        variants: [variant('A'), variant('B'), variant('C')],
        metrics: [metric('A'), metric('B', { windowHours: 24 })],
      }),
    );
    expect(report.markdown).toContain('尚未导入 C');
    expect(report.markdown).toContain('不同观察窗口');
    expect(report.recommendations[0]).toContain('不足 2 条');
  });

  it('does not rank or retire a single candidate based only on itself', () => {
    const report = buildReport(batch({ metrics: [metric('A', { recalled: 0 })] }));
    expect(report.performance[0].decision).toBe('test');
    expect(report.recommendations[0]).toContain('不足 2 条');
    expect(report.markdown).not.toContain('Top A');
  });

  it('ranks comparable same-week candidates without turning ranking into a retirement decision', () => {
    const report = buildReport(
      batch({
        variants: [variant('A'), variant('B')],
        metrics: [metric('A'), metric('B', { recalled: 200 })],
      }),
    );
    expect(report.recommendations[0]).toContain('Top B');
    expect(report.recommendations[0]).toContain('低表现 A');
    expect(report.performance.every((row) => row.decision === 'test')).toBe(true);
  });

  it('does not fabricate rankings for tied candidates', () => {
    const report = buildReport(
      batch({ variants: [variant('A'), variant('B')], metrics: [metric('A'), metric('B')] }),
    );
    expect(report.recommendations[0]).toContain('相同，不指定');
  });

  it('can retain a single current copy using repeated comparable theme history', () => {
    const report = buildReport(batch({ metrics: [metric('A', { recalled: 400 })] }), history());
    expect(report.performance[0].decision).toBe('retain');
    expect(report.performance[0].reason).toContain('同主题 2 个往周');
    expect(report.performance[0].reason).toContain('12.50%');
    expect(report.performance[0].reason).toContain('不代表文案造成差异');
    expect(report.recommendations[0]).toContain('不足 2 条');
  });

  it('suggests retiring an old copy only with consistent low historical theme performance', () => {
    const report = buildReport(
      batch({ metrics: [metric('A', { recalled: 20 })] }),
      history([0.04, 0.05], [0.2, 0.25]),
    );
    expect(report.performance[0].decision).toBe('retire');
    expect(report.performance[0].reason).toContain('暂停该主题旧文案并生成替代测试');
  });

  it('keeps inconsistent historical evidence in testing', () => {
    const report = buildReport(
      batch({ metrics: [metric('A', { recalled: 400 })] }),
      history([0.04, 0.35], [0.1, 0.15]),
    );
    expect(report.performance[0].decision).toBe('test');
    expect(report.performance[0].reason).toContain('未形成');
  });

  it('uses the two most recent comparable theme weeks rather than obsolete outliers', () => {
    const old = history();
    const obsolete = {
      ...old[0],
      id: 'obsolete',
      weekOf: '2026-07-27',
      metrics: [metric(old[0].metrics[0].label, { recalled: 0 })],
    };
    const report = buildReport(batch({ metrics: [metric('A', { recalled: 400 })] }), [
      ...old,
      obsolete,
    ]);
    expect(report.performance[0].decision).toBe('retain');
    expect(report.performance[0].reason).not.toContain('2026-07-27');
  });

  it('does not claim a relative improvement over a zero baseline', () => {
    const report = buildReport(
      batch({ metrics: [metric('A', { recalled: 400 })] }),
      history([0.3, 0.35], [0, 0]),
    );
    expect(report.performance[0].decision).toBe('test');
    expect(report.performance[0].reason).toContain('基线为 0');
  });

  it('uses CTR only as an explicitly labelled fallback when recall data is missing', () => {
    const old = history().map((item, i) => ({
      ...item,
      metrics: [
        metric(item.metrics[0].label, {
          recalled: null,
          recallEligible: null,
          clicked: i < 2 ? 300 : 100,
        }),
      ],
    }));
    const report = buildReport(
      batch({ metrics: [metric('A', { recalled: null, recallEligible: null, clicked: 400 })] }),
      old,
    );
    expect(report.performance[0].decision).toBe('retain');
    expect(report.performance[0].reason).toContain('CTR');
    expect(report.markdown).toContain('CTR 不能替代召回率');
  });

  it('does not use insufficient current samples or insufficient recall denominators', () => {
    const small = buildReport(
      batch({
        metrics: [
          metric('A', { sent: 50, opened: 30, clicked: 10, recalled: 40, recallEligible: 100 }),
        ],
      }),
      history(),
    );
    expect(small.performance[0].decision).toBe('test');
    expect(small.performance[0].reason).toContain('未达到门槛');
    const smallDenominator = buildReport(
      batch({
        metrics: [metric('A', { recalled: 40, recallEligible: 50, opened: null, clicked: null })],
      }),
      history(),
    );
    expect(smallDenominator.performance[0].decision).toBe('test');
  });

  it.each([
    'project',
    'language',
    'audience',
    'timezone',
    'timingMode',
    'window',
    'sample',
    'sameWeek',
    'futureWeek',
  ])('rejects noncomparable historical evidence: %s', (kind) => {
    const old = history().map((item) => {
      if (kind === 'project') return { ...item, projectKey: 'other' };
      if (kind === 'language') return { ...item, settings: { ...item.settings, language: 'zh' } };
      if (kind === 'audience') return { ...item, settings: { ...item.settings, audience: 'new' } };
      if (kind === 'timezone')
        return { ...item, settings: { ...item.settings, timezone: 'UTC' as const } };
      if (kind === 'timingMode')
        return { ...item, settings: { ...item.settings, timingMode: 'predicted' as const } };
      if (kind === 'window')
        return { ...item, metrics: item.metrics.map((row) => ({ ...row, windowHours: 24 })) };
      if (kind === 'sample')
        return {
          ...item,
          metrics: item.metrics.map((row) => ({ ...row, sent: 50, opened: 0, clicked: 0 })),
        };
      return { ...item, weekOf: kind === 'sameWeek' ? '2026-09-07' : '2026-09-14' };
    });
    const report = buildReport(batch({ metrics: [metric('A', { recalled: 400 })] }), old);
    expect(report.performance[0].decision).toBe('test');
  });

  it('does not count duplicate batches or multiple batches in one week as independent weeks', () => {
    const old = history();
    expect(buildReport(batch(), [old[0], old[0], old[2], old[2]]).performance[0].decision).toBe(
      'test',
    );
    expect(
      buildReport(
        batch(),
        old.map((item) => ({ ...item, weekOf: '2026-08-03' })),
      ).performance[0].decision,
    ).toBe('test');
    expect(
      buildReport(
        batch(),
        old.map((item, i) => ({ ...item, weekOf: `2026-08-0${i + 3}` })),
      ).performance[0].decision,
    ).toBe('test');
  });

  it('rejects unsafe aggregated totals and invalid programmatic metrics', () => {
    expect(() =>
      buildReport(
        batch({
          variants: [variant('A'), variant('B')],
          metrics: [metric('A', { sent: Number.MAX_SAFE_INTEGER }), metric('B')],
        }),
      ),
    ).toThrow('安全整数');
    expect(() => buildReport(batch({ metrics: [metric('unknown')] }))).toThrow('未知');
  });
});
