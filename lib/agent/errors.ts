/**
 * Application error taxonomy for the agent runtime.
 *
 * Rules:
 *  - `expose: true` means the message is safe to show a user as-is.
 *  - Provider/DB/stack detail is never exposed; it stays in `detail` for logs.
 *  - Every route boundary funnels through `toSafeError` so a thrown
 *    `GmailApiError` or a raw Postgres error can never reach the client body.
 */

export type AppErrorCode =
  | "unauthorized"
  | "forbidden"
  | "validation"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "provider_error"
  | "external_service"
  | "tool_error"
  | "agent_error"
  | "internal";

export interface AppErrorOptions {
  code?: AppErrorCode;
  httpStatus?: number;
  /** Whether `message` may be returned to the client verbatim. */
  expose?: boolean;
  /** Non-serialized context for logs only. */
  detail?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly expose: boolean;
  readonly detail?: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? "internal";
    this.httpStatus = options.httpStatus ?? 500;
    this.expose = options.expose ?? false;
    this.detail = options.detail;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "Unauthorized", options: AppErrorOptions = {}) {
    super(message, { code: "unauthorized", httpStatus: 401, expose: true, ...options });
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "You do not have access to this resource.", options: AppErrorOptions = {}) {
    super(message, { code: "forbidden", httpStatus: 403, expose: true, ...options });
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid request.", options: AppErrorOptions = {}) {
    super(message, { code: "validation", httpStatus: 400, expose: true, ...options });
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found.", options: AppErrorOptions = {}) {
    super(message, { code: "not_found", httpStatus: 404, expose: true, ...options });
  }
}

export class ConflictError extends AppError {
  constructor(message = "The resource changed while you were working.", options: AppErrorOptions = {}) {
    super(message, { code: "conflict", httpStatus: 409, expose: true, ...options });
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please slow down.", options: AppErrorOptions = {}) {
    super(message, { code: "rate_limited", httpStatus: 429, expose: true, ...options });
  }
}

export class ProviderError extends AppError {
  constructor(message = "The AI provider is unavailable.", options: AppErrorOptions = {}) {
    super(message, { code: "provider_error", httpStatus: 502, expose: false, ...options });
  }
}

export class ExternalServiceError extends AppError {
  constructor(message = "An upstream service failed.", options: AppErrorOptions = {}) {
    super(message, { code: "external_service", httpStatus: 502, expose: false, ...options });
  }
}

export class AgentError extends AppError {
  constructor(message = "The assistant run failed.", options: AppErrorOptions = {}) {
    super(message, { code: "agent_error", httpStatus: 500, expose: false, ...options });
  }
}

/**
 * A failure inside one tool call. The message *is* shown to the model (and
 * surfaced in the tool UI), so it must be written for that audience and must
 * never embed provider payloads or secrets.
 */
export class ToolExecutionError extends AppError {
  readonly toolName: string;

  constructor(
    toolName: string,
    message: string,
    options: AppErrorOptions = {},
  ) {
    super(message, { code: "tool_error", httpStatus: 400, expose: true, ...options });
    this.toolName = toolName;
  }
}

export type SafeError = {
  code: AppErrorCode;
  message: string;
  httpStatus: number;
};

/** Collapse any thrown value into a client-safe `{ code, message, httpStatus }`. */
export function toSafeError(error: unknown): SafeError {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.expose ? error.message : "Something went wrong.",
      httpStatus: error.httpStatus,
    };
  }
  return { code: "internal", message: "Something went wrong.", httpStatus: 500 };
}
