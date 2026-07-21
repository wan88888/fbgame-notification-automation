# campaigns 目录（运营放文件的地方）

每个游戏放**一对**文件，工具会自动识别并批量处理：

| 文件 | 说明 | 例子 |
|---|---|---|
| `<游戏>.csv` | 内容表：原样上传到 Meta「Create from CSV」的那份表 | `AHA.csv` |
| `<游戏>.schedule.csv` | 排期表：告诉工具每条推送用哪天、什么发送策略 | `AHA.schedule.csv` |

> 文件名要一致：`AHA.csv` 对应 `AHA.schedule.csv`。工具会用文件名 `AHA`
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

`<游戏>.schedule.csv` 至少要有 `label` 和 `date` 两列，`send_time_strategy` 可选
（不填默认 `Predicted Best Time`）。列名大小写、中英文都能识别：

```csv
label,date,send_time_strategy
AHA_001,2026-07-19,Predicted Best Time
AHA_002,2026-07-20,
AHA_003,2026-07-21,Predicted Best Time
```

- `label`：必须和内容表 / Meta 后台列表里的 Label 完全一致。
- `date`：推荐 `年-月-日`（如 `2026-07-19`），也支持 `月/日/年`。**请用 UTC 日期**。
- `send_time_strategy`（推送类别）：一般就是 `Predicted Best Time`。

## 使用步骤（运营）

1. 把这一对文件放进本目录（`campaigns/`）。可以同时放多个游戏的多对文件。
2. 回到项目根目录，双击 `run.command`。
3. 等待运行结束，看窗口里的成功/失败汇总；出错会在 `screenshots/` 留截图。

> 带 `.example` 的示例文件不会被处理，仅供参考格式。
