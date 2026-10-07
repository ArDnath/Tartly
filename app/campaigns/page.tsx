import { PageHeader } from "@/components/app/shell/page-header";
import {
  CampaignList,
  type CampaignListItem,
} from "@/components/app/campaigns/campaign-list";
import { listCampaignsWithStats } from "@/lib/campaigns/service";
import { isCampaignsEnabled } from "@/lib/env";
import { requireSession } from "@/lib/session";

export default async function CampaignsPage() {
  const session = await requireSession();
  const rows = await listCampaignsWithStats(session.user.id);

  const items: CampaignListItem[] = rows.map(({ campaign, stats, total }) => ({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    replyPolicy: campaign.replyPolicy,
    total,
    stats: Object.fromEntries(
      Object.entries(stats).map(([key, value]) => [key, value ?? 0]),
    ),
    createdAt: campaign.createdAt.toISOString(),
  }));

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Campaigns"
        subtitle="Personalized bulk outreach with a review gate and suppression."
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <CampaignList initial={items} enabled={isCampaignsEnabled()} />
      </div>
    </div>
  );
}
