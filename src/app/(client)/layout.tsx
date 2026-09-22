import { requireClientWorkspace } from "@/lib/auth";
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
import { IntakeLoginAdvance } from "@/components/client/intake-login-advance";
import { WorkspaceSwitcher } from "@/components/client/workspace-switcher";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // requireClientWorkspace redirects admins to /admin, so this layout (and the
  // maintenance gate below) only ever applies to client users. `clientId` is the
  // resolved ACTIVE workspace (S3) that the whole shell renders against;
  // `memberships`/`hasMultiple` drive the S4B workspace switcher.
  const { profile, clientId, memberships, hasMultiple } =
    await requireClientWorkspace();

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
        .select("name, onboarding_type, intake_status")
        .eq("id", clientId)
        .single(),
      supabase
        .from("client_services")
        .select("onboarding_status")
        .eq("client_id", clientId),
      getClientNotifications(clientId, profile.id),
      getClientNotificationFeed(clientId),
    ]);

  // Sidebar indicators: a blue dot for sections with unseen activity, and a
  // green check on Onboarding once it's complete.
  const badges: NavBadges = {};
  for (const section of NOTIFY_SECTIONS) {
    if (notifications[section]) badges[SECTION_HREF[section]] = "dot";
  }
  // Onboarding is a task, not a permanent destination: once complete it drops
  // out of the primary nav (its route stays reachable). While still active it
  // shows in nav; the green "check" only ever applies in that shown state.
  const onboardingActive = !isOnboardingComplete(services ?? []);
  if (!onboardingActive) {
    badges["/dashboard/onboarding"] = "check";
  }

  // D1: a new client arriving at portal_access_sent has their onboarding opened
  // on first load (→ onboarding_started). Mounted only when actually needed.
  const needsIntakeAdvance =
    client?.onboarding_type === "new" &&
    client?.intake_status === "portal_access_sent";

  // S4B: workspace switcher — ONLY for clients who belong to >1 workspace. Names
  // are read under the client's own RLS (they may read clients they're a member
  // of, S2). Single-workspace clients get no switcher and an unchanged shell.
  let workspaceOptions: { id: string; name: string }[] = [];
  if (hasMultiple) {
    const { data: memberClients } = await supabase
      .from("clients")
      .select("id, name")
      .in("id", memberships);
    workspaceOptions = (memberClients ?? []).map((c) => ({
      id: c.id as string,
      name: (c.name as string) ?? "Workspace",
    }));
  }
  const showSwitcher = hasMultiple && workspaceOptions.length > 1;

  return (
    <AppShell
      roleLabel="Client"
      context={client?.name ?? "Your account"}
      badges={badges}
      onboardingActive={onboardingActive}
      workspaceControl={
        showSwitcher ? (
          <WorkspaceSwitcher activeId={clientId} workspaces={workspaceOptions} />
        ) : undefined
      }
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
      {needsIntakeAdvance && <IntakeLoginAdvance />}
      {children}
    </AppShell>
  );
}
