# PushLoop 自动推送 SOP 平台

主界面现已升级为每周推送批次工作台：文案生成与审核 → CSV 模板与排期 → 后台执行/人工核验 → 效果回收 → 周报 → 下一周草稿。

完整操作、配置与实际接入边界见 [自动推送平台 SOP](../docs/自动推送平台SOP.md)。固定时刻和独立 Publish 尚需 Facebook 后台联调；当前提供人工排期核验及已有最佳时间执行器。

以下保留原执行机启动方式与旧版工具说明。

## 架构

```text
运营电脑浏览器  →  http://<执行机IP>:5173  (apps/web)
                      ↓ /api 代理
执行机          →  http://127.0.0.1:8787     (apps/api)
                      ↓ spawn npm 脚本
                现有 src/ + AdsPower + Meta
```

## 启动（在执行机、仓库根目录）

```bash
# 安装子项目依赖（首次）
npm --prefix apps/api install
npm --prefix apps/web install
# 若提示 esbuild 脚本被拦截：npm install-scripts approve esbuild@0.25.12

# 终端 1：API（8787）
npm run ops:api

# 终端 2：前端（5173，已代理 /api → 8787）
npm run ops:web
```

本机访问：http://127.0.0.1:5173  
局域网访问：http://<执行机IP>:5173 （防火墙放行 **5173**；开发模式下 API 经 Vite 代理，一般不必对局域网开 8787）

改完 API 代码后需**重启** `npm run ops:api`（若已装 systemd 服务：`systemctl --user restart fbgame-ops-api`）。

### 开机自启 / 固定远程地址

Cursor 关掉后，在会话里启动的进程会一起停；`trycloudflare.com` 临时隧道每次重开地址都会变。

**关掉 Cursor 也不停（推荐先做）：**

```bash
bash scripts/install-ops-services.sh
systemctl --user start fbgame-ops-api fbgame-ops-web fbgame-ops-tunnel
cat .ops-console/tunnel-url.txt
```

注销后仍要跑的话，执行一次：`sudo loginctl enable-linger $USER`

临时隧道在**进程一直活着**时地址不变；机器重启后仍会换新域名。

**永久固定域名：** 需要 Cloudflare 账号，以及一个托管在 Cloudflare 上的域名，做成「命名隧道」（例如 `https://ops.你的域名`）。没有域名时临时隧道无法永久固定。

可选环境变量（执行机）：

| 变量                                         | 说明                                           |
| -------------------------------------------- | ---------------------------------------------- |
| `OPS_API_HOST`                               | 监听地址，默认 `127.0.0.1`                     |
| `OPS_AI_URL` / `OPS_AI_MODEL` / `OPS_AI_KEY` | AI 文案接口配置                                |
| `OPS_METRICS_URL` / `OPS_METRICS_TOKEN`      | 效果 CSV 服务配置                              |
| `OPS_API_PORT`                               | API 端口，默认 `8787`                          |
| `OPS_API_TOKEN`                              | 若设置，请求需 `Authorization: Bearer <token>` |

## 旧版执行工具

1. **上传 CSV** → `campaigns/推送配置表/`
2. **准备** = `fix-content-csv` → `gen-schedule` → `check-campaigns`
3. **仅体检** = `check-campaigns`
4. **开始推送** = `npm start`（等同 `./run.sh` 核心）

同时只跑一个任务。任务状态与日志在 `.ops-console/jobs/`。

## API 一览

| 方法 | 路径                | 说明                            |
| ---- | ------------------- | ------------------------------- |
| GET  | `/api/health`       | 探活                            |
| POST | `/api/files/upload` | multipart 字段 `file`（可多个） |
| POST | `/api/jobs`         | body: `{ "type": "prepare"      | "check" | "run", "args"?: string[] }` |
| GET  | `/api/jobs`         | 最近任务                        |
| GET  | `/api/jobs/:id`     | 任务详情（含 log）              |

## 注意

- 执行机 AdsPower 需已开并登录 Meta。
- CSV 文件名保持 `推送配置表 - 游戏名.csv`。
- 现有 `./run.sh` / CLI 流程不受影响；本控制台是并行入口。

## SOP API

- `GET /api/sop`：默认设置、游戏、能力状态、批次、调度器状态。
- `PUT /api/sop/settings`：保存平台设置。
- `POST /api/sop/batches`：创建周二计划。
- `GET /api/sop/batches/:id`：批次详情。
- `PUT /api/sop/batches/:id/settings|variants|template`：更新草稿设置、文案或 CSV 模板。
- `POST /api/sop/batches/:id/generate|prepare|publish|retry|verify|metrics|collect|report|next`：生成、准备、执行、安全续跑、核验、导入、同步、周报、下一轮。
- `GET /api/sop/batches/:id/csv?kind=content|schedule|plan`：下载 CSV。
- `GET /api/sop/batches/:id/report/download`：下载 Markdown 周报。

SOP 与旧版任务共用单进程串行执行队列；SOP 产物独立保存，旧版清理按钮不会删除 SOP 批次。
