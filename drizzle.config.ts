import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Falls back to a local placeholder so `drizzle-kit` CLI doesn't crash
    // before real env is configured. Set DATABASE_URL in .env.
    url:
      process.env.DATABASE_URL ??
      "postgresql://postgres:postgres@localhost:5432/app",
  },
});
