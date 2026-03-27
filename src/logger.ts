/**
 * Lightweight structured logger.
 *
 * - Always writes to stderr (stdout is reserved for JSON-RPC in stdio mode)
 * - Logs as JSON lines for machine parseability
 * - Includes timestamp, level, and message
 */
export type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...data,
  };
  process.stderr.write(JSON.stringify(entry) + '\n');
}
