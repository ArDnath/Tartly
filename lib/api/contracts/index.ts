import { agentOperations } from "./agent";
import { assetOperations } from "./assets";
import { campaignOperations } from "./campaigns";
import { inboxOperations } from "./inbox";
import { legacyOperations } from "./legacy";
import { mailOperations } from "./mail";
import { meetingOperations } from "./meetings";
import { createOperationMatcher } from "./registry";
import { settingsOperations } from "./settings";

/**
 * The contract registry (Phase C1). Every operation declares its schemas once;
 * `scripts/openapi/generate.ts` discovers the full route tree and merges these
 * overrides on top, and `withUser` uses `matchOperation` to validate requests
 * before the handler runs.
 */

export const allOperations = [
  ...inboxOperations,
  ...agentOperations,
  ...mailOperations,
  ...settingsOperations,
  ...assetOperations,
  ...meetingOperations,
  ...campaignOperations,
  ...legacyOperations,
];

export const matchOperation = createOperationMatcher(allOperations);

export { contractValidationMode } from "./registry";
export type {
  ContractValidationMode,
  HttpMethod,
  OperationContract,
  SecurityScheme,
} from "./registry";
