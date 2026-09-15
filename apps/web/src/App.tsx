import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Steps,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  ArrowRightOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  DeleteOutlined,
  FileTextOutlined,
  HistoryOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { CopyVariant, SopBatch, SopOverview, SopSettings, Theme } from '../../shared/sop';
import { API_TOKEN_KEY, downloadSopFile, getJob, sopRequest, type Job } from './api';
const LegacyConsole = lazy(() => import('./LegacyConsole'));
import { Status, PlanList } from './components/PlanList';
import { PlanActions } from './components/PlanActions';
import { PlanSettings } from './components/PlanSettings';
import { TrashDialog } from './components/TrashDialog';
import { ExecutionChecklist } from './components/ExecutionChecklist';
import { NotificationSettings } from './components/NotificationSettings';
import { nextAction } from '../../shared/sop-guidance';

const { Text, Paragraph } = Typography;
type View = 'overview' | 'copy' | 'results' | 'settings' | 'legacy';
const themes: Record<Theme, string> = {
  recall: '玩家召回',
  reward: '奖励激励',
  challenge: '关卡挑战',
};
const percent = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(2)}%`);
const count = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('zh-CN'));
const time = (v: string) => new Date(v).toLocaleString('zh-CN', { hour12: false });
function nextDate() {
  const d = new Date();
  d.setDate(d.getDate() + ((2 - d.getDay() + 7) % 7 || 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="sop-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export default function App() {
  const { message, modal } = AntdApp.useApp();
  const [view, setView] = useState<View>('overview');
  const [data, setData] = useState<SopOverview>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [id, setId] = useState(sessionStorage.getItem('sop.batch') || '');
  const [drafts, setDrafts] = useState<CopyVariant[]>([]);
  const [settings, setSettings] = useState<SopSettings>();
  const [job, setJob] = useState<Job>();
  const [createOpen, setCreateOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [project, setProject] = useState('');
  const [date, setDate] = useState(nextDate());
  const [newOwner, setNewOwner] = useState('');
  const previousVariants = useRef({ id: '', value: '[]' });
  const [note, setNote] = useState('');
  const [metrics, setMetrics] = useState('');
  const [template, setTemplate] = useState('');
  const [titleColumn, setTitleColumn] = useState('');
  const [bodyColumn, setBodyColumn] = useState('');
  const [token, setToken] = useState(sessionStorage.getItem(API_TOKEN_KEY) || '');
  const batch = data?.batches.find((b) => b.id === id);
  const editable = !!batch && ['draft', 'ready'].includes(batch.status) && !batch.jobId;
  const dirty = batch ? JSON.stringify(drafts) !== JSON.stringify(batch.variants) : false;
  const refresh = useCallback(async () => {
    try {
      const value = await sopRequest<SopOverview>();
      setData(value);
      setError('');
      setId((current) =>
        value.batches.some((b) => b.id === current) ? current : value.batches[0]?.id || '',
      );
      setSettings((current) => current ?? value.settings);
      setProject((current) => current || value.settings.projectKey);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [refresh]);
  useEffect(() => {
    sessionStorage.setItem('sop.batch', id);
    setMetrics('');
    setTemplate('');
    setNote('');
  }, [id]);
  const variantsKey = JSON.stringify(batch?.variants ?? []);
  useEffect(() => {
    const previous = previousVariants.current;
    const next = JSON.parse(variantsKey) as CopyVariant[];
    setDrafts((current) =>
      previous.id !== id || JSON.stringify(current) === previous.value ? next : current,
    );
    previousVariants.current = { id, value: variantsKey };
  }, [id, variantsKey]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (!batch?.jobId) {
      setJob(undefined);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = () =>
      getJob(batch.jobId!)
        .then((r) => {
          if (alive) setJob(r.job);
          if (['succeeded', 'failed'].includes(r.job.status) && timer) clearInterval(timer);
        })
        .catch(() => undefined);
    void load();
    timer = setInterval(() => void load(), 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [batch?.jobId]);

  async function act(path: string, body: unknown, label: string, method = 'POST') {
    setBusy(label);
    try {
      const res = await sopRequest<{ batch?: SopBatch; settings?: SopSettings }>(
        path,
        body,
        method,
      );
      if (res.batch) {
        setId(res.batch.id);
        if (path.endsWith('/variants') || path.endsWith('/generate')) setDrafts(res.batch.variants);
      }
      if (res.settings) setSettings(res.settings);
      await refresh();
      message.success(label + '完成');
      return res;
    } catch (e) {
      message.error((e as Error).message);
      return undefined;
    } finally {
      setBusy('');
    }
  }
  async function download(kind: 'content' | 'schedule' | 'plan' | 'report') {
    if (!batch) return;
    try {
      await downloadSopFile(
        `/batches/${id}/${kind === 'report' ? 'report/download' : `csv?kind=${kind}`}`,
        `${batch.weekOf}-${kind}.${kind === 'report' ? 'md' : 'csv'}`,
      );
    } catch (e) {
      message.error((e as Error).message);
    }
  }
  const path = `/batches/${id}`;
  const changeCopy = (copyId: string, patch: Partial<CopyVariant>) =>
    setDrafts((current) => current.map((v) => (v.id === copyId ? { ...v, ...patch } : v)));
  function selectBatch(next: string) {
    const change = () => setId(next);
    if (dirty)
      modal.confirm({
        title: '文案有未保存修改',
        content: '切换批次将放弃当前未保存的修改。',
        okText: '切换',
        cancelText: '继续编辑',
        onOk: change,
      });
    else change();
  }
  function generate(mode: 'ai' | 'template') {
    const run = () => act(`${path}/generate`, { mode }, mode === 'ai' ? 'AI 生成' : '模板生成');
    if (drafts.length)
      modal.confirm({
        title: '重新生成会替换当前候选文案',
        content: '已有候选及未保存的编辑将被替换。',
        okText: '重新生成',
        cancelText: '保留文案',
        onOk: async () => {
          if (!(await run())) throw new Error('生成失败');
        },
      });
    else void run();
  }
  const guidance = batch ? nextAction(batch) : undefined;
  const completedReports = data?.batches.filter((b) => b.report) ?? [];
  const latestReport = batch?.report;
  const step = !batch
    ? 0
    : {
        draft: batch.variants.length ? 1 : 0,
        ready: 2,
        publishing: 2,
        verification: 3,
        failed: 2,
        scheduled: 4,
        reported: 5,
        cancelled: -1,
      }[batch.status];
  const nav = [
    { key: 'overview', label: '运营工作台', icon: <BarChartOutlined /> },
    { key: 'copy', label: '文案与排期', icon: <FileTextOutlined /> },
    { key: 'legacy', label: '旧版执行工具', icon: <HistoryOutlined /> },
    { key: 'results', label: '效果与周报', icon: <CalendarOutlined /> },
    { key: 'settings', label: '平台设置', icon: <SettingOutlined /> },
  ] as const;

  const noBatch = (
    <Card>
      <Empty description="还没有推送批次，从一个周二计划开始。">
        <Button type="primary" onClick={() => setCreateOpen(true)}>
          创建推送计划
        </Button>
      </Empty>
    </Card>
  );
  const settingsFields = settings && (
    <div className="form-grid">
      <Field label="默认游戏">
        <Select
          value={settings.projectKey}
          options={data?.projects.map((p) => ({ value: p.key, label: p.name }))}
          onChange={(v) => setSettings({ ...settings, projectKey: v })}
        />
      </Field>
      <Field
        label="发送模式"
        hint="固定时刻需在 Facebook 人工设置并核验；自动执行仅支持最佳时间策略。"
      >
        <Select
          value={settings.timingMode}
          options={[
            { value: 'fixed', label: '每周二 · 固定时刻（人工后台排期）' },
            { value: 'predicted', label: '每周二 · Predicted Best Time（UTC 日期）' },
          ]}
          onChange={(v) => setSettings({ ...settings, timingMode: v })}
        />
      </Field>
      <Field label="固定发送时刻">
        <Input
          type="time"
          value={settings.sendTime}
          disabled={settings.timingMode !== 'fixed'}
          onChange={(e) => setSettings({ ...settings, sendTime: e.target.value })}
        />
      </Field>
      <Field label="固定时刻的时区">
        <Select
          value={settings.timezone}
          disabled={settings.timingMode !== 'fixed'}
          options={[
            { value: 'Asia/Shanghai', label: '北京时间 · UTC+8' },
            { value: 'UTC', label: 'UTC' },
          ]}
          onChange={(v) => setSettings({ ...settings, timezone: v })}
        />
      </Field>
      <Field label="文案语言" hint="模板生成仅支持 English / 简体中文；其他语言使用 AI。">
        <Input
          value={settings.language}
          onChange={(e) => setSettings({ ...settings, language: e.target.value })}
        />
      </Field>
      <Field label="候选文案数量">
        <InputNumber
          min={1}
          max={6}
          value={settings.variants}
          onChange={(v) => setSettings({ ...settings, variants: v ?? 3 })}
        />
      </Field>
      <Field label="目标人群" hint="用于文案与效果比较；不会自动配置 Facebook 的受众筛选。">
        <Input
          value={settings.audience}
          onChange={(e) => setSettings({ ...settings, audience: e.target.value })}
        />
      </Field>
      <Field label="最小有效样本">
        <InputNumber
          min={1}
          max={1000000}
          value={settings.minSample}
          onChange={(v) => setSettings({ ...settings, minSample: v ?? 100 })}
        />
      </Field>
      <Field
        label="自动复盘观察窗口（小时）"
        hint="默认 144 小时，可在下周二之前完成复盘。效果接口需返回相同窗口的数据。"
      >
        <InputNumber
          min={1}
          max={168}
          value={settings.observationHours ?? 144}
          onChange={(v) => setSettings({ ...settings, observationHours: v ?? 144 })}
        />
      </Field>
      <div className="span-two">
        <Field label="文案主题">
          <Checkbox.Group
            value={settings.themes}
            options={Object.entries(themes).map(([value, label]) => ({ value, label }))}
            onChange={(v) => setSettings({ ...settings, themes: v as Theme[] })}
          />
        </Field>
      </div>
      <div className="span-two">
        <Field
          label="活动信息与写作要求"
          hint="填入已确认的游戏特点、真实奖励和限制，AI 会据此生成。"
        >
          <Input.TextArea
            rows={3}
            value={settings.brief}
            onChange={(e) => setSettings({ ...settings, brief: e.target.value })}
            maxLength={4000}
            showCount
          />
        </Field>
      </div>
    </div>
  );

  return (
    <div className="platform">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <ThunderboltOutlined />
          </span>
          <div>
            PushLoop<small>游戏推送运营平台</small>
          </div>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {nav.map((item) => (
            <button
              key={item.key}
              className={view === item.key ? 'active' : ''}
              onClick={() => setView(item.key)}
            >
              {item.icon}
              {item.label}
              {view === item.key && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`connection-dot ${error ? 'offline' : ''}`} />
          {error ? '执行机连接异常' : data ? '执行机已连接' : '正在连接执行机'}
          <small>每周一次推送，每周一次进步。</small>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span>
            运营空间{' '}
            <span className="muted">
              / {nav.find((n) => n.key === view)?.label}
            </span>
          </span>
          <Space>
            <Button
              disabled={!data || !!busy}
              onClick={() => setTrashOpen(true)}
              icon={<DeleteOutlined />}
            >
              回收站{data?.deletedBatches?.length ? ` (${data.deletedBatches.length})` : ''}
            </Button>
            <Tag bordered={false}>WEEKLY SOP</Tag>
            <Button aria-label="刷新" icon={<ReloadOutlined />} onClick={() => void refresh()} />
          </Space>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">NOTIFICATION OPERATIONS</div>
              <h1>{nav.find((n) => n.key === view)?.label}</h1>
              <p>
                {view === 'overview'
                  ? '从一个好文案，到下一次更好的召回。'
                  : view === 'copy'
                    ? '生成、审核、排期，让每次触达都有据可查。'
                    : view === 'results'
                      ? '让真实的投放结果，指导下一周的内容。'
                      : view === 'settings'
                        ? '设置每周节奏，连接文案与效果服务。'
                        : '原有 CSV 批处理入口，独立于 SOP 批次。'}
              </p>
            </div>
            <Button
              type="primary"
              size="large"
              icon={<PlusOutlined />}
              disabled={!data || !!busy || dirty}
              title={dirty ? '请先保存文案' : undefined}
              onClick={() => setCreateOpen(true)}
            >
              创建推送计划
            </Button>
          </div>
          {error && (
            <Alert
              type="error"
              showIcon
              message="无法读取执行机数据"
              description={
                <>
                  <p>{error}</p>
                  <Space>
                    <Input.Password
                      aria-label="API 访问令牌"
                      placeholder="若已开启鉴权，输入 API Token"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                    <Button
                      onClick={() => {
                        sessionStorage.setItem(API_TOKEN_KEY, token);
                        void refresh();
                      }}
                    >
                      连接
                    </Button>
                  </Space>
                </>
              }
            />
          )}
          {!data && !error && (
            <div className="loading">
              <Spin size="large" />
            </div>
          )}
          {data && (
            <>
              {view !== 'settings' && view !== 'legacy' && (
                <div className="batch-toolbar">
                  <Space wrap>
                    <span className="muted">当前批次</span>
                    <Select
                      aria-label="当前批次"
                      showSearch
                      optionFilterProp="label"
                      disabled={!!busy}
                      className="batch-select"
                      value={batch?.id}
                      placeholder="选择推送批次"
                      options={data.batches.map((b) => ({ label: b.name, value: b.id }))}
                      onChange={selectBatch}
                    />
                    {batch && <Status value={batch.status} />}
                    {batch && (
                      <PlanActions
                        key={batch.id}
                        batch={batch}
                        busy={!!busy}
                        dirty={dirty}
                        act={act}
                      />
                    )}
                    {batch && (
                      <Button
                        danger
                        icon={<DeleteOutlined />}
                        disabled={!editable || !!busy}
                        title={
                          editable
                            ? '删除后可从回收站恢复'
                            : '已执行计划需保留记录，取消发送请到 Facebook 后台操作'
                        }
                        onClick={() =>
                          modal.confirm({
                            title: `删除计划「${batch.name}」？`,
                            content:
                              '计划将移入回收站，文案与文件可恢复。删除本地计划不会取消已经在 Facebook 设置的推送。',
                            okText: '移入回收站',
                            cancelText: '保留计划',
                            okType: 'danger',
                            onOk: async () => {
                              const result = await act(
                                `/batches/${batch.id}`,
                                {},
                                '删除计划',
                                'DELETE',
                              );
                              if (!result) throw new Error('删除失败，请查看错误提示');
                            },
                          })
                        }
                      >
                        删除计划
                      </Button>
                    )}
                  </Space>
                  {batch && (
                    <span className="muted">
                      {batch.weekOf} ·{' '}
                      {batch.settings.timingMode === 'fixed'
                        ? `${batch.settings.sendTime} ${batch.settings.timezone}`
                        : '最佳时间 · UTC 日期'}
                    </span>
                  )}
                </div>
              )}
              {batch && guidance && view !== 'settings' && view !== 'legacy' && (
                <Alert
                  showIcon
                  type={batch.error || batch.status === 'failed' ? 'warning' : 'info'}
                  message={guidance.title}
                  description={
                    <>
                      {guidance.detail}
                      <br />
                      <strong>当前结果依据：</strong>
                      {batch.metrics.length
                        ? '已导入效果数据（按来源统计）'
                        : batch.verificationNote
                          ? '运营人工核验，尚无发送数据'
                          : batch.jobId
                            ? '执行记录，尚未确认送达'
                            : '平台草稿或本地文件'}
                      {view !== guidance.view && (
                        <div>
                          <Button type="link" onClick={() => setView(guidance.view)}>
                            {guidance.action} →
                          </Button>
                        </div>
                      )}
                    </>
                  }
                />
              )}
              {view === 'overview' && (
                <>
                  <div className="stat-grid">
                    <div className="stat-card">
                      <span>推送批次</span>
                      <strong>{data.batches.length}</strong>
                      <small>所有周期累计</small>
                    </div>
                    <div className="stat-card">
                      <span>待处理批次</span>
                      <strong>
                        {
                          data.batches.filter((b) =>
                            ['ready', 'verification', 'failed'].includes(b.status),
                          ).length
                        }
                      </strong>
                      <small>执行、核验或异常处理</small>
                    </div>
                    <div className="stat-card">
                      <span>已完成复盘</span>
                      <strong>{completedReports.length}</strong>
                      <small>已关联真实效果数据</small>
                    </div>
                    <div className="stat-card accent">
                      <span>当前批次召回率</span>
                      <strong>{percent(latestReport?.totals.recallRate)}</strong>
                      <small>{latestReport ? '回流人数 / 可召回人数' : '等待真实效果数据'}</small>
                    </div>
                  </div>
                  <Card
                    className="flow-card"
                    title={
                      <>
                        <ThunderboltOutlined /> 每周运营闭环
                      </>
                    }
                    extra={<Tag color="green">周二推送</Tag>}
                  >
                    <Steps
                      responsive
                      current={step}
                      status={
                        batch?.status === 'cancelled'
                          ? 'wait'
                          : batch?.status === 'failed'
                            ? 'error'
                            : 'process'
                      }
                      items={[
                        '生成文案',
                        '审核与 CSV',
                        '后台执行',
                        '核验排期',
                        '收集数据',
                        '复盘迭代',
                      ].map((title) => ({ title }))}
                    />
                    <div className="flow-footer">
                      <Text type="secondary">
                        批次状态会随实际操作推进，排期核验完成不代表已送达。
                      </Text>
                      {batch?.status !== 'cancelled' && (
                        <Button type="link" onClick={() => setView(step >= 4 ? 'results' : 'copy')}>
                          继续当前流程 <ArrowRightOutlined />
                        </Button>
                      )}
                    </div>
                  </Card>
                  <div className="two-columns">
                    <Card
                      title="推送计划"
                      extra={<Text type="secondary">{data.batches.length} 个批次</Text>}
                    >
                      <PlanList
                        batches={data.batches}
                        disabled={!!busy || dirty}
                        onOpen={(next) => {
                          selectBatch(next);
                          setView('copy');
                        }}
                        onDelete={async (next) =>
                          Boolean(await act(`/batches/${next}`, {}, '删除计划', 'DELETE'))
                        }
                      />
                    </Card>
                    <Card title="连接与自动化">
                      <div className="connection-list">
                        {[
                          ['AI 文案服务', data.capabilities.ai],
                          ['效果数据接口', data.capabilities.metrics],
                          ['AdsPower 配置', data.capabilities.adspower],
                          [
                            '固定时刻 / Publish 自动化',
                            data.capabilities.fixedTime && data.capabilities.publish,
                          ],
                        ].map(([label, ready]) => (
                          <div key={String(label)}>
                            <span>{label}</span>
                            <Tag color={ready ? 'success' : 'default'}>
                              {ready ? '已配置' : '待接入'}
                            </Tag>
                          </div>
                        ))}
                      </div>
                      <Paragraph type="secondary">
                        固定时刻和独立 Publish
                        仍需后台联调。当前支持人工排期核验，以及已有最佳时间执行器。
                      </Paragraph>
                      <Button onClick={() => setView('settings')}>管理平台设置</Button>
                    </Card>
                  </div>
                  {batch && (
                    <Card title="操作轨迹">
                      <div className="audit-list">
                        {batch.audit
                          .slice(-6)
                          .reverse()
                          .map((e, i) => (
                            <div key={i}>
                              <span className="audit-dot" />
                              <div>
                                {e.detail}
                                <small>{time(e.at)}</small>
                              </div>
                            </div>
                          ))}
                      </div>
                    </Card>
                  )}
                </>
              )}
              {view === 'copy' &&
                (!batch ? (
                  noBatch
                ) : (
                  <>
                    {batch.error && (
                      <Alert
                        type="warning"
                        showIcon
                        message="本批次需要处理"
                        description={
                          <>
                            <p>{nextAction(batch).detail}</p>
                            <details>
                              <summary>技术详情（供管理员排查）</summary>
                              {batch.error}
                            </details>
                          </>
                        }
                      />
                    )}
                    <Card
                      title="01 / 生成与审核文案"
                      extra={
                        <Tag>
                          {batch.settings.language} · {batch.settings.audience}
                        </Tag>
                      }
                    >
                      <div className="section-intro">
                        <p>多个候选，一条发送。未选文案保留用于后续测试。</p>
                        <Space wrap>
                          <Button
                            loading={busy === 'AI 生成'}
                            disabled={!editable || !!busy || !data.capabilities.ai}
                            icon={<ThunderboltOutlined />}
                            onClick={() => generate('ai')}
                          >
                            AI 生成文案
                          </Button>
                          <Button
                            disabled={!editable || !!busy}
                            onClick={() => generate('template')}
                          >
                            使用模板（非 AI）
                          </Button>
                        </Space>
                      </div>
                      {!data.capabilities.ai && (
                        <Paragraph type="secondary">
                          AI 服务未配置，可先用模板起稿或在模板上手动编辑。
                        </Paragraph>
                      )}
                      {!drafts.length ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description="先生成一组文案，再编辑并选择本周发送内容。"
                        />
                      ) : (
                        <div className="copy-grid">
                          {drafts.map((v, i) => (
                            <div className={`copy-card ${v.selected ? 'selected' : ''}`} key={v.id}>
                              <div className="copy-head">
                                <Tag color={v.selected ? 'green' : 'default'}>
                                  {themes[v.theme]}
                                </Tag>
                                <span className="muted">
                                  {v.origin === 'ai'
                                    ? 'AI 生成'
                                    : v.origin === 'template'
                                      ? '模板起稿'
                                      : '人工编辑'}{' '}
                                  · 0{i + 1}
                                </span>
                              </div>
                              <Field label="标题">
                                <Input
                                  maxLength={80}
                                  value={v.title}
                                  disabled={!editable || !!busy}
                                  onChange={(e) => changeCopy(v.id, { title: e.target.value })}
                                />
                              </Field>
                              <Field label="正文">
                                <Input.TextArea
                                  maxLength={500}
                                  showCount
                                  rows={4}
                                  value={v.body}
                                  disabled={!editable || !!busy}
                                  onChange={(e) => changeCopy(v.id, { body: e.target.value })}
                                />
                              </Field>
                              <div className="copy-footer">
                                <small>{v.label}</small>
                                <Checkbox
                                  checked={v.selected}
                                  disabled={!editable || !!busy}
                                  onChange={() =>
                                    setDrafts((current) =>
                                      current.map((c) => ({ ...c, selected: c.id === v.id })),
                                    )
                                  }
                                >
                                  本周发送
                                </Checkbox>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {!!drafts.length && (
                        <div className="section-actions">
                          <Button
                            type="primary"
                            disabled={!editable || !!busy || !dirty}
                            loading={busy === '保存文案'}
                            onClick={() =>
                              void act(`${path}/variants`, { variants: drafts }, '保存文案', 'PUT')
                            }
                          >
                            保存文案
                          </Button>
                          <Text type="secondary">
                            {dirty ? '有未保存修改，请先保存再准备 CSV。' : '当前文案已保存。'}
                          </Text>
                        </div>
                      )}
                    </Card>
                    {!!drafts.length && (
                      <Card
                        title="发送内容预览"
                        extra={<Tag>{dirty ? '未保存预览' : '已保存文案'}</Tag>}
                      >
                        <div className="notification-preview">
                          <span>{batch.projectName} · 游戏通知</span>
                          <h3>{drafts.find((v) => v.selected)?.title}</h3>
                          <p>{drafts.find((v) => v.selected)?.body}</p>
                        </div>
                        <Paragraph type="secondary">
                          {batch.weekOf} ·{' '}
                          {batch.settings.timingMode === 'fixed'
                            ? `${batch.settings.sendTime} ${batch.settings.timezone}`
                            : '最佳时间 · UTC 日期'}
                          。仅预览文字，实际图片和样式请在 Facebook 核对。
                        </Paragraph>
                      </Card>
                    )}
                    <Card title="02 / CSV 模板与排期">
                      <div className="two-columns plain">
                        <div>
                          <h3>Facebook 内容模板</h3>
                          <p className="muted">
                            首次使用请上传该游戏验证过的模板（表头和一条样例）。复制计划会继承模板；多语言映射由管理员在高级选项中设置。
                          </p>
                          {batch.csvTemplate && (
                            <Tag color="success">模板已保存 · {batch.csvTemplate.titleColumn}</Tag>
                          )}
                          <input
                            aria-label="上传 Facebook CSV 模板"
                            type="file"
                            accept=".csv"
                            disabled={!editable || !!busy}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                if (f.size > 2000000) {
                                  message.error('文件超过 2MB');
                                  return;
                                }
                                void f.text().then(setTemplate);
                              }
                            }}
                          />
                          <details>
                            <summary>高级：多语言模板字段映射</summary>
                            <div className="form-grid">
                              <Field label="标题列（单语言模板可留空）">
                                <Input
                                  value={titleColumn}
                                  placeholder="notification_title_English"
                                  disabled={!editable}
                                  onChange={(e) => setTitleColumn(e.target.value)}
                                />
                              </Field>
                              <Field label="正文列">
                                <Input
                                  value={bodyColumn}
                                  placeholder="notification_body_English"
                                  disabled={!editable}
                                  onChange={(e) => setBodyColumn(e.target.value)}
                                />
                              </Field>
                            </div>
                          </details>
                          <Button
                            disabled={!editable || !!busy || !template}
                            onClick={() =>
                              void act(
                                `${path}/template`,
                                {
                                  csv: template,
                                  titleColumn: titleColumn || undefined,
                                  bodyColumn: bodyColumn || undefined,
                                },
                                '保存模板',
                                'PUT',
                              )
                            }
                          >
                            保存模板
                          </Button>
                        </div>
                        <div className="schedule-panel">
                          <span className="eyebrow">SCHEDULE</span>
                          <h2>
                            {batch.weekOf} <small>周二</small>
                          </h2>
                          <p>
                            {batch.settings.timingMode === 'fixed'
                              ? `${batch.settings.sendTime} · ${batch.settings.timezone}`
                              : 'Predicted Best Time · UTC 日期'}
                          </p>
                          <p className="muted">
                            {batch.settings.timingMode === 'fixed'
                              ? '需要在 Facebook 手动设置准确时刻并核验。'
                              : '由 Facebook 在该 UTC 日期内选择发送时间，不承诺固定时分。'}
                          </p>
                          <PlanSettings
                            batch={batch}
                            disabled={!editable || !!busy || dirty}
                            act={act}
                          />
                        </div>
                      </div>
                      <div className="section-actions">
                        <Button
                          type="primary"
                          disabled={
                            !editable ||
                            !!busy ||
                            dirty ||
                            !batch.variants.length ||
                            !batch.csvTemplate
                          }
                          onClick={() => void act(`${path}/prepare`, {}, '准备 CSV')}
                        >
                          校验并准备 CSV
                        </Button>
                        <Button
                          icon={<DownloadOutlined />}
                          disabled={!batch.variants.length || dirty}
                          onClick={() => void download('plan')}
                        >
                          下载运营计划
                        </Button>
                        <Button
                          disabled={!batch.csvTemplate || !batch.variants.length || dirty}
                          onClick={() => void download('content')}
                        >
                          下载 FB 内容 CSV
                        </Button>
                        <Button
                          disabled={
                            !batch.variants.length || dirty || batch.settings.timingMode === 'fixed'
                          }
                          title={
                            batch.settings.timingMode === 'fixed'
                              ? '固定时刻请下载运营计划，并在 Facebook 人工设置'
                              : undefined
                          }
                          onClick={() => void download('schedule')}
                        >
                          下载排期表
                        </Button>
                      </div>
                    </Card>
                    <Card title="03 / 执行与后台核验">
                      <Alert
                        type="info"
                        showIcon
                        message={
                          batch.settings.timingMode === 'fixed'
                            ? '固定时刻采用人工后台排期'
                            : '已有执行器：打开后台 → 上传 → 日期与策略 → Save → Turn On'
                        }
                        description={
                          batch.settings.timingMode === 'fixed'
                            ? '下载内容 CSV 后在 Facebook 上传，设置日期和时刻、开启通知，并完成后台要求的 Publish。完成后在下方记录核验。'
                            : '请确认 AdsPower 已开启并登录正确账号。脚本完成后仍需核验；自动化不会把点击成功视为推送送达。'
                        }
                      />
                      <ExecutionChecklist
                        key={batch.id}
                        batch={batch}
                        dirty={dirty}
                        busy={!!busy}
                        onExecute={(checks) => act(`${path}/publish`, checks, '后台执行')}
                      />
                      {job && (
                        <details>
                          <summary>技术执行日志 · {job.status}</summary>
                          <pre className="log-box">{job.log || '等待执行机日志…'}</pre>
                        </details>
                      )}
                      {['ready', 'verification', 'failed'].includes(batch.status) && (
                        <div className="verification">
                          <Field
                            label="核验记录"
                            hint="请写明操作人、后台日期/策略、开启状态；固定时刻模式还需记录时区和 Publish 结果。"
                          >
                            <Input.TextArea
                              rows={2}
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              placeholder="已在 Facebook 核对……"
                            />
                          </Field>
                          <Button
                            disabled={!!busy || !note.trim() || dirty}
                            icon={<CheckCircleOutlined />}
                            onClick={() => void act(`${path}/verify`, { note }, '记录核验')}
                          >
                            已在 Facebook 完成排期，记录核验
                          </Button>
                          {batch.status === 'failed' &&
                            batch.settings.timingMode === 'predicted' && (
                              <div style={{ marginTop: 16 }}>
                                <Paragraph type="secondary">
                                  若只需重试编辑与开启，请先在后台确认同 label
                                  通知已存在，再填写核验记录。续跑不会重新上传 CSV。
                                </Paragraph>
                                <Button
                                  disabled={!!busy || !note.trim()}
                                  onClick={() => void act(`${path}/retry`, { note }, '安全续跑')}
                                >
                                  已确认通知存在，仅重试编辑与开启
                                </Button>
                              </div>
                            )}
                        </div>
                      )}
                      {batch.verificationNote && (
                        <Paragraph className="verification" type="secondary">
                          核验记录：{batch.verificationNote}
                        </Paragraph>
                      )}
                    </Card>
                  </>
                ))}
              {view === 'results' &&
                (!batch ? (
                  noBatch
                ) : (
                  <>
                    <div className="stat-grid">
                      {[
                        ['发送量', count(latestReport?.totals.sent)],
                        ['打开率', percent(latestReport?.totals.openRate)],
                        ['CTR', percent(latestReport?.totals.ctr)],
                        ['召回率', percent(latestReport?.totals.recallRate)],
                      ].map(([label, value]) => (
                        <div className="stat-card" key={label}>
                          <span>{label}</span>
                          <strong>{value}</strong>
                          <small>当前批次 · {batch.weekOf}</small>
                        </div>
                      ))}
                    </div>
                    <Card
                      title="04 / 回收真实效果数据"
                      extra={<Tag>{batch.metricsSource || '等待数据'}</Tag>}
                    >
                      <Paragraph type="secondary">
                        按 label 关联已选文案，导入会覆盖本批次数据，不重复累加。opened / clicked /
                        recalled 留空表示未知；召回率需要 recall_eligible。观察窗口结束后才可导入。
                      </Paragraph>
                      <div className="two-columns plain">
                        <div>
                          <Field label="粘贴或上传效果 CSV">
                            <Input.TextArea
                              rows={5}
                              value={metrics}
                              onChange={(e) => setMetrics(e.target.value)}
                              placeholder={`label,sent,opened,clicked,recalled,recall_eligible,window_hours\n${batch.variants.find((v) => v.selected)?.label || '文案label'},,,,,,${batch.settings.observationHours ?? 144}`}
                            />
                          </Field>
                          <input
                            aria-label="上传效果 CSV"
                            type="file"
                            accept=".csv"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) {
                                if (f.size > 2000000) {
                                  message.error('文件超过 2MB');
                                  return;
                                }
                                void f.text().then(setMetrics);
                              }
                            }}
                          />
                          <Space wrap>
                            <Button
                              type="primary"
                              disabled={
                                !!busy ||
                                !metrics.trim() ||
                                !['scheduled', 'reported'].includes(batch.status)
                              }
                              onClick={() =>
                                void act(`${path}/metrics`, { csv: metrics }, '导入效果')
                              }
                            >
                              导入效果 CSV
                            </Button>
                            <Button
                              disabled={
                                !!busy ||
                                !data.capabilities.metrics ||
                                !['scheduled', 'reported'].includes(batch.status)
                              }
                              onClick={() => void act(`${path}/collect`, {}, '同步效果')}
                            >
                              从接口同步
                            </Button>
                          </Space>
                        </div>
                        <div className="metric-explainer">
                          <h3>统一统计口径</h3>
                          <p>打开率 = 打开人数 / 发送量</p>
                          <p>CTR = 点击人数 / 发送量</p>
                          <p>召回率 = 回流人数 / 可召回人数</p>
                          <small>
                            人数需按文案和观察窗口去重。缺失值不会当作
                            0；不同窗口不直接比较。本计划建议窗口为{' '}
                            {batch.settings.observationHours ?? 144} 小时。
                          </small>
                        </div>
                      </div>
                      {batch.metrics.length > 0 && (
                        <Table
                          size="small"
                          rowKey="label"
                          pagination={false}
                          scroll={{ x: 650 }}
                          dataSource={batch.metrics}
                          columns={[
                            { title: '文案标签', dataIndex: 'label' },
                            { title: '发送', dataIndex: 'sent' },
                            { title: '打开', dataIndex: 'opened', render: count },
                            { title: '点击', dataIndex: 'clicked', render: count },
                            { title: '回流', dataIndex: 'recalled', render: count },
                            { title: '可召回', dataIndex: 'recallEligible', render: count },
                            { title: '窗口 / 小时', dataIndex: 'windowHours' },
                          ]}
                        />
                      )}
                    </Card>
                    <Card
                      title="05 / 每周复盘与下一轮测试"
                      extra={
                        <Button
                          disabled={!!busy || !batch.metrics.length}
                          onClick={() => void act(`${path}/report`, {}, '生成周报')}
                        >
                          生成 / 更新周报
                        </Button>
                      }
                    >
                      {!latestReport ? (
                        <Empty description="导入真实效果后，生成本周报告与策略建议。" />
                      ) : (
                        <>
                          <div className="report-summary">
                            <div>
                              <span className="eyebrow">WEEKLY REVIEW</span>
                              <h2>{batch.projectName} · 运营周报</h2>
                              <p className="muted">
                                {batch.weekOf} · 回流人数 {count(latestReport.totals.recalled)} ·{' '}
                                {time(latestReport.generatedAt)}
                              </p>
                            </div>
                            <Button
                              icon={<DownloadOutlined />}
                              onClick={() => void download('report')}
                            >
                              下载完整周报
                            </Button>
                          </div>
                          {latestReport.performance.map((p) => (
                            <div className="performance-row" key={p.label}>
                              <Tag
                                color={
                                  p.decision === 'retain'
                                    ? 'success'
                                    : p.decision === 'retire'
                                      ? 'orange'
                                      : 'blue'
                                }
                              >
                                {
                                  { retain: '建议保留', retire: '建议暂停', test: '继续测试' }[
                                    p.decision
                                  ]
                                }
                              </Tag>
                              <div>
                                <strong>{p.title}</strong>
                                <p>{p.reason}</p>
                              </div>
                            </div>
                          ))}
                          <details>
                            <summary>查看数据口径与全部建议</summary>
                            <ul>
                              {latestReport.recommendations.map((r, i) => (
                                <li key={i}>{r}</li>
                              ))}
                            </ul>
                          </details>
                          <div className="next-cycle">
                            <div>
                              <h3>把本周结论带入下一轮</h3>
                              <p>保留有证据支持的主题，减少低表现内容，建立新的测试草稿。</p>
                            </div>
                            <Button
                              type="primary"
                              disabled={!!busy || !!batch.nextBatchDiscardedAt}
                              title={
                                batch.nextBatchDiscardedAt
                                  ? '下一周草稿已永久删除；如需重新安排，请使用上方「复制计划」'
                                  : undefined
                              }
                              icon={<ArrowRightOutlined />}
                              onClick={() =>
                                void act(
                                  `${path}/next`,
                                  {},
                                  batch.nextBatchId ? '打开下一周草稿' : '创建下一周草稿',
                                ).then((r) => {
                                  if (r) setView('copy');
                                })
                              }
                            >
                              {batch.nextBatchDiscardedAt
                                ? '下一周草稿已永久删除'
                                : batch.nextBatchId
                                  ? '打开下一周草稿'
                                  : '创建下一周草稿'}
                            </Button>
                          </div>
                        </>
                      )}
                    </Card>
                  </>
                ))}
              {view === 'settings' && settings && (
                <>
                  <Card title="每周推送策略" extra={<Tag>默认每周二</Tag>}>
                    {settingsFields}
                    <div className="section-actions">
                      <Button
                        type="primary"
                        loading={busy === '保存设置'}
                        disabled={!!busy}
                        onClick={() => void act('/settings', settings, '保存设置', 'PUT')}
                      >
                        保存平台设置
                      </Button>
                      <Text type="secondary">
                        新批次使用这些默认值；已有草稿在「文案与排期」直接编辑本计划策略。
                      </Text>
                    </div>
                  </Card>
                  <Card title="循环自动化">
                    <div className="switch-row">
                      <div>
                        <strong>自动回收数据与生成周报</strong>
                        <p>
                          按本批次观察窗口到期后尝试同步（默认 144
                          小时）；失败每小时重试。需配置效果接口或已导入数据。
                        </p>
                      </div>
                      <Switch
                        checked={settings.autoCollect}
                        onChange={(v) => setSettings({ ...settings, autoCollect: v })}
                      />
                    </div>
                    <div className="switch-row">
                      <div>
                        <strong>复盘后自动创建下一周草稿</strong>
                        <p>
                          继承 CSV 模板和历史建议。AI 已配置时生成新候选；草稿仍需运营审核和执行。
                        </p>
                      </div>
                      <Switch
                        checked={settings.autoNextDraft}
                        onChange={(v) => setSettings({ ...settings, autoNextDraft: v })}
                      />
                    </div>
                    <Paragraph type="secondary">
                      执行机服务需持续运行，每 60 秒检查。定时任务不会自动点击 Facebook 发布。
                      {data.scheduler.lastTick && ` 最近检查：${time(data.scheduler.lastTick)}`}
                    </Paragraph>
                    {data.scheduler.error && (
                      <Alert type="warning" message={data.scheduler.error} />
                    )}
                    <Button
                      disabled={!!busy}
                      onClick={() => void act('/settings', settings, '保存自动化设置', 'PUT')}
                    >
                      保存自动化设置
                    </Button>
                  </Card>
                  <NotificationSettings
                    key={`${data.notifications.enabled}-${data.notifications.recipientLabel}`}
                    value={data.notifications}
                    busy={!!busy}
                    act={act}
                  />
                  <details>
                    <summary>高级设置 · 服务连接、访问令牌与兼容工具（技术同事使用）</summary>
                    <Card title="服务连接">
                      <div className="two-columns plain">
                        <div>
                          <h3>
                            AI 文案接口{' '}
                            <Tag color={data.capabilities.ai ? 'success' : 'default'}>
                              {data.capabilities.ai ? '已配置' : '未配置'}
                            </Tag>
                          </h3>
                          <p>由技术同事在执行机 .env 配置 Chat Completions 兼容接口：</p>
                          <code>
                            OPS_AI_URL
                            <br />
                            OPS_AI_MODEL
                            <br />
                            OPS_AI_KEY
                          </code>
                          <p className="muted">URL 为完整接口地址，API Key 只存放在服务端。</p>
                        </div>
                        <div>
                          <h3>
                            效果接口{' '}
                            <Tag color={data.capabilities.metrics ? 'success' : 'default'}>
                              {data.capabilities.metrics ? '已配置' : '未配置'}
                            </Tag>
                          </h3>
                          <code>
                            OPS_METRICS_URL
                            <br />
                            OPS_METRICS_TOKEN
                          </code>
                          <p className="muted">
                            GET 接口按 batch_id、project_key、week_of、labels 返回上述效果
                            CSV。Facebook 与游戏回流埋点需先由数据服务汇总。
                          </p>
                        </div>
                      </div>
                      <div className="verification">
                        <Field label="控制台 API Token（仅当前浏览器会话）">
                          <Input.Password
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                          />
                        </Field>
                        <Button
                          onClick={() => {
                            sessionStorage.setItem(API_TOKEN_KEY, token.trim());
                            void refresh();
                            message.success('访问令牌已更新');
                          }}
                        >
                          保存令牌并重连
                        </Button>
                      </div>
                      <div className="verification">
                        <h3>飞书机器人（SOP 专用）</h3>
                        <p>
                          配置 OPS_FEISHU_WEBHOOK_URL，可选 OPS_FEISHU_SIGN_SECRET。密钥仅存执行机
                          .env；配置后重启 API。旧执行器的 FEISHU_WEBHOOK_URL 不会自动用于 SOP。
                        </p>
                        <Button icon={<HistoryOutlined />} onClick={() => setView('legacy')}>
                          打开旧版兼容工具
                        </Button>
                      </div>
                    </Card>
                  </details>
                </>
              )}
              {view === 'legacy' && (
                <Suspense fallback={<Spin />}>
                  <Button onClick={() => setView('settings')}>返回平台设置</Button>
                  <LegacyConsole />
                </Suspense>
              )}
            </>
          )}
          <footer className="page-footer">
            PushLoop · 运营控制台 <span>文案 → 排期 → 数据 → 下一周</span>
          </footer>
        </div>
      </main>
      <TrashDialog
        open={trashOpen}
        batches={data?.deletedBatches ?? []}
        busy={!!busy}
        restoreDisabled={dirty}
        onClose={() => setTrashOpen(false)}
        onRefresh={refresh}
        onRestore={async (next) => {
          const result = await act(`/batches/${next}/restore`, {}, '恢复计划');
          if (result) {
            setTrashOpen(false);
            setView('copy');
          }
          return result;
        }}
      />
      <Modal
        title="创建每周推送计划"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        okText="创建计划"
        cancelText="取消"
        confirmLoading={!!busy}
        onOk={() =>
          void act(
            '/batches',
            { projectKey: project, weekOf: date, owner: newOwner },
            '创建计划',
          ).then((res) => {
            if (res) {
              setCreateOpen(false);
              setView('copy');
            }
          })
        }
      >
        <Paragraph type="secondary">
          每个游戏每周一个批次。候选文案保留在平台中，本周只发送选定的一条。
        </Paragraph>
        <Field label="游戏">
          <Select
            value={project}
            options={data?.projects.map((p) => ({ value: p.key, label: p.name }))}
            onChange={setProject}
          />
        </Field>
        <Field label="负责人（选填）">
          <Input
            value={newOwner}
            maxLength={80}
            onChange={(e) => setNewOwner(e.target.value)}
            placeholder="负责审核、执行和跟进此计划的同事"
          />
        </Field>
        <Field label="推送日期（周二）">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Text type="secondary">
          使用已保存的平台设置：
          {data?.settings.timingMode === 'fixed'
            ? `${data.settings.sendTime} ${data.settings.timezone}（人工后台排期）`
            : 'Predicted Best Time（UTC 日期）'}
        </Text>
      </Modal>
    </div>
  );
}
