import { BillingSettings } from "@/components/app/settings/billing-settings";
import { getBillingOverview } from "@/lib/billing/overview";
import { requireSession } from "@/lib/session";

/**
 * Billing settings body. Shared by the full `/settings/billing` page and the
 * intercepted settings modal, so both render the same snapshot. The server
 * assembles the overview once; the client component owns the refresh and the
 * portal/checkout actions.
 */
export async function BillingSettingsSection() {
  const session = await requireSession();
  const overview = await getBillingOverview(session.user.id);

  return <BillingSettings initial={overview} />;
}
