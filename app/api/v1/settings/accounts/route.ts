import { ok, withUser } from "@/lib/api/http";
import { listConnectedAccounts } from "@/lib/mail/accounts";

/**
 * The user's connected mail accounts (Gmail + Outlook). Drives the "connected
 * accounts" settings surface, including connect/reconnect affordances.
 */
export const GET = withUser(async (userId) => {
  return ok({ accounts: await listConnectedAccounts(userId) });
});
