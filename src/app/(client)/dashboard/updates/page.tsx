import type { Metadata } from "next";
import { SeenMarker } from "@/components/shared/seen-marker";
import { Megaphone } from "lucide-react";
import { requireClient } from "@/lib/auth";
import { getUpdates, getUpdateReactions } from "@/lib/queries";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { UpdatesTimeline } from "@/components/updates/updates-timeline";

export const metadata: Metadata = { title: "Updates" };

export default async function UpdatesPage() {
  const profile = await requireClient();
  const updates = await getUpdates(profile.client_id);
  const reactions = await getUpdateReactions(
    updates.map((u) => u.id),
    profile.id
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <SeenMarker section="updates" />
      <PageHeader
        title="Updates"
        description="A live feed of everything happening on your projects."
      />

      {updates.length > 0 ? (
        <div className="max-w-3xl">
          <UpdatesTimeline updates={updates} reactions={reactions} interactive />
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
