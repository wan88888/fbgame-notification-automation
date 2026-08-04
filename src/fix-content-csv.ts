/**
 * 修复内容表 CSV 的已知格式问题（目前：image_url 末尾不成对的引号）。
 *
 * 用法：
 *   npm run fix-content-csv -- --dry-run   # 只预览，不写文件
 *   npm run fix-content-csv               # 写入修复
 *   npm run fix-content-csv -- --game "Bubble Candy"
 *
 * 修完后建议再跑：npm run check-campaigns / npm run gen-schedule
 */
import 'dotenv/config';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from './logger.js';
import {
  deriveProjectKey,
  DEFAULT_CONTENT_NAME_PREFIX,
  DEFAULT_CONTENT_SUBDIR,
} from './campaigns.js';
import { diagnoseContentCsv, fixContentCsvText } from './content-csv.js';

const CONTENT_SUBDIR = process.env['CONTENT_SUBDIR'] || DEFAULT_CONTENT_SUBDIR;
const NAME_PREFIX = process.env['CONTENT_NAME_PREFIX'] ?? DEFAULT_CONTENT_NAME_PREFIX;
const SCHEDULE_SUFFIX = '.schedule.csv';

interface Options {
  dryRun: boolean;
  games: string[];
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { dryRun: false, games: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--game') {
      const val = argv[++i];
      if (!val) throw new Error('--game 需要一个游戏名称参数');
      opts.games.push(val);
    } else {
      throw new Error(`未知参数: ${arg}（支持 --dry-run / --game <名称>）`);
    }
  }
  return opts;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const contentDir = resolve(process.cwd(), 'campaigns', CONTENT_SUBDIR);
  if (!existsSync(contentDir)) {
    throw new Error(`找不到内容表目录: ${contentDir}`);
  }

  const wanted = new Set(opts.games.map((g) => g.trim().toLowerCase()));
  const files = readdirSync(contentDir)
    .filter(
      (f) =>
        f.toLowerCase().endsWith('.csv') &&
        !f.toLowerCase().endsWith('.example.csv') &&
        !f.toLowerCase().endsWith(SCHEDULE_SUFFIX),
    )
    .sort()
    .filter((f) => {
      if (wanted.size === 0) return true;
      const name = deriveProjectKey(basename(f, '.csv'), NAME_PREFIX);
      return wanted.has(name.trim().toLowerCase());
    });

  if (files.length === 0) {
    log.warn('没有匹配到可处理的内容表。');
    return;
  }

  if (opts.dryRun) log.info('--dry-run：只预览，不写文件。');

  let touched = 0;
  let totalFixed = 0;

  for (const file of files) {
    const abs = join(contentDir, file);
    const raw = readFileSync(abs, 'utf-8');
    const before = diagnoseContentCsv(raw);
    const { text, fixed } = fixContentCsvText(raw);

    if (fixed === 0) {
      if (!before.ok) {
        log.warn(
          `${file}：未能自动修复（无已知模式匹配）。` +
            (before.parseError ? ` 解析错误：${before.parseError}` : ''),
        );
      }
      continue;
    }

    touched += 1;
    totalFixed += fixed;
    const after = diagnoseContentCsv(text);
    const status = after.ok ? '修复后可解析' : '修复后仍无法解析，请人工检查';
    log.info(`${file}：将修复 ${fixed} 处多余 URL 引号 → ${status}`);

    if (!opts.dryRun) {
      writeFileSync(abs, text, 'utf-8');
      log.ok(`已写入 ${file}`);
    }
  }

  if (opts.dryRun) {
    log.info(`[预览] 完成：${touched} 个文件、${totalFixed} 处可修（未写入）。去掉 --dry-run 即可写入。`);
  } else {
    log.info(`完成：改动 ${touched} 个文件、${totalFixed} 处。建议接着跑 npm run gen-schedule。`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
