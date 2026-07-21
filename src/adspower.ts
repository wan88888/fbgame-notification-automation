import type { AdsPowerStartResponse } from './types.js';
import { log } from './logger.js';

export interface AdsPowerOptions {
  apiBase: string;
  apiKey: string;
  userId: string;
}

function buildHeaders(apiKey: string): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

async function getJson<T>(url: string, headers: HeadersInit): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`AdsPower API HTTP ${res.status}: ${url}`);
  }
  return (await res.json()) as T;
}

/**
 * 通过 AdsPower 本地 API 启动指定 profile 的浏览器，返回可供
 * Playwright chromium.connectOverCDP 使用的 ws 端点 (data.ws.puppeteer)。
 *
 * AdsPower 官方说明：每次启动返回的 ws 端点可能不同，务必动态读取而非硬编码。
 */
export async function startBrowser(opts: AdsPowerOptions): Promise<string> {
  const url = `${opts.apiBase}/api/v1/browser/start?user_id=${encodeURIComponent(opts.userId)}&open_tabs=1`;
  log.step(`启动 AdsPower 浏览器 (user_id=${opts.userId}) ...`);

  const body = await getJson<AdsPowerStartResponse>(url, buildHeaders(opts.apiKey));
  if (body.code !== 0) {
    throw new Error(`AdsPower 启动失败: code=${body.code}, msg=${body.msg}`);
  }
  const ws = body.data?.ws?.puppeteer;
  if (!ws) {
    throw new Error(`AdsPower 返回中未包含 CDP 端点 (data.ws.puppeteer): ${JSON.stringify(body)}`);
  }
  log.ok(`已获取 CDP 端点: ${ws}`);
  return ws;
}

/** 关闭指定 profile 的浏览器。 */
export async function stopBrowser(opts: AdsPowerOptions): Promise<void> {
  const url = `${opts.apiBase}/api/v1/browser/stop?user_id=${encodeURIComponent(opts.userId)}`;
  try {
    await getJson<AdsPowerStartResponse>(url, buildHeaders(opts.apiKey));
    log.ok(`已请求关闭 AdsPower 浏览器 (user_id=${opts.userId})`);
  } catch (e) {
    log.warn(`关闭 AdsPower 浏览器失败: ${(e as Error).message}`);
  }
}

/** 查询 profile 浏览器是否处于活动状态。 */
export async function isActive(opts: AdsPowerOptions): Promise<boolean> {
  const url = `${opts.apiBase}/api/v1/browser/active?user_id=${encodeURIComponent(opts.userId)}`;
  try {
    const body = await getJson<{ code: number; data?: { status?: string } }>(
      url,
      buildHeaders(opts.apiKey),
    );
    return body.code === 0 && body.data?.status === 'Active';
  } catch {
    return false;
  }
}
