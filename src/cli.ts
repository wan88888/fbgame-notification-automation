/** 命令行选项，主要用于「先在单个项目上调试」的场景。 */
export interface CliOptions {
  /** 只处理指定游戏（按 projectName 匹配，可多次传入）。为空表示全部。 */
  games: string[];
  /** 每个游戏最多处理前 N 条推送（调试时设为 1 最方便）。0 表示不限制。 */
  limit: number;
  /** dry-run：走完导航/编辑但不点 Save、也不 Turn On（改用 Cancel 关闭编辑框）。 */
  dryRun: boolean;
  /** 跳过 Create from CSV 上传（调试时避免重复批量创建导致重复数据）。 */
  noUpload: boolean;
  /** 覆盖 AUTO_TURN_ON：显式关闭 Turn On。 */
  noTurnOn: boolean;
  /** 跳过导航，直接接管当前已打开的标签页（从 Create from CSV 开始）。 */
  useOpenPage: boolean;
  /** 只校验内容表数据是否合格，不启动浏览器、不上传。 */
  validateOnly: boolean;
  /** 打印帮助后退出。 */
  help: boolean;
}

const HELP = `
用法: npm start -- [选项]

调试相关选项：
  --game <名称>       只处理指定游戏（按 projectName 匹配，可重复传入多个）
  --limit <N>         每个游戏最多处理前 N 条推送（调试时建议 1）
  --dry-run           走完流程但不点 Save、不 Turn On（用 Cancel 关闭编辑框）
  --no-upload         跳过 Create from CSV 上传（避免重复调试时反复批量创建）
  --no-turn-on        本次不执行 Turn On（覆盖 .env 的 AUTO_TURN_ON）
  --use-open-page     不做任何导航，直接接管当前已打开的标签页（从 Create from CSV 开始）
  --validate-only     只校验 content/ 内容表数据是否合格，不启动浏览器、不上传
  -h, --help          显示本帮助

示例：
  # 只调试 Game A 的第 1 条，且不改动数据（不 Save/不 Turn On）
  npm start -- --game "Game A" --limit 1 --dry-run

  # 我已手动打开好某游戏的 Send notifications 页，直接从这一页开始跑
  npm start -- --use-open-page --limit 1 --dry-run

  # CSV 已在上一轮调试中创建过，本轮只改日期+Turn On
  npm start -- --game "Game A" --no-upload
`;

export function parseCli(argv: string[] = process.argv.slice(2)): CliOptions {
  const opts: CliOptions = {
    games: [],
    limit: 0,
    dryRun: false,
    noUpload: false,
    noTurnOn: false,
    useOpenPage: false,
    validateOnly: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--game': {
        const val = argv[++i];
        if (!val) throw new Error('--game 需要一个游戏名称参数');
        opts.games.push(val);
        break;
      }
      case '--limit': {
        const val = argv[++i];
        const n = Number.parseInt(val ?? '', 10);
        if (Number.isNaN(n) || n < 0) throw new Error('--limit 需要一个非负整数');
        opts.limit = n;
        break;
      }
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--no-upload':
        opts.noUpload = true;
        break;
      case '--no-turn-on':
        opts.noTurnOn = true;
        break;
      case '--use-open-page':
        opts.useOpenPage = true;
        break;
      case '--validate-only':
        opts.validateOnly = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}（用 --help 查看用法）`);
    }
  }
  return opts;
}

export function printHelp(): void {
  console.log(HELP);
}
