import type { Metadata } from "next";
import { Megaphone } from "lucide-react";
import { requireClient } from "@/lib/auth";
import { getUpdates } from "@/lib/queries";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { UpdatesTimeline } from "@/components/updates/updates-timeline";

export const metadata: Metadata = { title: "Updates" };

export default async function UpdatesPage() {
  const profile = await requireClient();
  const updates = await getUpdates(profile.client_id);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Updates"
        description="A live feed of everything happening on your projects."
      />

      {updates.length > 0 ? (
        <div className="max-w-3xl">
          <UpdatesTimeline updates={updates} />
        </div>
      ) : (
        <EmptyState
          icon={Megaphone}
          title="No updates yet"
          description="Your Bbettr Agency team will post progress updates here as work happens."
        />
      )}
    </div>
  );
}
