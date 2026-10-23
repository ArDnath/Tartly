import { ConnectedAccounts } from "@/components/app/settings/connected-accounts";
import { listConnectedAccounts } from "@/lib/mail/accounts";
import { requireSession } from "@/lib/session";

/**
 * Connected-accounts settings body. Shared by the full `/settings/accounts`
 * page and the intercepted settings modal, so both render the same panel.
 */
export async function AccountsSettingsSection() {
  const session = await requireSession();
  const accounts = await listConnectedAccounts(session.user.id);

  return <ConnectedAccounts accounts={accounts} />;
}
