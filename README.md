# fbgame-notification-automation

用 **TypeScript + Playwright + AdsPower** 自动化 Meta（Facebook）游戏后台
「Send players notifications」的推送流程：

> 进入 Meta 管理后台 → 左上角选择具体游戏项目 → Use Cases → Send players
> notifications → Create from CSV（批量创建）→ 逐条 View/Edit（设置日期 +
> Send Time Strategy 为 Predicted Best Time → Save）→ 返回列表逐条 Turn On。

## 运营同事：几步搞定（半自动化）

> **人**负责放文件、填日期、确认 AdsPower 已登录；**机器**负责生成排期、上传、编辑、Save、Turn On。

> **可选 Web 控制台（方案 A）**：在执行机跑 `npm run ops:api` + `npm run ops:web`，运营用自己电脑浏览器打开页面上传 CSV、点「准备/推送」。说明见 [`apps/README.md`](apps/README.md)。CLI / `./run.sh` 仍可用。

1. 把飞书下载的「推送配置表」文件夹整个存到 `campaigns/` 下（里面是 `推送配置表 - <游戏>.csv`，**无需改名/清洗**）。2.（可选）`npm run relabel`：批量统一 label 结尾数字的补零位数（如 `AHA_1`→`AHA_01`，`--pad 3` 补 3 位）。
2. `npm run gen-schedule`：从内容表生成排期表（并自动填日期）。
3. 打开 `schedule/<游戏>.schedule.csv`，**只填 `date` 列**（每条**不同日期**）。
4. 启动运行，看成功/失败汇总；出错看 `screenshots/`：
   - **推荐**：在项目目录执行 **`./run.sh`**（首次需 `chmod +x run.sh`）
   - **任意平台**：也可直接 `npm start`

> 多个游戏就放多对文件，一次运行全部处理完。首次运行 `./run.sh` 会自动装依赖、并生成
> `.env` 提示你填 `ADSPOWER_USER_ID`（填完再运行一次）。
> **运营请看** [`docs/运营操作指南.md`](docs/运营操作指南.md)（含流程图 + 报错对照表）；
> Meta 平台限制另见 [`campaigns/README.md`](campaigns/README.md)，否则容易在 Save / Turn On 阶段失败。

## 工作原理

1. 从 `campaigns/推送配置表/` + `campaigns/schedule/` 按同名自动发现「内容表 + 排期表」
   配对（文件名去掉「推送配置表 - 」前缀即游戏名，可用 `campaigns/projects.json` 映射到 Meta 项目显示名）。
2. 通过 AdsPower 本地 API `/api/v1/browser/start` 启动指定 profile 的浏览器，
   拿到 CDP 端点 `data.ws.puppeteer`；Playwright 用 `chromium.connectOverCDP()` 接管。
3. 逐个游戏执行：切项目 → Create from CSV 上传内容表 → 按排期表逐条
   View/Edit（填日期 + Send Time Strategy）→ Save → 逐条 Turn On。日期/策略只来自
   排期表；内容表**原样上传**（不做列改名/清洗，与运营手动上传的文件一致）。

## 目录结构

```
src/
  main.ts             流程编排入口
  config.ts           读取 .env 与 notifications 配置
  adspower.ts         AdsPower 本地 API 客户端（start/stop/active）
  playwright-utils.ts CDP 接管、窗口最大化、行/菜单定位与滚动、截图等工具
  selectors.ts        ★ 页面选择器集中配置（最可能需要按真实页面微调的地方）
  steps.ts            各步骤实现（导航 / 上传 CSV / 编辑 / Turn On）
  schedule.ts         解析排期表（label,date；send_time_strategy 可选）
  campaigns.ts        从 campaigns/ 自动发现「内容表+排期表」配对
  validate.ts         排期日期格式 / 同日冲突检查（运行时轻量护栏）
  gen-schedule.ts     从内容表 label 生成/同步排期表
  relabel.ts          批量修改内容表 label 结尾数字的补零位数
  types.ts            类型定义
  logger.ts           日志
campaigns/            ★ 运营放文件的地方（见 campaigns/README.md）
  推送配置表/         飞书下载的原始文件夹（内容表直接放这里，不入库）
  schedule/           排期表（如 AHA.schedule.csv）
  projects.json       可选：文件名 → Meta 项目显示名 / 直达 URL 映射
run.sh                运营运行入口（./run.sh；也可直接 npm start）
data/                 进阶/兜底用的手写配置示例
```

## 常用命令

| 命令                   | 作用                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run gen-schedule` | **推荐**：从内容表 `label` 生成/同步 `schedule/*.schedule.csv`，并**自动填充日期**（次日起连续 7 天，含周末）；`-- --start-date 2026-07-29` 指定起始日，`-- --keep-dates` 只同步 label 不动日期 |
| `npm run relabel`      | 批量修改内容表 label 结尾数字的补零位数（`-- --pad 2` 默认 / `--pad 3`；`--dry-run` 预览；`--game <名>` 只处理某游戏）。改完记得重跑 `gen-schedule`                                             |
| `npm start`            | 正式运行（可加 `-- --game <名> --limit N --dry-run --no-upload --no-turn-on --use-open-page --resume`）                                                                                         |

## 数据来源优先级

工具按以下顺序决定要处理哪些游戏（满足前者就不看后者）：

1. **`campaigns/推送配置表/` + `campaigns/schedule/`** 里的「内容表 + 排期表」配对 —— 运营主用。
2. `data/games.json` —— 进阶，手写多游戏。
3. `.env` 里的 `PROJECT_NAME` + `NOTIFICATIONS_CONFIG` + `CSV_FILE` —— 单游戏兜底。

## 首次技术配置（一次性，由懂技术的同学做）

> 需要 **Node.js ≥ 18**（代码用到全局 `fetch`）。仓库根有 `.nvmrc`，装了 nvm 可直接 `nvm use`。

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

编辑 `.env`（主要就一项）：

- `ADSPOWER_USER_ID`：要接管的 AdsPower 环境编号（**必填**）。
- `ADSPOWER_API_BASE`：默认 `http://local.adspower.net:50325`。
- `ADSPOWER_API_KEY`：若在 AdsPower 里开启了 API 鉴权才需要。
- 其余运行参数见文件内注释。

配好后，日常使用就交给运营：把飞书「推送配置表」文件夹存到 `campaigns/` 下、填好 `campaigns/schedule/` 的日期，然后执行
`./run.sh`（或 `npm start`）。（`run.sh` 首次运行也会自动帮忙装依赖、生成 `.env`。）

## 进阶：手写多游戏配置（可选）

不想用 `campaigns/` 目录时，也可以用 `data/games.json` 手写多游戏，或用
`.env` 的单游戏配置兜底。`games.json` 每个游戏可内联 `notifications` 或用
`notificationsFile` 指向单独文件，`csv` 为内容表路径：

```json
{
  "games": [
    {
      "projectName": "Game A",
      "csv": "./data/gameA.csv",
      "notifications": [{ "label": "Egg_001", "date": "2026-07-19" }]
    },
    {
      "projectName": "Game B",
      "csv": "./data/gameB.csv",
      "notificationsFile": "./data/gameB.notifications.json"
    }
  ]
}
```

每个游戏之间会重新进入后台首页并切换项目，互不干扰；单个游戏或单条推送失败
只会记录并截图，不影响其余游戏，最后输出按游戏分组的汇总。

### 3. 运行

先确保 AdsPower 客户端已开启、对应 profile 已登录 Meta 账号，然后：

```bash
npm start          # = tsx src/main.ts
```

### 开发与代码质量（面向维护者）

```bash
npm run check        # 推荐：一键 typecheck + lint + format:check + test（与 CI 相同）
npm run typecheck    # tsc --noEmit，类型检查（不产出文件）
npm run lint         # ESLint 检查；npm run lint:fix 自动修复
npm run format       # Prettier 格式化；npm run format:check 只检查
npm test             # vitest 跑纯函数单测；npm run test:watch 监听模式
```

`npm run build`（`tsc`）会把 `src/` 编译到 `dist/`。**日常运行并不需要它**——`npm start` 直接用
`tsx` 跑 TypeScript 源码。仅当要在没有 `tsx`、需要纯 JS 产物的环境部署时才用 `build`
（`dist/` 已被 `.gitignore` 忽略，不入库）。

### 先在单个项目上调试（推荐流程）

推广到全部游戏前，先用命令行开关在一个项目上把选择器调通。参数写在 `--` 之后：

```bash
# 查看所有调试参数
npm start -- --help

# 只跑 Game A 的第 1 条，且不改动数据（不点 Save、不 Turn On），用于验证导航/选择器
npm start -- --game "Game A" --limit 1 --dry-run

# 选择器确认无误后，正式对 Game A 执行（会 Save + Turn On）
npm start -- --game "Game A"

# CSV 已在上一轮创建过，本轮不想重复批量创建，只改日期/Turn On
npm start -- --game "Game A" --no-upload

# 全部游戏正式跑
npm start

# 上一次跑到一半失败（如第 12 个游戏挂了），续跑：已完成的整体跳过、已上传的不重复上传
npm start -- --resume
```

调试参数说明：

| 参数              | 作用                                                             |
| ----------------- | ---------------------------------------------------------------- |
| `--game <名称>`   | 只处理指定游戏（按 projectName 匹配，可重复传多个）              |
| `--limit <N>`     | 每个游戏最多处理前 N 条（调试建议 `1`）                          |
| `--dry-run`       | 走完导航/编辑但**不 Save、不 Turn On**（改点 Cancel 关闭编辑框） |
| `--no-upload`     | 跳过 Create from CSV（避免反复调试时重复批量创建）               |
| `--no-turn-on`    | 本次不 Turn On（覆盖 `.env` 的 `AUTO_TURN_ON`）                  |
| `--use-open-page` | 不导航，直接接管当前已打开的标签页（多游戏时只处理当前一个）     |
| `--resume`        | 断点续跑：跳过已完成的游戏，已上传未完成的游戏不重复上传         |

配合 `.env` 里调大 `SLOW_MO_MS`（如 `300`）能更清楚地观察每一步。
出错时看 `screenshots/` 截图，只改 `src/selectors.ts` 对应文本即可。

### 跳过脆弱的导航（更快更稳）

「切项目 → Use Cases → 点菜单」这段导航的选择器最容易和真实页面对不上。有两种方式绕开：

1. **每个游戏配 App ID（推荐）**：各游戏的 Send notifications 页 URL 只有 `/apps/<APP_ID>/`
   这段不同，所以 `campaigns/projects.json` 里通常**只需填 `appId`**，其余由
   `NOTIFICATIONS_URL_TEMPLATE` 模板自动补全：

```json
{ "AHA": { "name": "AHA", "appId": "696007096453320" } }
```

个别游戏所属 business 不同（模板拼不出正确 URL）时，可改用整条 `url` 覆盖：
`{ "AHA": { "name": "AHA", "url": "https://..." } }`。单游戏兜底模式可用 `.env` 的 `NOTIFICATIONS_URL`。2. **手动开好页面再接管**：你先在 AdsPower 浏览器里手动打开某游戏的 Send notifications 页，
然后加 `--use-open-page`，工具不导航、直接从 Create from CSV 开始：

```bash
npm start -- --use-open-page --limit 1 --dry-run
```

> `--use-open-page` 无法切换项目，多游戏时只处理当前这一个；要批量请用方式 1（固定 URL）。

### 断点续跑（长任务失败后接着跑）

18 个游戏 × 7 条是长任务，中途若因网络/风控/选择器等原因失败，不必从头再来：

- 每处理完一个游戏，进度会写入 `.run-state.json`（`RUN_STATE_PATH` 可改，已 gitignore），
  记录该游戏是否**已上传**、是否**已全部完成**。
- 重跑时加 `--resume`：
  - **已完成**的游戏整体跳过（不再导航/上传/编辑/Turn On）；
  - **已上传但未完成**的游戏跳过 `Create from CSV`（避免重复批量创建），仍重做编辑 + Turn On。
- 状态按「本批次」隔离：`runKey` 取排期里最早的日期，排期滚动到下一周后旧状态自动失效，
  不会误跳过新一轮的游戏。

> 提示：发送策略默认即为 `Predicted Best Time`，工具会**自动跳过**这一步的下拉选择；
> 若排期表某条指定了别的策略，才会主动去点选。需要每条都强制设置可在 `.env` 设
> `ALWAYS_SET_STRATEGY=true`。

## 降低自动化检测风险

Meta/FB 对自动化较敏感（如直接调 Graph API `/messages` 容易被判定并告警）。本工具
的做法本身就更接近真人：

- **用 AdsPower 真实指纹浏览器 + 真实登录态 cookie**，在真实页面上点击，而不是服务端调 API；
- 通过 CDP 接管 AdsPower 已启动的普通 Chrome，不注入 Playwright 常见的自动化启动参数。

在此之上，内置一层「拟人化」（默认开启，`.env` 里 `HUMANIZE=true`）：

- 步骤之间**随机思考停顿**（`THINK_MIN_MS`/`THINK_MAX_MS`）；
- 输入日期等**逐字符键入 + 随机间隔**（`TYPE_MIN_MS`/`TYPE_MAX_MS`），而非瞬间填充；
- 点击前**移动鼠标到元素并带轻微抖动**、先滚动进视野；
- 每条之间、每个游戏之间**随机长停顿**（`BETWEEN_ITEMS_*` / `BETWEEN_GAMES_*`）；
- **频率闸门** `MAX_ITEMS_PER_RUN`：限制单次运行处理的条数，避免短时间大批量操作。

使用建议（进一步降低风险）：

- 不要把停顿区间调太小；批量任务宁可**分多次、跨时段**跑，也别一次几百条。
- 用 `MAX_ITEMS_PER_RUN` 给单次运行设上限（如 20~50），配合每天分批。
- 保持 AdsPower profile 的 IP / 指纹稳定，别频繁更换。
- 账号本身的操作节奏尽量贴近人类日常（工作时间段、非整点）。

> 说明：没有任何方案能 100% 规避风控；以上是把行为特征尽量贴近真人、降低概率。

## 关于选择器（务必阅读）

Meta 后台是 React 应用，DOM 的 class 名混淆且不稳定，因此本项目**优先用可见
文本 / role 定位**（`getByText` / `getByRole`），并把所有文本集中在
`src/selectors.ts`。默认值基于流程截图里的英文 UI 推测。

首次运行若在某一步失败：

1. 查看 `screenshots/` 下自动保存的出错截图，以及 `logs/run-<时间戳>.log` 完整运行日志
   （出错截图文件名以同一个 `run-<时间戳>` 前缀开头，方便和该次日志一一对应）。
2. 对照真实页面，修改 `src/selectors.ts` 里对应的文本即可，**业务逻辑无需改动**。
3. 行末「...」菜单、日期输入框、发送策略下拉框这三处最容易因页面差异需要微调，
   相关多策略兜底在 `src/playwright-utils.ts` 与 `src/steps.ts`。

## 行为说明

- 逐条处理，单条失败会截图并记录，不中断其余条目；结束时汇总失败列表。
- 配置 `FEISHU_WEBHOOK_URL` 后，运行结束会把汇总（成功/失败、失败明细、日志路径）
  推送到飞书群；留空则不发，发送失败也只记告警、不影响退出码。详见运营指南。
- `AUTO_TURN_ON=false` 可只做编辑、不自动 Turn On。
- `CLOSE_BROWSER_ON_EXIT=false`（默认）运行结束只断开 CDP，不关闭 AdsPower
  浏览器，方便人工核对结果。
- 调试时可调大 `SLOW_MO_MS`（如 300）观察每一步操作。
