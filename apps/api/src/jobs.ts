/** 任务持久化（本机 JSON 文件，第一期够用）。 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { REPO_ROOT } from './paths.js';

export type JobType = 'prepare' | 'check' | 'run';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  /** 传给 npm start 的额外参数，如 --game "AHA" */
  args?: string[];
  /** 实时追加的日志文本 */
  log: string;
  error?: string;
  exitCode?: number | null;
}

const JOBS_DIR = join(REPO_ROOT, '.ops-console', 'jobs');

function ensureDir(): void {
  mkdirSync(JOBS_DIR, { recursive: true });
}

function jobPath(id: string): string {
  return join(JOBS_DIR, `${id}.json`);
}

export function createJob(type: JobType, args: string[] = []): JobRecord {
  ensureDir();
  const job: JobRecord = {
    id: randomUUID(),
    type,
    status: 'queued',
    createdAt: new Date().toISOString(),
    args,
    log: '',
  };
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2), 'utf-8');
  return job;
}

export function getJob(id: string): JobRecord | null {
  const p = jobPath(id);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as JobRecord;
}

export function listJobs(limit = 20): JobRecord[] {
  ensureDir();
  const files = readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse();
  const out: JobRecord[] = [];
  for (const f of files.slice(0, limit)) {
    try {
      out.push(JSON.parse(readFileSync(join(JOBS_DIR, f), 'utf-8')) as JobRecord);
    } catch {
      // skip corrupt
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function updateJob(id: string, patch: Partial<JobRecord>): JobRecord {
  const cur = getJob(id);
  if (!cur) throw new Error(`job not found: ${id}`);
  const next = { ...cur, ...patch };
  writeFileSync(jobPath(id), JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function appendJobLog(id: string, chunk: string): void {
  const cur = getJob(id);
  if (!cur) return;
  // 限制日志体积，避免单文件过大
  const merged = (cur.log + chunk).slice(-200_000);
  updateJob(id, { log: merged });
}
