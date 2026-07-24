import { loadConfig, resolveGames } from './config.js';
import { parseCli, printHelp } from './cli.js';
import type { CliOptions } from './cli.js';
import { startBrowser, stopBrowser, isActive } from './adspower.js';
import { connectBrowser, getPage, screenshotOnError } from './playwright-utils.js';
import {
  navigateToNotifications,
  uploadCsv,
  editNotification,
  turnOnNotification,
  deleteCompletedNotifications,
} from './steps.js';
import type { AppConfig } from './config.js';
import type { ResolvedGameJob, GameResult } from './types.js';
import { log, initFileLogging, getLogFile } from './logger.js';
import { pause } from './humanize.js';
import { findSameDayConflicts, validateScheduleDates } from './validate.js';
import { parseFlexibleDate, toIsoDate } from './date-utils.js';
import { loadRunState, getGameProgress, markGameProgress, type RunState } from './run-state.js';
import { notifyFeishu } from './notify.js';
import type { Page } from 'playwright';

/** 传给 processGame 的续跑上下文。 */
interface ResumeCtx {
  state: RunState;
  path: string;
  /** 本游戏已上传过，跳过 Create from CSV（避免重复批量创建）。 */
  skipUpload: boolean;
}

interface GameOutcome {
  result: GameResult;
  /** 本游戏实际尝试处理的条数（用于全局频率闸门计数）。 */
  attempted: number;
}

/** 判断错误是否为「已达 10 条 active 上限」。 */
function isActiveLimit(msg: string): boolean {
  return msg.includes('ACTIVE_LIMIT') || /more than 10 active/i.test(msg);
}

/**
 * 提示某游戏排期里「同一天多条推送」的情况。
 * Meta 每天只允许 1 条 active Single Send，多出的在 Save 时会失败。
 */
function warnSameDayConflicts(game: ResolvedGameJob): void {
  const conflicts = findSameDayConflicts(game.notifications);
  for (const [date, labels] of conflicts) {
    log.warn(
      `[${game.projectName}] 同一天有多条推送（${date}）：${labels.join(', ')}。` +
        `Meta 每天只允许 1 条 active Single Send，多出的在 Save 时会失败，请分散到不同日期。`,
    );
  }
}

async function processGame(
  page: Page,
  game: ResolvedGameJob,
  cfg: AppConfig,
  budget: number,
  resume?: ResumeCtx,
): Promise<GameOutcome> {
  const items = game.notifications.slice(0, budget);
  const result: GameResult = {
    projectName: game.projectName,
    total: items.length,
    succeeded: 0,
    failedLabels: [],
  };

  // 本游戏是否跳过上传：命令行 --no-upload，或续跑时本游戏已上传过。
  const skipUpload = cfg.noUpload || resume?.skipUpload === true;

  log.info(`===== 开始处理游戏「${game.projectName}」，本次将处理 ${result.total} 条推送 =====`);

  try {
    // 无论是否上传，日期都会在编辑阶段用到，先拦掉非法日期格式。
    const dateErrors = validateScheduleDates(game.notifications);
    if (dateErrors.length > 0) {
      for (const err of dateErrors) log.error(`[${game.projectName}] 排期日期错误: ${err}`);
      throw new Error(`排期日期格式非法（${dateErrors.length} 处），已跳过本游戏。`);
    }

    // 同一天多条提醒（Meta 每天只允许 1 条 active Single Send）。
    warnSameDayConflicts(game);

    await navigateToNotifications(page, game, cfg);
    if (skipUpload) {
      const why = resume?.skipUpload ? '续跑：本游戏已上传过' : '--no-upload';
      log.warn(`游戏「${game.projectName}」${why}：跳过 Create from CSV 上传`);
    } else {
      await uploadCsv(page, game.csv, cfg);
      // 上传成功即落盘，避免中途失败后续跑重复批量创建。
      if (resume) markGameProgress(resume.path, resume.state, game.projectName, { uploaded: true });
    }
  } catch (e) {
    const msg = (e as Error).message;
    result.gameError = msg;
    log.error(`游戏「${game.projectName}」导航/上传阶段失败: ${msg}`);
    await screenshotOnError(page, cfg.screenshotDir, `game_${game.projectName}_setup`);
    return { result, attempted: 0 };
  }

  let attempted = 0;
  let skipTurnOn = false; // 本游戏命中 active 上限且无法腾位后置真，仅影响本游戏。
  let cleanupTried = false; // 本游戏是否已尝试过删除 Completed 腾位（每游戏最多一次）。
  for (const [i, notif] of items.entries()) {
    try {
      await editNotification(page, notif, cfg);
      if (cfg.autoTurnOn && !skipTurnOn) {
        try {
          await turnOnNotification(page, notif, cfg);
        } catch (e) {
          // 撞到 10 条 active 上限：删除 Completed 通知腾位后重试一次（每游戏只清理一次）。
          if (!isActiveLimit((e as Error).message) || cleanupTried) throw e;
          cleanupTried = true;
          log.warn(`[${game.projectName}] 撞到 10 条 active 上限，尝试删除 Completed 通知腾位 ...`);
          const deleted = await deleteCompletedNotifications(page, cfg);
          if (deleted === 0) {
            throw new Error(
              'ACTIVE_LIMIT: 已达上限，且没有可删除的 Completed 通知，无法腾出空位。',
              { cause: e },
            );
          }
          // 腾位成功，重试当前条目的 Turn On（再失败则由外层捕获）。
          await turnOnNotification(page, notif, cfg);
        }
      }
      result.succeeded += 1;
    } catch (e) {
      const msg = (e as Error).message;
      log.error(`[${game.projectName}][${notif.label}] 处理失败: ${msg}`);
      await screenshotOnError(page, cfg.screenshotDir, `${game.projectName}_${notif.label}`);
      result.failedLabels.push({ label: notif.label, error: msg });
      // 关闭可能残留的编辑面板/菜单，继续下一条。
      await page.keyboard.press('Escape').catch(() => undefined);

      // 已达上限且无法腾位（无 Completed 可删），本游戏剩余不再尝试 Turn On。
      if (isActiveLimit(msg)) {
        log.warn(
          `[${game.projectName}] 已达 Meta 每 app 10 条 active 上限且无法腾位，跳过本游戏剩余条目的 Turn On。`,
        );
        skipTurnOn = true;
      }
    }
    attempted += 1;

    // 条与条之间的随机停顿（拟人化 / 降频）。
    if (i < items.length - 1) {
      const ms = await pause(
        cfg.humanize,
        cfg.humanize.betweenItemsMinMs,
        cfg.humanize.betweenItemsMaxMs,
      );
      if (ms) log.info(`条间停顿 ${(ms / 1000).toFixed(1)}s ...`);
    }
  }

  // 全部成功（无失败条目）才标记 completed，供 --resume 整体跳过。
  if (resume && result.failedLabels.length === 0) {
    markGameProgress(resume.path, resume.state, game.projectName, { completed: true });
  }

  log.ok(`游戏「${game.projectName}」完成：成功 ${result.succeeded}/${result.total}`);
  return { result, attempted };
}

function printSummary(results: GameResult[]): boolean {
  let hasFailure = false;
  log.info('================= 批处理汇总 =================');
  for (const r of results) {
    if (r.skipped) {
      log.info(`↷ ${r.projectName}: 续跑跳过（上一批次已完成）`);
      continue;
    }
    if (r.gameError) {
      hasFailure = true;
      log.warn(`✖ ${r.projectName}: 整体失败 - ${r.gameError}`);
      continue;
    }
    if (r.failedLabels.length) {
      hasFailure = true;
      log.warn(
        `△ ${r.projectName}: 成功 ${r.succeeded}/${r.total}，失败 ${r.failedLabels.length} 条`,
      );
      for (const f of r.failedLabels) log.warn(`    - ${f.label}: ${f.error}`);
    } else {
      log.ok(`✔ ${r.projectName}: 成功 ${r.succeeded}/${r.total}`);
    }
  }
  log.info('=============================================');
  return hasFailure;
}

/** 把命令行选项覆盖到配置上（dry-run / no-upload / use-open-page / turn-on 开关）。 */
function applyCliOverrides(cfg: AppConfig, opts: CliOptions): void {
  cfg.dryRun = opts.dryRun;
  cfg.noUpload = opts.noUpload;
  cfg.resume = opts.resume;
  if (opts.useOpenPage) cfg.useOpenPage = true;
  if (opts.dryRun || opts.noTurnOn) cfg.autoTurnOn = false;
}

/**
 * 计算本批次标识：取所有游戏排期里最早的日期（归一化为 YYYY-MM-DD）。
 * 排期滚动到下一周后最早日期改变，runKey 随之变化，旧的续跑状态自动失效，
 * 避免误跳过新一轮的游戏。无有效日期时退回今天日期。
 */
function computeRunKey(games: ResolvedGameJob[]): string {
  let min: Date | undefined;
  for (const game of games) {
    for (const n of game.notifications) {
      try {
        const d = parseFlexibleDate(n.date);
        if (!min || d < min) min = d;
      } catch {
        // 非法日期在 processGame 里会被拦截，这里忽略即可。
      }
    }
  }
  return toIsoDate(min ?? new Date());
}

/**
 * 解析并筛选本次要处理的游戏列表：
 * 数据来源解析 -> --game 过滤 -> --limit 截断 -> --use-open-page 单游戏限制。
 */
function selectGames(cfg: AppConfig, opts: CliOptions): ResolvedGameJob[] {
  let games = resolveGames(cfg);

  // --game 过滤（按 projectName，不区分大小写、去除首尾空格）。
  if (opts.games.length) {
    const wanted = new Set(opts.games.map((g) => g.trim().toLowerCase()));
    games = games.filter((g) => wanted.has(g.projectName.trim().toLowerCase()));
    if (games.length === 0) {
      throw new Error(`--game 未匹配到任何游戏：${opts.games.join(', ')}`);
    }
  }

  // --limit 每个游戏只取前 N 条。
  if (opts.limit > 0) {
    games = games.map((g) => ({ ...g, notifications: g.notifications.slice(0, opts.limit) }));
  }

  // --use-open-page 无法切换项目，多游戏时只处理第一个。
  if (cfg.useOpenPage && games.length > 1) {
    log.warn(
      `--use-open-page 模式无法切换项目，将只处理第一个游戏「${games[0].projectName}」，其余忽略。` +
        `（如需批量，请改用每游戏固定 URL 或默认导航模式。）`,
    );
    games = games.slice(0, 1);
  }

  return games;
}

/** 从 Meta 后台地址解析出主机名，用于优先接管命中该域名的标签页。 */
function preferredHost(cfg: AppConfig): string | undefined {
  try {
    return new URL(cfg.metaAdminUrl).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** 启动 AdsPower 浏览器，按序处理所有游戏，返回每个游戏的结果。 */
async function runAutomation(cfg: AppConfig, games: ResolvedGameJob[]): Promise<GameResult[]> {
  // 启动前探活：已在运行则提示直接接管；顺带尽早暴露「客户端未开启」类问题。
  if (await isActive(cfg.adspower)) {
    log.info('检测到该 AdsPower profile 浏览器已在运行，将直接接管。');
  }

  const wsEndpoint = await startBrowser(cfg.adspower);
  const browser = await connectBrowser(wsEndpoint, cfg.slowMoMs);
  const page = await getPage(browser, preferredHost(cfg));
  page.setDefaultTimeout(cfg.stepTimeoutMs);

  // 续跑状态：即便不带 --resume 也会记录进度，便于事后用 --resume 续跑。
  const runKey = computeRunKey(games);
  const state = loadRunState(cfg.runStatePath, runKey);
  if (cfg.resume) {
    log.warn(`*** --resume：本批次 runKey=${runKey}，将跳过已完成的游戏、已上传的不重复上传 ***`);
  }

  const results: GameResult[] = [];
  let budget = cfg.maxItemsPerRun > 0 ? cfg.maxItemsPerRun : Number.POSITIVE_INFINITY;
  if (Number.isFinite(budget)) {
    log.warn(`频率闸门：本次运行最多处理 ${budget} 条推送（MAX_ITEMS_PER_RUN）。`);
  }
  try {
    for (const [gi, game] of games.entries()) {
      const progress = getGameProgress(state, game.projectName);

      // --resume：已完成的游戏整体跳过。
      if (cfg.resume && progress.completed) {
        log.info(`↷ 游戏「${game.projectName}」已在本批次完成，跳过。`);
        results.push({
          projectName: game.projectName,
          total: game.notifications.length,
          succeeded: 0,
          failedLabels: [],
          skipped: true,
        });
        continue;
      }

      if (budget <= 0) {
        log.warn('已达单次运行条数上限，停止处理后续游戏。');
        break;
      }
      // 续跑时已上传过的游戏跳过上传，避免重复批量创建。
      const resumeCtx: ResumeCtx = {
        state,
        path: cfg.runStatePath,
        skipUpload: cfg.resume && progress.uploaded,
      };
      // 单个游戏内部已容错，异常也不影响后续游戏。
      const { result, attempted } = await processGame(page, game, cfg, budget, resumeCtx);
      results.push(result);
      budget -= attempted;

      // 游戏与游戏之间的随机长停顿。
      if (gi < games.length - 1 && budget > 0) {
        const ms = await pause(
          cfg.humanize,
          cfg.humanize.betweenGamesMinMs,
          cfg.humanize.betweenGamesMaxMs,
        );
        if (ms) log.info(`游戏间停顿 ${(ms / 1000).toFixed(1)}s ...`);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
    if (cfg.closeBrowserOnExit) {
      await stopBrowser(cfg.adspower);
    } else {
      log.info('已断开 CDP 连接（AdsPower 浏览器保持开启）。');
    }
  }
  return results;
}

async function run(): Promise<void> {
  const opts = parseCli();
  if (opts.help) {
    printHelp();
    return;
  }

  const cfg = loadConfig();
  applyCliOverrides(cfg, opts);

  initFileLogging(cfg.logDir);
  const logFile = getLogFile();
  if (logFile) log.info(`运行日志将写入: ${logFile}`);

  const games = selectGames(cfg, opts);

  if (cfg.dryRun) log.warn('*** DRY-RUN 模式：不会点击 Save，也不会 Turn On ***');
  if (cfg.useOpenPage) log.warn('*** USE-OPEN-PAGE：跳过导航，直接使用当前标签页 ***');
  log.info(`共 ${games.length} 个游戏待处理：${games.map((g) => g.projectName).join(', ')}`);

  const startedAt = new Date();
  const results = await runAutomation(cfg, games);

  const hasFailure = printSummary(results);
  if (hasFailure) process.exitCode = 1;

  // 运行结果推送飞书（未配置 webhook 时内部静默跳过，失败也不影响退出码）。
  await notifyFeishu(cfg.feishu, {
    results,
    hasFailure,
    logFile,
    startedAt,
    finishedAt: new Date(),
    dryRun: cfg.dryRun,
  });
}

run().catch((e) => {
  log.error((e as Error).stack ?? String(e));
  process.exitCode = 1;
});
