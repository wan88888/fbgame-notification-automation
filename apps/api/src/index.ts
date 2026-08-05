/**
 * 运营控制台 API（方案 A：执行机本机跑自动化，运营用浏览器遥控）。
 *
 * 启动：在仓库根目录  npm run ops:api
 * 默认监听 http://0.0.0.0:8787
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createJob, getJob, listJobs, type JobType } from './jobs.js';
import { enqueueJob, REPO_ROOT } from './runner.js';
import { contentDir, saveUploadedCsv } from './upload.js';

const PORT = Number(process.env['OPS_API_PORT'] || 8787);
const TOKEN = (process.env['OPS_API_TOKEN'] || '').trim();

const app = new Hono();

app.use(
  '*',
  cors({
    origin: (origin) => origin || '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }),
);

/** 可选简单鉴权：配置了 OPS_API_TOKEN 则要求 Bearer。 */
app.use('/api/*', async (c, next) => {
  if (!TOKEN) return next();
  const auth = c.req.header('Authorization') || '';
  if (auth === `Bearer ${TOKEN}`) return next();
  return c.json({ error: 'unauthorized' }, 401);
});

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    repoRoot: REPO_ROOT,
    contentDir: contentDir(),
    time: new Date().toISOString(),
  }),
);

app.get('/api/jobs', (c) => c.json({ jobs: listJobs(30) }));

app.get('/api/jobs/:id', (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) return c.json({ error: 'not found' }, 404);
  return c.json({ job });
});

app.post('/api/jobs', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    type?: string;
    args?: string[];
  };
  const type = body.type as JobType | undefined;
  if (type !== 'prepare' && type !== 'check' && type !== 'run') {
    return c.json({ error: 'type 必须是 prepare | check | run' }, 400);
  }
  const args = Array.isArray(body.args)
    ? body.args.filter((a): a is string => typeof a === 'string')
    : [];
  const job = createJob(type, args);
  enqueueJob(job);
  return c.json({ job }, 202);
});

/**
 * multipart 上传一个或多个 .csv（字段名 file 可重复）。
 * 落盘到 campaigns/推送配置表/
 */
app.post('/api/files/upload', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = body['file'];
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(
    (f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f,
  );
  if (files.length === 0) {
    return c.json({ error: '请用 multipart 字段 file 上传至少一个 .csv' }, 400);
  }

  const saved = [];
  for (const f of files) {
    const buf = Buffer.from(await f.arrayBuffer());
    saved.push(saveUploadedCsv(f.name || 'upload.csv', buf));
  }
  return c.json({
    saved,
    contentDir: contentDir(),
    hint: '上传后建议先点「准备（修复+排期+体检）」，全部通过再「开始推送」。',
  });
});

console.log(`[ops-api] repo root: ${REPO_ROOT}`);
console.log(`[ops-api] listening on http://0.0.0.0:${PORT}`);
if (TOKEN) console.log('[ops-api] OPS_API_TOKEN 已启用');

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' });
