import { loadConfig, resolveGames } from './config.js';
import { parseCli, printHelp } from './cli.js';
import { startBrowser, stopBrowser } from './adspower.js';
import { connectBrowser, getPage, screenshotOnError } from './playwright-utils.js';
import {
  navigateToNotifications,
  uploadCsv,
  editNotification,
  turnOnNotification,
} from './steps.js';
import type { AppConfig } from './config.js';
import type { ResolvedGameJob } from './types.js';
import { log } from './logger.js';
import { pause } from './humanize.js';
import type { Page } from 'playwright';

interface GameResult {
  projectName: string;
  total: number;
  succeeded: number;
  failedLabels: { label: string; error: string }[];
  gameError?: string;
}

interface GameOutcome {
  result: GameResult;
  /** 本游戏实际尝试处理的条数（用于全局频率闸门计数）。 */
  attempted: number;
}

async function processGame(
  page: Page,
  game: ResolvedGameJob,
  cfg: AppConfig,
  budget: number,
): Promise<GameOutcome> {
  const items = game.notifications.slice(0, budget);
  const result: GameResult = {
    projectName: game.projectName,
    total: items.length,
    succeeded: 0,
    failedLabels: [],
  };

  log.info(`===== 开始处理游戏「${game.projectName}」，本次将处理 ${result.total} 条推送 =====`);

  try {
    await navigateToNotifications(page, game, cfg);
    if (cfg.noUpload) {
      log.warn(`游戏「${game.projectName}」--no-upload：跳过 Create from CSV 上传`);
    } else {
      await uploadCsv(page, game.csv, cfg);
    }
  } catch (e) {
    const msg = (e as Error).message;
    result.gameError = msg;
    log.error(`游戏「${game.projectName}」导航/上传阶段失败: ${msg}`);
    await screenshotOnError(page, cfg.screenshotDir, `game_${game.projectName}_setup`);
    return { result, attempted: 0 };
  }

  let attempted = 0;
  for (const [i, notif] of items.entries()) {
    try {
      await editNotification(page, notif, cfg);
      if (cfg.autoTurnOn) {
        await turnOnNotification(page, notif, cfg);
      }
      result.succeeded += 1;
    } catch (e) {
      const msg = (e as Error).message;
      log.error(`[${game.projectName}][${notif.label}] 处理失败: ${msg}`);
      await screenshotOnError(page, cfg.screenshotDir, `${game.projectName}_${notif.label}`);
      result.failedLabels.push({ label: notif.label, error: msg });
      // 关闭可能残留的编辑面板/菜单，继续下一条。
      await page.keyboard.press('Escape').catch(() => undefined);
    }
    attempted += 1;

    // 条与条之间的随机停顿（拟人化 / 降频）。
    if (i < items.length - 1) {
      const ms = await pause(cfg.humanize, cfg.humanize.betweenItemsMinMs, cfg.humanize.betweenItemsMaxMs);
      if (ms) log.info(`条间停顿 ${(ms / 1000).toFixed(1)}s ...`);
    }
  }

  log.ok(`游戏「${game.projectName}」完成：成功 ${result.succeeded}/${result.total}`);
  return { result, attempted };
}

function printSummary(results: GameResult[]): boolean {
  let hasFailure = false;
  log.info('================= 批处理汇总 =================');
  for (const r of results) {
    if (r.gameError) {
      hasFailure = true;
      log.warn(`✖ ${r.projectName}: 整体失败 - ${r.gameError}`);
      continue;
    }
    if (r.failedLabels.length) {
      hasFailure = true;
      log.warn(`△ ${r.projectName}: 成功 ${r.succeeded}/${r.total}，失败 ${r.failedLabels.length} 条`);
      for (const f of r.failedLabels) log.warn(`    - ${f.label}: ${f.error}`);
    } else {
      log.ok(`✔ ${r.projectName}: 成功 ${r.succeeded}/${r.total}`);
    }
  }
  log.info('=============================================');
  return hasFailure;
}

async function run(): Promise<void> {
  const opts = parseCli();
  if (opts.help) {
    printHelp();
    return;
  }

  const cfg = loadConfig();
  // 应用命令行覆盖。
  cfg.dryRun = opts.dryRun;
  cfg.noUpload = opts.noUpload;
  if (opts.useOpenPage) cfg.useOpenPage = true;
  if (opts.dryRun || opts.noTurnOn) cfg.autoTurnOn = false;

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

  if (cfg.dryRun) log.warn('*** DRY-RUN 模式：不会点击 Save，也不会 Turn On ***');
  if (cfg.useOpenPage) log.warn('*** USE-OPEN-PAGE：跳过导航，直接使用当前标签页 ***');
  log.info(`共 ${games.length} 个游戏待处理：${games.map((g) => g.projectName).join(', ')}`);

  const wsEndpoint = await startBrowser(cfg.adspower);
  const browser = await connectBrowser(wsEndpoint, cfg.slowMoMs);
  const page = await getPage(browser);
  page.setDefaultTimeout(cfg.stepTimeoutMs);

  const results: GameResult[] = [];
  let budget = cfg.maxItemsPerRun > 0 ? cfg.maxItemsPerRun : Number.POSITIVE_INFINITY;
  if (Number.isFinite(budget)) {
    log.warn(`频率闸门：本次运行最多处理 ${budget} 条推送（MAX_ITEMS_PER_RUN）。`);
  }
  try {
    for (const [gi, game] of games.entries()) {
      if (budget <= 0) {
        log.warn('已达单次运行条数上限，停止处理后续游戏。');
        break;
      }
      // 单个游戏内部已容错，异常也不影响后续游戏。
      const { result, attempted } = await processGame(page, game, cfg, budget);
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

  const hasFailure = printSummary(results);
  if (hasFailure) process.exitCode = 1;
}

run().catch((e) => {
  log.error((e as Error).stack ?? String(e));
  process.exitCode = 1;
});
