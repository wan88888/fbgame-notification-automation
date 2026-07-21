/** 单条推送的调度配置。 */
export interface NotificationSchedule {
  /** 推送文案的 Label，需与后台列表中的 Label 完全一致（用于定位行）。 */
  label: string;
  /**
   * 通知日期。请使用 UTC 时区的日期。
   * 支持 "YYYY-MM-DD"（推荐）或 "M/D/YYYY"。
   */
  date: string;
  /**
   * 发送时间策略，需与后台下拉框中的选项文本一致。
   * 例如 "Predicted Best Time"。
   */
  sendTimeStrategy?: string;
}

/** notifications.json 顶层结构。 */
export interface NotificationsConfig {
  /** 具体游戏项目名称。可覆盖 .env 里的 PROJECT_NAME。 */
  projectName?: string;
  /** 需要处理的推送列表。 */
  notifications: NotificationSchedule[];
}

/** 单个游戏的批处理任务。 */
export interface GameJob {
  /** 游戏项目名称，用于页面左上角切换项目。 */
  projectName: string;
  /** 可选：该游戏 Send players notifications 页的固定 URL。填了就直达，跳过导航。 */
  url?: string;
  /** 该游戏批量创建用的 CSV 路径。 */
  csv: string;
  /** 该游戏的推送调度（内联）。与 notificationsFile 二选一。 */
  notifications?: NotificationSchedule[];
  /** 该游戏的推送调度文件路径（notifications JSON）。与 notifications 二选一。 */
  notificationsFile?: string;
}

/** games.json 顶层结构：多游戏批处理。 */
export interface GamesConfig {
  games: GameJob[];
}

/** 运行期已解析好的单游戏任务（notifications 一定已就绪）。 */
export interface ResolvedGameJob {
  projectName: string;
  /** 可选：直达 Send players notifications 页的 URL。 */
  url?: string;
  csv: string;
  notifications: NotificationSchedule[];
}

/** projects.json 中每个条目：可以是「显示名」字符串，或含可选 url 的对象。 */
export type ProjectMapEntry = string | { name?: string; url?: string };

/** AdsPower /api/v1/browser/start 返回结构。 */
export interface AdsPowerStartResponse {
  code: number;
  msg: string;
  data?: {
    ws?: {
      selenium?: string;
      puppeteer?: string;
    };
    debug_port?: string;
    webdriver?: string;
  };
}
