import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, App as AntdApp, Button, Card, Space, Tag, Typography, Upload, Divider } from 'antd';
import {
  InboxOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  ToolOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import {
  clearCampaignFiles,
  createJob,
  getHealth,
  getJob,
  listJobs,
  uploadFiles,
  type Job,
  type JobType,
} from './api';

const { Title, Paragraph, Text } = Typography;

const STATUS_COLOR: Record<Job['status'], string> = {
  queued: 'default',
  running: 'processing',
  succeeded: 'success',
  failed: 'error',
};

const TYPE_LABEL: Record<JobType, string> = {
  prepare: '准备',
  check: '体检',
  run: '开始推送',
};

export default function App() {
  // antd v5 的静态 message/Modal 在 React 19 下不可用，必须走 App context。
  const { message, modal } = AntdApp.useApp();
  const [connected, setConnected] = useState(false);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [starting, setStarting] = useState<JobType | null>(null);
  const [active, setActive] = useState<Job | null>(null);
  const [recent, setRecent] = useState<Job[]>([]);

  const refreshRecent = useCallback(async () => {
    try {
      const { jobs } = await listJobs();
      setRecent(jobs.slice(0, 8));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    getHealth()
      .then(() => setConnected(true))
      .catch(() => message.error('无法连接执行机 API（请确认本机已 npm run ops:api）'));
    void refreshRecent();
  }, [refreshRecent, message]);

  // 轮询当前任务
  useEffect(() => {
    if (!active || active.status === 'succeeded' || active.status === 'failed') return;
    const t = setInterval(() => {
      void getJob(active.id)
        .then(({ job }) => {
          setActive(job);
          if (job.status === 'succeeded' || job.status === 'failed') {
            void refreshRecent();
            if (job.status === 'succeeded') message.success(`${TYPE_LABEL[job.type]} 完成`);
            else message.error(job.error || `${TYPE_LABEL[job.type]} 失败`);
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => clearInterval(t);
  }, [active, refreshRecent, message]);

  const busy = useMemo(
    () =>
      uploading ||
      clearing ||
      starting !== null ||
      active?.status === 'running' ||
      active?.status === 'queued',
    [uploading, clearing, starting, active],
  );

  const onUpload = async () => {
    const files: File[] = fileList.flatMap((f) => (f.originFileObj ? [f.originFileObj] : []));
    if (files.length === 0) {
      message.warning('请先选择 CSV 文件');
      return;
    }
    setUploading(true);
    try {
      const res = await uploadFiles(files);
      message.success(`已上传 ${res.saved.length} 个文件`);
      setFileList([]);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const onClear = () => {
    modal.confirm({
      title: '清空已上传文件？',
      okText: '清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        setClearing(true);
        try {
          const res = await clearCampaignFiles();
          message.success(res.count > 0 ? `已清理 ${res.count} 个文件` : '目录已是空的');
        } catch (e) {
          message.error((e as Error).message);
          throw e;
        } finally {
          setClearing(false);
        }
      },
    });
  };

  const start = async (type: JobType) => {
    setStarting(type);
    try {
      const { job } = await createJob(type);
      setActive(job);
      void refreshRecent();
      message.info(`已排队：${TYPE_LABEL[type]}`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setStarting(null);
    }
  };

  return (
    <div className="ops-shell">
      <div className="ops-hero">
        <Title level={2}>Meta游戏推送平台</Title>
      </div>

      <Alert
        className="ops-card"
        type="warning"
        showIcon
        message="运行前请确认"
        description="执行机上的 AdsPower 客户端已打开"
      />

      {connected && <Alert className="ops-card" type="info" showIcon message="已连接执行机" />}

      <Card className="ops-card" title="1. 上传推送配置表">
        <Upload.Dragger
          className="ops-upload"
          multiple
          accept=".csv"
          fileList={fileList}
          beforeUpload={() => false}
          onChange={({ fileList: fl }) => setFileList(fl)}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽 CSV 到此处</p>
        </Upload.Dragger>
        <Divider />
        <Space wrap>
          <Button type="primary" loading={uploading} disabled={busy && !uploading} onClick={() => void onUpload()}>
            上传
          </Button>
          <Button
            danger
            icon={<DeleteOutlined />}
            loading={clearing}
            disabled={busy && !clearing}
            onClick={onClear}
          >
            清理
          </Button>
        </Space>
      </Card>

      <Card className="ops-card" title="2. 执行任务">
        <Space wrap>
          <Button
            icon={<ToolOutlined />}
            loading={starting === 'prepare'}
            disabled={busy}
            onClick={() => void start('prepare')}
          >
            准备
          </Button>
          <Button
            icon={<CheckCircleOutlined />}
            loading={starting === 'check'}
            disabled={busy}
            onClick={() => void start('check')}
          >
            体检
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={starting === 'run'}
            disabled={busy}
            onClick={() => void start('run')}
          >
            开始推送
          </Button>
        </Space>
        <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          推荐顺序：上传→准备→开始推送
        </Paragraph>
      </Card>

      <Card
        className="ops-card"
        title="3. 当前任务"
        extra={
          active ? (
            <Tag color={STATUS_COLOR[active.status]}>
              {TYPE_LABEL[active.type]} · {active.status}
            </Tag>
          ) : (
            <Tag>无</Tag>
          )
        }
      >
        {!active && <Text type="secondary">尚未启动任务</Text>}
        {active && (
          <>
            {active.error && <Alert type="error" showIcon message={active.error} style={{ marginBottom: 12 }} />}
            <div className="log-box">{active.log || '（等待日志…）'}</div>
          </>
        )}
      </Card>

      <Card className="ops-card" title="最近任务">
        <Space direction="vertical" style={{ width: '100%' }}>
          {recent.length === 0 && <Text type="secondary">暂无</Text>}
          {recent.map((j) => (
            <div key={j.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Tag color={STATUS_COLOR[j.status]}>{j.status}</Tag>
              <Text>{TYPE_LABEL[j.type]}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(j.createdAt).toLocaleString('zh-CN')}
              </Text>
              <Button type="link" size="small" onClick={() => setActive(j)}>
                查看
              </Button>
            </div>
          ))}
        </Space>
      </Card>
    </div>
  );
}
