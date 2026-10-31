/**
 * Shared outbound-asset limits.
 *
 * Kept free of `server-only` so the API contract, the server resolver and the
 * composer all enforce the same ceiling. A message may reference at most this
 * many library assets in total (attachments plus inline images).
 */
export const MAX_OUTBOUND_ASSETS = 20;
