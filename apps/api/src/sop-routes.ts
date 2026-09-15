import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { SopError, SopService } from './sop-service.js';

export function sopRoutes(service: SopService) {
  const app = new Hono();
  app.use(
    '*',
    bodyLimit({
      maxSize: 2_100_000,
      onError: (c) => c.json({ error: '请求数据不能超过 2MB' }, 413),
    }),
  );
  app.onError((error, c) => {
    if (error instanceof SopError) return c.json({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return c.json({ error: '请求 JSON 格式错误' }, 400);
    return c.json({ error: error.message || '操作失败' }, 400);
  });
  app.get('/', (c) => c.json(service.overview()));
  app.delete('/trash/:id', (c) => c.json(service.purgeTrash([c.req.param('id')])));
  app.delete('/trash', async (c) => c.json(service.purgeTrash((await c.req.json()).ids)));
  app.put('/settings', async (c) => c.json({ settings: service.settings(await c.req.json()) }));
  app.put('/notifications', async (c) =>
    c.json({ notifications: service.notificationSettings(await c.req.json()) }),
  );
  app.post('/batches', async (c) => c.json({ batch: service.create(await c.req.json()) }, 201));
  app.get('/batches/:id', (c) => c.json({ batch: service.get(c.req.param('id')) }));
  app.delete('/batches/:id', (c) => {
    service.remove(c.req.param('id'));
    return c.json({ deleted: true });
  });
  app.post('/batches/:id/restore', (c) => c.json({ batch: service.restore(c.req.param('id')) }));
  app.put('/batches/:id/settings', async (c) =>
    c.json({ batch: service.updateSettings(c.req.param('id'), await c.req.json()) }),
  );
  app.put('/batches/:id/template', async (c) =>
    c.json({ batch: service.setTemplate(c.req.param('id'), await c.req.json()) }),
  );
  app.post('/batches/:id/generate', async (c) =>
    c.json({ batch: await service.generate(c.req.param('id'), (await c.req.json()).mode) }),
  );
  app.put('/batches/:id/variants', async (c) =>
    c.json({ batch: service.updateVariants(c.req.param('id'), (await c.req.json()).variants) }),
  );
  app.post('/batches/:id/prepare', (c) => c.json({ batch: service.prepare(c.req.param('id')) }));
  app.post('/batches/:id/preflight', async (c) =>
    c.json(await service.preflight(c.req.param('id'))),
  );
  app.post('/batches/:id/publish', async (c) =>
    c.json(await service.executeChecked(c.req.param('id'), await c.req.json()), 202),
  );
  app.post('/batches/:id/duplicate', async (c) =>
    c.json({ batch: service.duplicate(c.req.param('id'), (await c.req.json()).weekOf) }, 201),
  );
  app.put('/batches/:id/owner', async (c) =>
    c.json({ batch: service.assignOwner(c.req.param('id'), (await c.req.json()).owner) }),
  );
  app.post('/batches/:id/cancel', async (c) =>
    c.json({ batch: service.cancel(c.req.param('id'), await c.req.json()) }),
  );
  app.post('/batches/:id/retry', async (c) =>
    c.json(service.retry(c.req.param('id'), (await c.req.json()).note), 202),
  );
  app.post('/batches/:id/verify', async (c) =>
    c.json({ batch: service.verify(c.req.param('id'), (await c.req.json()).note) }),
  );
  app.post('/batches/:id/metrics', async (c) =>
    c.json({ batch: service.importMetrics(c.req.param('id'), (await c.req.json()).csv) }),
  );
  app.post('/batches/:id/collect', async (c) =>
    c.json({ batch: await service.collect(c.req.param('id')) }),
  );
  app.post('/batches/:id/report', (c) => c.json({ batch: service.report(c.req.param('id')) }));
  app.post('/batches/:id/next', (c) => c.json({ batch: service.next(c.req.param('id')) }));
  app.get('/batches/:id/csv', (c) => {
    const kind = c.req.query('kind') || 'plan';
    const contents = service.exportCsv(c.req.param('id'), kind);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${c.req.param('id')}-${kind}.csv"`);
    return c.body(contents);
  });
  app.get('/batches/:id/report/download', (c) => {
    const batch = service.get(c.req.param('id'));
    if (!batch.report) throw new SopError('周报尚未生成', 404);
    c.header('Content-Type', 'text/markdown; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="report-${batch.weekOf}.md"`);
    return c.body(batch.report.markdown);
  });
  return app;
}
