import { requireClient } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  isOnboardingComplete,
  getClientNotifications,
  NOTIFY_SECTIONS,
  SECTION_HREF,
} from "@/lib/queries";
import { AppShell, type NavBadges } from "@/components/layout/app-shell";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireClient();
  const supabase = await createClient();

  const [{ data: client }, { data: services }, notifications] =
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
