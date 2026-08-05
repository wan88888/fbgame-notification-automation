/** 在仓库根目录派生子进程执行现有 npm 脚本。 */
import { spawn } from 'node:child_process';
import {
  appendJobLog,
  updateJob,
  type JobRecord,
  type JobType,
} from './jobs.js';
import { REPO_ROOT } from './paths.js';

export { REPO_ROOT };

function commandsFor(type: JobType, args: string[]): { label: string; cmd: string; argv: string[] }[] {
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
): Promise<number> {
  return new Promise((resolvePromise) => {
    appendJobLog(jobId, `\n----- ${label}: ${cmd} ${argv.join(' ')} -----\n`);
    const child = spawn(cmd, argv, {
      cwd: REPO_ROOT,
      env: { ...process.env, FORCE_COLOR: '0' },
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
  chain = chain.then(() => executeJob(job.id)).catch((e) => {
    console.error('[ops-api] job chain error', e);
  });
}

async function executeJob(jobId: string): Promise<void> {
  const started = updateJob(jobId, {
    status: 'running',
    startedAt: new Date().toISOString(),
  });
  const steps = commandsFor(started.type, started.args ?? []);

  for (const step of steps) {
    const code = await runOne(jobId, step.cmd, step.argv, step.label);
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
