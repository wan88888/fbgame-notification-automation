/** 极简带时间戳的日志工具。 */
function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const log = {
  info: (msg: string, ...args: unknown[]) => console.log(`[${ts()}] ℹ  ${msg}`, ...args),
  step: (msg: string, ...args: unknown[]) => console.log(`[${ts()}] ▶  ${msg}`, ...args),
  ok: (msg: string, ...args: unknown[]) => console.log(`[${ts()}] ✔  ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn(`[${ts()}] ⚠  ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) => console.error(`[${ts()}] ✖  ${msg}`, ...args),
};
