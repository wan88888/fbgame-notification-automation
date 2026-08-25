import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import type { Locator, Page } from 'playwright';
import { DEFAULT_SEND_TIME_STRATEGY } from './config.js';
import type { AppConfig } from './config.js';
import type { NotificationSchedule, ResolvedGameJob } from './types.js';
import { selectors as S } from './selectors.js';
import { log } from './logger.js';
import { clickByText, openRowMenu, toUsDate } from './playwright-utils.js';
import { dateInputMatches } from './date-utils.js';
import { csvEscape } from './csv-utils.js';
import { humanClick, humanType, think } from './humanize.js';

/** Save 因 Meta 服务端错误（Something went wrong）失败时，错误信息带此前缀，便于上层识别后走"删除+重传"补救。 */
export const SAVE_SERVER_ERROR = 'SAVE_SERVER_ERROR';

/** 判断某个错误信息是否为「Save 时 Meta 服务端报错」。 */
export function isSaveServerError(msg: string): boolean {
  return msg.includes(SAVE_SERVER_ERROR);
}

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

  const settleMs = cfg.postUploadWaitMs > 0 ? cfg.postUploadWaitMs : 0;
  if (settleMs > 0) {
    log.info(`等待批量创建完成 (${settleMs}ms) ...`);
    await page.waitForTimeout(settleMs);
  }
  const listWait = Math.max(15000, cfg.stepTimeoutMs);
  log.info(`等待回到 User Notifications 列表（最多 ${listWait}ms）...`);
  const back = await waitForNotificationsListReady(page, listWait);
  if (!back) {
    throw new Error(
      '上传 CSV 后未回到 User Notifications 列表。批量创建可能尚未完成，请稍后重跑或加大 POST_UPLOAD_WAIT_MS。',
    );
  }
  log.ok('已回到 User Notifications 列表');
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
    // 先彻底清空再填，避免在已有回显（如 "Jul 29, 2026"）上叠字变成 "Jul 29, 20267"。
    await dateInput.click({ clickCount: 3 }).catch(() => undefined);
    await page.keyboard.press('Backspace').catch(() => undefined);
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
    // 等待编辑面板关闭 / 回到列表。
    await page
      .getByText(S.notificationsPageHeadingText, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: t })
      .catch(() => undefined);
    log.ok(`[${notif.label}] 编辑（dry-run，未保存）`);
    return;
  }

  await clickSaveAndVerify(page, notif, cfg);
}

/**
 * 点击 Save 并校验是否真的保存成功。
 * Meta 保存失败时会弹红色横幅「Something went wrong」（服务端错误，如
 * noncoercible_variable_value/1675012），此时编辑框不会关闭。
 * 也存在「无横幅但编辑框不关」的静默失败（Match_5 事故）：以前等列表超时后
 * 仍误报「已保存」，导致后续 Turn On / 下几条全部找不到行。
 * 这里：有横幅则重试；无横幅也必须确认已回到列表，否则 Cancel 并抛 SAVE_SERVER_ERROR
 *（上层会走删除+重传补救）。
 */
async function clickSaveAndVerify(
  page: Page,
  notif: NotificationSchedule,
  cfg: AppConfig,
): Promise<void> {
  const t = cfg.stepTimeoutMs;
  /** 回到列表的等待上限：成功通常 1～3s；卡在编辑页时不必空等满 stepTimeout。 */
  const listWaitMs = Math.min(Math.max(t, 5000), 12000);
  const errorBanner = (): Locator => page.getByText(S.editor.saveErrorText, { exact: false });
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    log.step(`[${notif.label}] 点击 Save${attempt > 1 ? `（第 ${attempt} 次尝试）` : ''}`);
    await clickByText(page, S.editor.saveText, t, cfg.humanize);

    // 给服务端返回一点时间，再判断成功 / 失败。
    await page.waitForTimeout(1800);

    if (await errorBanner().count()) {
      log.warn(`[${notif.label}] Save 后出现「${S.editor.saveErrorText}」（Meta 服务端错误）。`);
      if (attempt < maxAttempts) {
        await page.waitForTimeout(2500); // 稍等后重试（这类错误常为临时性）。
        continue;
      }
      await dismissEditor(page, cfg);
      throw new Error(
        `${SAVE_SERVER_ERROR}: Save 失败，Meta 返回「${S.editor.saveErrorText}」` +
          `（noncoercible_variable_value/1675012），重试 ${maxAttempts} 次仍失败。` +
          `多为该条从 CSV 导入后底层数据异常，将尝试「删除+重传该行」补救。`,
      );
    }

    // 无错误横幅：必须真正回到列表，才能算保存成功。
    if (await waitBackToNotificationsList(page, listWaitMs)) {
      log.ok(`[${notif.label}] 编辑已保存`);
      return;
    }

    log.warn(
      `[${notif.label}] Save 后未回到列表页（未见「${S.editor.saveErrorText}」横幅，但编辑框可能仍打开）。`,
    );
    if (attempt < maxAttempts) {
      await page.waitForTimeout(1500);
      continue;
    }
    await dismissEditor(page, cfg);
    throw new Error(
      `${SAVE_SERVER_ERROR}: Save 后未回到 User Notifications 列表` +
        `（重试 ${maxAttempts} 次仍停留在编辑页）。将尝试「删除+重传该行」补救。`,
    );
  }
}

/** 等待回到通知列表：标题可见，且 CSV 上传区文案已消失。 */
export async function waitForNotificationsListReady(
  page: Page,
  timeoutMs: number,
): Promise<boolean> {
  const heading = page.getByText(S.notificationsPageHeadingText, { exact: false }).first();
  try {
    await heading.waitFor({ state: 'visible', timeout: timeoutMs });
  } catch {
    return false;
  }

  const deadline = Date.now() + Math.min(8000, timeoutMs);
  while (Date.now() < deadline) {
    let uploadVisible = false;
    for (const text of S.chooseFileTexts) {
      const loc = page.getByText(text, { exact: false }).first();
      if (await loc.isVisible().catch(() => false)) {
        uploadVisible = true;
        break;
      }
    }
    if (!uploadVisible) return true;
    await page.waitForTimeout(250);
  }
  return true;
}

/** 等待回到通知列表（标题或列表页「Create from CSV」按钮可见）；超时返回 false。 */
async function waitBackToNotificationsList(page: Page, timeoutMs: number): Promise<boolean> {
  const heading = page.getByText(S.notificationsPageHeadingText, { exact: false }).first();
  try {
    await heading.waitFor({ state: 'visible', timeout: timeoutMs });
    return true;
  } catch {
    // 标题找不到时，用列表页按钮文案兜底（不要用上传区标题，那会把仍停在上传页误判为成功）。
  }
  const loc = page.getByText(S.createFromCsvText, { exact: true }).first();
  try {
    if (await loc.count()) {
      await loc.waitFor({ state: 'visible', timeout: Math.min(5000, timeoutMs) });
      return true;
    }
  } catch {
    // 未回到列表。
  }
  return false;
}

/** 关闭编辑框（Cancel，失败则 Escape），尽量回到列表以便后续条目继续。 */
async function dismissEditor(page: Page, cfg: AppConfig): Promise<void> {
  const t = cfg.stepTimeoutMs;
  await clickByText(page, S.editor.cancelText, t, cfg.humanize).catch(async () => {
    await page.keyboard.press('Escape').catch(() => undefined);
  });
  await waitBackToNotificationsList(page, Math.min(5000, t));
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
 * 步骤 5（腾位）：批量删除当前列表里所有 Status=Completed 的通知。
 * Completed（已发送）通知仍占用 Meta「每 app 最多 10 条 active」的名额，
 * 撞到上限时删掉它们即可腾出空位。返回实际删除的条数。
 *
 * 做法：勾选所有 Completed 行的复选框 -> 点右上角「Delete」-> 确认弹窗一次删完，
 * 比逐条开「...」菜单删除快得多、交互也更少。dry-run 下只统计、不真删。
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

  log.step(`检测到 ${total} 条 Completed 通知，勾选后批量删除以腾出 active 名额 ...`);

  try {
    await selectRowsAndDelete(
      page,
      cfg,
      async () => {
        const rows = completedRows();
        const n = await rows.count();
        let checked = 0;
        for (let i = 0; i < n; i++) {
          const row = rows.nth(i);
          await row.scrollIntoViewIfNeeded({ timeout: t }).catch(() => undefined);
          if (await ensureRowChecked(page, row, hz, t)) checked += 1;
          else log.warn(`第 ${i + 1}/${n} 条 Completed 行未能勾选。`);
          await think(hz);
        }
        return checked;
      },
      `Completed ${total} 条`,
    );
  } catch (e) {
    log.warn(`第一次批量删除失败，Escape 后重试一次：${(e as Error).message}`);
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.waitForTimeout(800);
    await selectRowsAndDelete(
      page,
      cfg,
      async () => {
        const rows = completedRows();
        const n = await rows.count();
        let checked = 0;
        for (let i = 0; i < n; i++) {
          const row = rows.nth(i);
          await row.scrollIntoViewIfNeeded({ timeout: t }).catch(() => undefined);
          if (await ensureRowChecked(page, row, hz, t)) checked += 1;
          await think(hz);
        }
        return checked;
      },
      `Completed ${total} 条`,
    );
  }

  const remaining = await countAfterDeletion(page, () => completedRows().count(), total, t);
  const removed = Math.max(total - remaining, 0);
  log.ok(`批量删除完成：删除 ${removed}/${total} 条 Completed 通知（剩余 Completed ${remaining}）。`);
  if (removed === 0) {
    log.warn('Completed 通知一条都没删掉。请检查勾选是否生效、Delete 确认弹窗是否弹出。');
  }
  return removed;
}

/**
 * 统计删除后仍存在的行数。
 * 删除已生效但列表未就地刷新时，行会滞留在 DOM 里导致误报「删除 0 条」，
 * 因此等不到行数下降就刷新页面，以服务端最新状态为准。
 */
async function countAfterDeletion(
  page: Page,
  countRemaining: () => Promise<number>,
  before: number,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + Math.min(8000, timeoutMs);
  let remaining = await countRemaining();
  while (remaining >= before && Date.now() < deadline) {
    await page.waitForTimeout(400);
    remaining = await countRemaining();
  }
  if (remaining < before) return remaining;

  log.info('列表行数未下降，刷新页面后重新统计 ...');
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
  await waitForNotificationsListReady(page, Math.min(20000, Math.max(timeoutMs, 15000)));
  return countRemaining();
}

/**
 * 按 label 批量删除指定的若干条通知（勾选各行复选框 -> 右上角 Delete -> 确认）。
 * 用于 Save 报「Something went wrong」后，把出问题的那些行删掉以便重传重建。
 * 返回实际删除条数（按删除前后行数差估算）。dry-run 下只统计、不真删。
 */
export async function deleteNotificationsByLabels(
  page: Page,
  labels: string[],
  cfg: AppConfig,
): Promise<number> {
  const t = cfg.stepTimeoutMs;
  const hz = cfg.humanize;
  const targets = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  if (targets.length === 0) return 0;

  const rowOf = (label: string): Locator =>
    page.getByRole('row').filter({ has: page.getByText(label, { exact: true }) });

  if (cfg.dryRun) {
    log.warn(`dry-run：将删除 ${targets.length} 条（${targets.join(', ')}），但不执行。`);
    return 0;
  }

  let checked = 0;
  for (const label of targets) {
    const row = rowOf(label).first();
    if (!(await row.count())) {
      log.warn(`删除时未找到行「${label}」，可能已不存在，跳过。`);
      continue;
    }
    await row.scrollIntoViewIfNeeded({ timeout: t }).catch(() => undefined);
    if (await ensureRowChecked(page, row, hz, t)) checked += 1;
    else log.warn(`行「${label}」未能勾选。`);
    await think(hz);
  }

  if (checked === 0) {
    log.warn('未能勾选任何目标行，放弃删除。');
    return 0;
  }

  await clickToolbarDeleteAndConfirm(page, cfg, checked);

  const countTargets = async (): Promise<number> => {
    let n = 0;
    for (const label of targets) n += (await rowOf(label).count()) > 0 ? 1 : 0;
    return n;
  };
  const remaining = await countAfterDeletion(page, countTargets, checked, t);

  const deleted = Math.max(checked - remaining, 0);
  log.ok(`按 label 删除完成：删除 ${deleted}/${checked} 条（仍存在 ${remaining}）。`);
  return deleted;
}

/**
 * 从内容表里抽取指定 label 的行，写成一个临时 CSV（仅含表头 + 命中行），返回其绝对路径。
 * 用于 Save 失败后只重传出问题的那几行；保留原表结构、BOM、行尾与跨行 JSON 字段。
 * 未命中任何行时返回空串。
 */
export function writeSubsetCsv(csvAbs: string, labels: string[]): string {
  const wanted = new Set(labels.map((l) => l.trim()).filter(Boolean));
  if (wanted.size === 0) return '';

  const raw = readFileSync(csvAbs, 'utf-8');
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const hasTrailingNl = /\r?\n$/.test(raw);

  const records = parse(raw, { bom: true, relax_column_count: true }) as string[][];
  if (records.length === 0) return '';
  const header = records[0];
  const labelIdx = header.findIndex((h) => h.trim().toLowerCase() === 'label');
  if (labelIdx === -1) return '';

  const kept = [header];
  for (let i = 1; i < records.length; i++) {
    const cell = (records[i][labelIdx] ?? '').trim();
    if (wanted.has(cell)) kept.push(records[i]);
  }
  if (kept.length <= 1) return '';

  const body = kept.map((r) => r.map(csvEscape).join(',')).join(eol);
  const out = (hasBom ? '\ufeff' : '') + body + (hasTrailingNl ? eol : '');
  const outPath = join(tmpdir(), `fbrecreate-${Date.now()}-${basename(csvAbs)}`);
  writeFileSync(outPath, out, 'utf-8');
  return outPath;
}

async function rowCheckbox(row: Locator): Promise<Locator | null> {
  const byRole = row.getByRole('checkbox').first();
  if (await byRole.count()) return byRole;
  const byInput = row.locator('input[type="checkbox"]').first();
  if (await byInput.count()) return byInput;
  const byAria = row.locator('[aria-checked]').first();
  if (await byAria.count()) return byAria;
  return null;
}

async function ensureRowChecked(
  page: Page,
  row: Locator,
  hz: AppConfig['humanize'],
  timeoutMs: number,
): Promise<boolean> {
  const box = await rowCheckbox(row);
  if (!box) return false;
  if (await box.isChecked().catch(() => false)) return true;
  await humanClick(page, box, hz, timeoutMs).catch(() => undefined);
  if (await box.isChecked().catch(() => false)) return true;
  await box.check({ force: true, timeout: timeoutMs }).catch(() => undefined);
  return box.isChecked().catch(() => false);
}

async function selectRowsAndDelete(
  page: Page,
  cfg: AppConfig,
  checkRows: () => Promise<number>,
  what: string,
): Promise<number> {
  const checked = await checkRows();
  if (checked === 0) {
    log.warn(`未能勾选任何 ${what}，放弃批量删除。`);
    return 0;
  }
  await clickToolbarDeleteAndConfirm(page, cfg, checked);
  return checked;
}

async function clickToolbarDeleteAndConfirm(
  page: Page,
  cfg: AppConfig,
  checked: number,
): Promise<void> {
  const t = cfg.stepTimeoutMs;
  log.step(`已勾选 ${checked} 行，点击右上角「Delete」批量删除 ...`);
  const toolbarDelete = page
    .getByRole('button', { name: S.batchDelete.deleteButtonText, exact: true })
    .first();
  await toolbarDelete.waitFor({ state: 'visible', timeout: t });
  const enabledUntil = Date.now() + Math.min(8000, t);
  while (Date.now() < enabledUntil && !(await toolbarDelete.isEnabled().catch(() => false))) {
    await page.waitForTimeout(200);
  }
  if (!(await toolbarDelete.isEnabled().catch(() => false))) {
    throw new Error('勾选后工具栏 Delete 仍禁用，勾选可能未生效。');
  }
  await humanClick(page, toolbarDelete, cfg.humanize, t);
  await think(cfg.humanize);
  await confirmDeletion(page, cfg);
}

/** 处理「Deletion Confirmation」弹窗，点击确认删除。弹窗未出现则失败，避免空点。 */
async function confirmDeletion(page: Page, cfg: AppConfig): Promise<void> {
  const t = cfg.stepTimeoutMs;
  const title = page.getByText(S.deleteConfirm.titleText, { exact: false }).first();
  try {
    await title.waitFor({ state: 'visible', timeout: Math.min(8000, t) });
  } catch {
    throw new Error(
      '点击 Delete 后未出现 Deletion Confirmation 弹窗（勾选可能未生效，或按钮点到了别处）。',
    );
  }

  const dialog = page.getByRole('dialog');
  const confirmBtn = (await dialog.count())
    ? dialog.first().getByRole('button', { name: S.deleteConfirm.confirmButtonText, exact: true })
    : page.getByRole('button', { name: S.deleteConfirm.confirmButtonText, exact: true }).last();

  await humanClick(page, confirmBtn.first(), cfg.humanize, t);
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
