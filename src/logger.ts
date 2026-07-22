/** 带时间戳的日志工具：输出到控制台，并可选同时落盘到 logs/run-<runId>.log。 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** 文件名安全的本地时间戳，如 2026-07-22_18-20-55。 */
function fileStamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

let runId = '';
let logFile: string | null = null;

/**
 * 初始化文件日志。生成本次运行的 runId（同时用于日志文件名与出错截图前缀，
 * 便于把「某次运行的日志」和「该次的截图」对应起来）。返回 runId。
 * 失败（如无写权限）时静默降级为仅控制台输出。
 */
export function initFileLogging(dir = './logs'): string {
  runId = fileStamp();
  try {
    const abs = resolve(process.cwd(), dir);
    mkdirSync(abs, { recursive: true });
    logFile = resolve(abs, `run-${runId}.log`);
  } catch {
    logFile = null;
  }
  return runId;
}

/** 当前运行的 runId（未初始化文件日志时为空串）。 */
export function getRunId(): string {
  return runId;
}

/** 当前日志文件路径（未启用时为 null）。 */
export function getLogFile(): string | null {
  return logFile;
}

function stringifyArg(a: unknown): string {
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

function emit(
  consoleFn: (msg: string, ...args: unknown[]) => void,
  symbol: string,
  msg: string,
  args: unknown[],
): void {
  const line = `[${ts()}] ${symbol}  ${msg}`;
  consoleFn(line, ...args);
  if (logFile) {
    try {
      const extra = args.length ? ` ${args.map(stringifyArg).join(' ')}` : '';
      appendFileSync(logFile, `${line}${extra}\n`);
    } catch {
      // 落盘失败不影响运行。
    }
  }
}

export const log = {
  info: (msg: string, ...args: unknown[]) => emit(console.log, 'ℹ', msg, args),
  step: (msg: string, ...args: unknown[]) => emit(console.log, '▶', msg, args),
  ok: (msg: string, ...args: unknown[]) => emit(console.log, '✔', msg, args),
  warn: (msg: string, ...args: unknown[]) => emit(console.warn, '⚠', msg, args),
  error: (msg: string, ...args: unknown[]) => emit(console.error, '✖', msg, args),
};
