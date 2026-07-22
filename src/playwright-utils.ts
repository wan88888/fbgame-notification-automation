import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectors } from './selectors.js';
import { log } from './logger.js';
import type { HumanizeConfig } from './config.js';
import { humanClick } from './humanize.js';

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

/** 取得（或新建）一个可用的 page。优先复用已有标签页。 */
export async function getPage(browser: Browser): Promise<Page> {
  const context = browser.contexts()[0];
  if (!context) throw new Error('浏览器没有可用的 context');
  const existing = context.pages();
  const page = existing.length > 0 ? existing[0] : await context.newPage();
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
 * 将日期规整为后台日期框接受的 "M/D/YYYY"（无前导零，匹配截图里的 7/20/2026）。
 * 支持输入 "YYYY-MM-DD" 或 "M/D/YYYY" / "MM/DD/YYYY"。
 */
export function toUsDate(input: string): string {
  const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${Number(m)}/${Number(d)}/${y}`;
  }
  const us = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const [, m, d, y] = us;
    return `${Number(m)}/${Number(d)}/${y}`;
  }
  throw new Error(`无法识别的日期格式: "${input}"（请用 YYYY-MM-DD 或 M/D/YYYY）`);
}

/** 出错时保存整页截图，便于排查选择器问题。 */
export async function screenshotOnError(page: Page, dir: string, name: string): Promise<void> {
  try {
    mkdirSync(resolve(process.cwd(), dir), { recursive: true });
    const safe = name.replace(/[^\w.-]+/g, '_');
    const path = resolve(process.cwd(), dir, `${Date.now()}_${safe}.png`);
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

/**
 * 把目标 label 所在行滚动进视野。
 * 列表是可滚动容器 / 虚拟列表时，上传的新行往往在下方、初始不可见甚至未渲染，
 * 这里先直接尝试 scrollIntoView；找不到就在列表区域滚轮下滑并重试，触发渲染。
 */
export async function scrollRowIntoView(
  page: Page,
  label: string,
  timeoutMs: number,
): Promise<Locator> {
  const node = page.getByText(label, { exact: true }).first();

  // 快速路径：已在 DOM 里，直接滚进视野。
  if (await node.count()) {
    await node.scrollIntoViewIfNeeded({ timeout: timeoutMs }).catch(() => undefined);
    if (await node.count()) return node;
  }

  // 把鼠标移到列表区域中心，便于滚轮作用到正确的滚动容器。
  const anchor =
    (await page.getByText(selectors.notificationsPageHeadingText, { exact: false }).count())
      ? page.getByText(selectors.notificationsPageHeadingText, { exact: false }).first()
      : node;
  const box = await anchor.boundingBox().catch(() => null);
  const cx = box ? box.x + box.width / 2 : 600;
  const cy = box ? box.y + Math.min(box.height + 200, 400) : 400;
  await page.mouse.move(cx, cy).catch(() => undefined);

  const maxScrolls = 30;
  for (let i = 0; i < maxScrolls; i++) {
    await page.mouse.wheel(0, 700);
    await page.waitForTimeout(250);
    if (await node.count()) {
      await node.scrollIntoViewIfNeeded({ timeout: timeoutMs }).catch(() => undefined);
      if (await node.count()) return node;
    }
  }

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
    await row.first().scrollIntoViewIfNeeded({ timeout: timeoutMs }).catch(() => undefined);
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
