import { requireRep, isRepActive } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import { getInternalFeed } from "@/lib/internal-notifications";
import { InternalNotificationBell } from "@/components/internal/internal-notification-bell";
import { RepDisabledScreen } from "@/components/rep/rep-disabled-screen";

export default async function RepLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireRep();

  // Deactivated reps are blocked from the entire portal (this layout wraps every
  // rep page). They see a branded notice with a sign-out link, not the portal.
  if (!(await isRepActive(profile.id))) {
    return <RepDisabledScreen />;
  }

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
