import { PageHeader } from "@/components/app-shell/page-header";
import { FollowupList } from "@/components/followups/followup-list";
import { listFollowups } from "@/lib/followup/service";
import { requireSession } from "@/lib/session";

export default async function FollowupsPage() {
  const session = await requireSession();
  const items = await listFollowups(session.user.id);
  const active = items.filter((item) => item.status === "active").length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Follow-ups"
        subtitle={`${active} active · your assistant nudges threads that go quiet.`}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <FollowupList items={items} />
      </div>
    </div>
  );
}
