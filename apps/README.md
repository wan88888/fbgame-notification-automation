# 运营控制台（方案 A：执行机跑自动化，运营用浏览器遥控）

## 架构

```text
运营电脑浏览器  →  http://<执行机IP>:5173  (apps/web)
                      ↓ /api 代理
执行机          →  http://0.0.0.0:8787     (apps/api)
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

改完 API 代码后需**重启** `npm run ops:api`。

可选环境变量（执行机）：

| 变量 | 说明 |
|---|---|
| `OPS_API_PORT` | API 端口，默认 `8787` |
| `OPS_API_TOKEN` | 若设置，请求需 `Authorization: Bearer <token>` |

## 页面能力

1. **上传 CSV** → `campaigns/推送配置表/`
2. **准备** = `fix-content-csv` → `gen-schedule` → `check-campaigns`
3. **仅体检** = `check-campaigns`
4. **开始推送** = `npm start`（等同 `./run.sh` 核心）

同时只跑一个任务。任务状态与日志在 `.ops-console/jobs/`。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 探活 |
| POST | `/api/files/upload` | multipart 字段 `file`（可多个） |
| POST | `/api/jobs` | body: `{ "type": "prepare"|"check"|"run", "args"?: string[] }` |
| GET | `/api/jobs` | 最近任务 |
| GET | `/api/jobs/:id` | 任务详情（含 log） |

## 注意

- 执行机 AdsPower 需已开并登录 Meta。
- CSV 文件名保持 `推送配置表 - 游戏名.csv`。
- 现有 `./run.sh` / CLI 流程不受影响；本控制台是并行入口。
