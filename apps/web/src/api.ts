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

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  }
  return data;
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
