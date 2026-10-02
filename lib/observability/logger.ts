import "server-only";

import { env } from "@/lib/env";

import { getRequestContext } from "./context";

/**
 * Structured JSON logger.
 *
 * One line of JSON per event to `stdout` (`stderr` for `error`/`fatal`), so a
 * log platform can index the mandatory attributes:
 * `timestamp`, `level`, `message`, `trace_id`, `user_id`, `method`, `path`,
 * `status_code`, `latency_ms`.
 *
 * Sensitive keys are redacted before emission, so a stray `token` or `password`
 * in a log field can never leak. The logger never throws: a logging failure
 * must not break the request it is describing.
 */
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type LogFields = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

/** Key names whose values must never reach the log stream. */
const SENSITIVE_KEY =
  /(password|passwd|secret|token|authorization|cookie|api[_-]?key|access[_-]?key|refresh[_-]?token|session[_-]?id|card[_-]?number|ssn|credential)/i;

function minLevel(): number {
  const configured = env.LOG_LEVEL;
  if (configured && configured in LEVELS) {
    return LEVELS[configured as LogLevel];
  }
  // Production stays at `info`; local development gets `debug`.
  return env.NODE_ENV === "production" ? LEVELS.info : LEVELS.debug;
}

/** Deep-scrub a value, preserving structure while masking sensitive keys. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[Truncated]";
  if (value == null) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(nested, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  try {
    if (LEVELS[level] < minLevel()) return;

    const context = getRequestContext();
    const record: Record<string, unknown> = {
      ...((fields ? redact(fields) : {}) as Record<string, unknown>),
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(context
        ? {
            trace_id: context.requestId,
            request_id: context.requestId,
            method: context.method,
            path: context.path,
          }
        : {}),
      ...(context?.userId ? { user_id: context.userId } : {}),
    };

    const line = `${JSON.stringify(record)}\n`;
    if (level === "error" || level === "fatal") {
      process.stderr.write(line);
    } else {
      process.stdout.write(line);
    }
  } catch {
    // Never let observability break the request path.
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit("debug", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
  fatal: (message: string, fields?: LogFields) => emit("fatal", message, fields),
};
