import { apiError } from "@/lib/api/http";

import type { AssetError } from "./service";

/**
 * One mapping from asset-domain failures to HTTP responses, shared by the
 * library routes and the mail-attachment importer. Keeping it here prevents the
 * two surfaces from drifting (a 413 in one place and a 400 in another).
 */
export const ASSET_ERROR_MESSAGES: Record<AssetError, string> = {
  disabled: "Assets are disabled.",
  storage_unconfigured: "Asset storage is not configured.",
  too_large: "That file is too large.",
  unsupported_type: "That file type isn't allowed.",
  empty: "The file is empty.",
  invalid: "That upload could not be verified.",
  infected: "That file failed a security scan and was rejected.",
};

export const ASSET_ERROR_STATUS: Record<AssetError, number> = {
  disabled: 403,
  storage_unconfigured: 503,
  too_large: 413,
  unsupported_type: 400,
  empty: 400,
  invalid: 400,
  infected: 422,
};

export function assetErrorResponse(error: AssetError): Response {
  return apiError(
    error,
    ASSET_ERROR_MESSAGES[error],
    ASSET_ERROR_STATUS[error],
  );
}
