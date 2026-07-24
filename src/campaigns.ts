import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { ProjectMapEntry, ResolvedGameJob } from './types.js';
import { parseScheduleSheet } from './schedule.js';
import { log } from './logger.js';

const SCHEDULE_SUBDIR = 'schedule';
const SCHEDULE_SUFFIX = '.schedule.csv';
const PROJECT_MAP_FILE = 'projects.json';

/**
 * 运营导出的内容表默认带的文件名前缀（如「推送配置表 - AHA.csv」）。
 * 推导游戏名时会剥掉它，得到真正的游戏名「AHA」，避免运营手工改名。
 */
export const DEFAULT_CONTENT_NAME_PREFIX = '推送配置表';

/**
 * 内容表所在子目录（campaigns 下）。默认就是飞书下载的「推送配置表」文件夹，
 * 运营把整个文件夹存到 campaigns/ 下即可，无需复制或清洗。
 */
export const DEFAULT_CONTENT_SUBDIR = '推送配置表';

/**
 * 从内容表文件名（不含扩展名）推导游戏名 / 项目键。
 * 若以 prefix 开头，则剥掉该前缀及紧随其后的分隔符（空格 / - / – / — / : / ：）。
 * 不匹配前缀时原样返回，保证「AHA.csv」这类老命名不受影响。
 */
export function deriveProjectKey(fileBase: string, prefix: string): string {
  let name = fileBase.trim();
  if (prefix && name.startsWith(prefix)) {
    name = name
      .slice(prefix.length)
      .replace(/^[\s\-–—:：]+/, '')
      .trim();
  }
  return name;
}

/**
 * User Notifications 页 URL 默认模板。各游戏这条 URL 只有 /apps/<APP_ID>/ 这段不同，
 * 因此 projects.json 里通常只需填 appId，其余由本模板补全（{appId} 占位符）。
 * 如个别游戏所属 business 不同，可在 projects.json 用整条 url 覆盖，或改本模板（NOTIFICATIONS_URL_TEMPLATE）。
 */
export const DEFAULT_NOTIFICATIONS_URL_TEMPLATE =
  'https://developers.facebook.com/apps/{appId}/use_cases/customize/user_notifications/' +
  '?use_case_enum=INSTANT_GAMES_NOTIFICATION_SERVICE&business_id=644048981685643' +
  '&selected_tab=user_notifications&product_route=instant-games';

/** 用模板 + appId 拼出直达 URL；模板缺少 {appId} 占位符时抛错以尽早暴露配置问题。 */
export function buildNotificationsUrl(template: string, appId: string): string {
  if (!template.includes('{appId}')) {
    throw new Error(`NOTIFICATIONS_URL_TEMPLATE 缺少 {appId} 占位符: ${template}`);
  }
  return template.replaceAll('{appId}', encodeURIComponent(appId));
}

/**
 * 读取可选的「文件名 -> 项目信息」映射。
 * 值可以是字符串（Meta 项目显示名），或对象 { name?, url? }。
 */
function loadProjectMap(dirAbs: string): Record<string, ProjectMapEntry> {
  const p = join(dirAbs, PROJECT_MAP_FILE);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, ProjectMapEntry>;
  } catch (e) {
    log.warn(`projects.json 解析失败，忽略：${(e as Error).message}`);
    return {};
  }
}

/**
 * 从映射条目解析出项目显示名与可选直达 URL。
 * URL 优先级：显式 url > 由 appId + 模板拼出 > 无（回退到菜单导航）。
 */
function resolveProjectInfo(
  name: string,
  entry: ProjectMapEntry | undefined,
  urlTemplate: string,
): { projectName: string; url?: string } {
  if (entry === undefined) return { projectName: name };
  if (typeof entry === 'string') return { projectName: entry };

  const projectName = entry.name ?? name;
  if (entry.url) return { projectName, url: entry.url };
  if (entry.appId) return { projectName, url: buildNotificationsUrl(urlTemplate, entry.appId) };
  return { projectName };
}

/**
 * 从 campaign 目录自动发现「内容 CSV + 排期表」配对，生成待处理游戏列表。
 *
 * 约定：
 *   content/<name>.csv            内容 CSV（原样上传到 Meta 的 Create from CSV）
 *   schedule/<name>.schedule.csv  排期表（label,date,send_time_strategy）
 *   projects.json                 可选：{ "<name>": "<Meta 项目显示名>" }
 *
 * 项目名优先取 projects.json 中 <name> 的映射，否则用文件名 <name>。
 * 返回空数组表示该目录下没有可处理的 campaign。
 */
export function discoverCampaigns(
  dir: string,
  urlTemplate: string = DEFAULT_NOTIFICATIONS_URL_TEMPLATE,
  namePrefix: string = DEFAULT_CONTENT_NAME_PREFIX,
  contentSubdir: string = DEFAULT_CONTENT_SUBDIR,
): ResolvedGameJob[] {
  const dirAbs = resolve(process.cwd(), dir);
  if (!existsSync(dirAbs)) return [];

  const contentDir = join(dirAbs, contentSubdir);
  const scheduleDir = join(dirAbs, SCHEDULE_SUBDIR);
  if (!existsSync(contentDir)) return [];

  const projectMap = loadProjectMap(dirAbs);
  const files = readdirSync(contentDir);

  const contentCsvs = files.filter(
    (f) =>
      f.toLowerCase().endsWith('.csv') &&
      !f.toLowerCase().endsWith(SCHEDULE_SUFFIX) &&
      !f.toLowerCase().endsWith('.example.csv'),
  );

  const jobs: ResolvedGameJob[] = [];
  for (const csv of contentCsvs.sort()) {
    // 游戏名剥掉运营导出的文件名前缀（如「推送配置表 - AHA.csv」→「AHA」）。
    const name = deriveProjectKey(basename(csv, '.csv'), namePrefix);
    const scheduleFile = `${name}${SCHEDULE_SUFFIX}`;
    const scheduleAbs = join(scheduleDir, scheduleFile);

    if (!existsSync(scheduleAbs)) {
      log.warn(
        `跳过「${contentSubdir}/${csv}」：缺少配套排期表「${SCHEDULE_SUBDIR}/${scheduleFile}」。`,
      );
      continue;
    }

    const notifications = parseScheduleSheet(scheduleAbs);
    if (notifications.length === 0) {
      log.warn(
        `跳过「${contentSubdir}/${csv}」：排期表「${SCHEDULE_SUBDIR}/${scheduleFile}」没有已填日期的有效行。`,
      );
      continue;
    }
    const { projectName, url } = resolveProjectInfo(name, projectMap[name], urlTemplate);
    jobs.push({ projectName, url, csv: join(contentDir, csv), notifications });
    log.info(
      `发现 campaign：${contentSubdir}/${csv} -> 项目「${projectName}」${url ? '（直达 URL）' : ''}，` +
        `${notifications.length} 条推送（排期表 ${SCHEDULE_SUBDIR}/${scheduleFile}）`,
    );
  }
  return jobs;
}
