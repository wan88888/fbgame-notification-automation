/**
 * 断点续跑状态：记录每个游戏的处理进度，供 --resume 使用。
 *
 * 长任务（18 个游戏 × 7 条）中途失败时，重跑不必从头再来：
 *   - completed 的游戏整体跳过（不再导航/上传/编辑）；
 *   - uploaded 但未 completed 的游戏跳过「Create from CSV」上传，避免重复批量创建，
 *     但仍会重做编辑 + Turn On（这两步对已存在的推送是幂等的）。
 *
 * 状态文件是「一次运行批次」的快照，包含 runKey（本批次标识）。runKey 变化（比如换了一周
 * 的排期）时旧状态视为过期、不再复用，避免误跳过新一轮的游戏。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { log } from './logger.js';

export interface GameProgress {
  /** 已成功执行过 Create from CSV 上传。 */
  uploaded: boolean;
  /** 本游戏全部推送处理成功（无失败条目、无整体错误）。 */
  completed: boolean;
}

export interface RunState {
  /** 本批次标识（如排期起始日或运行日期），用于判定状态是否仍适用于当前这批任务。 */
  runKey: string;
  /** 首次写入时间（ISO）。 */
  startedAt: string;
  /** 最近更新时间（ISO）。 */
  updatedAt: string;
  /** projectName -> 进度。 */
  games: Record<string, GameProgress>;
}

function emptyState(runKey: string): RunState {
  const now = new Date().toISOString();
  return { runKey, startedAt: now, updatedAt: now, games: {} };
}

/**
 * 读取状态文件；仅当其 runKey 与当前批次一致时才复用，否则视为过期、返回全新状态。
 * 文件不存在或损坏时也返回全新状态（不因状态问题阻断运行）。
 */
export function loadRunState(path: string, runKey: string): RunState {
  const abs = resolve(process.cwd(), path);
  if (!existsSync(abs)) return emptyState(runKey);
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf-8')) as Partial<RunState>;
    if (parsed.runKey !== runKey || typeof parsed.games !== 'object' || parsed.games === null) {
      log.info(`续跑状态与当前批次不一致（旧 runKey=${parsed.runKey ?? '无'}），将忽略旧状态。`);
      return emptyState(runKey);
    }
    return {
      runKey,
      startedAt: parsed.startedAt ?? new Date().toISOString(),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      games: parsed.games as Record<string, GameProgress>,
    };
  } catch (e) {
    log.warn(`读取续跑状态失败（将从头开始）: ${abs} — ${(e as Error).message}`);
    return emptyState(runKey);
  }
}

/** 持久化状态到磁盘（失败只告警，不影响主流程）。 */
export function saveRunState(path: string, state: RunState): void {
  const abs = resolve(process.cwd(), path);
  try {
    mkdirSync(dirname(abs), { recursive: true });
    state.updatedAt = new Date().toISOString();
    writeFileSync(abs, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  } catch (e) {
    log.warn(`写入续跑状态失败（不影响本次运行）: ${abs} — ${(e as Error).message}`);
  }
}

/** 取某游戏进度（缺省为「未处理」）。 */
export function getGameProgress(state: RunState, projectName: string): GameProgress {
  return state.games[projectName] ?? { uploaded: false, completed: false };
}

/** 合并更新某游戏进度并落盘。 */
export function markGameProgress(
  path: string,
  state: RunState,
  projectName: string,
  patch: Partial<GameProgress>,
): void {
  const prev = getGameProgress(state, projectName);
  state.games[projectName] = { ...prev, ...patch };
  saveRunState(path, state);
}
