import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Unit test project (SKILL §14.1 — the fast 70% of the pyramid).
 *
 * Pure domain logic runs in-memory with no database/Redis: importing a module
 * never opens a connection because nothing calls the pool at module scope.
 * Integration tests (real Postgres via Testcontainers) live in
 * `vitest.integration.config.ts` so `npm run test:unit` stays millisecond-fast.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      // Next aliases these marker packages at build time; mirror that in Node.
      "server-only": `${root}tests/shims/server-only.ts`,
      "client-only": `${root}tests/shims/client-only.ts`,
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
    // Fail on a stray `.only`, which would silently skip the rest of the suite.
    allowOnly: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      // The gate starts on the modules that actually have unit tests and
      // widens as coverage grows. Percentages are computed only over these, so
      // a PR cannot lower the bar by adding an untested module elsewhere.
      include: [
        "lib/security/**/*.ts",
        "lib/db/errors.ts",
        "lib/lifecycle.ts",
        "lib/queue/worker.ts",
        "lib/observability/logger.ts",
        "lib/observability/metrics.ts",
        "lib/observability/trace.ts",
        "lib/api/pagination.ts",
        "lib/api/contracts/registry.ts",
        "lib/api/contracts/validate.ts",
        "lib/api/openapi/**/*.ts",
        "lib/agent/action-hash.ts",
        "lib/guardrails/injection.ts",
        "lib/calendar/parse-when.ts",
        "lib/calendar/tz.ts",
        "lib/followup/rules.ts",
      ],
      exclude: ["**/*.d.ts", "**/index.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
