import { requireAdmin } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { getInternalFeed } from "@/lib/internal-notifications";
import { InternalNotificationBell } from "@/components/internal/internal-notification-bell";
import { PLANNER_ENABLED } from "@/lib/flags";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireAdmin();
  const feed = await getInternalFeed(profile.id);

  return (
    <AppShell
      roleLabel="Admin"
      context="Bbettr Agency · Administrator"
      plannerEnabled={PLANNER_ENABLED}
      headerSlot={
        <InternalNotificationBell
          notifications={feed.items}
          unreadCount={feed.unreadCount}
        />
      }
      user={{
        name: profile.full_name ?? "Admin",
        email: profile.email ?? "",
        avatarUrl: profile.avatar_url,
      }}
    >
      {children}
    </AppShell>
  );
}
