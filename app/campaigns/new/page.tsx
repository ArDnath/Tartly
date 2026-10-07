import { PageHeader } from "@/components/app/shell/page-header";
import { CampaignWizard } from "@/components/app/campaigns/campaign-wizard";
import { isCampaignsEnabled } from "@/lib/env";
import { requireSession } from "@/lib/session";

export default async function NewCampaignPage() {
  await requireSession();

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="New campaign"
        subtitle="Import a sheet, map the columns, compose once — send personalized."
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        {isCampaignsEnabled() ? (
          <CampaignWizard />
        ) : (
          <p className="mx-auto max-w-xl rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Campaigns are disabled in this environment.
          </p>
        )}
      </div>
    </div>
  );
}
