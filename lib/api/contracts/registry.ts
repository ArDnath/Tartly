import { z } from "zod";

/**
 * Contract registry (Phase C1, SKILL §2.5).
 *
 * The single source of truth for the API contract is the set of Zod schemas
 * referenced here — not a hand-written `openapi.yaml`. Every operation declares
 * its method, path template, request shapes and responses once; the same
 * `OperationContract` object drives:
 *
 *  1. **Runtime validation** — `withUser` matches the inbound request against
 *     the registered contract before the handler runs (`lib/api/contracts/validate.ts`).
 *  2. **Spec generation** — `scripts/openapi/generate.ts` turns the registry
 *     into `openapi.yaml` via `z.toJSONSchema()`.
 *  3. **Breaking-change detection** — `scripts/openapi/breaking-check.ts`.
 *
 * This module is deliberately client-safe (Zod only, no Next/server imports) so
 * both the Node scripts and the route runtime can import it.
 */

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * How a route authenticates. `session` = Better Auth cookie (`withUser` /
 * `withMailUser`); `cron` = Vercel bearer `CRON_SECRET`; `webhook` = Google
 * OIDC bearer; `public` = unauthenticated (health probes).
 */
export type SecurityScheme = "session" | "cron" | "webhook" | "public";

export type ResponseSpec = {
  description: string;
  /** JSON body schema. Omit for `204`/binary/streaming responses. */
  schema?: z.ZodType;
  /** Media type; defaults to `application/json`. */
  contentType?: string;
};

export type OperationContract = {
  method: HttpMethod;
  /** OpenAPI path template, e.g. `/api/v1/inbox/{threadId}`. */
  path: string;
  operationId: string;
  tags: string[];
  summary: string;
  description?: string;
  security: SecurityScheme;
  deprecated?: boolean;
  /** Path params object. */
  params?: z.ZodType;
  /** Query string object. */
  query?: z.ZodType;
  /** JSON request body. */
  body?: z.ZodType;
  /** At least the success response; error responses are added by the generator. */
  responses: Record<number, ResponseSpec>;
};

export function defineOperation(op: OperationContract): OperationContract {
  if (!op.path.startsWith("/")) {
    throw new Error(`Operation path must start with "/": ${op.path}`);
  }
  if (op.tags.length === 0) {
    throw new Error(`Operation ${op.method} ${op.path} needs at least one tag`);
  }
  return op;
}

export type MatchedOperation = {
  operation: OperationContract;
  params: Record<string, string>;
};

type CompiledOperation = {
  regex: RegExp;
  names: string[];
  operation: OperationContract;
};

/** Turn `/api/v1/inbox/{threadId}` into a matcher; `{x}` captures one segment. */
function compilePath(template: string): { regex: RegExp; names: string[] } {
  const names: string[] = [];
  const pattern = template
    .split("/")
    .map((segment) => {
      const dynamic = /^\{([A-Za-z0-9_]+)\}$/.exec(segment);
      if (dynamic) {
        names.push(dynamic[1]);
        return "([^/]+)";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return { regex: new RegExp(`^${pattern}/?$`), names };
}

/**
 * Build an exact (method, path-template) matcher. Path params are URL-decoded
 * so a `%2F`-escaped segment is still one param, not two.
 */
export function createOperationMatcher(operations: readonly OperationContract[]) {
  const compiled: CompiledOperation[] = operations.map((operation) => ({
    ...compilePath(operation.path),
    operation,
  }));

  return function match(
    method: string,
    pathname: string,
  ): MatchedOperation | null {
    let best: { entry: CompiledOperation; result: RegExpExecArray } | null = null;
    for (const entry of compiled) {
      if (entry.operation.method !== method) continue;
      const result = entry.regex.exec(pathname);
      if (!result) continue;
      // Prefer the most specific template (fewest `{param}` segments), then the
      // longest literal path, so `/campaigns/suppression` beats `/campaigns/{id}`.
      if (
        !best ||
        entry.names.length < best.entry.names.length ||
        (entry.names.length === best.entry.names.length &&
          entry.operation.path.length > best.entry.operation.path.length)
      ) {
        best = { entry, result };
      }
    }
    if (!best) return null;
    const params: Record<string, string> = {};
    best.entry.names.forEach((name, index) => {
      params[name] = decodeURIComponent(best!.result[index + 1] ?? "");
    });
    return { operation: best.entry.operation, params };
  };
}

export type ContractValidationMode = "off" | "warn" | "enforce";

/**
 * `API_CONTRACT_VALIDATION` = `off` | `warn` | `enforce`.
 *
 * Default is **enforce** everywhere. The schemas burned in behind `warn` in
 * production while C1 landed, and the schema *drift* risk was closed by having
 * the legacy raw handlers import their Zod schema from the registry, so an
 * invalid inbound request now fails fast with a `400`. Set
 * `API_CONTRACT_VALIDATION=warn` (log-only) or `off` to relax it without a
 * deploy.
 */
export function contractValidationMode(): ContractValidationMode {
  const raw = process.env.API_CONTRACT_VALIDATION?.trim().toLowerCase();
  if (raw === "off" || raw === "warn" || raw === "enforce") return raw;
  return "enforce";
}
