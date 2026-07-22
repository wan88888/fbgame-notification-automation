import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseScheduleSheet } from '../src/schedule.js';

describe('parseScheduleSheet', () => {
  let dir: string;
  const write = (name: string, content: string): string => {
    const p = join(dir, name);
    writeFileSync(p, content, 'utf-8');
    return p;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'schedule-test-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('解析标准 label,date,send_time_strategy', () => {
    const p = write(
      'basic.schedule.csv',
      'label,date,send_time_strategy\nA_1,2026-07-19,Predicted Best Time\n',
    );
    expect(parseScheduleSheet(p)).toEqual([
      { label: 'A_1', date: '2026-07-19', sendTimeStrategy: 'Predicted Best Time' },
    ]);
  });

  it('未填 strategy 时省略 sendTimeStrategy 字段', () => {
    const p = write('nostrategy.schedule.csv', 'label,date\nA_1,2026-07-19\n');
    expect(parseScheduleSheet(p)).toEqual([{ label: 'A_1', date: '2026-07-19' }]);
  });

  it('跳过未填 date 的行', () => {
    const p = write('partial.schedule.csv', 'label,date\nA_1,2026-07-19\nA_2,\nA_3,2026-07-21\n');
    const result = parseScheduleSheet(p);
    expect(result.map((r) => r.label)).toEqual(['A_1', 'A_3']);
  });

  it('支持中文列名（文案 / 日期 / 推送类别）', () => {
    const p = write('zh.schedule.csv', '文案,日期,推送类别\nA_1,2026-07-19,Predicted Best Time\n');
    expect(parseScheduleSheet(p)).toEqual([
      { label: 'A_1', date: '2026-07-19', sendTimeStrategy: 'Predicted Best Time' },
    ]);
  });

  it('列名大小写 / 下划线不敏感', () => {
    const p = write(
      'alias.schedule.csv',
      'Label,Notification_Date,Send_Time_Strategy\nA_1,2026-07-19,Best\n',
    );
    expect(parseScheduleSheet(p)).toEqual([
      { label: 'A_1', date: '2026-07-19', sendTimeStrategy: 'Best' },
    ]);
  });

  it('有 date 但缺 label 时抛错', () => {
    const p = write('nolabel.schedule.csv', 'label,date\n,2026-07-19\n');
    expect(() => parseScheduleSheet(p)).toThrow(/缺少 label/);
  });

  it('完全空行被忽略', () => {
    const p = write('emptyline.schedule.csv', 'label,date\nA_1,2026-07-19\n,\n');
    expect(parseScheduleSheet(p)).toEqual([{ label: 'A_1', date: '2026-07-19' }]);
  });
});
