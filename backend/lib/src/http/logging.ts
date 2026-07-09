// JSON-line structured logging — CloudWatch parses these as searchable fields.

export type LogContext = Record<string, unknown>;

function emit(level: "info" | "warn" | "error", msg: string, ctx?: LogContext): void {
  const line = JSON.stringify({ level, msg, ...ctx });
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const log = {
  info: (msg: string, ctx?: LogContext): void => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext): void => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext): void => emit("error", msg, ctx),
};
