import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Integration test project (SKILL §14.1 — the containerised 20%).
 *
 * Each suite provisions its own throwaway Postgres via Testcontainers and runs
 * the real Drizzle migrations, so SQL constraints/partial indexes are exercised
 * against the engine that will run them in production — never an in-memory
 * fake. Requires Docker; CI's `ubuntu-latest` provides it.
 *
 * Kept in a separate config so `npm run test:unit` stays millisecond-fast and
 * does not require a container runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": root,
      "server-only": `${root}tests/shims/server-only.ts`,
      "client-only": `${root}tests/shims/client-only.ts`,
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/integration/**/*.test.ts"],
    // Containers boot and migrations run once per file; allow generous hooks.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // One Postgres per suite is plenty; avoid N parallel pulls/boots.
    fileParallelism: false,
    pool: "forks",
  },
});
