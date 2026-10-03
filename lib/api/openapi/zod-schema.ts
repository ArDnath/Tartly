import { z } from "zod";

/**
 * Zod → JSON Schema (OpenAPI 3.1) conversion helpers (Phase C1).
 *
 * OpenAPI 3.1 schemas are JSON Schema 2020-12, which Zod 4 emits natively via
 * `z.toJSONSchema()`. We strip the `$schema` keyword because a component/
 * parameter schema must not declare its dialect.
 */

export type JsonSchema = Record<string, unknown>;

export function toJsonSchema(
  schema: z.ZodType,
  io: "input" | "output",
): JsonSchema {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    // `z.date()`, `z.map()` and friends have no JSON representation; `any`
    // keeps the document valid rather than throwing at generation time.
    unrepresentable: "any",
  }) as JsonSchema;
  delete json.$schema;
  return json;
}

/**
 * Split an object schema into OpenAPI `parameters`. Query/path objects are
 * always objects; a non-object schema yields no parameters.
 */
export function schemaProperties(schema: z.ZodType): {
  properties: Record<string, JsonSchema>;
  required: string[];
} {
  const json = toJsonSchema(schema, "input");
  const properties =
    json.type === "object" && json.properties && typeof json.properties === "object"
      ? (json.properties as Record<string, JsonSchema>)
      : {};
  const required = Array.isArray(json.required)
    ? (json.required as string[])
    : [];
  return { properties, required };
}
