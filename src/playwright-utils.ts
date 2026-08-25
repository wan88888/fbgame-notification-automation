import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectors } from './selectors.js';
import { log, getRunId } from './logger.js';
import type { HumanizeConfig } from './config.js';
import { humanClick } from './humanize.js';

// toUsDate 现居于纯工具模块 date-utils（无浏览器依赖）；此处再导出以保持既有引用不变。
export { toUsDate } from './date-utils.js';

/** 未启用拟人化时的兜底配置。 */
const NO_HUMANIZE: HumanizeConfig = {
  enabled: false,
  thinkMinMs: 0,
  thinkMaxMs: 0,
  typeMinMs: 0,
  typeMaxMs: 0,
  betweenItemsMinMs: 0,
  betweenItemsMaxMs: 0,
  betweenGamesMinMs: 0,
  betweenGamesMaxMs: 0,
};

/** 接管 AdsPower 已启动的浏览器（CDP）。 */
export async function connectBrowser(wsEndpoint: string, slowMoMs: number): Promise<Browser> {
  const browser = await chromium.connectOverCDP(wsEndpoint, { slowMo: slowMoMs });
  log.ok('已通过 CDP 接管 AdsPower 浏览器');
  return browser;
}

/**
 * 取得（或新建）一个可用的 page。
 * 若传入 preferHost（如 developers.facebook.com），优先复用 URL 命中该域名的标签页，
 * 避免 AdsPower 里存在欢迎页/多标签时误接管到错误的 tab；否则退回第一个标签页。
 */
export async function getPage(browser: Browser, preferHost?: string): Promise<Page> {
  const context = browser.contexts()[0];
  if (!context) throw new Error('浏览器没有可用的 context');
  const existing = context.pages();

  let page: Page | undefined;
  if (preferHost && existing.length > 0) {
    page = existing.find((p) => {
      try {
        return new URL(p.url()).hostname.includes(preferHost);
      } catch {
        return false;
      }
    });
    if (page) log.info(`复用匹配「${preferHost}」的已打开标签页`);
  }
  if (!page) page = existing.length > 0 ? existing[0] : await context.newPage();

  await page.bringToFront();
  await maximizeWindow(context, page);
  return page;
}

/**
 * 通过 CDP 把 AdsPower 浏览器窗口最大化。
 * connectOverCDP 接管的是真实浏览器窗口，setViewportSize 无效，
 * 需用 Browser.setWindowBounds({ windowState: 'maximized' }）。
 */
async function maximizeWindow(context: BrowserContext, page: Page): Promise<void> {
  try {
    const session = await context.newCDPSession(page);
    const { windowId } = (await session.send('Browser.getWindowForTarget')) as {
      windowId: number;
    };
    await session.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    });
    await session.detach().catch(() => undefined);
    log.ok('已最大化浏览器窗口');
  } catch (e) {
    log.warn(`最大化窗口失败（忽略）：${(e as Error).message}`);
  }
}

/**
 * 出错时保存整页截图，便于排查选择器问题。
 * 文件名以本次运行的 runId 打头（与 logs/run-<runId>.log 同前缀），
 * 方便把「某次运行日志」和「该次出错截图」对应起来。
 */
export async function screenshotOnError(page: Page, dir: string, name: string): Promise<void> {
  try {
    mkdirSync(resolve(process.cwd(), dir), { recursive: true });
    const safe = name.replace(/[^\w.-]+/g, '_');
    const runId = getRunId();
    const prefix = runId ? `run-${runId}_` : '';
    const path = resolve(process.cwd(), dir, `${prefix}${Date.now()}_${safe}.png`);
    await page.screenshot({ path, fullPage: true });
    log.warn(`已保存出错截图: ${path}`);
  } catch (e) {
    log.warn(`保存截图失败: ${(e as Error).message}`);
  }
}

/**
 * 定位某条推送所在的「行」。
 * 依次尝试：table row -> listitem -> 包含 label 文本且含按钮的最近祖先。
 */
export function findRow(page: Page, label: string): Locator {
  // 优先：语义化 row（用精确文本过滤，避免把 AHA_1 匹配到 AHA_10 之类）。
  const asRow = page.getByRole('row').filter({
    has: page.getByText(label, { exact: true }),
  });
  return asRow;
}

export function isRowMissingError(message: string): boolean {
  return /仍未找到 label/.test(message) || /未能定位到「.+」行的/.test(message);
}

async function locateLabelText(page: Page, label: string, timeoutMs: number): Promise<Locator | null> {
  const node = page.getByText(label, { exact: true }).first();
  if (!(await node.count())) return null;
  await node.scrollIntoViewIfNeeded({ timeout: timeoutMs }).catch(() => undefined);
  if (await node.count()) return node;
  return null;
}

async function moveMouseToListArea(page: Page): Promise<void> {
  const heading = page.getByText(selectors.notificationsPageHeadingText, { exact: false }).first();
  const box = (await heading.count())
    ? await heading.boundingBox().catch(() => null)
    : null;
  const cx = box ? box.x + box.width / 2 : 600;
  const cy = box ? box.y + Math.min(box.height + 200, 400) : 400;
  await page.mouse.move(cx, cy).catch(() => undefined);
}

/**
 * 把目标 label 所在行滚动进视野。
 * 上传后可能仍停在 CSV 上传区；列表也可能是虚拟列表，行在下方未渲染。
 * 先等列表标题出现，再向上滚回顶部、再向下滚触发渲染。
 */
export async function scrollRowIntoView(
  page: Page,
  label: string,
  timeoutMs: number,
): Promise<Locator> {
  const deadline = Date.now() + Math.max(4000, timeoutMs);
  const heading = page.getByText(selectors.notificationsPageHeadingText, { exact: false }).first();
  await heading.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 15000) }).catch(() => undefined);

  const found = await locateLabelText(page, label, timeoutMs);
  if (found) return found;

  await moveMouseToListArea(page);

  const wheel = async (dy: number, times: number): Promise<Locator | null> => {
    for (let i = 0; i < times; i++) {
      if (Date.now() > deadline) break;
      await page.mouse.wheel(0, dy);
      await page.waitForTimeout(200);
      const hit = await locateLabelText(page, label, timeoutMs);
      if (hit) return hit;
    }
    return null;
  };

  // 先回顶（避免停在上传区时越往下滚越远），再往下找，最后再扫一遍顶部。
  const hit =
    (await wheel(-900, 10)) ?? (await wheel(700, 40)) ?? (await wheel(-900, 12));
  if (hit) return hit;

  throw new Error(
    `滚动列表后仍未找到 label「${label}」所在行。请确认该 label 已成功创建，或检查列表是否需要额外筛选。`,
  );
}

/**
 * 点击某条推送行末尾的「...」菜单按钮，多策略兜底。
 * 会先把目标行滚动进视野，避免误点到顶部其它行。
 */
export async function openRowMenu(
  page: Page,
  label: string,
  timeoutMs: number,
  hz: HumanizeConfig = NO_HUMANIZE,
): Promise<void> {
  const labelNode = await scrollRowIntoView(page, label, timeoutMs);
  await labelNode.waitFor({ state: 'visible', timeout: timeoutMs });

  // 策略 1：语义 row 内找 button（取最后一个，通常是行尾的 "..."）。
  const row = findRow(page, label);
  if (await row.count()) {
    await row
      .first()
      .scrollIntoViewIfNeeded({ timeout: timeoutMs })
      .catch(() => undefined);
    const btn = row.getByRole('button').last();
    if (await btn.count()) {
      await humanClick(page, btn, hz, timeoutMs);
      return;
    }
  }

  // 策略 2：从 label 文本向上找含 button 的最近祖先，点其中最后一个 button。
  const ancestorBtn = labelNode
    .locator('xpath=ancestor::*[.//button or .//*[@role="button"]][1]')
    .getByRole('button')
    .last();
  if (await ancestorBtn.count()) {
    await humanClick(page, ancestorBtn, hz, timeoutMs);
    return;
  }

  // 策略 3：按 aria-label 猜测的三个点按钮，但**限定在 label 就近的祖先容器内**，
  // 不再全局取第一个，避免误点到其它行。
  for (const aria of selectors.rowMenu.ariaLabels) {
    const scoped = labelNode
      .locator('xpath=ancestor::*[.//button or .//*[@role="button"]][1]')
      .getByRole('button', { name: aria });
    if (await scoped.count()) {
      await humanClick(page, scoped.last(), hz, timeoutMs);
      return;
    }
  }

  throw new Error(
    `未能定位到「${label}」行的「...」菜单按钮。请对照真实页面调整 src/selectors.ts 的 rowMenu，` +
      `或 src/playwright-utils.ts 的 openRowMenu 策略。`,
  );
}

/** 点击一个可见文本（按钮 / 菜单项 / 链接），带兜底。 */
export async function clickByText(
  page: Page,
  text: string,
  timeoutMs: number,
  hz: HumanizeConfig = NO_HUMANIZE,
): Promise<void> {
  // 优先按 role=button/menuitem/link，最后退回纯文本。
  const candidates: Locator[] = [
    page.getByRole('menuitem', { name: text, exact: true }),
    page.getByRole('button', { name: text, exact: true }),
    page.getByRole('link', { name: text, exact: true }),
    page.getByText(text, { exact: true }),
  ];
  for (const loc of candidates) {
    if (await loc.count()) {
      await humanClick(page, loc.first(), hz, timeoutMs);
      return;
    }
  }
  throw new Error(`未找到可点击的元素文本: "${text}"`);
}
