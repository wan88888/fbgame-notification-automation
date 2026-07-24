import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeSubsetCsv, isSaveServerError, SAVE_SERVER_ERROR } from '../src/steps.js';

describe('isSaveServerError', () => {
  it('识别带标记的错误信息', () => {
    expect(isSaveServerError(`${SAVE_SERVER_ERROR}: Save 失败 ...`)).toBe(true);
  });
  it('普通错误返回 false', () => {
    expect(isSaveServerError('滚动列表后仍未找到 label')).toBe(false);
    expect(isSaveServerError('')).toBe(false);
  });
});

describe('writeSubsetCsv', () => {
  let dir: string;
  const CSV =
    'label,notification_title_English,note\n' +
    'AHA_01,Hello,"multi\nline"\n' +
    'AHA_02,Hi,plain\n' +
    'AHA_03,Yo,x\n';

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'subset-test-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const writeSrc = (name: string, content: string): string => {
    const p = join(dir, name);
    writeFileSync(p, content, 'utf-8');
    return p;
  };

  it('只保留命中的 label 行（含表头），保留跨行引号字段', () => {
    const src = writeSrc('src.csv', CSV);
    const out = writeSubsetCsv(src, ['AHA_02', 'AHA_03']);
    expect(out).not.toBe('');
    const rows = parse(readFileSync(out, 'utf-8'), { bom: true, relax_column_count: true });
    expect(rows[0]).toEqual(['label', 'notification_title_English', 'note']);
    expect(rows.map((r: string[]) => r[0])).toEqual(['label', 'AHA_02', 'AHA_03']);
  });

  it('保留原文件的跨行 JSON/引号内容不被破坏', () => {
    const src = writeSrc('src2.csv', CSV);
    const out = writeSubsetCsv(src, ['AHA_01']);
    const rows = parse(readFileSync(out, 'utf-8'), { bom: true, relax_column_count: true });
    expect(rows[1]).toEqual(['AHA_01', 'Hello', 'multi\nline']);
  });

  it('保留 BOM', () => {
    const src = writeSrc('bom.csv', '\ufeff' + CSV);
    const out = writeSubsetCsv(src, ['AHA_01']);
    expect(readFileSync(out, 'utf-8').charCodeAt(0)).toBe(0xfeff);
  });

  it('没有命中任何 label 时返回空串', () => {
    const src = writeSrc('none.csv', CSV);
    expect(writeSubsetCsv(src, ['NOPE'])).toBe('');
    expect(writeSubsetCsv(src, [])).toBe('');
  });

  it('内容表无 label 列时返回空串', () => {
    const src = writeSrc('nolabel.csv', 'a,b\n1,2\n');
    expect(writeSubsetCsv(src, ['AHA_01'])).toBe('');
  });
});
