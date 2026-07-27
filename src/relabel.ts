/**
 * 批量修改 campaigns/推送配置表/*.csv 里 label 列的「数字后缀补零位数」。
 *
 * 典型用途：把 AHA_1～AHA_8 统一改成 AHA_01～AHA_08（--pad 2）或 AHA_001～AHA_008（--pad 3）。
 * 换一种位数会让 label 字符串整体改变，也能顺带避开与后台已存在 label 的重复。
 *
 * 只改 label 列的值：前缀（数字前的部分）原样保留，只把结尾连续数字按十进制重新补零；
 * 位数不足则补 0，已超过目标位数则保持不变（不会截断、不会丢数字）。其余所有列、
 * 表头、行序、跨行 JSON 字段（bot_message_payload_elements 等）全部原样保留。
 *
 * 用法：
 *   npm run relabel                       # 默认补到 2 位（AHA_1 -> AHA_01）
 *   npm run relabel -- --pad 3            # 补到 3 位（AHA_1 -> AHA_001）
 *   npm run relabel -- --pad 2 --dry-run  # 只预览要改什么，不写文件
 *   npm run relabel -- --game AHA         # 只处理某个游戏（按去前缀后的名字匹配，可重复）
 *
 * 改完 label 后记得重新生成排期：
 *   npm run gen-schedule -- --keep-dates  # 已排好日期时按行位次保留日期
 *   npm run gen-schedule                  # 尚未排日期时自动填充
 */
import 'dotenv/config';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, join, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { log } from './logger.js';
import { csvEscape } from './csv-utils.js';
import {
  deriveProjectKey,
  DEFAULT_CONTENT_NAME_PREFIX,
  DEFAULT_CONTENT_SUBDIR,
} from './campaigns.js';

const CONTENT_SUBDIR = process.env['CONTENT_SUBDIR'] || DEFAULT_CONTENT_SUBDIR;
const CONTENT_DIR = resolve(process.cwd(), 'campaigns', CONTENT_SUBDIR);
const NAME_PREFIX = process.env['CONTENT_NAME_PREFIX'] ?? DEFAULT_CONTENT_NAME_PREFIX;
const SCHEDULE_SUFFIX = '.schedule.csv';

interface Options {
  /** label 结尾数字补零到的位数。 */
  pad: number;
  /** 只预览、不写文件。 */
  dryRun: boolean;
  /** 只处理这些游戏（按去前缀后的名字，忽略大小写）。为空表示全部。 */
  games: string[];
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { pad: 2, dryRun: false, games: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--pad':
      case '-p': {
        const val = argv[++i];
        const n = Number.parseInt(val ?? '', 10);
        if (Number.isNaN(n) || n < 1) throw new Error('--pad 需要一个 >=1 的整数（如 2 或 3）');
        opts.pad = n;
        break;
      }
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--game': {
        const val = argv[++i];
        if (!val) throw new Error('--game 需要一个游戏名称参数');
        opts.games.push(val);
        break;
      }
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`未知参数: ${arg}（用 --help 查看用法）`);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`
批量修改 ${CONTENT_SUBDIR}/*.csv 里 label 列结尾数字的补零位数。

用法:
  npm run relabel                       # 默认补到 2 位（AHA_1 -> AHA_01）
  npm run relabel -- --pad 3            # 补到 3 位（AHA_1 -> AHA_001）
  npm run relabel -- --pad 2 --dry-run  # 只预览，不写文件
  npm run relabel -- --game AHA         # 只处理指定游戏（可重复传多个）

选项:
  -p, --pad <N>   label 结尾数字补零到 N 位（默认 2；不会截断已更长的数字）
      --dry-run   只打印将要发生的改动，不修改文件
      --game <名> 只处理去前缀后名字匹配的文件（可重复）
  -h, --help      显示本帮助
`);
}

/**
 * 把一个 label 结尾的连续数字重新补零到指定位数。
 * 前缀原样保留；无结尾数字时原样返回。parseInt 会先去掉多余前导零，
 * 因此既能补零也能改变位数（AHA_007 --pad 2 -> AHA_07）。
 */
export function repadLabel(label: string, width: number): string {
  const m = /^(.*?)(\d+)$/.exec(label);
  if (!m) return label;
  const [, prefix, digits] = m;
  return `${prefix}${String(Number.parseInt(digits, 10)).padStart(width, '0')}`;
}

/** 探测行尾风格：文件里出现过 \r\n 就按 CRLF 回写，否则 LF。 */
function detectEol(raw: string): '\r\n' | '\n' {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

interface FileResult {
  file: string;
  changes: { from: string; to: string }[];
  skipped?: string;
}

function processFile(file: string, opts: Options): FileResult {
  const path = join(CONTENT_DIR, file);
  const raw = readFileSync(path, 'utf-8');
  const hasBom = raw.charCodeAt(0) === 0xfeff;
  const eol = detectEol(raw);
  const hasTrailingNl = /\r?\n$/.test(raw);

  let records: string[][];
  try {
    records = parse(raw, { bom: true, relax_column_count: true }) as string[][];
  } catch (e) {
    return { file, changes: [], skipped: `不是合法 CSV：${(e as Error).message}` };
  }
  if (records.length === 0) return { file, changes: [], skipped: '空文件' };

  const header = records[0];
  const labelIdx = header.findIndex((h) => h.trim().toLowerCase() === 'label');
  if (labelIdx === -1) return { file, changes: [], skipped: '没有 label 列' };

  const changes: { from: string; to: string }[] = [];
  for (let i = 1; i < records.length; i++) {
    const row = records[i];
    const cur = row[labelIdx];
    if (cur === undefined) continue;
    const next = repadLabel(cur.trim(), opts.pad);
    if (next !== cur) {
      changes.push({ from: cur, to: next });
      row[labelIdx] = next;
    }
  }

  if (changes.length > 0 && !opts.dryRun) {
    const body = records.map((r) => r.map(csvEscape).join(',')).join(eol);
    const out = (hasBom ? '\ufeff' : '') + body + (hasTrailingNl ? eol : '');
    writeFileSync(path, out, 'utf-8');
  }
  return { file, changes };
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(CONTENT_DIR)) {
    throw new Error(`找不到内容表目录: ${CONTENT_DIR}`);
  }

  const wanted = opts.games.length
    ? new Set(opts.games.map((g) => g.trim().toLowerCase()))
    : undefined;

  const files = readdirSync(CONTENT_DIR)
    .filter(
      (f) =>
        f.toLowerCase().endsWith('.csv') &&
        !f.toLowerCase().endsWith('.example.csv') &&
        !f.toLowerCase().endsWith(SCHEDULE_SUFFIX),
    )
    .filter((f) => {
      if (!wanted) return true;
      return wanted.has(deriveProjectKey(basename(f, '.csv'), NAME_PREFIX).toLowerCase());
    })
    .sort();

  if (files.length === 0) {
    log.warn(`${CONTENT_SUBDIR}/ 下没有匹配的内容表。`);
    return;
  }

  log.info(
    `${opts.dryRun ? '[预览] ' : ''}将把 label 结尾数字补零到 ${opts.pad} 位，共 ${files.length} 个文件。`,
  );

  let changedFiles = 0;
  let changedRows = 0;
  for (const file of files) {
    const res = processFile(file, opts);
    if (res.skipped) {
      log.warn(`跳过 ${file}：${res.skipped}`);
      continue;
    }
    if (res.changes.length === 0) {
      log.info(`✔ ${file}：无需修改`);
      continue;
    }
    changedFiles += 1;
    changedRows += res.changes.length;
    log.ok(`${opts.dryRun ? '[预览] ' : '已修改'} ${file}：${res.changes.length} 条 label`);
    for (const c of res.changes) log.info(`    ${c.from} -> ${c.to}`);
  }

  if (opts.dryRun) {
    log.info(`[预览] 完成：将改动 ${changedFiles} 个文件、${changedRows} 条 label（未写入）。`);
    log.info('去掉 --dry-run 即可实际写入。');
  } else {
    log.info(`完成：改动 ${changedFiles} 个文件、${changedRows} 条 label。`);
    if (changedRows > 0) {
      log.warn(
        'label 已变化，请重新生成排期：npm run gen-schedule -- --keep-dates（已排好日期时按行位次保留）。',
      );
    }
  }
}

// 仅在作为脚本直接运行（npm run relabel / tsx src/relabel.ts）时执行，
// 被测试等模块 import 时不触发，避免误改真实 CSV。
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
