import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { SopService, nextTuesday, scheduleInstant } from '../apps/api/src/sop-service.js';
import { sopRoutes } from '../apps/api/src/sop-routes.js';
import type { JobRecord } from '../apps/api/src/jobs.js';

const jobs = vi.hoisted(() => new Map<string, JobRecord>());
vi.mock('../apps/api/src/jobs.js', () => ({
  createJob: (type: JobRecord['type'], args: string[]) => {
    const job = {
      id: randomUUID(),
      type,
      args,
      status: 'queued',
      log: '',
      createdAt: new Date().toISOString(),
    } as JobRecord;
    jobs.set(job.id, job);
    return job;
  },
  getJob: (id: string) => jobs.get(id) ?? null,
  updateJob: (id: string, patch: Partial<JobRecord>) => {
    const value = { ...jobs.get(id)!, ...patch };
    jobs.set(id, value);
    return value;
  },
}));
vi.mock('../apps/api/src/runner.js', () => ({ enqueueJob: vi.fn() }));
let dir: string;
let now: Date;
let service: SopService;
let request: ReturnType<typeof vi.fn<typeof fetch>>;
let enqueue: ReturnType<typeof vi.fn>;
const template =
  'label,notification_title_English,notification_body_English,image_url,payload\nold,Old title,Old body,https://example.test/image.png,"{""source"":""push""}"\n';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sop-test-'));
  now = new Date('2026-09-14T00:00:00Z');
  request = vi.fn<typeof fetch>();
  enqueue = vi.fn();
  jobs.clear();
  vi.stubEnv('ADSPOWER_USER_ID', 'test-profile');
  vi.stubEnv('OPS_AI_URL', '');
  vi.stubEnv('OPS_AI_KEY', '');
  vi.stubEnv('OPS_AI_MODEL', '');
  vi.stubEnv('OPS_METRICS_URL', '');
  vi.stubEnv('OPS_FEISHU_WEBHOOK_URL', '');
  service = new SopService(dir, () => now, request, enqueue);
});
afterEach(() => {
  service.stop();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
async function ready(predicted = false) {
  if (predicted) service.settings({ ...service.overview().settings, timingMode: 'predicted' });
  const batch = service.create({ weekOf: '2026-09-15' });
  await service.generate(batch.id, 'template');
  service.setTemplate(batch.id, { csv: template });
  return service.prepare(batch.id);
}
async function measured() {
  const batch = await ready();
  service.verify(batch.id, '测试操作员已核对日期、时刻、时区和开启状态');
  now = new Date('2026-09-21T03:00:00Z');
  const label = batch.variants.find((v) => v.selected)!.label;
  return service.importMetrics(
    batch.id,
    `label,sent,opened,clicked,recalled,recall_eligible,window_hours\n${label},1000,,50,20,500,144`,
  );
}
describe('SOP schedule and input validation', () => {
  it('uses the next Tuesday and converts a fixed Beijing time to UTC', () => {
    expect(nextTuesday(now)).toBe('2026-09-15');
    expect(nextTuesday(new Date('2026-09-15T02:00:00Z'))).toBe('2026-09-22');
    expect(scheduleInstant('2026-09-15', service.overview().settings)).toBe(
      '2026-09-15T02:00:00.000Z',
    );
    expect(() => scheduleInstant('2026-09-16', service.overview().settings)).toThrow('周二');
    expect(() => scheduleInstant('2026-02-31', service.overview().settings)).toThrow('有效');
  });
  it('rejects duplicate weekly plans and invalid settings', () => {
    service.create({ weekOf: '2026-09-15' });
    expect(() => service.create({ weekOf: '2026-09-15' })).toThrow('已有批次');
    expect(() => service.settings({ ...service.overview().settings, sendTime: '26:00' })).toThrow(
      '时间',
    );
    expect(() => service.create({ weekOf: '2026-09-08' })).toThrow('过期');
  });
  it('rejects unselected or multiple selected copy variants and keeps stored copy intact', async () => {
    const batch = service.create();
    const generated = await service.generate(batch.id, 'template');
    expect(() =>
      service.updateVariants(
        batch.id,
        generated.variants.map((v) => ({ ...v, selected: false })),
      ),
    ).toThrow('恰好');
    expect(() =>
      service.updateVariants(
        batch.id,
        generated.variants.map((v) => ({ ...v, selected: true })),
      ),
    ).toThrow('恰好');
    expect(service.get(batch.id).variants.filter((v) => v.selected)).toHaveLength(1);
  });
  it('template output is explicitly non-AI and does not silently use Chinese for other languages', async () => {
    const b = service.create();
    expect((await service.generate(b.id, 'template')).variants[0].origin).toBe('template');
    service.updateSettings(b.id, { ...b.settings, language: 'French' });
    await expect(service.generate(b.id, 'template')).rejects.toThrow('English');
  });
});
describe('SOP CSV, publishing and recovery', () => {
  it('requires a real template and preserves media, payload, quoting and selected copy', async () => {
    const b = service.create();
    await service.generate(b.id, 'template');
    expect(() => service.prepare(b.id)).toThrow('模板');
    service.setTemplate(b.id, { csv: template });
    const edited = service.get(b.id).variants;
    edited[0].title = 'Return, "player"';
    edited[0].body = 'First line\nSecond line';
    service.updateVariants(b.id, edited);
    service.prepare(b.id);
    const rows = parse(service.exportCsv(b.id, 'content'), { columns: true, bom: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].notification_title_English).toBe('Return, "player"');
    expect(rows[0].notification_body_English).toBe('First line\nSecond line');
    expect(rows[0].payload).toBe('{"source":"push"}');
    expect(rows[0].image_url).toBe('https://example.test/image.png');
    const games = JSON.parse(readFileSync(join(dir, 'artifacts', b.id, 'games.json'), 'utf8'));
    expect(games.games[0].csv).toBe(join(dir, 'artifacts', b.id, 'content.csv'));
  });
  it('rejects malformed/mismatched template mappings', () => {
    const b = service.create();
    expect(() => service.setTemplate(b.id, { csv: 'label,title,body\na,b,c' })).toThrow('同一语言');
    expect(() => service.setTemplate(b.id, { csv: template + 'another,a,b,c,d\n' })).toThrow(
      '一条',
    );
  });
  it('blocks unsupported fixed-time automation without creating any job', async () => {
    const b = await ready();
    expect(() => service.publish(b.id)).toThrow('固定时刻');
    expect(enqueue).not.toHaveBeenCalled();
    expect(jobs.size).toBe(0);
  });
  it('supports changing the draft timing mode without changing global defaults', async () => {
    const b = await ready();
    const settings = service.overview().settings;
    expect(service.updateSettings(b.id, { ...b.settings, timingMode: 'predicted' }).status).toBe(
      'draft',
    );
    expect(service.overview().settings).toEqual(settings);
    expect(service.prepare(b.id).settings.timingMode).toBe('predicted');
  });
  it('queues once, locks edits, then requires verification rather than claiming sent', async () => {
    const b = await ready(true);
    const result = service.publish(b.id);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(result.job.sopBatchId).toBe(b.id);
    expect(() => service.publish(b.id)).toThrow('重复发布');
    expect(() => service.updateVariants(b.id, b.variants)).toThrow('锁定');
    jobs.get(result.job.id)!.status = 'succeeded';
    expect(service.get(b.id).status).toBe('verification');
    expect(() => service.verify(b.id, '')).toThrow('核验');
    expect(service.verify(b.id, '运营已核对后台排期').status).toBe('scheduled');
  });
  it('restart does not replay a possibly completed remote mutation', async () => {
    const b = await ready(true);
    service.publish(b.id);
    const restarted = new SopService(dir, () => now, request, enqueue);
    restarted.recoverInterrupted();
    expect(restarted.get(b.id).status).toBe('failed');
    expect(enqueue).toHaveBeenCalledOnce();
  });
  it('safe retry requires an operator note and never uploads again', async () => {
    const b = await ready(true);
    const first = service.publish(b.id);
    jobs.get(first.job.id)!.status = 'failed';
    expect(() => service.retry(b.id, '')).toThrow('续跑前核验说明');
    const retried = service.retry(b.id, '已核对后台存在本批次 label，继续编辑和开启');
    expect(retried.job.args).toEqual(['--resume', '--no-upload']);
    expect(retried.batch.status).toBe('publishing');
    expect(() => service.retry(b.id, '重复点击')).toThrow('仅失败');
  });
});
describe('SOP measured weekly cycle', () => {
  it('runs from verified schedule through metrics, report, and an idempotent next draft', async () => {
    const b = await measured();
    const report = service.report(b.id);
    expect(report.report?.totals.opened).toBeNull();
    expect(report.report?.totals.ctr).toBe(0.05);
    expect(report.report?.totals.recallRate).toBe(0.04);
    expect(report.status).toBe('reported');
    const next = service.next(b.id);
    expect(next.weekOf).toBe('2026-09-22');
    expect(next.parentId).toBe(b.id);
    expect(next.csvTemplate).toEqual(b.csvTemplate);
    expect(next.status).toBe('draft');
    expect(service.next(b.id).id).toBe(next.id);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('rejects metrics before verification or window maturity and does not invent empty metrics', async () => {
    const b = await ready();
    const row = `label,sent,window_hours\n${b.variants[0].label},100,168`;
    expect(() => service.importMetrics(b.id, row)).toThrow('核验');
    service.verify(b.id, '核验完成');
    expect(() => service.importMetrics(b.id, row)).toThrow('尚未');
    now = new Date('2026-09-16T03:00:00Z');
    expect(() => service.importMetrics(b.id, row)).toThrow('窗口尚未结束');
    expect(() => service.report(b.id)).toThrow('真实效果');
  });
  it('periodic collection sends association fields, reports, and creates only one next draft', async () => {
    const b = await ready();
    service.verify(b.id, '核验完成');
    service.settings({ ...service.overview().settings, autoCollect: true, autoNextDraft: true });
    vi.stubEnv('OPS_METRICS_URL', 'https://metrics.example.test/report');
    request.mockResolvedValue(
      new Response(`label,sent,clicked,window_hours\n${b.variants[0].label},1000,40,144`),
    );
    now = new Date('2026-09-21T03:00:00Z');
    await service.tick();
    await service.tick();
    expect(request).toHaveBeenCalledOnce();
    const url = new URL(String(request.mock.calls[0][0]));
    expect(url.searchParams.get('batch_id')).toBe(b.id);
    expect(url.searchParams.get('window_hours')).toBe('144');
    expect(service.get(b.id).status).toBe('reported');
    expect(service.overview().batches).toHaveLength(2);
  });
  it('backs off failed collection and surfaces actionable error', async () => {
    const b = await ready();
    service.verify(b.id, '核验完成');
    service.settings({ ...service.overview().settings, autoCollect: true });
    vi.stubEnv('OPS_METRICS_URL', 'https://metrics.example.test/report');
    request.mockResolvedValue(new Response('', { status: 500 }));
    now = new Date('2026-09-21T03:00:00Z');
    await service.tick();
    await service.tick();
    expect(request).toHaveBeenCalledOnce();
    expect(service.get(b.id).error).toContain('500');
    now = new Date('2026-09-21T04:00:01Z');
    await service.tick();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
describe('SOP API and AI adapters', () => {
  it('routes the real create/generate/template/prepare/download flow and rejects bad state transitions', async () => {
    const app = sopRoutes(service);
    expect((await app.request('/')).status).toBe(200);
    const response = await app.request('/batches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(201);
    const { batch } = await response.json();
    for (const [suffix, body, method] of [
      ['generate', { mode: 'template' }, 'POST'],
      ['template', { csv: template }, 'PUT'],
      ['prepare', {}, 'POST'],
    ] as const) {
      const result = await app.request(`/batches/${batch.id}/${suffix}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(result.status, await result.clone().text()).toBe(200);
    }
    const csvResponse = await app.request(`/batches/${batch.id}/csv?kind=content`);
    expect(csvResponse.headers.get('content-type')).toContain('text/csv');
    expect(await csvResponse.text()).toContain('notification_title_English');
    expect(
      (
        await app.request(`/batches/${batch.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account: true, content: true, schedule: true }),
        })
      ).status,
    ).toBe(409);
    expect((await app.request('/batches/missing')).status).toBe(404);
  });
  it('validates AI output and locks mutations while a generation request is pending', async () => {
    vi.stubEnv('OPS_AI_URL', 'https://ai.example.test/chat/completions');
    vi.stubEnv('OPS_AI_MODEL', 'configured-model');
    vi.stubEnv('OPS_AI_KEY', 'test-key');
    const b = service.create();
    let resolve!: (response: Response) => void;
    request.mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    const pending = service.generate(b.id, 'ai');
    expect(() => service.updateSettings(b.id, b.settings)).toThrow('正在生成');
    resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  variants: ['recall', 'reward', 'challenge'].map((theme) => ({
                    title: 'A title',
                    body: 'A body',
                    theme,
                  })),
                }),
              },
            },
          ],
        }),
      ),
    );
    expect((await pending).variants.every((v) => v.origin === 'ai')).toBe(true);
    request.mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] })),
    );
    await expect(service.generate(b.id, 'ai')).rejects.toThrow('非 JSON');
    expect(service.get(b.id).variants).toHaveLength(3);
  });
});

describe('SOP plan recycle bin', () => {
  it('removes a draft from active plans, blocks edits, and preserves it across restart for restore', async () => {
    const b = await ready();
    service.remove(b.id);
    expect(service.overview().batches).toHaveLength(0);
    expect(service.overview().deletedBatches?.[0].variants).toEqual(b.variants);
    expect(() => service.get(b.id)).toThrow('不存在');
    expect(() => service.publish(b.id)).toThrow('不存在');
    await expect(service.generate(b.id, 'template')).rejects.toThrow('不存在');
    service.remove(b.id); // repeated requests are harmless
    const restarted = new SopService(dir, () => now, request, enqueue);
    const restored = restarted.restore(b.id);
    expect(restored.deletedAt).toBeUndefined();
    expect(restored.status).toBe('draft');
    expect(restored.csvTemplate).toEqual(b.csvTemplate);
    expect(restarted.overview().deletedBatches).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('allows a replacement plan but refuses conflicting restore', () => {
    const b = service.create();
    service.remove(b.id);
    const replacement = service.create({ weekOf: b.weekOf });
    expect(replacement.id).not.toBe(b.id);
    expect(() => service.restore(b.id)).toThrow('其他计划');
    expect(service.overview().batches).toHaveLength(1);
    expect(service.overview().deletedBatches).toHaveLength(1);
  });
  it('rejects deletion during execution and after manual scheduling', async () => {
    const b = await ready(true);
    const run = service.publish(b.id);
    expect(() => service.remove(b.id)).toThrow('仅未执行');
    jobs.get(run.job.id)!.status = 'failed';
    service.syncJobs();
    expect(() => service.remove(b.id)).toThrow('仅未执行');
    service.verify(b.id, '已在后台人工完成排期');
    expect(() => service.remove(b.id)).toThrow('仅未执行');
  });
  it('does not recreate an intentionally deleted next-cycle draft', async () => {
    const b = await measured();
    service.report(b.id);
    service.settings({ ...service.overview().settings, autoNextDraft: true });
    const next = service.next(b.id);
    service.remove(next.id);
    await service.tick();
    expect(service.overview().batches).toHaveLength(1);
    expect(service.overview().deletedBatches).toHaveLength(1);
    expect(() => service.next(b.id)).toThrow('回收站恢复');
    expect(service.restore(next.id).parentId).toBe(b.id);
  });
  it('provides DELETE and restore endpoints without deleting Facebook records', async () => {
    const b = service.create();
    const app = sopRoutes(service);
    expect((await app.request(`/batches/${b.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await app.request(`/batches/${b.id}`)).status).toBe(404);
    expect((await app.request(`/batches/${b.id}/restore`, { method: 'POST' })).status).toBe(200);
    expect((await app.request(`/batches/${b.id}`)).status).toBe(200);
    expect(request).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('operator workflow improvements', () => {
  it('copies settings and template into a fresh draft with new labels, without inheriting execution or metrics', async () => {
    const source = await ready(true);
    service.assignOwner(source.id, '运营小王');
    const copy = service.duplicate(source.id, '2026-09-22');
    expect(copy.settings).toEqual(source.settings);
    expect(copy.csvTemplate).toEqual(source.csvTemplate);
    expect(copy.owner).toBe('运营小王');
    expect(copy.status).toBe('draft');
    expect(copy.jobId).toBeUndefined();
    expect(copy.metrics).toEqual([]);
    expect(copy.variants[0].label).not.toBe(source.variants[0].label);
    expect(copy.variants[0].title).toBe(source.variants[0].title);
    expect(() => service.duplicate(source.id, '2026-09-22')).toThrow('已有');
    expect(() => service.duplicate(source.id, '2026-09-08')).toThrow('过期');
  });
  it('blocks cancelling an active execution and requires remote cancellation confirmation after execution', async () => {
    const b = await ready(true);
    const run = service.publish(b.id);
    expect(() => service.cancel(b.id, { note: '停止' })).toThrow('执行中');
    jobs.get(run.job.id)!.status = 'succeeded';
    expect(() => service.cancel(b.id, { note: '停止' })).toThrow('Facebook');
    expect(service.cancel(b.id, { note: '后台已关闭', remoteCancelled: true }).status).toBe(
      'cancelled',
    );
    expect(() => service.verify(b.id, '尝试核验')).toThrow('无需核验');
    expect(() => service.prepare(b.id)).toThrow('锁定');
    expect(service.get(b.id).jobId).toBe(run.job.id);
  });
  it('cancelled plans are retained and excluded from scheduled work', async () => {
    const b = await ready();
    service.cancel(b.id, { note: '活动取消' });
    service.settings({ ...service.overview().settings, autoCollect: true, autoNextDraft: true });
    now = new Date('2026-09-23T00:00:00Z');
    await service.tick();
    expect(request).not.toHaveBeenCalled();
    expect(service.get(b.id).status).toBe('cancelled');
  });
  it('distinguishes manual scheduling and never equates browser connectivity with Facebook login', async () => {
    const b = await ready();
    const result = await service.preflight(b.id);
    expect(result.canExecute).toBe(false);
    expect(result.checks.find((c) => c.key === 'mode')?.status).toBe('manual');
    expect(request).not.toHaveBeenCalled();
    service.updateSettings(b.id, { ...b.settings, timingMode: 'predicted' });
    service.prepare(b.id);
    request.mockImplementation(
      async () => new Response(JSON.stringify({ code: 0, data: { status: 'Active' } })),
    );
    const automatic = await service.preflight(b.id);
    expect(automatic.canExecute).toBe(true);
    expect(automatic.checks.find((c) => c.key === 'account')?.status).toBe('manual');
    expect(enqueue).not.toHaveBeenCalled();
    await expect(service.executeChecked(b.id, {})).rejects.toThrow('确认');
    const executed = await service.executeChecked(b.id, {
      account: true,
      content: true,
      schedule: true,
    });
    expect(executed.batch.status).toBe('publishing');
    expect(enqueue).toHaveBeenCalledOnce();
  });
  it('blocks execution on connection failure and if the plan changes during the check', async () => {
    const b = await ready(true);
    request.mockRejectedValueOnce(new Error('connection refused'));
    expect((await service.preflight(b.id)).canExecute).toBe(false);
    request.mockImplementationOnce(async () => {
      service.updateVariants(
        b.id,
        b.variants.map((v) => ({ ...v, title: 'Changed' })),
      );
      return new Response(JSON.stringify({ code: 0, data: { status: 'Active' } }));
    });
    await expect(
      service.executeChecked(b.id, { account: true, content: true, schedule: true }),
    ).rejects.toThrow('变更');
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('exposes plan management through API routes', async () => {
    const b = service.create();
    const app = sopRoutes(service);
    const send = (path: string, body: unknown, method = 'POST') =>
      app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await send(`/batches/${b.id}/owner`, { owner: '小李' }, 'PUT')).status).toBe(200);
    const res = await send(`/batches/${b.id}/duplicate`, { weekOf: '2026-09-22' });
    expect(res.status).toBe(201);
    expect((await res.json()).batch.owner).toBe('小李');
    expect((await send(`/batches/${b.id}/cancel`, { note: '活动暂停' })).status).toBe(200);
  });
});

describe('SOP notification lifecycle', () => {
  const enable = () => {
    vi.stubEnv('OPS_FEISHU_WEBHOOK_URL', 'https://open.feishu.cn/open-apis/bot/v2/hook/test');
    service.notificationSettings({ enabled: true, recipientLabel: '运营群' });
  };
  it('defaults off and never inherits the legacy webhook', async () => {
    vi.stubEnv('FEISHU_WEBHOOK_URL', 'https://open.feishu.cn/open-apis/bot/v2/hook/legacy');
    const b = await ready();
    now = new Date('2026-09-14T03:00:00Z');
    await service.tick();
    expect(service.overview().notifications.configured).toBe(false);
    expect(service.overview().notifications.records).toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
    expect(service.get(b.id).status).toBe('ready');
  });
  it('notifies once per due plan and persists success across restart', async () => {
    enable();
    const b = await ready();
    service.assignOwner(b.id, '小王');
    now = new Date('2026-09-14T03:00:00Z');
    request.mockResolvedValue(new Response('{"code":0}'));
    await service.tick();
    await service.tick();
    expect(request).toHaveBeenCalledOnce();
    const options = request.mock.calls[0][1]!;
    expect(String(options.body)).toContain('小王');
    expect(service.overview().notifications.records[0].status).toBe('sent');
    const restarted = new SopService(dir, () => now, request, enqueue);
    await restarted.tick();
    expect(request).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('shows delivery failures, retries at most three times, and stops pending messages when disabled', async () => {
    enable();
    await ready();
    now = new Date('2026-09-14T03:00:00Z');
    request.mockImplementation(async () => new Response('{"code":19024}'));
    await service.tick();
    expect(service.overview().notifications.records[0].status).toBe('failed');
    await service.tick();
    expect(request).toHaveBeenCalledOnce();
    for (let i = 0; i < 3; i++) {
      now = new Date(now.getTime() + 300_000);
      await service.tick();
    }
    expect(request).toHaveBeenCalledTimes(3);
    service.notificationSettings({ enabled: false, recipientLabel: '运营群' });
    expect(service.overview().notifications.records[0].status).toBe('cancelled');
  });
  it('queues execution and report events, with no raw error details in messages', async () => {
    enable();
    const b = await ready(true);
    const run = service.publish(b.id);
    jobs.get(run.job.id)!.status = 'failed';
    jobs.get(run.job.id)!.error = 'secret-token-sensitive';
    service.syncJobs();
    expect(service.overview().notifications.records[0].title).toContain('执行失败');
    expect(service.overview().notifications.records[0].text).not.toContain('secret-token');
    service.cancel(b.id, { note: '已关闭', remoteCancelled: true });
    expect(service.overview().notifications.records[0].status).toBe('cancelled');
  });
});

describe('notification event coverage and cancellation', () => {
  function enableNotifications() {
    vi.stubEnv('OPS_FEISHU_WEBHOOK_URL', 'https://open.feishu.cn/open-apis/bot/v2/hook/test');
    service.notificationSettings({ enabled: true, recipientLabel: '运营群' });
  }
  it('queues a report and the next draft without publishing either', async () => {
    const b = await measured();
    enableNotifications();
    service.report(b.id);
    service.next(b.id);
    const records = service.overview().notifications.records;
    expect(records.map((r) => r.title)).toEqual(['下一周草稿已创建，请审核', '运营周报已生成']);
    expect(records.every((r) => r.status === 'pending')).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('cancels queued reminders when a draft is deleted or notifications are disabled', async () => {
    enableNotifications();
    const b = await ready();
    now = new Date('2026-09-14T03:00:00Z');
    request.mockRejectedValue(new Error('offline'));
    await service.tick();
    service.remove(b.id);
    expect(service.overview().notifications.records[0].status).toBe('cancelled');
    now = new Date(now.getTime() + 600_000);
    await service.tick();
    expect(request).toHaveBeenCalledOnce();
  });
  it('does not persist invalid per-plan settings or alter defaults', async () => {
    const b = await ready();
    const before = readFileSync(join(dir, 'state.json'), 'utf8');
    expect(() => service.updateSettings(b.id, { ...b.settings, sendTime: '99:00' })).toThrow(
      '时间',
    );
    expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(before);
  });
});

describe('predicted-time reminders', () => {
  it('reminds before the UTC date starts, rather than waiting until the observation start at day end', async () => {
    vi.stubEnv('OPS_FEISHU_WEBHOOK_URL', 'https://open.feishu.cn/open-apis/bot/v2/hook/test');
    service.notificationSettings({ enabled: true, recipientLabel: '运营群' });
    await ready(true);
    now = new Date('2026-09-14T06:00:00Z');
    request.mockImplementation(async () => new Response('{"code":0}'));
    await service.tick();
    expect(request).toHaveBeenCalledOnce();
    expect(service.overview().notifications.records[0].title).toContain('即将到期');
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('permanent recycle bin deletion', () => {
  it('removes only the trashed plan and its artifacts, and cannot restore after restart', async () => {
    const b = await ready();
    const kept = service.duplicate(b.id, '2026-09-22');
    service.prepare(kept.id);
    service.remove(b.id);
    expect(service.purgeTrash([b.id])).toEqual({ purgedIds: [b.id], failed: [] });
    expect(existsSync(join(dir, 'artifacts', b.id))).toBe(false);
    expect(existsSync(join(dir, 'artifacts', kept.id, 'content.csv'))).toBe(true);
    expect(service.get(kept.id).csvTemplate).toEqual(b.csvTemplate);
    const restarted = new SopService(dir, () => now, request, enqueue);
    expect(restarted.overview().deletedBatches).toHaveLength(0);
    expect(() => restarted.restore(b.id)).toThrow('不存在');
    expect(restarted.purgeTrash([b.id])).toEqual({ purgedIds: [], failed: [] });
    expect(request).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('rejects active or restored records before deleting any confirmed target', async () => {
    const b = await ready();
    const restored = service.duplicate(b.id, '2026-09-22');
    service.remove(b.id);
    service.remove(restored.id);
    service.restore(restored.id);
    expect(() => service.purgeTrash([b.id, restored.id])).toThrow('状态已变化');
    expect(service.overview().deletedBatches).toHaveLength(1);
    expect(existsSync(join(dir, 'artifacts', b.id, 'content.csv'))).toBe(true);
    expect(service.get(restored.id).status).toBe('draft');
  });
  it('clears the confirmed snapshot, preserving plans trashed after confirmation', () => {
    const first = service.create();
    const second = service.duplicate(first.id, '2026-09-22');
    service.remove(first.id);
    const confirmed = service.overview().deletedBatches!.map((b) => b.id);
    service.remove(second.id);
    expect(service.purgeTrash(confirmed).purgedIds).toEqual([first.id]);
    expect(service.overview().deletedBatches!.map((b) => b.id)).toEqual([second.id]);
    expect(service.purgeTrash([second.id]).failed).toHaveLength(0);
    expect(service.overview().deletedBatches).toHaveLength(0);
  });
  it('rejects invalid IDs and never treats an omitted list as permission to clear everything', () => {
    const b = service.create();
    service.remove(b.id);
    expect(() => service.purgeTrash(undefined)).toThrow('有效');
    expect(() => service.purgeTrash(['../../outside'])).toThrow('有效');
    expect(() => service.purgeTrash([null])).toThrow('有效');
    expect(service.overview().deletedBatches).toHaveLength(1);
  });
  it('keeps a permanent deletion marker on the parent so scheduled work cannot recreate the next draft', async () => {
    const parent = await measured();
    service.report(parent.id);
    service.settings({ ...service.overview().settings, autoNextDraft: true });
    const child = service.next(parent.id);
    service.remove(child.id);
    service.purgeTrash([child.id]);
    expect(service.get(parent.id).nextBatchId).toBeUndefined();
    expect(service.get(parent.id).nextBatchDiscardedAt).toBeTruthy();
    const restarted = new SopService(dir, () => now, request, enqueue);
    await restarted.tick();
    expect(restarted.overview().batches).toHaveLength(1);
    expect(restarted.overview().scheduler.error).toBeUndefined();
    expect(() => restarted.next(parent.id)).toThrow('永久删除');
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('offers single and bulk permanent deletion endpoints with the same protections', async () => {
    const a = service.create();
    const b = service.duplicate(a.id, '2026-09-22');
    const app = sopRoutes(service);
    expect((await app.request(`/trash/${a.id}`, { method: 'DELETE' })).status).toBe(409);
    service.remove(a.id);
    expect((await app.request(`/trash/${a.id}`, { method: 'DELETE' })).status).toBe(200);
    service.remove(b.id);
    const response = await app.request('/trash', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [b.id] }),
    });
    expect(await response.json()).toEqual({ purgedIds: [b.id], failed: [] });
    expect(service.overview().deletedBatches).toHaveLength(0);
  });
});
