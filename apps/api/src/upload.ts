/** 上传 / 清理 campaigns 下的内容表与排期表 CSV */
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { REPO_ROOT } from './runner.js';

const CONTENT_SUBDIR = process.env['CONTENT_SUBDIR'] || '推送配置表';

export function contentDir(): string {
  const dir = join(REPO_ROOT, 'campaigns', CONTENT_SUBDIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function scheduleDir(): string {
  const dir = join(REPO_ROOT, 'campaigns', 'schedule');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface SavedFile {
  originalName: string;
  savedAs: string;
  bytes: number;
}

/**
 * 保存上传的 CSV。文件名保持原样（需形如「推送配置表 - XXX.csv」以便发现 campaign）。
 * 仅允许 .csv，防止乱传。
 */
export function saveUploadedCsv(filename: string, data: Uint8Array | Buffer): SavedFile {
  const safe = basename(filename).replace(/[/\\]/g, '');
  if (!safe.toLowerCase().endsWith('.csv')) {
    throw new Error(`仅支持 .csv 文件：${safe}`);
  }
  const dir = contentDir();
  const dest = join(dir, safe);
  writeFileSync(dest, data);
  return { originalName: filename, savedAs: safe, bytes: data.byteLength };
}

/** 清空内容表目录与排期目录中的文件（不限扩展名；子目录保留，避免误删备份）。 */
export function clearCampaignFiles(): { deleted: string[] } {
  const deleted: string[] = [];
  for (const dir of [contentDir(), scheduleDir()]) {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (!statSync(abs).isFile()) continue;
      unlinkSync(abs);
      deleted.push(relative(REPO_ROOT, abs));
    }
  }
  return { deleted };
}
