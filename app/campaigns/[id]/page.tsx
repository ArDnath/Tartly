import { notFound } from "next/navigation";

import { PageHeader } from "@/components/app-shell/page-header";
import { CampaignDetail } from "@/components/campaigns/campaign-detail";
import {
  campaignStats,
  getCampaign,
  listRecipients,
} from "@/lib/campaigns/service";
import { isCampaignsEnabled } from "@/lib/env";
import { requireSession } from "@/lib/session";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;

  const campaign = await getCampaign({ userId: session.user.id, campaignId: id });
  if (!campaign) notFound();

  const [stats, recipients] = await Promise.all([
    campaignStats(id),
    listRecipients({ campaignId: id, userId: session.user.id }),
  ]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title={campaign.name} subtitle="Review, start, and monitor this campaign." />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <CampaignDetail
          campaign={{
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            template: campaign.template,
            replyPolicy: campaign.replyPolicy,
            footerAddress: campaign.footerAddress,
            throttlePerHour: campaign.throttlePerHour,
          }}
          stats={{ total: stats.total, byStatus: stats.byStatus }}
          recipients={recipients.map((recipient) => ({
            id: recipient.id,
            email: recipient.email,
            name: recipient.name,
            status: recipient.status,
            attempts: recipient.attempts,
            lastError: recipient.lastError,
            sentAt: recipient.sentAt?.toISOString() ?? null,
          }))}
          enabled={isCampaignsEnabled()}
        />
      </div>
    </div>
  );
}
