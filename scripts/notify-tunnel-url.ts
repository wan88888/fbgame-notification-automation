/** 隧道公网地址变化时发飞书。用法：npx tsx scripts/notify-tunnel-url.ts <url> */
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notifyFeishuTunnelUrl } from '../src/notify.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: resolve(root, '.env') });

const url = (process.argv[2] || '').trim();
if (!url) {
  console.error('usage: notify-tunnel-url.ts <https://...trycloudflare.com>');
  process.exit(1);
}

await notifyFeishuTunnelUrl(
  {
    webhookUrl: process.env['FEISHU_TUNNEL_WEBHOOK_URL'] || '',
    signSecret: process.env['FEISHU_TUNNEL_SIGN_SECRET'] || '',
    timeoutMs: Number(process.env['FEISHU_TIMEOUT_MS'] || 10000),
  },
  url,
);
