import type { Metadata } from "next";
import Link from "next/link";
import { format } from "date-fns";
import { Megaphone } from "lucide-react";
import { getRecentUpdatesGlobal } from "@/lib/admin-queries";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "All Updates" };

export default async function AdminUpdatesPage() {
  const updates = await getRecentUpdatesGlobal(100);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        title="Updates"
        description="Every update posted across all clients. Post new updates from a client's page."
      />

      {updates.length > 0 ? (
        <div className="space-y-3">
          {updates.map((u) => {
            const clientName =
              (u.clients as { name: string } | null)?.name ?? "Client";
            return (
              <Card key={u.id}>
                <CardContent className="flex items-start gap-4 p-5">
                  <Avatar name={clientName} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link
                        href={`/admin/clients/${u.client_id}`}
                        className="text-sm font-semibold text-ink-900 hover:text-brand-600"
                      >
                        {u.title}
                      </Link>
                      <span className="text-xs text-ink-400">
                        {clientName} · {format(new Date(u.published_at), "d MMM yyyy")}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-600">
                      {u.body}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={Megaphone}
          title="No updates yet"
          description="Open a client and post their first update."
        />
      )}
    </div>
  );
}
