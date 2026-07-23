# campaigns 目录（运营放文件的地方）

每个游戏放**一对**文件，分别放进两个子目录，工具会按同名自动配对：

| 位置 | 说明 | 例子 |
|---|---|---|
| `content/<游戏>.csv` | 内容表：原样上传到 Meta「Create from CSV」 | `content/AHA.csv` |
| `schedule/<游戏>.schedule.csv` | 排期表：告诉工具每条推送用哪天、什么发送策略 | `schedule/AHA.schedule.csv` |

```
campaigns/
  content/                 # 内容表
    AHA.csv
  schedule/                # 排期表
    AHA.schedule.csv
  projects.json            # 可选：显示名 / 直达 URL 映射
```

> 文件名要一致：`content/AHA.csv` 对应 `schedule/AHA.schedule.csv`。工具会用文件名 `AHA`
> 去 Meta 后台切换到对应游戏项目。若后台里的项目显示名和文件名不一样，
> 在本目录的 `projects.json` 里加一条映射即可。

> **运营导出的文件名带前缀也没关系**：像 `推送配置表 - AHA.csv` 会被自动识别为游戏 `AHA`
> （剥掉 `推送配置表` 前缀和分隔符），运营**无需手工改名**，直接放进 `content/` 即可。
> 前缀可在 `.env` 的 `CONTENT_NAME_PREFIX` 调整（留空则不剥离）。生成的排期表也会用剥离后的名字，
> 即 `schedule/AHA.schedule.csv`。

## projects.json（可选，强烈推荐配 URL）

如果每个游戏的 Send players notifications 页面有**固定 URL**，在 `projects.json`
里给它配上，工具就会直接打开那一页、**跳过“切项目 → Use Cases → 点菜单”这段最容易
出问题的导航**，又快又稳：

```json
{
  "AHA": { "name": "AHA", "url": "https://developers.facebook.com/apps/APP_ID/....." }
}
```

- 只需映射显示名（不配 URL）：`"AHA": "AHA 游戏显示名"`。
- 完全不需要映射：整个文件写 `{}` 即可。

## 排期表格式

`schedule/<游戏>.schedule.csv` **不要手写 label**：从内容表自动生成。

```bash
# 内容表更新后，同步生成/更新排期表（保留已填的 date）
npm run gen-schedule
```

生成结果：

| 列 | 来源 |
|---|---|
| `label` | 自动取自 `content/<游戏>.csv` 的 `label` 列 |
| `send_time_strategy` | 固定为 `Predicted Best Time` |
| `date` | **仅此列需人工填写**（`年-月-日`，UTC） |

```csv
label,date,send_time_strategy
AHA_001,2026-07-19,Predicted Best Time
AHA_002,,Predicted Best Time
AHA_003,,Predicted Best Time
```

- `label`：必须和内容表 / Meta 后台列表里的 Label 完全一致（由 `gen-schedule` 保证）。
- `date`：推荐 `年-月-日`（如 `2026-07-19`），也支持 `月/日/年`。**请用 UTC 日期**。未填日期的行会被跳过、不处理。
- `send_time_strategy`（推送类别）：一般就是 `Predicted Best Time`。

## 内容表清洗（推荐）

运营导出的原始表常带工作用列（`Date`、`Json_template`、`image_url`、`url`）和表尾多余逗号。
日常请用一键准备：

```bash
npm run prep          # = clean-content + gen-schedule
```

单独清洗也可以：

```bash
npm run clean-content
```

- 删除不支持的列与空列；`image_url` 重命名为 `media_url`（Meta 的图片列）。
- 只保留：`label`、`media_url`、`payload`、`bot_message_payload_elements`、各语言 `notification_title_* / notification_body_*`。
- 原始文件首次运行会备份到 `campaigns/content-raw/`（不入库）。

## 使用步骤（运营 · 半自动化）

1. 把内容表放进 `campaigns/content/<游戏>.csv`。
2. `npm run prep`（清洗 + 生成排期）。
3. **只填** `schedule/*.schedule.csv` 的 `date` 列（每条用**不同日期**，见下方限制）。
4. `npm run validate` 检查是否合格。
5. 确认 AdsPower 已开且已登录后，执行 `./run.sh`（或 `npm start`）。
6. 看窗口里的成功/失败汇总；出错会在 `screenshots/` 留截图。

> 带 `.example` 的示例文件不会被处理，仅供参考格式。
> 更完整的流程图与报错对照见 [`docs/运营操作指南.md`](../docs/运营操作指南.md)。

## ⚠️ Meta 平台限制（务必了解，否则会保存/开启失败）

| 限制 | 说明 | 触发后的表现 | 应对 |
|---|---|---|---|
| **同一天只能 1 条 active Single Send** | 每个 app 每天最多 1 条已开启的单发通知 | 第 2 条 Save 报 `You cannot have more than 1 active Single Send notification scheduled in one day` | 排期表里**每条用不同日期**，别都填同一天 |
| **每个 app 最多 10 条 active** | 一个游戏同时最多 10 条处于 active 的通知设置 | Turn On 报 `You cannot have more than 10 active notification settings per app` | 先到后台把过期/多余的 **Turn Off 或删除**，把 active 数降下来；分批投放 |
| **label 不能重复** | 同一 app 内 label 唯一 | 重新上传相同 label 会「Trying to create N…0 are created」 | 换新 label，或先删掉后台已存在的同名条目 |
| **列格式** | 仅支持 `label` / `notification_title_*` / `notification_body_*` / `media_url` / `payload` / `bot_message_payload_elements` | 缺必填列会创建失败 | 用 `npm run clean-content` + `npm run validate` 先自检 |

> 说明：`date` 请统一按 **UTC** 理解；未填 `date` 的行会被跳过、不处理。

## 调试小抄（技术同学）

```bash
# 只处理某游戏、只跑 1 条、不改动数据（不 Save/不 Turn On）
npm start -- --game "AHA" --limit 1 --dry-run

# CSV 已在后台创建过，本轮不想重复上传
npm start -- --game "AHA" --no-upload

# 已手动打开好某游戏的 Send notifications 页，直接从这一页开始
npm start -- --use-open-page --limit 1 --dry-run
```
