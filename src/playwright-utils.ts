import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectors } from './selectors.js';
import { log } from './logger.js';

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
  return page;
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
  // 优先：语义化 row
  const asRow = page.getByRole('row').filter({ hasText: label });
  return asRow;
}

/**
 * 点击某条推送行末尾的「...」菜单按钮，多策略兜底。
 * 返回是否成功点开。
 */
export async function openRowMenu(page: Page, label: string, timeoutMs: number): Promise<void> {
  const labelNode = page.getByText(label, { exact: true }).first();
  await labelNode.waitFor({ state: 'visible', timeout: timeoutMs });

  // 策略 1：语义 row 内找 button（取最后一个，通常是行尾的 "..."）。
  const row = findRow(page, label);
  if (await row.count()) {
    const btn = row.getByRole('button').last();
    if (await btn.count()) {
      await btn.click({ timeout: timeoutMs });
      return;
    }
  }

  // 策略 2：从 label 文本向上找含 button 的最近祖先，点其中最后一个 button。
  const ancestorBtn = labelNode
    .locator('xpath=ancestor::*[.//button or .//*[@role="button"]][1]')
    .getByRole('button')
    .last();
  if (await ancestorBtn.count()) {
    await ancestorBtn.click({ timeout: timeoutMs });
    return;
  }

  // 策略 3：按 aria-label 猜测的三个点按钮（全局），再靠近 label 选取。
  for (const aria of selectors.rowMenu.ariaLabels) {
    const byAria = page.getByRole('button', { name: aria });
    if (await byAria.count()) {
      await byAria.first().click({ timeout: timeoutMs });
      return;
    }
  }

  throw new Error(
    `未能定位到「${label}」行的「...」菜单按钮。请对照真实页面调整 src/selectors.ts 的 rowMenu，` +
      `或 src/playwright-utils.ts 的 openRowMenu 策略。`,
  );
}

/** 点击一个可见文本（按钮 / 菜单项 / 链接），带兜底。 */
export async function clickByText(page: Page, text: string, timeoutMs: number): Promise<void> {
  // 优先按 role=button/menuitem/link，最后退回纯文本。
  const candidates: Locator[] = [
    page.getByRole('menuitem', { name: text, exact: true }),
    page.getByRole('button', { name: text, exact: true }),
    page.getByRole('link', { name: text, exact: true }),
    page.getByText(text, { exact: true }),
  ];
  for (const loc of candidates) {
    if (await loc.count()) {
      await loc.first().click({ timeout: timeoutMs });
      return;
    }
  }
  throw new Error(`未找到可点击的元素文本: "${text}"`);
}
