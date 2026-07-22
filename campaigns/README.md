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

## 使用步骤（运营）

1. 内容表放进 `campaigns/content/`。
2. 运行 `npm run gen-schedule` 同步排期表，再只填 `schedule/*.schedule.csv` 的 `date` 列。
3. 回到项目根目录，双击 `run.command`（或先 `npm run validate` 检查）。
4. 等待运行结束，看窗口里的成功/失败汇总；出错会在 `screenshots/` 留截图。

> 带 `.example` 的示例文件不会被处理，仅供参考格式。
