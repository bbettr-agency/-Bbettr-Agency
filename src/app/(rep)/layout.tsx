import { requireRep } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { getInternalFeed } from "@/lib/internal-notifications";
import { InternalNotificationBell } from "@/components/internal/internal-notification-bell";

export default async function RepLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRep();
  const feed = await getInternalFeed(profile.id);

  return (
    <AppShell
      roleLabel="Rep"
      context="Sales Rep"
      headerSlot={
        <InternalNotificationBell
          notifications={feed.items}
          unreadCount={feed.unreadCount}
        />
      }
      user={{
        name: profile.full_name ?? "Sales Rep",
        email: profile.email ?? "",
        avatarUrl: profile.avatar_url,
      }}
    >
      {children}
    </AppShell>
  );
}
