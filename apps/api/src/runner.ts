/** 在仓库根目录派生子进程执行现有 npm 脚本。 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { appendJobLog, updateJob, type JobRecord, type JobType } from './jobs.js';
import { REPO_ROOT } from './paths.js';

export { REPO_ROOT };

function commandsFor(
  type: JobType,
  args: string[],
): { label: string; cmd: string; argv: string[] }[] {
  switch (type) {
    case 'prepare':
      return [
        { label: 'fix-content-csv', cmd: 'npm', argv: ['run', 'fix-content-csv'] },
        { label: 'gen-schedule', cmd: 'npm', argv: ['run', 'gen-schedule'] },
        { label: 'check-campaigns', cmd: 'npm', argv: ['run', 'check-campaigns'] },
      ];
    case 'check':
      return [{ label: 'check-campaigns', cmd: 'npm', argv: ['run', 'check-campaigns'] }];
    case 'run':
      return [
        {
          label: 'npm start',
          cmd: 'npm',
          argv: args.length ? ['start', '--', ...args] : ['start'],
        },
      ];
    default:
      return [];
  }
}

function runOne(
  jobId: string,
  cmd: string,
  argv: string[],
  label: string,
  batchId?: string,
): Promise<number> {
  return new Promise((resolvePromise) => {
    appendJobLog(jobId, `\n----- ${label}: ${cmd} ${argv.join(' ')} -----\n`);
    const dir = batchId ? join(REPO_ROOT, '.ops-console', 'sop', 'artifacts', batchId) : '';
    const sopEnv = batchId
      ? {
          CAMPAIGN_DIR: join(dir, 'no-campaigns'),
          GAMES_CONFIG: join(dir, 'games.json'),
          RUN_STATE_PATH: join(dir, 'run-state.json'),
          AUTO_TURN_ON: 'true',
          MAX_ITEMS_PER_RUN: '0',
          USE_OPEN_PAGE: 'false',
          ALWAYS_SET_STRATEGY: 'true',
          OPS_SAFE_MODE: 'true',
          FEISHU_WEBHOOK_URL: '',
          DELETE_COMPLETED_BEFORE_UPLOAD: 'false',
          LOG_DIR: join(dir, 'logs'),
          SCREENSHOT_DIR: join(dir, 'screenshots'),
        }
      : {};
    const child = spawn(cmd, argv, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...sopEnv, FORCE_COLOR: '0' },
      shell: process.platform === 'win32',
    });
    child.stdout?.on('data', (buf: Buffer) => appendJobLog(jobId, buf.toString('utf-8')));
    child.stderr?.on('data', (buf: Buffer) => appendJobLog(jobId, buf.toString('utf-8')));
    child.on('error', (err) => {
      appendJobLog(jobId, `\n[spawn error] ${err.message}\n`);
      resolvePromise(1);
    });
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

/** 异步执行任务（不阻塞 HTTP）。同一时间只跑一个自动化任务，避免抢 AdsPower。 */
let chain: Promise<void> = Promise.resolve();

export function enqueueJob(job: JobRecord): void {
  chain = chain
    .then(() => executeJob(job.id))
    .catch((e) => {
      updateJob(job.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: String(e),
      });
      console.error('[ops-api] job chain error', e);
    });
}

async function executeJob(jobId: string): Promise<void> {
  const started = updateJob(jobId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });
  const steps = commandsFor(started.type, started.args ?? []);

  if (started.sopBatchId) {
    if (!/^[a-f0-9-]{36}$/.test(started.sopBatchId)) throw new Error('非法 SOP 批次 ID');
    const file = join(
      REPO_ROOT,
      '.ops-console',
      'sop',
      'artifacts',
      started.sopBatchId,
      'games.json',
    );
    const payload = JSON.parse(readFileSync(file, 'utf8')) as {
      games: { notifications: { date: string }[] }[];
    };
    if (
      payload.games.some((game) =>
        game.notifications.some((n) => new Date(`${n.date}T00:00:00Z`).getTime() <= Date.now()),
      )
    ) {
      throw new Error('排队期间推送日期已开始，已停止执行；请人工核查排期。');
    }
  }

  for (const step of steps) {
    const code = await runOne(jobId, step.cmd, step.argv, step.label, started.sopBatchId);
    if (code !== 0) {
      updateJob(jobId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        exitCode: code,
        error: `步骤「${step.label}」退出码 ${code}`,
      });
      return;
    }
  }

  updateJob(jobId, {
    status: 'succeeded',
    finishedAt: new Date().toISOString(),
    exitCode: 0,
  });
}
