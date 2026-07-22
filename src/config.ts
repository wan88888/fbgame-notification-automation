import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameJob, GamesConfig, NotificationsConfig, ResolvedGameJob } from './types.js';
import { discoverCampaigns } from './campaigns.js';

function env(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

/** 拟人化行为配置（让操作节奏接近真人，降低自动化检测风险）。 */
export interface HumanizeConfig {
  /** 总开关。 */
  enabled: boolean;
  /** 步骤之间的随机「思考」停顿区间（毫秒）。 */
  thinkMinMs: number;
  thinkMaxMs: number;
  /** 逐字符键入时每个字符的随机间隔（毫秒）。 */
  typeMinMs: number;
  typeMaxMs: number;
  /** 每条推送处理之间的随机停顿区间（毫秒）。 */
  betweenItemsMinMs: number;
  betweenItemsMaxMs: number;
  /** 每个游戏之间的随机停顿区间（毫秒）。 */
  betweenGamesMinMs: number;
  betweenGamesMaxMs: number;
}

export interface AppConfig {
  adspower: {
    apiBase: string;
    apiKey: string;
    userId: string;
    /** AdsPower 本地 API 单次请求超时（毫秒）。 */
    timeoutMs: number;
  };
  metaAdminUrl: string;
  projectName: string;
  notificationsConfigPath: string;
  csvFilePath: string;
  gamesConfigPath: string;
  campaignDir: string;
  slowMoMs: number;
  stepTimeoutMs: number;
  autoTurnOn: boolean;
  postUploadWaitMs: number;
  screenshotDir: string;
  /** 运行日志落盘目录。 */
  logDir: string;
  closeBrowserOnExit: boolean;
  /** 运行时开关（由命令行覆盖，见 cli.ts）。 */
  dryRun: boolean;
  noUpload: boolean;
  /** 跳过导航，直接接管当前已打开的标签页（从 Create from CSV 开始）。 */
  useOpenPage: boolean;
  /** 单游戏兜底模式下，Send notifications 页的直达 URL（可选）。 */
  notificationsUrl: string;
  /** 拟人化行为配置。 */
  humanize: HumanizeConfig;
  /** 单次运行最多处理多少条推送（跨所有游戏累计）。0 表示不限制。频率闸门。 */
  maxItemsPerRun: number;
}

export function loadConfig(): AppConfig {
  const cfg: AppConfig = {
    adspower: {
      apiBase: env('ADSPOWER_API_BASE', 'http://local.adspower.net:50325').replace(/\/+$/, ''),
      apiKey: env('ADSPOWER_API_KEY'),
      userId: env('ADSPOWER_USER_ID'),
      timeoutMs: envInt('ADSPOWER_API_TIMEOUT_MS', 15000),
    },
    metaAdminUrl: env('META_ADMIN_URL', 'https://developers.facebook.com/apps/'),
    projectName: env('PROJECT_NAME'),
    notificationsConfigPath: env('NOTIFICATIONS_CONFIG', './data/notifications.json'),
    csvFilePath: env('CSV_FILE', './data/notifications.csv'),
    gamesConfigPath: env('GAMES_CONFIG', './data/games.json'),
    campaignDir: env('CAMPAIGN_DIR', './campaigns'),
    slowMoMs: envInt('SLOW_MO_MS', 50),
    stepTimeoutMs: envInt('STEP_TIMEOUT_MS', 30000),
    autoTurnOn: envBool('AUTO_TURN_ON', true),
    postUploadWaitMs: envInt('POST_UPLOAD_WAIT_MS', 5000),
    screenshotDir: env('SCREENSHOT_DIR', './screenshots'),
    logDir: env('LOG_DIR', './logs'),
    closeBrowserOnExit: envBool('CLOSE_BROWSER_ON_EXIT', false),
    dryRun: false,
    noUpload: false,
    useOpenPage: envBool('USE_OPEN_PAGE', false),
    notificationsUrl: env('NOTIFICATIONS_URL'),
    humanize: {
      enabled: envBool('HUMANIZE', true),
      thinkMinMs: envInt('THINK_MIN_MS', 600),
      thinkMaxMs: envInt('THINK_MAX_MS', 2200),
      typeMinMs: envInt('TYPE_MIN_MS', 60),
      typeMaxMs: envInt('TYPE_MAX_MS', 180),
      betweenItemsMinMs: envInt('BETWEEN_ITEMS_MIN_MS', 4000),
      betweenItemsMaxMs: envInt('BETWEEN_ITEMS_MAX_MS', 12000),
      betweenGamesMinMs: envInt('BETWEEN_GAMES_MIN_MS', 15000),
      betweenGamesMaxMs: envInt('BETWEEN_GAMES_MAX_MS', 45000),
    },
    maxItemsPerRun: envInt('MAX_ITEMS_PER_RUN', 0),
  };

  if (!cfg.adspower.userId) {
    throw new Error('缺少 ADSPOWER_USER_ID，请在 .env 中填写要接管的 AdsPower profile 编号。');
  }
  return cfg;
}

/** 读取并解析 notifications 配置文件。 */
export function loadNotifications(path: string): NotificationsConfig {
  const abs = resolve(process.cwd(), path);
  let raw: string;
  try {
    raw = readFileSync(abs, 'utf-8');
  } catch {
    throw new Error(
      `无法读取推送配置文件: ${abs}（可参考 data/notifications.example.json 创建）。`,
    );
  }

  let parsed: NotificationsConfig;
  try {
    parsed = JSON.parse(raw) as NotificationsConfig;
  } catch (e) {
    throw new Error(`推送配置文件不是合法 JSON: ${abs}. ${(e as Error).message}`, { cause: e });
  }

  if (!Array.isArray(parsed.notifications) || parsed.notifications.length === 0) {
    throw new Error(`推送配置文件中 notifications 为空: ${abs}`);
  }
  for (const [i, n] of parsed.notifications.entries()) {
    if (!n.label) throw new Error(`notifications[${i}] 缺少 label`);
    if (!n.date) throw new Error(`notifications[${i}] (${n.label}) 缺少 date`);
  }
  return parsed;
}

/**
 * 解析出要处理的游戏任务列表，按优先级：
 *  1. campaigns/content + campaigns/schedule 里「内容 CSV + 排期表」配对（运营主用，最省事）；
 *  2. games 配置文件（GAMES_CONFIG，进阶/手动）；
 *  3. .env 里的单游戏配置（PROJECT_NAME + NOTIFICATIONS_CONFIG + CSV_FILE）兜底。
 */
export function resolveGames(cfg: AppConfig): ResolvedGameJob[] {
  // 1) campaigns 自动发现。
  const campaigns = discoverCampaigns(cfg.campaignDir);
  if (campaigns.length > 0) return campaigns;

  // 2) games.json。
  const gamesAbs = resolve(process.cwd(), cfg.gamesConfigPath);
  if (existsSync(gamesAbs)) {
    return resolveFromGamesFile(gamesAbs);
  }

  // 3) 单游戏兜底。
  const single = loadNotifications(cfg.notificationsConfigPath);
  return [
    {
      projectName: single.projectName || cfg.projectName,
      url: cfg.notificationsUrl || undefined,
      csv: cfg.csvFilePath,
      notifications: single.notifications,
    },
  ];
}

function resolveFromGamesFile(gamesAbs: string): ResolvedGameJob[] {
  let parsed: GamesConfig;
  try {
    parsed = JSON.parse(readFileSync(gamesAbs, 'utf-8')) as GamesConfig;
  } catch (e) {
    throw new Error(`games 配置文件不是合法 JSON: ${gamesAbs}. ${(e as Error).message}`, {
      cause: e,
    });
  }
  if (!Array.isArray(parsed.games) || parsed.games.length === 0) {
    throw new Error(`games 配置文件中 games 为空: ${gamesAbs}`);
  }
  return parsed.games.map((g, i) => resolveGameJob(g, i));
}

function resolveGameJob(g: GameJob, index: number): ResolvedGameJob {
  if (!g.projectName) throw new Error(`games[${index}] 缺少 projectName`);
  if (!g.csv) throw new Error(`games[${index}] (${g.projectName}) 缺少 csv`);

  let notifications = g.notifications;
  if ((!notifications || notifications.length === 0) && g.notificationsFile) {
    notifications = loadNotifications(g.notificationsFile).notifications;
  }
  if (!notifications || notifications.length === 0) {
    throw new Error(
      `games[${index}] (${g.projectName}) 未提供 notifications（内联）或 notificationsFile。`,
    );
  }
  for (const [j, n] of notifications.entries()) {
    if (!n.label)
      throw new Error(`games[${index}] (${g.projectName}) notifications[${j}] 缺少 label`);
    if (!n.date)
      throw new Error(
        `games[${index}] (${g.projectName}) notifications[${j}] (${n.label}) 缺少 date`,
      );
  }
  return { projectName: g.projectName, url: g.url, csv: g.csv, notifications };
}
