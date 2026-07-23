import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Locator, Page } from 'playwright';
import { DEFAULT_SEND_TIME_STRATEGY } from './config.js';
import type { AppConfig } from './config.js';
import type { NotificationSchedule, ResolvedGameJob } from './types.js';
import { selectors as S } from './selectors.js';
import { log } from './logger.js';
import { clickByText, openRowMenu, toUsDate } from './playwright-utils.js';
import { dateInputMatches } from './date-utils.js';
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
  // 提交日期：让输入框失焦提交。
  // 切勿按 Escape——Meta 日期选择器会把它当作「取消」，撤销刚输入的日期、还原成默认值，
  // 结果 Save 保存的是默认日期（这正是「看到输入了却不生效」的根因）。
  await dateInput.blur().catch(() => undefined);
  await think(cfg.humanize);

  // 回读校验：确认日期真的写进去了，否则重试一次；仍不一致就报错，
  // 避免静默保存成错误/默认日期。
  let shownDate = (await dateInput.inputValue().catch(() => '')).trim();
  if (!dateInputMatches(shownDate, usDate)) {
    log.warn(
      `[${notif.label}] 日期框回显为 "${shownDate}"，与目标 ${usDate} 不一致，重试直填一次。`,
    );
    await dateInput.fill(usDate).catch(() => undefined);
    await dateInput.blur().catch(() => undefined);
    shownDate = (await dateInput.inputValue().catch(() => '')).trim();
    if (!dateInputMatches(shownDate, usDate)) {
      throw new Error(
        `日期未正确写入：期望 ${usDate}，日期框实际为 "${shownDate}"。` +
          `可能该日期框是需点日历选择的特殊组件，请对照页面调整 src/steps.ts 的日期填写逻辑。`,
      );
    }
  }
  log.ok(`[${notif.label}] 日期框已确认: ${shownDate}`);

  // ---- 设置 Send Time Strategy ----
  const strategy = notif.sendTimeStrategy?.trim() || DEFAULT_SEND_TIME_STRATEGY;
  if (strategy === DEFAULT_SEND_TIME_STRATEGY && !cfg.alwaysSetStrategy) {
    // 后台默认即为 Predicted Best Time，无需再点一次下拉（少一次易碎交互）。
    log.info(`[${notif.label}] 发送策略为默认值（${strategy}），跳过选择步骤。`);
  } else {
    log.step(`[${notif.label}] 选择发送策略: ${strategy}`);
    await selectSendTimeStrategy(page, strategy, t, cfg);
    await think(cfg.humanize);
  }

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

/**
 * 步骤 5（腾位）：删除当前列表里所有 Status=Completed 的通知。
 * Completed（已发送）通知仍占用 Meta「每 app 最多 10 条 active」的名额，
 * 撞到上限时删掉它们即可腾出空位。返回实际删除的条数。
 * dry-run 下只统计、不真删。
 */
export async function deleteCompletedNotifications(page: Page, cfg: AppConfig): Promise<number> {
  const t = cfg.stepTimeoutMs;
  const hz = cfg.humanize;

  const completedRows = (): Locator =>
    page
      .getByRole('row')
      .filter({ has: page.getByText(S.statusValues.completed, { exact: true }) });

  const total = await completedRows().count();
  if (total === 0) {
    log.info('列表中没有 Status=Completed 的通知，跳过删除。');
    return 0;
  }

  if (cfg.dryRun) {
    log.warn(`dry-run：检测到 ${total} 条 Completed 通知，但不执行删除。`);
    return 0;
  }

  log.step(`检测到 ${total} 条 Completed 通知，开始删除以腾出 active 名额 ...`);
  let deleted = 0;
  const cap = total + 5; // 安全上限，避免异常情况下的死循环。
  for (let i = 0; i < cap; i++) {
    const row = completedRows().first();
    if (!(await row.count())) break;
    await row.scrollIntoViewIfNeeded({ timeout: t }).catch(() => undefined);

    // 行末尾的「...」菜单。
    const menuBtn = row.getByRole('button').last();
    await humanClick(page, menuBtn, hz, t);
    await think(hz);

    // 菜单里的 Delete。
    await clickByText(page, S.menuItems.delete, t, hz);
    await think(hz);

    // 二次确认弹窗 -> Delete。
    await confirmDeletion(page, cfg);

    // 等列表刷新（被删的行消失）。
    await page.waitForTimeout(1000);
    deleted += 1;
    log.ok(`已删除 Completed 通知 ${deleted}/${total}`);
  }

  log.ok(`共删除 ${deleted} 条 Completed 通知。`);
  return deleted;
}

/** 处理「Deletion Confirmation」弹窗，点击确认删除。 */
async function confirmDeletion(page: Page, cfg: AppConfig): Promise<void> {
  const t = cfg.stepTimeoutMs;
  const title = page.getByText(S.deleteConfirm.titleText, { exact: false }).first();
  await title.waitFor({ state: 'visible', timeout: t }).catch(() => undefined);

  // 优先在弹窗容器（role=dialog）内点确认按钮，避免误点右上角禁用的 Delete。
  const dialog = page.getByRole('dialog');
  const scope = (await dialog.count()) ? dialog.first() : undefined;
  const confirmBtn = scope
    ? scope.getByRole('button', { name: S.deleteConfirm.confirmButtonText, exact: true })
    : // 无 role=dialog 时兜底：取最后一个同名按钮（弹窗按钮通常晚于页面顶部按钮渲染）。
      page.getByRole('button', { name: S.deleteConfirm.confirmButtonText, exact: true }).last();

  await humanClick(page, confirmBtn.first(), cfg.humanize, t);

  // 等弹窗关闭。
  await title.waitFor({ state: 'hidden', timeout: t }).catch(() => undefined);
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
