export type Theme = 'recall' | 'reward' | 'challenge';
export type BatchStatus =
  'draft' | 'ready' | 'publishing' | 'verification' | 'scheduled' | 'failed' | 'reported';

export interface SopSettings {
  projectKey: string;
  timezone: 'Asia/Shanghai' | 'UTC';
  sendTime: string;
  timingMode: 'fixed' | 'predicted';
  language: string;
  audience: string;
  brief: string;
  themes: Theme[];
  variants: number;
  minSample: number;
  autoCollect: boolean;
  autoNextDraft: boolean;
  observationHours?: number;
}
export interface CopyVariant {
  id: string;
  label: string;
  theme: Theme;
  title: string;
  body: string;
  selected: boolean;
  origin: 'ai' | 'template' | 'manual';
}
export interface MetricRow {
  label: string;
  sent: number;
  opened: number | null;
  clicked: number | null;
  recalled: number | null;
  recallEligible: number | null;
  windowHours: number;
}
export interface Performance extends MetricRow {
  title: string;
  theme: Theme;
  openRate: number | null;
  ctr: number | null;
  recallRate: number | null;
  decision: 'retain' | 'retire' | 'test';
  reason: string;
}
export interface WeeklyReport {
  generatedAt: string;
  totals: {
    sent: number;
    opened: number | null;
    clicked: number | null;
    recalled: number | null;
    recallEligible: number | null;
    openRate: number | null;
    ctr: number | null;
    recallRate: number | null;
  };
  performance: Performance[];
  recommendations: string[];
  markdown: string;
}
export interface AuditEvent {
  at: string;
  action: string;
  detail: string;
}
export interface SopBatch {
  id: string;
  name: string;
  projectKey: string;
  projectName: string;
  weekOf: string;
  scheduledAt: string;
  settings: SopSettings;
  status: BatchStatus;
  variants: CopyVariant[];
  createdAt: string;
  updatedAt: string;
  jobId?: string;
  error?: string;
  verificationNote?: string;
  metrics: MetricRow[];
  metricsSource?: string;
  metricsUpdatedAt?: string;
  report?: WeeklyReport;
  parentId?: string;
  nextBatchId?: string;
  csvTemplate?: { columns: string[]; values: string[]; titleColumn: string; bodyColumn: string };
  audit: AuditEvent[];
}
export interface SopOverview {
  settings: SopSettings;
  projects: { key: string; name: string }[];
  capabilities: {
    ai: boolean;
    metrics: boolean;
    fixedTime: boolean;
    publish: boolean;
    adspower: boolean;
  };
  batches: SopBatch[];
  scheduler: { running: boolean; intervalSeconds: number; lastTick?: string; error?: string };
}
