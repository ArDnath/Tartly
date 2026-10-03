import type { ZodError, ZodType } from "zod";

import type { OperationContract } from "./registry";

/**
 * Inbound request validation against a registered contract (Phase C1, SKILL
 * §2.5/§3.1). Pure and dependency-free so it can be unit-tested directly.
 */

export type ValidationTarget = "params" | "query" | "body";

export type ValidationIssue = {
  target: ValidationTarget;
  /** Dot-joined path within the target, or the target name at the root. */
  path: string;
  message: string;
  code: string;
};

export type InboundRequest = {
  searchParams: URLSearchParams;
  params: Record<string, string>;
  /** Parsed JSON body, present only for JSON requests with a body. */
  body?: unknown;
  hasBody: boolean;
};

/** Collapse `URLSearchParams` to a plain object; repeated keys become arrays. */
export function buildQueryObject(
  searchParams: URLSearchParams,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    out[key] = values.length > 1 ? values : values[0];
  }
  return out;
}

function toIssues(target: ValidationTarget, error: ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    target,
    path: issue.path.map((segment) => String(segment)).join(".") || target,
    message: issue.message,
    code: issue.code,
  }));
}

function check(
  target: ValidationTarget,
  schema: ZodType | undefined,
  value: unknown,
): ValidationIssue[] {
  if (!schema) return [];
  const parsed = schema.safeParse(value);
  return parsed.success ? [] : toIssues(target, parsed.error);
}

/**
 * Validate the request parts a contract declares. Returns an empty array when
 * the request conforms (or when the contract declares no constraints).
 */
export function validateInbound(
  operation: OperationContract,
  inbound: InboundRequest,
): ValidationIssue[] {
  return [
    ...check("params", operation.params, inbound.params),
    ...check("query", operation.query, buildQueryObject(inbound.searchParams)),
    ...(operation.body && inbound.hasBody
      ? check("body", operation.body, inbound.body)
      : []),
  ];
}
