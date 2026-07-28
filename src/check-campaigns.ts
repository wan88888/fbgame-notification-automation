/**
 * 开跑前「配置体检」——不开浏览器，几秒扫完 campaigns/，尽早暴露昨天那类问题：
 *   1. 内容表文件名 → 剥前缀后的游戏名，在 projects.json 里能否匹配到 appId/url
 *      （匹配不到 → 运行时会退化成脆弱的菜单导航，整款失败）。
 *   2. 是否有配套的 schedule/<游戏>.schedule.csv，且里面有已填日期的行。
 *   3. 排期日期是否合法、是否有「同一天多条」冲突。
 *
 * 用法：
 *   npm run check-campaigns          # 有问题时退出码 = 1，可用于开跑前 gate
 *
 * 只读、无副作用，可放心随时运行。
 */
import 'dotenv/config';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectMapEntry } from './types.js';
import {
  deriveProjectKey,
  DEFAULT_CONTENT_NAME_PREFIX,
  DEFAULT_CONTENT_SUBDIR,
} from './campaigns.js';
import { parseScheduleSheet } from './schedule.js';
import { findSameDayConflicts, validateScheduleDates } from './validate.js';

const CONTENT_SUBDIR = process.env['CONTENT_SUBDIR'] || DEFAULT_CONTENT_SUBDIR;
const NAME_PREFIX = process.env['CONTENT_NAME_PREFIX'] ?? DEFAULT_CONTENT_NAME_PREFIX;
const SCHEDULE_SUFFIX = '.schedule.csv';

/** projects.json 里某个键能否解析出「直达 URL 所需信息」（appId 或整条 url）。 */
export function resolveCoverage(entry: ProjectMapEntry | undefined): {
  hasUrl: boolean;
  appId?: string;
  displayName?: string;
} {
  if (entry === undefined) return { hasUrl: false };
  if (typeof entry === 'string') return { hasUrl: false, displayName: entry };
  if (entry.url) return { hasUrl: true, displayName: entry.name };
  if (entry.appId) return { hasUrl: true, appId: entry.appId, displayName: entry.name };
  return { hasUrl: false, displayName: entry.name };
}

interface CampaignCheck {
  file: string;
  name: string;
  /** 问题列表（为空即通过）。 */
  problems: string[];
  /** 提示（非阻断）。 */
  notes: string[];
}

function loadProjectMap(dirAbs: string): Record<string, ProjectMapEntry> {
  const p = join(dirAbs, 'projects.json');
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Record<string, ProjectMapEntry>;
  } catch (e) {
    throw new Error(`projects.json 解析失败：${(e as Error).message}`, { cause: e });
  }
}

function checkOne(
  file: string,
  scheduleDir: string,
  projectMap: Record<string, ProjectMapEntry>,
): CampaignCheck {
  const name = deriveProjectKey(basename(file, '.csv'), NAME_PREFIX);
  const problems: string[] = [];
  const notes: string[] = [];

  // 1) projects.json 匹配。
  const cov = resolveCoverage(projectMap[name]);
  if (!cov.hasUrl) {
    problems.push(
      `未在 projects.json 匹配到 appId/url（会走菜单导航、极易整款失败）。` +
        `请加键「${name}」并填 appId（键名需与文件名去前缀后完全一致）。`,
    );
  } else if (cov.appId) {
    notes.push(`appId=${cov.appId}${cov.displayName ? ` 显示名「${cov.displayName}」` : ''}`);
  }

  // 2) 配套排期表。
  const schedulePath = join(scheduleDir, `${name}${SCHEDULE_SUFFIX}`);
  if (!existsSync(schedulePath)) {
    problems.push(`缺少排期表 schedule/${name}${SCHEDULE_SUFFIX}（请先 npm run gen-schedule）。`);
    return { file, name, problems, notes };
  }

  // 3) 排期内容：已填日期条数、日期合法性、同日冲突。
  let notifications: { label: string; date: string }[];
  try {
    notifications = parseScheduleSheet(schedulePath);
  } catch (e) {
    problems.push(`排期表读取失败：${(e as Error).message}`);
    return { file, name, problems, notes };
  }
  if (notifications.length === 0) {
    problems.push(`排期表没有已填日期的有效行（本款会被整体跳过）。`);
    return { file, name, problems, notes };
  }
  notes.push(`已填 ${notifications.length} 条`);

  const dateErrors = validateScheduleDates(notifications);
  for (const err of dateErrors) problems.push(err);

  const conflicts = findSameDayConflicts(notifications);
  for (const [date, labels] of conflicts) {
    problems.push(`同一天多条（${date}）：${labels.join(', ')}——每天仅允许 1 条 active，需分散日期。`);
  }

  return { file, name, problems, notes };
}

function main(): void {
  const dirAbs = resolve(process.cwd(), 'campaigns');
  const contentDir = join(dirAbs, CONTENT_SUBDIR);
  const scheduleDir = join(dirAbs, 'schedule');

  if (!existsSync(contentDir)) {
    console.error(`✖ 找不到内容表目录：${contentDir}`);
    process.exitCode = 1;
    return;
  }

  const projectMap = loadProjectMap(dirAbs);
  const files = readdirSync(contentDir)
    .filter(
      (f) =>
        f.toLowerCase().endsWith('.csv') &&
        !f.toLowerCase().endsWith('.example.csv') &&
        !f.toLowerCase().endsWith(SCHEDULE_SUFFIX),
    )
    .sort();

  if (files.length === 0) {
    console.error(`✖ ${CONTENT_SUBDIR}/ 下没有可处理的内容表 CSV。`);
    process.exitCode = 1;
    return;
  }

  const results = files.map((f) => checkOne(f, scheduleDir, projectMap));
  const okCount = results.filter((r) => r.problems.length === 0).length;
  const badCount = results.length - okCount;

  console.log('====== campaigns 配置体检 ======');
  for (const r of results) {
    if (r.problems.length === 0) {
      console.log(`✓ ${r.name}  (${r.file})  ${r.notes.join('，')}`);
    } else {
      console.log(`✗ ${r.name}  (${r.file})`);
      for (const p of r.problems) console.log(`    - ${p}`);
    }
  }

  // projects.json 里配了、但没有对应内容表的键（信息性提示）。
  const usedNames = new Set(results.map((r) => r.name));
  const unused = Object.keys(projectMap).filter((k) => !usedNames.has(k));
  if (unused.length > 0) {
    console.log(`（提示）projects.json 中未被本次内容表使用的键：${unused.join(', ')}`);
  }

  console.log('================================');
  console.log(`通过 ${okCount}/${results.length}，问题 ${badCount} 款。`);
  if (badCount > 0) {
    console.log('请先修复上面标 ✗ 的问题，再执行 ./run.sh。');
    process.exitCode = 1;
  } else {
    console.log('全部通过，可以执行 ./run.sh。');
  }
}

// 仅作为脚本直接运行时执行；被测试 import 时不触发。
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
