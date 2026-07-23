import { describe, it, expect } from 'vitest';
import {
  buildNotificationsUrl,
  deriveProjectKey,
  DEFAULT_CONTENT_NAME_PREFIX,
  DEFAULT_NOTIFICATIONS_URL_TEMPLATE,
} from '../src/campaigns.js';

describe('buildNotificationsUrl', () => {
  it('用 appId 替换默认模板里的 {appId}', () => {
    const url = buildNotificationsUrl(DEFAULT_NOTIFICATIONS_URL_TEMPLATE, '696007096453320');
    expect(url).toBe(
      'https://developers.facebook.com/apps/696007096453320/use_cases/customize/user_notifications/' +
        '?use_case_enum=INSTANT_GAMES_NOTIFICATION_SERVICE&business_id=644048981685643' +
        '&selected_tab=user_notifications&product_route=instant-games',
    );
  });

  it('替换所有 {appId} 占位符', () => {
    expect(buildNotificationsUrl('a/{appId}/b/{appId}', '123')).toBe('a/123/b/123');
  });

  it('模板缺少 {appId} 占位符时抛错', () => {
    expect(() => buildNotificationsUrl('https://x/apps/no-placeholder', '123')).toThrow();
  });
});

describe('deriveProjectKey', () => {
  const P = DEFAULT_CONTENT_NAME_PREFIX;

  it('剥掉「推送配置表 - 」前缀（带空格连字符）', () => {
    expect(deriveProjectKey('推送配置表 - AHA', P)).toBe('AHA');
    expect(deriveProjectKey('推送配置表 - Bubble Candy', P)).toBe('Bubble Candy');
    expect(deriveProjectKey('推送配置表 - New Ford City', P)).toBe('New Ford City');
  });

  it('兼容无空格 / 全角冒号 / 破折号分隔符', () => {
    expect(deriveProjectKey('推送配置表-AHA', P)).toBe('AHA');
    expect(deriveProjectKey('推送配置表：AHA', P)).toBe('AHA');
    expect(deriveProjectKey('推送配置表—AHA', P)).toBe('AHA');
  });

  it('不带前缀的老命名原样返回', () => {
    expect(deriveProjectKey('AHA', P)).toBe('AHA');
    expect(deriveProjectKey('Plot Play', P)).toBe('Plot Play');
  });

  it('前缀为空则不剥离', () => {
    expect(deriveProjectKey('推送配置表 - AHA', '')).toBe('推送配置表 - AHA');
  });
});
