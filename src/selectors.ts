/**
 * 页面元素选择器集中配置。
 *
 * ⚠️ 重要：这些默认值基于流程截图里的英文 UI 文本推测。Meta 后台是 React 应用，
 * class 名基本是混淆的、不稳定，所以这里尽量用「可见文本 / role」定位。
 * 请在首次运行时对照你的真实页面校验并按需修改本文件即可，
 * 业务逻辑代码无需改动。
 *
 * 命名约定：
 *  - `*Text`     : 用于 getByText / 文本匹配的可见文字
 *  - `*Role`     : { role, name } 供 getByRole 使用
 */
export const selectors = {
  /** 左上角「选择具体游戏项目」的入口按钮（截图里最上方的方块图标）。 */
  projectSwitcher: {
    // 项目切换按钮通常没有稳定文本，优先用 aria-label；如失败请改成实际值。
    triggerAriaLabels: ['My Apps', 'Apps', 'Select app', '选择应用'],
    // 打开后，通过项目名文本点击对应项目。
    // （项目名来自 config.projectName）
  },

  /** 左侧「Use Cases」（铅笔图标）入口。 */
  useCasesText: 'Use Cases',

  /** 「Send players notifications」菜单项（截图里文本被截断为 "...ab..."）。 */
  sendNotificationsText: 'Send players notifications',

  /** 通知列表页标识文本，用于确认已进入正确页面。 */
  notificationsPageHeadingText: 'User Notifications',

  /** 「Create from CSV」按钮。点击后会触发文件选择。 */
  createFromCsvText: 'Create from CSV',

  /** 行内「...」菜单按钮的候选定位（每行末尾的三个点）。 */
  rowMenu: {
    /** 三个点按钮的 aria-label 候选。 */
    ariaLabels: ['More', 'Options', 'More options', '更多'],
    /** 兜底：按钮里显示的字符（部分实现直接是 "..."）。 */
    text: '...',
  },

  /** 行菜单展开后的各操作项文本。 */
  menuItems: {
    viewEdit: 'View/Edit',
    turnOn: 'Turn On',
    turnOff: 'Turn Off',
    enableDryRun: 'Enable Dry Run Mode',
    sendPreview: 'Send Preview',
    delete: 'Delete',
  },

  /** 编辑页（View/Edit 打开后）的元素。 */
  editor: {
    /** 「Notification Date」标签文本，用于定位其下方的日期输入框。 */
    notificationDateLabelText: 'Notification Date',
    /** 日期输入框的 placeholder / 可能的候选（若 label 定位失败时兜底）。 */
    dateInputPlaceholders: ['mm/dd/yyyy', 'MM/DD/YYYY'],
    /** 「Send Time Strategy」标签文本，用于定位其下拉框。 */
    sendTimeStrategyLabelText: 'Send Time Strategy',
    /** Save / Cancel 按钮文本。 */
    saveText: 'Save',
    cancelText: 'Cancel',
  },
};

export type Selectors = typeof selectors;
