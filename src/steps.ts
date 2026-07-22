import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Locator, Page } from 'playwright';
import type { AppConfig } from './config.js';
import type { NotificationSchedule, ResolvedGameJob } from './types.js';
import { selectors as S } from './selectors.js';
import { log } from './logger.js';
import { clickByText, openRowMenu, toUsDate } from './playwright-utils.js';
import { humanClick, humanType, think } from './humanize.js';

/**
 * 步骤 1：抵达某游戏的 User Notifications 列表页。按优先级三种方式：
 *   1. cfg.useOpenPage：不导航，直接用当前已打开的标签页（你已手动开好页面）。
 *   2. job.url：直达该游戏 Send notifications 页的固定 URL。
 *   3. 默认：进后台首页 -> 切项目 -> Use Cases -> Send players notifications。
 *
 * 前两种方式绕开了最脆弱的导航选择器，更快也更稳。
 */
export async function navigateToNotifications(
  page: Page,
  job: Pick<ResolvedGameJob, 'projectName' | 'url'>,
  cfg: AppConfig,
): Promise<void> {
  const t = cfg.stepTimeoutMs;

  if (cfg.useOpenPage) {
    log.step('--use-open-page：跳过导航，使用当前已打开的标签页');
  } else if (job.url) {
    log.step(`直达 Send notifications 页: ${job.url}`);
    await page.goto(job.url, { waitUntil: 'domcontentloaded', timeout: t });
  } else {
    await navigateViaMenu(page, job.projectName, cfg);
  }

  // ---- 确认已在列表页（能看到列表标题或 Create from CSV 按钮）----
  await ensureOnNotificationsPage(page, t);
  log.ok('已到达 User Notifications 列表页');
}

/** 默认导航：后台首页 -> 切项目 -> Use Cases -> Send players notifications。 */
async function navigateViaMenu(page: Page, projectName: string, cfg: AppConfig): Promise<void> {
  const t = cfg.stepTimeoutMs;

  log.step(`打开 Meta 后台: ${cfg.metaAdminUrl}`);
  await page.goto(cfg.metaAdminUrl, { waitUntil: 'domcontentloaded', timeout: t });

  if (projectName) {
    log.step(`选择游戏项目: ${projectName}`);
    const projectLink = page.getByText(projectName, { exact: false }).first();
    if (await projectLink.count()) {
      await projectLink.click({ timeout: t }).catch(() => undefined);
    } else {
      for (const aria of S.projectSwitcher.triggerAriaLabels) {
        const trigger = page.getByRole('button', { name: aria });
        if (await trigger.count()) {
          await trigger
            .first()
            .click({ timeout: t })
            .catch(() => undefined);
          break;
        }
      }
      await page.getByText(projectName, { exact: false }).first().click({ timeout: t });
    }
    await page.waitForLoadState('domcontentloaded', { timeout: t });
  } else {
    log.warn('未指定 projectName，跳过项目选择（假定已在目标项目内）。');
  }

  log.step('进入 Use Cases');
  await clickByText(page, S.useCasesText, t, cfg.humanize);
  await think(cfg.humanize);

  log.step('点击 Send players notifications');
  await clickByText(page, S.sendNotificationsText, t, cfg.humanize);
}

/** 确认当前页面确实是 User Notifications 列表页。 */
async function ensureOnNotificationsPage(page: Page, timeoutMs: number): Promise<void> {
  const heading = page.getByText(S.notificationsPageHeadingText, { exact: false }).first();
  try {
    await heading.waitFor({ state: 'visible', timeout: timeoutMs });
    return;
  } catch {
    // 标题找不到时，用上传区相关文案兜底确认。
  }
  for (const text of S.createFromCsvTexts) {
    const loc = page.getByText(text, { exact: false }).first();
    if (await loc.count()) {
      await loc.waitFor({ state: 'visible', timeout: timeoutMs });
      return;
    }
  }
  throw new Error(
    `无法确认已在 User Notifications 页（未找到「${S.notificationsPageHeadingText}」或上传入口文案）。`,
  );
}

/**
 * 步骤 2：从 CSV 批量创建。
 * 优先直接给 input[type=file] 赋值（适配虚线上传区）；
 * 否则再尝试点击入口文案触发系统文件选择框。
 */
export async function uploadCsv(page: Page, csvPath: string, cfg: AppConfig): Promise<void> {
  const t = cfg.stepTimeoutMs;
  const csvAbs = resolve(process.cwd(), csvPath);
  if (!existsSync(csvAbs)) {
    throw new Error(`CSV 文件不存在: ${csvAbs}`);
  }

  log.step(`Create from CSV，上传: ${csvAbs}`);
  await think(cfg.humanize);

  // 若还停在列表页，先点「Create from CSV」进入虚线上传区页面。
  await enterUploadPage(page, t, cfg.humanize);

  // 优先：隐藏的 input[type=file] 直接赋值（最稳，且不触发系统文件框）。
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count()) {
    await fileInput.setInputFiles(csvAbs);
    log.ok('已通过 input[type=file] 提交 CSV 文件');
  } else {
    // 兜底：点击「Or choose file on your device」触发系统文件选择框。
    log.info('未找到 input[type=file]，点击上传区链接触发文件选择框');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: t }),
      clickChooseFile(page, t, cfg.humanize),
    ]);
    await chooser.setFiles(csvAbs);
    log.ok('已通过文件选择框提交 CSV 文件');
  }

  if (cfg.postUploadWaitMs > 0) {
    log.info(`等待批量创建完成 (${cfg.postUploadWaitMs}ms) ...`);
    await page.waitForTimeout(cfg.postUploadWaitMs);
  }
}

/** 若尚未进入虚线上传区页面，则点击「Create from CSV」进入。 */
async function enterUploadPage(
  page: Page,
  timeoutMs: number,
  hz: AppConfig['humanize'],
): Promise<void> {
  // 已能看到「choose file on your device」说明已在上传区页，直接返回。
  for (const text of S.chooseFileTexts) {
    if (await page.getByText(text, { exact: false }).first().count()) {
      return;
    }
  }
  // 否则尝试点击「Create from CSV」按钮进入上传区。
  const createBtn = page.getByText(S.createFromCsvText, { exact: false }).first();
  if (await createBtn.count()) {
    log.step('点击 Create from CSV 进入上传区');
    await humanClick(page, createBtn, hz, timeoutMs);
    await think(hz);
    await page
      .getByText(S.chooseFileTexts[0], { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .catch(() => undefined);
  }
}

/** 点击虚线上传区里的「Or choose file on your device」链接。 */
async function clickChooseFile(
  page: Page,
  timeoutMs: number,
  hz: AppConfig['humanize'],
): Promise<void> {
  for (const text of S.chooseFileTexts) {
    const loc = page.getByText(text, { exact: false }).first();
    if (await loc.count()) {
      await humanClick(page, loc, hz, timeoutMs);
      return;
    }
  }
  // 最后兜底：点整块虚线区域。
  const dropzone = page
    .locator('div')
    .filter({ hasText: /drag and drop your file/i })
    .last();
  if (await dropzone.count()) {
    await humanClick(page, dropzone, hz, timeoutMs);
    return;
  }
  throw new Error(
    `未找到上传区的「choose file on your device」链接。请对照页面调整 src/selectors.ts 的 chooseFileTexts。`,
  );
}

/**
 * 步骤 3：对单条推送执行 View/Edit -> 设置日期 -> 设置发送时间策略 -> Save。
 */
export async function editNotification(
  page: Page,
  notif: NotificationSchedule,
  cfg: AppConfig,
): Promise<void> {
  const t = cfg.stepTimeoutMs;
  const usDate = toUsDate(notif.date);

  log.step(`[${notif.label}] 打开行菜单 -> View/Edit`);
  await openRowMenu(page, notif.label, t, cfg.humanize);
  await think(cfg.humanize);
  await clickByText(page, S.menuItems.viewEdit, t, cfg.humanize);
  await think(cfg.humanize);

  // ---- 设置 Notification Date ----
  log.step(`[${notif.label}] 设置日期: ${usDate}`);
  const dateInput = await resolveDateInput(page);
  await humanType(page, dateInput, usDate, cfg.humanize, t);
  // 关闭可能弹出的日历浮层。
  await page.keyboard.press('Escape').catch(() => undefined);
  await think(cfg.humanize);

  // ---- 设置 Send Time Strategy ----
  const strategy = notif.sendTimeStrategy ?? 'Predicted Best Time';
  log.step(`[${notif.label}] 选择发送策略: ${strategy}`);
  await selectSendTimeStrategy(page, strategy, t, cfg);
  await think(cfg.humanize);

  // ---- 保存 / dry-run 时改为 Cancel ----
  if (cfg.dryRun) {
    log.warn(`[${notif.label}] dry-run：跳过 Save，点击 Cancel 关闭编辑框（不改动数据）`);
    await clickByText(page, S.editor.cancelText, t, cfg.humanize).catch(async () => {
      await page.keyboard.press('Escape').catch(() => undefined);
    });
  } else {
    log.step(`[${notif.label}] 点击 Save`);
    await clickByText(page, S.editor.saveText, t, cfg.humanize);
  }

  // 等待编辑面板关闭 / 回到列表。
  await page
    .getByText(S.notificationsPageHeadingText, { exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: t })
    .catch(() => undefined);
  log.ok(`[${notif.label}] 编辑${cfg.dryRun ? '（dry-run，未保存）' : '已保存'}`);
}

/**
 * 步骤 4：返回列表，选中该条推送 -> Turn On。
 */
export async function turnOnNotification(
  page: Page,
  notif: NotificationSchedule,
  cfg: AppConfig,
): Promise<void> {
  const t = cfg.stepTimeoutMs;
  log.step(`[${notif.label}] 打开行菜单 -> Turn On`);
  await openRowMenu(page, notif.label, t, cfg.humanize);
  await think(cfg.humanize);
  await clickByText(page, S.menuItems.turnOn, t, cfg.humanize);

  // 检查是否触发 Meta「每 app 最多 10 条 active」上限提示。
  await page.waitForTimeout(1500);
  if (await page.getByText(/more than 10 active/i).count()) {
    throw new Error(
      'ACTIVE_LIMIT: 已达 Meta 每个 app 最多 10 条 active 通知设置的上限（You cannot have more than 10 active notification settings per app）。',
    );
  }
  log.ok(`[${notif.label}] 已 Turn On`);
}

/** 定位「Notification Date」标签下方的日期输入框。 */
async function resolveDateInput(page: Page): Promise<Locator> {
  // 优先：标签文本之后的第一个 input。
  const byLabel = page
    .getByText(S.editor.notificationDateLabelText, { exact: false })
    .first()
    .locator('xpath=following::input[1]');
  if (await byLabel.count()) return byLabel.first();

  // 兜底：按 placeholder 匹配。
  for (const ph of S.editor.dateInputPlaceholders) {
    const byPh = page.getByPlaceholder(ph);
    if (await byPh.count()) return byPh.first();
  }

  throw new Error(
    `未能定位 Notification Date 输入框。请对照真实页面调整 src/selectors.ts 的 editor.notificationDateLabelText / dateInputPlaceholders。`,
  );
}

/** 选择「Send Time Strategy」下拉框中的目标选项。 */
async function selectSendTimeStrategy(
  page: Page,
  strategy: string,
  timeoutMs: number,
  cfg: AppConfig,
): Promise<void> {
  const hz = cfg.humanize;

  // 情况 A：原生 <select>。
  const label = page.getByText(S.editor.sendTimeStrategyLabelText, { exact: false }).first();
  const nativeSelect = label.locator('xpath=following::select[1]');
  if (await nativeSelect.count()) {
    await nativeSelect.selectOption({ label: strategy }).catch(async () => {
      await nativeSelect.selectOption(strategy);
    });
    return;
  }

  // 情况 B：自定义下拉（combobox / button）。先点开触发器，再点选项。
  const trigger = label.locator(
    'xpath=following::*[@role="combobox" or @role="button" or contains(@class,"select")][1]',
  );
  if (await trigger.count()) {
    await humanClick(page, trigger.first(), hz, timeoutMs);
  } else {
    // 兜底：点包含当前默认文案的元素。
    await page
      .getByText(strategy, { exact: false })
      .first()
      .click({ timeout: timeoutMs })
      .catch(() => undefined);
  }

  await think(hz);

  // 点选目标选项。
  const option = (await page.getByRole('option', { name: strategy, exact: true }).count())
    ? page.getByRole('option', { name: strategy, exact: true })
    : page.getByText(strategy, { exact: true });
  await humanClick(page, option.first(), hz, timeoutMs);
}
