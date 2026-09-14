export type JobType = 'prepare' | 'check' | 'run';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  args?: string[];
  log: string;
  error?: string;
  exitCode?: number | null;
}

export const API_TOKEN_KEY = 'fbgame.ops.token';

export async function authorizedFetch(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  const token = sessionStorage.getItem(API_TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(path, { ...init, headers });
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authorizedFetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data;
}

export function sopRequest<T>(path = '', body?: unknown, method = 'POST') {
  return api<T>(
    `/api/sop${path}`,
    body === undefined
      ? undefined
      : {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
}

export async function downloadSopFile(path: string, filename: string) {
  const response = await authorizedFetch(`/api/sop${path}`);
  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `下载失败（${response.status}）`);
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function getHealth() {
  return api<{ ok: boolean; contentDir: string; repoRoot: string }>('/api/health');
}

export function uploadFiles(files: File[]) {
  const fd = new FormData();
  for (const f of files) fd.append('file', f);
  return api<{ saved: { savedAs: string; bytes: number }[]; hint: string }>('/api/files/upload', {
    method: 'POST',
    body: fd,
  });
}

export function clearCampaignFiles() {
  return api<{ deleted: string[]; count: number }>('/api/files/campaigns', {
    method: 'DELETE',
  });
}

export function createJob(type: JobType, args: string[] = []) {
  return api<{ job: Job }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, args }),
  });
}

export function getJob(id: string) {
  return api<{ job: Job }>(`/api/jobs/${id}`);
}

export function listJobs() {
  return api<{ jobs: Job[] }>('/api/jobs');
}
