import { readFileSync } from "node:fs";

import { parse as parseYaml } from "yaml";

import { findBreakingChanges } from "@/lib/api/openapi/breaking";

/**
 * Fail when the working `openapi.yaml` removes or narrows anything the baseline
 * spec promised (Phase C1, SKILL §15.2 item 4). `--base` is the spec at the
 * merge-base; `--head` defaults to the working `openapi.yaml`.
 *
 * Usage: tsx scripts/openapi/breaking-check.ts --base <old.yaml> [--head new.yaml]
 */

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadSpec(path: string): unknown {
  return parseYaml(readFileSync(path, "utf8"));
}

function main(): void {
  const basePath = argValue("--base");
  const headPath = argValue("--head") ?? "openapi.yaml";

  if (!basePath) {
    console.log("No OpenAPI baseline supplied; skipping breaking-change check.");
    return;
  }

  let base: unknown;
  try {
    base = loadSpec(basePath);
  } catch {
    console.log(`Baseline spec ${basePath} is unreadable; skipping.`);
    return;
  }

  const breaking = findBreakingChanges(base, loadSpec(headPath));
  if (breaking.length === 0) {
    console.log("No breaking OpenAPI changes detected.");
    return;
  }

  console.error(`Detected ${breaking.length} breaking OpenAPI change(s):`);
  for (const change of breaking) console.error(`  - ${change}`);
  process.exit(1);
}

main();
