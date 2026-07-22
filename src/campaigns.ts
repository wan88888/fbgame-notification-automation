import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { ProjectMapEntry, ResolvedGameJob } from './types.js';
import { parseScheduleSheet } from './schedule.js';
import { log } from './logger.js';

const CONTENT_SUBDIR = 'content';
const SCHEDULE_SUBDIR = 'schedule';
const SCHEDULE_SUFFIX = '.schedule.csv';
const PROJECT_MAP_FILE = 'projects.json';

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

/** 从映射条目解析出项目显示名与可选直达 URL。 */
function resolveProjectInfo(
  name: string,
  entry: ProjectMapEntry | undefined,
): { projectName: string; url?: string } {
  if (entry === undefined) return { projectName: name };
  if (typeof entry === 'string') return { projectName: entry };
  return { projectName: entry.name ?? name, url: entry.url };
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
export function discoverCampaigns(dir: string): ResolvedGameJob[] {
  const dirAbs = resolve(process.cwd(), dir);
  if (!existsSync(dirAbs)) return [];

  const contentDir = join(dirAbs, CONTENT_SUBDIR);
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
    const name = basename(csv, '.csv');
    const scheduleFile = `${name}${SCHEDULE_SUFFIX}`;
    const scheduleAbs = join(scheduleDir, scheduleFile);

    if (!existsSync(scheduleAbs)) {
      log.warn(
        `跳过「${CONTENT_SUBDIR}/${csv}」：缺少配套排期表「${SCHEDULE_SUBDIR}/${scheduleFile}」。`,
      );
      continue;
    }

    const notifications = parseScheduleSheet(scheduleAbs);
    if (notifications.length === 0) {
      log.warn(
        `跳过「${CONTENT_SUBDIR}/${csv}」：排期表「${SCHEDULE_SUBDIR}/${scheduleFile}」没有已填日期的有效行。`,
      );
      continue;
    }
    const { projectName, url } = resolveProjectInfo(name, projectMap[name]);
    jobs.push({ projectName, url, csv: join(contentDir, csv), notifications });
    log.info(
      `发现 campaign：${CONTENT_SUBDIR}/${csv} -> 项目「${projectName}」${url ? '（直达 URL）' : ''}，` +
        `${notifications.length} 条推送（排期表 ${SCHEDULE_SUBDIR}/${scheduleFile}）`,
    );
  }
  return jobs;
}
