import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  isOnboardingComplete,
  getClientNotifications,
  getClientNotificationFeed,
  NOTIFY_SECTIONS,
  SECTION_HREF,
} from "@/lib/queries";
import { AppShell, type NavBadges } from "@/components/layout/app-shell";
import { getPortalSettings } from "@/lib/settings";
import { MaintenanceScreen } from "@/components/client/maintenance-screen";
import { NotificationBell } from "@/components/client/notification-bell";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // requireClient redirects admins to /admin, so this layout (and the
  // maintenance gate below) only ever applies to client users.
  const profile = await requireClient();

  // Maintenance mode gate — clients see the notice; admins are unaffected
  // (they never reach this layout). Auth/login routes are a separate group.
  const settings = await getPortalSettings();
  if (settings.maintenanceMode) {
    return <MaintenanceScreen message={settings.maintenanceMessage} />;
  }

  const supabase = await createClient();

  const [{ data: client }, { data: services }, notifications, feed] =
    await Promise.all([
      supabase
        .from("clients")
        .select("name")
        .eq("id", profile.client_id)
        .single(),
      supabase
        .from("client_services")
        .select("onboarding_status")
        .eq("client_id", profile.client_id),
      getClientNotifications(profile.client_id, profile.id),
      getClientNotificationFeed(profile.client_id),
    ]);

  // Sidebar indicators: a blue dot for sections with unseen activity, and a
  // green check on Onboarding once it's complete.
  const badges: NavBadges = {};
  for (const section of NOTIFY_SECTIONS) {
    if (notifications[section]) badges[SECTION_HREF[section]] = "dot";
  }
  if (isOnboardingComplete(services ?? [])) {
    badges["/dashboard/onboarding"] = "check";
  }

  return (
    <AppShell
      roleLabel="Client"
      context={client?.name ?? "Your account"}
      badges={badges}
      headerSlot={
        <NotificationBell
          notifications={feed.items}
          unreadCount={feed.unreadCount}
        />
      }
      user={{
        name: profile.full_name ?? "Client",
        email: profile.email ?? "",
        avatarUrl: profile.avatar_url,
      }}
    >
      {children}
    </AppShell>
  );
}
