import type { JsonSchema } from "./zod-schema";

/**
 * Minimal, dependency-free OpenAPI breaking-change detector (Phase C1, SKILL
 * §15.2 item 4). It compares two generated specs and reports the changes that
 * break existing clients. It deliberately ignores additive changes (new paths,
 * new optional fields, new response codes).
 *
 * Kept in `lib/` rather than `scripts/` so it is unit-tested under coverage.
 */

type JsonObject = Record<string, unknown>;

type ParameterObject = {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: JsonSchema;
};

type OperationObject = {
  responses?: Record<string, unknown>;
  parameters?: ParameterObject[];
  requestBody?: { content?: Record<string, { schema?: JsonSchema }> };
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function jsonBodySchema(operation: OperationObject): JsonSchema | undefined {
  const schema = operation.requestBody?.content?.["application/json"]?.schema;
  return isObject(schema) ? schema : undefined;
}

function describeParameter(parameter: ParameterObject): string {
  return `${parameter.in ?? "?"}:${parameter.name ?? "?"}`;
}

function compareSchema(
  where: string,
  base: JsonSchema,
  next: JsonSchema,
  changes: string[],
): void {
  if (typeof base.type === "string" && typeof next.type === "string") {
    if (base.type !== next.type) {
      changes.push(
        `${where}: type changed from "${base.type}" to "${next.type}"`,
      );
    }
  }

  if (Array.isArray(base.enum) && Array.isArray(next.enum)) {
    for (const value of base.enum) {
      if (!next.enum.includes(value)) {
        changes.push(`${where}: removed enum value ${JSON.stringify(value)}`);
      }
    }
  }

  if (base.type === "object" && next.type === "object") {
    const baseRequired = Array.isArray(base.required)
      ? (base.required as unknown[])
      : [];
    const nextRequired = Array.isArray(next.required)
      ? (next.required as unknown[])
      : [];
    for (const key of nextRequired) {
      if (!baseRequired.includes(key)) {
        changes.push(`${where}: new required property "${String(key)}"`);
      }
    }
    const baseProps = asObject(base.properties);
    const nextProps = asObject(next.properties);
    for (const key of Object.keys(baseProps)) {
      const baseChild = baseProps[key];
      const nextChild = nextProps[key];
      if (isObject(baseChild) && isObject(nextChild)) {
        compareSchema(`${where}.${key}`, baseChild, nextChild, changes);
      }
    }
  }
}

function compareOperation(
  label: string,
  base: OperationObject,
  next: OperationObject,
  changes: string[],
): void {
  const baseResponses = asObject(base.responses);
  const nextResponses = asObject(next.responses);
  for (const status of Object.keys(baseResponses)) {
    if (!(status in nextResponses)) {
      changes.push(`${label}: removed response ${status}`);
    }
  }

  const baseParams = new Map(
    (base.parameters ?? []).map((parameter) => [
      describeParameter(parameter),
      parameter,
    ]),
  );
  const nextParams = new Map(
    (next.parameters ?? []).map((parameter) => [
      describeParameter(parameter),
      parameter,
    ]),
  );
  for (const [key, baseParam] of baseParams) {
    const nextParam = nextParams.get(key);
    if (!nextParam) {
      if (baseParam.in === "path") {
        changes.push(`${label}: removed path parameter ${key}`);
      }
      continue;
    }
    if (!baseParam.required && nextParam.required) {
      changes.push(`${label}: parameter became required (${key})`);
    }
    if (baseParam.schema && nextParam.schema) {
      compareSchema(`${label} [${key}]`, baseParam.schema, nextParam.schema, changes);
    }
  }

  const baseBody = jsonBodySchema(base);
  const nextBody = jsonBodySchema(next);
  if (baseBody && nextBody) {
    compareSchema(`${label}:requestBody`, baseBody, nextBody, changes);
  } else if (!baseBody && nextBody) {
    const required = Array.isArray(nextBody.required) && nextBody.required.length > 0;
    if (required) {
      changes.push(`${label}: introduced a request body with required fields`);
    }
  } else if (baseBody && !nextBody) {
    // Removing an accepted request body is not client-breaking by itself.
  }
}

export function findBreakingChanges(
  base: unknown,
  next: unknown,
): string[] {
  const changes: string[] = [];
  const basePaths = asObject(asObject(base).paths);
  const nextPaths = asObject(asObject(next).paths);

  for (const path of Object.keys(basePaths)) {
    const basePathItem = asObject(basePaths[path]);
    const nextPathItem = asObject(nextPaths[path]);
    if (Object.keys(nextPathItem).length === 0) {
      changes.push(`Removed path ${path}`);
      continue;
    }
    for (const method of Object.keys(basePathItem)) {
      const baseOperation = asObject(basePathItem[method]) as OperationObject;
      const nextOperation = nextPathItem[method];
      if (!isObject(nextOperation)) {
        changes.push(`Removed operation ${method.toUpperCase()} ${path}`);
        continue;
      }
      compareOperation(
        `${method.toUpperCase()} ${path}`,
        baseOperation,
        nextOperation as OperationObject,
        changes,
      );
    }
  }

  return changes;
}
