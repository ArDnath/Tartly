import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";
import { stringify as toYaml, parse as parseYaml } from "yaml";

import { allOperations } from "@/lib/api/contracts";
import type {
  HttpMethod,
  OperationContract,
  ResponseSpec,
  SecurityScheme,
} from "@/lib/api/contracts/registry";
import { dataEnvelope } from "@/lib/api/contracts/shared";
import { buildOpenApiDocument } from "@/lib/api/openapi/spec";

/**
 * Generate `openapi.yaml` from the contract registry (Phase C1, SKILL §2.5).
 *
 * Routes are *discovered* from the App Router tree so a new `route.ts` can
 * never be silently missing from the spec. Hand-authored contracts override the
 * discovered default for schemas/summaries/status codes. Use `--check` to fail
 * when the committed spec drifts from the code (run in CI).
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP_DIR = join(ROOT, "app");
const OUTPUT = join(ROOT, "openapi.yaml");

type DiscoveredRoute = {
  method: HttpMethod;
  path: string;
  security: SecurityScheme;
  tag: string;
};

function collectRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectRouteFiles(full, out);
    } else if (entry === "route.ts") {
      out.push(full);
    }
  }
  return out;
}

function toTemplatePath(file: string): string {
  const dir = dirname(relative(APP_DIR, file)).replace(/\\/g, "/");
  const segments = dir
    .split("/")
    .map((segment) => {
      const dynamic = /^\[(\.\.\.)?([^\]]+)\]$/.exec(segment);
      return dynamic ? `{${dynamic[2]}}` : segment;
    });
  return `/${segments.join("/")}`;
}

function deriveTag(path: string): string {
  const parsed = path.split("/").filter(Boolean); // ["api","v1","inbox",...]
  const start = parsed[1] === "v1" ? 2 : 1;
  return parsed[start] ?? "api";
}

function deriveSecurity(path: string, source: string): SecurityScheme {
  if (path.startsWith("/api/v1/cron")) return "cron";
  if (path.startsWith("/api/webhooks")) return "webhook";
  if (source.includes("withUser(") || source.includes("withMailUser(")) {
    return "session";
  }
  return "public";
}

function operationId(method: HttpMethod, path: string): string {
  const words = path
    .replace(/[{}]/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1));
  return `${method.toLowerCase()}${words.join("")}`;
}

function discoverRoutes(): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const file of collectRouteFiles(APP_DIR)) {
    const path = toTemplatePath(file);
    // Better Auth owns its own catch-all contract.
    if (path.startsWith("/api/auth")) continue;
    const source = readFileSync(file, "utf8");
    const security = deriveSecurity(path, source);
    const tag = deriveTag(path);
    const methods = new Set(
      [...source.matchAll(/\bexport\s+(?:const|async\s+function)\s+([A-Z]+)\b/g)]
        .map((match) => match[1])
        .filter((value): value is HttpMethod =>
          ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(value),
        ),
    );
    for (const method of methods) routes.push({ method, path, security, tag });
  }
  return routes;
}

function withImplicitParams(operation: OperationContract): OperationContract {
  if (operation.params) return operation;
  const names = [...operation.path.matchAll(/\{([^}]+)\}/g)].map(
    (match) => match[1]!,
  );
  if (names.length === 0) return operation;
  const shape: Record<string, z.ZodType> = {};
  for (const name of names) shape[name] = z.string().min(1);
  return { ...operation, params: z.object(shape) };
}

function defaultOperation(route: DiscoveredRoute): OperationContract {
  const responses: Record<number, ResponseSpec> =
    route.method === "DELETE"
      ? { 204: { description: "Deleted; no content." } }
      : route.method === "POST"
        ? {
            201: {
              description: "Created.",
              schema: dataEnvelope(z.unknown()),
            },
          }
        : {
            200: {
              description: "Success.",
              schema: dataEnvelope(z.unknown()),
            },
          };
  return {
    method: route.method,
    path: route.path,
    operationId: operationId(route.method, route.path),
    tags: [route.tag],
    summary: `${route.method} ${route.path}`,
    security: route.security,
    responses,
  };
}

function buildOperations(): OperationContract[] {
  const overrides = new Map(
    allOperations.map((operation) => [
      `${operation.method} ${operation.path}`,
      operation,
    ]),
  );

  const operations = discoverRoutes().map((route) => {
    const key = `${route.method} ${route.path}`;
    const override = overrides.get(key);
    if (override) overrides.delete(key);
    return withImplicitParams(override ?? defaultOperation(route));
  });

  if (overrides.size > 0) {
    const orphans = [...overrides.keys()].sort().join(", ");
    throw new Error(
      `Contract overrides match no route (fix path/method): ${orphans}`,
    );
  }

  return operations;
}

function packageVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as { version?: string };
  return pkg.version ?? "0.0.0";
}

function render(): string {
  const document = buildOpenApiDocument(buildOperations(), {
    version: packageVersion(),
    title: "Tartly API",
    description:
      "AI email operator over Gmail + Google Calendar. Cookie-session auth, " +
      "`{ data }` / `{ data, pagination }` / `{ error }` envelopes.",
    servers: [
      { url: "https://apemail.ariyaman.in", description: "Production" },
      { url: "http://localhost:3000", description: "Local" },
    ],
  });
  return toYaml(document, {
    lineWidth: 0,
    sortMapEntries: false,
    // Emit repeated objects (e.g. the 900+ `$ref` error responses) verbatim
    // instead of YAML anchors/aliases: many OpenAPI parsers enforce a low
    // `maxAliasCount` and reject an alias-heavy document.
    aliasDuplicateObjects: false,
  });
}

function main(): void {
  const check = process.argv.includes("--check");
  const rendered = render();

  if (check) {
    let committed: string;
    try {
      committed = readFileSync(OUTPUT, "utf8");
    } catch {
      console.error("openapi.yaml is missing. Run `npm run openapi:generate`.");
      process.exit(1);
    }
    if (committed !== rendered) {
      const diff = firstDifference(committed, rendered);
      console.error(
        `openapi.yaml is out of date (first difference at line ${diff}).\n` +
          "Run `npm run openapi:generate` and commit the result.",
      );
      process.exit(1);
    }
    // Parse with a strict alias budget: an anchor-heavy document can be valid
    // YAML yet rejected by the parsers most OpenAPI tooling uses.
    try {
      parseYaml(committed);
    } catch (error) {
      console.error("openapi.yaml is not portable YAML:", error);
      process.exit(1);
    }
    console.log("openapi.yaml is in sync with the contract registry.");
    return;
  }

  writeFileSync(OUTPUT, rendered, "utf8");
  console.log(`Wrote ${relative(ROOT, OUTPUT)} (${rendered.split("\n").length} lines).`);
}

function firstDifference(a: string, b: string): number {
  const left = a.split("\n");
  const right = b.split("\n");
  const max = Math.max(left.length, right.length);
  for (let index = 0; index < max; index += 1) {
    if (left[index] !== right[index]) return index + 1;
  }
  return max;
}

main();
