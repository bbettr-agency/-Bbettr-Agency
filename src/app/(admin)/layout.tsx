import { requireAdmin } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { getInternalFeed } from "@/lib/internal-notifications";
import { InternalNotificationBell } from "@/components/internal/internal-notification-bell";

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
