import { getFailureCount, cleanupStaleTestUsers } from "./harness";
import { run as runPhase1 } from "./phase1-gmail";
import { run as runPhase2 } from "./phase2-engine-queue";
import { run as runPhase3 } from "./phase3-inbox";
import { run as runPhase4 } from "./phase4-meetings";
import { run as runPhase5 } from "./phase5-followups";
import { run as runPhase6 } from "./phase6-guardrails";
import { run as runPhase8 } from "./phase8-briefing";
import { run as runPhaseAutopilot } from "./phase-autopilot";
import { run as runPhase2Intelligence } from "./evals/phase2-intelligence";
import { run as runPhase3Rules } from "./evals/phase3-rules";
import { run as runPhase4Comms } from "./evals/phase4-comms";
import { run as runPhase5Insights } from "./evals/phase5-insights";
import { run as runPhase6Assets } from "./evals/phase6-assets";
import { run as runPhase7Campaigns } from "./evals/phase7-campaigns";

/**
 * Runs every email-operator phase test in order. Each phase is independently
 * runnable (`tsx scripts/email-operator/phaseN-*.ts`) and this file is the
 * single command CI/`npm run test:email-operator` uses.
 */
async function main() {
  // Clear debris from any crashed previous run before asserting anything.
  await cleanupStaleTestUsers();

  await runPhase1();
  await runPhase2();
  await runPhase3();
  await runPhase4();
  await runPhase5();
  await runPhase6();
  await runPhase2Intelligence();
  await runPhase3Rules();
  await runPhase4Comms();
  await runPhase5Insights();
  await runPhase6Assets();
  await runPhase7Campaigns();
  await runPhase8();
  await runPhaseAutopilot();

  const failures = getFailureCount();
  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }

  console.log("\nAll email-operator phase checks passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
