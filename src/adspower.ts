import type { AdsPowerStartResponse } from './types.js';
import { log } from './logger.js';

export interface AdsPowerOptions {
  apiBase: string;
  apiKey: string;
  userId: string;
  /** 单次 API 请求超时（毫秒）。防止 AdsPower 客户端未开启/挂起时永久阻塞。 */
  timeoutMs: number;
}

function buildHeaders(apiKey: string): HeadersInit {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

/**
 * 带超时的 GET JSON。用 AbortController 保证 AdsPower 本地 API 无响应时不会永久卡住，
 * 并把网络失败/超时转成更友好的中文报错。
 */
async function getJson<T>(url: string, headers: HeadersInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) {
      throw new Error(`AdsPower API HTTP ${res.status}: ${url}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') {
      throw new Error(
        `AdsPower API 请求超时（${timeoutMs}ms）：${url}。请确认 AdsPower 客户端已开启且本地 API 可用。`,
        { cause: e },
      );
    }
    // 保留我们自己抛出的 HTTP 状态错误。
    if (err.message.startsWith('AdsPower API HTTP')) throw err;
    // 其余多为连接被拒/DNS 等网络错误。
    throw new Error(
      `无法连接 AdsPower 本地 API：${url}（${err.message}）。请确认 AdsPower 客户端已开启。`,
      { cause: e },
    );
  } finally {
    clearTimeout(timer);
  }
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

  const body = await getJson<AdsPowerStartResponse>(url, buildHeaders(opts.apiKey), opts.timeoutMs);
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
    await getJson<AdsPowerStartResponse>(url, buildHeaders(opts.apiKey), opts.timeoutMs);
    log.ok(`已请求关闭 AdsPower 浏览器 (user_id=${opts.userId})`);
  } catch (e) {
    log.warn(`关闭 AdsPower 浏览器失败: ${(e as Error).message}`);
  }
}

/** 查询 profile 浏览器是否处于活动状态。网络异常时返回 false（不抛错）。 */
export async function isActive(opts: AdsPowerOptions): Promise<boolean> {
  const url = `${opts.apiBase}/api/v1/browser/active?user_id=${encodeURIComponent(opts.userId)}`;
  try {
    const body = await getJson<{ code: number; data?: { status?: string } }>(
      url,
      buildHeaders(opts.apiKey),
      opts.timeoutMs,
    );
    return body.code === 0 && body.data?.status === 'Active';
  } catch {
    return false;
  }
}
