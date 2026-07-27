# campaigns 目录（运营放文件的地方）

把飞书下载的「推送配置表」文件夹整个存到 `campaigns/` 下即可，工具会拿里面的内容表和
`schedule/` 下的排期表按同名自动配对：

| 位置 | 说明 | 例子 |
|---|---|---|
| `推送配置表/推送配置表 - <游戏>.csv` | 内容表：飞书原始导出，**无需改名/清洗**，上传到 Meta「Create from CSV」 | `推送配置表/推送配置表 - AHA.csv` |
| `schedule/<游戏>.schedule.csv` | 排期表：告诉工具每条推送用哪天（`label,date`） | `schedule/AHA.schedule.csv` |

```
campaigns/
  推送配置表/               # 飞书原始文件夹（内容表直接放这里）
    推送配置表 - AHA.csv
  schedule/                # 排期表
    AHA.schedule.csv
  projects.json            # 可选：显示名 / 直达 URL 映射
```

> **文件名带前缀没关系**：`推送配置表 - AHA.csv` 会被自动识别为游戏 `AHA`（剥掉 `推送配置表`
> 前缀和分隔符），排期表也用剥离后的名字，即 `schedule/AHA.schedule.csv`。工具用 `AHA`
> 去 Meta 后台切换项目；若后台显示名和文件名不同，在 `projects.json` 里加一条映射即可。
> 前缀可在 `.env` 的 `CONTENT_NAME_PREFIX` 调整，文件夹名可用 `CONTENT_SUBDIR` 调整。

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
| `label` | 自动取自 `推送配置表/推送配置表 - <游戏>.csv` 的 `label` 列 |
| `date` | **仅此列需人工填写**（`年-月-日`，UTC） |

```csv
label,date
AHA_001,2026-07-19
AHA_002,
AHA_003,
```

- `label`：必须和内容表 / Meta 后台列表里的 Label 完全一致（由 `gen-schedule` 保证）。
- `date`：推荐 `年-月-日`（如 `2026-07-19`），也支持 `月/日/年`。**请用 UTC 日期**。未填日期的行会被跳过、不处理。
- 发送策略：默认就是 `Predicted Best Time`，无需在排期表里体现；工具会自动跳过该步。
  个别游戏要用非默认策略时，可手动加一列 `send_time_strategy` 并填值（仍兼容识别）。

## 关于原始表的列（无需清洗）

飞书导出的原始表会带一些工作用列（`Date`、`Json_template`、`url`、`image_url`）和表尾多余
逗号——Meta「Create from CSV」会**自动忽略/识别**这些列，所以**不需要清洗、不需要改列名**，
和运营手动上传的文件一模一样直接用即可。

## 可选：批量改 label 补零位数

想把 `AHA_1～AHA_8` 统一成 `AHA_01～AHA_08`（或 `AHA_001～AHA_008`）时，用 `npm run relabel`：

```bash
npm run relabel -- --dry-run        # 先预览（不写文件）
npm run relabel -- --pad 2          # 补到 2 位
npm run relabel -- --pad 3 --game "AHA"
```

只改 label 结尾的连续数字，前缀与其它列、跨行 JSON 字段全部原样保留。改完 label 后请重跑
`npm run gen-schedule`（已排好日期用 `-- --keep-dates` 按行位次保留日期）。

## 使用步骤（运营 · 半自动化）

1. 从飞书把「推送配置表」文件夹整个下载/保存到 `campaigns/` 下（里面是各游戏的
   `推送配置表 - <游戏>.csv`，**无需改名/清洗**）。
2.（可选）`npm run relabel` 批量统一 label 补零位数（见上一节）。
3. `npm run gen-schedule`：从内容表生成排期表（并按「次日起连续 N 天」自动填好日期）。
4. **只填/调整** `schedule/*.schedule.csv` 的 `date` 列（每条用**不同日期**，见下方限制）。
   如自动填的日期就行，可跳过这步。
5. 确认 AdsPower 已开且已登录后，执行 `./run.sh`（或 `npm start`）。
6. 看窗口里的成功/失败汇总；出错会在 `screenshots/` 留截图（配了飞书 webhook 还会推送到群）。

> 带 `.example` 的示例文件不会被处理，仅供参考格式。
> 更完整的流程图与报错对照见 [`docs/运营操作指南.md`](../docs/运营操作指南.md)。

## ⚠️ Meta 平台限制（务必了解，否则会保存/开启失败）

| 限制 | 说明 | 触发后的表现 | 应对 |
|---|---|---|---|
| **同一天只能 1 条 active Single Send** | 每个 app 每天最多 1 条已开启的单发通知 | 第 2 条 Save 报 `You cannot have more than 1 active Single Send notification scheduled in one day` | 排期表里**每条用不同日期**，别都填同一天 |
| **每个 app 最多 10 条 active** | 一个游戏同时最多 10 条处于 active 的通知设置 | Turn On 报 `You cannot have more than 10 active notification settings per app` | 先到后台把过期/多余的 **Turn Off 或删除**，把 active 数降下来；分批投放 |
| **label 不能重复** | 同一 app 内 label 唯一 | 重新上传相同 label 会「Trying to create N…0 are created」 | 换新 label，或先删掉后台已存在的同名条目；也可用 `npm run relabel` 换补零位数让 label 整体变化 |
| **列格式** | 原始表列（`label` / `notification_title_*` / `notification_body_*` / `image_url` / `payload` / `bot_message_payload_elements` 等）Meta 会自动识别或忽略多余列 | 缺必填列会创建失败 | 保持运营导出的原始表结构即可 |

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
