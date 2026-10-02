import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local Vercel build output (generated bundles) is not source.
    ".vercel/**",
    // Vendored AI Elements registry components. They are excluded from
    // tsconfig too and target a newer React Compiler lint ruleset than this
    // app; linting them only produces noise about third-party code.
    "components/ai-elements/**",
  ]),
]);

export default eslintConfig;
