import { parse } from 'csv-parse/sync';
import type {
  CopyVariant,
  MetricRow,
  Performance,
  SopBatch,
  WeeklyReport,
} from '../../shared/sop.js';

const DEFAULT_WINDOW_HOURS = 168;
const MIN_HISTORY_WEEKS = 2;
const MIN_RELATIVE_DIFFERENCE = 0.2;
const aliases: Record<string, string> = {
  label: 'label',
  标签: 'label',
  文案标签: 'label',
  sent: 'sent',
  发送量: 'sent',
  opened: 'opened',
  打开量: 'opened',
  clicked: 'clicked',
  点击量: 'clicked',
  recalled: 'recalled',
  回流人数: 'recalled',
  召回人数: 'recalled',
  recall_eligible: 'recall_eligible',
  召回基数: 'recall_eligible',
  可召回人数: 'recall_eligible',
  window_hours: 'window_hours',
  观察窗口小时: 'window_hours',
  统计窗口小时: 'window_hours',
};

function count(value: string | undefined, field: string, required = false): number | null {
  if (value === undefined || value.trim() === '') {
    if (required) throw new Error(`${field} 必填`);
    return null;
  }
  const normalized = value.trim();
  const number = Number(normalized);
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} 必须是非负安全整数`);
  }
  return number;
}

function validateRows(rows: MetricRow[], variants: CopyVariant[]): void {
  const selected = variants.filter((variant) => variant.selected);
  const labels = new Set(selected.map((variant) => variant.label));
  if (labels.size !== selected.length) throw new Error('已选文案存在重复标签');
  const seen = new Set<string>();
  for (const row of rows) {
    if (!labels.has(row.label)) throw new Error(`未知或未选择的文案标签：${row.label}`);
    if (seen.has(row.label)) throw new Error(`重复的文案标签：${row.label}`);
    seen.add(row.label);
    for (const field of ['sent', 'opened', 'clicked', 'recalled', 'recallEligible'] as const) {
      const value = row[field];
      if (field !== 'sent' && value === null) continue;
      if (!Number.isSafeInteger(value) || value === null || value < 0) {
        throw new Error(`${row.label}: ${field} 必须是非负安全整数`);
      }
    }
    if (!Number.isFinite(row.windowHours) || row.windowHours <= 0) {
      throw new Error(`${row.label}: window_hours 必须为正数`);
    }
    if (row.opened !== null && row.opened > row.sent) {
      throw new Error(`${row.label}: opened 不能大于 sent`);
    }
    if (row.clicked !== null && row.clicked > row.sent) {
      throw new Error(`${row.label}: clicked 不能大于 sent`);
    }
    if (row.recalled !== null && row.recallEligible !== null && row.recalled > row.recallEligible) {
      throw new Error(`${row.label}: recalled 不能大于 recall_eligible`);
    }
  }
}

/** Missing or empty window_hours explicitly defaults to a seven-day observation window. */
export function parseMetricsCsv(csv: string, variants: CopyVariant[]): MetricRow[] {
  const records = parse(csv, {
    bom: true,
    skip_empty_lines: true,
    trim: true,
    columns: (headers: string[]) => {
      const normalized = headers.map(
        (header) => aliases[header.trim().toLowerCase()] ?? header.trim(),
      );
      if (new Set(normalized).size !== normalized.length) throw new Error('CSV 存在重复列名');
      for (const field of ['label', 'sent']) {
        if (!normalized.includes(field)) throw new Error(`CSV 缺少 ${field} 列`);
      }
      return normalized;
    },
  }) as Record<string, string>[];
  if (!records.length) throw new Error('CSV 至少需要一行数据');
  const rows = records.map((record, index): MetricRow => {
    const label = record.label?.trim();
    if (!label) throw new Error(`CSV 第 ${index + 2} 行 label 必填`);
    const window = record.window_hours?.trim();
    const windowHours = window ? Number(window) : DEFAULT_WINDOW_HOURS;
    if (
      window &&
      (!/^\d+(?:\.\d+)?$/.test(window) || !Number.isFinite(windowHours) || windowHours <= 0)
    ) {
      throw new Error(`${label}: window_hours 必须为正数`);
    }
    return {
      label,
      sent: count(record.sent, `${label}: sent`, true)!,
      opened: count(record.opened, `${label}: opened`),
      clicked: count(record.clicked, `${label}: clicked`),
      recalled: count(record.recalled, `${label}: recalled`),
      recallEligible: count(record.recall_eligible, `${label}: recall_eligible`),
      windowHours,
    };
  });
  validateRows(rows, variants);
  return rows;
}

function sum(values: number[]): number {
  const total = values.reduce((result, value) => result + value, 0);
  if (!Number.isSafeInteger(total)) throw new Error('指标合计超过安全整数范围');
  return total;
}

function completeSum(values: (number | null)[]): number | null {
  return !values.length || values.some((value) => value === null) ? null : sum(values as number[]);
}

function rate(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator === 0
    ? null
    : numerator / denominator;
}

type RateKey = 'recallRate' | 'ctr' | 'openRate';
const rateKeys: RateKey[] = ['recallRate', 'ctr', 'openRate'];
const rateNames: Record<RateKey, string> = { recallRate: '召回率', ctr: 'CTR', openRate: '打开率' };
const themeNames = { recall: '召回', reward: '奖励', challenge: '挑战' };

function performance(row: MetricRow, variant: CopyVariant): Performance {
  return {
    ...row,
    title: variant.title,
    theme: variant.theme,
    openRate: rate(row.opened, row.sent),
    ctr: rate(row.clicked, row.sent),
    recallRate: rate(row.recalled, row.recallEligible),
    decision: 'test',
    reason: '证据不足，继续测试并补充可比数据。',
  };
}

function denominator(row: Performance, key: RateKey): number | null {
  return key === 'recallRate' ? row.recallEligible : row.sent;
}

function numerator(row: Performance, key: RateKey): number | null {
  return key === 'recallRate' ? row.recalled : key === 'ctr' ? row.clicked : row.opened;
}

function sufficient(row: Performance, key: RateKey, minSample: number): boolean {
  return row.sent >= minSample && (denominator(row, key) ?? 0) >= minSample && row[key] !== null;
}

function weighted(rows: Performance[], key: RateKey): number | null {
  return rate(
    completeSum(rows.map((row) => numerator(row, key))),
    completeSum(rows.map((row) => denominator(row, key))),
  );
}

type HistoricRow = { week: string; row: Performance };

function weekStart(date: string): number {
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return NaN;
  const day = new Date(parsed);
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.getTime();
}

function historicalRows(batch: SopBatch, history: SopBatch[]): HistoricRow[] {
  const seen = new Set<string>([batch.id]);
  const result: HistoricRow[] = [];
  const currentWeek = weekStart(batch.weekOf);
  for (const item of history) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (
      item.projectKey !== batch.projectKey ||
      !Number.isFinite(weekStart(item.weekOf)) ||
      !(weekStart(item.weekOf) < currentWeek) ||
      item.settings.language !== batch.settings.language ||
      item.settings.audience !== batch.settings.audience ||
      item.settings.timezone !== batch.settings.timezone ||
      item.settings.timingMode !== batch.settings.timingMode ||
      (batch.settings.timingMode === 'fixed' && item.settings.sendTime !== batch.settings.sendTime)
    )
      continue;
    validateRows(item.metrics, item.variants);
    for (const metric of item.metrics) {
      const variant = item.variants.find((entry) => entry.label === metric.label && entry.selected);
      if (variant)
        result.push({
          week: new Date(weekStart(item.weekOf)).toISOString().slice(0, 10),
          row: performance(metric, variant),
        });
    }
  }
  return result;
}

function pct(value: number | null): string {
  return value === null ? '未提供/不可计算' : `${(value * 100).toFixed(2)}%`;
}

function difference(value: number, baseline: number): 'high' | 'low' | 'similar' {
  if (baseline === 0) return 'similar';
  if (value > baseline && value / baseline >= 1 + MIN_RELATIVE_DIFFERENCE) return 'high';
  if (value < baseline && value / baseline <= 1 - MIN_RELATIVE_DIFFERENCE) return 'low';
  return 'similar';
}

function setDecision(row: Performance, history: HistoricRow[], minSample: number): void {
  if (row.sent < minSample) {
    row.reason = `发送样本 ${row.sent} 未达到门槛 ${minSample}，继续测试。`;
    return;
  }
  const eligible = history.filter((item) => item.row.windowHours === row.windowHours);
  for (const key of rateKeys) {
    if (!sufficient(row, key, minSample)) continue;
    const comparable = eligible.filter((item) => sufficient(item.row, key, minSample));
    const baselineCandidates = comparable.filter((item) => item.row.theme !== row.theme);
    const themeCandidates = comparable.filter((item) => item.row.theme === row.theme);
    const recentWeeks = (items: HistoricRow[]) =>
      [...new Set(items.map((item) => item.week))].sort().reverse().slice(0, MIN_HISTORY_WEEKS);
    const baselineWeeks = recentWeeks(baselineCandidates);
    const themeWeeks = recentWeeks(themeCandidates);
    if (baselineWeeks.length < MIN_HISTORY_WEEKS || themeWeeks.length < MIN_HISTORY_WEEKS) continue;
    const baseline = baselineCandidates.filter((item) => baselineWeeks.includes(item.week));
    const theme = themeCandidates.filter((item) => themeWeeks.includes(item.week));
    const baselineRate = weighted(
      baseline.map((item) => item.row),
      key,
    )!;
    const direction = difference(row[key]!, baselineRate);
    const consistent =
      direction !== 'similar' &&
      themeWeeks.every((week) => {
        const observed = weighted(
          theme.filter((item) => item.week === week).map((item) => item.row),
          key,
        )!;
        return difference(observed, baselineRate) === direction;
      });
    const evidence = `${row.windowHours} 小时窗口；同主题 ${themeWeeks.length} 个往周（最近可比周期：${themeWeeks.join('、')}）、其他主题 ${baselineWeeks.length} 个往周（${baselineWeeks.join('、')}）；其他主题加权${rateNames[key]} ${pct(baselineRate)}，本条 ${pct(row[key])}`;
    if (consistent) {
      row.decision = direction === 'high' ? 'retain' : 'retire';
      row.reason = `${evidence}。本条及同主题往周均${direction === 'high' ? '高于' : '低于'}基线至少 20%，建议${direction === 'high' ? '保留主题并继续测试文案' : '暂停该主题旧文案并生成替代测试'}。跨周观察不代表文案造成差异。`;
    } else if (baselineRate === 0) {
      row.reason = `${evidence}。基线为 0，无法计算相对 20% 差异，继续测试。`;
    } else {
      row.reason = `${evidence}。未形成至少 20% 的一致差异，继续测试；跨周结果不构成因果证据。`;
    }
    return;
  }
  row.reason = `缺少可比较历史：须有同主题及其他主题各至少 ${MIN_HISTORY_WEEKS} 个往周、相同项目/语言/受众/时区/发送模式/${row.windowHours} 小时窗口，且指标分母和发送量均 ≥ ${minSample}。继续测试。`;
}

function rankings(rows: Performance[], minSample: number): string[] {
  const output: string[] = [];
  for (const window of new Set(rows.map((row) => row.windowHours))) {
    const group = rows.filter((row) => row.windowHours === window);
    const key = rateKeys.find(
      (metric) => group.filter((row) => sufficient(row, metric, minSample)).length >= 2,
    );
    if (!key) continue;
    const candidates = group.filter((row) => sufficient(row, key, minSample));
    const best = Math.max(...candidates.map((row) => row[key]!));
    const worst = Math.min(...candidates.map((row) => row[key]!));
    if (best === worst) {
      output.push(`${window} 小时窗口：${rateNames[key]}相同，不指定 Top 或低表现文案。`);
    } else {
      output.push(
        `${window} 小时窗口，按${rateNames[key]}比较：Top ${candidates
          .filter((row) => row[key] === best)
          .map((row) => row.label)
          .join('、')}（${pct(best)}）；低表现 ${candidates
          .filter((row) => row[key] === worst)
          .map((row) => row.label)
          .join('、')}（${pct(worst)}）。仅为观察排名，不单凭本周排名淘汰。`,
      );
    }
  }
  return output.length
    ? output
    : [
        '本周同窗口、同指标且样本足够的候选不足 2 条，不指定 Top 或低表现文案；单条可参考跨周证据。',
      ];
}

function cell(value: string | number | null): string {
  return value === null
    ? '未提供'
    : String(value)
        .replace(/\|/g, '\\|')
        .replace(/[\r\n]+/g, ' ');
}

export function buildReport(batch: SopBatch, history: SopBatch[] = []): WeeklyReport {
  validateRows(batch.metrics, batch.variants);
  const minSample = batch.settings.minSample;
  if (!Number.isSafeInteger(minSample) || minSample <= 0)
    throw new Error('minSample 必须为正安全整数');
  const rows = batch.metrics;
  const totals = {
    sent: sum(rows.map((row) => row.sent)),
    opened: completeSum(rows.map((row) => row.opened)),
    clicked: completeSum(rows.map((row) => row.clicked)),
    recalled: completeSum(rows.map((row) => row.recalled)),
    recallEligible: completeSum(rows.map((row) => row.recallEligible)),
    openRate: null as number | null,
    ctr: null as number | null,
    recallRate: null as number | null,
  };
  totals.openRate = rate(totals.opened, totals.sent);
  totals.ctr = rate(totals.clicked, totals.sent);
  totals.recallRate = rate(totals.recalled, totals.recallEligible);
  const observed = rows.map((row) =>
    performance(
      row,
      batch.variants.find((variant) => variant.label === row.label && variant.selected)!,
    ),
  );
  const historic = historicalRows(batch, history);
  observed.forEach((row) => setDecision(row, historic, minSample));
  const recommendations = rankings(observed, minSample);
  if (!rows.length)
    recommendations.push('尚无结果数据，请先导入实际投放指标；不会据此生成表现结论。');
  const missingLabels = batch.variants
    .filter((variant) => variant.selected && !rows.some((row) => row.label === variant.label))
    .map((variant) => variant.label);
  if (missingLabels.length)
    recommendations.push(`尚未导入 ${missingLabels.join('、')} 的指标，当前合计仅覆盖已导入文案。`);
  if (rows.some((row) => row.recalled === null || row.recallEligible === null))
    recommendations.push(
      '召回数据或召回基数不完整，无法计算整体召回率；打开率、CTR 不能替代召回率。',
    );
  if (new Set(rows.map((row) => row.windowHours)).size > 1)
    recommendations.push(
      '本批次包含不同观察窗口，总量为原始记录合计；各窗口成熟度不同，请勿直接横向比较总率。',
    );
  for (const row of observed) recommendations.push(`${row.label}：${row.reason}`);
  recommendations.push(
    '下一周保留有历史支持的主题，对低表现候选暂停旧文案并生成新测试；证据不足者继续收集数据。所有建议均需结合投放人群、奖励和发送时点复核，不代表因果或统计显著性。',
  );
  const generatedAt = new Date().toISOString();
  const markdown = [
    `# ${cell(batch.name)} · 运营周报`,
    '',
    `项目：${cell(batch.projectName)}（${cell(batch.projectKey)}） · 周期：${cell(batch.weekOf)} · 生成时间：${generatedAt}`,
    '',
    '## 总量与指标',
    '',
    '| 发送量 | 打开量 | 点击量 | 回流人数 | 可召回人数 | 打开率 | CTR | 召回率 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${[totals.sent, totals.opened, totals.clicked, totals.recalled, totals.recallEligible].map(cell).join(' | ')} | ${[totals.openRate, totals.ctr, totals.recallRate].map(pct).join(' | ')} |`,
    '',
    '## 数据口径',
    '',
    `- 打开率 = 打开量 / 发送量；CTR = 点击量 / 发送量；召回率 = 回流人数 / 可召回人数。整体率按分子合计 / 分母合计计算，不平均各行百分比。`,
    '- 任一已导入记录缺失该指标时，对应整体指标为未提供/不可计算；空值不等于 0，分母为 0 时不计算。合计只覆盖已导入文案。',
    `- CSV 未填写 window_hours 时默认 ${DEFAULT_WINDOW_HOURS} 小时；填写即声明这些计数来自该观察窗口，导入时应核对数据窗口。`,
    `- 最小样本：发送量及该指标分母均至少 ${minSample}。跨周比较仅纳入更早周期、同项目/语言/受众/时区/发送模式及相同观察窗口的数据。`,
    `- 保留/暂停建议要求同主题及其他主题各至少 ${MIN_HISTORY_WEEKS} 个往周，分别取最近 ${MIN_HISTORY_WEEKS} 个可比周期；本条和同主题每个往周相对其他主题加权基线均有至少 20% 同方向差异。20% 为策略规则，不是显著性检验，基线为 0 时继续测试。`,
    '',
    '## 文案表现',
    '',
    '| 标签 / 标题 | 主题 | 窗口(小时) | 发送 | 打开率 | CTR | 召回率 | 建议 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...observed.map(
      (row) =>
        `| ${cell(row.label)} / ${cell(row.title)} | ${themeNames[row.theme]} | ${row.windowHours} | ${row.sent} | ${pct(row.openRate)} | ${pct(row.ctr)} | ${pct(row.recallRate)} | ${{ retain: '保留主题', retire: '暂停旧文案', test: '继续测试' }[row.decision]} |`,
    ),
    ...(observed.length ? [] : ['暂无结果数据。']),
    '',
    '## 历史证据与下周建议',
    '',
    ...recommendations.map((recommendation) => `- ${cell(recommendation)}`),
    '',
  ].join('\n');
  return { generatedAt, totals, performance: observed, recommendations, markdown };
}
