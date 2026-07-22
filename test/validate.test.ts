import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateContentCsv,
  findSameDayConflicts,
  validateScheduleDates,
} from '../src/validate.js';

describe('findSameDayConflicts', () => {
  it('无冲突时返回空 Map', () => {
    const conflicts = findSameDayConflicts([
      { label: 'a', date: '2026-07-19' },
      { label: 'b', date: '2026-07-20' },
    ]);
    expect(conflicts.size).toBe(0);
  });

  it('同一天多条时返回该日期及其 labels（key 为归一化后的 M/D/YYYY）', () => {
    const conflicts = findSameDayConflicts([
      { label: 'a', date: '2026-07-19' },
      { label: 'b', date: '2026-07-19' },
      { label: 'c', date: '2026-07-20' },
    ]);
    expect(conflicts.size).toBe(1);
    expect(conflicts.get('7/19/2026')).toEqual(['a', 'b']);
  });

  it('忽略空日期的行', () => {
    const conflicts = findSameDayConflicts([
      { label: 'a', date: '' },
      { label: 'b', date: '  ' },
      { label: 'c', date: '2026-07-19' },
    ]);
    expect(conflicts.size).toBe(0);
  });

  it('归一化后 ISO 与 US 写法视为同一天', () => {
    const conflicts = findSameDayConflicts([
      { label: 'a', date: '2026-07-19' },
      { label: 'b', date: '7/19/2026' },
      { label: 'c', date: '07/19/2026' },
    ]);
    expect(conflicts.size).toBe(1);
    const [labels] = [...conflicts.values()];
    expect(labels).toEqual(['a', 'b', 'c']);
  });
});

describe('validateScheduleDates', () => {
  it('全部合法时返回空数组', () => {
    expect(
      validateScheduleDates([
        { label: 'a', date: '2026-07-19' },
        { label: 'b', date: '7/20/2026' },
      ]),
    ).toEqual([]);
  });

  it('非法日期逐条报错', () => {
    const errors = validateScheduleDates([
      { label: 'a', date: '2026-07-19' },
      { label: 'b', date: '2026/13/45' },
      { label: 'c', date: 'July 5' },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('b');
    expect(errors[1]).toContain('c');
  });
});

describe('validateContentCsv', () => {
  let dir: string;
  const write = (name: string, content: string): string => {
    const p = join(dir, name);
    writeFileSync(p, content, 'utf-8');
    return p;
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'validate-test-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('合法内容表：无错误', () => {
    const p = write(
      'ok.csv',
      'label,notification_title_English,notification_body_English\nA_1,Hello,World\nA_2,Hi,There\n',
    );
    const vr = validateContentCsv(p);
    expect(vr.errors).toEqual([]);
    expect(vr.rowCount).toBe(2);
    expect(vr.labels).toEqual(['A_1', 'A_2']);
  });

  it('缺少 label 列时报错', () => {
    const p = write(
      'nolabel.csv',
      'notification_title_English,notification_body_English\nHello,World\n',
    );
    const vr = validateContentCsv(p);
    expect(vr.errors.some((e) => e.includes('label'))).toBe(true);
  });

  it('缺少成对语言列时报错', () => {
    const p = write('nolang.csv', 'label,notification_title_English\nA_1,Hello\n');
    const vr = validateContentCsv(p);
    expect(vr.errors.some((e) => e.includes('成对的语言列'))).toBe(true);
  });

  it('label 重复时报错', () => {
    const p = write(
      'dup.csv',
      'label,notification_title_English,notification_body_English\nA_1,Hello,World\nA_1,Hi,There\n',
    );
    const vr = validateContentCsv(p);
    expect(vr.errors.some((e) => e.includes('label 重复'))).toBe(true);
  });

  it('某行没有任一语言同时填 title+body 时报错', () => {
    const p = write(
      'emptyrow.csv',
      'label,notification_title_English,notification_body_English\nA_1,Hello,\n',
    );
    const vr = validateContentCsv(p);
    expect(vr.errors.some((e) => e.includes('没有任何一种语言'))).toBe(true);
  });

  it('没有数据行时报错', () => {
    const p = write('norows.csv', 'label,notification_title_English,notification_body_English\n');
    const vr = validateContentCsv(p);
    expect(vr.errors.some((e) => e.includes('没有数据行'))).toBe(true);
  });

  it('存在不支持的列时给出 warning', () => {
    const p = write(
      'extra.csv',
      'label,notification_title_English,notification_body_English,Json_template\nA_1,Hello,World,x\n',
    );
    const vr = validateContentCsv(p);
    expect(vr.errors).toEqual([]);
    expect(vr.warnings.some((w) => w.includes('不支持的列'))).toBe(true);
  });

  it('与排期表交叉检查：排期 label 在内容表中缺失时报错', () => {
    const p = write(
      'cross.csv',
      'label,notification_title_English,notification_body_English\nA_1,Hello,World\n',
    );
    const vr = validateContentCsv(p, ['A_1', 'A_2']);
    expect(vr.errors.some((e) => e.includes('A_2'))).toBe(true);
  });

  it('反向交叉检查：内容表有但排期未安排的 label 给出 warning', () => {
    const p = write(
      'cross2.csv',
      'label,notification_title_English,notification_body_English\nA_1,Hello,World\nA_2,Hi,There\n',
    );
    const vr = validateContentCsv(p, ['A_1']);
    expect(vr.errors).toEqual([]);
    expect(vr.warnings.some((w) => w.includes('A_2') && w.includes('未在排期表中'))).toBe(true);
  });

  it('文件不存在时返回错误', () => {
    const vr = validateContentCsv(join(dir, 'does-not-exist.csv'));
    expect(vr.errors.some((e) => e.includes('内容表不存在'))).toBe(true);
  });
});
