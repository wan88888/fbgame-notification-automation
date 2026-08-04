import { describe, it, expect } from 'vitest';
import {
  diagnoseContentCsv,
  findStrayUrlQuotes,
  fixContentCsvText,
} from '../src/content-csv.js';

describe('findStrayUrlQuotes / fixContentCsvText', () => {
  it('检出并修复 image_url 末尾多余引号', () => {
    const bad =
      ']",Bubble_2,https://cdn.example.com/a.jpg",https://www.facebook.com/gaming/play/1\n';
    const issues = findStrayUrlQuotes(bad);
    expect(issues).toHaveLength(1);
    expect(issues[0].fixable).toBe(true);

    const { text, fixed } = fixContentCsvText(bad);
    expect(fixed).toBe(1);
    expect(text).toContain('https://cdn.example.com/a.jpg,https://www.facebook.com');
    expect(text).not.toContain('.jpg",https://');
  });

  it('不误伤 JSON 字段里的双引号转义 URL', () => {
    const jsonish =
      '        ""image_url"": ""https://cdn.example.com/a.jpg"",\n' +
      '        ""url"": ""https://www.facebook.com/x"",\n';
    expect(findStrayUrlQuotes(jsonish)).toHaveLength(0);
    expect(fixContentCsvText(jsonish).fixed).toBe(0);
  });

  it('支持 png/webp 等后缀', () => {
    const bad = 'x,https://cdn.example.com/a.png",https://www.facebook.com/y\n';
    expect(fixContentCsvText(bad).fixed).toBe(1);
  });
});

describe('diagnoseContentCsv', () => {
  const header =
    'Date,bot_message_payload_elements,Json_template,label,image_url,url,notification_title_English\n';

  it('合法两行：ok', () => {
    const raw =
      header +
      '1,"[{""title"":""t""}]","[{""title"":""[TITLE]""}]",A_1,https://cdn.example.com/a.jpg,https://fb.com/x,Hello\n';
    const d = diagnoseContentCsv(raw);
    expect(d.ok).toBe(true);
    expect(d.labels).toEqual(['A_1']);
  });

  it('多余引号导致无法解析：不 ok，且标 fixable', () => {
    // 贴近真实内容表：多行 JSON 字段结束后，image_url 带多余引号
    const raw =
      'Date,bot_message_payload_elements,Json_template,label,image_url,url\n' +
      '1,"[\n' +
      '    {\n' +
      '        ""title"": ""hi"",\n' +
      '        ""image_url"": ""https://cdn.example.com/a.jpg""\n' +
      '    }\n' +
      ']","[{""title"":""[TITLE]""}]",A_1,https://cdn.example.com/a.jpg",https://fb.com/x\n';
    const d = diagnoseContentCsv(raw);
    expect(d.ok).toBe(false);
    expect(d.issues.some((i) => i.fixable)).toBe(true);

    const fixed = fixContentCsvText(raw);
    expect(fixed.fixed).toBeGreaterThanOrEqual(1);
    const again = diagnoseContentCsv(fixed.text);
    expect(again.ok).toBe(true);
    expect(again.labels).toEqual(['A_1']);
  });
});
