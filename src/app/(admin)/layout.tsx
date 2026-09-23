import { requireAdmin } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { getInternalFeed } from "@/lib/internal-notifications";
import { InternalNotificationBell } from "@/components/internal/internal-notification-bell";
import { isPlannerEnabled, isJarvisEnabled } from "@/lib/flags";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireAdmin();
  const feed = await getInternalFeed(profile.id);

  // Capability, derived from the authenticated user's ACTUAL role (not a display
  // label) + the request-time flag. Clients/reps never reach this layout, so they
  // never receive this capability.
  const canUsePlanner = profile.role === "admin" && isPlannerEnabled();
  const canUseJarvis = profile.role === "admin" && isJarvisEnabled();

  return (
    <AppShell
      roleLabel="Admin"
      context="Bbettr Agency · Administrator"
      canUsePlanner={canUsePlanner}
      canUseJarvis={canUseJarvis}
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
